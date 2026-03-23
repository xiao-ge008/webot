//! Built-in tool execution.
//!
//! Provides filesystem, web, shell, and inter-agent tools. Agent tools
//! (agent_send, agent_spawn, etc.) require a KernelHandle to be passed in.

use crate::kernel_handle::KernelHandle;
use crate::mcp;
use crate::media_understanding::MediaEngine;
use crate::web_search::{parse_ddg_results, WebToolsContext};
use openfang_skills::registry::SkillRegistry;
use openfang_types::taint::{TaintLabel, TaintSink, TaintedValue};
use openfang_types::tool::{ToolDefinition, ToolResult};
use std::collections::HashSet;
use std::future::Future;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracing::{debug, warn};

/// Maximum inter-agent call depth to prevent infinite recursion (A->B->C->...).
const MAX_AGENT_CALL_DEPTH: u32 = 5;

/// Check if a shell command should be blocked by taint tracking.
///
/// Commands containing patterns that look like injected external data
/// (e.g., piped curl commands, base64-encoded payloads) are flagged.
/// This implements the TaintSink::shell_exec() policy from SOTA 2.
fn check_taint_shell_exec(command: &str) -> Option<String> {
    // Heuristic: flag commands that look like they contain embedded external URLs
    // or base64 payloads (common injection patterns)
    let suspicious_patterns = [
        "curl ",
        "wget ",
        "| sh",
        "| bash",
        "base64 -d",
        "$(curl",
        "`curl",
        "eval ",
    ];
    for pattern in &suspicious_patterns {
        if command.contains(pattern) {
            let mut labels = HashSet::new();
            labels.insert(TaintLabel::ExternalNetwork);
            let tainted = TaintedValue::new(command, labels, "llm_tool_call");
            if let Err(violation) = tainted.check_sink(&TaintSink::shell_exec()) {
                warn!(command = crate::str_utils::safe_truncate_str(command, 80), %violation, "Shell taint check failed");
                return Some(violation.to_string());
            }
        }
    }
    None
}

/// Check if a URL should be blocked by taint tracking before network fetch.
///
/// Blocks URLs that appear to contain API keys, tokens, or other secrets
/// in query parameters (potential data exfiltration). Implements TaintSink::net_fetch().
fn check_taint_net_fetch(url: &str) -> Option<String> {
    let exfil_patterns = [
        "api_key=",
        "apikey=",
        "token=",
        "secret=",
        "password=",
        "Authorization:",
    ];
    for pattern in &exfil_patterns {
        if url.to_lowercase().contains(&pattern.to_lowercase()) {
            let mut labels = HashSet::new();
            labels.insert(TaintLabel::Secret);
            let tainted = TaintedValue::new(url, labels, "llm_tool_call");
            if let Err(violation) = tainted.check_sink(&TaintSink::net_fetch()) {
                warn!(url = crate::str_utils::safe_truncate_str(url, 80), %violation, "Net fetch taint check failed");
                return Some(violation.to_string());
            }
        }
    }
    None
}

tokio::task_local! {
    /// Tracks the current inter-agent call depth within a task.
    static AGENT_CALL_DEPTH: std::cell::Cell<u32>;
    /// Canvas max HTML size in bytes (set from kernel config at loop start).
    pub static CANVAS_MAX_BYTES: usize;
}

const CURRENT_MODEL_VISION_TIMEOUT_SECS: u64 = 75;
const FALLBACK_VISION_TIMEOUT_SECS: u64 = 75;

fn browser_navigate_local_source_error(url: &str) -> Option<&'static str> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("file://")
        || lower.starts_with("data:")
        || lower.starts_with("blob:")
        || trimmed.starts_with('\\')
        || std::path::Path::new(trimmed).is_absolute()
    {
        return Some(
            "browser_navigate only supports http/https web pages. Do not use it for local files, file:// URLs, data URLs, or chat-uploaded images. For local/workspace images, use image_analyze or media_describe instead.",
        );
    }

    None
}

fn format_timeout_duration(timeout: std::time::Duration) -> String {
    if timeout.as_millis() < 1000 {
        format!("{}ms", timeout.as_millis())
    } else {
        format!("{}s", timeout.as_secs())
    }
}

async fn run_with_timeout<T, F>(
    label: &str,
    timeout: std::time::Duration,
    future: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    match tokio::time::timeout(timeout, future).await {
        Ok(result) => result,
        Err(_) => Err(format!(
            "{label} timed out after {}",
            format_timeout_duration(timeout)
        )),
    }
}

async fn dispatch_skill_tool(
    registry: &SkillRegistry,
    tool_name: &str,
    input: &serde_json::Value,
    allowed_skills: Option<&[String]>,
) -> Option<Result<String, String>> {
    let skill =
        registry.find_tool_provider_for_agent_skills(tool_name, allowed_skills.unwrap_or(&[]))?;
    debug!(
        tool = tool_name,
        skill = %skill.manifest.skill.name,
        "Dispatching to skill"
    );
    Some(
        match openfang_skills::loader::execute_skill_tool(
            &skill.manifest,
            &skill.path,
            tool_name,
            input,
        )
        .await
        {
            Ok(skill_result) => {
                let content = serde_json::to_string(&skill_result.output)
                    .unwrap_or_else(|_| skill_result.output.to_string());
                if skill_result.is_error {
                    Err(content)
                } else {
                    Ok(content)
                }
            }
            Err(e) => Err(format!("Skill execution failed for {tool_name}: {e}")),
        },
    )
}

/// Get the current inter-agent call depth from the task-local context.
/// Returns 0 if called outside an agent task.
pub fn current_agent_depth() -> u32 {
    AGENT_CALL_DEPTH.try_with(|d| d.get()).unwrap_or(0)
}

/// Execute a tool by name with the given input, returning a ToolResult.
///
/// The optional `kernel` handle enables inter-agent tools. If `None`,
/// agent tools will return an error indicating the kernel is not available.
///
/// `allowed_tools` enforces capability-based security: if provided, only
/// tools in the list may execute. This prevents an LLM from hallucinating
/// tool names outside the agent's capability grants.
#[allow(clippy::too_many_arguments)]
pub async fn execute_tool(
    tool_use_id: &str,
    tool_name: &str,
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
    allowed_tools: Option<&[String]>,
    allowed_skills: Option<&[String]>,
    caller_agent_id: Option<&str>,
    skill_registry: Option<&SkillRegistry>,
    mcp_connections: Option<&tokio::sync::Mutex<Vec<mcp::McpConnection>>>,
    web_ctx: Option<&WebToolsContext>,
    browser_ctx: Option<&crate::browser::BrowserManager>,
    allowed_env_vars: Option<&[String]>,
    workspace_root: Option<&Path>,
    media_engine: Option<&crate::media_understanding::MediaEngine>,
    exec_policy: Option<&openfang_types::config::ExecPolicy>,
    tts_engine: Option<&crate::tts::TtsEngine>,
    docker_config: Option<&openfang_types::config::DockerSandboxConfig>,
    process_manager: Option<&crate::process_manager::ProcessManager>,
) -> ToolResult {
    // Capability enforcement: reject tools not in the allowed list
    if let Some(allowed) = allowed_tools {
        if !allowed.iter().any(|t| t == tool_name) {
            warn!(tool_name, "Capability denied: tool not in allowed list");
            return ToolResult {
                tool_use_id: tool_use_id.to_string(),
                content: format!(
                    "Permission denied: agent does not have capability to use tool '{tool_name}'"
                ),
                is_error: true,
            };
        }
    }

    // Approval gate: check if this tool requires human approval before execution
    if let Some(kh) = kernel {
        if kh.requires_approval(tool_name) {
            let agent_id_str = caller_agent_id.unwrap_or("unknown");
            let input_str = input.to_string();
            let summary = format!(
                "{}: {}",
                tool_name,
                openfang_types::truncate_str(&input_str, 200)
            );
            match kh.request_approval(agent_id_str, tool_name, &summary).await {
                Ok(true) => {
                    debug!(tool_name, "Approval granted — proceeding with execution");
                }
                Ok(false) => {
                    warn!(tool_name, "Approval denied — blocking tool execution");
                    return ToolResult {
                        tool_use_id: tool_use_id.to_string(),
                        content: format!(
                            "Execution denied: '{}' requires human approval and was denied or timed out. The operation was not performed.",
                            tool_name
                        ),
                        is_error: true,
                    };
                }
                Err(e) => {
                    warn!(tool_name, error = %e, "Approval system error");
                    return ToolResult {
                        tool_use_id: tool_use_id.to_string(),
                        content: format!("Approval system error: {e}"),
                        is_error: true,
                    };
                }
            }
        }
    }

    debug!(tool_name, "Executing tool");
    let result = match tool_name {
        // Filesystem tools
        "file_read" => tool_file_read(input, workspace_root).await,
        "file_write" => tool_file_write(input, workspace_root).await,
        "file_list" => tool_file_list(input, workspace_root).await,
        "apply_patch" => tool_apply_patch(input, workspace_root).await,

        // Web tools (upgraded: multi-provider search, SSRF-protected fetch)
        "web_fetch" => {
            // Taint check: block URLs containing secrets/PII from being exfiltrated
            let url = input["url"].as_str().unwrap_or("");
            if let Some(violation) = check_taint_net_fetch(url) {
                return ToolResult {
                    tool_use_id: tool_use_id.to_string(),
                    content: format!("Taint violation: {violation}"),
                    is_error: true,
                };
            }
            let method = input["method"].as_str().unwrap_or("GET");
            let headers = input.get("headers").and_then(|v| v.as_object());
            let body = input["body"].as_str();
            if let Some(ctx) = web_ctx {
                ctx.fetch
                    .fetch_with_options(url, method, headers, body)
                    .await
            } else {
                tool_web_fetch_legacy(input).await
            }
        }
        "web_search" => {
            if let Some(ctx) = web_ctx {
                let query = input["query"].as_str().unwrap_or("");
                let max_results = input["max_results"].as_u64().unwrap_or(5) as usize;
                ctx.search.search(query, max_results).await
            } else {
                tool_web_search_legacy(input).await
            }
        }

        // Shell tool — exec policy + taint check
        "shell_exec" => {
            let command = input["command"].as_str().unwrap_or("");
            // Exec policy enforcement
            if let Some(policy) = exec_policy {
                if let Err(reason) =
                    crate::subprocess_sandbox::validate_command_allowlist(command, policy)
                {
                    return ToolResult {
                        tool_use_id: tool_use_id.to_string(),
                        content: format!(
                            "shell_exec blocked: {reason}. Current exec_policy.mode = '{:?}'. \
                             To allow shell commands, set exec_policy.mode = 'full' in the agent manifest or config.toml.",
                            policy.mode
                        ),
                        is_error: true,
                    };
                }
            }
            // Skip taint check for Full exec policy (e.g. hand agents that need curl for APIs)
            let is_full_exec = exec_policy
                .is_some_and(|p| p.mode == openfang_types::config::ExecSecurityMode::Full);
            if !is_full_exec {
                if let Some(violation) = check_taint_shell_exec(command) {
                    return ToolResult {
                        tool_use_id: tool_use_id.to_string(),
                        content: format!("Taint violation: {violation}"),
                        is_error: true,
                    };
                }
            }
            tool_shell_exec(
                input,
                allowed_env_vars.unwrap_or(&[]),
                workspace_root,
                exec_policy,
            )
            .await
        }

        // Inter-agent tools (require kernel handle)
        "agent_send" => tool_agent_send(input, kernel, caller_agent_id).await,
        "agent_spawn" => tool_agent_spawn(input, kernel, caller_agent_id).await,
        "agent_list" => tool_agent_list(kernel),
        "agent_kill" => tool_agent_kill(input, kernel),

        // Shared memory tools
        "memory_store" => tool_memory_store(input, kernel),
        "memory_recall" => tool_memory_recall(input, kernel, caller_agent_id).await,

        // Self-management tools
        "my_identity_patch" => {
            tool_my_identity_patch(input, workspace_root, kernel, caller_agent_id).await
        }
        "my_memory_patch" => {
            tool_my_memory_patch(input, workspace_root, kernel, caller_agent_id).await
        }
        "my_photo_generate" => {
            tool_my_photo_generate(input, workspace_root, kernel, caller_agent_id).await
        }
        "my_photo_edit" => tool_my_photo_edit(input, workspace_root, kernel, caller_agent_id).await,

        // Collaboration tools
        "agent_find" => tool_agent_find(input, kernel),
        "task_post" => tool_task_post(input, kernel, caller_agent_id).await,
        "task_claim" => tool_task_claim(kernel, caller_agent_id).await,
        "task_complete" => tool_task_complete(input, kernel).await,
        "task_list" => tool_task_list(input, kernel).await,
        "event_publish" => tool_event_publish(input, kernel).await,

        // Scheduling tools
        "schedule_create" => tool_schedule_create(input, kernel).await,
        "schedule_list" => tool_schedule_list(kernel).await,
        "schedule_delete" => tool_schedule_delete(input, kernel).await,

        // Knowledge graph tools
        "knowledge_add_entity" => tool_knowledge_add_entity(input, kernel).await,
        "knowledge_add_relation" => tool_knowledge_add_relation(input, kernel).await,
        "knowledge_query" => tool_knowledge_query(input, kernel).await,

        // Image analysis tool
        "image_analyze" => {
            tool_image_analyze(input, workspace_root, media_engine, kernel, caller_agent_id).await
        }

        // Media understanding tools
        "media_describe" => {
            tool_media_describe(input, workspace_root, media_engine, kernel, caller_agent_id).await
        }
        "media_transcribe" => tool_media_transcribe(input, media_engine).await,

        // Image generation tool
        "image_generate" => {
            if let Some(registry) = skill_registry {
                if let Some(result) =
                    dispatch_skill_tool(registry, "image_generate", input, allowed_skills).await
                {
                    result
                } else {
                    tool_image_generate(input, workspace_root, kernel, caller_agent_id).await
                }
            } else {
                tool_image_generate(input, workspace_root, kernel, caller_agent_id).await
            }
        }
        "image_edit" => {
            if let Some(registry) = skill_registry {
                if let Some(result) =
                    dispatch_skill_tool(registry, "image_edit", input, allowed_skills).await
                {
                    result
                } else {
                    tool_image_edit(input, workspace_root, kernel, caller_agent_id).await
                }
            } else {
                tool_image_edit(input, workspace_root, kernel, caller_agent_id).await
            }
        }

        // TTS/STT tools
            "text_to_speech" => {
                tool_text_to_speech(input, tts_engine, workspace_root, caller_agent_id).await
            }
        "speech_to_text" => tool_speech_to_text(input, media_engine, workspace_root).await,

        // Docker sandbox tool
        "docker_exec" => {
            tool_docker_exec(input, docker_config, workspace_root, caller_agent_id).await
        }

        // Location tool
        "location_get" => tool_location_get().await,

        // Cron scheduling tools
        "cron_create" => tool_cron_create(input, kernel, caller_agent_id).await,
        "cron_list" => tool_cron_list(kernel, caller_agent_id).await,
        "cron_cancel" => tool_cron_cancel(input, kernel).await,

        // Channel send tool (proactive outbound messaging)
        "channel_send" => tool_channel_send(input, kernel).await,

        // Persistent process tools
        "process_start" => tool_process_start(input, process_manager, caller_agent_id).await,
        "process_poll" => tool_process_poll(input, process_manager).await,
        "process_write" => tool_process_write(input, process_manager).await,
        "process_kill" => tool_process_kill(input, process_manager).await,
        "process_list" => tool_process_list(process_manager, caller_agent_id).await,

        // Hand tools (curated autonomous capability packages)
        "hand_list" => tool_hand_list(kernel).await,
        "hand_activate" => tool_hand_activate(input, kernel).await,
        "hand_status" => tool_hand_status(input, kernel).await,
        "hand_deactivate" => tool_hand_deactivate(input, kernel).await,

        // A2A outbound tools (cross-instance agent communication)
        "a2a_discover" => tool_a2a_discover(input).await,
        "a2a_send" => tool_a2a_send(input, kernel).await,

        // Browser automation tools
        "browser_navigate" => {
            let url = input["url"].as_str().unwrap_or("");
            if let Some(message) = browser_navigate_local_source_error(url) {
                return ToolResult {
                    tool_use_id: tool_use_id.to_string(),
                    content: message.to_string(),
                    is_error: true,
                };
            }
            if let Some(violation) = check_taint_net_fetch(url) {
                return ToolResult {
                    tool_use_id: tool_use_id.to_string(),
                    content: format!("Taint violation: {violation}"),
                    is_error: true,
                };
            }
            match browser_ctx {
                Some(mgr) => {
                    let aid = caller_agent_id.unwrap_or("default");
                    crate::browser::tool_browser_navigate(input, mgr, aid).await
                }
                None => Err(
                    "Browser tools not available. Ensure Chrome/Chromium is installed.".to_string(),
                ),
            }
        }
        "browser_click" => match browser_ctx {
            Some(mgr) => {
                let aid = caller_agent_id.unwrap_or("default");
                crate::browser::tool_browser_click(input, mgr, aid).await
            }
            None => {
                Err("Browser tools not available. Ensure Chrome/Chromium is installed.".to_string())
            }
        },
        "browser_type" => match browser_ctx {
            Some(mgr) => {
                let aid = caller_agent_id.unwrap_or("default");
                crate::browser::tool_browser_type(input, mgr, aid).await
            }
            None => {
                Err("Browser tools not available. Ensure Chrome/Chromium is installed.".to_string())
            }
        },
        "browser_screenshot" => match browser_ctx {
            Some(mgr) => {
                let aid = caller_agent_id.unwrap_or("default");
                crate::browser::tool_browser_screenshot(input, mgr, aid).await
            }
            None => {
                Err("Browser tools not available. Ensure Chrome/Chromium is installed.".to_string())
            }
        },
        "browser_read_page" => match browser_ctx {
            Some(mgr) => {
                let aid = caller_agent_id.unwrap_or("default");
                crate::browser::tool_browser_read_page(input, mgr, aid).await
            }
            None => {
                Err("Browser tools not available. Ensure Chrome/Chromium is installed.".to_string())
            }
        },
        "browser_close" => match browser_ctx {
            Some(mgr) => {
                let aid = caller_agent_id.unwrap_or("default");
                crate::browser::tool_browser_close(input, mgr, aid).await
            }
            None => {
                Err("Browser tools not available. Ensure Chrome/Chromium is installed.".to_string())
            }
        },
        "browser_scroll" => match browser_ctx {
            Some(mgr) => {
                let aid = caller_agent_id.unwrap_or("default");
                crate::browser::tool_browser_scroll(input, mgr, aid).await
            }
            None => {
                Err("Browser tools not available. Ensure Chrome/Chromium is installed.".to_string())
            }
        },
        "browser_wait" => match browser_ctx {
            Some(mgr) => {
                let aid = caller_agent_id.unwrap_or("default");
                crate::browser::tool_browser_wait(input, mgr, aid).await
            }
            None => {
                Err("Browser tools not available. Ensure Chrome/Chromium is installed.".to_string())
            }
        },
        "browser_run_js" => match browser_ctx {
            Some(mgr) => {
                let aid = caller_agent_id.unwrap_or("default");
                crate::browser::tool_browser_run_js(input, mgr, aid).await
            }
            None => {
                Err("Browser tools not available. Ensure Chrome/Chromium is installed.".to_string())
            }
        },
        "browser_back" => match browser_ctx {
            Some(mgr) => {
                let aid = caller_agent_id.unwrap_or("default");
                crate::browser::tool_browser_back(input, mgr, aid).await
            }
            None => {
                Err("Browser tools not available. Ensure Chrome/Chromium is installed.".to_string())
            }
        },

        // Canvas / A2UI tool
        "canvas_present" => tool_canvas_present(input, workspace_root).await,

        other => {
            // Fallback 1: MCP tools (mcp_{server}_{tool} prefix)
            if mcp::is_mcp_tool(other) {
                if let Some(mcp_conns) = mcp_connections {
                    let mut conns = mcp_conns.lock().await;
                    let known_servers = conns
                        .iter()
                        .map(|conn| conn.name().to_string())
                        .collect::<Vec<_>>();
                    if let Some(server_name) = mcp::resolve_mcp_server_from_known(
                        other,
                        known_servers.iter().map(String::as_str),
                    ) {
                        if let Some(conn_index) =
                            conns.iter().position(|conn| conn.name() == server_name)
                        {
                            let conn = &mut conns[conn_index];
                            debug!(
                                tool = other,
                                server = server_name,
                                "Dispatching to MCP server"
                            );
                            match conn.call_tool(other, input).await {
                                Ok(content) => Ok(content),
                                Err(e) => Err(format!("MCP tool call failed: {e}")),
                            }
                        } else {
                            Err(format!("MCP server '{server_name}' not connected"))
                        }
                    } else {
                        Err(format!("Invalid MCP tool name: {other}"))
                    }
                } else {
                    Err(format!("MCP not available for tool: {other}"))
                }
            }
            // Fallback 2: Skill registry tool providers
            else if let Some(registry) = skill_registry {
                if let Some(result) =
                    dispatch_skill_tool(registry, other, input, allowed_skills).await
                {
                    result
                } else {
                    Err(format!("Unknown tool: {other}"))
                }
            } else {
                Err(format!("Unknown tool: {other}"))
            }
        }
    };

    match result {
        Ok(content) => ToolResult {
            tool_use_id: tool_use_id.to_string(),
            content,
            is_error: false,
        },
        Err(err) => ToolResult {
            tool_use_id: tool_use_id.to_string(),
            content: format!("Error: {err}"),
            is_error: true,
        },
    }
}

