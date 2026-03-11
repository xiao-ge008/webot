//! Semantic memory store with vector embedding support and orchestration metadata.
//!
//! - Stores typed memories (`memory_type`) with lifecycle fields.
//! - Supports hybrid recall scoring (semantic + lexical + recency + importance).
//! - Applies conflict superseding for slot-like memories via `entity_key`.

use chrono::{DateTime, Utc};
use openfang_types::agent::AgentId;
use openfang_types::error::{OpenFangError, OpenFangResult};
use openfang_types::memory::{MemoryFilter, MemoryFragment, MemoryId, MemorySource};
use rusqlite::Connection;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::debug;

const META_MEMORY_TYPE: &str = "memory_type";
const META_IMPORTANCE: &str = "importance";
const META_CONFIDENCE: &str = "confidence";
const META_ENTITY_KEY: &str = "entity_key";
const META_STATUS: &str = "status";
const META_SUPERSEDES_ID: &str = "supersedes_id";
const META_EXPIRES_AT: &str = "expires_at";

/// Semantic store backed by SQLite with optional vector search.
#[derive(Clone)]
pub struct SemanticStore {
    conn: Arc<Mutex<Connection>>,
}

#[derive(Debug)]
struct ScoredFragment {
    fragment: MemoryFragment,
    memory_type: String,
    importance: f32,
    score: f32,
}

impl SemanticStore {
    /// Create a new semantic store wrapping the given connection.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    /// Store a new memory fragment (without embedding).
    pub fn remember(
        &self,
        agent_id: AgentId,
        content: &str,
        source: MemorySource,
        scope: &str,
        metadata: HashMap<String, serde_json::Value>,
    ) -> OpenFangResult<MemoryId> {
        self.remember_with_embedding(agent_id, content, source, scope, metadata, None)
    }

