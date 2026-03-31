//! MemorySubstrate: unified implementation of the `Memory` trait.
//!
//! Composes the structured store, semantic store, knowledge store,
//! session store, and consolidation engine behind a single async API.

use crate::consolidation::ConsolidationEngine;
use crate::knowledge::KnowledgeStore;
use crate::migration::run_migrations;
use crate::semantic::SemanticStore;
use crate::session::{Session, SessionStore};
use crate::structured::StructuredStore;
use crate::task_center::TaskCenterStore;
use crate::usage::UsageStore;

use async_trait::async_trait;
use openfang_types::agent::{AgentEntry, AgentId, SessionId};
use openfang_types::error::{OpenFangError, OpenFangResult};
use openfang_types::memory::{
    ConsolidationReport, Entity, ExportFormat, GraphMatch, GraphPattern, ImportReport, Memory,
    MemoryFilter, MemoryFragment, MemoryId, MemorySource, Relation,
};
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

/// The unified memory substrate. Implements the `Memory` trait by delegating
/// to specialized stores backed by a shared SQLite connection.
pub struct MemorySubstrate {
    conn: Arc<Mutex<Connection>>,
    structured: StructuredStore,
    semantic: SemanticStore,
    knowledge: KnowledgeStore,
    sessions: SessionStore,
    consolidation: ConsolidationEngine,
    usage: UsageStore,
    task_center: TaskCenterStore,
}

impl MemorySubstrate {
    /// Open or create a memory substrate at the given database path.
    pub fn open(db_path: &Path, decay_rate: f32) -> OpenFangResult<Self> {
        let conn = Connection::open(db_path).map_err(|e| OpenFangError::Memory(e.to_string()))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        run_migrations(&conn).map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let shared = Arc::new(Mutex::new(conn));

        Ok(Self {
            conn: Arc::clone(&shared),
            structured: StructuredStore::new(Arc::clone(&shared)),
            semantic: SemanticStore::new(Arc::clone(&shared)),
            knowledge: KnowledgeStore::new(Arc::clone(&shared)),
            sessions: SessionStore::new(Arc::clone(&shared)),
            usage: UsageStore::new(Arc::clone(&shared)),
            consolidation: ConsolidationEngine::new(Arc::clone(&shared), decay_rate),
            task_center: TaskCenterStore::new(Arc::clone(&shared)),
        })
    }

    /// Create an in-memory substrate (for testing).
    pub fn open_in_memory(decay_rate: f32) -> OpenFangResult<Self> {
        let conn =
            Connection::open_in_memory().map_err(|e| OpenFangError::Memory(e.to_string()))?;
        run_migrations(&conn).map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let shared = Arc::new(Mutex::new(conn));

        Ok(Self {
            conn: Arc::clone(&shared),
            structured: StructuredStore::new(Arc::clone(&shared)),
            semantic: SemanticStore::new(Arc::clone(&shared)),
            knowledge: KnowledgeStore::new(Arc::clone(&shared)),
            sessions: SessionStore::new(Arc::clone(&shared)),
            usage: UsageStore::new(Arc::clone(&shared)),
            consolidation: ConsolidationEngine::new(Arc::clone(&shared), decay_rate),
            task_center: TaskCenterStore::new(Arc::clone(&shared)),
        })
    }

    /// Get a reference to the usage store.
    pub fn usage(&self) -> &UsageStore {
        &self.usage
    }

    /// Get the shared database connection (for constructing stores from outside).
    pub fn usage_conn(&self) -> Arc<Mutex<Connection>> {
        Arc::clone(&self.conn)
    }

    pub fn task_create(
        &self,
        spec: &openfang_types::tasks::ManagedTaskSpec,
        runtime: &openfang_types::tasks::ManagedTaskRuntime,
    ) -> OpenFangResult<()> {
        self.task_center.create_task(spec, runtime)
    }

    pub fn task_update(
        &self,
        spec: &openfang_types::tasks::ManagedTaskSpec,
        runtime: &openfang_types::tasks::ManagedTaskRuntime,
    ) -> OpenFangResult<()> {
        self.task_center.update_task(spec, runtime)
    }

    pub fn task_get(
        &self,
        task_id: &str,
    ) -> OpenFangResult<Option<openfang_types::tasks::ManagedTaskDetail>> {
        self.task_center.get_task(task_id)
    }

    pub fn task_list_managed(
        &self,
        agent_id: Option<&str>,
    ) -> OpenFangResult<Vec<openfang_types::tasks::ManagedTaskDetail>> {
        self.task_center.list_tasks(agent_id)
    }

    pub fn task_find_by_cron_job_id(
        &self,
        cron_job_id: &str,
    ) -> OpenFangResult<Option<openfang_types::tasks::ManagedTaskDetail>> {
        self.task_center.find_task_by_cron_job_id(cron_job_id)
    }

    pub fn task_delete_managed(&self, task_id: &str) -> OpenFangResult<()> {
        self.task_center.delete_task(task_id)
    }

    pub fn task_append_run(
        &self,
        run: &openfang_types::tasks::ManagedTaskRun,
    ) -> OpenFangResult<()> {
        self.task_center.append_run(run)
    }

    pub fn task_list_runs_managed(
        &self,
        task_id: &str,
    ) -> OpenFangResult<Vec<openfang_types::tasks::ManagedTaskRun>> {
        self.task_center.list_runs(task_id)
    }

    pub fn task_append_event(
        &self,
        event: &openfang_types::tasks::ManagedTaskEvent,
    ) -> OpenFangResult<()> {
        self.task_center.append_event(event)
    }

    pub fn task_list_events_managed(
        &self,
        task_id: &str,
    ) -> OpenFangResult<Vec<openfang_types::tasks::ManagedTaskEvent>> {
        self.task_center.list_events(task_id)
    }

    pub fn task_append_delivery(
        &self,
        delivery: &openfang_types::tasks::ManagedTaskDelivery,
    ) -> OpenFangResult<()> {
        self.task_center.append_delivery(delivery)
    }