/// Get definitions for all built-in tools.
pub fn builtin_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        // --- Filesystem tools ---
        ToolDefinition {
            name: "file_read".to_string(),
            description: "Read the contents of a file. Paths are relative to the agent workspace.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "The file path to read" }
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "file_write".to_string(),
            description: "Write content to a file. Paths are relative to the agent workspace.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "The file path to write to" },
                    "content": { "type": "string", "description": "The content to write" }
                },
                "required": ["path", "content"]
            }),
        },
        ToolDefinition {
            name: "file_list".to_string(),
            description: "List files in a directory. Paths are relative to the agent workspace.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "The directory path to list" }
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "apply_patch".to_string(),
            description: "Apply a multi-hunk diff patch to add, update, move, or delete files. Use this for targeted edits instead of full file overwrites.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "patch": {
                        "type": "string",
                        "description": "The patch in *** Begin Patch / *** End Patch format. Use *** Add File:, *** Update File:, *** Delete File: markers. Hunks use @@ headers with space (context), - (remove), + (add) prefixed lines."
                    }
                },
                "required": ["patch"]
            }),
        },
        // --- Web tools ---
        ToolDefinition {
            name: "web_fetch".to_string(),
            description: "Fetch a URL with SSRF protection. Supports GET/POST/PUT/PATCH/DELETE. For GET, HTML is converted to Markdown. For other methods, returns raw response body.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "The URL to fetch (http/https only)" },
                    "method": { "type": "string", "enum": ["GET","POST","PUT","PATCH","DELETE"], "description": "HTTP method (default: GET)" },
                    "headers": { "type": "object", "description": "Custom HTTP headers as key-value pairs" },
                    "body": { "type": "string", "description": "Request body for POST/PUT/PATCH" }
                },
                "required": ["url"]
            }),
        },
        ToolDefinition {
            name: "web_search".to_string(),
            description: "Search the web using multiple providers (Tavily, Brave, Perplexity, DuckDuckGo) with automatic fallback. Returns structured results with titles, URLs, and snippets.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "The search query" },
                    "max_results": { "type": "integer", "description": "Maximum number of results to return (default: 5, max: 20)" }
                },
                "required": ["query"]
            }),
        },
        // --- Shell tool ---
        ToolDefinition {
            name: "shell_exec".to_string(),
            description: "Execute a shell command and return its output.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "The command to execute" },
                    "timeout_seconds": { "type": "integer", "description": "Timeout in seconds (default: 30)" }
                },
                "required": ["command"]
            }),
        },
        // --- Inter-agent tools ---
        ToolDefinition {
            name: "agent_send".to_string(),
            description: "Send a message to another agent and receive their response. Accepts UUID or agent name. Use agent_find first to discover agents.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "agent_id": { "type": "string", "description": "The target agent's UUID or name" },
                    "message": { "type": "string", "description": "The message to send to the agent" }
                },
                "required": ["agent_id", "message"]
            }),
        },
        ToolDefinition {
            name: "agent_spawn".to_string(),
            description: "Spawn a new agent from a TOML manifest. Returns the new agent's ID and name.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "manifest_toml": {
                        "type": "string",
                        "description": "The agent manifest in TOML format (must include name, module, [model], and [capabilities])"
                    }
                },
                "required": ["manifest_toml"]
            }),
        },
        ToolDefinition {
            name: "agent_list".to_string(),
            description: "List all currently running agents with their IDs, names, states, and models.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDefinition {
            name: "agent_kill".to_string(),
            description: "Kill (terminate) another agent by its ID.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "agent_id": { "type": "string", "description": "The agent's UUID to kill" }
                },
                "required": ["agent_id"]
            }),
        },
        // --- Shared memory tools ---
        ToolDefinition {
            name: "memory_store".to_string(),
            description: "Store a value in shared memory accessible by all agents. Use for cross-agent coordination and data sharing.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "key": { "type": "string", "description": "The storage key" },
                    "value": { "type": "string", "description": "The value to store (JSON-encode objects/arrays, or pass a plain string)" }
                },
                "required": ["key", "value"]
            }),
        },
        ToolDefinition {
            name: "memory_recall".to_string(),
            description: "Recall a known shared memory key, or query the current agent's unified memory with a natural-language request when the key is unknown.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "key": { "type": "string", "description": "A known shared memory key, or a natural-language memory query" },
                    "subject_type": { "type": "string", "description": "Optional projection subject type for unified memory query, such as agent, group, user, or a2a_edge" },
                    "subject_id": { "type": "string", "description": "Optional projection subject identifier paired with subject_type" },
                    "limit": { "type": "integer", "description": "Optional max results for unified memory query (default 6, max 12)" }
                },
                "required": ["key"]
            }),
        },
        ToolDefinition {
            name: "my_identity_patch".to_string(),
            description: "Patch the current agent's own identity files or tightly scoped self-owned manifest fields. Use this for updating your own IDENTITY.md, SOUL.md, USER.md, MEMORY.md, AGENTS.md, BOOTSTRAP.md, HEARTBEAT.md, system prompt, avatar URL, or color. This tool only applies to the current agent itself and should be preferred over generic file or image tools for self-management.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "mode": { "type": "string", "description": "How to apply file content updates: 'replace' (default) or 'append'." },
                    "files": {
                        "type": "object",
                        "description": "Map of allowed self identity filenames to content. Allowed keys: IDENTITY.md, SOUL.md, USER.md, MEMORY.md, AGENTS.md, BOOTSTRAP.md, HEARTBEAT.md.",
                        "additionalProperties": { "type": "string" }
                    },
                    "system_prompt": { "type": "string", "description": "Optional replacement for the current agent's own base system prompt." },
                    "avatar_url": { "type": "string", "description": "Optional new avatar URL for the current agent. Treat as high-risk identity change." },
                    "color": { "type": "string", "description": "Optional UI accent color for the current agent, such as '#FF5C00'." },
                    "confirmed_by_user": { "type": "boolean", "description": "Set true only when the user has already explicitly approved a high-risk self identity change." },
                    "reason": { "type": "string", "description": "Short reason for why this self patch is needed." }
                }
            }),
        },
        ToolDefinition {
            name: "my_memory_patch".to_string(),
            description: "Write or supersede the current agent's own long-term memory notes. Use this after a self-review, user correction, explicit preference update, or upgrade summary. This tool is for self memory, not shared cross-agent coordination.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "content": { "type": "string", "description": "The memory content to store for the current agent." },
                    "memory_type": { "type": "string", "description": "Typed memory label such as preference, guardrail, relationship_note, task_state, or self_upgrade_note." },
                    "scope": { "type": "string", "description": "Logical memory scope. Default: self_management." },
                    "entity_key": { "type": "string", "description": "Optional stable slot key for superseding older memories of the same kind." },
                    "importance": { "type": "number", "description": "Optional importance score between 0 and 1." },
                    "confidence": { "type": "number", "description": "Optional confidence score between 0 and 1." },
                    "reason": { "type": "string", "description": "Short explanation for why this memory should be stored." },
                    "append_to_memory_md": { "type": "boolean", "description": "Whether to also append an audit note into the current workspace MEMORY.md file. Default: true." }
                },
                "required": ["content"]
            }),
        },
        ToolDefinition {
            name: "my_photo_edit".to_string(),
            description: "Edit an existing photo of the current agent while preserving the same identity. Use this for your own outfit change, scene change, expression change, pose tweak, or other local updates when a source self-photo already exists. Prefer this over generic image_edit when the task is about the agent itself. By default, self photos are stored under agent_profile/meta so the agent can manage its own media library later; set save_target='output' only when you explicitly want a temporary/default output copy.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "Describe the exact change to make to the current agent's existing self-photo while preserving the same identity." },
                    "purpose": { "type": "string", "description": "Optional intent label such as self_photo, scene_variant, outfit_change, avatar_refine, or portrait_refine." },
                    "meta_label": { "type": "string", "description": "Optional personal media label stored under agent_profile/meta, such as 今日穿搭, 居家自拍, 最近视频, or 节日写真." },
                    "save_target": { "type": "string", "description": "Optional save target: 'agent_profile_meta' (default for self media) or 'output'." },
                    "image_path": { "type": "string", "description": "Optional explicit source self-photo path. If omitted, the tool will try the current avatar URL first, then portrait URL." },
                    "image_url": { "type": "string", "description": "Optional explicit source self-photo URL. If omitted, the tool will try the current avatar URL first, then portrait URL." },
                    "image_base64": { "type": "string", "description": "Optional explicit base64 source self-photo." },
                    "mime_type": { "type": "string", "description": "Required when image_base64 is provided." },
                    "width": { "type": "integer", "description": "Optional output width override." },
                    "height": { "type": "integer", "description": "Optional output height override." },
                    "size": { "type": "string", "description": "Legacy size string such as '1024x1024'." },
                    "quality": { "type": "string", "description": "Legacy quality hint for the fallback provider." }
                },
                "required": ["prompt"]
            }),
        },
        ToolDefinition {
            name: "my_photo_generate".to_string(),
            description: "Create a new photo of the current agent, but always continue from the current avatar first, or the current portrait as fallback, so the same identity anchor stays locked automatically. The runtime injects this self identity anchor for you; the model does not need to pass any source image fields. Use this for new self-photos, same-character roleplay scenes, selfies, portraits, or appearance variants of the current agent. This tool must not create a brand-new unrelated face or replace the current self identity anchor; for unrelated characters or fully new people, use the generic image_generate tool instead. By default, self photos are stored under agent_profile/meta so the agent can manage its own personal media library later; set save_target='output' only when you explicitly want the normal workspace output instead.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "Describe the new photo you want of the current agent." },
                    "purpose": { "type": "string", "description": "Optional intent label such as self_photo, selfie, avatar_candidate, portrait_candidate, roleplay_scene, or scene_variant." },
                    "meta_label": { "type": "string", "description": "Optional personal media label stored under agent_profile/meta, such as 今日穿搭, 自拍合集, 角色扮演, or 节日写真." },
                    "save_target": { "type": "string", "description": "Optional save target: 'agent_profile_meta' (default for self media) or 'output'." },
                    "width": { "type": "integer", "description": "Optional output width override." },
                    "height": { "type": "integer", "description": "Optional output height override." },
                    "size": { "type": "string", "description": "Legacy size string such as '1024x1024'." },
                    "quality": { "type": "string", "description": "Legacy quality hint for the fallback provider." }
                },
                "required": ["prompt"]
            }),
        },
        // --- Collaboration tools ---
        ToolDefinition {
            name: "agent_find".to_string(),
            description: "Discover agents by name, tag, tool, or description. Use to find specialists before delegating work.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search query (matches agent name, tags, tools, description)" }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "task_post".to_string(),
            description: "Post a task to the shared task queue for another agent to pick up.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Short task title" },
                    "description": { "type": "string", "description": "Detailed task description" },
                    "assigned_to": { "type": "string", "description": "Agent name or ID to assign the task to (optional)" }
                },
                "required": ["title", "description"]
            }),
        },
        ToolDefinition {
            name: "task_claim".to_string(),
            description: "Claim the next available task from the task queue assigned to you or unassigned.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDefinition {
            name: "task_complete".to_string(),
            description: "Mark a previously claimed task as completed with a result.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string", "description": "The task ID to complete" },
                    "result": { "type": "string", "description": "The result or outcome of the task" }
                },
                "required": ["task_id", "result"]
            }),
        },
        ToolDefinition {
            name: "task_list".to_string(),
            description: "List tasks in the shared queue, optionally filtered by status (pending, in_progress, completed).".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "status": { "type": "string", "description": "Filter by status: pending, in_progress, completed (optional)" }
                }
            }),
        },
        ToolDefinition {
            name: "event_publish".to_string(),
            description: "Publish a custom event that can trigger proactive agents. Use to broadcast signals to the agent fleet.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "event_type": { "type": "string", "description": "Type identifier for the event (e.g., 'code_review_requested')" },
                    "payload": { "type": "object", "description": "JSON payload data for the event" }
                },
                "required": ["event_type"]
            }),
        },
        // --- Scheduling tools ---
        ToolDefinition {
            name: "schedule_create".to_string(),
            description: "Schedule a recurring task using natural language or cron syntax. Examples: 'every 5 minutes', 'daily at 9am', 'weekdays at 6pm', '0 */5 * * *'.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "description": { "type": "string", "description": "What this schedule does (e.g., 'Check for new emails')" },
                    "schedule": { "type": "string", "description": "Natural language or cron expression (e.g., 'every 5 minutes', 'daily at 9am', '0 */5 * * *')" },
                    "agent": { "type": "string", "description": "Agent name or ID to run this task (optional, defaults to self)" }
                },
                "required": ["description", "schedule"]
            }),
        },
        ToolDefinition {
            name: "schedule_list".to_string(),
            description: "List all scheduled tasks with their IDs, descriptions, schedules, and next run times.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDefinition {
            name: "schedule_delete".to_string(),
            description: "Remove a scheduled task by its ID.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "The schedule ID to remove" }
                },
                "required": ["id"]
            }),
        },
        // --- Knowledge graph tools ---
        ToolDefinition {
            name: "knowledge_add_entity".to_string(),
            description: "Add an entity to the knowledge graph. Entities represent people, organizations, projects, concepts, locations, tools, etc.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Display name of the entity" },
                    "entity_type": { "type": "string", "description": "Type: person, organization, project, concept, event, location, document, tool, or a custom type" },
                    "properties": { "type": "object", "description": "Arbitrary key-value properties (optional)" }
                },
                "required": ["name", "entity_type"]
            }),
        },
        ToolDefinition {
            name: "knowledge_add_relation".to_string(),
            description: "Add a relation between two entities in the knowledge graph.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "source": { "type": "string", "description": "Source entity ID or name" },
                    "relation": { "type": "string", "description": "Relation type: works_at, knows_about, related_to, depends_on, owned_by, created_by, located_in, part_of, uses, produces, or a custom type" },
                    "target": { "type": "string", "description": "Target entity ID or name" },
                    "confidence": { "type": "number", "description": "Confidence score 0.0-1.0 (default: 1.0)" },
                    "properties": { "type": "object", "description": "Arbitrary key-value properties (optional)" }
                },
                "required": ["source", "relation", "target"]
            }),
        },
        ToolDefinition {
            name: "knowledge_query".to_string(),
            description: "Query the knowledge graph. Filter by source entity, relation type, and/or target entity. Returns matching entity-relation-entity triples.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "source": { "type": "string", "description": "Filter by source entity name or ID (optional)" },
                    "relation": { "type": "string", "description": "Filter by relation type (optional)" },
                    "target": { "type": "string", "description": "Filter by target entity name or ID (optional)" },
                    "max_depth": { "type": "integer", "description": "Maximum traversal depth (default: 1)" }
                }
            }),
        },
        // --- Image analysis tool ---
        ToolDefinition {
            name: "image_analyze".to_string(),
            description: "Primary tool for understanding a local, workspace, or chat-uploaded image file. Use this first when the task is to inspect what is in an image, answer questions about an image, summarize a screenshot, or extract visible details from a local image path. When local Florence-2 vision is enabled, the runtime will prefer that local result automatically; otherwise it uses the current agent model vision path and then configured fallback vision providers. Without a prompt, returns basic file metadata and a preview for debugging.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to the image file" },
                    "prompt": { "type": "string", "description": "Optional prompt for vision analysis (e.g., 'Describe what you see')" }
                },
                "required": ["path"]
            }),
        },
        // --- Location tool ---
        ToolDefinition {
            name: "location_get".to_string(),
            description: "Get approximate geographic location based on IP address. Returns city, country, coordinates, and timezone.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        },
        // --- Browser automation tools ---
        ToolDefinition {
            name: "browser_navigate".to_string(),
            description: "Navigate a browser to an http/https web page. Returns the page title and readable content as markdown. Do not use this for local files, file:// URLs, data URLs, or chat-uploaded images.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "The URL to navigate to (http/https only)" }
                },
                "required": ["url"]
            }),
        },
        ToolDefinition {
            name: "browser_click".to_string(),
            description: "Click an element on the current browser page by CSS selector or visible text. Returns the resulting page state.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "selector": { "type": "string", "description": "CSS selector (e.g., '#submit-btn', '.add-to-cart') or visible text to click" }
                },
                "required": ["selector"]
            }),
        },
        ToolDefinition {
            name: "browser_type".to_string(),
            description: "Type text into an input field on the current browser page.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "selector": { "type": "string", "description": "CSS selector for the input field (e.g., 'input[name=\"email\"]', '#search-box')" },
                    "text": { "type": "string", "description": "The text to type into the field" }
                },
                "required": ["selector", "text"]
            }),
        },
        ToolDefinition {
            name: "browser_screenshot".to_string(),
            description: "Take a screenshot of the current browser page. Returns a base64-encoded PNG image.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDefinition {
            name: "browser_read_page".to_string(),
            description: "Read the current browser page content as structured markdown. Use after clicking or navigating to see the updated page.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDefinition {
            name: "browser_close".to_string(),
            description: "Close the browser session. The browser will also auto-close when the agent loop ends.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDefinition {
            name: "browser_scroll".to_string(),
            description: "Scroll the browser page. Use this to see content below the fold or navigate long pages.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "direction": { "type": "string", "description": "Scroll direction: 'up', 'down', 'left', 'right' (default: 'down')" },
                    "amount": { "type": "integer", "description": "Pixels to scroll (default: 600)" }
                }
            }),
        },
        ToolDefinition {
            name: "browser_wait".to_string(),
            description: "Wait for a CSS selector to appear on the page. Useful for dynamic content that loads asynchronously.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "selector": { "type": "string", "description": "CSS selector to wait for" },
                    "timeout_ms": { "type": "integer", "description": "Max wait time in milliseconds (default: 5000, max: 30000)" }
                },
                "required": ["selector"]
            }),
        },
        ToolDefinition {
            name: "browser_run_js".to_string(),
            description: "Run JavaScript on the current browser page and return the result. For advanced interactions that other browser tools cannot handle.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "expression": { "type": "string", "description": "JavaScript expression to run in the page context" }
                },
                "required": ["expression"]
            }),
        },
        ToolDefinition {
            name: "browser_back".to_string(),
            description: "Go back to the previous page in browser history.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        },
        // --- Media understanding tools ---
        ToolDefinition {
            name: "media_describe".to_string(),
            description: "Primary tool for describing a local, workspace, screenshot, or chat-uploaded image when you need a natural-language summary. Prefer this over browser_navigate for any local image path. When local Florence-2 vision is enabled, the runtime will prefer that local result automatically; otherwise it uses the current agent model vision path and then configured fallback vision providers.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to the image file (relative to workspace)" },
                    "prompt": { "type": "string", "description": "Optional prompt to guide the description (e.g., 'Extract all text from this image')" }
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "media_transcribe".to_string(),
            description: "Transcribe audio to text using speech-to-text. Auto-selects the best available provider (Groq Whisper or OpenAI Whisper). Returns the transcript.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to the audio file (relative to workspace). Supported: mp3, wav, ogg, flac, m4a, webm." },
                    "language": { "type": "string", "description": "Optional ISO-639-1 language code (e.g., 'en', 'es', 'ja')" }
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "image_edit".to_string(),
            description: "Edit a single existing image using a text instruction. Use this when the user wants to keep the same person/identity, the same base picture, or the same overall scene while making targeted changes such as outfit, hairstyle, makeup, pose adjustment, background adjustment, prop changes, retouching, or other fine-to-medium edits. This is the correct generic tool when consistency matters for a non-self image workflow. Default rule: only change the user-requested parts and keep everything else unchanged, including identity, style, composition, lighting, camera angle, and unmentioned details. A source image is required: pass exactly one of `image_path`, `image_url`, or `image_base64` (+ `mime_type`). Prefer passing `image_path` for a file inside the current agent workspace/workdir; the runtime will resolve and upload that local file automatically before editing. Resolution priority: component skill provider first, then configured generic image service editor (ComfyUI built-in Qwen-edit workflow when configured), then the current agent model if it supports image editing. Edited images default to the workspace output/ directory, unless save_target='agent_profile_meta' is explicitly used for self-owned personal media.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "description": "Modify an existing image while keeping the original as the base. Requires exactly one source image via image_path, image_url, or image_base64 with mime_type.",
                "properties": {
                    "prompt": { "type": "string", "description": "Text instruction describing how to modify the existing input image while preserving the original image as the base. Prefer image_edit when the same person/identity or same base scene should stay recognizable. Only describe the exact requested change, and explicitly keep all other unmentioned elements unchanged. Typical use cases: outfit change, background refinement, prop change, pose tweak, face cleanup, detail retouching, or other fine-to-medium edits." },
                    "negative_prompt": { "type": "string", "description": "Optional negative prompt for providers that support it" },
                    "image_path": { "type": "string", "description": "Preferred only for a real relative or absolute file path inside the agent workspace/local filesystem. Do not use /api/uploads/... here unless you truly mean the chat-upload URL; the runtime will normalize that case automatically." },
                    "image_url": { "type": "string", "description": "Single source image URL such as /api/uploads/... or an http/https image URL. Prefer this for chat-history images and uploaded images shown in the UI." },
                    "image_base64": { "type": "string", "description": "Optional base64-encoded source image data" },
                    "mime_type": { "type": "string", "description": "Required when image_base64 is provided, e.g. image/png" },
                    "model": { "type": "string", "description": "Optional legacy model hint for direct OpenAI-compatible fallback. Recommended default: 'gpt-image-1'." },
                    "size": { "type": "string", "description": "Legacy output size string such as '1024x1024'. Ignored when width and height are provided." },
                    "width": { "type": "integer", "description": "Output image width override" },
                    "height": { "type": "integer", "description": "Output image height override" },
                    "quality": { "type": "string", "description": "Legacy quality hint for OpenAI-compatible fallback. Recommended default: 'standard'." },
                    "count": { "type": "integer", "description": "Currently only supports 1." },
                    "save_target": { "type": "string", "description": "Optional save target: 'output' (default) or 'agent_profile_meta'. Only use agent_profile_meta when the edited image is explicitly the current agent's own personal media." },
                    "meta_label": { "type": "string", "description": "Optional personal media label used only when save_target='agent_profile_meta', such as 今日穿搭 or 最近视频." }
                },
                "required": ["prompt"]
            }),
        },
        // --- Image generation tool ---
        ToolDefinition {
            name: "image_generate".to_string(),
            description: "Generate a brand-new image from scratch from a text prompt. Use this when the user wants a new picture, a new person/character, a new composition, a roleplay character, or a major redesign where exact continuity with a previous image is NOT required. Important: image generation cannot reliably preserve the exact same person/identity from an existing image, so do NOT use this to keep the same face/person consistent. This is the generic generation tool for non-self image workflows. If the request is about the current agent itself, prefer my_photo_generate or my_photo_edit instead. Resolution priority: component skill provider first, then configured generic image provider (ComfyUI / ModelScope), then the current agent model if it supports image generation. Generated images default to the workspace output/ directory, unless save_target='agent_profile_meta' is explicitly used for self-owned personal media.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "Text description for a brand-new image from scratch (max 4000 chars). Use this for new people/characters, roleplay characters, new scenes, or major redesigns. Do not use image_generate when the main goal is to preserve the same person/identity from an existing image." },
                    "negative_prompt": { "type": "string", "description": "Optional negative prompt for providers that support it" },
                    "model": { "type": "string", "description": "Optional legacy model hint for direct OpenAI-compatible fallback: 'dall-e-3', 'dall-e-2', or 'gpt-image-1'" },
                    "size": { "type": "string", "description": "Legacy size string such as '1024x1024'. Ignored when width and height are provided." },
                    "width": { "type": "integer", "description": "Image width override" },
                    "height": { "type": "integer", "description": "Image height override" },
                    "quality": { "type": "string", "description": "Legacy quality hint for OpenAI-compatible fallback. Recommended default: 'standard'." },
                    "count": { "type": "integer", "description": "Number of images to generate (1-4, default: 1). DALL-E 3 only supports 1." },
                    "save_target": { "type": "string", "description": "Optional save target: 'output' (default) or 'agent_profile_meta'. Only use agent_profile_meta when the generated image is explicitly the current agent's own personal media." },
                    "meta_label": { "type": "string", "description": "Optional personal media label used only when save_target='agent_profile_meta', such as 今日穿搭 or 最近视频." }
                },
                "required": ["prompt"]
            }),
        },
        // --- Cron scheduling tools ---
        ToolDefinition {
            name: "cron_create".to_string(),
            description: "Create a scheduled/cron job for the current agent. Prefer action.kind=\"agent_turn\" for normal scheduled tasks (query/monitor/report). action.kind=\"system_event\" is only for publishing an internal event for proactive agents. If you use system_event accidentally, the runtime will auto-upgrade it to agent_turn unless action.force_system_event=true.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Job name (max 128 chars, alphanumeric + spaces/hyphens/underscores)" },
                    "schedule": {
                        "type": "object",
                        "description": "Schedule: {\"kind\":\"at\",\"at\":\"2025-01-01T00:00:00Z\"} or {\"kind\":\"every\",\"every_secs\":300} or {\"kind\":\"cron\",\"expr\":\"0 */6 * * *\"}"
                    },
                    "action": {
                        "type": "object",
                        "description": "Action (recommended): {\"kind\":\"agent_turn\",\"message\":\"...\",\"timeout_secs\":300}. Advanced: {\"kind\":\"system_event\",\"text\":\"...\",\"force_system_event\":true}."
                    },
                    "delivery": {
                        "type": "object",
                        "description": "Delivery target: {\"kind\":\"none\"} or {\"kind\":\"channel\",\"channel\":\"telegram\"} or {\"kind\":\"last_channel\"}"
                    },
                    "one_shot": { "type": "boolean", "description": "If true, auto-delete after execution. Default: false" }
                },
                "required": ["name", "schedule", "action"]
            }),
        },
        ToolDefinition {
            name: "cron_list".to_string(),
            description: "List all scheduled/cron jobs for the current agent.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDefinition {
            name: "cron_cancel".to_string(),
            description: "Cancel a scheduled/cron job by its ID.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "job_id": { "type": "string", "description": "The UUID of the cron job to cancel" }
                },
                "required": ["job_id"]
            }),
        },
        // --- Channel send tool (proactive outbound messaging) ---
        ToolDefinition {
            name: "channel_send".to_string(),
            description: "Send a message or media to a user on a configured channel (email, telegram, slack, etc). For email: recipient is the email address; optionally set subject. For media: set image_url or file_url to send an image or file instead of (or alongside) text.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "channel": { "type": "string", "description": "Channel adapter name (e.g., 'email', 'telegram', 'slack', 'discord')" },
                    "recipient": { "type": "string", "description": "Platform-specific recipient identifier (email address, user ID, etc.)" },
                    "subject": { "type": "string", "description": "Optional subject line (used for email; ignored for other channels)" },
                    "message": { "type": "string", "description": "The message body to send (required for text, optional caption for media)" },
                    "image_url": { "type": "string", "description": "URL of an image to send (supported on Telegram, Discord, Slack)" },
                    "file_url": { "type": "string", "description": "URL of a file to send as attachment" },
                    "filename": { "type": "string", "description": "Filename for file attachments (defaults to 'file')" }
                },
                "required": ["channel", "recipient"]
            }),
        },
        // --- Hand tools (curated autonomous capability packages) ---
        ToolDefinition {
            name: "hand_list".to_string(),
            description: "List available Hands (curated autonomous packages) and their activation status.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDefinition {
            name: "hand_activate".to_string(),
            description: "Activate a Hand — spawns a specialized autonomous agent with curated tools and skills.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "hand_id": { "type": "string", "description": "The ID of the hand to activate (e.g. 'researcher', 'clip', 'browser')" },
                    "config": { "type": "object", "description": "Optional configuration overrides for the hand's settings" }
                },
                "required": ["hand_id"]
            }),
        },
        ToolDefinition {
            name: "hand_status".to_string(),
            description: "Check the status and metrics of an active Hand.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "hand_id": { "type": "string", "description": "The ID of the hand to check status for" }
                },
                "required": ["hand_id"]
            }),
        },
        ToolDefinition {
            name: "hand_deactivate".to_string(),
            description: "Deactivate a running Hand and stop its agent.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "instance_id": { "type": "string", "description": "The UUID of the hand instance to deactivate" }
                },
                "required": ["instance_id"]
            }),
        },
        // --- A2A outbound tools ---
        ToolDefinition {
            name: "a2a_discover".to_string(),
            description: "Discover an external A2A agent by fetching its agent card from a URL. Returns the agent's name, description, skills, and supported protocols.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "Base URL of the remote OpenFang/A2A-compatible agent (e.g., 'https://agent.example.com')" }
                },
                "required": ["url"]
            }),
        },
        ToolDefinition {
            name: "a2a_send".to_string(),
            description: "Send a task/message to an external A2A agent and get the response. Use agent_name to send to a previously discovered agent, or agent_url for direct addressing.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "message": { "type": "string", "description": "The task/message to send to the remote agent" },
                    "agent_url": { "type": "string", "description": "Direct URL of the remote agent's A2A endpoint" },
                    "agent_name": { "type": "string", "description": "Name of a previously discovered A2A agent (looked up from kernel)" },
                    "session_id": { "type": "string", "description": "Optional session ID for multi-turn conversations" }
                },
                "required": ["message"]
            }),
        },
        // --- TTS/STT tools ---
        ToolDefinition {
            name: "text_to_speech".to_string(),
            description: "Convert text to speech audio. Prefers Webot local TTS when available, otherwise falls back to configured OpenAI/ElevenLabs runtime TTS. Local F5-TTS-ONNX currently outputs WAV and returns a playable asset URL.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "The text to convert to speech (max 4096 chars)" },
                    "voice": { "type": "string", "description": "Voice name for remote providers, or local speaker profile ID when Webot local TTS is enabled. If omitted, the agent default voice/sample is used." },
                    "format": { "type": "string", "description": "Preferred output format. Webot local F5-TTS-ONNX will automatically coerce unsupported formats to 'wav'." }
                },
                "required": ["text"]
            }),
        },
        ToolDefinition {
            name: "speech_to_text".to_string(),
            description: "Transcribe audio to text using speech-to-text. Auto-selects Groq Whisper or OpenAI Whisper. Supported formats: mp3, wav, ogg, flac, m4a, webm.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to the audio file (relative to workspace)" },
                    "language": { "type": "string", "description": "Optional ISO-639-1 language code (e.g., 'en', 'es', 'ja')" }
                },
                "required": ["path"]
            }),
        },
        // --- Docker sandbox tool ---
        ToolDefinition {
            name: "docker_exec".to_string(),
            description: "Execute a command inside a Docker container sandbox. Provides OS-level isolation with resource limits, network isolation, and capability dropping. Requires Docker to be installed and docker.enabled=true.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "The command to execute inside the container" }
                },
                "required": ["command"]
            }),
        },
        // --- Persistent process tools ---
        ToolDefinition {
            name: "process_start".to_string(),
            description: "Start a long-running process (REPL, server, watcher). Returns a process_id for subsequent poll/write/kill operations. Max 5 processes per agent.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "The executable to run (e.g. 'python', 'node', 'npm')" },
                    "args": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Command-line arguments (e.g. ['-i'] for interactive Python)"
                    }
                },
                "required": ["command"]
            }),
        },
        ToolDefinition {
            name: "process_poll".to_string(),
            description: "Read accumulated stdout/stderr from a running process. Non-blocking: returns whatever output has buffered since the last poll.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "process_id": { "type": "string", "description": "The process ID returned by process_start" }
                },
                "required": ["process_id"]
            }),
        },
        ToolDefinition {
            name: "process_write".to_string(),
            description: "Write data to a running process's stdin. A newline is appended automatically if not present.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "process_id": { "type": "string", "description": "The process ID returned by process_start" },
                    "data": { "type": "string", "description": "The data to write to stdin" }
                },
                "required": ["process_id", "data"]
            }),
        },
        ToolDefinition {
            name: "process_kill".to_string(),
            description: "Terminate a running process and clean up its resources.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "process_id": { "type": "string", "description": "The process ID returned by process_start" }
                },
                "required": ["process_id"]
            }),
        },
        ToolDefinition {
            name: "process_list".to_string(),
            description: "List all running processes for the current agent, including their IDs, commands, uptime, and alive status.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        },
        // --- Canvas / A2UI tool ---
        ToolDefinition {
            name: "canvas_present".to_string(),
            description: "Present an interactive HTML canvas to the user. The HTML is sanitized (no scripts, no event handlers) and saved to the workspace. The dashboard will render it in a panel. Use for rich data visualizations, formatted reports, or interactive UI.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "html": { "type": "string", "description": "The HTML content to present. Must not contain <script> tags, event handlers, or javascript: URLs." },
                    "title": { "type": "string", "description": "Optional title for the canvas panel" }
                },
                "required": ["html"]
            }),
        },
    ]
}