    /// Store a new memory fragment with an optional embedding vector.
    pub fn remember_with_embedding(
        &self,
        agent_id: AgentId,
        content: &str,
        source: MemorySource,
        scope: &str,
        metadata: HashMap<String, serde_json::Value>,
        embedding: Option<&[f32]>,
    ) -> OpenFangResult<MemoryId> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Internal(e.to_string()))?;
        let now = Utc::now().to_rfc3339();
        let source_str = serde_json::to_string(&source)
            .map_err(|e| OpenFangError::Serialization(e.to_string()))?;
        let meta_str = serde_json::to_string(&metadata)
            .map_err(|e| OpenFangError::Serialization(e.to_string()))?;
        let embedding_bytes: Option<Vec<u8>> = embedding.map(embedding_to_bytes);

        let mut memory_type = metadata_string(&metadata, META_MEMORY_TYPE)
            .unwrap_or_else(|| scope.to_string())
            .trim()
            .to_string();
        if memory_type.is_empty() {
            memory_type = scope.to_string();
        }
        let importance = metadata_f32(&metadata, META_IMPORTANCE)
            .unwrap_or(0.5)
            .clamp(0.0, 1.0);
        let confidence = metadata_f32(&metadata, META_CONFIDENCE)
            .unwrap_or(1.0)
            .clamp(0.0, 1.0);
        let entity_key = metadata_string(&metadata, META_ENTITY_KEY)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let expires_at = metadata_string(&metadata, META_EXPIRES_AT)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let mut status = metadata_string(&metadata, META_STATUS)
            .unwrap_or_else(|| "active".to_string())
            .to_lowercase();
        if status.is_empty() {
            status = "active".to_string();
        }

        // Deduplicate identical active content for the same agent/scope.
        let existing_same = conn
            .query_row(
                "SELECT id FROM memories
                 WHERE agent_id = ?1 AND scope = ?2 AND content = ?3 AND deleted = 0
                   AND (status = 'active' OR status IS NULL)
                 ORDER BY created_at DESC
                 LIMIT 1",
                rusqlite::params![agent_id.0.to_string(), scope, content],
                |row| row.get::<_, String>(0),
            )
            .ok();
        if let Some(id_str) = existing_same {
            if let Ok(id) = uuid::Uuid::parse_str(&id_str).map(MemoryId) {
                return Ok(id);
            }
        }

        // Conflict/supersede handling for slot-like memories.
        let mut supersedes_id: Option<String> = None;
        if let Some(slot) = &entity_key {
            if allow_supersede_for_type(&memory_type) {
                let existing = conn
                    .query_row(
                        "SELECT id, confidence FROM memories
                         WHERE agent_id = ?1
                           AND entity_key = ?2
                           AND memory_type = ?3
                           AND deleted = 0
                           AND (status = 'active' OR status IS NULL)
                         ORDER BY created_at DESC
                         LIMIT 1",
                        rusqlite::params![agent_id.0.to_string(), slot, memory_type],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)? as f32)),
                    )
                    .ok();

                if let Some((old_id, old_conf)) = existing {
                    if confidence + 0.15 >= old_conf {
                        conn.execute(
                            "UPDATE memories SET status = 'superseded' WHERE id = ?1",
                            rusqlite::params![old_id.clone()],
                        )
                        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
                        supersedes_id = Some(old_id);
                    }
                }
            }
        }

        let id = MemoryId::new();
        conn.execute(
            "INSERT INTO memories (
                id, agent_id, content, source, scope, confidence, metadata,
                created_at, accessed_at, access_count, deleted, embedding,
                memory_type, importance, entity_key, status, supersedes_id, expires_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                ?8, ?8, 0, 0, ?9,
                ?10, ?11, ?12, ?13, ?14, ?15
             )",
            rusqlite::params![
                id.0.to_string(),
                agent_id.0.to_string(),
                content,
                source_str,
                scope,
                confidence as f64,
                meta_str,
                now,
                embedding_bytes,
                memory_type,
                importance as f64,
                entity_key,
                status,
                supersedes_id.clone(),
                expires_at,
            ],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;

        Ok(id)
    }

    /// Search for memories using text matching (fallback, no embeddings).
    pub fn recall(
        &self,
        query: &str,
        limit: usize,
        filter: Option<MemoryFilter>,
    ) -> OpenFangResult<Vec<MemoryFragment>> {
        self.recall_with_embedding(query, limit, filter, None)
    }

    /// Search for memories using vector similarity when a query embedding is provided,
    /// falling back to lexical/recent/importance ranking otherwise.
    pub fn recall_with_embedding(
        &self,
        query: &str,
        limit: usize,
        filter: Option<MemoryFilter>,
        query_embedding: Option<&[f32]>,
    ) -> OpenFangResult<Vec<MemoryFragment>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Internal(e.to_string()))?;

        let fetch_limit = (limit.max(1) * 10).clamp(50, 1000);
        let now_rfc3339 = Utc::now().to_rfc3339();

        let mut sql = String::from(
            "SELECT id, agent_id, content, source, scope, confidence, metadata,
                    created_at, accessed_at, access_count, embedding,
                    memory_type, importance, entity_key, status, supersedes_id, expires_at
             FROM memories
             WHERE deleted = 0
               AND (status = 'active' OR status IS NULL)
               AND (expires_at IS NULL OR expires_at > ?1)",
        );
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        params.push(Box::new(now_rfc3339));
        let mut param_idx = 2;

        // Apply lexical pre-filter only when no vector query is available.
        if query_embedding.is_none() && !query.trim().is_empty() {
            sql.push_str(&format!(" AND content LIKE ?{param_idx}"));
            params.push(Box::new(format!("%{}%", query.trim())));
            param_idx += 1;
        }

        if let Some(ref f) = filter {
            if let Some(agent_id) = f.agent_id {
                sql.push_str(&format!(" AND agent_id = ?{param_idx}"));
                params.push(Box::new(agent_id.0.to_string()));
                param_idx += 1;
            }
            if let Some(ref scope) = f.scope {
                sql.push_str(&format!(" AND scope = ?{param_idx}"));
                params.push(Box::new(scope.clone()));
                param_idx += 1;
            }
            if let Some(min_conf) = f.min_confidence {
                sql.push_str(&format!(" AND confidence >= ?{param_idx}"));
                params.push(Box::new(min_conf as f64));
                param_idx += 1;
            }
            if let Some(ref source) = f.source {
                let source_str = serde_json::to_string(source)
                    .map_err(|e| OpenFangError::Serialization(e.to_string()))?;
                sql.push_str(&format!(" AND source = ?{param_idx}"));
                params.push(Box::new(source_str));
                param_idx += 1;
            }
            if let Some(after) = f.after {
                sql.push_str(&format!(" AND created_at >= ?{param_idx}"));
                params.push(Box::new(after.to_rfc3339()));
                param_idx += 1;
            }
            if let Some(before) = f.before {
                sql.push_str(&format!(" AND created_at <= ?{param_idx}"));
                params.push(Box::new(before.to_rfc3339()));
            }
        }

        sql.push_str(" ORDER BY accessed_at DESC, access_count DESC, created_at DESC");
        sql.push_str(&format!(" LIMIT {fetch_limit}"));

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, f64>(5)? as f32,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, i64>(9)? as u64,
                    row.get::<_, Option<Vec<u8>>>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, f64>(12)? as f32,
                    row.get::<_, Option<String>>(13)?,
                    row.get::<_, Option<String>>(14)?,
                    row.get::<_, Option<String>>(15)?,
                    row.get::<_, Option<String>>(16)?,
                ))
            })
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;

        let mut scored = Vec::new();
        for row_result in rows {
            let (
                id_str,
                agent_str,
                content,
                source_str,
                scope,
                confidence,
                meta_str,
                created_str,
                accessed_str,
                access_count,
                embedding_bytes,
                memory_type,
                importance,
                entity_key,
                status,
                supersedes_id,
                expires_at,
            ) = row_result.map_err(|e| OpenFangError::Memory(e.to_string()))?;

            let id = uuid::Uuid::parse_str(&id_str)
                .map(MemoryId)
                .map_err(|e| OpenFangError::Memory(e.to_string()))?;
            let agent_id = uuid::Uuid::parse_str(&agent_str)
                .map(openfang_types::agent::AgentId)
                .map_err(|e| OpenFangError::Memory(e.to_string()))?;
            let source: MemorySource =
                serde_json::from_str(&source_str).unwrap_or(MemorySource::System);
            let created_at = chrono::DateTime::parse_from_rfc3339(&created_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            let accessed_at = chrono::DateTime::parse_from_rfc3339(&accessed_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());

            let mut metadata: HashMap<String, serde_json::Value> =
                serde_json::from_str(&meta_str).unwrap_or_default();
            metadata
                .entry(META_MEMORY_TYPE.to_string())
                .or_insert_with(|| serde_json::Value::String(memory_type.clone()));
            metadata
                .entry(META_IMPORTANCE.to_string())
                .or_insert_with(|| serde_json::Value::from(importance as f64));
            if let Some(v) = entity_key.clone() {
                metadata
                    .entry(META_ENTITY_KEY.to_string())
                    .or_insert_with(|| serde_json::Value::String(v));
            }
            if let Some(v) = status.clone() {
                metadata
                    .entry(META_STATUS.to_string())
                    .or_insert_with(|| serde_json::Value::String(v));
            }
            if let Some(v) = supersedes_id.clone() {
                metadata
                    .entry(META_SUPERSEDES_ID.to_string())
                    .or_insert_with(|| serde_json::Value::String(v));
            }
            if let Some(v) = expires_at.clone() {
                metadata
                    .entry(META_EXPIRES_AT.to_string())
                    .or_insert_with(|| serde_json::Value::String(v));
            }

            if let Some(ref f) = filter {
                if !f.metadata.is_empty()
                    && !f.metadata.iter().all(|(k, v)| metadata.get(k) == Some(v))
                {
                    continue;
                }
            }

            let embedding = embedding_bytes.as_deref().map(embedding_from_bytes);
            let semantic_score = query_embedding
                .and_then(|qe| embedding.as_deref().map(|e| cosine_similarity(qe, e)))
                .unwrap_or(0.0)
                .max(0.0);
            let lexical_score = lexical_match_score(query, &content);
            let recency_score = recency_score(created_at);
            let type_priority = type_priority_score(&memory_type);
            let conflict_penalty = if status.as_deref() == Some("superseded") {
                0.5
            } else {
                0.0
            };

            let score = 0.35 * semantic_score
                + 0.20 * lexical_score
                + 0.15 * recency_score
                + 0.15 * importance.clamp(0.0, 1.0)
                + 0.10 * confidence.clamp(0.0, 1.0)
                + 0.05 * type_priority
                - 0.20 * conflict_penalty;

            scored.push(ScoredFragment {
                fragment: MemoryFragment {
                    id,
                    agent_id,
                    content,
                    embedding,
                    metadata,
                    source,
                    confidence,
                    created_at,
                    accessed_at,
                    access_count,
                    scope,
                },
                memory_type,
                importance,
                score,
            });
        }

        scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal));
        scored.truncate(limit);

        for frag in &scored {
            let _ = conn.execute(
                "UPDATE memories SET access_count = access_count + 1, accessed_at = ?1 WHERE id = ?2",
                rusqlite::params![Utc::now().to_rfc3339(), frag.fragment.id.0.to_string()],
            );

            let retrieval_meta = serde_json::json!({
                "memory_type": frag.memory_type,
                "importance": frag.importance,
            })
            .to_string();
            let _ = conn.execute(
                "INSERT INTO memory_access_log (id, agent_id, query, memory_id, score, retrieval_meta, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    uuid::Uuid::new_v4().to_string(),
                    frag.fragment.agent_id.0.to_string(),
                    query,
                    frag.fragment.id.0.to_string(),
                    frag.score as f64,
                    retrieval_meta,
                    Utc::now().to_rfc3339(),
                ],
            );
        }

        debug!(
            "Hybrid recall: {} results from {} candidates (query='{}')",
            scored.len(),
            fetch_limit,
            query
        );

        Ok(scored
            .into_iter()
            .map(|item| {
                let mut fragment = item.fragment;
                fragment.metadata.insert(
                    "retrieval_score".to_string(),
                    serde_json::Value::from(item.score as f64),
                );
                fragment.metadata.insert(
                    "retrieval_memory_type".to_string(),
                    serde_json::Value::String(item.memory_type),
                );
                fragment.metadata.insert(
                    "retrieval_importance".to_string(),
                    serde_json::Value::from(item.importance as f64),
                );
                fragment
            })
            .collect())
    }

    /// Soft-delete a memory fragment.
    pub fn forget(&self, id: MemoryId) -> OpenFangResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Internal(e.to_string()))?;
        conn.execute(
            "UPDATE memories SET deleted = 1, status = 'revoked' WHERE id = ?1",
            rusqlite::params![id.0.to_string()],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        Ok(())
    }

    /// Update the embedding for an existing memory.
    pub fn update_embedding(&self, id: MemoryId, embedding: &[f32]) -> OpenFangResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Internal(e.to_string()))?;
        let bytes = embedding_to_bytes(embedding);
        conn.execute(
            "UPDATE memories SET embedding = ?1 WHERE id = ?2",
            rusqlite::params![bytes, id.0.to_string()],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        Ok(())
    }
}