    pub fn task_append_delivery_attempt(
        &self,
        attempt: &openfang_types::tasks::ManagedTaskDeliveryAttempt,
    ) -> OpenFangResult<()> {
        self.task_center.append_delivery_attempt(attempt)
    }

    pub fn task_list_deliveries_managed(
        &self,
        task_id: &str,
    ) -> OpenFangResult<Vec<openfang_types::tasks::ManagedTaskDelivery>> {
        self.task_center.list_deliveries(task_id)
    }

    pub fn task_list_delivery_attempts_managed(
        &self,
        task_id: &str,
    ) -> OpenFangResult<Vec<openfang_types::tasks::ManagedTaskDeliveryAttempt>> {
        self.task_center.list_delivery_attempts(task_id)
    }

    pub fn task_list_pending_deliveries_managed(
        &self,
        target_kind: Option<&str>,
        origin_chat_session_id: Option<&str>,
    ) -> OpenFangResult<Vec<openfang_types::tasks::ManagedTaskDelivery>> {
        self.task_center
            .list_pending_deliveries(target_kind, origin_chat_session_id)
    }

    pub fn task_mark_delivery_status(
        &self,
        delivery_id: &str,
        status: openfang_types::tasks::ManagedTaskDeliveryStatus,
    ) -> OpenFangResult<Option<openfang_types::tasks::ManagedTaskDelivery>> {
        self.task_center.mark_delivery_status(delivery_id, status)
    }

    /// Save an agent entry to persistent storage.
    pub fn save_agent(&self, entry: &AgentEntry) -> OpenFangResult<()> {
        self.structured.save_agent(entry)
    }

    /// Load an agent entry from persistent storage.
    pub fn load_agent(&self, agent_id: AgentId) -> OpenFangResult<Option<AgentEntry>> {
        self.structured.load_agent(agent_id)
    }

    /// Remove an agent from persistent storage and cascade-delete sessions.
    pub fn remove_agent(&self, agent_id: AgentId) -> OpenFangResult<()> {
        // Delete associated sessions first
        let _ = self.sessions.delete_agent_sessions(agent_id);
        self.structured.remove_agent(agent_id)
    }

    /// Load all agent entries from persistent storage.
    pub fn load_all_agents(&self) -> OpenFangResult<Vec<AgentEntry>> {
        self.structured.load_all_agents()
    }

    /// List all saved agents.
    pub fn list_agents(&self) -> OpenFangResult<Vec<(String, String, String)>> {
        self.structured.list_agents()
    }

    /// Synchronous get from the structured store (for kernel handle use).
    pub fn structured_get(
        &self,
        agent_id: AgentId,
        key: &str,
    ) -> OpenFangResult<Option<serde_json::Value>> {
        self.structured.get(agent_id, key)
    }

    /// List all KV pairs for an agent.
    pub fn list_kv(&self, agent_id: AgentId) -> OpenFangResult<Vec<(String, serde_json::Value)>> {
        self.structured.list_kv(agent_id)
    }

    /// Delete a KV entry for an agent.
    pub fn structured_delete(&self, agent_id: AgentId, key: &str) -> OpenFangResult<()> {
        self.structured.delete(agent_id, key)
    }

    /// Synchronous set in the structured store (for kernel handle use).
    pub fn structured_set(
        &self,
        agent_id: AgentId,
        key: &str,
        value: serde_json::Value,
    ) -> OpenFangResult<()> {
        self.structured.set(agent_id, key, value)
    }

    /// Get a session by ID.
    pub fn get_session(&self, session_id: SessionId) -> OpenFangResult<Option<Session>> {
        self.sessions.get_session(session_id)
    }

    /// Save a session.
    pub fn save_session(&self, session: &Session) -> OpenFangResult<()> {
        self.sessions.save_session(session)
    }

    /// Create a new empty session for an agent.
    pub fn create_session(&self, agent_id: AgentId) -> OpenFangResult<Session> {
        self.sessions.create_session(agent_id)
    }

    /// List all sessions with metadata.
    pub fn list_sessions(&self) -> OpenFangResult<Vec<serde_json::Value>> {
        self.sessions.list_sessions()
    }

    /// Delete a session by ID.
    pub fn delete_session(&self, session_id: SessionId) -> OpenFangResult<()> {
        self.sessions.delete_session(session_id)
    }

    /// Delete all sessions belonging to an agent.
    pub fn delete_agent_sessions(&self, agent_id: AgentId) -> OpenFangResult<()> {
        self.sessions.delete_agent_sessions(agent_id)
    }

    /// Delete the canonical (cross-channel) session for an agent.
    pub fn delete_canonical_session(&self, agent_id: AgentId) -> OpenFangResult<()> {
        self.sessions.delete_canonical_session(agent_id)
    }

    /// Set or clear a session label.
    pub fn set_session_label(
        &self,
        session_id: SessionId,
        label: Option<&str>,
    ) -> OpenFangResult<()> {
        self.sessions.set_session_label(session_id, label)
    }

    /// Find a session by label for a given agent.
    pub fn find_session_by_label(
        &self,
        agent_id: AgentId,
        label: &str,
    ) -> OpenFangResult<Option<Session>> {
        self.sessions.find_session_by_label(agent_id, label)
    }

    /// List all sessions for a specific agent.
    pub fn list_agent_sessions(&self, agent_id: AgentId) -> OpenFangResult<Vec<serde_json::Value>> {
        self.sessions.list_agent_sessions(agent_id)
    }

    /// Create a new session with an optional label.
    pub fn create_session_with_label(
        &self,
        agent_id: AgentId,
        label: Option<&str>,
    ) -> OpenFangResult<Session> {
        self.sessions.create_session_with_label(agent_id, label)
    }

    /// Load canonical session context for cross-channel memory.
    ///
    /// Returns the compacted summary (if any) and recent messages from the
    /// agent's persistent canonical session.
    pub fn canonical_context(
        &self,
        agent_id: AgentId,
        window_size: Option<usize>,
    ) -> OpenFangResult<(Option<String>, Vec<openfang_types::message::Message>)> {
        self.sessions.canonical_context(agent_id, window_size)
    }