// ---------------------------------------------------------------------------
// Filesystem tools
// ---------------------------------------------------------------------------

/// SECURITY: Reject path traversal attempts. Forbids `..` components in file paths.
fn validate_path(path: &str) -> Result<&str, String> {
    for component in std::path::Path::new(path).components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err("Path traversal denied: '..' components are forbidden".to_string());
        }
    }
    Ok(path)
}

/// Resolve a file path through the workspace sandbox (if available) or legacy validation.
fn resolve_file_path(raw_path: &str, workspace_root: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(root) = workspace_root {
        crate::workspace_sandbox::resolve_sandbox_path(raw_path, root)
    } else {
        let _ = validate_path(raw_path)?;
        Ok(PathBuf::from(raw_path))
    }
}

fn resolve_media_path(raw_path: &str, workspace_root: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(root) = workspace_root {
        let path = Path::new(raw_path);
        if path.is_absolute() {
            return crate::workspace_sandbox::resolve_sandbox_path(raw_path, root);
        }

        let mut candidates = vec![PathBuf::from(raw_path)];
        let starts_with_data = path
            .components()
            .next()
            .is_some_and(|component| component.as_os_str() == "data");
        if !starts_with_data {
            candidates.push(Path::new("data").join(path));
        }

        let mut last_err = None;
        for candidate in candidates {
            let candidate_str = candidate.to_string_lossy().to_string();
            match crate::workspace_sandbox::resolve_sandbox_path(&candidate_str, root) {
                Ok(resolved) if resolved.exists() => return Ok(resolved),
                Ok(_) => {
                    last_err = Some(format!(
                        "Resolved media path does not exist: {candidate_str}"
                    ));
                }
                Err(err) => last_err = Some(err),
            }
        }

        Err(last_err.unwrap_or_else(|| format!("Failed to resolve media path: {raw_path}")))
    } else {
        let _ = validate_path(raw_path)?;
        Ok(PathBuf::from(raw_path))
    }
}

fn extract_local_upload_id(image_ref: &str) -> Option<&str> {
    let trimmed = image_ref.trim();
    trimmed
        .strip_prefix("/api/uploads/")
        .or_else(|| trimmed.strip_prefix("api/uploads/"))
        .filter(|value| !value.is_empty())
}

fn should_treat_image_ref_as_url(image_ref: &str) -> bool {
    let trimmed = image_ref.trim();
    trimmed.starts_with("/api/uploads/")
        || trimmed.starts_with("api/uploads/")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
}

fn extract_saved_image_path_from_tool_result_content(
    content: &str,
    file_id: &str,
) -> Option<PathBuf> {
    let payload = serde_json::from_str::<serde_json::Value>(content).ok()?;
    let image_urls = payload.get("image_urls")?.as_array()?;
    let saved_to = payload.get("saved_to")?.as_array()?;

    for (image_url, saved_path) in image_urls.iter().zip(saved_to.iter()) {
        let image_url = image_url.as_str()?;
        let saved_path = saved_path.as_str()?;
        if extract_local_upload_id(image_url) != Some(file_id) {
            continue;
        }
        let path = PathBuf::from(saved_path.trim());
        if path.exists() {
            return Some(path);
        }
    }

    None
}

fn extract_saved_image_path_from_session_line(line: &str, file_id: &str) -> Option<PathBuf> {
    let payload = serde_json::from_str::<serde_json::Value>(line).ok()?;
    let tool_use_entries = payload.get("tool_use")?.as_array()?;

    for entry in tool_use_entries {
        let content = entry.get("content")?.as_str()?;
        if let Some(path) = extract_saved_image_path_from_tool_result_content(content, file_id) {
            return Some(path);
        }
    }

    None
}

fn recover_saved_upload_path_from_workspace(
    file_id: &str,
    workspace_root: Option<&Path>,
) -> Option<PathBuf> {
    let sessions_dir = workspace_root?.join("sessions");
    if !sessions_dir.exists() {
        return None;
    }

    let entries = std::fs::read_dir(&sessions_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }

        let file = std::fs::File::open(&path).ok()?;
        let reader = BufReader::new(file);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(saved_path) = extract_saved_image_path_from_session_line(&line, file_id) {
                return Some(saved_path);
            }
        }
    }

    None
}

async fn tool_file_read(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
) -> Result<String, String> {
    let raw_path = input["path"].as_str().ok_or("Missing 'path' parameter")?;
    let resolved = resolve_file_path(raw_path, workspace_root)?;
    tokio::fs::read_to_string(&resolved)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))
}

async fn tool_file_write(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
) -> Result<String, String> {
    let raw_path = input["path"].as_str().ok_or("Missing 'path' parameter")?;
    let resolved = resolve_file_path(raw_path, workspace_root)?;
    let content = input["content"]
        .as_str()
        .ok_or("Missing 'content' parameter")?;
    if let Some(parent) = resolved.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directories: {e}"))?;
    }
    tokio::fs::write(&resolved, content)
        .await
        .map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(format!(
        "Successfully wrote {} bytes to {}",
        content.len(),
        resolved.display()
    ))
}

async fn tool_file_list(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
) -> Result<String, String> {
    let raw_path = input["path"].as_str().ok_or("Missing 'path' parameter")?;
    let resolved = resolve_file_path(raw_path, workspace_root)?;
    let mut entries = tokio::fs::read_dir(&resolved)
        .await
        .map_err(|e| format!("Failed to list directory: {e}"))?;
    let mut files = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read entry: {e}"))?
    {
        let name = entry.file_name().to_string_lossy().to_string();
        let metadata = entry.metadata().await;
        let suffix = match metadata {
            Ok(m) if m.is_dir() => "/",
            _ => "",
        };
        files.push(format!("{name}{suffix}"));
    }
    files.sort();
    Ok(files.join("\n"))
}

// ---------------------------------------------------------------------------
// Patch tool
// ---------------------------------------------------------------------------

async fn tool_apply_patch(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
) -> Result<String, String> {
    let patch_str = input["patch"].as_str().ok_or("Missing 'patch' parameter")?;
    let root = workspace_root.ok_or("apply_patch requires a workspace root")?;
    let ops = crate::apply_patch::parse_patch(patch_str)?;
    let result = crate::apply_patch::apply_patch(&ops, root).await;
    if result.is_ok() {
        Ok(result.summary())
    } else {
        Err(format!(
            "Patch partially applied: {}. Errors: {}",
            result.summary(),
            result.errors.join("; ")
        ))
    }
}

// ---------------------------------------------------------------------------
// Web tools
// ---------------------------------------------------------------------------

/// Legacy web fetch (no SSRF protection, no readability). Used when WebToolsContext is unavailable.
async fn tool_web_fetch_legacy(input: &serde_json::Value) -> Result<String, String> {
    let url = input["url"].as_str().ok_or("Missing 'url' parameter")?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;
    let status = resp.status();
    // Reject responses larger than 10MB to prevent memory exhaustion
    if let Some(len) = resp.content_length() {
        if len > 10 * 1024 * 1024 {
            return Err(format!("Response too large: {len} bytes (max 10MB)"));
        }
    }
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;
    let max_len = 50_000;
    let truncated = if body.len() > max_len {
        format!(
            "{}... [truncated, {} total bytes]",
            crate::str_utils::safe_truncate_str(&body, max_len),
            body.len()
        )
    } else {
        body
    };
    Ok(format!("HTTP {status}\n\n{truncated}"))
}

/// Legacy web search via DuckDuckGo HTML only. Used when WebToolsContext is unavailable.
async fn tool_web_search_legacy(input: &serde_json::Value) -> Result<String, String> {
    let query = input["query"].as_str().ok_or("Missing 'query' parameter")?;
    let max_results = input["max_results"].as_u64().unwrap_or(5) as usize;

    debug!(query, "Executing web search via DuckDuckGo HTML");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let resp = client
        .get("https://html.duckduckgo.com/html/")
        .query(&[("q", query)])
        .header("User-Agent", "Mozilla/5.0 (compatible; OpenFangAgent/0.1)")
        .send()
        .await
        .map_err(|e| format!("Search request failed: {e}"))?;

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read search response: {e}"))?;

    // Parse DuckDuckGo HTML results
    let results = parse_ddg_results(&body, max_results);

    if results.is_empty() {
        return Ok(format!("No results found for '{query}'."));
    }

    let mut output = format!("Search results for '{query}':\n\n");
    for (i, (title, url, snippet)) in results.iter().enumerate() {
        output.push_str(&format!(
            "{}. {}\n   URL: {}\n   {}\n\n",
            i + 1,
            title,
            url,
            snippet
        ));
    }

    Ok(output)
}

// ---------------------------------------------------------------------------
// Shell tool
// ---------------------------------------------------------------------------

async fn tool_shell_exec(
    input: &serde_json::Value,
    allowed_env: &[String],
    workspace_root: Option<&Path>,
    exec_policy: Option<&openfang_types::config::ExecPolicy>,
) -> Result<String, String> {
    let command = input["command"]
        .as_str()
        .ok_or("Missing 'command' parameter")?;
    // Use LLM-specified timeout, or fall back to exec policy timeout, or default 30s
    let policy_timeout = exec_policy.map(|p| p.timeout_secs).unwrap_or(30);
    let timeout_secs = input["timeout_seconds"].as_u64().unwrap_or(policy_timeout);

    // Shell resolution: prefer sh (Git Bash/MSYS2) on Windows to avoid cmd.exe
    // quoting issues (% expansion mangles yt-dlp templates, " in filenames
    // converted to # by --restrict-filenames). Fall back to cmd if sh not found.
    #[cfg(windows)]
    let git_sh: Option<&str> = {
        const SH_PATHS: &[&str] = &[
            "C:\\Program Files\\Git\\usr\\bin\\sh.exe",
            "C:\\Program Files (x86)\\Git\\usr\\bin\\sh.exe",
        ];
        SH_PATHS
            .iter()
            .copied()
            .find(|p| std::path::Path::new(p).exists())
    };
    let (shell, shell_arg) = if cfg!(windows) {
        #[cfg(windows)]
        {
            if let Some(sh) = git_sh {
                (sh, "-c")
            } else {
                ("cmd", "/C")
            }
        }
        #[cfg(not(windows))]
        {
            ("sh", "-c")
        }
    } else {
        ("sh", "-c")
    };

    let mut cmd = tokio::process::Command::new(shell);
    cmd.arg(shell_arg).arg(command);

    // Set working directory to agent workspace so files are created there
    if let Some(ws) = workspace_root {
        cmd.current_dir(ws);
    }

    // SECURITY: Isolate environment to prevent credential leakage.
    // Hand settings may grant access to specific provider API keys.
    crate::subprocess_sandbox::sandbox_command(&mut cmd, allowed_env);

    // Ensure UTF-8 output on Windows
    #[cfg(windows)]
    cmd.env("PYTHONIOENCODING", "utf-8");

    // Prevent child from inheriting stdin (avoids blocking on Windows)
    cmd.stdin(std::process::Stdio::null());

    let result =
        tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), cmd.output()).await;

    match result {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let exit_code = output.status.code().unwrap_or(-1);

            // Truncate very long outputs to prevent memory issues
            let max_output = 100_000;
            let stdout_str = if stdout.len() > max_output {
                format!(
                    "{}...\n[truncated, {} total bytes]",
                    crate::str_utils::safe_truncate_str(&stdout, max_output),
                    stdout.len()
                )
            } else {
                stdout.to_string()
            };
            let stderr_str = if stderr.len() > max_output {
                format!(
                    "{}...\n[truncated, {} total bytes]",
                    crate::str_utils::safe_truncate_str(&stderr, max_output),
                    stderr.len()
                )
            } else {
                stderr.to_string()
            };

            Ok(format!(
                "Exit code: {exit_code}\n\nSTDOUT:\n{stdout_str}\nSTDERR:\n{stderr_str}"
            ))
        }
        Ok(Err(e)) => Err(format!("Failed to execute command: {e}")),
        Err(_) => Err(format!("Command timed out after {timeout_secs}s")),
    }
}

// ---------------------------------------------------------------------------
// Inter-agent tools
// ---------------------------------------------------------------------------

fn require_kernel(
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<&Arc<dyn KernelHandle>, String> {
    kernel.ok_or_else(|| {
        "Kernel handle not available. Inter-agent tools require a running kernel.".to_string()
    })
}

async fn tool_agent_send(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let agent_id = input["agent_id"]
        .as_str()
        .ok_or("Missing 'agent_id' parameter")?;
    let message = input["message"]
        .as_str()
        .ok_or("Missing 'message' parameter")?;

    // Check + increment inter-agent call depth
    let current_depth = AGENT_CALL_DEPTH.try_with(|d| d.get()).unwrap_or(0);
    if current_depth >= MAX_AGENT_CALL_DEPTH {
        return Err(format!(
            "Inter-agent call depth exceeded (max {}). \
             A->B->C chain is too deep. Use the task queue instead.",
            MAX_AGENT_CALL_DEPTH
        ));
    }

    let response = AGENT_CALL_DEPTH
        .scope(std::cell::Cell::new(current_depth + 1), async {
            kh.send_to_agent(agent_id, message).await
        })
        .await?;

    if let Some(caller_agent_id) = caller_agent_id {
        if let Err(error) = kh
            .record_agent_collaboration(caller_agent_id, agent_id, message, &response)
            .await
        {
            warn!(
                caller_agent_id = %caller_agent_id,
                target_agent_id = %agent_id,
                "Failed to persist agent collaboration memory: {error}"
            );
        }
    }

    Ok(response)
}

async fn tool_agent_spawn(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
    parent_id: Option<&str>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let manifest_toml = input["manifest_toml"]
        .as_str()
        .ok_or("Missing 'manifest_toml' parameter")?;
    let (id, name) = kh.spawn_agent(manifest_toml, parent_id).await?;
    Ok(format!(
        "Agent spawned successfully.\n  ID: {id}\n  Name: {name}"
    ))
}

fn tool_agent_list(kernel: Option<&Arc<dyn KernelHandle>>) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let agents = kh.list_agents();
    if agents.is_empty() {
        return Ok("No agents currently running.".to_string());
    }
    let mut output = format!("Running agents ({}):\n", agents.len());
    for a in &agents {
        output.push_str(&format!(
            "  - {} (id: {}, state: {}, model: {}:{})\n",
            a.name, a.id, a.state, a.model_provider, a.model_name
        ));
    }
    Ok(output)
}