fn metadata_string(metadata: &HashMap<String, serde_json::Value>, key: &str) -> Option<String> {
    metadata.get(key).and_then(|v| match v {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    })
}

fn metadata_f32(metadata: &HashMap<String, serde_json::Value>, key: &str) -> Option<f32> {
    metadata.get(key).and_then(|v| match v {
        serde_json::Value::Number(n) => n.as_f64().map(|f| f as f32),
        serde_json::Value::String(s) => s.parse::<f32>().ok(),
        _ => None,
    })
}

fn allow_supersede_for_type(memory_type: &str) -> bool {
    matches!(memory_type, "fact" | "preference" | "task_state" | "policy")
}

fn lexical_match_score(query: &str, content: &str) -> f32 {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return 0.0;
    }
    let c = content.to_lowercase();
    if c.contains(&q) {
        return 1.0;
    }
    let q_tokens: Vec<&str> = q.split_whitespace().collect();
    if q_tokens.is_empty() {
        return 0.0;
    }
    let matched = q_tokens
        .iter()
        .filter(|t| !t.is_empty() && c.contains(**t))
        .count();
    matched as f32 / q_tokens.len() as f32
}

fn recency_score(created_at: DateTime<Utc>) -> f32 {
    let age_hours = (Utc::now() - created_at).num_hours().max(0) as f32;
    let age_days = age_hours / 24.0;
    (1.0 / (1.0 + age_days / 30.0)).clamp(0.0, 1.0)
}

