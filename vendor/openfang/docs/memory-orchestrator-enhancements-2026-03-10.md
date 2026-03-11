# Memory Orchestrator Enhancements (2026-03-10)

## Summary

This patch series extends OpenFang memory from baseline recall/store to a governed memory system:

1. Typed memory with lifecycle fields.
2. Hybrid recall ranking with explainable score metadata.
3. Conflict superseding by `entity_key`.
4. Feedback/correction API for memory quality control.
5. Audit trails for recall access and feedback events.

## Schema Changes

### Schema v8

New columns on `memories`:

1. `memory_type` (`TEXT`, default `episodic`)
2. `importance` (`REAL`, default `0.5`)
3. `entity_key` (`TEXT`, nullable)
4. `status` (`TEXT`, default `active`)
5. `supersedes_id` (`TEXT`, nullable)
6. `expires_at` (`TEXT`, nullable)

### Schema v9

New audit tables:

1. `memory_access_log`
2. `memory_feedback_events`

## Runtime Behavior Changes

### Agent Loop

`run_agent_loop` and `run_agent_loop_streaming` now:

1. Use orchestrated recall (`recall_memories_for_turn`) with higher default top-k.
2. Store typed memory candidates instead of only raw interaction text.
3. Emit periodic topic summaries.

### Semantic Store

`recall_with_embedding` now:

1. Filters inactive/expired memories.
2. Computes hybrid score:
   - semantic similarity
   - lexical match
   - recency
   - importance
   - confidence
   - type priority
3. Writes retrieval explain metadata to `memory_access_log`.

## New Memory API Endpoints

### Search

`GET /api/memory/agents/{id}/search`

Query params:

1. `q` (optional)
2. `limit` (optional, default 12, max 50)
3. `scope` (optional)
4. `memory_type` (optional)
5. `min_confidence` (optional)

### Get Memory Item

`GET /api/memory/agents/{id}/items/{memory_id}`

Returns one memory item with lifecycle metadata.

### Feedback / Correction

`POST /api/memory/agents/{id}/feedback`

Body:

```json
{
  "memory_id": "uuid",
  "action": "confirm|weaken|outdated|revoke|delete|reject|correct",
  "reason": "optional",
  "corrected_content": "required when action=correct"
}
```

### Revoke Memory

`DELETE /api/memory/agents/{id}/items/{memory_id}`

Internally mapped to `action=revoke`.

## Validation Commands

```powershell
cargo check -p openfang-memory -p openfang-runtime -p openfang-api
cargo test -p openfang-memory substrate::tests::test_memory_feedback_flow -- --nocapture
cargo test -p openfang-memory semantic::tests::test_conflict_supersede_by_entity_key -- --nocapture
```

## Upgrade Notes

1. Keep `LOCAL_PATCHES.md` in sync after each local enhancement.
2. Re-apply patch from `_local_backups` after upstream pull/rebase.
3. If merge conflicts happen, prioritize:
   - `openfang-memory/src/migration.rs`
   - `openfang-memory/src/semantic.rs`
   - `openfang-runtime/src/agent_loop.rs`
   - `openfang-api/src/routes.rs`
   - `openfang-api/src/server.rs`