fn tool_agent_kill(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let agent_id = input["agent_id"]
        .as_str()
        .ok_or("Missing 'agent_id' parameter")?;
    kh.kill_agent(agent_id)?;
    Ok(format!("Agent {agent_id} killed successfully."))
}

// ---------------------------------------------------------------------------
// Shared memory tools
// ---------------------------------------------------------------------------

fn tool_memory_store(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let key = input["key"].as_str().ok_or("Missing 'key' parameter")?;
    let value = input.get("value").ok_or("Missing 'value' parameter")?;
    kh.memory_store(key, value.clone())?;
    Ok(format!("Stored value under key '{key}'."))
}

async fn tool_memory_recall(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let key = input["key"].as_str().ok_or("Missing 'key' parameter")?;
    let subject_type = input["subject_type"].as_str();
    let subject_id = input["subject_id"].as_str();
    let limit = input["limit"]
        .as_u64()
        .map(|value| value.clamp(1, 12) as usize)
        .unwrap_or(6);
    match kh.memory_recall(key)? {
        Some(val) => Ok(serde_json::to_string_pretty(&val).unwrap_or_else(|_| val.to_string())),
        None => {
            if let Some(caller_agent_id) = caller_agent_id {
                let results = kh
                    .query_agent_memory(caller_agent_id, key, limit, subject_type, subject_id)
                    .await?;
                if !results.is_empty() {
                    let payload = serde_json::json!({
                        "mode": "unified_memory",
                        "query": key,
                        "subject_type": subject_type,
                        "subject_id": subject_id,
                        "results": results,
                    });
                    return Ok(serde_json::to_string_pretty(&payload)
                        .unwrap_or_else(|_| payload.to_string()));
                }
            }
            Ok(format!("No value found for key '{key}'."))
        }
    }
}

const SELF_IDENTITY_FILES: &[&str] = &[
    "IDENTITY.md",
    "SOUL.md",
    "USER.md",
    "MEMORY.md",
    "AGENTS.md",
    "BOOTSTRAP.md",
    "HEARTBEAT.md",
];

fn require_self_tool_context<'a>(
    kernel: Option<&'a Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&'a str>,
) -> Result<(&'a Arc<dyn KernelHandle>, &'a str), String> {
    let kh = require_kernel(kernel)?;
    let agent_id = caller_agent_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "This self-management tool requires a current agent context.".to_string())?;
    Ok((kh, agent_id))
}

fn bool_flag(input: &serde_json::Value, key: &str) -> bool {
    input
        .get(key)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn parse_self_identity_files(
    value: Option<&serde_json::Value>,
) -> Result<Vec<(String, String)>, String> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let object = value
        .as_object()
        .ok_or_else(|| "'files' must be a JSON object".to_string())?;
    let mut updates = Vec::new();
    for (key, value) in object {
        if !SELF_IDENTITY_FILES.contains(&key.as_str()) {
            return Err(format!("Unsupported self identity file: {key}"));
        }
        let content = value
            .as_str()
            .ok_or_else(|| format!("Content for {key} must be a string"))?;
        updates.push((key.clone(), content.to_string()));
    }
    Ok(updates)
}

fn self_identity_patch_needs_confirmation(
    files: &[(String, String)],
    wants_system_prompt: bool,
    wants_avatar_change: bool,
) -> bool {
    wants_system_prompt
        || wants_avatar_change
        || files
            .iter()
            .any(|(name, _)| matches!(name.as_str(), "IDENTITY.md" | "SOUL.md" | "AGENTS.md"))
}

async fn write_self_identity_file(
    workspace_root: &Path,
    filename: &str,
    mode: &str,
    content: &str,
) -> Result<(), String> {
    let path = workspace_root.join(filename);
    let next = if mode == "append" {
        let existing = tokio::fs::read_to_string(&path).await.unwrap_or_default();
        if existing.trim().is_empty() {
            content.to_string()
        } else {
            format!("{}\n\n{}", existing.trim_end_matches(['\r', '\n']), content)
        }
    } else {
        content.to_string()
    };
    tokio::fs::write(&path, next)
        .await
        .map_err(|e| format!("Failed to write {filename}: {e}"))
}

fn build_memory_audit_block(memory_type: &str, content: &str, reason: Option<&str>) -> String {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut lines = vec![
        format!("## Self Memory Patch {timestamp}"),
        format!("- 类型: {memory_type}"),
        format!("- 内容: {content}"),
    ];
    if let Some(reason) = reason.map(str::trim).filter(|value| !value.is_empty()) {
        lines.push(format!("- 原因: {reason}"));
    }
    lines.join("\n")
}

async fn append_to_memory_md(
    workspace_root: Option<&Path>,
    content: &str,
) -> Result<Option<String>, String> {
    let Some(root) = workspace_root else {
        return Ok(None);
    };
    let path = root.join("MEMORY.md");
    let existing = tokio::fs::read_to_string(&path).await.unwrap_or_default();
    let next = if existing.trim().is_empty() {
        content.to_string()
    } else {
        format!("{}\n\n{}", existing.trim_end_matches(['\r', '\n']), content)
    };
    tokio::fs::write(&path, next)
        .await
        .map_err(|e| format!("Failed to append MEMORY.md audit note: {e}"))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

fn pick_string_field<'a>(value: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
}

fn build_image_asset_metadata(
    input: &serde_json::Value,
    caller_agent_id: Option<&str>,
    default_owner_scope: &str,
    default_source_tool: &str,
    default_purpose: &str,
) -> serde_json::Value {
    let mut metadata = serde_json::Map::new();
    if let Some(agent_id) = caller_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        metadata.insert(
            "agentId".to_string(),
            serde_json::Value::String(agent_id.to_string()),
        );
    }
    metadata.insert(
        "ownerScope".to_string(),
        serde_json::Value::String(
            pick_string_field(input, "asset_owner_scope")
                .unwrap_or(default_owner_scope)
                .to_string(),
        ),
    );
    metadata.insert(
        "sourceTool".to_string(),
        serde_json::Value::String(
            pick_string_field(input, "asset_source_tool")
                .unwrap_or(default_source_tool)
                .to_string(),
        ),
    );
    metadata.insert(
        "purpose".to_string(),
        serde_json::Value::String(
            pick_string_field(input, "asset_purpose")
                .or_else(|| pick_string_field(input, "purpose"))
                .unwrap_or(default_purpose)
                .to_string(),
        ),
    );
    metadata.insert(
        "assetFamily".to_string(),
        serde_json::Value::String(
            pick_string_field(input, "asset_family")
                .unwrap_or("photo")
                .to_string(),
        ),
    );
    metadata.insert(
        "mediaKind".to_string(),
        serde_json::Value::String(
            pick_string_field(input, "media_kind")
                .unwrap_or("image")
                .to_string(),
        ),
    );
    metadata.insert(
        "saveTarget".to_string(),
        serde_json::Value::String(
            pick_string_field(input, "asset_save_target")
                .or_else(|| pick_string_field(input, "save_target"))
                .unwrap_or("output")
                .to_string(),
        ),
    );
    if let Some(meta_label) = pick_string_field(input, "asset_meta_label")
        .or_else(|| pick_string_field(input, "meta_label"))
    {
        metadata.insert(
            "metaLabel".to_string(),
            serde_json::Value::String(meta_label.to_string()),
        );
    }
    if let Some(index_enabled) = input
        .get("asset_index_enabled")
        .and_then(serde_json::Value::as_bool)
    {
        metadata.insert("indexEnabled".to_string(), serde_json::json!(index_enabled));
    }
    serde_json::Value::Object(metadata)
}

fn inject_image_asset_metadata(
    map: &mut serde_json::Map<String, serde_json::Value>,
    caller_agent_id: Option<&str>,
    owner_scope: &str,
    source_tool: &str,
    purpose: Option<&str>,
    save_target: Option<&str>,
    meta_label: Option<&str>,
) {
    if let Some(agent_id) = caller_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        map.insert(
            "agent_id".to_string(),
            serde_json::Value::String(agent_id.to_string()),
        );
    }
    map.insert(
        "asset_owner_scope".to_string(),
        serde_json::Value::String(owner_scope.to_string()),
    );
    map.insert(
        "asset_source_tool".to_string(),
        serde_json::Value::String(source_tool.to_string()),
    );
    map.insert(
        "asset_family".to_string(),
        serde_json::Value::String("photo".to_string()),
    );
    map.insert(
        "media_kind".to_string(),
        serde_json::Value::String("image".to_string()),
    );
    if let Some(purpose) = purpose.filter(|value| !value.trim().is_empty()) {
        map.insert(
            "asset_purpose".to_string(),
            serde_json::Value::String(purpose.trim().to_string()),
        );
    }
    if let Some(save_target) = save_target.filter(|value| !value.trim().is_empty()) {
        map.insert(
            "asset_save_target".to_string(),
            serde_json::Value::String(save_target.trim().to_string()),
        );
    }
    if let Some(meta_label) = meta_label.filter(|value| !value.trim().is_empty()) {
        map.insert(
            "asset_meta_label".to_string(),
            serde_json::Value::String(meta_label.trim().to_string()),
        );
    }
}

fn resolve_self_identity_anchor_source(
    self_ctx: &serde_json::Value,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let mut source = serde_json::Map::new();
    if let Some(url) = self_ctx
        .get("avatar_url")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        source.insert(
            "image_url".to_string(),
            serde_json::Value::String(url.to_string()),
        );
    } else if let Some(url) = self_ctx
        .get("portrait_url")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        source.insert(
            "image_url".to_string(),
            serde_json::Value::String(url.to_string()),
        );
    } else if let Some(url) = self_ctx
        .get("portrait_url")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        source.insert(
            "image_url".to_string(),
            serde_json::Value::String(url.to_string()),
        );
    } else {
        return Err(
            "No self-photo identity anchor is available. my_photo_generate can only continue from your current avatar or portrait. Set the current avatar/portrait first. If you want a brand-new unrelated person or roleplay character, use image_generate instead.".to_string(),
        );
    }
    Ok(source)
}

fn resolve_self_photo_source(
    input: &serde_json::Value,
    self_ctx: &serde_json::Value,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let mut source = serde_json::Map::new();
    if let Some(path) = pick_string_field(input, "image_path") {
        source.insert(
            "image_path".to_string(),
            serde_json::Value::String(path.to_string()),
        );
    } else if let Some(url) = pick_string_field(input, "image_url") {
        source.insert(
            "image_url".to_string(),
            serde_json::Value::String(url.to_string()),
        );
    } else if let Some(base64) = pick_string_field(input, "image_base64") {
        let mime_type = pick_string_field(input, "mime_type")
            .ok_or_else(|| "mime_type is required when image_base64 is provided".to_string())?;
        source.insert(
            "image_base64".to_string(),
            serde_json::Value::String(base64.to_string()),
        );
        source.insert(
            "mime_type".to_string(),
            serde_json::Value::String(mime_type.to_string()),
        );
        return Ok(source);
    } else {
        return resolve_self_identity_anchor_source(self_ctx);
    }
    Ok(source)
}

async fn tool_my_identity_patch(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let (kh, agent_id) = require_self_tool_context(kernel, caller_agent_id)?;
    let files = parse_self_identity_files(input.get("files"))?;
    let system_prompt = input
        .get("system_prompt")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let avatar_change_requested = input.get("avatar_url").is_some();
    let color_requested = input.get("color").is_some();
    if files.is_empty() && system_prompt.is_none() && !avatar_change_requested && !color_requested {
        return Err(
            "my_identity_patch requires at least one file update, system_prompt, avatar_url, or color."
                .to_string(),
        );
    }

    let confirmed = bool_flag(input, "confirmed_by_user");
    if self_identity_patch_needs_confirmation(
        &files,
        system_prompt.is_some(),
        avatar_change_requested,
    ) && !confirmed
    {
        return Err(
            "This self identity patch touches a high-risk self field. Ask the user for explicit confirmation first and then call my_identity_patch with confirmed_by_user=true.".to_string(),
        );
    }

    let mode = input
        .get("mode")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("replace");
    if mode != "replace" && mode != "append" {
        return Err("mode must be either 'replace' or 'append'".to_string());
    }

    let mut updated_files = Vec::new();
    if !files.is_empty() {
        let root = workspace_root.ok_or_else(|| {
            "my_identity_patch requires the current agent workspace to be available for file updates."
                .to_string()
        })?;
        for (filename, content) in &files {
            write_self_identity_file(root, filename, mode, content).await?;
            updated_files.push(filename.clone());
        }
    }

    let mut patch = serde_json::Map::new();
    if let Some(system_prompt) = system_prompt {
        patch.insert(
            "system_prompt".to_string(),
            serde_json::Value::String(system_prompt),
        );
    }
    if let Some(value) = input.get("avatar_url") {
        patch.insert("avatar_url".to_string(), value.clone());
    }
    if let Some(value) = input.get("color") {
        patch.insert("color".to_string(), value.clone());
    }

    let context = if patch.is_empty() {
        kh.get_agent_self_context(agent_id)?
    } else {
        kh.patch_agent_self_context(agent_id, serde_json::Value::Object(patch))?
    };

    let response = serde_json::json!({
        "agent_id": agent_id,
        "updated_files": updated_files,
        "mode": mode,
        "updated_system_prompt": input.get("system_prompt").is_some(),
        "updated_avatar_url": avatar_change_requested,
        "updated_color": color_requested,
        "self_context": context,
    });
    serde_json::to_string_pretty(&response).map_err(|e| format!("Serialize error: {e}"))
}

async fn tool_my_memory_patch(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let (kh, agent_id) = require_self_tool_context(kernel, caller_agent_id)?;
    let content = input
        .get("content")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Missing 'content' parameter".to_string())?;
    let memory_type = input
        .get("memory_type")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("self_upgrade_note");
    let scope = input
        .get("scope")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("self_management");

    let mut metadata = serde_json::Map::new();
    metadata.insert(
        "memory_type".to_string(),
        serde_json::Value::String(memory_type.to_string()),
    );
    if let Some(entity_key) = pick_string_field(input, "entity_key") {
        metadata.insert(
            "entity_key".to_string(),
            serde_json::Value::String(entity_key.to_string()),
        );
    }
    if let Some(reason) = pick_string_field(input, "reason") {
        metadata.insert(
            "reason".to_string(),
            serde_json::Value::String(reason.to_string()),
        );
    }
    if let Some(importance) = input.get("importance").and_then(serde_json::Value::as_f64) {
        metadata.insert(
            "importance".to_string(),
            serde_json::json!(importance.clamp(0.0, 1.0)),
        );
    }
    if let Some(confidence) = input.get("confidence").and_then(serde_json::Value::as_f64) {
        metadata.insert(
            "confidence".to_string(),
            serde_json::json!(confidence.clamp(0.0, 1.0)),
        );
    }

    let memory_result = kh
        .remember_agent_memory(
            agent_id,
            content,
            scope,
            serde_json::Value::Object(metadata),
        )
        .await?;

    let memory_md_path = if input
        .get("append_to_memory_md")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true)
    {
        append_to_memory_md(
            workspace_root,
            &build_memory_audit_block(memory_type, content, pick_string_field(input, "reason")),
        )
        .await?
    } else {
        None
    };

    let response = serde_json::json!({
        "agent_id": agent_id,
        "memory": memory_result,
        "memory_md_path": memory_md_path,
    });
    serde_json::to_string_pretty(&response).map_err(|e| format!("Serialize error: {e}"))
}

async fn tool_my_photo_generate(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let (kh, agent_id) = require_self_tool_context(kernel, caller_agent_id)?;
    if bool_flag(input, "allow_identity_change") || bool_flag(input, "confirmed_by_user") {
        return Err(
            "my_photo_generate 不允许替换或重置自己的身份锚点。它只能基于当前头像/自有照片继续生成自己的照片；如果要生成无关人物或全新角色，请改用 image_generate。".to_string(),
        );
    }

    let self_ctx = kh.get_agent_self_context(agent_id)?;
    let mut delegated = serde_json::Map::new();
    let prompt = input["prompt"]
        .as_str()
        .ok_or("Missing 'prompt' parameter")?;
    let purpose = pick_string_field(input, "purpose").unwrap_or("self_photo");
    delegated.insert(
        "prompt".to_string(),
        serde_json::Value::String(format!(
            "Create a new {purpose} of the same agent identity. Keep the same face/person and treat the source image as the identity anchor. User request: {prompt}"
        )),
    );
    delegated.extend(resolve_self_identity_anchor_source(&self_ctx)?);
    for key in [
        "negative_prompt",
        "model",
        "size",
        "width",
        "height",
        "quality",
        "count",
    ] {
        if let Some(value) = input.get(key) {
            delegated.insert(key.to_string(), value.clone());
        }
    }
    inject_image_asset_metadata(
        &mut delegated,
        caller_agent_id,
        "self",
        "my_photo_generate",
        Some(purpose),
        pick_string_field(input, "save_target").or(Some("agent_profile_meta")),
        pick_string_field(input, "meta_label").or(Some(purpose)),
    );
    tool_image_edit(
        &serde_json::Value::Object(delegated),
        workspace_root,
        kernel,
        caller_agent_id,
    )
    .await
}

async fn tool_my_photo_edit(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let (kh, agent_id) = require_self_tool_context(kernel, caller_agent_id)?;
    let self_ctx = kh.get_agent_self_context(agent_id)?;
    let mut delegated = serde_json::Map::new();
    let prompt = input["prompt"]
        .as_str()
        .ok_or("Missing 'prompt' parameter")?;
    let purpose = pick_string_field(input, "purpose").unwrap_or("self_photo_edit");
    delegated.insert(
        "prompt".to_string(),
        serde_json::Value::String(format!(
            "Edit the current agent self-photo for {purpose} while preserving the exact same identity. User request: {prompt}"
        )),
    );
    delegated.extend(resolve_self_photo_source(input, &self_ctx)?);
    for key in [
        "negative_prompt",
        "model",
        "size",
        "width",
        "height",
        "quality",
        "count",
    ] {
        if let Some(value) = input.get(key) {
            delegated.insert(key.to_string(), value.clone());
        }
    }
    inject_image_asset_metadata(
        &mut delegated,
        caller_agent_id,
        "self",
        "my_photo_edit",
        Some(purpose),
        pick_string_field(input, "save_target").or(Some("agent_profile_meta")),
        pick_string_field(input, "meta_label").or(Some(purpose)),
    );
    tool_image_edit(
        &serde_json::Value::Object(delegated),
        workspace_root,
        kernel,
        caller_agent_id,
    )
    .await
}

// ---------------------------------------------------------------------------
// Collaboration tools
// ---------------------------------------------------------------------------

fn tool_agent_find(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let query = input["query"].as_str().ok_or("Missing 'query' parameter")?;
    let agents = kh.find_agents(query);
    if agents.is_empty() {
        return Ok(format!("No agents found matching '{query}'."));
    }
    let result: Vec<serde_json::Value> = agents
        .iter()
        .map(|a| {
            serde_json::json!({
                "id": a.id,
                "name": a.name,
                "state": a.state,
                "description": a.description,
                "tags": a.tags,
                "tools": a.tools,
                "model": format!("{}:{}", a.model_provider, a.model_name),
            })
        })
        .collect();
    serde_json::to_string_pretty(&result).map_err(|e| format!("Serialize error: {e}"))
}

async fn tool_task_post(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let title = input["title"].as_str().ok_or("Missing 'title' parameter")?;
    let description = input["description"]
        .as_str()
        .ok_or("Missing 'description' parameter")?;
    let assigned_to = input["assigned_to"].as_str();
    let task_id = kh
        .task_post(title, description, assigned_to, caller_agent_id)
        .await?;
    Ok(format!("Task created with ID: {task_id}"))
}

async fn tool_task_claim(
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let agent_id = caller_agent_id.unwrap_or("");
    match kh.task_claim(agent_id).await? {
        Some(task) => {
            serde_json::to_string_pretty(&task).map_err(|e| format!("Serialize error: {e}"))
        }
        None => Ok("No tasks available.".to_string()),
    }
}

async fn tool_task_complete(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let task_id = input["task_id"]
        .as_str()
        .ok_or("Missing 'task_id' parameter")?;
    let result = input["result"]
        .as_str()
        .ok_or("Missing 'result' parameter")?;
    kh.task_complete(task_id, result).await?;
    Ok(format!("Task {task_id} marked as completed."))
}

async fn tool_task_list(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let status = input["status"].as_str();
    let tasks = kh.task_list(status).await?;
    if tasks.is_empty() {
        return Ok("No tasks found.".to_string());
    }
    serde_json::to_string_pretty(&tasks).map_err(|e| format!("Serialize error: {e}"))
}

async fn tool_event_publish(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let event_type = input["event_type"]
        .as_str()
        .ok_or("Missing 'event_type' parameter")?;
    let payload = input
        .get("payload")
        .cloned()
        .unwrap_or(serde_json::json!({}));
    kh.publish_event(event_type, payload).await?;
    Ok(format!("Event '{event_type}' published successfully."))
}

// ---------------------------------------------------------------------------
// Knowledge graph tools
// ---------------------------------------------------------------------------

fn parse_entity_type(s: &str) -> openfang_types::memory::EntityType {
    use openfang_types::memory::EntityType;
    match s.to_lowercase().as_str() {
        "person" => EntityType::Person,
        "organization" | "org" => EntityType::Organization,
        "project" => EntityType::Project,
        "concept" => EntityType::Concept,
        "event" => EntityType::Event,
        "location" => EntityType::Location,
        "document" | "doc" => EntityType::Document,
        "tool" => EntityType::Tool,
        other => EntityType::Custom(other.to_string()),
    }
}

fn parse_relation_type(s: &str) -> openfang_types::memory::RelationType {
    use openfang_types::memory::RelationType;
    match s.to_lowercase().as_str() {
        "works_at" | "worksat" => RelationType::WorksAt,
        "knows_about" | "knowsabout" | "knows" => RelationType::KnowsAbout,
        "related_to" | "relatedto" | "related" => RelationType::RelatedTo,
        "depends_on" | "dependson" | "depends" => RelationType::DependsOn,
        "owned_by" | "ownedby" => RelationType::OwnedBy,
        "created_by" | "createdby" => RelationType::CreatedBy,
        "located_in" | "locatedin" => RelationType::LocatedIn,
        "part_of" | "partof" => RelationType::PartOf,
        "uses" => RelationType::Uses,
        "produces" => RelationType::Produces,
        other => RelationType::Custom(other.to_string()),
    }
}

