use openfang_types::error::{OpenFangError, OpenFangResult};
use openfang_types::tasks::{
    ManagedTaskCapabilities, ManagedTaskDelivery, ManagedTaskDeliveryAttempt,
    ManagedTaskDeliveryStats, ManagedTaskDeliveryStatus, ManagedTaskDetail, ManagedTaskEvent,
    ManagedTaskFinalSummary, ManagedTaskRuntime, ManagedTaskSpec, ManagedTaskTimelineEntry,
};
use rusqlite::Connection;
use std::sync::{Arc, Mutex};

type DeliveryRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    Option<String>,
);

type DeliveryAttemptRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    Option<String>,
);

pub struct TaskCenterStore {
    conn: Arc<Mutex<Connection>>,
}

impl TaskCenterStore {
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    pub fn create_task(
        &self,
        spec: &ManagedTaskSpec,
        runtime: &ManagedTaskRuntime,
    ) -> OpenFangResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let spec_json =
            serde_json::to_string(spec).map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let runtime_json =
            serde_json::to_string(runtime).map_err(|e| OpenFangError::Memory(e.to_string()))?;
        conn.execute(
            "INSERT INTO managed_tasks (
                id, agent_id, name, source_type, origin_chat_session_id, origin_message_id,
                cron_job_id, spec_json, runtime_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                spec.id,
                spec.agent_id,
                spec.name,
                serde_json::to_string(&spec.source_type)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                spec.binding
                    .origin_chat_session_id
                    .clone()
                    .unwrap_or_default(),
                spec.binding.origin_message_id.clone().unwrap_or_default(),
                spec.cron_job_id.clone().unwrap_or_default(),
                spec_json,
                runtime_json,
                spec.created_at,
                spec.updated_at,
            ],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        Ok(())
    }

    pub fn update_task(
        &self,
        spec: &ManagedTaskSpec,
        runtime: &ManagedTaskRuntime,
    ) -> OpenFangResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let spec_json =
            serde_json::to_string(spec).map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let runtime_json =
            serde_json::to_string(runtime).map_err(|e| OpenFangError::Memory(e.to_string()))?;
        conn.execute(
            "UPDATE managed_tasks
             SET agent_id = ?2,
                 name = ?3,
                 source_type = ?4,
                 origin_chat_session_id = ?5,
                 origin_message_id = ?6,
                 cron_job_id = ?7,
                 spec_json = ?8,
                 runtime_json = ?9,
                 updated_at = ?10
             WHERE id = ?1",
            rusqlite::params![
                spec.id,
                spec.agent_id,
                spec.name,
                serde_json::to_string(&spec.source_type)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                spec.binding
                    .origin_chat_session_id
                    .clone()
                    .unwrap_or_default(),
                spec.binding.origin_message_id.clone().unwrap_or_default(),
                spec.cron_job_id.clone().unwrap_or_default(),
                spec_json,
                runtime_json,
                spec.updated_at,
            ],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        Ok(())
    }

    pub fn get_task(&self, task_id: &str) -> OpenFangResult<Option<ManagedTaskDetail>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let mut stmt = conn
            .prepare("SELECT spec_json, runtime_json FROM managed_tasks WHERE id = ?1")
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let result = stmt.query_row(rusqlite::params![task_id], |row| {
            let spec_json: String = row.get(0)?;
            let runtime_json: String = row.get(1)?;
            Ok((spec_json, runtime_json))
        });
        match result {
            Ok((spec_json, runtime_json)) => {
                let spec = serde_json::from_str::<ManagedTaskSpec>(&spec_json)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?;
                let runtime = serde_json::from_str::<ManagedTaskRuntime>(&runtime_json)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?;
                Ok(Some(ManagedTaskDetail {
                    spec,
                    runtime,
                    final_summary: None::<ManagedTaskFinalSummary>,
                    delivery_stats: ManagedTaskDeliveryStats::default(),
                    capabilities: ManagedTaskCapabilities::default(),
                    timeline: Vec::<ManagedTaskTimelineEntry>::new(),
                }))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(OpenFangError::Memory(e.to_string())),
        }
    }

    pub fn list_tasks(&self, agent_id: Option<&str>) -> OpenFangResult<Vec<ManagedTaskDetail>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let mut items = Vec::new();
        if let Some(agent_id) = agent_id {
            let mut stmt = conn
                .prepare(
                    "SELECT spec_json, runtime_json FROM managed_tasks WHERE agent_id = ?1 ORDER BY updated_at DESC",
                )
                .map_err(|e| OpenFangError::Memory(e.to_string()))?;
            let rows = stmt
                .query_map(rusqlite::params![agent_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| OpenFangError::Memory(e.to_string()))?;
            for row in rows {
                let (spec_json, runtime_json) =
                    row.map_err(|e| OpenFangError::Memory(e.to_string()))?;
                let spec = serde_json::from_str::<ManagedTaskSpec>(&spec_json)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?;
                let runtime = serde_json::from_str::<ManagedTaskRuntime>(&runtime_json)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?;
                items.push(ManagedTaskDetail {
                    spec,
                    runtime,
                    final_summary: None::<ManagedTaskFinalSummary>,
                    delivery_stats: ManagedTaskDeliveryStats::default(),
                    capabilities: ManagedTaskCapabilities::default(),
                    timeline: Vec::<ManagedTaskTimelineEntry>::new(),
                });
            }
        } else {
            let mut stmt = conn
                .prepare(
                    "SELECT spec_json, runtime_json FROM managed_tasks ORDER BY updated_at DESC",
                )
                .map_err(|e| OpenFangError::Memory(e.to_string()))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| OpenFangError::Memory(e.to_string()))?;
            for row in rows {
                let (spec_json, runtime_json) =
                    row.map_err(|e| OpenFangError::Memory(e.to_string()))?;
                let spec = serde_json::from_str::<ManagedTaskSpec>(&spec_json)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?;
                let runtime = serde_json::from_str::<ManagedTaskRuntime>(&runtime_json)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?;
                items.push(ManagedTaskDetail {
                    spec,
                    runtime,
                    final_summary: None::<ManagedTaskFinalSummary>,
                    delivery_stats: ManagedTaskDeliveryStats::default(),
                    capabilities: ManagedTaskCapabilities::default(),
                    timeline: Vec::<ManagedTaskTimelineEntry>::new(),
                });
            }
        }
        Ok(items)
    }

    pub fn find_task_by_cron_job_id(
        &self,
        cron_job_id: &str,
    ) -> OpenFangResult<Option<ManagedTaskDetail>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                "SELECT spec_json, runtime_json FROM managed_tasks WHERE cron_job_id = ?1 LIMIT 1",
            )
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let result = stmt.query_row(rusqlite::params![cron_job_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        });
        match result {
            Ok((spec_json, runtime_json)) => {
                let spec = serde_json::from_str::<ManagedTaskSpec>(&spec_json)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?;
                let runtime = serde_json::from_str::<ManagedTaskRuntime>(&runtime_json)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?;
                Ok(Some(ManagedTaskDetail {
                    spec,
                    runtime,
                    final_summary: None::<ManagedTaskFinalSummary>,
                    delivery_stats: ManagedTaskDeliveryStats::default(),
                    capabilities: ManagedTaskCapabilities::default(),
                    timeline: Vec::<ManagedTaskTimelineEntry>::new(),
                }))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(OpenFangError::Memory(e.to_string())),
        }
    }

    pub fn delete_task(&self, task_id: &str) -> OpenFangResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        conn.execute(
            "DELETE FROM managed_task_runs WHERE task_id = ?1",
            rusqlite::params![task_id],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        conn.execute(
            "DELETE FROM managed_task_events WHERE task_id = ?1",
            rusqlite::params![task_id],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        conn.execute(
            "DELETE FROM managed_task_deliveries WHERE task_id = ?1",
            rusqlite::params![task_id],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        conn.execute(
            "DELETE FROM managed_task_delivery_attempts WHERE task_id = ?1",
            rusqlite::params![task_id],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        conn.execute(
            "DELETE FROM managed_tasks WHERE id = ?1",
            rusqlite::params![task_id],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        Ok(())
    }

    pub fn append_run(&self, run: &openfang_types::tasks::ManagedTaskRun) -> OpenFangResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let run_json =
            serde_json::to_string(run).map_err(|e| OpenFangError::Memory(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO managed_task_runs (id, task_id, run_no, run_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                run.id,
                run.task_id,
                run.run_no as i64,
                run_json,
                run.start_time
            ],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        Ok(())
    }

    pub fn list_runs(
        &self,
        task_id: &str,
    ) -> OpenFangResult<Vec<openfang_types::tasks::ManagedTaskRun>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                "SELECT run_json FROM managed_task_runs WHERE task_id = ?1 ORDER BY run_no DESC",
            )
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let rows = stmt
            .query_map(rusqlite::params![task_id], |row| row.get::<_, String>(0))
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let mut items = Vec::new();
        for row in rows {
            let raw = row.map_err(|e| OpenFangError::Memory(e.to_string()))?;
            items.push(
                serde_json::from_str::<openfang_types::tasks::ManagedTaskRun>(&raw)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?,
            );
        }
        Ok(items)
    }

    pub fn append_event(&self, event: &ManagedTaskEvent) -> OpenFangResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let payload_json = serde_json::to_string(&event.payload)
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO managed_task_events (id, task_id, run_id, event_type, summary, payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                event.id,
                event.task_id,
                event.run_id.clone().unwrap_or_default(),
                serde_json::to_string(&event.event_type)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                event.summary,
                payload_json,
                event.created_at,
            ],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        Ok(())
    }

    pub fn list_events(&self, task_id: &str) -> OpenFangResult<Vec<ManagedTaskEvent>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let mut stmt = conn
            .prepare("SELECT id, run_id, event_type, summary, payload_json, created_at FROM managed_task_events WHERE task_id = ?1 ORDER BY created_at DESC")
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let rows = stmt
            .query_map(rusqlite::params![task_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let mut items = Vec::new();
        for row in rows {
            let (id, run_id_raw, event_type_raw, summary, payload_json, created_at) =
                row.map_err(|e| OpenFangError::Memory(e.to_string()))?;
            items.push(ManagedTaskEvent {
                id,
                task_id: task_id.to_string(),
                run_id: if run_id_raw.trim().is_empty() {
                    None
                } else {
                    Some(run_id_raw)
                },
                event_type: serde_json::from_str(&event_type_raw)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                summary,
                payload: serde_json::from_str(&payload_json)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                created_at,
            });
        }
        Ok(items)
    }

    pub fn append_delivery(&self, delivery: &ManagedTaskDelivery) -> OpenFangResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let payload_json = serde_json::to_string(&delivery.payload)
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO managed_task_deliveries (
                id, task_id, run_id, event_id, target_kind, status, origin_chat_session_id,
                origin_message_id, title, body, payload_json, created_at, updated_at, delivered_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![
                delivery.id,
                delivery.task_id,
                delivery.run_id.clone().unwrap_or_default(),
                delivery.event_id.clone().unwrap_or_default(),
                serde_json::to_string(&delivery.target_kind)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                serde_json::to_string(&delivery.status)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                delivery.origin_chat_session_id.clone().unwrap_or_default(),
                delivery.origin_message_id.clone().unwrap_or_default(),
                delivery.title,
                delivery.body,
                payload_json,
                delivery.created_at,
                delivery.updated_at,
                delivery.delivered_at.clone(),
            ],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        Ok(())
    }

    pub fn append_delivery_attempt(
        &self,
        attempt: &ManagedTaskDeliveryAttempt,
    ) -> OpenFangResult<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let metadata_json = serde_json::to_string(&attempt.metadata_json)
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO managed_task_delivery_attempts (
                id, delivery_id, task_id, run_id, event_id, target_kind, consumer_kind,
                status, error, metadata_json, started_at, finished_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![
                attempt.id,
                attempt.delivery_id,
                attempt.task_id,
                attempt.run_id.clone().unwrap_or_default(),
                attempt.event_id.clone().unwrap_or_default(),
                serde_json::to_string(&attempt.target_kind)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                serde_json::to_string(&attempt.consumer_kind)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                serde_json::to_string(&attempt.status)
                    .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                attempt.error.clone().unwrap_or_default(),
                metadata_json,
                attempt.started_at,
                attempt.finished_at.clone(),
            ],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        Ok(())
    }

    pub fn list_deliveries(&self, task_id: &str) -> OpenFangResult<Vec<ManagedTaskDelivery>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let rows = Self::query_delivery_rows(
            &conn,
            "SELECT id, task_id, run_id, event_id, target_kind, status, origin_chat_session_id, origin_message_id, title, body, payload_json, created_at, updated_at, delivered_at FROM managed_task_deliveries WHERE task_id = ?1 ORDER BY created_at DESC",
            rusqlite::params![task_id],
        )?;
        Self::map_delivery_rows(rows)
    }

    pub fn list_delivery_attempts(
        &self,
        task_id: &str,
    ) -> OpenFangResult<Vec<ManagedTaskDeliveryAttempt>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, delivery_id, task_id, run_id, event_id, target_kind, consumer_kind, status, error, metadata_json, started_at, finished_at
                 FROM managed_task_delivery_attempts
                 WHERE task_id = ?1
                 ORDER BY started_at DESC",
            )
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let rows = stmt
            .query_map(rusqlite::params![task_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, Option<String>>(11)?,
                ))
            })
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|e| OpenFangError::Memory(e.to_string()))?);
        }
        Self::map_delivery_attempt_rows(items)
    }

    pub fn list_pending_deliveries(
        &self,
        target_kind: Option<&str>,
        origin_chat_session_id: Option<&str>,
    ) -> OpenFangResult<Vec<ManagedTaskDelivery>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let mut sql = String::from(
            "SELECT id, task_id, run_id, event_id, target_kind, status, origin_chat_session_id, origin_message_id, title, body, payload_json, created_at, updated_at, delivered_at FROM managed_task_deliveries WHERE status = ?1"
        );
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(
            serde_json::to_string(&ManagedTaskDeliveryStatus::Pending).unwrap(),
        )];
        if let Some(target_kind) = target_kind {
            sql.push_str(" AND target_kind = ?2");
            params.push(Box::new(format!("\"{}\"", target_kind.trim())));
        }
        if let Some(session_id) = origin_chat_session_id {
            let next_index = params.len() + 1;
            sql.push_str(&format!(" AND origin_chat_session_id = ?{next_index}"));
            params.push(Box::new(session_id.trim().to_string()));
        }
        sql.push_str(" ORDER BY created_at ASC");
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|value| value.as_ref()).collect();
        let rows = Self::query_delivery_rows(&conn, &sql, param_refs.as_slice())?;
        let mut items = Self::map_delivery_rows(rows)?;
        items.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(items)
    }

    pub fn mark_delivery_status(
        &self,
        delivery_id: &str,
        status: ManagedTaskDeliveryStatus,
    ) -> OpenFangResult<Option<ManagedTaskDelivery>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let now = chrono::Utc::now().to_rfc3339();
        let delivered_at = match status {
            ManagedTaskDeliveryStatus::Pending => None,
            _ => Some(now.clone()),
        };
        let delivery_id = delivery_id.trim();
        let mut current = Self::query_delivery_rows(
            &conn,
            "SELECT id, task_id, run_id, event_id, target_kind, status, origin_chat_session_id, origin_message_id, title, body, payload_json, created_at, updated_at, delivered_at FROM managed_task_deliveries WHERE id = ?1 LIMIT 1",
            rusqlite::params![delivery_id],
        )?;
        if current.is_empty() {
            return Ok(None);
        }
        conn.execute(
            "UPDATE managed_task_deliveries SET status = ?2, updated_at = ?3, delivered_at = ?4 WHERE id = ?1",
            rusqlite::params![
                delivery_id,
                serde_json::to_string(&status).map_err(|e| OpenFangError::Memory(e.to_string()))?,
                now,
                delivered_at,
            ],
        )
        .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let row = current
            .get_mut(0)
            .expect("current delivery row must exist after update");
        row.5 = serde_json::to_string(&status).map_err(|e| OpenFangError::Memory(e.to_string()))?;
        row.12 = now;
        row.13 = delivered_at;
        Ok(Self::map_delivery_rows(current)?.into_iter().next())
    }

    fn query_delivery_rows<P: rusqlite::Params>(
        conn: &Connection,
        sql: &str,
        params: P,
    ) -> OpenFangResult<Vec<DeliveryRow>> {
        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let rows = stmt
            .query_map(params, |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, String>(12)?,
                    row.get::<_, Option<String>>(13)?,
                ))
            })
            .map_err(|e| OpenFangError::Memory(e.to_string()))?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|e| OpenFangError::Memory(e.to_string()))?);
        }
        Ok(items)
    }

    fn map_delivery_rows(rows: Vec<DeliveryRow>) -> OpenFangResult<Vec<ManagedTaskDelivery>> {
        rows.into_iter()
            .map(
                |(
                    id,
                    task_id,
                    run_id_raw,
                    event_id_raw,
                    target_kind_raw,
                    status_raw,
                    origin_chat_session_id_raw,
                    origin_message_id_raw,
                    title,
                    body,
                    payload_json,
                    created_at,
                    updated_at,
                    delivered_at,
                )| {
                    Ok(ManagedTaskDelivery {
                        id,
                        task_id,
                        run_id: if run_id_raw.trim().is_empty() {
                            None
                        } else {
                            Some(run_id_raw)
                        },
                        event_id: if event_id_raw.trim().is_empty() {
                            None
                        } else {
                            Some(event_id_raw)
                        },
                        target_kind: serde_json::from_str(&target_kind_raw)
                            .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                        status: serde_json::from_str(&status_raw)
                            .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                        origin_chat_session_id: if origin_chat_session_id_raw.trim().is_empty() {
                            None
                        } else {
                            Some(origin_chat_session_id_raw)
                        },
                        origin_message_id: if origin_message_id_raw.trim().is_empty() {
                            None
                        } else {
                            Some(origin_message_id_raw)
                        },
                        title,
                        body,
                        payload: serde_json::from_str(&payload_json)
                            .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                        created_at,
                        updated_at,
                        delivered_at,
                    })
                },
            )
            .collect()
    }

    fn map_delivery_attempt_rows(
        rows: Vec<DeliveryAttemptRow>,
    ) -> OpenFangResult<Vec<ManagedTaskDeliveryAttempt>> {
        rows.into_iter()
            .map(
                |(
                    id,
                    delivery_id,
                    task_id,
                    run_id_raw,
                    event_id_raw,
                    target_kind_raw,
                    consumer_kind_raw,
                    status_raw,
                    error_raw,
                    metadata_json,
                    started_at,
                    finished_at,
                )| {
                    Ok(ManagedTaskDeliveryAttempt {
                        id,
                        delivery_id,
                        task_id,
                        run_id: if run_id_raw.trim().is_empty() {
                            None
                        } else {
                            Some(run_id_raw)
                        },
                        event_id: if event_id_raw.trim().is_empty() {
                            None
                        } else {
                            Some(event_id_raw)
                        },
                        target_kind: serde_json::from_str(&target_kind_raw)
                            .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                        consumer_kind: serde_json::from_str(&consumer_kind_raw)
                            .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                        status: serde_json::from_str(&status_raw)
                            .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                        error: if error_raw.trim().is_empty() {
                            None
                        } else {
                            Some(error_raw)
                        },
                        metadata_json: serde_json::from_str(&metadata_json)
                            .map_err(|e| OpenFangError::Memory(e.to_string()))?,
                        started_at,
                        finished_at,
                    })
                },
            )
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::TaskCenterStore;
    use openfang_types::tasks::{
        ManagedTaskDelivery, ManagedTaskDeliveryStatus, ManagedTaskDeliveryTargetKind,
    };
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    fn setup_store() -> TaskCenterStore {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");
        conn.execute_batch(
            "
            CREATE TABLE managed_task_deliveries (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                run_id TEXT NOT NULL DEFAULT '',
                event_id TEXT NOT NULL DEFAULT '',
                target_kind TEXT NOT NULL,
                status TEXT NOT NULL,
                origin_chat_session_id TEXT NOT NULL DEFAULT '',
                origin_message_id TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                delivered_at TEXT
            );
            ",
        )
        .expect("create deliveries table");
        TaskCenterStore::new(Arc::new(Mutex::new(conn)))
    }

    fn sample_delivery(
        id: &str,
        task_id: &str,
        target_kind: ManagedTaskDeliveryTargetKind,
        status: ManagedTaskDeliveryStatus,
        session_id: Option<&str>,
        created_at: &str,
    ) -> ManagedTaskDelivery {
        ManagedTaskDelivery {
            id: id.to_string(),
            task_id: task_id.to_string(),
            run_id: None,
            event_id: None,
            target_kind,
            status,
            origin_chat_session_id: session_id.map(ToString::to_string),
            origin_message_id: None,
            title: format!("title-{id}"),
            body: format!("body-{id}"),
            payload: serde_json::json!({ "id": id }),
            created_at: created_at.to_string(),
            updated_at: created_at.to_string(),
            delivered_at: None,
        }
    }

    #[test]
    fn list_pending_deliveries_filters_and_orders_rows() {
        let store = setup_store();
        store
            .append_delivery(&sample_delivery(
                "delivery-1",
                "task-a",
                ManagedTaskDeliveryTargetKind::PcNotice,
                ManagedTaskDeliveryStatus::Pending,
                Some("session-a"),
                "2026-03-25T01:00:00Z",
            ))
            .expect("insert delivery-1");
        store
            .append_delivery(&sample_delivery(
                "delivery-2",
                "task-a",
                ManagedTaskDeliveryTargetKind::PcNotice,
                ManagedTaskDeliveryStatus::Pending,
                Some("session-a"),
                "2026-03-25T00:00:00Z",
            ))
            .expect("insert delivery-2");
        store
            .append_delivery(&sample_delivery(
                "delivery-3",
                "task-a",
                ManagedTaskDeliveryTargetKind::ChatMessage,
                ManagedTaskDeliveryStatus::Reported,
                Some("session-b"),
                "2026-03-25T02:00:00Z",
            ))
            .expect("insert delivery-3");

        let filtered = store
            .list_pending_deliveries(Some("pc_notice"), Some("session-a"))
            .expect("list pending deliveries");
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].id, "delivery-2");
        assert_eq!(filtered[1].id, "delivery-1");

        let empty = store
            .list_pending_deliveries(Some("chat_message"), Some("session-a"))
            .expect("list empty deliveries");
        assert!(empty.is_empty());
    }

    #[test]
    fn mark_delivery_status_returns_updated_delivery_without_recursive_querying() {
        let store = setup_store();
        store
            .append_delivery(&sample_delivery(
                "delivery-1",
                "task-a",
                ManagedTaskDeliveryTargetKind::PcNotice,
                ManagedTaskDeliveryStatus::Pending,
                Some("session-a"),
                "2026-03-25T00:00:00Z",
            ))
            .expect("insert delivery");

        let updated = store
            .mark_delivery_status("delivery-1", ManagedTaskDeliveryStatus::Acknowledged)
            .expect("mark delivery status")
            .expect("updated delivery");

        assert_eq!(updated.id, "delivery-1");
        assert_eq!(updated.status, ManagedTaskDeliveryStatus::Acknowledged);
        assert!(updated.delivered_at.is_some());

        let listed = store
            .list_deliveries("task-a")
            .expect("list deliveries after update");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, ManagedTaskDeliveryStatus::Acknowledged);
        assert!(listed[0].delivered_at.is_some());
    }
}