    /// Store an LLM-generated summary, replacing older messages with the kept subset.
    ///
    /// Used by the compactor to replace text-truncation compaction with an
    /// LLM-generated summary of older conversation history.
    pub fn store_llm_summary(
        &self,
        agent_id: AgentId,
        summary: &str,
        kept_messages: Vec<openfang_types::message::Message>,
    ) -> OpenFangResult<()> {
        self.sessions
            .store_llm_summary(agent_id, summary, kept_messages)
    }

    /// Write a human-readable JSONL mirror of a session to disk.
    ///
    /// Best-effort — errors are returned but should be logged,
    /// never affecting the primary SQLite store.
    pub fn write_jsonl_mirror(
        &self,
        session: &Session,
        sessions_dir: &Path,
    ) -> Result<(), std::io::Error> {
        self.sessions.write_jsonl_mirror(session, sessions_dir)
    }

    /// Append messages to the agent's canonical session for cross-channel persistence.
    pub fn append_canonical(
        &self,
        agent_id: AgentId,
        messages: &[openfang_types::message::Message],
        compaction_threshold: Option<usize>,
    ) -> OpenFangResult<()> {
        self.sessions
            .append_canonical(agent_id, messages, compaction_threshold)?;
        Ok(())
    }

    // -----------------------------------------------------------------
    // Paired devices persistence
    // -----------------------------------------------------------------