async fn tool_knowledge_add_entity(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let name = input["name"].as_str().ok_or("Missing 'name' parameter")?;
    let entity_type_str = input["entity_type"]
        .as_str()
        .ok_or("Missing 'entity_type' parameter")?;
    let properties = input
        .get("properties")
        .and_then(|v| v.as_object())
        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();

    let entity = openfang_types::memory::Entity {
        id: String::new(), // kernel/store assigns a real ID
        entity_type: parse_entity_type(entity_type_str),
        name: name.to_string(),
        properties,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };

    let id = kh.knowledge_add_entity(entity).await?;
    Ok(format!("Entity '{name}' added with ID: {id}"))
}

async fn tool_knowledge_add_relation(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let source = input["source"]
        .as_str()
        .ok_or("Missing 'source' parameter")?;
    let relation_str = input["relation"]
        .as_str()
        .ok_or("Missing 'relation' parameter")?;
    let target = input["target"]
        .as_str()
        .ok_or("Missing 'target' parameter")?;
    let confidence = input["confidence"].as_f64().unwrap_or(1.0) as f32;
    let properties = input
        .get("properties")
        .and_then(|v| v.as_object())
        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();

    let relation = openfang_types::memory::Relation {
        source: source.to_string(),
        relation: parse_relation_type(relation_str),
        target: target.to_string(),
        properties,
        confidence,
        created_at: chrono::Utc::now(),
    };

    let id = kh.knowledge_add_relation(relation).await?;
    Ok(format!(
        "Relation '{source}' --[{relation_str}]--> '{target}' added with ID: {id}"
    ))
}

async fn tool_knowledge_query(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let source = input["source"].as_str().map(|s| s.to_string());
    let target = input["target"].as_str().map(|s| s.to_string());
    let relation = input["relation"].as_str().map(parse_relation_type);
    let max_depth = input["max_depth"].as_u64().unwrap_or(1) as u32;

    let pattern = openfang_types::memory::GraphPattern {
        source,
        relation,
        target,
        max_depth,
    };

    let matches = kh.knowledge_query(pattern).await?;
    if matches.is_empty() {
        return Ok("No matching knowledge graph entries found.".to_string());
    }

    let mut output = format!("Found {} match(es):\n", matches.len());
    for m in &matches {
        output.push_str(&format!(
            "\n  {} ({:?}) --[{:?} ({:.0}%)]--> {} ({:?})",
            m.source.name,
            m.source.entity_type,
            m.relation.relation,
            m.relation.confidence * 100.0,
            m.target.name,
            m.target.entity_type,
        ));
    }
    Ok(output)
}

// ---------------------------------------------------------------------------
// Scheduling tools
// ---------------------------------------------------------------------------

/// Parse a natural language schedule into a cron expression.
fn parse_schedule_to_cron(input: &str) -> Result<String, String> {
    let input = input.trim().to_lowercase();

    // If it already looks like a cron expression (5 space-separated fields), pass through
    let parts: Vec<&str> = input.split_whitespace().collect();
    if parts.len() == 5
        && parts
            .iter()
            .all(|p| p.chars().all(|c| c.is_ascii_digit() || "*/,-".contains(c)))
    {
        return Ok(input);
    }

    // Natural language patterns
    if let Some(rest) = input.strip_prefix("every ") {
        if rest == "minute" || rest == "1 minute" {
            return Ok("* * * * *".to_string());
        }
        if let Some(mins) = rest.strip_suffix(" minutes") {
            let n: u32 = mins
                .trim()
                .parse()
                .map_err(|_| format!("Invalid number in '{input}'"))?;
            if n == 0 || n > 59 {
                return Err(format!("Minutes must be 1-59, got {n}"));
            }
            return Ok(format!("*/{n} * * * *"));
        }
        if rest == "hour" || rest == "1 hour" {
            return Ok("0 * * * *".to_string());
        }
        if let Some(hrs) = rest.strip_suffix(" hours") {
            let n: u32 = hrs
                .trim()
                .parse()
                .map_err(|_| format!("Invalid number in '{input}'"))?;
            if n == 0 || n > 23 {
                return Err(format!("Hours must be 1-23, got {n}"));
            }
            return Ok(format!("0 */{n} * * *"));
        }
        if rest == "day" || rest == "1 day" {
            return Ok("0 0 * * *".to_string());
        }
        if rest == "week" || rest == "1 week" {
            return Ok("0 0 * * 0".to_string());
        }
    }

    // "daily at Xam/pm"
    if let Some(time_str) = input.strip_prefix("daily at ") {
        let hour = parse_time_to_hour(time_str)?;
        return Ok(format!("0 {hour} * * *"));
    }

    // "weekdays at Xam/pm"
    if let Some(time_str) = input.strip_prefix("weekdays at ") {
        let hour = parse_time_to_hour(time_str)?;
        return Ok(format!("0 {hour} * * 1-5"));
    }

    // "weekends at Xam/pm"
    if let Some(time_str) = input.strip_prefix("weekends at ") {
        let hour = parse_time_to_hour(time_str)?;
        return Ok(format!("0 {hour} * * 0,6"));
    }

    // "hourly" / "daily" / "weekly" / "monthly"
    match input.as_str() {
        "hourly" => return Ok("0 * * * *".to_string()),
        "daily" => return Ok("0 0 * * *".to_string()),
        "weekly" => return Ok("0 0 * * 0".to_string()),
        "monthly" => return Ok("0 0 1 * *".to_string()),
        _ => {}
    }

    Err(format!(
        "Could not parse schedule '{input}'. Try: 'every 5 minutes', 'daily at 9am', 'weekdays at 6pm', or a cron expression like '0 */5 * * *'"
    ))
}

/// Parse a time string like "9am", "6pm", "14:00", "9:30am" into an hour (0-23).
fn parse_time_to_hour(s: &str) -> Result<u32, String> {
    let s = s.trim().to_lowercase();

    // Handle "9am", "6pm", "12pm", "12am"
    if let Some(h) = s.strip_suffix("am") {
        let hour: u32 = h.trim().parse().map_err(|_| format!("Invalid time: {s}"))?;
        return match hour {
            12 => Ok(0),
            1..=11 => Ok(hour),
            _ => Err(format!("Invalid hour: {hour}")),
        };
    }
    if let Some(h) = s.strip_suffix("pm") {
        let hour: u32 = h.trim().parse().map_err(|_| format!("Invalid time: {s}"))?;
        return match hour {
            12 => Ok(12),
            1..=11 => Ok(hour + 12),
            _ => Err(format!("Invalid hour: {hour}")),
        };
    }

    // Handle "14:00" or "9:30"
    if let Some((h, _m)) = s.split_once(':') {
        let hour: u32 = h.trim().parse().map_err(|_| format!("Invalid time: {s}"))?;
        if hour > 23 {
            return Err(format!("Hour must be 0-23, got {hour}"));
        }
        return Ok(hour);
    }

    // Plain number
    let hour: u32 = s.parse().map_err(|_| format!("Invalid time: {s}"))?;
    if hour > 23 {
        return Err(format!("Hour must be 0-23, got {hour}"));
    }
    Ok(hour)
}

const SCHEDULES_KEY: &str = "__openfang_schedules";

async fn tool_schedule_create(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let description = input["description"]
        .as_str()
        .ok_or("Missing 'description' parameter")?;
    let schedule_str = input["schedule"]
        .as_str()
        .ok_or("Missing 'schedule' parameter")?;
    let agent = input["agent"].as_str().unwrap_or("");

    let cron_expr = parse_schedule_to_cron(schedule_str)?;
    let schedule_id = uuid::Uuid::new_v4().to_string();

    let entry = serde_json::json!({
        "id": schedule_id,
        "description": description,
        "schedule_input": schedule_str,
        "cron": cron_expr,
        "agent": agent,
        "created_at": chrono::Utc::now().to_rfc3339(),
        "enabled": true,
    });

    // Load existing schedules from shared memory
    let mut schedules: Vec<serde_json::Value> = match kh.memory_recall(SCHEDULES_KEY)? {
        Some(serde_json::Value::Array(arr)) => arr,
        _ => Vec::new(),
    };

    schedules.push(entry);
    kh.memory_store(SCHEDULES_KEY, serde_json::Value::Array(schedules))?;

    Ok(format!(
        "Schedule created:\n  ID: {schedule_id}\n  Description: {description}\n  Cron: {cron_expr}\n  Original: {schedule_str}"
    ))
}

async fn tool_schedule_list(kernel: Option<&Arc<dyn KernelHandle>>) -> Result<String, String> {
    let kh = require_kernel(kernel)?;

    let schedules: Vec<serde_json::Value> = match kh.memory_recall(SCHEDULES_KEY)? {
        Some(serde_json::Value::Array(arr)) => arr,
        _ => Vec::new(),
    };

    if schedules.is_empty() {
        return Ok("No scheduled tasks.".to_string());
    }

    let mut output = format!("Scheduled tasks ({}):\n\n", schedules.len());
    for s in &schedules {
        let enabled = s["enabled"].as_bool().unwrap_or(true);
        let status = if enabled { "active" } else { "paused" };
        output.push_str(&format!(
            "  [{status}] {} — {}\n    Cron: {} | Agent: {}\n    Created: {}\n\n",
            s["id"].as_str().unwrap_or("?"),
            s["description"].as_str().unwrap_or("?"),
            s["cron"].as_str().unwrap_or("?"),
            s["agent"].as_str().unwrap_or("(self)"),
            s["created_at"].as_str().unwrap_or("?"),
        ));
    }

    Ok(output)
}

async fn tool_schedule_delete(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let id = input["id"].as_str().ok_or("Missing 'id' parameter")?;

    let mut schedules: Vec<serde_json::Value> = match kh.memory_recall(SCHEDULES_KEY)? {
        Some(serde_json::Value::Array(arr)) => arr,
        _ => Vec::new(),
    };

    let before = schedules.len();
    schedules.retain(|s| s["id"].as_str() != Some(id));

    if schedules.len() == before {
        return Err(format!("Schedule '{id}' not found."));
    }

    kh.memory_store(SCHEDULES_KEY, serde_json::Value::Array(schedules))?;
    Ok(format!("Schedule '{id}' deleted."))
}

// ---------------------------------------------------------------------------
// Cron scheduling tools (delegated to kernel via KernelHandle trait)
// ---------------------------------------------------------------------------

async fn tool_cron_create(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let agent_id = caller_agent_id.ok_or("Agent ID required for cron_create")?;
    kh.cron_create(agent_id, normalize_cron_create_input_for_tool(input))
        .await
}

fn normalize_cron_create_input_for_tool(input: &serde_json::Value) -> serde_json::Value {
    let Some(obj) = input.as_object() else {
        return input.clone();
    };

    let Some(action) = obj.get("action").and_then(|v| v.as_object()) else {
        return input.clone();
    };

    let kind = action
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();

    if kind != "system_event" {
        return input.clone();
    }

    let force_system_event = action
        .get("force_system_event")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if force_system_event {
        return input.clone();
    }

    // Auto-upgrade accidental system_event → agent_turn.
    // This is a safe default for chat-style scheduling requests, and prevents
    // "runs" from just echoing the event text without executing the agent.
    let text = action
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    let timeout_secs = action
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .or_else(|| obj.get("timeout_secs").and_then(|v| v.as_u64()))
        .unwrap_or(180);

    let message = if !text.is_empty() {
        text.to_string()
    } else {
        obj.get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("scheduled task")
            .to_string()
    };

    let mut next = input.clone();
    if let Some(next_obj) = next.as_object_mut() {
        next_obj.insert(
            "action".to_string(),
            serde_json::json!({
                "kind": "agent_turn",
                "message": message,
                "model_override": null,
                "timeout_secs": timeout_secs
            }),
        );
    }
    next
}

async fn tool_cron_list(
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let agent_id = caller_agent_id.ok_or("Agent ID required for cron_list")?;
    let jobs = kh.cron_list(agent_id).await?;
    serde_json::to_string_pretty(&jobs).map_err(|e| format!("Failed to serialize cron jobs: {e}"))
}

async fn tool_cron_cancel(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let job_id = input["job_id"]
        .as_str()
        .ok_or("Missing 'job_id' parameter")?;
    kh.cron_cancel(job_id).await?;
    Ok(format!("Cron job '{job_id}' cancelled."))
}

// ---------------------------------------------------------------------------
// Channel send tool (proactive outbound messaging via configured adapters)
// ---------------------------------------------------------------------------

async fn tool_channel_send(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;

    let channel = input["channel"]
        .as_str()
        .ok_or("Missing 'channel' parameter")?
        .trim()
        .to_lowercase();
    let recipient = input["recipient"]
        .as_str()
        .ok_or("Missing 'recipient' parameter")?
        .trim();

    if recipient.is_empty() {
        return Err("Recipient cannot be empty".to_string());
    }

    // Check for media content (image_url or file_url)
    let image_url = input["image_url"].as_str().filter(|s| !s.is_empty());
    let file_url = input["file_url"].as_str().filter(|s| !s.is_empty());

    if let Some(url) = image_url {
        let caption = input["message"].as_str().filter(|s| !s.is_empty());
        return kh
            .send_channel_media(&channel, recipient, "image", url, caption, None)
            .await;
    }

    if let Some(url) = file_url {
        let caption = input["message"].as_str().filter(|s| !s.is_empty());
        let filename = input["filename"].as_str();
        return kh
            .send_channel_media(&channel, recipient, "file", url, caption, filename)
            .await;
    }

    // Text-only message
    let message = input["message"]
        .as_str()
        .ok_or("Missing 'message' parameter (required for text messages)")?;

    if message.is_empty() {
        return Err("Message cannot be empty".to_string());
    }

    // For email channels, validate email format and prepend subject
    let final_message = if channel == "email" {
        if !recipient.contains('@') || !recipient.contains('.') {
            return Err(format!("Invalid email address: '{recipient}'"));
        }
        if let Some(subject) = input["subject"].as_str() {
            if !subject.is_empty() {
                format!("Subject: {subject}\n\n{message}")
            } else {
                message.to_string()
            }
        } else {
            message.to_string()
        }
    } else {
        message.to_string()
    };

    kh.send_channel_message(&channel, recipient, &final_message)
        .await
}

// ---------------------------------------------------------------------------
// Hand tools (delegated to kernel via KernelHandle trait)
// ---------------------------------------------------------------------------

async fn tool_hand_list(kernel: Option<&Arc<dyn KernelHandle>>) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let hands = kh.hand_list().await?;

    if hands.is_empty() {
        return Ok(
            "No Hands available. Install hands to enable curated autonomous packages.".to_string(),
        );
    }

    let mut lines = vec!["Available Hands:".to_string(), String::new()];
    for h in &hands {
        let icon = h["icon"].as_str().unwrap_or("");
        let name = h["name"].as_str().unwrap_or("?");
        let id = h["id"].as_str().unwrap_or("?");
        let status = h["status"].as_str().unwrap_or("unknown");
        let desc = h["description"].as_str().unwrap_or("");

        let status_marker = match status {
            "Active" => "[ACTIVE]",
            "Paused" => "[PAUSED]",
            _ => "[available]",
        };

        lines.push(format!("{} {} ({}) {}", icon, name, id, status_marker));
        if !desc.is_empty() {
            lines.push(format!("  {}", desc));
        }
        if let Some(iid) = h["instance_id"].as_str() {
            lines.push(format!("  Instance: {}", iid));
        }
        lines.push(String::new());
    }

    Ok(lines.join("\n"))
}

async fn tool_hand_activate(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let hand_id = input["hand_id"]
        .as_str()
        .ok_or("Missing 'hand_id' parameter")?;
    let config: std::collections::HashMap<String, serde_json::Value> =
        if let Some(obj) = input["config"].as_object() {
            obj.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
        } else {
            std::collections::HashMap::new()
        };

    let result = kh.hand_activate(hand_id, config).await?;

    let instance_id = result["instance_id"].as_str().unwrap_or("?");
    let agent_name = result["agent_name"].as_str().unwrap_or("?");
    let status = result["status"].as_str().unwrap_or("?");

    Ok(format!(
        "Hand '{}' activated!\n  Instance: {}\n  Agent: {} ({})",
        hand_id, instance_id, agent_name, status
    ))
}

async fn tool_hand_status(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let hand_id = input["hand_id"]
        .as_str()
        .ok_or("Missing 'hand_id' parameter")?;

    let result = kh.hand_status(hand_id).await?;

    let icon = result["icon"].as_str().unwrap_or("");
    let name = result["name"].as_str().unwrap_or(hand_id);
    let status = result["status"].as_str().unwrap_or("unknown");
    let instance_id = result["instance_id"].as_str().unwrap_or("?");
    let agent_name = result["agent_name"].as_str().unwrap_or("?");
    let activated = result["activated_at"].as_str().unwrap_or("?");

    Ok(format!(
        "{} {} — {}\n  Instance: {}\n  Agent: {}\n  Activated: {}",
        icon, name, status, instance_id, agent_name, activated
    ))
}

async fn tool_hand_deactivate(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let instance_id = input["instance_id"]
        .as_str()
        .ok_or("Missing 'instance_id' parameter")?;
    kh.hand_deactivate(instance_id).await?;
    Ok(format!("Hand instance '{}' deactivated.", instance_id))
}

// ---------------------------------------------------------------------------
// A2A outbound tools (cross-instance agent communication)
// ---------------------------------------------------------------------------

/// Discover an external A2A agent by fetching its agent card.
async fn tool_a2a_discover(input: &serde_json::Value) -> Result<String, String> {
    let url = input["url"].as_str().ok_or("Missing 'url' parameter")?;

    // SSRF protection: block private/metadata IPs
    if crate::web_fetch::check_ssrf(url).is_err() {
        return Err("SSRF blocked: URL resolves to a private or metadata address".to_string());
    }

    let client = crate::a2a::A2aClient::new();
    let card = client.discover(url).await?;

    serde_json::to_string_pretty(&card).map_err(|e| format!("Serialization error: {e}"))
}

/// Send a task to an external A2A agent.
async fn tool_a2a_send(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
) -> Result<String, String> {
    let kh = require_kernel(kernel)?;
    let message = input["message"]
        .as_str()
        .ok_or("Missing 'message' parameter")?;

    // Resolve agent URL: either directly provided or looked up by name
    let url = if let Some(url) = input["agent_url"].as_str() {
        // SSRF protection
        if crate::web_fetch::check_ssrf(url).is_err() {
            return Err("SSRF blocked: URL resolves to a private or metadata address".to_string());
        }
        url.to_string()
    } else if let Some(name) = input["agent_name"].as_str() {
        kh.get_a2a_agent_url(name)
            .ok_or_else(|| format!("No known A2A agent with name '{name}'. Use a2a_discover first or provide agent_url directly."))?
    } else {
        return Err("Missing 'agent_url' or 'agent_name' parameter".to_string());
    };

    let session_id = input["session_id"].as_str();
    let client = crate::a2a::A2aClient::new();
    let task = client.send_task(&url, message, session_id).await?;

    serde_json::to_string_pretty(&task).map_err(|e| format!("Serialization error: {e}"))
}

// ---------------------------------------------------------------------------
// Image analysis tool
// ---------------------------------------------------------------------------

async fn tool_image_analyze(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    media_engine: Option<&MediaEngine>,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let raw_path = input["path"].as_str().ok_or("Missing 'path' parameter")?;
    let prompt = input["prompt"].as_str().map(str::trim).unwrap_or("");
    let path = resolve_media_path(raw_path, workspace_root)?;

    let data = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Failed to read image '{}': {e}", raw_path))?;

    let file_size = data.len();

    // Detect image format from magic bytes
    let format = detect_image_format(&data);

    // Extract dimensions for common formats
    let dimensions = extract_image_dimensions(&data, &format);

    // Base64-encode (truncate for very large images in the response)
    let full_base64_preview = if file_size <= 512 * 1024 {
        // Under 512KB — include full base64
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(&data)
    } else {
        // Over 512KB — include first 64KB preview
        use base64::Engine;
        let preview_bytes = &data[..64 * 1024];
        format!(
            "{}... [truncated, {} total bytes]",
            base64::engine::general_purpose::STANDARD.encode(preview_bytes),
            file_size
        )
    };

    let mut result = serde_json::json!({
        "path": path.to_string_lossy().to_string(),
        "format": format,
        "file_size_bytes": file_size,
        "file_size_human": format_file_size(file_size),
    });

    if let Some((w, h)) = dimensions {
        result["width"] = serde_json::json!(w);
        result["height"] = serde_json::json!(h);
    }

    if !prompt.is_empty() {
        result["prompt"] = serde_json::json!(prompt);
        let mime = match format.as_str() {
            "png" => Some("image/png"),
            "jpeg" | "jpg" => Some("image/jpeg"),
            "gif" => Some("image/gif"),
            "webp" => Some("image/webp"),
            "bmp" => Some("image/bmp"),
            "svg" => Some("image/svg+xml"),
            _ => None,
        };
        let vision_result = match mime {
            Some(mime_type) => {
                let local_vision_error =
                    match crate::local_vision::analyze_image_path_with_local_service(
                        &path,
                        mime_type,
                        Some(prompt),
                    )
                    .await
                    {
                        Ok(Some(understanding)) => {
                            let local_json = serde_json::to_value(&understanding)
                                .map_err(|e| format!("Serialize error: {e}"))?;
                            result["vision_analysis"] = local_json;
                            return serde_json::to_string_pretty(&result)
                                .map_err(|e| format!("Serialize error: {e}"));
                        }
                        Ok(None) => None,
                        Err(err) => Some(err),
                    };
                describe_image_bytes_with_timeouts(
                    prompt,
                    mime_type,
                    &data,
                    media_engine,
                    kernel,
                    caller_agent_id,
                    std::time::Duration::from_secs(CURRENT_MODEL_VISION_TIMEOUT_SECS),
                    std::time::Duration::from_secs(FALLBACK_VISION_TIMEOUT_SECS),
                )
                .await
                .map_err(|err| match local_vision_error {
                    Some(local_err) => {
                        format!("Local Florence-2 path failed: {local_err} | {err}")
                    }
                    None => err,
                })
            }
            None => Err(format!("Unsupported image format: .{format}")),
        };
        let vision_json = vision_result
            .map_err(|err| format!("Image analysis failed for '{}': {err}", raw_path))?;
        let vision_result = serde_json::from_str::<serde_json::Value>(&vision_json)
            .unwrap_or_else(|_| serde_json::json!({ "raw": vision_json }));
        result["vision_analysis"] = vision_result;
        return serde_json::to_string_pretty(&result).map_err(|e| format!("Serialize error: {e}"));
    } else {
        result["base64_preview"] = serde_json::json!(full_base64_preview);
    }

    serde_json::to_string_pretty(&result).map_err(|e| format!("Serialize error: {e}"))
}

/// Detect image format from magic bytes.
fn detect_image_format(data: &[u8]) -> String {
    if data.len() < 4 {
        return "unknown".to_string();
    }
    if data.starts_with(b"\x89PNG") {
        "png".to_string()
    } else if data.starts_with(b"\xFF\xD8\xFF") {
        "jpeg".to_string()
    } else if data.starts_with(b"GIF8") {
        "gif".to_string()
    } else if data.starts_with(b"RIFF") && data.len() > 12 && &data[8..12] == b"WEBP" {
        "webp".to_string()
    } else if data.starts_with(b"BM") {
        "bmp".to_string()
    } else if data.starts_with(b"\x00\x00\x01\x00") {
        "ico".to_string()
    } else {
        "unknown".to_string()
    }
}