fn type_priority_score(memory_type: &str) -> f32 {
    match memory_type {
        "policy" | "task_state" | "preference" => 1.0,
        "fact" | "summary_episode" => 0.85,
        "summary_topic" => 0.70,
        "tool_experience" => 0.60,
        "summary_turn" => 0.50,
        _ => 0.55,
    }
}

/// Compute cosine similarity between two vectors.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom < f32::EPSILON {
        0.0
    } else {
        dot / denom
    }
}

/// Serialize embedding to bytes for SQLite BLOB storage.
fn embedding_to_bytes(embedding: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(embedding.len() * 4);
    for &val in embedding {
        bytes.extend_from_slice(&val.to_le_bytes());
    }
    bytes
}

/// Deserialize embedding from bytes.
fn embedding_from_bytes(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migration::run_migrations;

    fn setup() -> SemanticStore {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        SemanticStore::new(Arc::new(Mutex::new(conn)))
    }

    #[test]
    fn test_remember_and_recall() {
        let store = setup();
        let agent_id = AgentId::new();
        store
            .remember(
                agent_id,
                "The user likes Rust programming",
                MemorySource::Conversation,
                "episodic",
                HashMap::new(),
            )
            .unwrap();
        let results = store.recall("Rust", 10, None).unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].content.contains("Rust"));
    }

    #[test]
    fn test_recall_with_filter() {
        let store = setup();
        let agent_id = AgentId::new();
        store
            .remember(
                agent_id,
                "Memory A",
                MemorySource::Conversation,
                "episodic",
                HashMap::new(),
            )
            .unwrap();
        store
            .remember(
                AgentId::new(),
                "Memory B",
                MemorySource::Conversation,
                "episodic",
                HashMap::new(),
            )
            .unwrap();
        let filter = MemoryFilter::agent(agent_id);
        let results = store.recall("Memory", 10, Some(filter)).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].content, "Memory A");
    }

    #[test]
    fn test_forget() {
        let store = setup();
        let agent_id = AgentId::new();
        let id = store
            .remember(
                agent_id,
                "To forget",
                MemorySource::Conversation,
                "episodic",
                HashMap::new(),
            )
            .unwrap();
        store.forget(id).unwrap();
        let results = store.recall("To forget", 10, None).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_remember_with_embedding() {
        let store = setup();
        let agent_id = AgentId::new();
        let embedding = vec![0.1, 0.2, 0.3, 0.4];
        let id = store
            .remember_with_embedding(
                agent_id,
                "Rust is great",
                MemorySource::Conversation,
                "episodic",
                HashMap::new(),
                Some(&embedding),
            )
            .unwrap();
        assert_ne!(id.0.to_string(), "");
    }

    #[test]
    fn test_vector_recall_ranking() {
        let store = setup();
        let agent_id = AgentId::new();

        let emb_rust = vec![0.9, 0.1, 0.0, 0.0];
        let emb_python = vec![0.0, 0.0, 0.9, 0.1];
        let emb_mixed = vec![0.5, 0.5, 0.0, 0.0];

        store
            .remember_with_embedding(
                agent_id,
                "Rust is a systems language",
                MemorySource::Conversation,
                "episodic",
                HashMap::new(),
                Some(&emb_rust),
            )
            .unwrap();
        store
            .remember_with_embedding(
                agent_id,
                "Python is interpreted",
                MemorySource::Conversation,
                "episodic",
                HashMap::new(),
                Some(&emb_python),
            )
            .unwrap();
        store
            .remember_with_embedding(
                agent_id,
                "Both are popular",
                MemorySource::Conversation,
                "episodic",
                HashMap::new(),
                Some(&emb_mixed),
            )
            .unwrap();

        let query_emb = vec![0.85, 0.15, 0.0, 0.0];
        let results = store
            .recall_with_embedding("", 3, None, Some(&query_emb))
            .unwrap();

        assert_eq!(results.len(), 3);
        assert!(results[0].content.contains("Rust"));
        assert!(results[2].content.contains("Python"));
    }

    #[test]
    fn test_update_embedding() {
        let store = setup();
        let agent_id = AgentId::new();
        let id = store
            .remember(
                agent_id,
                "No embedding yet",
                MemorySource::Conversation,
                "episodic",
                HashMap::new(),
            )
            .unwrap();

        let emb = vec![1.0, 0.0, 0.0];
        store.update_embedding(id, &emb).unwrap();

        let query_emb = vec![1.0, 0.0, 0.0];
        let results = store
            .recall_with_embedding("", 10, None, Some(&query_emb))
            .unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].embedding.is_some());
        assert_eq!(results[0].embedding.as_ref().unwrap().len(), 3);
    }

    #[test]
    fn test_mixed_embedded_and_non_embedded() {
        let store = setup();
        let agent_id = AgentId::new();

        store
            .remember_with_embedding(
                agent_id,
                "Has embedding",
                MemorySource::Conversation,
                "episodic",
                HashMap::new(),
                Some(&[1.0, 0.0]),
            )
            .unwrap();
        store
            .remember(
                agent_id,
                "No embedding",
                MemorySource::Conversation,
                "episodic",
                HashMap::new(),
            )
            .unwrap();

        let results = store
            .recall_with_embedding("", 10, None, Some(&[1.0, 0.0]))
            .unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].content, "Has embedding");
    }

    #[test]
    fn test_conflict_supersede_by_entity_key() {
        let store = setup();
        let agent_id = AgentId::new();

        let mut meta_old = HashMap::new();
        meta_old.insert(
            META_MEMORY_TYPE.to_string(),
            serde_json::Value::String("preference".to_string()),
        );
        meta_old.insert(
            META_ENTITY_KEY.to_string(),
            serde_json::Value::String("user.preference.language".to_string()),
        );
        meta_old.insert(META_CONFIDENCE.to_string(), serde_json::Value::from(0.7));
        store
            .remember(
                agent_id,
                "用户偏好语言是英文",
                MemorySource::Conversation,
                "long_term",
                meta_old,
            )
            .unwrap();

        let mut meta_new = HashMap::new();
        meta_new.insert(
            META_MEMORY_TYPE.to_string(),
            serde_json::Value::String("preference".to_string()),
        );
        meta_new.insert(
            META_ENTITY_KEY.to_string(),
            serde_json::Value::String("user.preference.language".to_string()),
        );
        meta_new.insert(META_CONFIDENCE.to_string(), serde_json::Value::from(0.9));
        store
            .remember(
                agent_id,
                "用户偏好语言是中文",
                MemorySource::Conversation,
                "long_term",
                meta_new,
            )
            .unwrap();

        let filter = MemoryFilter::agent(agent_id);
        let recalls = store.recall("语言", 10, Some(filter)).unwrap();
        assert_eq!(recalls.len(), 1);
        assert!(recalls[0].content.contains("中文"));
    }
}