    /// Load all paired devices from the database.
    pub fn load_paired_devices(&self) -> OpenFangResult<Vec<serde_json::Value>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT device_id, display_name, platform, paired_at, last_seen, push_token FROM paired_devices"
        ).map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "device_id": row.get::<_, String>(0)?,
                    "display_name": row.get::<_, String>(1)?,
                    "platform": row.get::<_, String>(2)?,
                    "paired_at": row.get::<_, String>(3)?,
                    "last_seen": row.get::<_, String>(4)?,
                    "push_token": row.get::<_, Option<String>>(5)?,
                }))
            })
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let mut devices = Vec::new();
        for row in rows {
            devices.push(row.map_err(|e| OpenFangError::Memory(e.to_string()))?);
        }
        Ok(devices)
    }

    /// Save a paired device to the database (insert or replace).
    pub fn save_paired_device(
        &self,
        device_id: &str,
        display_name: &str,
        platform: &str,
        paired_at: &str,
        last_seen: &str,
        push_token: Option<&str>,
    ) -> OpenFangResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO paired_devices (device_id, display_name, platform, paired_at, last_seen, push_token) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![device_id, display_name, platform, paired_at, last_seen, push_token],
        ).map_err(|e| OpenFangError::Memory(e.to_string()))?;
        Ok(())
    }

    /// Remove a paired device from the database.
    pub fn remove_paired_device(&self, device_id: &str) -> OpenFangResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        conn.execute(
            "DELETE FROM paired_devices WHERE device_id = ?1",
            rusqlite::params![device_id],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        Ok(())
    }

    // -----------------------------------------------------------------
    // Embedding-aware memory operations
    // -----------------------------------------------------------------

    /// Store a memory with an embedding vector.
    pub fn remember_with_embedding(
        &self,
        agent_id: AgentId,
        content: &str,
        source: MemorySource,
        scope: &str,
        metadata: HashMap<String, serde_json::Value>,
        embedding: Option<&[f32]>,
    ) -> OpenFangResult<MemoryId> {
        self.semantic
            .remember_with_embedding(agent_id, content, source, scope, metadata, embedding)
    }

    /// Recall memories using vector similarity when a query embedding is provided.
    pub fn recall_with_embedding(
        &self,
        query: &str,
        limit: usize,
        filter: Option<MemoryFilter>,
        query_embedding: Option<&[f32]>,
    ) -> OpenFangResult<Vec<MemoryFragment>> {
        self.semantic
            .recall_with_embedding(query, limit, filter, query_embedding)
    }

    /// Update the embedding for an existing memory.
    pub fn update_embedding(&self, id: MemoryId, embedding: &[f32]) -> OpenFangResult<()> {
        self.semantic.update_embedding(id, embedding)
    }

    /// Search memories for an agent with typed metadata filters.
    pub async fn search_memories_async(
        &self,
        agent_id: AgentId,
        query: &str,
        limit: usize,
        scope: Option<String>,
        memory_type: Option<String>,
        min_confidence: Option<f32>,
    ) -> OpenFangResult<Vec<MemoryFragment>> {
        let mut filter = MemoryFilter {
            agent_id: Some(agent_id),
            scope,
            min_confidence,
            ..Default::default()
        };
        if let Some(mt) = memory_type {
            filter
                .metadata
                .insert("memory_type".to_string(), serde_json::Value::String(mt));
        }

        self.recall(query, limit, Some(filter)).await
    }

    /// Get a single memory item detail.
    pub async fn get_memory_item_async(
        &self,
        agent_id: AgentId,
        memory_id: MemoryId,
    ) -> OpenFangResult<Option<serde_json::Value>> {
        let conn = Arc::clone(&self.conn);
        let memory_id = memory_id.0.to_string();
        tokio::task::spawn_blocking(move || {
            let db = conn.lock().map_err(|e| OpenFangError::Internal(e.to_string()))?;
            let mut stmt = db
                .prepare(
                    "SELECT id, agent_id, content, source, scope, confidence, metadata, created_at, accessed_at, access_count, memory_type, importance, entity_key, status, supersedes_id, expires_at
                     FROM memories
                     WHERE id = ?1 AND agent_id = ?2 AND deleted = 0
                     LIMIT 1",
                )
                .map_err(|e| OpenFangError::Memory(e.to_string()))?;

            let mut rows = stmt
                .query(rusqlite::params![memory_id, agent_id.0.to_string()])
                .map_err(|e| OpenFangError::Memory(e.to_string()))?;

            if let Some(row) = rows.next().map_err(|e| OpenFangError::Memory(e.to_string()))? {
                let source_str: String = row.get(3).map_err(|e| OpenFangError::Memory(e.to_string()))?;
                let meta_str: String = row.get(6).map_err(|e| OpenFangError::Memory(e.to_string()))?;
                let source_json =
                    serde_json::from_str::<serde_json::Value>(&source_str).unwrap_or(serde_json::json!("system"));
                let metadata_json =
                    serde_json::from_str::<serde_json::Value>(&meta_str).unwrap_or(serde_json::json!({}));

                Ok(Some(serde_json::json!({
                    "id": row.get::<_, String>(0).map_err(|e| OpenFangError::Memory(e.to_string()))?,
                    "agent_id": row.get::<_, String>(1).map_err(|e| OpenFangError::Memory(e.to_string()))?,
                    "content": row.get::<_, String>(2).map_err(|e| OpenFangError::Memory(e.to_string()))?,
                    "source": source_json,
                    "scope": row.get::<_, String>(4).map_err(|e| OpenFangError::Memory(e.to_string()))?,
                    "confidence": row.get::<_, f64>(5).map_err(|e| OpenFangError::Memory(e.to_string()))?,
                    "metadata": metadata_json,
                    "created_at": row.get::<_, String>(7).map_err(|e| OpenFangError::Memory(e.to_string()))?,
                    "accessed_at": row.get::<_, String>(8).map_err(|e| OpenFangError::Memory(e.to_string()))?,
                    "access_count": row.get::<_, i64>(9).map_err(|e| OpenFangError::Memory(e.to_string()))?,
                    "memory_type": row.get::<_, String>(10).map_err(|e| OpenFangError::Memory(e.to_string()))?,
                    "importance": row.get::<_, f64>(11).map_err(|e| OpenFangError::Memory(e.to_string()))?,
                    "entity_key": row.get::<_, Option<String>>(12).map_err(|e| OpenFangError::Memory(e.to_string()))?,
                    "status": row
                        .get::<_, Option<String>>(13)
                        .map_err(|e| OpenFangError::Memory(e.to_string()))?
                        .unwrap_or_else(|| "active".to_string()),
                    "supersedes_id": row.get::<_, Option<String>>(14).map_err(|e| OpenFangError::Memory(e.to_string()))?,
                    "expires_at": row.get::<_, Option<String>>(15).map_err(|e| OpenFangError::Memory(e.to_string()))?,
                })))
            } else {
                Ok(None)
            }
        })
        .await
        .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    /// Apply feedback to a memory item.
    ///
    /// Returns corrected memory ID when action=correct, otherwise None.
    pub async fn feedback_memory_async(
        &self,
        agent_id: AgentId,
        memory_id: MemoryId,
        action: &str,
        reason: Option<String>,
        corrected_content: Option<String>,
    ) -> OpenFangResult<Option<String>> {
        let conn = Arc::clone(&self.conn);
        let action = action.to_lowercase();
        let memory_id_str = memory_id.0.to_string();
        tokio::task::spawn_blocking(move || {
            let now = chrono::Utc::now().to_rfc3339();
            let db = conn.lock().map_err(|e| OpenFangError::Internal(e.to_string()))?;

            let exists = db
                .query_row(
                    "SELECT 1 FROM memories WHERE id = ?1 AND agent_id = ?2 LIMIT 1",
                    rusqlite::params![memory_id_str, agent_id.0.to_string()],
                    |_row| Ok(()),
                )
                .is_ok();
            if !exists {
                return Err(OpenFangError::Memory("Memory not found".to_string()));
            }

            let mut corrected_id: Option<String> = None;

            match action.as_str() {
                "confirm" => {
                    db.execute(
                        "UPDATE memories
                         SET confidence = MIN(1.0, confidence + 0.1),
                             accessed_at = ?3,
                             access_count = access_count + 1
                         WHERE id = ?1 AND agent_id = ?2",
                        rusqlite::params![memory_id_str, agent_id.0.to_string(), now],
                    )
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?;
                }
                "weaken" => {
                    db.execute(
                        "UPDATE memories
                         SET confidence = MAX(0.0, confidence - 0.15)
                         WHERE id = ?1 AND agent_id = ?2",
                        rusqlite::params![memory_id_str, agent_id.0.to_string()],
                    )
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?;
                }
                "outdated" => {
                    db.execute(
                        "UPDATE memories SET status = 'superseded' WHERE id = ?1 AND agent_id = ?2",
                        rusqlite::params![memory_id_str, agent_id.0.to_string()],
                    )
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?;
                }
                "revoke" | "delete" | "reject" => {
                    db.execute(
                        "UPDATE memories
                         SET status = 'revoked', deleted = 1
                         WHERE id = ?1 AND agent_id = ?2",
                        rusqlite::params![memory_id_str, agent_id.0.to_string()],
                    )
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?;
                }
                "correct" => {
                    let corrected = corrected_content
                        .as_ref()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .ok_or_else(|| {
                            OpenFangError::InvalidInput(
                                "corrected_content is required for action=correct".to_string(),
                            )
                        })?;

                    let (
                        source,
                        scope,
                        old_confidence,
                        metadata_str,
                        memory_type,
                        importance,
                        entity_key,
                        expires_at,
                    ) = db
                        .query_row(
                            "SELECT source, scope, confidence, metadata, memory_type, importance, entity_key, expires_at
                             FROM memories WHERE id = ?1 AND agent_id = ?2 LIMIT 1",
                            rusqlite::params![memory_id_str, agent_id.0.to_string()],
                            |row| {
                                Ok((
                                    row.get::<_, String>(0)?,
                                    row.get::<_, String>(1)?,
                                    row.get::<_, f64>(2)?,
                                    row.get::<_, String>(3)?,
                                    row.get::<_, String>(4)?,
                                    row.get::<_, f64>(5)?,
                                    row.get::<_, Option<String>>(6)?,
                                    row.get::<_, Option<String>>(7)?,
                                ))
                            },
                        )
                        .map_err(|e| OpenFangError::Memory(e.to_string()))?;

                    let new_id = uuid::Uuid::new_v4().to_string();
                    let mut meta_json: serde_json::Value = serde_json::from_str(&metadata_str)
                        .unwrap_or_else(|_| serde_json::json!({}));
                    if let Some(obj) = meta_json.as_object_mut() {
                        obj.insert(
                            "corrected_from".to_string(),
                            serde_json::Value::String(memory_id_str.clone()),
                        );
                        if let Some(r) = reason.clone() {
                            obj.insert("correction_reason".to_string(), serde_json::Value::String(r));
                        }
                    }
                    let meta_new =
                        serde_json::to_string(&meta_json).unwrap_or_else(|_| "{}".to_string());
                    let conf_new = (old_confidence + 0.05).clamp(0.0, 1.0);

                    db.execute(
                        "INSERT INTO memories (
                            id, agent_id, content, source, scope, confidence, metadata,
                            created_at, accessed_at, access_count, deleted, embedding,
                            memory_type, importance, entity_key, status, supersedes_id, expires_at
                         ) VALUES (
                            ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                            ?8, ?8, 0, 0, NULL,
                            ?9, ?10, ?11, 'active', ?12, ?13
                         )",
                        rusqlite::params![
                            new_id,
                            agent_id.0.to_string(),
                            corrected,
                            source,
                            scope,
                            conf_new,
                            meta_new,
                            now,
                            memory_type,
                            importance,
                            entity_key,
                            memory_id_str,
                            expires_at,
                        ],
                    )
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?;

                    db.execute(
                        "UPDATE memories SET status = 'superseded' WHERE id = ?1 AND agent_id = ?2",
                        rusqlite::params![memory_id_str, agent_id.0.to_string()],
                    )
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?;
                    corrected_id = Some(new_id);
                }
                _ => {
                    return Err(OpenFangError::InvalidInput(format!(
                        "Unsupported feedback action: {action}"
                    )));
                }
            }

            let payload = serde_json::json!({
                "corrected_memory_id": corrected_id,
            })
            .to_string();
            db.execute(
                "INSERT INTO memory_feedback_events (id, agent_id, memory_id, action, reason, payload, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    uuid::Uuid::new_v4().to_string(),
                    agent_id.0.to_string(),
                    memory_id_str,
                    action,
                    reason,
                    payload,
                    now,
                ],
            )
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;

            Ok(corrected_id)
        })
        .await
        .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    /// Async wrapper for `recall_with_embedding` — runs in a blocking thread.
    pub async fn recall_with_embedding_async(
        &self,
        query: &str,
        limit: usize,
        filter: Option<MemoryFilter>,
        query_embedding: Option<&[f32]>,
    ) -> OpenFangResult<Vec<MemoryFragment>> {
        let store = self.semantic.clone();
        let query = query.to_string();
        let embedding_owned = query_embedding.map(|e| e.to_vec());
        tokio::task::spawn_blocking(move || {
            store.recall_with_embedding(&query, limit, filter, embedding_owned.as_deref())
        })
        .await
        .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    /// Async wrapper for `remember_with_embedding` — runs in a blocking thread.
    pub async fn remember_with_embedding_async(
        &self,
        agent_id: AgentId,
        content: &str,
        source: MemorySource,
        scope: &str,
        metadata: HashMap<String, serde_json::Value>,
        embedding: Option<&[f32]>,
    ) -> OpenFangResult<MemoryId> {
        let store = self.semantic.clone();
        let content = content.to_string();
        let scope = scope.to_string();
        let embedding_owned = embedding.map(|e| e.to_vec());
        tokio::task::spawn_blocking(move || {
            store.remember_with_embedding(
                agent_id,
                &content,
                source,
                &scope,
                metadata,
                embedding_owned.as_deref(),
            )
        })
        .await
        .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    /// Persist a structured memory event for unified multi-subject memory orchestration.
    pub async fn append_memory_event_async(
        &self,
        event_type: &str,
        content: &str,
        conversation_id: &str,
        metadata: HashMap<String, serde_json::Value>,
    ) -> OpenFangResult<String> {
        let conn = Arc::clone(&self.conn);
        let event_type = event_type.to_string();
        let content = content.to_string();
        let conversation_id = conversation_id.to_string();
        tokio::task::spawn_blocking(move || {
            let event_id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let db = conn.lock().map_err(|e| OpenFangError::Internal(e.to_string()))?;
            let metadata_str = serde_json::to_string(&metadata)
                .map_err(|e| OpenFangError::Serialization(e.to_string()))?;
            let group_id = metadata
                .get("group_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_string();
            let task_id = metadata
                .get("task_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_string();
            let source_agent_id = metadata
                .get("source_agent_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_string();
            let target_agent_id = metadata
                .get("target_agent_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_string();
            let speaker_agent_id = metadata
                .get("speaker_agent_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_string();
            let speaker_user_id = metadata
                .get("speaker_user_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_string();
            let participant_ids = metadata
                .get("participant_ids")
                .cloned()
                .unwrap_or_else(|| serde_json::Value::Array(Vec::new()))
                .to_string();
            let reply_to_event_id = metadata
                .get("reply_to_event_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_string();
            let tool_use_id = metadata
                .get("tool_use_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_string();
            let delegation_depth = metadata
                .get("delegation_depth")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(0);

            db.execute(
                "INSERT INTO memory_events (
                    event_id, event_type, content, conversation_id, group_id, task_id,
                    source_agent_id, target_agent_id, speaker_agent_id, speaker_user_id,
                    participant_ids, reply_to_event_id, tool_use_id, delegation_depth, metadata, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                rusqlite::params![
                    event_id,
                    event_type,
                    content,
                    conversation_id,
                    group_id,
                    task_id,
                    source_agent_id,
                    target_agent_id,
                    speaker_agent_id,
                    speaker_user_id,
                    participant_ids,
                    reply_to_event_id,
                    tool_use_id,
                    delegation_depth,
                    metadata_str,
                    now,
                ],
            )
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
            Ok(event_id)
        })
        .await
        .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    /// Persist a subject projection for a memory event.
    pub async fn append_memory_projection_async(
        &self,
        subject_type: &str,
        subject_id: &str,
        event_id: &str,
        projection_role: &str,
        metadata: HashMap<String, serde_json::Value>,
    ) -> OpenFangResult<String> {
        let conn = Arc::clone(&self.conn);
        let subject_type = subject_type.to_string();
        let subject_id = subject_id.to_string();
        let event_id = event_id.to_string();
        let projection_role = projection_role.to_string();
        tokio::task::spawn_blocking(move || {
            let projection_id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let db = conn.lock().map_err(|e| OpenFangError::Internal(e.to_string()))?;
            let metadata_str = serde_json::to_string(&metadata)
                .map_err(|e| OpenFangError::Serialization(e.to_string()))?;
            db.execute(
                "INSERT INTO memory_projections (
                    projection_id, subject_type, subject_id, event_id, projection_role, metadata, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    projection_id,
                    subject_type,
                    subject_id,
                    event_id,
                    projection_role,
                    metadata_str,
                    now,
                ],
            )
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
            Ok(projection_id)
        })
        .await
        .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    /// List recent projected events for a subject.
    pub async fn list_projected_events_async(
        &self,
        subject_type: &str,
        subject_id: &str,
        limit: usize,
    ) -> OpenFangResult<Vec<serde_json::Value>> {
        let conn = Arc::clone(&self.conn);
        let subject_type = subject_type.to_string();
        let subject_id = subject_id.to_string();
        tokio::task::spawn_blocking(move || {
            let db = conn
                .lock()
                .map_err(|e| OpenFangError::Internal(e.to_string()))?;
            let mut stmt = db
                .prepare(
                    "SELECT
                    p.projection_id,
                    p.subject_type,
                    p.subject_id,
                    p.projection_role,
                    p.metadata,
                    e.event_id,
                    e.event_type,
                    e.content,
                    e.conversation_id,
                    e.group_id,
                    e.task_id,
                    e.source_agent_id,
                    e.target_agent_id,
                    e.speaker_agent_id,
                    e.speaker_user_id,
                    e.participant_ids,
                    e.metadata,
                    e.created_at
                 FROM memory_projections p
                 JOIN memory_events e ON e.event_id = p.event_id
                 WHERE p.subject_type = ?1 AND p.subject_id = ?2
                 ORDER BY e.created_at DESC
                 LIMIT ?3",
                )
                .map_err(|e| OpenFangError::Memory(e.to_string()))?;

            let rows = stmt
                .query_map(
                    rusqlite::params![subject_type, subject_id, limit as i64],
                    |row| {
                        let projection_metadata_raw = row.get::<_, String>(4)?;
                        let event_metadata_raw = row.get::<_, String>(16)?;
                        let participant_ids_raw = row.get::<_, String>(15)?;
                        let projection_metadata: serde_json::Value =
                            serde_json::from_str(&projection_metadata_raw)
                                .unwrap_or_else(|_| serde_json::Value::Object(Default::default()));
                        let event_metadata: serde_json::Value =
                            serde_json::from_str(&event_metadata_raw)
                                .unwrap_or_else(|_| serde_json::Value::Object(Default::default()));
                        let participant_ids: serde_json::Value =
                            serde_json::from_str(&participant_ids_raw)
                                .unwrap_or_else(|_| serde_json::Value::Array(Vec::new()));
                        Ok(serde_json::json!({
                            "kind": "projected_event",
                            "projection_id": row.get::<_, String>(0)?,
                            "subject_type": row.get::<_, String>(1)?,
                            "subject_id": row.get::<_, String>(2)?,
                            "projection_role": row.get::<_, String>(3)?,
                            "projection_metadata": projection_metadata,
                            "event_id": row.get::<_, String>(5)?,
                            "event_type": row.get::<_, String>(6)?,
                            "content": row.get::<_, String>(7)?,
                            "conversation_id": row.get::<_, String>(8)?,
                            "group_id": row.get::<_, String>(9)?,
                            "task_id": row.get::<_, String>(10)?,
                            "source_agent_id": row.get::<_, String>(11)?,
                            "target_agent_id": row.get::<_, String>(12)?,
                            "speaker_agent_id": row.get::<_, String>(13)?,
                            "speaker_user_id": row.get::<_, String>(14)?,
                            "participant_ids": participant_ids,
                            "event_metadata": event_metadata,
                            "created_at": row.get::<_, String>(17)?,
                        }))
                    },
                )
                .map_err(|e| OpenFangError::Memory(e.to_string()))?;

            let mut items = Vec::new();
            for row in rows {
                items.push(row.map_err(|e| OpenFangError::Memory(e.to_string()))?);
            }
            Ok(items)
        })
        .await
        .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    // -----------------------------------------------------------------
    // Task queue operations
    // -----------------------------------------------------------------

    /// Post a new task to the shared queue. Returns the task ID.
    pub async fn task_post(
        &self,
        title: &str,
        description: &str,
        assigned_to: Option<&str>,
        created_by: Option<&str>,
    ) -> OpenFangResult<String> {
        let conn = Arc::clone(&self.conn);
        let title = title.to_string();
        let description = description.to_string();
        let assigned_to = assigned_to.unwrap_or("").to_string();
        let created_by = created_by.unwrap_or("").to_string();

        tokio::task::spawn_blocking(move || {
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let db = conn.lock().map_err(|e| OpenFangError::Internal(e.to_string()))?;
            db.execute(
                "INSERT INTO task_queue (id, agent_id, task_type, payload, status, priority, created_at, title, description, assigned_to, created_by)
                 VALUES (?1, ?2, ?3, ?4, 'pending', 0, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![id, &created_by, &title, b"", now, title, description, assigned_to, created_by],
            )
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
            Ok(id)
        })
        .await
        .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    /// Claim the next pending task (optionally for a specific assignee). Returns task JSON or None.
    pub async fn task_claim(&self, agent_id: &str) -> OpenFangResult<Option<serde_json::Value>> {
        let conn = Arc::clone(&self.conn);
        let agent_id = agent_id.to_string();

        tokio::task::spawn_blocking(move || {
            let db = conn.lock().map_err(|e| OpenFangError::Internal(e.to_string()))?;
            // Find first pending task assigned to this agent, or any unassigned pending task
            let mut stmt = db.prepare(
                "SELECT id, title, description, assigned_to, created_by, created_at
                 FROM task_queue
                 WHERE status = 'pending' AND (assigned_to = ?1 OR assigned_to = '')
                 ORDER BY priority DESC, created_at ASC
                 LIMIT 1"
            ).map_err(|e| OpenFangError::Memory(e.to_string()))?;

            let result = stmt.query_row(rusqlite::params![agent_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            });

            match result {
                Ok((id, title, description, assigned, created_by, created_at)) => {
                    // Update status to in_progress
                    db.execute(
                        "UPDATE task_queue SET status = 'in_progress', assigned_to = ?2 WHERE id = ?1",
                        rusqlite::params![id, agent_id],
                    ).map_err(|e| OpenFangError::Memory(e.to_string()))?;

                    Ok(Some(serde_json::json!({
                        "id": id,
                        "title": title,
                        "description": description,
                        "status": "in_progress",
                        "assigned_to": if assigned.is_empty() { &agent_id } else { &assigned },
                        "created_by": created_by,
                        "created_at": created_at,
                    })))
                }
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(OpenFangError::Memory(e.to_string())),
            }
        })
        .await
        .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    /// Mark a task as completed with a result string.
    pub async fn task_complete(&self, task_id: &str, result: &str) -> OpenFangResult<()> {
        let conn = Arc::clone(&self.conn);
        let task_id = task_id.to_string();
        let result = result.to_string();

        tokio::task::spawn_blocking(move || {
            let now = chrono::Utc::now().to_rfc3339();
            let db = conn.lock().map_err(|e| OpenFangError::Internal(e.to_string()))?;
            let rows = db.execute(
                "UPDATE task_queue SET status = 'completed', result = ?2, completed_at = ?3 WHERE id = ?1",
                rusqlite::params![task_id, result, now],
            ).map_err(|e| OpenFangError::Memory(e.to_string()))?;
            if rows == 0 {
                return Err(OpenFangError::Internal(format!("Task not found: {task_id}")));
            }
            Ok(())
        })
        .await
        .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    /// List tasks, optionally filtered by status.
    pub async fn task_list(&self, status: Option<&str>) -> OpenFangResult<Vec<serde_json::Value>> {
        let conn = Arc::clone(&self.conn);
        let status = status.map(|s| s.to_string());

        tokio::task::spawn_blocking(move || {
            let db = conn.lock().map_err(|e| OpenFangError::Internal(e.to_string()))?;
            let (sql, params): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = match &status {
                Some(s) => (
                    "SELECT id, title, description, status, assigned_to, created_by, created_at, completed_at, result FROM task_queue WHERE status = ?1 ORDER BY created_at DESC",
                    vec![Box::new(s.clone())],
                ),
                None => (
                    "SELECT id, title, description, status, assigned_to, created_by, created_at, completed_at, result FROM task_queue ORDER BY created_at DESC",
                    vec![],
                ),
            };

            let mut stmt = db.prepare(sql).map_err(|e| OpenFangError::Memory(e.to_string()))?;
            let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
            let rows = stmt.query_map(params_refs.as_slice(), |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1).unwrap_or_default(),
                    "description": row.get::<_, String>(2).unwrap_or_default(),
                    "status": row.get::<_, String>(3)?,
                    "assigned_to": row.get::<_, String>(4).unwrap_or_default(),
                    "created_by": row.get::<_, String>(5).unwrap_or_default(),
                    "created_at": row.get::<_, String>(6).unwrap_or_default(),
                    "completed_at": row.get::<_, Option<String>>(7).unwrap_or(None),
                    "result": row.get::<_, Option<String>>(8).unwrap_or(None),
                }))
            }).map_err(|e| OpenFangError::Memory(e.to_string()))?;

            let mut tasks = Vec::new();
            for row in rows {
                tasks.push(row.map_err(|e| OpenFangError::Memory(e.to_string()))?);
            }
            Ok(tasks)
        })
        .await
        .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }
}

#[async_trait]
impl Memory for MemorySubstrate {
    async fn get(&self, agent_id: AgentId, key: &str) -> OpenFangResult<Option<serde_json::Value>> {
        let store = self.structured.clone();
        let key = key.to_string();
        tokio::task::spawn_blocking(move || store.get(agent_id, &key))
            .await
            .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    async fn set(
        &self,
        agent_id: AgentId,
        key: &str,
        value: serde_json::Value,
    ) -> OpenFangResult<()> {
        let store = self.structured.clone();
        let key = key.to_string();
        tokio::task::spawn_blocking(move || store.set(agent_id, &key, value))
            .await
            .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    async fn delete(&self, agent_id: AgentId, key: &str) -> OpenFangResult<()> {
        let store = self.structured.clone();
        let key = key.to_string();
        tokio::task::spawn_blocking(move || store.delete(agent_id, &key))
            .await
            .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    async fn remember(
        &self,
        agent_id: AgentId,
        content: &str,
        source: MemorySource,
        scope: &str,
        metadata: HashMap<String, serde_json::Value>,
    ) -> OpenFangResult<MemoryId> {
        let store = self.semantic.clone();
        let content = content.to_string();
        let scope = scope.to_string();
        tokio::task::spawn_blocking(move || {
            store.remember(agent_id, &content, source, &scope, metadata)
        })
        .await
        .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    async fn recall(
        &self,
        query: &str,
        limit: usize,
        filter: Option<MemoryFilter>,
    ) -> OpenFangResult<Vec<MemoryFragment>> {
        let store = self.semantic.clone();
        let query = query.to_string();
        tokio::task::spawn_blocking(move || store.recall(&query, limit, filter))
            .await
            .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    async fn forget(&self, id: MemoryId) -> OpenFangResult<()> {
        let store = self.semantic.clone();
        tokio::task::spawn_blocking(move || store.forget(id))
            .await
            .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    async fn add_entity(&self, entity: Entity) -> OpenFangResult<String> {
        let store = self.knowledge.clone();
        tokio::task::spawn_blocking(move || store.add_entity(entity))
            .await
            .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    async fn add_relation(&self, relation: Relation) -> OpenFangResult<String> {
        let store = self.knowledge.clone();
        tokio::task::spawn_blocking(move || store.add_relation(relation))
            .await
            .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    async fn query_graph(&self, pattern: GraphPattern) -> OpenFangResult<Vec<GraphMatch>> {
        let store = self.knowledge.clone();
        tokio::task::spawn_blocking(move || store.query_graph(pattern))
            .await
            .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    async fn consolidate(&self) -> OpenFangResult<ConsolidationReport> {
        let engine = self.consolidation.clone();
        tokio::task::spawn_blocking(move || engine.consolidate())
            .await
            .map_err(|e| OpenFangError::Internal(e.to_string()))?
    }

    async fn export(&self, format: ExportFormat) -> OpenFangResult<Vec<u8>> {
        let _ = format;
        Ok(Vec::new())
    }

    async fn import(&self, _data: &[u8], _format: ExportFormat) -> OpenFangResult<ImportReport> {
        Ok(ImportReport {
            entities_imported: 0,
            relations_imported: 0,
            memories_imported: 0,
            errors: vec!["Import not yet implemented in Phase 1".to_string()],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_substrate_kv() {
        let substrate = MemorySubstrate::open_in_memory(0.1).unwrap();
        let agent_id = AgentId::new();
        substrate
            .set(agent_id, "key", serde_json::json!("value"))
            .await
            .unwrap();
        let val = substrate.get(agent_id, "key").await.unwrap();
        assert_eq!(val, Some(serde_json::json!("value")));
    }

    #[tokio::test]
    async fn test_substrate_remember_recall() {
        let substrate = MemorySubstrate::open_in_memory(0.1).unwrap();
        let agent_id = AgentId::new();
        substrate
            .remember(
                agent_id,
                "Rust is a great language",
                MemorySource::Conversation,
                "episodic",
                HashMap::new(),
            )
            .await
            .unwrap();
        let results = substrate.recall("Rust", 10, None).await.unwrap();
        assert_eq!(results.len(), 1);
    }

    #[tokio::test]
    async fn test_task_post_and_list() {
        let substrate = MemorySubstrate::open_in_memory(0.1).unwrap();
        let id = substrate
            .task_post(
                "Review code",
                "Check the auth module for issues",
                Some("auditor"),
                Some("orchestrator"),
            )
            .await
            .unwrap();
        assert!(!id.is_empty());

        let tasks = substrate.task_list(Some("pending")).await.unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["title"], "Review code");
        assert_eq!(tasks[0]["assigned_to"], "auditor");
        assert_eq!(tasks[0]["status"], "pending");
    }

    #[tokio::test]
    async fn test_task_claim_and_complete() {
        let substrate = MemorySubstrate::open_in_memory(0.1).unwrap();
        let task_id = substrate
            .task_post(
                "Audit endpoint",
                "Security audit the /api/login endpoint",
                Some("auditor"),
                None,
            )
            .await
            .unwrap();

        // Claim the task
        let claimed = substrate.task_claim("auditor").await.unwrap();
        assert!(claimed.is_some());
        let claimed = claimed.unwrap();
        assert_eq!(claimed["id"], task_id);
        assert_eq!(claimed["status"], "in_progress");

        // Complete the task
        substrate
            .task_complete(&task_id, "No vulnerabilities found")
            .await
            .unwrap();

        // Verify it shows as completed
        let tasks = substrate.task_list(Some("completed")).await.unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["result"], "No vulnerabilities found");
    }

    #[tokio::test]
    async fn test_task_claim_empty() {
        let substrate = MemorySubstrate::open_in_memory(0.1).unwrap();
        let claimed = substrate.task_claim("nobody").await.unwrap();
        assert!(claimed.is_none());
    }

    #[tokio::test]
    async fn test_memory_feedback_flow() {
        let substrate = MemorySubstrate::open_in_memory(0.1).unwrap();
        let agent_id = AgentId::new();
        let mut metadata = HashMap::new();
        metadata.insert(
            "memory_type".to_string(),
            serde_json::Value::String("preference".to_string()),
        );
        metadata.insert(
            "entity_key".to_string(),
            serde_json::Value::String("user.preference.language".to_string()),
        );
        let id = substrate
            .remember(
                agent_id,
                "用户偏好语言是英文",
                MemorySource::Conversation,
                "long_term",
                metadata,
            )
            .await
            .unwrap();

        // Confirm should increase confidence.
        let _ = substrate
            .feedback_memory_async(agent_id, id, "confirm", None, None)
            .await
            .unwrap();
        let item = substrate
            .get_memory_item_async(agent_id, id)
            .await
            .unwrap()
            .unwrap();
        let conf = item["confidence"].as_f64().unwrap_or(0.0);
        assert!(conf >= 1.0);

        // Correct should create replacement and supersede old memory.
        let corrected_id = substrate
            .feedback_memory_async(
                agent_id,
                id,
                "correct",
                Some("用户更新偏好".to_string()),
                Some("用户偏好语言是中文".to_string()),
            )
            .await
            .unwrap()
            .unwrap();
        let corrected_uuid = uuid::Uuid::parse_str(&corrected_id).map(MemoryId).unwrap();
        let corrected_item = substrate
            .get_memory_item_async(agent_id, corrected_uuid)
            .await
            .unwrap()
            .unwrap();
        assert!(corrected_item["content"]
            .as_str()
            .unwrap_or("")
            .contains("中文"));

        let recalls = substrate
            .search_memories_async(
                agent_id,
                "语言",
                10,
                None,
                Some("preference".to_string()),
                None,
            )
            .await
            .unwrap();
        assert_eq!(recalls.len(), 1);
        assert!(recalls[0].content.contains("中文"));
    }
}