/// Extract image dimensions from common formats.
fn extract_image_dimensions(data: &[u8], format: &str) -> Option<(u32, u32)> {
    match format {
        "png" => {
            // PNG: IHDR chunk starts at byte 16, width at 16-19, height at 20-23
            if data.len() >= 24 {
                let w = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
                let h = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
                Some((w, h))
            } else {
                None
            }
        }
        "gif" => {
            // GIF: width at bytes 6-7, height at bytes 8-9 (little-endian)
            if data.len() >= 10 {
                let w = u16::from_le_bytes([data[6], data[7]]) as u32;
                let h = u16::from_le_bytes([data[8], data[9]]) as u32;
                Some((w, h))
            } else {
                None
            }
        }
        "bmp" => {
            // BMP: width at bytes 18-21, height at bytes 22-25 (little-endian)
            if data.len() >= 26 {
                let w = u32::from_le_bytes([data[18], data[19], data[20], data[21]]);
                let h = u32::from_le_bytes([data[22], data[23], data[24], data[25]]);
                Some((w, h))
            } else {
                None
            }
        }
        "jpeg" => {
            // JPEG: scan for SOF0 marker (0xFF 0xC0) to find dimensions
            extract_jpeg_dimensions(data)
        }
        _ => None,
    }
}

/// Extract JPEG dimensions by scanning for SOF markers.
fn extract_jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let mut i = 2; // Skip SOI marker
    while i + 1 < data.len() {
        if data[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = data[i + 1];
        // SOF0-SOF3 markers contain dimensions
        if (0xC0..=0xC3).contains(&marker) && i + 9 < data.len() {
            let h = u16::from_be_bytes([data[i + 5], data[i + 6]]) as u32;
            let w = u16::from_be_bytes([data[i + 7], data[i + 8]]) as u32;
            return Some((w, h));
        }
        if i + 3 < data.len() {
            let seg_len = u16::from_be_bytes([data[i + 2], data[i + 3]]) as usize;
            i += 2 + seg_len;
        } else {
            break;
        }
    }
    None
}

/// Format file size in human-readable form.
fn format_file_size(bytes: usize) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

// ---------------------------------------------------------------------------
// Location tool
// ---------------------------------------------------------------------------

async fn tool_location_get() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    // Use ip-api.com (free, no API key, JSON response)
    let resp = client
        .get("https://ip-api.com/json/?fields=status,message,country,regionName,city,zip,lat,lon,timezone,isp,query")
        .header("User-Agent", "OpenFang/0.1")
        .send()
        .await
        .map_err(|e| format!("Location request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Location API returned {}", resp.status()));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse location response: {e}"))?;

    if body["status"].as_str() != Some("success") {
        let msg = body["message"].as_str().unwrap_or("Unknown error");
        return Err(format!("Location lookup failed: {msg}"));
    }

    let result = serde_json::json!({
        "lat": body["lat"],
        "lon": body["lon"],
        "city": body["city"],
        "region": body["regionName"],
        "country": body["country"],
        "zip": body["zip"],
        "timezone": body["timezone"],
        "isp": body["isp"],
        "ip": body["query"],
    });

    serde_json::to_string_pretty(&result).map_err(|e| format!("Serialize error: {e}"))
}

// ---------------------------------------------------------------------------
// Media understanding tools
// ---------------------------------------------------------------------------

/// Describe an image using a vision-capable LLM provider.
async fn tool_media_describe(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    media_engine: Option<&crate::media_understanding::MediaEngine>,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    tool_media_describe_with_timeouts(
        input,
        workspace_root,
        media_engine,
        kernel,
        caller_agent_id,
        std::time::Duration::from_secs(CURRENT_MODEL_VISION_TIMEOUT_SECS),
        std::time::Duration::from_secs(FALLBACK_VISION_TIMEOUT_SECS),
    )
    .await
}

async fn tool_media_describe_with_timeouts(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    media_engine: Option<&crate::media_understanding::MediaEngine>,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
    current_model_timeout: std::time::Duration,
    fallback_timeout: std::time::Duration,
) -> Result<String, String> {
    let raw_path = input["path"].as_str().ok_or("Missing 'path' parameter")?;
    let prompt = input["prompt"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(
            "Describe this image in detail. Extract visible text, numbers, tables, charts, UI elements, and any other relevant information.",
        );
    let path = resolve_media_path(raw_path, workspace_root)?;

    // Read image file
    let data = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Failed to read image file: {e}"))?;

    // Detect MIME type from extension
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => return Err(format!("Unsupported image format: .{ext}")),
    };
    let local_vision_error =
        match crate::local_vision::analyze_image_path_with_local_service(&path, mime, Some(prompt))
            .await
        {
            Ok(Some(understanding)) => {
                return serde_json::to_string_pretty(&understanding)
                    .map_err(|e| format!("Serialize error: {e}"));
            }
            Ok(None) => None,
            Err(err) => Some(err),
        };
    describe_image_bytes_with_timeouts(
        prompt,
        mime,
        &data,
        media_engine,
        kernel,
        caller_agent_id,
        current_model_timeout,
        fallback_timeout,
    )
    .await
    .map_err(|err| match local_vision_error {
        Some(local_err) => format!("Local Florence-2 path failed: {local_err} | {err}"),
        None => err,
    })
}

async fn describe_image_bytes_with_timeouts(
    prompt: &str,
    mime: &str,
    data: &[u8],
    media_engine: Option<&crate::media_understanding::MediaEngine>,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
    current_model_timeout: std::time::Duration,
    fallback_timeout: std::time::Duration,
) -> Result<String, String> {
    use base64::Engine;

    if let Some(understanding) =
        crate::local_vision::cached_understanding_for_image_bytes(mime, data)
    {
        return serde_json::to_string_pretty(&understanding)
            .map_err(|e| format!("Serialize error: {e}"));
    }

    let base64_data = base64::engine::general_purpose::STANDARD.encode(data);

    let mut current_model_error = None;
    if let (Some(kernel), Some(agent_id)) = (kernel, caller_agent_id) {
        match run_with_timeout(
            "Current agent model vision request",
            current_model_timeout,
            kernel.describe_image_with_agent_model(agent_id, prompt, mime, &base64_data),
        )
        .await
        {
            Ok(understanding) => {
                return serde_json::to_string_pretty(&understanding)
                    .map_err(|e| format!("Serialize error: {e}"));
            }
            Err(err) => current_model_error = Some(err),
        }
    }

    let attachment = openfang_types::media::MediaAttachment {
        media_type: openfang_types::media::MediaType::Image,
        mime_type: mime.to_string(),
        source: openfang_types::media::MediaSource::Base64 {
            data: base64_data,
            mime_type: mime.to_string(),
        },
        size_bytes: data.len() as u64,
    };

    let fallback_error = match media_engine {
        Some(engine) => match run_with_timeout(
            "Fallback vision provider request",
            fallback_timeout,
            engine.describe_image(&attachment),
        )
        .await
        {
            Ok(understanding) => {
                return serde_json::to_string_pretty(&understanding)
                    .map_err(|e| format!("Serialize error: {e}"));
            }
            Err(err) => err,
        },
        None => "Media engine not available. Check media configuration.".to_string(),
    };

    let mut parts = Vec::new();
    if let Some(err) = current_model_error {
        parts.push(format!("Current agent model path failed: {err}"));
    }
    parts.push(format!(
        "Fallback vision provider path failed: {fallback_error}"
    ));
    parts.push(
        "Do not retry local image analysis with browser_navigate or shell_exec. Use image_analyze/media_describe for chat-uploaded images, and if the screenshot is blurry ask for a clearer image instead."
            .to_string(),
    );
    Err(parts.join(" | "))
}

/// Transcribe audio to text using speech-to-text.
async fn tool_media_transcribe(
    input: &serde_json::Value,
    media_engine: Option<&crate::media_understanding::MediaEngine>,
) -> Result<String, String> {
    use base64::Engine;
    let engine = media_engine.ok_or("Media engine not available. Check media configuration.")?;
    let path = input["path"].as_str().ok_or("Missing 'path' parameter")?;
    let _ = validate_path(path)?;

    // Read audio file
    let data = tokio::fs::read(path)
        .await
        .map_err(|e| format!("Failed to read audio file: {e}"))?;

    // Detect MIME type from extension
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "webm" => "audio/webm",
        _ => return Err(format!("Unsupported audio format: .{ext}")),
    };

    let attachment = openfang_types::media::MediaAttachment {
        media_type: openfang_types::media::MediaType::Audio,
        mime_type: mime.to_string(),
        source: openfang_types::media::MediaSource::Base64 {
            data: base64::engine::general_purpose::STANDARD.encode(&data),
            mime_type: mime.to_string(),
        },
        size_bytes: data.len() as u64,
    };

    let understanding = engine.transcribe_audio(&attachment).await?;
    serde_json::to_string_pretty(&understanding).map_err(|e| format!("Serialize error: {e}"))
}

// ---------------------------------------------------------------------------
// Image generation tool
// ---------------------------------------------------------------------------

fn build_image_result_response(
    result: &openfang_types::media::ImageGenResult,
    workspace_root: Option<&Path>,
    input: &serde_json::Value,
    caller_agent_id: Option<&str>,
) -> serde_json::Value {
    let owner_scope = pick_string_field(input, "asset_owner_scope")
        .or_else(|| pick_string_field(input, "owner_scope"))
        .unwrap_or("other");
    let save_target = pick_string_field(input, "asset_save_target")
        .or_else(|| pick_string_field(input, "save_target"))
        .unwrap_or("output");
    let meta_label = pick_string_field(input, "asset_meta_label")
        .or_else(|| pick_string_field(input, "meta_label"))
        .or_else(|| pick_string_field(input, "purpose"));
    let saved_paths = workspace_root
        .map(|workspace| {
            save_runtime_images_to_workspace(
                result,
                workspace,
                save_target,
                owner_scope,
                caller_agent_id.unwrap_or_default(),
                "image",
                meta_label,
            )
        })
        .transpose()
        .unwrap_or_else(|e| {
            warn!("Failed to save images to workspace: {e}");
            Some(Vec::new())
        })
        .unwrap_or_default();

    let mut image_urls: Vec<String> = Vec::new();
    {
        use base64::Engine;
        let upload_dir = std::env::temp_dir().join("openfang_uploads");
        let _ = std::fs::create_dir_all(&upload_dir);
        for img in &result.images {
            let file_id = uuid::Uuid::new_v4().to_string();
            if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(&img.data_base64)
            {
                let path = upload_dir.join(&file_id);
                if std::fs::write(&path, &decoded).is_ok() {
                    image_urls.push(format!("/api/uploads/{file_id}"));
                }
            }
        }
    }

    serde_json::json!({
        "model": result.model,
        "images_generated": result.images.len(),
        "saved_to": saved_paths,
        "save_target": normalize_runtime_save_target(save_target),
        "meta_label": meta_label,
        "revised_prompt": result.revised_prompt,
        "image_urls": image_urls,
    })
}

fn save_runtime_images_to_workspace(
    result: &openfang_types::media::ImageGenResult,
    workspace_root: &Path,
    save_target: &str,
    owner_scope: &str,
    agent_id: &str,
    media_kind: &str,
    meta_label: Option<&str>,
) -> Result<Vec<String>, String> {
    use base64::Engine;

    let (base_dir, _) = resolve_runtime_image_save_dir(
        workspace_root,
        save_target,
        owner_scope,
        agent_id,
        media_kind,
        meta_label,
    )?;
    std::fs::create_dir_all(&base_dir).map_err(|e| {
        format!(
            "Failed to create image output dir {}: {e}",
            base_dir.display()
        )
    })?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let mut paths = Vec::new();
    for (i, image) in result.images.iter().enumerate() {
        let filename = if result.images.len() == 1 {
            format!("image_{timestamp}.png")
        } else {
            format!("image_{timestamp}_{i}.png")
        };
        let path = base_dir.join(&filename);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&image.data_base64)
            .map_err(|e| format!("Failed to decode base64 image: {e}"))?;
        std::fs::write(&path, &decoded)
            .map_err(|e| format!("Failed to write image to {}: {e}", path.display()))?;
        paths.push(path.display().to_string());
    }
    Ok(paths)
}

fn resolve_runtime_image_save_dir(
    workspace_root: &Path,
    raw_save_target: &str,
    owner_scope: &str,
    agent_id: &str,
    media_kind: &str,
    meta_label: Option<&str>,
) -> Result<(PathBuf, &'static str), String> {
    let save_target = normalize_runtime_save_target(raw_save_target);
    match save_target {
        "output" => Ok((workspace_root.join("output"), save_target)),
        "agent_profile_meta" => {
            if !owner_scope.eq_ignore_ascii_case("self") {
                return Err(
                    "save_target=agent_profile_meta is only allowed for self-owned media"
                        .to_string(),
                );
            }
            if agent_id.trim().is_empty() {
                return Err("save_target=agent_profile_meta requires caller agent id".to_string());
            }
            let kind_dir = match media_kind {
                "video" => "videos",
                "audio" => "audios",
                "file" | "document" => "files",
                _ => "images",
            };
            let label =
                normalize_runtime_meta_label(meta_label).unwrap_or_else(|| "default".into());
            Ok((
                workspace_root
                    .join("agent_profile")
                    .join("meta")
                    .join(kind_dir)
                    .join(label),
                save_target,
            ))
        }
        _ => Ok((workspace_root.join("output"), "output")),
    }
}

fn normalize_runtime_save_target(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "" | "output" => "output",
        "agent_profile_meta" | "agent-profile-meta" | "profile_meta" | "self_media"
        | "agent_profile" => "agent_profile_meta",
        _ => "output",
    }
}

fn normalize_runtime_meta_label(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();
    if value.is_empty() {
        return None;
    }
    let mut output = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric()
            || matches!(ch, '-' | '_')
            || matches!(ch as u32, 0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0x3040..=0x30FF)
        {
            output.push(ch);
        } else if (ch.is_whitespace() || matches!(ch, '/' | '\\' | ':' | '：' | '|'))
            && !output.ends_with('_')
        {
            output.push('_');
        }
    }
    let normalized = output.trim_matches('_').to_string();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

/// Generate images from a text prompt.
async fn tool_image_generate(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let prompt = input["prompt"]
        .as_str()
        .ok_or("Missing 'prompt' parameter")?;

    let model_str = input["model"].as_str().unwrap_or("dall-e-3");
    let model = match model_str {
        "dall-e-3" | "dalle3" | "dalle-3" => openfang_types::media::ImageGenModel::DallE3,
        "dall-e-2" | "dalle2" | "dalle-2" => openfang_types::media::ImageGenModel::DallE2,
        "gpt-image-1" | "gpt_image_1" => openfang_types::media::ImageGenModel::GptImage1,
        _ => openfang_types::media::ImageGenModel::DallE3,
    };

    let size = input["size"].as_str().unwrap_or("1024x1024").to_string();
    let quality = input["quality"].as_str().unwrap_or("standard").to_string();
    let count = input["count"].as_u64().unwrap_or(1).min(4) as u8;
    let negative_prompt = input["negative_prompt"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let width = input["width"]
        .as_u64()
        .and_then(|value| u32::try_from(value).ok());
    let height = input["height"]
        .as_u64()
        .and_then(|value| u32::try_from(value).ok());

    let request = openfang_types::media::ImageGenRequest {
        prompt: prompt.to_string(),
        negative_prompt,
        model,
        size,
        width,
        height,
        quality,
        count,
    };
    let asset_metadata = build_image_asset_metadata(
        input,
        caller_agent_id,
        "other",
        "image_generate",
        "generated_image",
    );

    if let Some(response_json) = crate::image_gen::execute_configured_image_generate_tool(
        &request,
        workspace_root,
        Some(&asset_metadata),
    )
    .await?
    {
        return Ok(response_json);
    }

    let result = if let (Some(kernel), Some(agent_id)) = (kernel, caller_agent_id) {
        kernel
            .generate_image_with_agent_model(agent_id, &request)
            .await?
    } else {
        crate::image_gen::generate_image(&request).await?
    };
    let response = build_image_result_response(&result, workspace_root, input, caller_agent_id);

    serde_json::to_string_pretty(&response).map_err(|e| format!("Serialize error: {e}"))
}

/// Edit a single image using a text instruction.
async fn tool_image_edit(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let prompt = input["prompt"]
        .as_str()
        .ok_or("Missing 'prompt' parameter")?;

    let model_str = input["model"].as_str().unwrap_or("gpt-image-1");
    let model = match model_str {
        "gpt-image-1" | "gpt_image_1" => openfang_types::media::ImageGenModel::GptImage1,
        "dall-e-2" | "dalle2" | "dalle-2" => openfang_types::media::ImageGenModel::DallE2,
        _ => openfang_types::media::ImageGenModel::GptImage1,
    };

    let raw_image_path = input["image_path"].as_str().unwrap_or_default().trim();
    let mut image_url = input["image_url"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .to_string();
    let mut resolved_image_path = None;

    if !raw_image_path.is_empty() {
        if should_treat_image_ref_as_url(raw_image_path) {
            if image_url.is_empty() {
                image_url = raw_image_path.to_string();
            }
            if let Some(file_id) = extract_local_upload_id(raw_image_path) {
                resolved_image_path =
                    recover_saved_upload_path_from_workspace(file_id, workspace_root)
                        .map(|path| path.to_string_lossy().to_string());
            }
        } else {
            resolved_image_path = Some(
                resolve_media_path(raw_image_path, workspace_root)?
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }

    if resolved_image_path.is_none() && !image_url.is_empty() {
        if let Some(file_id) = extract_local_upload_id(&image_url) {
            resolved_image_path = recover_saved_upload_path_from_workspace(file_id, workspace_root)
                .map(|path| path.to_string_lossy().to_string());
        }
    }

    let image_base64 = input["image_base64"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let mime_type = input["mime_type"].as_str().unwrap_or_default().to_string();

    let has_image_path = resolved_image_path
        .as_deref()
        .is_some_and(|path| !path.trim().is_empty());
    let has_image_url = !image_url.trim().is_empty();
    let has_image_base64 = !image_base64.trim().is_empty();

    if !has_image_path && !has_image_url && !has_image_base64 {
        return Err(
            "image_edit requires a source image. Provide exactly one of 'image_path', 'image_url', or 'image_base64' (with 'mime_type'). Use image_edit only when modifying an existing image.".to_string(),
        );
    }

    if has_image_base64 && mime_type.trim().is_empty() {
        return Err("image_edit requires 'mime_type' when 'image_base64' is provided.".to_string());
    }

    let request = openfang_types::media::ImageEditRequest {
        prompt: prompt.to_string(),
        negative_prompt: input["negative_prompt"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        model,
        image_path: resolved_image_path.unwrap_or_default(),
        image_url,
        image_base64,
        mime_type,
        size: input["size"].as_str().unwrap_or("1024x1024").to_string(),
        width: input["width"]
            .as_u64()
            .and_then(|value| u32::try_from(value).ok()),
        height: input["height"]
            .as_u64()
            .and_then(|value| u32::try_from(value).ok()),
        quality: input["quality"].as_str().unwrap_or("standard").to_string(),
        count: input["count"].as_u64().unwrap_or(1).min(4) as u8,
    };
    let asset_metadata = build_image_asset_metadata(
        input,
        caller_agent_id,
        "other",
        "image_edit",
        "edited_image",
    );

    if let Some(response_json) = crate::image_gen::execute_configured_image_edit_tool(
        &request,
        workspace_root,
        Some(&asset_metadata),
    )
    .await?
    {
        return Ok(response_json);
    }

    let result = if let (Some(kernel), Some(agent_id)) = (kernel, caller_agent_id) {
        kernel
            .edit_image_with_agent_model(agent_id, &request)
            .await?
    } else {
        crate::image_gen::generate_openai_compatible_image_edit(
            &request,
            &request.model.to_string(),
            "https://api.openai.com/v1",
            &std::env::var("OPENAI_API_KEY")
                .map_err(|_| "OPENAI_API_KEY not set. Image editing requires an OpenAI API key.")?,
        )
        .await?
    };

    let response = build_image_result_response(&result, workspace_root, input, caller_agent_id);
    serde_json::to_string_pretty(&response).map_err(|e| format!("Serialize error: {e}"))
}

// ---------------------------------------------------------------------------
// TTS / STT tools
// ---------------------------------------------------------------------------

async fn tool_text_to_speech(
    input: &serde_json::Value,
    tts_engine: Option<&crate::tts::TtsEngine>,
    workspace_root: Option<&Path>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let text = input["text"].as_str().ok_or("Missing 'text' parameter")?;
    let voice = input["voice"].as_str();
    let format = input["format"].as_str();

    let local_tts_error = match synthesize_via_webot_local_tts(input, caller_agent_id).await {
        Ok(Some(result)) => return Ok(result),
        Ok(None) => None,
        Err(error) => Some(error),
    };

    let engine = tts_engine.ok_or_else(|| {
        if let Some(local_error) = local_tts_error.as_ref() {
            format!(
                "Webot local TTS failed and runtime TTS engine is unavailable: {local_error}"
            )
        } else {
            "TTS engine not available. Configure Webot local TTS or enable runtime tts.enabled/provider.".to_string()
        }
    })?;
    let result = match engine.synthesize(text, voice, format).await {
        Ok(result) => result,
        Err(error) => {
            if let Some(local_error) = local_tts_error {
                return Err(format!(
                    "Webot local TTS failed: {local_error}; runtime TTS fallback failed: {error}"
                ));
            }
            return Err(error);
        }
    };

    // Save audio to workspace
    let saved_path = if let Some(workspace) = workspace_root {
        let output_dir = workspace.join("output");
        tokio::fs::create_dir_all(&output_dir)
            .await
            .map_err(|e| format!("Failed to create output dir: {e}"))?;

        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
        let filename = format!("tts_{timestamp}.{}", result.format);
        let path = output_dir.join(&filename);

        tokio::fs::write(&path, &result.audio_data)
            .await
            .map_err(|e| format!("Failed to write audio file: {e}"))?;

        Some(path.display().to_string())
    } else {
        None
    };

    let response = serde_json::json!({
        "saved_to": saved_path,
        "format": result.format,
        "provider": result.provider,
        "duration_estimate_ms": result.duration_estimate_ms,
        "size_bytes": result.audio_data.len(),
    });

    serde_json::to_string_pretty(&response).map_err(|e| format!("Serialize error: {e}"))
}

fn webot_service_base_url() -> Option<String> {
    let raw = std::env::var("WEBOT_SERVICE_BASE_URL").ok()?;
    let trimmed = raw.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

async fn synthesize_via_webot_local_tts(
    input: &serde_json::Value,
    caller_agent_id: Option<&str>,
) -> Result<Option<String>, String> {
    let service_base = match webot_service_base_url() {
        Some(value) => value,
        None => return Ok(None),
    };
    let agent_id = caller_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "WEBOT_SERVICE_BASE_URL 已配置，但当前 text_to_speech 调用缺少 agent id".to_string()
        })?;

    let text = input["text"].as_str().ok_or("Missing 'text' parameter")?;
    let requested_voice = input["voice"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let requested_format = input["format"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("wav");

    let mut warnings = Vec::new();
    let local_format = if requested_format.eq_ignore_ascii_case("wav") {
        "wav"
    } else {
        warnings.push(format!(
            "本地 F5-TTS-ONNX 仅支持 wav，已将请求格式 `{requested_format}` 自动改为 `wav`"
        ));
        "wav"
    };

    let mut payload = serde_json::Map::new();
    payload.insert(
        "text".to_string(),
        serde_json::Value::String(text.to_string()),
    );
    payload.insert(
        "format".to_string(),
        serde_json::Value::String(local_format.to_string()),
    );
    if let Some(voice) = requested_voice {
        payload.insert(
            "speakerProfileId".to_string(),
            serde_json::Value::String(voice.to_string()),
        );
    }

    let endpoint = format!("{service_base}/api/management/agents/{agent_id}/tts/synthesize");
    let client = reqwest::Client::new();
    let response = client
        .post(&endpoint)
        .json(&serde_json::Value::Object(payload))
        .timeout(std::time::Duration::from_secs(180))
        .send()
        .await
        .map_err(|error| format!("调用 Webot 本地 TTS 接口失败: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let err = response.text().await.unwrap_or_default();
        let truncated = crate::str_utils::safe_truncate_str(&err, 500);
        return Err(format!("Webot 本地 TTS 失败 (HTTP {status}): {truncated}"));
    }

    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("解析 Webot 本地 TTS 响应失败: {error}"))?;

    if let Some(items) = payload.get("warnings").and_then(|value| value.as_array()) {
        for item in items {
            if let Some(value) = item.as_str() {
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    warnings.push(trimmed.to_string());
                }
            }
        }
    }
    warnings.sort();
    warnings.dedup();

    let asset_url = payload
        .get("asset_url")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let saved_path = payload
        .get("saved_path")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let saved_to = asset_url
        .clone()
        .or_else(|| saved_path.clone())
        .ok_or_else(|| "Webot 本地 TTS 未返回可播放音频地址".to_string())?;
    let duration_estimate_ms = payload
        .get("duration_secs")
        .and_then(|value| value.as_f64())
        .map(|value| (value.max(0.0) * 1000.0).round() as u64)
        .unwrap_or(0);

    let response = serde_json::json!({
        "saved_to": saved_to,
        "asset_url": asset_url,
        "saved_path": saved_path,
        "format": "wav",
        "provider": payload.get("provider").and_then(|value| value.as_str()).unwrap_or("local"),
        "engine": payload.get("engine").and_then(|value| value.as_str()).unwrap_or("f5-tts-onnx"),
        "duration_estimate_ms": duration_estimate_ms,
        "size_bytes": payload.get("size").and_then(|value| value.as_u64()).unwrap_or(0),
        "speaker_profile_id": payload.get("speaker_profile_id").and_then(|value| value.as_str()),
        "speaker_name": payload.get("speaker_name").and_then(|value| value.as_str()),
        "device": payload.get("device").and_then(|value| value.as_str()),
        "chunk_count": payload.get("chunk_count").and_then(|value| value.as_u64()),
        "warnings": warnings,
    });

    serde_json::to_string_pretty(&response)
        .map(Some)
        .map_err(|error| format!("Serialize error: {error}"))
}

async fn tool_speech_to_text(
    input: &serde_json::Value,
    media_engine: Option<&crate::media_understanding::MediaEngine>,
    workspace_root: Option<&Path>,
) -> Result<String, String> {
    let engine = media_engine.ok_or("Media engine not available for speech-to-text")?;
    let raw_path = input["path"].as_str().ok_or("Missing 'path' parameter")?;
    let _language = input["language"].as_str();

    let resolved = resolve_file_path(raw_path, workspace_root)?;

    // Read the audio file
    let data = tokio::fs::read(&resolved)
        .await
        .map_err(|e| format!("Failed to read audio file: {e}"))?;

    // Determine MIME type from extension
    let ext = resolved
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp3");
    let mime_type = match ext {
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "webm" => "audio/webm",
        _ => "audio/mpeg",
    };

    use openfang_types::media::{MediaAttachment, MediaSource, MediaType};
    let attachment = MediaAttachment {
        media_type: MediaType::Audio,
        mime_type: mime_type.to_string(),
        source: MediaSource::Base64 {
            data: {
                use base64::Engine;
                base64::engine::general_purpose::STANDARD.encode(&data)
            },
            mime_type: mime_type.to_string(),
        },
        size_bytes: data.len() as u64,
    };

    let understanding = engine.transcribe_audio(&attachment).await?;

    let response = serde_json::json!({
        "transcript": understanding.description,
        "provider": understanding.provider,
        "model": understanding.model,
    });

    serde_json::to_string_pretty(&response).map_err(|e| format!("Serialize error: {e}"))
}

// ---------------------------------------------------------------------------
// Docker sandbox tool
// ---------------------------------------------------------------------------

async fn tool_docker_exec(
    input: &serde_json::Value,
    docker_config: Option<&openfang_types::config::DockerSandboxConfig>,
    workspace_root: Option<&Path>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let config = docker_config.ok_or("Docker sandbox not configured")?;

    if !config.enabled {
        return Err("Docker sandbox is disabled. Set docker.enabled=true in config.".into());
    }

    let command = input["command"]
        .as_str()
        .ok_or("Missing 'command' parameter")?;

    let workspace = workspace_root.ok_or("Docker exec requires a workspace directory")?;
    let agent_id = caller_agent_id.unwrap_or("default");

    // Check Docker availability
    if !crate::docker_sandbox::is_docker_available().await {
        return Err(
            "Docker is not available on this system. Install Docker to use docker_exec.".into(),
        );
    }

    // Create sandbox container
    let container = crate::docker_sandbox::create_sandbox(config, agent_id, workspace).await?;

    // Execute command with timeout
    let timeout = std::time::Duration::from_secs(config.timeout_secs);
    let result = crate::docker_sandbox::exec_in_sandbox(&container, command, timeout).await;

    // Always destroy the container after execution
    if let Err(e) = crate::docker_sandbox::destroy_sandbox(&container).await {
        warn!("Failed to destroy Docker sandbox: {e}");
    }

    let exec_result = result?;

    let response = serde_json::json!({
        "exit_code": exec_result.exit_code,
        "stdout": exec_result.stdout,
        "stderr": exec_result.stderr,
        "container_id": container.container_id,
    });

    serde_json::to_string_pretty(&response).map_err(|e| format!("Serialize error: {e}"))
}

// ---------------------------------------------------------------------------
// Persistent process tools
// ---------------------------------------------------------------------------

/// Start a long-running process (REPL, server, watcher).
async fn tool_process_start(
    input: &serde_json::Value,
    pm: Option<&crate::process_manager::ProcessManager>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let pm = pm.ok_or("Process manager not available")?;
    let agent_id = caller_agent_id.unwrap_or("default");
    let command = input["command"]
        .as_str()
        .ok_or("Missing 'command' parameter")?;
    let args: Vec<String> = input["args"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let proc_id = pm.start(agent_id, command, &args).await?;
    Ok(serde_json::json!({
        "process_id": proc_id,
        "status": "started"
    })
    .to_string())
}

/// Read accumulated stdout/stderr from a process (non-blocking drain).
async fn tool_process_poll(
    input: &serde_json::Value,
    pm: Option<&crate::process_manager::ProcessManager>,
) -> Result<String, String> {
    let pm = pm.ok_or("Process manager not available")?;
    let proc_id = input["process_id"]
        .as_str()
        .ok_or("Missing 'process_id' parameter")?;
    let (stdout, stderr) = pm.read(proc_id).await?;
    Ok(serde_json::json!({
        "stdout": stdout,
        "stderr": stderr,
    })
    .to_string())
}

/// Write data to a process's stdin.
async fn tool_process_write(
    input: &serde_json::Value,
    pm: Option<&crate::process_manager::ProcessManager>,
) -> Result<String, String> {
    let pm = pm.ok_or("Process manager not available")?;
    let proc_id = input["process_id"]
        .as_str()
        .ok_or("Missing 'process_id' parameter")?;
    let data = input["data"].as_str().ok_or("Missing 'data' parameter")?;
    // Always append newline if not present (common expectation for REPLs)
    let data = if data.ends_with('\n') {
        data.to_string()
    } else {
        format!("{data}\n")
    };
    pm.write(proc_id, &data).await?;
    Ok(r#"{"status": "written"}"#.to_string())
}

/// Terminate a process.
async fn tool_process_kill(
    input: &serde_json::Value,
    pm: Option<&crate::process_manager::ProcessManager>,
) -> Result<String, String> {
    let pm = pm.ok_or("Process manager not available")?;
    let proc_id = input["process_id"]
        .as_str()
        .ok_or("Missing 'process_id' parameter")?;
    pm.kill(proc_id).await?;
    Ok(r#"{"status": "killed"}"#.to_string())
}

/// List processes for the current agent.
async fn tool_process_list(
    pm: Option<&crate::process_manager::ProcessManager>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let pm = pm.ok_or("Process manager not available")?;
    let agent_id = caller_agent_id.unwrap_or("default");
    let procs = pm.list(agent_id);
    let list: Vec<serde_json::Value> = procs
        .iter()
        .map(|p| {
            serde_json::json!({
                "id": p.id,
                "command": p.command,
                "alive": p.alive,
                "uptime_secs": p.uptime_secs,
            })
        })
        .collect();
    Ok(serde_json::Value::Array(list).to_string())
}

// ---------------------------------------------------------------------------
// Canvas / A2UI tool
// ---------------------------------------------------------------------------

/// Sanitize HTML for canvas presentation.
///
/// SECURITY: Strips dangerous elements and attributes to prevent XSS:
/// - Rejects <script>, <iframe>, <object>, <embed>, <applet> tags
/// - Strips all on* event attributes (onclick, onload, onerror, etc.)
/// - Strips javascript:, data:text/html, vbscript: URLs
/// - Enforces size limit
pub fn sanitize_canvas_html(html: &str, max_bytes: usize) -> Result<String, String> {
    if html.is_empty() {
        return Err("Empty HTML content".to_string());
    }
    if html.len() > max_bytes {
        return Err(format!(
            "HTML too large: {} bytes (max {})",
            html.len(),
            max_bytes
        ));
    }

    let lower = html.to_lowercase();

    // Reject dangerous tags
    let dangerous_tags = [
        "<script", "</script", "<iframe", "</iframe", "<object", "</object", "<embed", "<applet",
        "</applet",
    ];
    for tag in &dangerous_tags {
        if lower.contains(tag) {
            return Err(format!("Forbidden HTML tag detected: {tag}"));
        }
    }

    // Reject event handler attributes (on*)
    // Match patterns like: onclick=, onload=, onerror=, onmouseover=, etc.
    static EVENT_PATTERN: std::sync::LazyLock<regex_lite::Regex> =
        std::sync::LazyLock::new(|| regex_lite::Regex::new(r"(?i)\bon[a-z]+\s*=").unwrap());
    if EVENT_PATTERN.is_match(html) {
        return Err(
            "Forbidden event handler attribute detected (on* attributes are not allowed)"
                .to_string(),
        );
    }

    // Reject dangerous URL schemes
    let dangerous_schemes = ["javascript:", "vbscript:", "data:text/html"];
    for scheme in &dangerous_schemes {
        if lower.contains(scheme) {
            return Err(format!("Forbidden URL scheme detected: {scheme}"));
        }
    }

    Ok(html.to_string())
}

/// Canvas presentation tool handler.
async fn tool_canvas_present(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
) -> Result<String, String> {
    let html = input["html"].as_str().ok_or("Missing 'html' parameter")?;
    let title = input["title"].as_str().unwrap_or("Canvas");

    // Use configured max from task-local (set by agent_loop from KernelConfig), or default 512KB.
    let max_bytes = CANVAS_MAX_BYTES.try_with(|v| *v).unwrap_or(512 * 1024);
    let sanitized = sanitize_canvas_html(html, max_bytes)?;

    // Generate canvas ID
    let canvas_id = uuid::Uuid::new_v4().to_string();

    // Save to workspace output directory
    let output_dir = if let Some(root) = workspace_root {
        root.join("output")
    } else {
        PathBuf::from("output")
    };
    let _ = tokio::fs::create_dir_all(&output_dir).await;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("canvas_{timestamp}_{}.html", &canvas_id[..8]);
    let filepath = output_dir.join(&filename);

    // Write the full HTML document
    let full_html = format!(
        "<!DOCTYPE html>\n<html>\n<head><meta charset=\"utf-8\"><title>{title}</title></head>\n<body>\n{sanitized}\n</body>\n</html>"
    );
    tokio::fs::write(&filepath, &full_html)
        .await
        .map_err(|e| format!("Failed to save canvas: {e}"))?;

    let response = serde_json::json!({
        "canvas_id": canvas_id,
        "title": title,
        "saved_to": filepath.to_string_lossy(),
        "size_bytes": full_html.len(),
    });

    serde_json::to_string_pretty(&response).map_err(|e| format!("Serialize error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel_handle::{AgentInfo, KernelHandle};
    use async_trait::async_trait;
    use std::sync::Arc;

    #[test]
    fn test_builtin_tool_definitions() {
        let tools = builtin_tool_definitions();
        assert!(
            tools.len() >= 39,
            "Expected at least 39 tools, got {}",
            tools.len()
        );
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        // Original 12
        assert!(names.contains(&"file_read"));
        assert!(names.contains(&"shell_exec"));
        assert!(names.contains(&"agent_send"));
        assert!(names.contains(&"agent_spawn"));
        assert!(names.contains(&"agent_list"));
        assert!(names.contains(&"agent_kill"));
        assert!(names.contains(&"memory_store"));
        assert!(names.contains(&"memory_recall"));
        // 6 collaboration tools
        assert!(names.contains(&"agent_find"));
        assert!(names.contains(&"task_post"));
        assert!(names.contains(&"task_claim"));
        assert!(names.contains(&"task_complete"));
        assert!(names.contains(&"task_list"));
        assert!(names.contains(&"event_publish"));
        // 5 new Phase 3 tools
        assert!(names.contains(&"schedule_create"));
        assert!(names.contains(&"schedule_list"));
        assert!(names.contains(&"schedule_delete"));
        assert!(names.contains(&"image_analyze"));
        assert!(names.contains(&"location_get"));
        // 6 browser tools
        assert!(names.contains(&"browser_navigate"));
        assert!(names.contains(&"browser_click"));
        assert!(names.contains(&"browser_type"));
        assert!(names.contains(&"browser_screenshot"));
        assert!(names.contains(&"browser_read_page"));
        assert!(names.contains(&"browser_close"));
        assert!(names.contains(&"browser_scroll"));
        assert!(names.contains(&"browser_wait"));
        assert!(names.contains(&"browser_run_js"));
        assert!(names.contains(&"browser_back"));
        // 4 self-management tools
        assert!(names.contains(&"my_identity_patch"));
        assert!(names.contains(&"my_memory_patch"));
        assert!(names.contains(&"my_photo_generate"));
        assert!(names.contains(&"my_photo_edit"));
        // 4 media/image tools
        assert!(names.contains(&"media_describe"));
        assert!(names.contains(&"media_transcribe"));
        assert!(names.contains(&"image_generate"));
        assert!(names.contains(&"image_edit"));
        // 3 cron tools
        assert!(names.contains(&"cron_create"));
        assert!(names.contains(&"cron_list"));
        assert!(names.contains(&"cron_cancel"));
        // 1 channel send tool
        assert!(names.contains(&"channel_send"));
        // 4 hand tools
        assert!(names.contains(&"hand_list"));
        assert!(names.contains(&"hand_activate"));
        assert!(names.contains(&"hand_status"));
        assert!(names.contains(&"hand_deactivate"));
        // 3 voice/docker tools
        assert!(names.contains(&"text_to_speech"));
        assert!(names.contains(&"speech_to_text"));
        assert!(names.contains(&"docker_exec"));
        // Canvas tool
        assert!(names.contains(&"canvas_present"));

        let image_edit_index = names
            .iter()
            .position(|name| *name == "image_edit")
            .expect("image_edit tool missing");
        let image_generate_index = names
            .iter()
            .position(|name| *name == "image_generate")
            .expect("image_generate tool missing");
        assert!(
            image_edit_index < image_generate_index,
            "image_edit should be exposed before image_generate for tool selection disambiguation"
        );

        let image_edit = tools
            .iter()
            .find(|tool| tool.name == "image_edit")
            .expect("image_edit tool missing");
        assert!(
            image_edit.input_schema.get("oneOf").is_none(),
            "image_edit schema should stay flat for OpenAI-compatible tool calling providers"
        );
        assert!(image_edit.description.contains("generic tool"));

        let image_generate = tools
            .iter()
            .find(|tool| tool.name == "image_generate")
            .expect("image_generate tool missing");
        assert!(image_generate
            .description
            .contains("generic generation tool"));

        let my_photo_generate = tools
            .iter()
            .find(|tool| tool.name == "my_photo_generate")
            .expect("my_photo_generate tool missing");
        assert!(my_photo_generate
            .description
            .contains("same identity anchor"));
        assert!(my_photo_generate
            .description
            .contains("runtime injects this self identity anchor"));
        assert!(my_photo_generate
            .input_schema
            .get("properties")
            .and_then(|properties| properties.get("save_target"))
            .is_some());
        assert!(my_photo_generate
            .input_schema
            .get("properties")
            .and_then(|properties| properties.get("image_url"))
            .is_none());

        let my_identity_patch = tools
            .iter()
            .find(|tool| tool.name == "my_identity_patch")
            .expect("my_identity_patch tool missing");
        assert!(my_identity_patch
            .description
            .contains("current agent's own identity files"));
        assert!(my_identity_patch
            .input_schema
            .get("properties")
            .and_then(|properties| properties.get("confirmed_by_user"))
            .is_some());
    }

    #[test]
    fn test_browser_navigate_local_source_error_for_file_inputs() {
        assert!(browser_navigate_local_source_error("file:///tmp/example.png").is_some());
        assert!(browser_navigate_local_source_error("C:\\tmp\\example.png").is_some());
        assert!(browser_navigate_local_source_error("\\\\server\\share\\example.png").is_some());
        assert!(browser_navigate_local_source_error("data:image/png;base64,abc").is_some());
        assert!(browser_navigate_local_source_error("https://example.com").is_none());
    }

    #[test]
    fn test_collaboration_tool_schemas() {
        let tools = builtin_tool_definitions();
        let collab_tools = [
            "agent_find",
            "task_post",
            "task_claim",
            "task_complete",
            "task_list",
            "event_publish",
        ];
        for name in &collab_tools {
            let tool = tools
                .iter()
                .find(|t| t.name == *name)
                .unwrap_or_else(|| panic!("Tool '{}' not found", name));
            // Verify each has a valid JSON schema
            assert!(
                tool.input_schema.is_object(),
                "Tool '{}' schema should be an object",
                name
            );
            assert_eq!(
                tool.input_schema["type"], "object",
                "Tool '{}' should have type=object",
                name
            );
        }
    }

    #[tokio::test]
    async fn test_file_read_missing() {
        let result = execute_tool(
            "test-id",
            "file_read",
            &serde_json::json!({"path": "/nonexistent/file.txt"}),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;
        assert!(result.is_error);
    }

    #[tokio::test]
    async fn test_image_edit_requires_source_image() {
        let err = tool_image_edit(
            &serde_json::json!({
                "prompt": "把耳环换成红宝石款式"
            }),
            None,
            None,
            None,
        )
        .await
        .expect_err("image_edit without a source image should fail");

        assert!(err.contains("requires a source image"));
    }

    #[tokio::test]
    async fn test_my_identity_patch_requires_confirmation_for_system_prompt() {
        let kernel: Arc<dyn KernelHandle> = Arc::new(MediaDescribeTestKernel {
            mode: MediaDescribeTestKernelMode::Immediate,
        });
        let err = tool_my_identity_patch(
            &serde_json::json!({
                "system_prompt": "新的核心提示词"
            }),
            None,
            Some(&kernel),
            Some("agent-1"),
        )
        .await
        .expect_err("system prompt self patch should require confirmation");

        assert!(err.contains("explicit confirmation"));
    }

    #[tokio::test]
    async fn test_my_memory_patch_returns_kernel_memory_result() {
        let workspace = std::env::temp_dir().join(format!(
            "openfang_my_memory_workspace_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&workspace).unwrap();

        let kernel: Arc<dyn KernelHandle> = Arc::new(MediaDescribeTestKernel {
            mode: MediaDescribeTestKernelMode::Immediate,
        });
        let result = tool_my_memory_patch(
            &serde_json::json!({
                "content": "用户喜欢我先给结果再解释",
                "memory_type": "preference",
                "reason": "多次明确表达"
            }),
            Some(workspace.as_path()),
            Some(&kernel),
            Some("agent-1"),
        )
        .await
        .expect("my_memory_patch should succeed");

        let _ = std::fs::remove_dir_all(&workspace);

        assert!(result.contains("memory-test-id"));
        assert!(result.contains("MEMORY.md"));
    }

    #[test]
    fn test_resolve_self_photo_source_falls_back_to_avatar_url() {
        let self_ctx = serde_json::json!({
            "avatar_url": "https://example.com/avatar.png"
        });
        let source = resolve_self_photo_source(&serde_json::json!({}), &self_ctx)
            .expect("avatar fallback should resolve");
        assert_eq!(
            source.get("image_url").and_then(serde_json::Value::as_str),
            Some("https://example.com/avatar.png")
        );
    }

    #[test]
    fn test_resolve_self_photo_source_falls_back_to_portrait_url() {
        let self_ctx = serde_json::json!({
            "portrait_url": "https://example.com/portrait.png"
        });
        let source = resolve_self_photo_source(&serde_json::json!({}), &self_ctx)
            .expect("portrait fallback should resolve");
        assert_eq!(
            source.get("image_url").and_then(serde_json::Value::as_str),
            Some("https://example.com/portrait.png")
        );
    }

    #[test]
    fn test_recover_saved_upload_path_from_workspace() {
        let workspace =
            std::env::temp_dir().join(format!("openfang_edit_workspace_{}", std::process::id()));
        let sessions_dir = workspace.join("sessions");
        let output_dir = workspace.join("output");
        std::fs::create_dir_all(&sessions_dir).unwrap();
        std::fs::create_dir_all(&output_dir).unwrap();

        let file_id = "11111111-2222-3333-4444-555555555555";
        let saved_image = output_dir.join("image_20260322_000001.png");
        std::fs::write(&saved_image, b"png").unwrap();

        let session_line = serde_json::json!({
            "tool_use": [{
                "content": serde_json::json!({
                    "image_urls": [format!("/api/uploads/{file_id}")],
                    "saved_to": [saved_image.to_string_lossy().to_string()]
                }).to_string()
            }]
        })
        .to_string();
        std::fs::write(
            sessions_dir.join("test-session.jsonl"),
            format!("{session_line}\n"),
        )
        .unwrap();

        let restored = recover_saved_upload_path_from_workspace(file_id, Some(&workspace))
            .expect("expected saved upload path");
        assert_eq!(restored, saved_image);

        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[tokio::test]
    async fn test_browser_navigate_rejects_local_file_inputs() {
        let result = execute_tool(
            "test-id",
            "browser_navigate",
            &serde_json::json!({"url": "file:///C:/tmp/example.webp"}),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("image_analyze"));
    }

    #[tokio::test]
    async fn test_file_read_path_traversal_blocked() {
        let result = execute_tool(
            "test-id",
            "file_read",
            &serde_json::json!({"path": "../../etc/passwd"}),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("traversal"));
    }

    #[tokio::test]
    async fn test_file_write_path_traversal_blocked() {
        let result = execute_tool(
            "test-id",
            "file_write",
            &serde_json::json!({"path": "../../../tmp/evil.txt", "content": "pwned"}),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("traversal"));
    }

    #[tokio::test]
    async fn test_file_list_path_traversal_blocked() {
        let result = execute_tool(
            "test-id",
            "file_list",
            &serde_json::json!({"path": "/foo/../../etc"}),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("traversal"));
    }

    #[tokio::test]
    async fn test_web_search() {
        let result = execute_tool(
            "test-id",
            "web_search",
            &serde_json::json!({"query": "rust programming"}),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;
        // web_search now attempts a real fetch; may succeed or fail depending on network
        assert!(!result.tool_use_id.is_empty());
    }

    #[tokio::test]
    async fn test_unknown_tool() {
        let result = execute_tool(
            "test-id",
            "nonexistent_tool",
            &serde_json::json!({}),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("Unknown tool"));
    }

    #[tokio::test]
    async fn test_agent_tools_without_kernel() {
        let result = execute_tool(
            "test-id",
            "agent_list",
            &serde_json::json!({}),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("Kernel handle not available"));
    }

    #[tokio::test]
    async fn test_capability_enforcement_denied() {
        let allowed = vec!["file_read".to_string(), "file_list".to_string()];
        let result = execute_tool(
            "test-id",
            "shell_exec",
            &serde_json::json!({"command": "ls"}),
            None,
            Some(&allowed),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("Permission denied"));
    }

    #[tokio::test]
    async fn test_capability_enforcement_allowed() {
        let allowed = vec!["file_read".to_string()];
        let result = execute_tool(
            "test-id",
            "file_read",
            &serde_json::json!({"path": "/nonexistent/file.txt"}),
            None,
            Some(&allowed),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;
        // Should fail for file-not-found, NOT for permission denied
        assert!(result.is_error);
        assert!(result.content.contains("Failed to read"));
    }

    // --- Schedule parser tests ---
    #[test]
    fn test_parse_schedule_every_minutes() {
        assert_eq!(
            parse_schedule_to_cron("every 5 minutes").unwrap(),
            "*/5 * * * *"
        );
        assert_eq!(
            parse_schedule_to_cron("every 1 minute").unwrap(),
            "* * * * *"
        );
        assert_eq!(parse_schedule_to_cron("every minute").unwrap(), "* * * * *");
        assert_eq!(
            parse_schedule_to_cron("every 30 minutes").unwrap(),
            "*/30 * * * *"
        );
    }

    #[test]
    fn test_parse_schedule_every_hours() {
        assert_eq!(parse_schedule_to_cron("every hour").unwrap(), "0 * * * *");
        assert_eq!(parse_schedule_to_cron("every 1 hour").unwrap(), "0 * * * *");
        assert_eq!(
            parse_schedule_to_cron("every 2 hours").unwrap(),
            "0 */2 * * *"
        );
    }

    #[test]
    fn test_parse_schedule_daily() {
        assert_eq!(parse_schedule_to_cron("daily at 9am").unwrap(), "0 9 * * *");
        assert_eq!(
            parse_schedule_to_cron("daily at 6pm").unwrap(),
            "0 18 * * *"
        );
        assert_eq!(
            parse_schedule_to_cron("daily at 12am").unwrap(),
            "0 0 * * *"
        );
        assert_eq!(
            parse_schedule_to_cron("daily at 12pm").unwrap(),
            "0 12 * * *"
        );
    }

    #[test]
    fn test_parse_schedule_weekdays() {
        assert_eq!(
            parse_schedule_to_cron("weekdays at 9am").unwrap(),
            "0 9 * * 1-5"
        );
        assert_eq!(
            parse_schedule_to_cron("weekends at 10am").unwrap(),
            "0 10 * * 0,6"
        );
    }

    #[test]
    fn test_parse_schedule_shorthand() {
        assert_eq!(parse_schedule_to_cron("hourly").unwrap(), "0 * * * *");
        assert_eq!(parse_schedule_to_cron("daily").unwrap(), "0 0 * * *");
        assert_eq!(parse_schedule_to_cron("weekly").unwrap(), "0 0 * * 0");
        assert_eq!(parse_schedule_to_cron("monthly").unwrap(), "0 0 1 * *");
    }

    #[test]
    fn test_parse_schedule_cron_passthrough() {
        assert_eq!(
            parse_schedule_to_cron("0 */5 * * *").unwrap(),
            "0 */5 * * *"
        );
        assert_eq!(
            parse_schedule_to_cron("30 9 * * 1-5").unwrap(),
            "30 9 * * 1-5"
        );
    }

    #[test]
    fn test_parse_schedule_invalid() {
        assert!(parse_schedule_to_cron("whenever I feel like it").is_err());
        assert!(parse_schedule_to_cron("every 0 minutes").is_err());
    }

    // --- Image format detection tests ---
    #[test]
    fn test_detect_image_format_png() {
        let data = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x10\x00\x00\x00\x10";
        assert_eq!(detect_image_format(data), "png");
    }

    #[test]
    fn test_detect_image_format_jpeg() {
        let data = b"\xFF\xD8\xFF\xE0\x00\x10JFIF";
        assert_eq!(detect_image_format(data), "jpeg");
    }

    #[test]
    fn test_detect_image_format_gif() {
        let data = b"GIF89a\x10\x00\x10\x00";
        assert_eq!(detect_image_format(data), "gif");
    }

    #[test]
    fn test_detect_image_format_bmp() {
        let data = b"BM\x00\x00\x00\x00";
        assert_eq!(detect_image_format(data), "bmp");
    }

    #[test]
    fn test_detect_image_format_unknown() {
        let data = b"\x00\x00\x00\x00";
        assert_eq!(detect_image_format(data), "unknown");
    }

    #[test]
    fn test_extract_png_dimensions() {
        // Minimal PNG header: signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4)
        let mut data = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]; // signature
        data.extend_from_slice(&[0x00, 0x00, 0x00, 0x0D]); // IHDR length
        data.extend_from_slice(b"IHDR"); // chunk type
        data.extend_from_slice(&640u32.to_be_bytes()); // width
        data.extend_from_slice(&480u32.to_be_bytes()); // height
        assert_eq!(extract_image_dimensions(&data, "png"), Some((640, 480)));
    }

    #[test]
    fn test_extract_gif_dimensions() {
        let mut data = b"GIF89a".to_vec();
        data.extend_from_slice(&320u16.to_le_bytes()); // width
        data.extend_from_slice(&240u16.to_le_bytes()); // height
        assert_eq!(extract_image_dimensions(&data, "gif"), Some((320, 240)));
    }

    #[test]
    fn test_format_file_size() {
        assert_eq!(format_file_size(500), "500 B");
        assert_eq!(format_file_size(1536), "1.5 KB");
        assert_eq!(format_file_size(2 * 1024 * 1024), "2.0 MB");
    }

    #[tokio::test]
    async fn test_image_analyze_missing_file() {
        let result = execute_tool(
            "test-id",
            "image_analyze",
            &serde_json::json!({"path": "/nonexistent/image.png"}),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("Failed to read"));
    }

    #[tokio::test]
    async fn test_image_analyze_with_prompt_uses_current_agent_vision_first() {
        let png_bytes = [
            0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, b'I', b'H',
            b'D', b'R', 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03,
        ];
        let temp_path = std::env::temp_dir().join(format!(
            "openfang_image_analyze_test_{}.png",
            std::process::id()
        ));
        std::fs::write(&temp_path, png_bytes).unwrap();

        let kernel: Arc<dyn KernelHandle> = Arc::new(MediaDescribeTestKernel {
            mode: MediaDescribeTestKernelMode::Immediate,
        });
        let result = execute_tool(
            "test-id",
            "image_analyze",
            &serde_json::json!({
                "path": temp_path.to_string_lossy().to_string(),
                "prompt": "extract every visible number"
            }),
            Some(&kernel),
            None,
            None,
            Some("agent-1"),
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;

        let _ = std::fs::remove_file(&temp_path);

        assert!(!result.is_error);
        assert!(result.content.contains("\"vision_analysis\""));
        assert!(result
            .content
            .contains("vision-ok: extract every visible number"));
        assert!(!result.content.contains("base64_preview"));
    }

    #[tokio::test]
    async fn test_image_analyze_with_prompt_returns_error_when_vision_fails() {
        let png_bytes = [
            0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, b'I', b'H',
            b'D', b'R', 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03,
        ];
        let temp_path = std::env::temp_dir().join(format!(
            "openfang_image_analyze_failure_test_{}.png",
            std::process::id()
        ));
        std::fs::write(&temp_path, png_bytes).unwrap();

        let result = execute_tool(
            "test-id",
            "image_analyze",
            &serde_json::json!({
                "path": temp_path.to_string_lossy().to_string(),
                "prompt": "extract all visible text"
            }),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;

        let _ = std::fs::remove_file(&temp_path);

        assert!(result.is_error);
        assert!(result.content.contains("Image analysis failed for"));
        assert!(result
            .content
            .contains("Fallback vision provider path failed"));
        assert!(!result.content.contains("base64_preview"));
        assert!(!result.content.contains("file_size_bytes"));
    }

    #[tokio::test]
    async fn test_image_analyze_resolves_chat_upload_relative_path_from_workspace_data() {
        let workspace =
            std::env::temp_dir().join(format!("openfang_image_workspace_{}", std::process::id()));
        let chat_upload_dir = workspace.join("data").join("chat-uploads").join("20532");
        std::fs::create_dir_all(&chat_upload_dir).unwrap();
        let image_path = chat_upload_dir.join("test-image.png");
        let png_bytes = [
            0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, b'I', b'H',
            b'D', b'R', 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03,
        ];
        std::fs::write(&image_path, png_bytes).unwrap();

        let result = execute_tool(
            "test-id",
            "image_analyze",
            &serde_json::json!({"path": "chat-uploads/20532/test-image.png"}),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(workspace.as_path()),
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;

        let _ = std::fs::remove_dir_all(&workspace);

        assert!(!result.is_error);
        assert!(result.content.contains("\"format\": \"png\""));
        assert!(result.content.contains("test-image.png"));
    }

    #[test]
    fn test_depth_limit_constant() {
        assert_eq!(MAX_AGENT_CALL_DEPTH, 5);
    }

    #[test]
    fn test_depth_limit_first_call_succeeds() {
        // Default depth is 0, which is < MAX_AGENT_CALL_DEPTH
        let default_depth = AGENT_CALL_DEPTH.try_with(|d| d.get()).unwrap_or(0);
        assert!(default_depth < MAX_AGENT_CALL_DEPTH);
    }

    #[test]
    fn test_task_local_compiles() {
        // Verify task_local macro works — just ensure the type exists
        let cell = std::cell::Cell::new(0u32);
        assert_eq!(cell.get(), 0);
    }

    #[tokio::test]
    async fn test_schedule_tools_without_kernel() {
        let result = execute_tool(
            "test-id",
            "schedule_list",
            &serde_json::json!({}),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;
        assert!(result.is_error);
        assert!(result.content.contains("Kernel handle not available"));
    }

    enum MediaDescribeTestKernelMode {
        Immediate,
        Sleep(std::time::Duration),
    }

    struct MediaDescribeTestKernel {
        mode: MediaDescribeTestKernelMode,
    }

    #[async_trait]
    impl KernelHandle for MediaDescribeTestKernel {
        async fn spawn_agent(
            &self,
            _manifest_toml: &str,
            _parent_id: Option<&str>,
        ) -> Result<(String, String), String> {
            Err("not implemented".to_string())
        }

        async fn send_to_agent(&self, _agent_id: &str, _message: &str) -> Result<String, String> {
            Err("not implemented".to_string())
        }

        fn list_agents(&self) -> Vec<AgentInfo> {
            Vec::new()
        }

        fn kill_agent(&self, _agent_id: &str) -> Result<(), String> {
            Err("not implemented".to_string())
        }

        fn memory_store(&self, _key: &str, _value: serde_json::Value) -> Result<(), String> {
            Err("not implemented".to_string())
        }

        fn memory_recall(&self, _key: &str) -> Result<Option<serde_json::Value>, String> {
            Ok(None)
        }

        fn get_agent_self_context(&self, agent_id: &str) -> Result<serde_json::Value, String> {
            Ok(serde_json::json!({
                "agent_id": agent_id,
                "name": "self-test-agent",
                "workspace": null,
                "system_prompt": "test prompt",
                "avatar_url": "https://example.com/avatar.png",
                "color": "#ff6600",
            }))
        }

        fn patch_agent_self_context(
            &self,
            agent_id: &str,
            patch: serde_json::Value,
        ) -> Result<serde_json::Value, String> {
            Ok(serde_json::json!({
                "agent_id": agent_id,
                "patch": patch,
            }))
        }

        fn find_agents(&self, _query: &str) -> Vec<AgentInfo> {
            Vec::new()
        }

        async fn task_post(
            &self,
            _title: &str,
            _description: &str,
            _assigned_to: Option<&str>,
            _created_by: Option<&str>,
        ) -> Result<String, String> {
            Err("not implemented".to_string())
        }

        async fn task_claim(&self, _agent_id: &str) -> Result<Option<serde_json::Value>, String> {
            Ok(None)
        }

        async fn task_complete(&self, _task_id: &str, _result: &str) -> Result<(), String> {
            Err("not implemented".to_string())
        }

        async fn task_list(&self, _status: Option<&str>) -> Result<Vec<serde_json::Value>, String> {
            Ok(Vec::new())
        }

        async fn publish_event(
            &self,
            _event_type: &str,
            _payload: serde_json::Value,
        ) -> Result<(), String> {
            Err("not implemented".to_string())
        }

        async fn knowledge_add_entity(
            &self,
            _entity: openfang_types::memory::Entity,
        ) -> Result<String, String> {
            Err("not implemented".to_string())
        }

        async fn knowledge_add_relation(
            &self,
            _relation: openfang_types::memory::Relation,
        ) -> Result<String, String> {
            Err("not implemented".to_string())
        }

        async fn knowledge_query(
            &self,
            _pattern: openfang_types::memory::GraphPattern,
        ) -> Result<Vec<openfang_types::memory::GraphMatch>, String> {
            Ok(Vec::new())
        }

        async fn remember_agent_memory(
            &self,
            agent_id: &str,
            _content: &str,
            scope: &str,
            _metadata: serde_json::Value,
        ) -> Result<serde_json::Value, String> {
            Ok(serde_json::json!({
                "memory_id": "memory-test-id",
                "agent_id": agent_id,
                "scope": scope,
            }))
        }

        async fn describe_image_with_agent_model(
            &self,
            _agent_id: &str,
            prompt: &str,
            _media_type: &str,
            _base64_data: &str,
        ) -> Result<openfang_types::media::MediaUnderstanding, String> {
            if let MediaDescribeTestKernelMode::Sleep(delay) = &self.mode {
                tokio::time::sleep(*delay).await;
            }
            Ok(openfang_types::media::MediaUnderstanding {
                media_type: openfang_types::media::MediaType::Image,
                description: format!("vision-ok: {prompt}"),
                provider: "test-provider".to_string(),
                model: "test-model".to_string(),
            })
        }

        async fn edit_image_with_agent_model(
            &self,
            _agent_id: &str,
            request: &openfang_types::media::ImageEditRequest,
        ) -> Result<openfang_types::media::ImageGenResult, String> {
            Ok(openfang_types::media::ImageGenResult {
                images: vec![openfang_types::media::GeneratedImage {
                    data_base64: "aGVsbG8=".to_string(),
                    url: None,
                }],
                model: "self-test-edit-model".to_string(),
                revised_prompt: Some(request.prompt.clone()),
            })
        }
    }

    #[tokio::test]
    async fn test_media_describe_uses_current_agent_vision_first() {
        let temp_path = std::env::temp_dir().join(format!(
            "openfang_media_describe_test_{}.png",
            std::process::id()
        ));
        std::fs::write(&temp_path, b"fake-png-data").unwrap();

        let kernel: Arc<dyn KernelHandle> = Arc::new(MediaDescribeTestKernel {
            mode: MediaDescribeTestKernelMode::Immediate,
        });
        let result = execute_tool(
            "test-id",
            "media_describe",
            &serde_json::json!({
                "path": temp_path.to_string_lossy().to_string(),
                "prompt": "extract every visible number"
            }),
            Some(&kernel),
            None,
            None,
            Some("agent-1"),
            None,
            None,
            None,
            None,
            None,
            None, // workspace_root
            None, // media_engine
            None, // exec_policy
            None, // tts_engine
            None, // docker_config
            None, // process_manager
        )
        .await;

        let _ = std::fs::remove_file(&temp_path);

        assert!(!result.is_error);
        assert!(result
            .content
            .contains("vision-ok: extract every visible number"));
        assert!(result.content.contains("\"model\": \"test-model\""));
    }

    #[tokio::test]
    async fn test_media_describe_times_out_current_model_request_before_tool_timeout() {
        let temp_path = std::env::temp_dir().join(format!(
            "openfang_media_describe_timeout_test_{}.png",
            std::process::id()
        ));
        std::fs::write(&temp_path, b"fake-png-data").unwrap();

        let kernel: Arc<dyn KernelHandle> = Arc::new(MediaDescribeTestKernel {
            mode: MediaDescribeTestKernelMode::Sleep(std::time::Duration::from_millis(30)),
        });
        let result = tool_media_describe_with_timeouts(
            &serde_json::json!({
                "path": temp_path.to_string_lossy().to_string(),
                "prompt": "extract every visible number"
            }),
            None,
            None,
            Some(&kernel),
            Some("agent-1"),
            std::time::Duration::from_millis(10),
            std::time::Duration::from_millis(10),
        )
        .await;

        let _ = std::fs::remove_file(&temp_path);

        let err = result.expect_err("expected timeout");
        assert!(err.contains(
            "Current agent model path failed: Current agent model vision request timed out after 10ms"
        ));
        assert!(err.contains(
            "Fallback vision provider path failed: Media engine not available. Check media configuration."
        ));
    }

    // ─── Canvas / A2UI tests ────────────────────────────────────────

    #[test]
    fn test_sanitize_canvas_basic_html() {
        let html = "<h1>Hello World</h1><p>This is a test.</p>";
        let result = sanitize_canvas_html(html, 512 * 1024);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), html);
    }

    #[test]
    fn test_sanitize_canvas_rejects_script() {
        let html = "<div><script>alert('xss')</script></div>";
        let result = sanitize_canvas_html(html, 512 * 1024);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("script"));
    }

    #[test]
    fn test_sanitize_canvas_rejects_iframe() {
        let html = "<iframe src='https://evil.com'></iframe>";
        let result = sanitize_canvas_html(html, 512 * 1024);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("iframe"));
    }

    #[test]
    fn test_sanitize_canvas_rejects_event_handler() {
        let html = "<div onclick=\"alert('xss')\">click me</div>";
        let result = sanitize_canvas_html(html, 512 * 1024);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("event handler"));
    }

    #[test]
    fn test_sanitize_canvas_rejects_onload() {
        let html = "<img src='x' onerror = \"alert(1)\">";
        let result = sanitize_canvas_html(html, 512 * 1024);
        assert!(result.is_err());
    }

    #[test]
    fn test_sanitize_canvas_rejects_javascript_url() {
        let html = "<a href=\"javascript:alert('xss')\">click</a>";
        let result = sanitize_canvas_html(html, 512 * 1024);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("javascript:"));
    }

    #[test]
    fn test_sanitize_canvas_rejects_data_html() {
        let html = "<a href=\"data:text/html,<script>alert(1)</script>\">x</a>";
        let result = sanitize_canvas_html(html, 512 * 1024);
        assert!(result.is_err());
    }

    #[test]
    fn test_sanitize_canvas_rejects_empty() {
        let result = sanitize_canvas_html("", 512 * 1024);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Empty"));
    }

    #[test]
    fn test_sanitize_canvas_size_limit() {
        let html = "x".repeat(1024);
        let result = sanitize_canvas_html(&html, 100);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too large"));
    }

    #[tokio::test]
    async fn test_canvas_present_tool() {
        let input = serde_json::json!({
            "html": "<h1>Test Canvas</h1><p>Hello world</p>",
            "title": "Test"
        });
        let tmp = std::env::temp_dir().join("openfang_canvas_test");
        let _ = std::fs::create_dir_all(&tmp);
        let result = tool_canvas_present(&input, Some(tmp.as_path())).await;
        assert!(result.is_ok());
        let output: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert!(output["canvas_id"].is_string());
        assert_eq!(output["title"], "Test");
        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_normalize_cron_create_upgrades_system_event_by_default() {
        let input = serde_json::json!({
            "name": "比特币价格监控",
            "schedule": { "kind": "every", "every_secs": 60 },
            "action": { "kind": "system_event", "text": "监控比特币价格：请查询当前BTC/USD比特币价格并返回" },
            "delivery": { "kind": "none" }
        });
        let out = normalize_cron_create_input_for_tool(&input);
        assert_eq!(out["action"]["kind"], "agent_turn");
        assert_eq!(out["action"]["message"], input["action"]["text"]);
        assert!(out["action"]["timeout_secs"].as_u64().unwrap_or(0) >= 60);
    }

    #[test]
    fn test_normalize_cron_create_respects_force_system_event() {
        let input = serde_json::json!({
            "name": "publish event only",
            "schedule": { "kind": "every", "every_secs": 60 },
            "action": { "kind": "system_event", "text": "cron.my_event", "force_system_event": true },
            "delivery": { "kind": "none" }
        });
        let out = normalize_cron_create_input_for_tool(&input);
        assert_eq!(out, input);
    }
}
