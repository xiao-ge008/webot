//! Built-in tool execution.
//!
//! Provides filesystem, web, shell, and inter-agent tools. Agent tools
//! (agent_send, agent_spawn, etc.) require a KernelHandle to be passed in.

use crate::kernel_handle::KernelHandle;
use crate::mcp;
use crate::media_understanding::MediaEngine;
use crate::web_search::{parse_ddg_results, WebToolsContext};
use calamine::{open_workbook_auto_from_rs, Reader};
use openfang_skills::registry::SkillRegistry;
use openfang_skills::InstalledSkill;
use openfang_types::taint::{TaintLabel, TaintSink, TaintedValue};
use openfang_types::tool::{ToolDefinition, ToolResult};
use std::collections::{BTreeMap, HashSet};
use std::future::Future;
use std::io::{BufRead, BufReader, Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracing::{debug, warn};
use zip::ZipArchive;

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

#[derive(Debug, Default, Clone)]
struct RuntimeSkillSelectorMeta {
    base_tool: Option<String>,
    capability_key: Option<String>,
    capability_scope: Option<String>,
    source_policy: Option<String>,
    specialization: Option<String>,
    subject_policy: Option<String>,
    intent_tags: Vec<String>,
    requires_slots: Vec<String>,
    supports_text_only: bool,
    preferred_mime_types: Vec<String>,
}

fn runtime_skill_selector_meta(skill: &InstalledSkill) -> RuntimeSkillSelectorMeta {
    let mut tag_map = BTreeMap::<String, Vec<String>>::new();
    let mut supports_text_only = false;
    for tag in &skill.manifest.skill.tags {
        let trimmed = tag.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.eq_ignore_ascii_case("supports-text-only") {
            supports_text_only = true;
            continue;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            tag_map
                .entry(key.trim().to_ascii_lowercase())
                .or_default()
                .push(value.trim().to_string());
        }
    }
    RuntimeSkillSelectorMeta {
        base_tool: tag_map
            .get("base-tool")
            .and_then(|values| values.first().cloned()),
        capability_key: tag_map
            .get("capability-key")
            .and_then(|values| values.first().cloned()),
        capability_scope: tag_map
            .get("capability-scope")
            .and_then(|values| values.first().cloned()),
        source_policy: tag_map
            .get("source-policy")
            .and_then(|values| values.first().cloned()),
        specialization: tag_map
            .get("specialization")
            .and_then(|values| values.first().cloned()),
        subject_policy: tag_map
            .get("subject-policy")
            .and_then(|values| values.first().cloned()),
        intent_tags: tag_map.get("intent").cloned().unwrap_or_default(),
        requires_slots: tag_map.get("requires-slot").cloned().unwrap_or_default(),
        supports_text_only,
        preferred_mime_types: tag_map.get("preferred-mime").cloned().unwrap_or_default(),
    }
}

fn selector_slot_present(input: &serde_json::Value, slot: &str) -> bool {
    let slot = slot.trim().to_ascii_lowercase();
    match slot.as_str() {
        "prompt" | "text" | "message" | "description" | "question" => has_any_non_empty_field(
            input,
            &["prompt", "text", "message", "description", "question"],
        ),
        "image" => has_any_non_empty_field(
            input,
            &[
                "image_path",
                "image_url",
                "image_base64",
                "image",
                "source_image",
                "reference_image",
            ],
        ),
        "video" => has_any_non_empty_field(
            input,
            &[
                "video_path",
                "video_url",
                "video_base64",
                "source_video",
                "video",
            ],
        ),
        "audio" => has_any_non_empty_field(
            input,
            &[
                "audio_path",
                "audio_url",
                "audio_base64",
                "audio",
                "path",
                "url",
            ],
        ),
        "voice" => has_any_non_empty_field(input, &["voice", "speaker", "speaker_profile_id"]),
        other => input
            .get(other)
            .map(|value| !value.is_null())
            .unwrap_or(false),
    }
}

fn selector_input_prompt(input: &serde_json::Value) -> String {
    ["prompt", "text", "message", "description", "question"]
        .iter()
        .find_map(|key| input.get(*key).and_then(|value| value.as_str()))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn selector_input_document_type(input: &serde_json::Value) -> String {
    let explicit = [
        "document_type",
        "documentType",
        "file_type",
        "fileType",
        "mime_type",
        "mimeType",
    ]
    .iter()
    .find_map(|key| input.get(*key).and_then(|value| value.as_str()))
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .unwrap_or_default()
    .to_ascii_lowercase();
    if !explicit.is_empty() {
        if explicit.contains("pdf") {
            return "pdf".to_string();
        }
        if explicit.contains("docx") {
            return "docx".to_string();
        }
        if explicit == "doc" || explicit.contains("msword") {
            return "doc".to_string();
        }
        if explicit.contains("xlsx") {
            return "xlsx".to_string();
        }
        if explicit == "xls" {
            return "xls".to_string();
        }
        if explicit.contains("csv") {
            return "csv".to_string();
        }
        if explicit.contains("pptx") {
            return "pptx".to_string();
        }
        if explicit == "ppt" {
            return "ppt".to_string();
        }
        if explicit.contains("markdown") || explicit == "md" {
            return "md".to_string();
        }
        if explicit.contains("json") {
            return "json".to_string();
        }
        if explicit.contains("text") || explicit == "txt" {
            return "txt".to_string();
        }
    }

    let path = [
        "path",
        "url",
        "source_path",
        "source_url",
        "file",
        "file_path",
    ]
    .iter()
    .find_map(|key| input.get(*key).and_then(|value| value.as_str()))
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .unwrap_or_default();
    let path_lower = path.to_ascii_lowercase();
    for ext in [
        "pdf", "docx", "doc", "xlsx", "xls", "csv", "pptx", "ppt", "txt", "md", "json",
    ] {
        if path_lower.ends_with(&format!(".{ext}")) {
            return ext.to_string();
        }
    }
    String::new()
}

fn selector_input_mime_type(input: &serde_json::Value) -> String {
    ["mime_type", "mimeType", "content_type", "contentType"]
        .iter()
        .find_map(|key| input.get(*key).and_then(|value| value.as_str()))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn selector_input_media_kind(input: &serde_json::Value) -> &'static str {
    let mime_type = selector_input_mime_type(input);
    if mime_type.starts_with("image/") {
        return "image";
    }
    if mime_type.starts_with("video/") {
        return "video";
    }
    if mime_type.starts_with("audio/") {
        return "audio";
    }
    let path_like = [
        "path",
        "url",
        "source_path",
        "source_url",
        "file",
        "file_path",
    ]
    .iter()
    .find_map(|key| input.get(*key).and_then(|value| value.as_str()))
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .unwrap_or_default()
    .to_ascii_lowercase();
    if [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]
        .iter()
        .any(|ext| path_like.ends_with(ext))
    {
        return "image";
    }
    if [".mp4", ".mov", ".webm"]
        .iter()
        .any(|ext| path_like.ends_with(ext))
    {
        return "video";
    }
    if [".mp3", ".wav", ".ogg", ".flac", ".m4a"]
        .iter()
        .any(|ext| path_like.ends_with(ext))
    {
        return "audio";
    }
    "unknown"
}

fn selector_prompt_subject(prompt: &str) -> &'static str {
    let lowered = prompt.to_ascii_lowercase();
    if lowered.is_empty() {
        return "general";
    }
    if [
        "dance",
        "girl",
        "boy",
        "woman",
        "man",
        "character",
        "person",
        "idol",
    ]
    .iter()
    .any(|item| lowered.contains(item))
        || prompt.contains("人物")
        || prompt.contains("女孩")
        || prompt.contains("男孩")
        || prompt.contains("跳舞")
    {
        return "character";
    }
    if ["scene", "landscape", "city", "room", "environment"]
        .iter()
        .any(|item| lowered.contains(item))
        || prompt.contains("场景")
        || prompt.contains("风景")
        || prompt.contains("城市")
    {
        return "scene";
    }
    "general"
}

fn selector_source_policy_matches(
    meta: &RuntimeSkillSelectorMeta,
    input: &serde_json::Value,
) -> bool {
    match meta
        .source_policy
        .as_deref()
        .unwrap_or("optional")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "requires_image" => selector_slot_present(input, "image"),
        "requires_video" => selector_slot_present(input, "video"),
        "requires_audio" => selector_slot_present(input, "audio"),
        "text_only" => {
            !selector_slot_present(input, "image")
                && !selector_slot_present(input, "video")
                && !selector_slot_present(input, "audio")
        }
        _ => true,
    }
}

fn selector_score_skill(
    skill: &InstalledSkill,
    tool_name: &str,
    input: &serde_json::Value,
    want_component_skill: bool,
) -> i64 {
    let meta = runtime_skill_selector_meta(skill);
    if !selector_source_policy_matches(&meta, input) {
        return i64::MIN / 4;
    }
    if meta
        .requires_slots
        .iter()
        .any(|slot| !selector_slot_present(input, slot))
    {
        return i64::MIN / 4;
    }
    let has_image_source = selector_slot_present(input, "image");
    let has_video_source = selector_slot_present(input, "video");
    let has_audio_source = selector_slot_present(input, "audio");
    let has_media_source = has_image_source || has_video_source || has_audio_source;
    if !meta.supports_text_only && !has_media_source {
        return i64::MIN / 4;
    }

    let prompt = selector_input_prompt(input);
    let prompt_lower = prompt.to_ascii_lowercase();
    let subject = selector_prompt_subject(&prompt);
    let document_type = selector_input_document_type(input);
    let mime_type = selector_input_mime_type(input);
    let mut score = 0_i64;

    if runtime_skill_is_component(skill) == want_component_skill {
        score += 200;
    }
    if meta
        .base_tool
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case(tool_name))
        .unwrap_or(false)
    {
        score += 60;
    }
    if let Some((capability_key, capability_scope)) = capability_descriptor_for_tool(tool_name) {
        if meta
            .capability_key
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case(capability_key))
            .unwrap_or(false)
        {
            score += 40;
        }
        if meta
            .capability_scope
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case(capability_scope))
            .unwrap_or(false)
        {
            score += 10;
        }
    }
    match meta.specialization.as_deref().unwrap_or("general") {
        "character" if subject == "character" => score += 80,
        "scene" if subject == "scene" => score += 80,
        "general" => score += 20,
        specialization
            if !document_type.is_empty() && specialization.eq_ignore_ascii_case(&document_type) =>
        {
            score += 90
        }
        "ocr"
            if prompt_lower.contains("ocr")
                || prompt.contains("文字")
                || prompt.contains("表格") =>
        {
            score += 70
        }
        _ => {}
    }
    if meta
        .subject_policy
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("person_first"))
        .unwrap_or(false)
        && subject == "character"
    {
        score += 30;
    }
    if meta.supports_text_only && !has_media_source {
        score += 25;
    }
    if meta
        .subject_policy
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("document_first"))
        .unwrap_or(false)
        && !document_type.is_empty()
    {
        score += 30;
    }
    score += meta
        .preferred_mime_types
        .iter()
        .filter(|item| {
            let expected = item.trim().to_ascii_lowercase();
            !expected.is_empty()
                && ((expected.ends_with("/*")
                    && mime_type.starts_with(expected.trim_end_matches('*').trim_end_matches('/')))
                    || (!mime_type.is_empty() && expected == mime_type))
        })
        .count() as i64
        * 15;
    score += meta
        .intent_tags
        .iter()
        .filter(|tag| {
            !tag.trim().is_empty() && prompt_lower.contains(&tag.trim().to_ascii_lowercase())
        })
        .count() as i64
        * 20;
    score
}

fn enrich_skill_input(
    input: &serde_json::Value,
    caller_agent_id: Option<&str>,
) -> serde_json::Value {
    let mut enriched = input.clone();
    let Some(agent_id) = caller_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return enriched;
    };
    if let Some(map) = enriched.as_object_mut() {
        map.entry("agentId".to_string())
            .or_insert_with(|| serde_json::Value::String(agent_id.to_string()));
        map.entry("callerAgentId".to_string())
            .or_insert_with(|| serde_json::Value::String(agent_id.to_string()));
    }
    enriched
}

#[derive(Debug, Clone, serde::Deserialize)]
struct RuntimeRegistryCapabilityDescriptor {
    key: String,
    scope: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct RuntimeRegistryProviderRecord {
    provider_id: String,
    provider_type: String,
    capabilities: Vec<RuntimeRegistryCapabilityDescriptor>,
    enabled: bool,
    health_state: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct RuntimeRegistryProviderBinding {
    capability_key: String,
    capability_scope: String,
    provider_id: String,
    enabled: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct RuntimeRegistryAgentBinding {
    capability_key: String,
    capability_scope: String,
    provider_id: Option<String>,
    enabled: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct RuntimeRegistryHealthState {
    provider_id: String,
    health_state: String,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
struct RuntimeCapabilityRegistrySnapshot {
    providers: Vec<RuntimeRegistryProviderRecord>,
    bindings: Vec<RuntimeRegistryProviderBinding>,
    health_states: Vec<RuntimeRegistryHealthState>,
    agent_bindings: Vec<RuntimeRegistryAgentBinding>,
}

fn capability_descriptor_for_tool(tool_name: &str) -> Option<(&'static str, &'static str)> {
    match tool_name {
        "image_generate" => Some(("generate.image", "generic")),
        "image_edit" => Some(("edit.image", "generic")),
        "video_generate" => Some(("generate.video", "generic")),
        "video_edit" => Some(("edit.video", "generic")),
        "text_to_speech" => Some(("generate.audio", "generic")),
        "speech_to_text" => Some(("transcribe.audio", "generic")),
        "image_analyze" | "media_describe" => Some(("analyze.media", "generic")),
        "document_parse" => Some(("parse.document", "generic")),
        "document_extract" => Some(("extract.document", "generic")),
        "document_summarize" => Some(("summarize.document", "generic")),
        "document_convert" => Some(("convert.document", "generic")),
        "document_compare" => Some(("compare.document", "generic")),
        "document_preview" => Some(("preview.document", "generic")),
        "document_chunk" => Some(("chunk.document", "generic")),
        "my_identity_patch" => Some(("patch.identity", "self")),
        "my_memory_patch" => Some(("patch.memory", "self")),
        "my_upgrade_review" => Some(("review.upgrade", "self")),
        "my_upgrade_apply" => Some(("apply.upgrade", "self")),
        _ => None,
    }
}

async fn fetch_capability_registry_snapshot(
    agent_id: Option<&str>,
    capability_key: &str,
    capability_scope: &str,
) -> Option<RuntimeCapabilityRegistrySnapshot> {
    let service_base = webot_service_base_url()?;
    let client = reqwest::Client::new();
    let mut request = client
        .get(format!(
            "{service_base}/api/management/capabilities/providers"
        ))
        .query(&[
            ("capability_key", capability_key),
            ("capability_scope", capability_scope),
        ])
        .timeout(std::time::Duration::from_secs(8));
    if let Some(agent_id) = agent_id.map(str::trim).filter(|value| !value.is_empty()) {
        request = request.query(&[("agent_id", agent_id)]);
    }
    let response = request.send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    response
        .json::<RuntimeCapabilityRegistrySnapshot>()
        .await
        .ok()
}

async fn fetch_registry_snapshot_for_tool(
    tool_name: &str,
    agent_id: Option<&str>,
) -> Option<RuntimeCapabilityRegistrySnapshot> {
    let (capability_key, capability_scope) = capability_descriptor_for_tool(tool_name)?;
    fetch_capability_registry_snapshot(agent_id, capability_key, capability_scope).await
}

fn pick_job_text<'a>(values: &[Option<&'a serde_json::Value>]) -> Option<String> {
    values.iter().find_map(|value| {
        value
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
    })
}

fn pick_job_number(values: &[Option<&serde_json::Value>]) -> Option<f64> {
    values
        .iter()
        .find_map(|value| value.and_then(serde_json::Value::as_f64))
}

fn extract_job_result_payload<'a>(
    output: &'a serde_json::Value,
) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    let object = output.as_object()?;
    if object
        .get("kind")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("job_result"))
    {
        return Some(object);
    }
    [
        "job_result",
        "jobResult",
        "presentable_result",
        "presentableResult",
    ]
    .iter()
    .find_map(|key| {
        object
            .get(*key)
            .and_then(serde_json::Value::as_object)
            .filter(|presentable| {
                presentable
                    .get("kind")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|value| value.trim().eq_ignore_ascii_case("job_result"))
            })
    })
}

fn value_has_kind(value: &serde_json::Value, expected: &str) -> bool {
    value.as_object().is_some_and(|object| {
        object
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|kind| kind.trim().eq_ignore_ascii_case(expected))
    })
}

fn normalize_component_skill_media_payload(
    mut payload: serde_json::Value,
    tool_name: &str,
) -> serde_json::Value {
    let Some(object) = payload.as_object_mut() else {
        return payload;
    };

    object
        .entry("tool".to_string())
        .or_insert_with(|| serde_json::Value::String(tool_name.to_string()));

    if let Some(output_type) = object.get("outputType").cloned() {
        object
            .entry("output_type".to_string())
            .or_insert(output_type);
    }
    if let Some(output_type) = object.get("output_type").cloned() {
        object
            .entry("outputType".to_string())
            .or_insert(output_type);
    }
    if let Some(provider_meta) = object.get("providerMeta").cloned() {
        object
            .entry("provider_meta".to_string())
            .or_insert(provider_meta);
    }
    if let Some(provider_meta) = object.get("provider_meta").cloned() {
        object
            .entry("providerMeta".to_string())
            .or_insert(provider_meta);
    }

    let presentable = object
        .get("presentable_result")
        .cloned()
        .or_else(|| object.get("presentableResult").cloned());
    if let Some(presentable) = presentable {
        object
            .entry("presentable_result".to_string())
            .or_insert_with(|| presentable.clone());
        object
            .entry("presentableResult".to_string())
            .or_insert_with(|| presentable.clone());
        if value_has_kind(&presentable, "job_result") {
            object
                .entry("job_result".to_string())
                .or_insert_with(|| presentable.clone());
            object.entry("jobResult".to_string()).or_insert(presentable);
        }
    }

    let job_result = object
        .get("job_result")
        .cloned()
        .or_else(|| object.get("jobResult").cloned());
    if let Some(job_result) = job_result {
        object
            .entry("job_result".to_string())
            .or_insert_with(|| job_result.clone());
        object
            .entry("jobResult".to_string())
            .or_insert_with(|| job_result.clone());
        if value_has_kind(&job_result, "job_result") {
            object
                .entry("presentable_result".to_string())
                .or_insert_with(|| job_result.clone());
            object
                .entry("presentableResult".to_string())
                .or_insert(job_result);
        }
    }

    payload
}

fn normalize_component_skill_media_output(
    content: &str,
    tool_name: &str,
) -> Result<String, String> {
    let parsed = serde_json::from_str::<serde_json::Value>(content)
        .map_err(|err| format!("Component skill returned invalid JSON: {err}"))?;
    let normalized = normalize_component_skill_media_payload(parsed, tool_name);
    serde_json::to_string_pretty(&normalized).map_err(|err| format!("Serialize error: {err}"))
}

async fn maybe_upsert_capability_job_from_tool_output(
    tool_name: &str,
    content: &str,
    caller_agent_id: Option<&str>,
) {
    let service_base = match webot_service_base_url() {
        Some(value) => value,
        None => return,
    };
    let owner_agent_id = match caller_agent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => value,
        None => return,
    };
    let output = match serde_json::from_str::<serde_json::Value>(content) {
        Ok(value) => value,
        Err(_) => return,
    };
    let Some(job_result) = extract_job_result_payload(&output) else {
        return;
    };
    let job_id = pick_job_text(&[
        job_result.get("job_id"),
        job_result.get("jobId"),
        job_result.get("id"),
    ]);
    let Some(job_id) = job_id else {
        return;
    };
    let (default_capability_key, default_capability_scope) =
        capability_descriptor_for_tool(tool_name).unwrap_or((tool_name, "generic"));
    let capability_key = pick_job_text(&[
        job_result.get("capability_key"),
        job_result.get("capabilityKey"),
    ])
    .unwrap_or_else(|| default_capability_key.to_string());
    let capability_scope = pick_job_text(&[
        job_result.get("capability_scope"),
        job_result.get("capabilityScope"),
    ])
    .unwrap_or_else(|| default_capability_scope.to_string());
    let metadata = match job_result
        .get("metadata")
        .or_else(|| output.get("metadata"))
    {
        Some(serde_json::Value::Object(map)) => {
            let mut merged = map.clone();
            merged.insert(
                "source_tool".to_string(),
                serde_json::Value::String(tool_name.to_string()),
            );
            merged.insert(
                "source".to_string(),
                serde_json::Value::String("openfang_runtime".to_string()),
            );
            serde_json::Value::Object(merged)
        }
        _ => serde_json::json!({
            "source_tool": tool_name,
            "source": "openfang_runtime",
        }),
    };
    let body = serde_json::json!({
        "job_id": job_id,
        "owner_agent_id": owner_agent_id,
        "capability_key": capability_key,
        "capability_scope": capability_scope,
        "provider_id": pick_job_text(&[
            output.get("provider_id"),
            output.get("providerId"),
            job_result.get("provider_id"),
            job_result.get("providerId"),
        ]),
        "provider_type": pick_job_text(&[
            output.get("provider_type"),
            output.get("providerType"),
            job_result.get("provider_type"),
            job_result.get("providerType"),
        ]),
        "route": pick_job_text(&[
            output.get("route"),
            job_result.get("route"),
        ]),
        "title": pick_job_text(&[
            job_result.get("title"),
            output.get("title"),
        ]),
        "summary": pick_job_text(&[
            job_result.get("summary"),
            output.get("summary"),
            output.get("text"),
        ]),
        "status": pick_job_text(&[
            job_result.get("status"),
            job_result.get("state"),
            output.get("status"),
            output.get("state"),
        ]).unwrap_or_else(|| "queued".to_string()),
        "progress_percent": pick_job_number(&[
            job_result.get("progress_percent"),
            job_result.get("progressPercent"),
            job_result.get("progress"),
            job_result.get("percent"),
            output.get("progress_percent"),
            output.get("progressPercent"),
        ]),
        "stage": pick_job_text(&[
            job_result.get("stage"),
            job_result.get("current_stage"),
            job_result.get("currentStage"),
            output.get("stage"),
        ]),
        "job_type": pick_job_text(&[
            job_result.get("job_type"),
            job_result.get("jobType"),
            output.get("job_type"),
            output.get("jobType"),
        ]),
        "result_payload": output,
        "metadata": metadata,
        "started_at": pick_job_text(&[
            output.get("started_at"),
            output.get("startedAt"),
        ]),
        "finished_at": pick_job_text(&[
            output.get("finished_at"),
            output.get("finishedAt"),
        ]),
        "last_heartbeat_at": pick_job_text(&[
            output.get("last_heartbeat_at"),
            output.get("lastHeartbeatAt"),
        ]),
    });

    let client = reqwest::Client::new();
    match client
        .post(format!("{service_base}/api/management/capabilities/jobs"))
        .timeout(std::time::Duration::from_secs(8))
        .json(&body)
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {}
        Ok(response) => {
            warn!(
                tool = tool_name,
                job_id = %job_id,
                status = %response.status(),
                "Failed to persist capability job from tool output"
            );
        }
        Err(error) => {
            warn!(
                tool = tool_name,
                job_id = %job_id,
                error = %error,
                "Failed to post capability job to Webot service"
            );
        }
    }
}

fn registry_provider_health_state<'a>(
    snapshot: &'a RuntimeCapabilityRegistrySnapshot,
    provider: &'a RuntimeRegistryProviderRecord,
) -> &'a str {
    snapshot
        .health_states
        .iter()
        .find(|item| item.provider_id == provider.provider_id)
        .map(|item| item.health_state.as_str())
        .unwrap_or(provider.health_state.as_str())
}

fn registry_health_allows(health_state: &str) -> bool {
    let lowered = health_state.trim().to_ascii_lowercase();
    !matches!(
        lowered.as_str(),
        "disabled" | "unavailable" | "removed" | "offline"
    )
}

fn registry_provider_supports(
    provider: &RuntimeRegistryProviderRecord,
    capability_key: &str,
    capability_scope: &str,
) -> bool {
    provider
        .capabilities
        .iter()
        .any(|item| item.key == capability_key && item.scope == capability_scope)
}

fn registry_binding_allows_provider(
    snapshot: &RuntimeCapabilityRegistrySnapshot,
    provider_id: &str,
    capability_key: &str,
    capability_scope: &str,
) -> bool {
    let matches = snapshot
        .bindings
        .iter()
        .filter(|item| {
            item.provider_id == provider_id
                && item.capability_key == capability_key
                && item.capability_scope == capability_scope
        })
        .collect::<Vec<_>>();
    if matches.is_empty() {
        return true;
    }
    matches.iter().any(|item| item.enabled)
}

fn registry_agent_allows_provider(
    snapshot: &RuntimeCapabilityRegistrySnapshot,
    provider_id: &str,
    capability_key: &str,
    capability_scope: &str,
) -> bool {
    let matches = snapshot
        .agent_bindings
        .iter()
        .filter(|item| {
            item.capability_key == capability_key && item.capability_scope == capability_scope
        })
        .collect::<Vec<_>>();
    if matches.is_empty() {
        return true;
    }
    let capability_disabled = matches
        .iter()
        .any(|item| item.provider_id.is_none() && !item.enabled);
    let capability_enabled = matches
        .iter()
        .any(|item| item.provider_id.is_none() && item.enabled);
    if capability_disabled && !capability_enabled {
        return false;
    }
    if matches
        .iter()
        .any(|item| item.provider_id.as_deref() == Some(provider_id) && !item.enabled)
    {
        return false;
    }
    let allowed_provider_ids = matches
        .iter()
        .filter(|item| item.enabled)
        .filter_map(|item| item.provider_id.as_deref())
        .collect::<std::collections::HashSet<_>>();
    if !allowed_provider_ids.is_empty() {
        return allowed_provider_ids.contains(provider_id);
    }
    true
}

fn registry_provider_is_enabled(
    snapshot: &RuntimeCapabilityRegistrySnapshot,
    provider_id: &str,
    capability_key: &str,
    capability_scope: &str,
) -> bool {
    let Some(provider) = snapshot
        .providers
        .iter()
        .find(|item| item.provider_id == provider_id)
    else {
        let has_allow_list = snapshot.agent_bindings.iter().any(|item| {
            item.capability_key == capability_key
                && item.capability_scope == capability_scope
                && item.enabled
                && item.provider_id.is_some()
        });
        return if has_allow_list {
            registry_agent_allows_provider(snapshot, provider_id, capability_key, capability_scope)
        } else {
            true
        };
    };
    provider.enabled
        && registry_health_allows(registry_provider_health_state(snapshot, provider))
        && registry_provider_supports(provider, capability_key, capability_scope)
        && registry_binding_allows_provider(snapshot, provider_id, capability_key, capability_scope)
        && registry_agent_allows_provider(snapshot, provider_id, capability_key, capability_scope)
}

fn registry_has_enabled_provider_type(
    snapshot: Option<&RuntimeCapabilityRegistrySnapshot>,
    capability_key: &str,
    capability_scope: &str,
    provider_type: &str,
) -> bool {
    let Some(snapshot) = snapshot else {
        return true;
    };
    snapshot.providers.iter().any(|provider| {
        provider.provider_type == provider_type
            && registry_provider_is_enabled(
                snapshot,
                &provider.provider_id,
                capability_key,
                capability_scope,
            )
    })
}

fn runtime_skill_provider_id(skill: &InstalledSkill, want_component_skill: bool) -> String {
    if want_component_skill {
        format!("component_skill:{}", skill.manifest.skill.name.trim())
    } else {
        format!("generic_provider:{}", skill.manifest.skill.name.trim())
    }
}

fn runtime_skill_allowed_by_registry(
    skill: &InstalledSkill,
    tool_name: &str,
    want_component_skill: bool,
    registry_snapshot: Option<&RuntimeCapabilityRegistrySnapshot>,
) -> bool {
    let Some(snapshot) = registry_snapshot else {
        return true;
    };
    let Some((capability_key, capability_scope)) = capability_descriptor_for_tool(tool_name) else {
        return true;
    };
    registry_provider_is_enabled(
        snapshot,
        &runtime_skill_provider_id(skill, want_component_skill),
        capability_key,
        capability_scope,
    )
}

fn select_skill_provider_for_tool<'a>(
    registry: &'a SkillRegistry,
    tool_name: &str,
    input: &serde_json::Value,
    allowed_skills: Option<&[String]>,
    want_component_skill: bool,
    registry_snapshot: Option<&RuntimeCapabilityRegistrySnapshot>,
) -> Option<&'a InstalledSkill> {
    let mut candidates = registry
        .visible_skills_for_agent(allowed_skills.unwrap_or(&[]))
        .into_iter()
        .filter(|skill| {
            runtime_skill_is_component(skill) == want_component_skill
                && runtime_skill_provides_tool(skill, tool_name)
                && runtime_skill_allowed_by_registry(
                    skill,
                    tool_name,
                    want_component_skill,
                    registry_snapshot,
                )
        })
        .collect::<Vec<_>>();
    if candidates.len() <= 1 {
        return candidates.into_iter().next();
    }
    candidates.sort_by(|left, right| {
        let left_score = selector_score_skill(left, tool_name, input, want_component_skill);
        let right_score = selector_score_skill(right, tool_name, input, want_component_skill);
        right_score
            .cmp(&left_score)
            .then_with(|| left.manifest.skill.name.cmp(&right.manifest.skill.name))
    });
    candidates.into_iter().find(|skill| {
        selector_score_skill(skill, tool_name, input, want_component_skill) > i64::MIN / 8
    })
}

async fn dispatch_skill_tool(
    registry: &SkillRegistry,
    tool_name: &str,
    input: &serde_json::Value,
    allowed_skills: Option<&[String]>,
    caller_agent_id: Option<&str>,
) -> Option<Result<String, String>> {
    if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
        registry,
        tool_name,
        input,
        allowed_skills,
        true,
        caller_agent_id,
    )
    .await
    {
        return Some(result);
    }
    dispatch_skill_tool_candidates_from_runtime(
        registry,
        tool_name,
        input,
        allowed_skills,
        false,
        caller_agent_id,
    )
    .await
}

fn runtime_skill_has_tag(skill: &InstalledSkill, expected: &str) -> bool {
    let expected = expected.trim();
    !expected.is_empty()
        && skill
            .manifest
            .skill
            .tags
            .iter()
            .any(|item| item.trim().eq_ignore_ascii_case(expected))
}

fn runtime_skill_is_component(skill: &InstalledSkill) -> bool {
    runtime_skill_has_tag(skill, "component-center")
        || runtime_skill_has_tag(skill, "component-skill")
}

fn runtime_skill_provides_tool(skill: &InstalledSkill, tool_name: &str) -> bool {
    skill
        .manifest
        .tools
        .provided
        .iter()
        .any(|tool| tool.name.trim() == tool_name)
}

async fn execute_registered_skill_tool(
    skill: &InstalledSkill,
    tool_name: &str,
    input: &serde_json::Value,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    debug!(
        tool = tool_name,
        skill = %skill.manifest.skill.name,
        "Dispatching to explicit skill"
    );
    match openfang_skills::loader::execute_skill_tool(
        &skill.manifest,
        &skill.path,
        tool_name,
        &enrich_skill_input(input, caller_agent_id),
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
    }
}

async fn dispatch_skill_tool_by_kind(
    registry: &SkillRegistry,
    tool_name: &str,
    input: &serde_json::Value,
    allowed_skills: Option<&[String]>,
    want_component_skill: bool,
    caller_agent_id: Option<&str>,
) -> Option<Result<String, String>> {
    let registry_snapshot = fetch_registry_snapshot_for_tool(tool_name, caller_agent_id).await;
    let skill = select_skill_provider_for_tool(
        registry,
        tool_name,
        input,
        allowed_skills,
        want_component_skill,
        registry_snapshot.as_ref(),
    )?;
    Some(execute_registered_skill_tool(skill, tool_name, input, caller_agent_id).await)
}

fn build_skill_dispatch_tool_candidates(tool_name: &str, input: &serde_json::Value) -> Vec<String> {
    let mut candidates = vec![tool_name.to_string()];
    match tool_name {
        "image_analyze" => candidates.push("media_describe".to_string()),
        "media_describe" => {
            if selector_input_media_kind(input) == "image" {
                candidates.push("image_analyze".to_string());
            }
        }
        "video_generate" => {
            if has_any_non_empty_field(
                input,
                &[
                    "image_path",
                    "image_url",
                    "image_base64",
                    "image",
                    "source_image",
                    "reference_image",
                ],
            ) {
                candidates = vec![
                    "image2video".to_string(),
                    "video_generate".to_string(),
                    "text2video".to_string(),
                ];
            } else {
                candidates = vec![
                    "text2video".to_string(),
                    "video_generate".to_string(),
                    "image2video".to_string(),
                ];
            }
        }
        "video_edit" => {
            if has_any_non_empty_field(
                input,
                &[
                    "video_path",
                    "video_url",
                    "video_base64",
                    "source_video",
                    "video",
                ],
            ) {
                candidates.push("video_generate".to_string());
            } else {
                candidates.push("image2video".to_string());
                candidates.push("video_generate".to_string());
            }
        }
        "document_parse" => candidates.push("document_extract".to_string()),
        "document_extract" => candidates.push("document_parse".to_string()),
        _ => {}
    }
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|item| {
            let key = item.trim().to_ascii_lowercase();
            !key.is_empty() && seen.insert(key)
        })
        .collect()
}

async fn dispatch_skill_tool_candidates_from_runtime(
    registry: &SkillRegistry,
    tool_name: &str,
    input: &serde_json::Value,
    allowed_skills: Option<&[String]>,
    want_component_skill: bool,
    caller_agent_id: Option<&str>,
) -> Option<Result<String, String>> {
    let candidates = build_skill_dispatch_tool_candidates(tool_name, input);
    for candidate in &candidates {
        if let Some(result) = dispatch_skill_tool_by_kind(
            registry,
            candidate,
            input,
            allowed_skills,
            want_component_skill,
            caller_agent_id,
        )
        .await
        {
            return Some(result);
        }
    }
    None
}

fn has_any_non_empty_field(input: &serde_json::Value, keys: &[&str]) -> bool {
    keys.iter().any(|key| {
        input
            .get(*key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
    })
}

fn build_video_presentable_result(
    tool_name: &str,
    result_payload: &serde_json::Value,
    input: &serde_json::Value,
) -> serde_json::Value {
    let video_urls = result_payload["video_urls"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    let saved_paths = result_payload["saved_to"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    let poster_urls = result_payload["poster_urls"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    let sources = if !video_urls.is_empty() {
        video_urls.clone()
    } else {
        saved_paths.clone()
    };
    let title = pick_string_field(input, "prompt")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(48).collect::<String>())
        .unwrap_or_else(|| {
            if tool_name == "video_edit" {
                "视频编辑结果".to_string()
            } else {
                "视频生成结果".to_string()
            }
        });
    let provider_meta = serde_json::json!({
        "route": result_payload["route"].as_str().unwrap_or("unknown"),
        "provider_id": result_payload["provider_id"].as_str().unwrap_or_default(),
        "provider_type": result_payload["provider_type"].as_str().unwrap_or_default(),
        "tool_name": result_payload["provider_tool"].as_str().unwrap_or_default(),
    });
    let items = sources
        .iter()
        .enumerate()
        .map(|(index, src)| {
            let poster = poster_urls
                .get(index)
                .cloned()
                .or_else(|| poster_urls.first().cloned());
            serde_json::json!({
                "media_type": "video",
                "asset": build_media_asset_ref(
                    src,
                    result_payload["mime_type"].as_str().unwrap_or("video/mp4"),
                    tool_name,
                    if video_urls.contains(src) { "url" } else { "saved_path" },
                    None,
                ),
                "poster_asset": poster.as_ref().map(|value| build_media_asset_ref(
                    value,
                    "image/png",
                    tool_name,
                    "poster",
                    None,
                )),
                "caption": if sources.len() == 1 {
                    title.clone()
                } else {
                    format!("{title} {}", index + 1)
                },
            })
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "kind": "media_result",
        "media_type": "video",
        "title": title,
        "summary": result_payload["summary"].as_str().or_else(|| result_payload["model"].as_str()).unwrap_or_default(),
        "provider_meta": provider_meta,
        "items": items,
    })
}

fn build_media_asset_ref(
    uri: &str,
    mime_type: &str,
    tool_name: &str,
    source: &str,
    extra: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut metadata = serde_json::Map::new();
    metadata.insert(
        "tool".to_string(),
        serde_json::Value::String(tool_name.to_string()),
    );
    metadata.insert(
        "source".to_string(),
        serde_json::Value::String(source.to_string()),
    );
    if let Some(serde_json::Value::Object(extra_map)) = extra {
        for (key, value) in extra_map {
            metadata.insert(key, value);
        }
    }
    let mut asset = serde_json::Map::new();
    asset.insert(
        "kind".to_string(),
        serde_json::Value::String(infer_asset_kind_from_uri(uri).to_string()),
    );
    asset.insert(
        "uri".to_string(),
        serde_json::Value::String(uri.trim().to_string()),
    );
    asset.insert(
        "mimeType".to_string(),
        serde_json::Value::String(mime_type.to_string()),
    );
    if let Some(file_name) = infer_file_name_from_uri(uri) {
        asset.insert("fileName".to_string(), serde_json::Value::String(file_name));
    }
    asset.insert("metadata".to_string(), serde_json::Value::Object(metadata));
    serde_json::Value::Object(asset)
}

fn build_image_presentable_result(
    tool_name: &str,
    result_payload: &serde_json::Value,
    input: &serde_json::Value,
) -> serde_json::Value {
    let image_urls = result_payload["image_urls"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    let saved_paths = result_payload["saved_to"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    let sources = if !image_urls.is_empty() {
        image_urls.clone()
    } else {
        saved_paths.clone()
    };
    let title = pick_string_field(input, "prompt")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(48).collect::<String>())
        .unwrap_or_else(|| {
            if tool_name == "image_edit" {
                "图片编辑结果".to_string()
            } else {
                "图片生成结果".to_string()
            }
        });
    let provider_meta = serde_json::json!({
        "route": result_payload["route"].as_str().unwrap_or("unknown"),
        "provider_id": result_payload["provider_id"].as_str().unwrap_or_default(),
        "provider_type": result_payload["provider_type"].as_str().unwrap_or_default(),
        "tool_name": result_payload["provider_tool"].as_str().unwrap_or_default(),
    });
    let items = sources
        .iter()
        .enumerate()
        .map(|(index, src)| {
            serde_json::json!({
                "media_type": "image",
                "asset": build_media_asset_ref(
                    src,
                    "image/png",
                    tool_name,
                    if image_urls.contains(src) { "url" } else { "saved_path" },
                    None,
                ),
                "caption": if sources.len() == 1 {
                    title.clone()
                } else {
                    format!("{title} {}", index + 1)
                },
            })
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "kind": "media_result",
        "media_type": "image",
        "title": title,
        "summary": result_payload["revised_prompt"]
            .as_str()
            .or_else(|| result_payload["model"].as_str())
            .unwrap_or_default(),
        "provider_meta": provider_meta,
        "items": items,
    })
}

fn build_audio_presentable_result(
    tool_name: &str,
    result_payload: &serde_json::Value,
    input: &serde_json::Value,
) -> serde_json::Value {
    let asset_url = result_payload["asset_url"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let mut sources = Vec::new();
    if let Some(url) = asset_url.clone() {
        sources.push(url);
    }
    if let Some(path) = result_payload["saved_to"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    {
        sources.push(path);
    }
    sources.extend(
        result_payload["saved_to"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(serde_json::Value::as_str)
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty()),
    );
    sources.sort();
    sources.dedup();

    let raw_text = pick_string_field(input, "text")
        .or_else(|| pick_string_field(result_payload, "requested_text"))
        .unwrap_or_default()
        .trim()
        .to_string();
    let title = if raw_text.is_empty() {
        "语音合成结果".to_string()
    } else {
        let preview = raw_text.chars().take(32).collect::<String>();
        if raw_text.chars().count() > 32 {
            format!("语音: {preview}…")
        } else {
            format!("语音: {preview}")
        }
    };
    let duration_estimate_ms = result_payload["duration_estimate_ms"].as_u64().or_else(|| {
        result_payload["duration_secs"]
            .as_f64()
            .map(|value| (value.max(0.0) * 1000.0).round() as u64)
    });
    let provider_meta = serde_json::json!({
        "route": result_payload["route"].as_str().unwrap_or("unknown"),
        "provider_id": result_payload["provider_id"].as_str().unwrap_or_default(),
        "provider_type": result_payload["provider_type"].as_str().unwrap_or_default(),
        "tool_name": result_payload["provider_tool"].as_str().unwrap_or_default(),
    });
    let summary = [
        result_payload["engine"].as_str(),
        result_payload["provider"].as_str(),
        result_payload["device"].as_str(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join(" · ");
    let items = sources
        .iter()
        .enumerate()
        .map(|(index, src)| {
            serde_json::json!({
                "media_type": "audio",
                "asset": build_media_asset_ref(
                    src,
                    result_payload["mime_type"].as_str().unwrap_or("audio/wav"),
                    tool_name,
                    if asset_url.as_deref() == Some(src.as_str()) { "url" } else { "saved_path" },
                    duration_estimate_ms.map(|duration| serde_json::json!({ "durationMs": duration })),
                ),
                "caption": if sources.len() == 1 {
                    title.clone()
                } else {
                    format!("{title} {}", index + 1)
                },
                "duration_ms": duration_estimate_ms,
                "transcript": if raw_text.is_empty() { None } else { Some(raw_text.clone()) },
            })
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "kind": "media_result",
        "media_type": "audio",
        "title": title,
        "summary": summary,
        "provider_meta": provider_meta,
        "items": items,
    })
}

fn build_speech_to_text_presentable_result(
    result_payload: &serde_json::Value,
) -> serde_json::Value {
    let transcript = result_payload["transcript"]
        .as_str()
        .or_else(|| result_payload["text"].as_str())
        .unwrap_or_default();
    let summary = [
        result_payload["provider"].as_str(),
        result_payload["model"].as_str(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join(" · ");
    let mut result = serde_json::Map::new();
    result.insert(
        "kind".to_string(),
        serde_json::Value::String("text_result".to_string()),
    );
    result.insert(
        "title".to_string(),
        serde_json::Value::String("语音转文本结果".to_string()),
    );
    result.insert(
        "text".to_string(),
        serde_json::Value::String(transcript.to_string()),
    );
    if !summary.is_empty() {
        result.insert("summary".to_string(), serde_json::Value::String(summary));
    }
    if let Some(source_asset) = result_payload
        .get("source_asset")
        .or_else(|| result_payload.get("sourceAsset"))
        .cloned()
        .filter(|value| value.is_object())
    {
        result.insert(
            "metadata".to_string(),
            serde_json::json!({
                "sourceAsset": source_asset,
            }),
        );
    }
    serde_json::Value::Object(result)
}

fn build_media_describe_presentable_result(
    result_payload: &serde_json::Value,
) -> serde_json::Value {
    let text = result_payload["description"]
        .as_str()
        .or_else(|| result_payload["transcript"].as_str())
        .or_else(|| result_payload["text"].as_str())
        .or_else(|| result_payload["summary"].as_str())
        .or_else(|| result_payload["vision_summary"].as_str())
        .or_else(|| result_payload["ocr_summary"].as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let media_type = result_payload["media_type"]
        .as_str()
        .or_else(|| result_payload["mediaType"].as_str())
        .unwrap_or("media")
        .trim()
        .to_ascii_lowercase();
    let title = match media_type.as_str() {
        "image" => "图片理解结果",
        "audio" => "音频理解结果",
        "video" => "视频理解结果",
        _ => "媒体理解结果",
    };
    let summary = [
        result_payload["provider"].as_str(),
        result_payload["model"].as_str(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join(" · ");
    let mut result = serde_json::Map::new();
    result.insert(
        "kind".to_string(),
        serde_json::Value::String("text_result".to_string()),
    );
    result.insert(
        "title".to_string(),
        serde_json::Value::String(title.to_string()),
    );
    result.insert("text".to_string(), serde_json::Value::String(text));
    if !summary.is_empty() {
        result.insert("summary".to_string(), serde_json::Value::String(summary));
    }
    if let Some(source_asset) = result_payload
        .get("source_asset")
        .or_else(|| result_payload.get("sourceAsset"))
        .cloned()
        .filter(|value| value.is_object())
    {
        result.insert(
            "metadata".to_string(),
            serde_json::json!({
                "sourceAsset": source_asset,
                "mediaType": media_type,
            }),
        );
    }
    serde_json::Value::Object(result)
}

fn enrich_media_describe_payload(
    mut payload: serde_json::Value,
    media_type: &str,
    source_asset: serde_json::Value,
    prompt: &str,
) -> serde_json::Value {
    let presentable_result = build_media_describe_presentable_result(&payload);
    if let Some(map) = payload.as_object_mut() {
        map.entry("tool".to_string())
            .or_insert_with(|| serde_json::Value::String("media_describe".to_string()));
        map.entry("media_type".to_string())
            .or_insert_with(|| serde_json::Value::String(media_type.to_string()));
        map.entry("mediaType".to_string())
            .or_insert_with(|| serde_json::Value::String(media_type.to_string()));
        map.entry("source_asset".to_string())
            .or_insert_with(|| source_asset.clone());
        map.entry("sourceAsset".to_string()).or_insert(source_asset);
        if !prompt.trim().is_empty() {
            map.entry("prompt".to_string())
                .or_insert_with(|| serde_json::Value::String(prompt.trim().to_string()));
        }
        map.entry("presentable_result".to_string())
            .or_insert(presentable_result);
    }
    payload
}

fn build_media_source_asset_ref(path: &Path, mime_type: &str) -> serde_json::Value {
    build_media_asset_ref(
        &path.to_string_lossy(),
        mime_type,
        "media_describe",
        "source_path",
        Some(serde_json::json!({
            "role": "source",
        })),
    )
}

fn enrich_presentable_payload(
    mut payload: serde_json::Value,
    tool_name: &str,
    route: &str,
    provider_id: &str,
    provider_type: &str,
    provider_tool: &str,
    presentable_result: serde_json::Value,
) -> serde_json::Value {
    if let Some(map) = payload.as_object_mut() {
        map.entry("tool".to_string())
            .or_insert_with(|| serde_json::Value::String(tool_name.to_string()));
        map.entry("route".to_string())
            .or_insert_with(|| serde_json::Value::String(route.to_string()));
        map.entry("provider_id".to_string())
            .or_insert_with(|| serde_json::Value::String(provider_id.to_string()));
        map.entry("provider_type".to_string())
            .or_insert_with(|| serde_json::Value::String(provider_type.to_string()));
        map.entry("provider_tool".to_string())
            .or_insert_with(|| serde_json::Value::String(provider_tool.to_string()));
        map.entry("presentable_result".to_string())
            .or_insert(presentable_result);
    }
    payload
}

fn build_video_unavailable_response(
    tool_name: &str,
    input: &serde_json::Value,
    attempts: &[String],
) -> serde_json::Value {
    let title = if tool_name == "video_edit" {
        "视频编辑当前不可用"
    } else {
        "视频生成当前不可用"
    };
    let prompt = pick_string_field(input, "prompt")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    let has_source_image = has_any_non_empty_field(
        input,
        &[
            "image_path",
            "image_url",
            "image_base64",
            "image",
            "source_image",
            "reference_image",
        ],
    );
    let self_expression = !prompt.is_empty() && prompt_hits_self_expression(prompt);
    let mut message = title.to_string();
    if !prompt.is_empty() {
        message.push_str("。请求：");
        message.push_str(prompt);
    }
    if self_expression && has_source_image {
        message.push_str("。已识别为“智能体用当前形象出视频”，并已按图生视频优先路线尝试。");
    } else if self_expression {
        message.push_str(
            "。已识别为“智能体用当前形象出视频”，但当前没有可用视频 provider 或组件可完成该请求。",
        );
    } else if has_source_image {
        message.push_str("。当前请求已带源图，但没有可用的视频 provider 或组件完成图生视频。");
    }
    if !attempts.is_empty() {
        message.push_str("。已尝试路径：");
        message.push_str(&attempts.join(" -> "));
    }
    let hint = if self_expression && has_source_image {
        Some("请优先检查是否已启用“图片生成视频”组件绑定，或是否配置了可用的视频 provider。")
    } else if self_expression {
        Some("请先确认该智能体已有立绘或自我照片，并启用了可用的视频组件或 provider。")
    } else if has_source_image {
        Some("请检查“图片生成视频”组件绑定或视频 provider 是否可用。")
    } else {
        Some("请检查视频组件绑定、全局视频 provider，或当前模型是否具备原生视频能力。")
    };
    serde_json::json!({
        "ok": false,
        "tool": tool_name,
        "unavailable": true,
        "code": "video_unavailable",
        "message": message,
        "self_expression": self_expression,
        "has_source_image": has_source_image,
        "hint": hint,
        "presentable_result": {
            "kind": "error_result",
            "title": title,
            "code": "video_unavailable",
            "message": message,
            "summary": hint,
        },
    })
}

fn build_capability_unavailable_response(
    tool_name: &str,
    title: &str,
    code: &str,
    message: &str,
    attempts: &[String],
) -> serde_json::Value {
    let detail = if attempts.is_empty() {
        message.to_string()
    } else {
        format!("{message}。已尝试路径：{}", attempts.join(" -> "))
    };
    serde_json::json!({
        "ok": false,
        "tool": tool_name,
        "unavailable": true,
        "code": code,
        "message": detail,
        "presentable_result": {
            "kind": "error_result",
            "title": title,
            "code": code,
            "message": detail,
        }
    })
}

fn pick_document_source_field<'a>(input: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|key| {
        input
            .get(*key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    })
}

fn infer_document_type_from_name(name: &str) -> String {
    let normalized = name
        .trim()
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if normalized.ends_with(".pdf") {
        "pdf".to_string()
    } else if normalized.ends_with(".docx") {
        "docx".to_string()
    } else if normalized.ends_with(".doc") {
        "doc".to_string()
    } else if normalized.ends_with(".xlsx") {
        "xlsx".to_string()
    } else if normalized.ends_with(".xls") {
        "xls".to_string()
    } else if normalized.ends_with(".csv") {
        "csv".to_string()
    } else if normalized.ends_with(".pptx") {
        "pptx".to_string()
    } else if normalized.ends_with(".ppt") {
        "ppt".to_string()
    } else if normalized.ends_with(".md") {
        "md".to_string()
    } else if normalized.ends_with(".json") {
        "json".to_string()
    } else if normalized.ends_with(".txt") {
        "txt".to_string()
    } else {
        "unknown".to_string()
    }
}

fn infer_document_mime_type(document_type: &str) -> &'static str {
    match document_type {
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "csv" => "text/csv",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "md" => "text/markdown",
        "json" => "application/json",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}

fn document_type_is_text_like(document_type: &str) -> bool {
    matches!(document_type, "txt" | "md" | "json" | "csv")
}

fn infer_asset_kind_from_uri(uri: &str) -> &'static str {
    let trimmed = uri.trim();
    let lowered = trimmed.to_ascii_lowercase();
    if lowered.starts_with("data:") {
        "data_url"
    } else if trimmed.starts_with("/api/uploads/") {
        "upload_url"
    } else if trimmed.starts_with("/api/management/") {
        "management_media_url"
    } else if lowered.starts_with("http://") || lowered.starts_with("https://") {
        "remote_url"
    } else if lowered.starts_with("file://") {
        "absolute_file"
    } else if Path::new(trimmed).is_absolute() {
        "absolute_file"
    } else {
        "workspace_file"
    }
}

fn infer_file_name_from_uri(uri: &str) -> Option<String> {
    let trimmed = uri.trim();
    if trimmed.is_empty() {
        return None;
    }
    let normalized = trimmed
        .trim_start_matches("file://")
        .split(['?', '#'])
        .next()
        .unwrap_or(trimmed)
        .replace('\\', "/");
    normalized
        .rsplit('/')
        .find(|item| !item.trim().is_empty())
        .map(|item| item.trim().to_string())
}

fn build_document_asset_ref(
    uri: &str,
    document_type: &str,
    file_name: Option<&str>,
    extra: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut asset = serde_json::Map::new();
    asset.insert(
        "kind".to_string(),
        serde_json::Value::String(infer_asset_kind_from_uri(uri).to_string()),
    );
    asset.insert(
        "uri".to_string(),
        serde_json::Value::String(uri.trim().to_string()),
    );
    asset.insert(
        "mimeType".to_string(),
        serde_json::Value::String(infer_document_mime_type(document_type).to_string()),
    );
    if let Some(name) = file_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| infer_file_name_from_uri(uri))
    {
        asset.insert("fileName".to_string(), serde_json::Value::String(name));
    }
    if let Some(serde_json::Value::Object(extra_map)) = extra {
        if !extra_map.is_empty() {
            asset.insert("metadata".to_string(), serde_json::Value::Object(extra_map));
        }
    }
    serde_json::Value::Object(asset)
}

fn summarize_document_text(text: &str, max_chars: usize) -> String {
    let compact = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if compact.is_empty() {
        return String::new();
    }
    let mut chars = compact.chars();
    let preview = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{preview}...")
    } else {
        preview
    }
}

fn document_type_supports_runtime_extraction(document_type: &str) -> bool {
    matches!(
        document_type,
        "pdf" | "docx" | "doc" | "xlsx" | "xls" | "xlsb" | "pptx"
    )
}

fn decode_data_url_text(raw: &str) -> Result<String, String> {
    let Some((meta, payload)) = raw.split_once(',') else {
        return Err("Invalid data URL".to_string());
    };
    if meta.to_ascii_lowercase().contains(";base64") {
        use base64::Engine;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(payload)
            .map_err(|err| format!("Failed to decode data URL: {err}"))?;
        String::from_utf8(decoded).map_err(|err| format!("Data URL is not valid UTF-8: {err}"))
    } else {
        Ok(payload.to_string())
    }
}

fn decode_data_url_bytes(raw: &str) -> Result<Vec<u8>, String> {
    let Some((meta, payload)) = raw.split_once(',') else {
        return Err("Invalid data URL".to_string());
    };
    if meta.to_ascii_lowercase().contains(";base64") {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(payload)
            .map_err(|err| format!("Failed to decode data URL: {err}"))
    } else {
        Ok(payload.as_bytes().to_vec())
    }
}

fn decode_basic_xml_entities(raw: &str) -> String {
    raw.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn normalize_document_text(text: &str) -> Option<String> {
    let text = text.replace('\u{0000}', "");
    let mut lines = Vec::new();
    for line in text.lines() {
        let normalized = line
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string();
        if !normalized.is_empty() {
            lines.push(normalized);
        } else if lines.last().is_some_and(|last: &String| !last.is_empty()) {
            lines.push(String::new());
        }
    }
    while lines.last().is_some_and(|last| last.is_empty()) {
        lines.pop();
    }
    let output = lines.join("\n").trim().to_string();
    if output.is_empty() {
        None
    } else {
        Some(output)
    }
}

fn extract_text_from_xmlish_markup(xml: &str) -> Option<String> {
    let replaced = xml
        .replace("<w:tab/>", "\t")
        .replace("<w:tab />", "\t")
        .replace("<w:br/>", "\n")
        .replace("<w:br />", "\n")
        .replace("<a:br/>", "\n")
        .replace("<a:br />", "\n")
        .replace("</w:p>", "\n")
        .replace("</w:tr>", "\n")
        .replace("</w:tc>", "\t")
        .replace("</a:p>", "\n")
        .replace("</a:tr>", "\n")
        .replace("</a:tc>", "\t")
        .replace("</text:p>", "\n")
        .replace("</text:span>", " ");

    let mut plain = String::with_capacity(replaced.len());
    let mut in_tag = false;
    for ch in replaced.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => plain.push(ch),
            _ => {}
        }
    }
    normalize_document_text(&decode_basic_xml_entities(&plain))
}

fn extract_docx_text_from_bytes(bytes: &[u8]) -> Result<Option<String>, String> {
    let reader = Cursor::new(bytes.to_vec());
    let mut archive =
        ZipArchive::new(reader).map_err(|err| format!("打开 docx 压缩包失败: {err}"))?;
    let mut parts = Vec::new();
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|err| format!("读取 docx 条目失败: {err}"))?;
        let name = file.name().to_string();
        let wanted = name == "word/document.xml"
            || (name.starts_with("word/header") && name.ends_with(".xml"))
            || (name.starts_with("word/footer") && name.ends_with(".xml"))
            || name == "word/footnotes.xml"
            || name == "word/endnotes.xml";
        if !wanted {
            continue;
        }
        let mut xml = String::new();
        file.read_to_string(&mut xml)
            .map_err(|err| format!("读取 docx XML 失败({name}): {err}"))?;
        if let Some(text) = extract_text_from_xmlish_markup(&xml) {
            parts.push(text);
        }
    }
    Ok(normalize_document_text(&parts.join("\n\n")))
}

fn extract_pptx_text_from_bytes(bytes: &[u8]) -> Result<Option<String>, String> {
    let reader = Cursor::new(bytes.to_vec());
    let mut archive =
        ZipArchive::new(reader).map_err(|err| format!("打开 pptx 压缩包失败: {err}"))?;
    let mut slides = Vec::new();
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|err| format!("读取 pptx 条目失败: {err}"))?;
        let name = file.name().to_string();
        if !(name.starts_with("ppt/slides/slide") && name.ends_with(".xml")) {
            continue;
        }
        let mut xml = String::new();
        file.read_to_string(&mut xml)
            .map_err(|err| format!("读取 pptx XML 失败({name}): {err}"))?;
        if let Some(text) = extract_text_from_xmlish_markup(&xml) {
            slides.push(text);
        }
    }
    Ok(normalize_document_text(&slides.join("\n\n")))
}

fn extract_spreadsheet_text_from_bytes(bytes: &[u8]) -> Result<Option<String>, String> {
    let cursor = Cursor::new(bytes.to_vec());
    let mut workbook =
        open_workbook_auto_from_rs(cursor).map_err(|err| format!("打开电子表格失败: {err}"))?;
    let sheet_names = workbook.sheet_names().to_vec();
    let mut sections = Vec::new();

    for sheet_name in sheet_names {
        let range = match workbook.worksheet_range(&sheet_name) {
            Ok(range) => range,
            Err(err) => {
                debug!(sheet = %sheet_name, %err, "Skip unreadable worksheet");
                continue;
            }
        };
        let mut rows = Vec::new();
        for row in range.rows() {
            let cells = row.iter().map(|cell| cell.to_string()).collect::<Vec<_>>();
            if cells.iter().all(|cell| cell.trim().is_empty()) {
                continue;
            }
            rows.push(cells.join("\t"));
        }
        if rows.is_empty() {
            continue;
        }
        sections.push(format!("## 工作表: {sheet_name}\n{}", rows.join("\n")));
    }

    Ok(normalize_document_text(&sections.join("\n\n")))
}

fn extract_first_spreadsheet_rows_from_bytes(
    bytes: &[u8],
) -> Result<Option<(String, Vec<Vec<String>>)>, String> {
    let cursor = Cursor::new(bytes.to_vec());
    let mut workbook =
        open_workbook_auto_from_rs(cursor).map_err(|err| format!("打开电子表格失败: {err}"))?;
    for sheet_name in workbook.sheet_names().to_vec() {
        let range = match workbook.worksheet_range(&sheet_name) {
            Ok(range) => range,
            Err(err) => {
                debug!(sheet = %sheet_name, %err, "Skip unreadable worksheet for csv export");
                continue;
            }
        };
        let rows = range
            .rows()
            .map(|row| row.iter().map(|cell| cell.to_string()).collect::<Vec<_>>())
            .filter(|row| row.iter().any(|cell| !cell.trim().is_empty()))
            .collect::<Vec<_>>();
        if !rows.is_empty() {
            return Ok(Some((sheet_name, rows)));
        }
    }
    Ok(None)
}

fn document_type_is_spreadsheet(document_type: &str) -> bool {
    matches!(document_type, "xlsx" | "xls" | "xlsb" | "csv")
}

fn escape_csv_cell(value: &str) -> String {
    let escaped = value.replace('"', "\"\"");
    if escaped.contains([',', '"', '\n', '\r']) {
        format!("\"{escaped}\"")
    } else {
        escaped
    }
}

fn render_rows_as_csv(rows: &[Vec<String>]) -> String {
    rows.iter()
        .map(|row| {
            row.iter()
                .map(|cell| escape_csv_cell(cell.trim()))
                .collect::<Vec<_>>()
                .join(",")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn push_ascii_sequence(output: &mut Vec<String>, buffer: &mut String, min_len: usize) {
    let candidate = buffer.trim().to_string();
    if candidate.chars().count() >= min_len {
        output.push(candidate);
    }
    buffer.clear();
}

fn extract_ascii_text_sequences(bytes: &[u8], min_len: usize) -> Vec<String> {
    let mut output = Vec::new();
    let mut buffer = String::new();
    for byte in bytes {
        let ch = *byte as char;
        let printable = ch.is_ascii_alphanumeric()
            || matches!(
                ch,
                ' ' | '\n'
                    | '\r'
                    | '\t'
                    | ','
                    | '.'
                    | ':'
                    | ';'
                    | '-'
                    | '_'
                    | '/'
                    | '\\'
                    | '('
                    | ')'
                    | '['
                    | ']'
                    | '{'
                    | '}'
                    | '#'
                    | '@'
                    | '&'
                    | '%'
                    | '+'
                    | '='
                    | '!'
                    | '?'
            );
        if printable {
            buffer.push(ch);
        } else {
            push_ascii_sequence(&mut output, &mut buffer, min_len);
        }
    }
    push_ascii_sequence(&mut output, &mut buffer, min_len);
    output
}

fn extract_utf16le_text_sequences(bytes: &[u8], min_len: usize) -> Vec<String> {
    let mut output = Vec::new();
    let mut current = Vec::<u16>::new();
    for chunk in bytes.chunks_exact(2) {
        let unit = u16::from_le_bytes([chunk[0], chunk[1]]);
        let printable = matches!(unit, 0x0009 | 0x000A | 0x000D | 0x0020..=0x007E)
            || (0x4E00..=0x9FFF).contains(&unit);
        if printable {
            current.push(unit);
        } else if current.len() >= min_len {
            let text = String::from_utf16_lossy(&current);
            output.push(text);
            current.clear();
        } else {
            current.clear();
        }
    }
    if current.len() >= min_len {
        output.push(String::from_utf16_lossy(&current));
    }
    output
}

fn extract_legacy_word_text_from_bytes(bytes: &[u8]) -> Option<String> {
    let mut chunks = Vec::new();
    chunks.extend(extract_utf16le_text_sequences(bytes, 4));
    chunks.extend(extract_ascii_text_sequences(bytes, 6));
    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for chunk in chunks {
        let normalized = chunk
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string();
        if normalized.is_empty() {
            continue;
        }
        if seen.insert(normalized.clone()) {
            deduped.push(normalized);
        }
    }
    normalize_document_text(&deduped.join("\n"))
}

fn extract_document_text_from_bytes(
    document_type: &str,
    bytes: &[u8],
) -> Result<Option<String>, String> {
    match document_type {
        "pdf" => pdf_extract::extract_text_from_mem(bytes)
            .map_err(|err| format!("PDF 文本提取失败: {err}"))
            .and_then(|text| Ok(normalize_document_text(&text))),
        "docx" => extract_docx_text_from_bytes(bytes),
        "doc" => Ok(extract_legacy_word_text_from_bytes(bytes)),
        "xlsx" | "xls" | "xlsb" => extract_spreadsheet_text_from_bytes(bytes),
        "pptx" => extract_pptx_text_from_bytes(bytes),
        _ => Ok(None),
    }
}

#[derive(Debug, Clone)]
struct ResolvedDocumentSource {
    source_uri: String,
    preview_uri: String,
    download_uri: String,
    file_name: String,
    document_type: String,
    extracted_text: Option<String>,
}

async fn resolve_document_source(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
) -> Result<ResolvedDocumentSource, String> {
    let raw_source = pick_document_source_field(
        input,
        &[
            "path",
            "file",
            "document",
            "source_path",
            "file_path",
            "url",
            "document_url",
            "source_url",
            "preview_url",
        ],
    )
    .ok_or("Missing document source. Provide path/file/document/url.")?;
    let explicit_type = pick_document_source_field(input, &["document_type", "file_type", "type"])
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    let lowered = raw_source.to_ascii_lowercase();
    if lowered.starts_with("data:") {
        let file_name = pick_document_source_field(input, &["file_name", "fileName"])
            .map(str::to_string)
            .unwrap_or_else(|| "inline-document.txt".to_string());
        let document_type = if explicit_type.is_empty() {
            let inferred = infer_document_type_from_name(&file_name);
            if inferred == "unknown" {
                infer_document_type_from_name(raw_source)
            } else {
                inferred
            }
        } else {
            explicit_type
        };
        let extracted_text = if document_type_is_text_like(&document_type) {
            decode_data_url_text(raw_source).ok()
        } else if document_type_supports_runtime_extraction(&document_type) {
            decode_data_url_bytes(raw_source).ok().and_then(|bytes| {
                extract_document_text_from_bytes(&document_type, &bytes)
                    .ok()
                    .flatten()
            })
        } else {
            None
        };
        return Ok(ResolvedDocumentSource {
            source_uri: raw_source.to_string(),
            preview_uri: raw_source.to_string(),
            download_uri: raw_source.to_string(),
            file_name,
            document_type,
            extracted_text,
        });
    }

    let is_remote_like = lowered.starts_with("http://")
        || lowered.starts_with("https://")
        || raw_source.starts_with("/api/uploads/")
        || raw_source.starts_with("/api/management/");

    if is_remote_like {
        let file_name = pick_document_source_field(input, &["file_name", "fileName"])
            .map(str::to_string)
            .or_else(|| infer_file_name_from_uri(raw_source))
            .unwrap_or_else(|| "document".to_string());
        let document_type = if explicit_type.is_empty() {
            let inferred = infer_document_type_from_name(&file_name);
            if inferred == "unknown" {
                infer_document_type_from_name(raw_source)
            } else {
                inferred
            }
        } else {
            explicit_type
        };
        let fetch_target = if raw_source.starts_with("/api/") {
            webot_service_base_url().map(|base| format!("{base}{raw_source}"))
        } else {
            Some(raw_source.to_string())
        };
        let extracted_text = if document_type_is_text_like(&document_type)
            || document_type_supports_runtime_extraction(&document_type)
        {
            if let Some(url) = fetch_target {
                let response = reqwest::Client::new()
                    .get(url)
                    .timeout(std::time::Duration::from_secs(45))
                    .send()
                    .await
                    .map_err(|err| format!("读取文档地址失败: {err}"))?;
                if response.status().is_success() {
                    let bytes = response
                        .bytes()
                        .await
                        .map_err(|err| format!("读取文档字节失败: {err}"))?;
                    if document_type_is_text_like(&document_type) {
                        Some(String::from_utf8_lossy(&bytes).to_string())
                    } else {
                        extract_document_text_from_bytes(&document_type, &bytes).unwrap_or(None)
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };
        return Ok(ResolvedDocumentSource {
            source_uri: raw_source.to_string(),
            preview_uri: raw_source.to_string(),
            download_uri: raw_source.to_string(),
            file_name,
            document_type,
            extracted_text,
        });
    }

    let normalized_local = raw_source
        .strip_prefix("file://")
        .unwrap_or(raw_source)
        .trim();
    let path = resolve_file_path(normalized_local, workspace_root)?;
    let source_uri = path.to_string_lossy().to_string();
    let file_name = pick_document_source_field(input, &["file_name", "fileName"])
        .map(str::to_string)
        .or_else(|| infer_file_name_from_uri(&source_uri))
        .unwrap_or_else(|| "document".to_string());
    let document_type = if explicit_type.is_empty() {
        let inferred = infer_document_type_from_name(&file_name);
        if inferred == "unknown" {
            infer_document_type_from_name(raw_source)
        } else {
            inferred
        }
    } else {
        explicit_type
    };
    let extracted_text = if document_type_is_text_like(&document_type) {
        Some(
            String::from_utf8_lossy(
                &tokio::fs::read(&path)
                    .await
                    .map_err(|err| format!("读取文本文档失败({source_uri}): {err}"))?,
            )
            .to_string(),
        )
    } else if document_type_supports_runtime_extraction(&document_type) {
        let bytes = tokio::fs::read(&path)
            .await
            .map_err(|err| format!("读取文档字节失败({source_uri}): {err}"))?;
        extract_document_text_from_bytes(&document_type, &bytes)?
    } else {
        None
    };
    Ok(ResolvedDocumentSource {
        source_uri: source_uri.clone(),
        preview_uri: source_uri.clone(),
        download_uri: source_uri,
        file_name,
        document_type,
        extracted_text,
    })
}

async fn read_document_source_bytes(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
) -> Result<Vec<u8>, String> {
    let raw_source = pick_document_source_field(
        input,
        &[
            "path",
            "file",
            "document",
            "source_path",
            "file_path",
            "url",
            "document_url",
            "source_url",
            "preview_url",
        ],
    )
    .ok_or("Missing document source. Provide path/file/document/url.")?;
    let lowered = raw_source.to_ascii_lowercase();
    if lowered.starts_with("data:") {
        return decode_data_url_bytes(raw_source);
    }
    if lowered.starts_with("http://")
        || lowered.starts_with("https://")
        || raw_source.starts_with("/api/uploads/")
        || raw_source.starts_with("/api/management/")
    {
        let url = if raw_source.starts_with("/api/") {
            webot_service_base_url()
                .map(|base| format!("{base}{raw_source}"))
                .ok_or_else(|| "读取 API 文档资源失败：缺少 WEBOT_SERVICE_BASE_URL".to_string())?
        } else {
            raw_source.to_string()
        };
        let response = reqwest::Client::new()
            .get(url)
            .timeout(std::time::Duration::from_secs(45))
            .send()
            .await
            .map_err(|err| format!("读取文档地址失败: {err}"))?;
        if !response.status().is_success() {
            return Err(format!("读取文档地址失败: HTTP {}", response.status()));
        }
        return response
            .bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|err| format!("读取文档字节失败: {err}"));
    }
    let normalized_local = raw_source
        .strip_prefix("file://")
        .unwrap_or(raw_source)
        .trim();
    let path = resolve_file_path(normalized_local, workspace_root)?;
    tokio::fs::read(&path)
        .await
        .map_err(|err| format!("读取文档字节失败({}): {err}", path.display()))
}

fn build_document_presentable_result(
    tool_name: &str,
    title: &str,
    source: &ResolvedDocumentSource,
    summary_text: Option<&str>,
    compare_diff: Option<serde_json::Value>,
    conversion_outputs: Vec<serde_json::Value>,
    extra: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut result = serde_json::Map::new();
    result.insert(
        "kind".to_string(),
        serde_json::Value::String("document_result".to_string()),
    );
    result.insert(
        "title".to_string(),
        serde_json::Value::String(title.to_string()),
    );
    result.insert(
        "document_type".to_string(),
        serde_json::Value::String(source.document_type.clone()),
    );
    result.insert(
        "documentType".to_string(),
        serde_json::Value::String(source.document_type.clone()),
    );
    let source_asset = build_document_asset_ref(
        &source.source_uri,
        &source.document_type,
        Some(&source.file_name),
        Some(serde_json::json!({
            "tool": tool_name,
            "role": "source",
        })),
    );
    let preview_asset = build_document_asset_ref(
        &source.preview_uri,
        &source.document_type,
        Some(&source.file_name),
        Some(serde_json::json!({
            "tool": tool_name,
            "role": "preview",
        })),
    );
    let download_asset = build_document_asset_ref(
        &source.download_uri,
        &source.document_type,
        Some(&source.file_name),
        Some(serde_json::json!({
            "tool": tool_name,
            "role": "download",
        })),
    );
    result.insert("source_asset".to_string(), source_asset.clone());
    result.insert("sourceAsset".to_string(), source_asset);
    result.insert("preview_asset".to_string(), preview_asset.clone());
    result.insert("previewAsset".to_string(), preview_asset);
    result.insert("download_asset".to_string(), download_asset.clone());
    result.insert("downloadAsset".to_string(), download_asset);
    if let Some(text) = source
        .extracted_text
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        result.insert(
            "extracted_text".to_string(),
            serde_json::Value::String(text.to_string()),
        );
        result.insert(
            "extractedText".to_string(),
            serde_json::Value::String(text.to_string()),
        );
    }
    if let Some(summary) = summary_text
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        result.insert(
            "summary".to_string(),
            serde_json::Value::String(summary.to_string()),
        );
        result.insert(
            "summaryText".to_string(),
            serde_json::Value::String(summary.to_string()),
        );
    }
    if let Some(diff) = compare_diff {
        result.insert("compare_diff".to_string(), diff.clone());
        result.insert("compareDiff".to_string(), diff);
    }
    if !conversion_outputs.is_empty() {
        result.insert(
            "conversion_outputs".to_string(),
            serde_json::Value::Array(conversion_outputs.clone()),
        );
        result.insert(
            "conversionOutputs".to_string(),
            serde_json::Value::Array(conversion_outputs),
        );
    }
    if let Some(extra_value) = extra {
        result.insert("metadata".to_string(), extra_value);
    }
    serde_json::Value::Object(result)
}

fn build_document_unavailable_response(
    tool_name: &str,
    code: &str,
    message: &str,
    attempts: &[String],
) -> serde_json::Value {
    let detail = if attempts.is_empty() {
        message.to_string()
    } else {
        format!("{message}。已尝试路径：{}", attempts.join(" -> "))
    };
    serde_json::json!({
        "ok": false,
        "tool": tool_name,
        "unavailable": true,
        "code": code,
        "message": detail,
        "presentable_result": {
            "kind": "error_result",
            "title": "文档能力暂不可用",
            "code": code,
            "message": detail,
        },
    })
}

fn build_document_compare_diff(
    left_label: &str,
    left_text: &str,
    right_label: &str,
    right_text: &str,
) -> serde_json::Value {
    let left_lines = left_text.lines().collect::<Vec<_>>();
    let right_lines = right_text.lines().collect::<Vec<_>>();
    let max_len = left_lines.len().max(right_lines.len());
    let mut changes = Vec::new();
    for index in 0..max_len {
        let left = left_lines.get(index).copied().unwrap_or_default();
        let right = right_lines.get(index).copied().unwrap_or_default();
        if left == right {
            continue;
        }
        let change = if left.is_empty() {
            "added"
        } else if right.is_empty() {
            "removed"
        } else {
            "modified"
        };
        changes.push(serde_json::json!({
            "line": index + 1,
            "change": change,
            "left": left,
            "right": right,
        }));
        if changes.len() >= 20 {
            break;
        }
    }
    serde_json::json!({
        "leftLabel": left_label,
        "rightLabel": right_label,
        "changeCount": changes.len(),
        "changes": changes,
    })
}

fn chunk_document_text(text: &str, chunk_size: usize, overlap: usize) -> Vec<serde_json::Value> {
    if text.trim().is_empty() || chunk_size == 0 {
        return Vec::new();
    }
    let chars = text.chars().collect::<Vec<_>>();
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let end = (start + chunk_size).min(chars.len());
        let content = chars[start..end].iter().collect::<String>();
        chunks.push(serde_json::json!({
            "index": chunks.len(),
            "start": start,
            "end": end,
            "text": content,
        }));
        if end >= chars.len() {
            break;
        }
        let next_start = end.saturating_sub(overlap.min(chunk_size.saturating_sub(1)));
        if next_start <= start {
            break;
        }
        start = next_start;
    }
    chunks
}

async fn ensure_document_runtime_allowed(
    tool_name: &str,
    capability_key: &str,
    caller_agent_id: Option<&str>,
) -> Result<DocumentRuntimeAllowance, String> {
    let snapshot = fetch_capability_registry_snapshot(caller_agent_id, capability_key, "generic")
        .await
        .unwrap_or_default();
    let runtime_enabled = registry_has_enabled_provider_type(
        Some(&snapshot),
        capability_key,
        "generic",
        "runtime_native",
    );
    let generic_enabled = registry_has_enabled_provider_type(
        Some(&snapshot),
        capability_key,
        "generic",
        "generic_provider",
    );
    let model_enabled = registry_has_enabled_provider_type(
        Some(&snapshot),
        capability_key,
        "generic",
        "model_fallback",
    );
    if runtime_enabled || generic_enabled || model_enabled || snapshot.providers.is_empty() {
        return Ok(DocumentRuntimeAllowance::Allowed(snapshot));
    }
    let response = build_document_unavailable_response(
        tool_name,
        "document_unavailable",
        "文档能力已被 registry 禁用，当前未找到可用的 provider。",
        &[
            "runtime_native(disabled_by_registry)".to_string(),
            "generic_provider(disabled_by_registry)".to_string(),
            "model_fallback(disabled_by_registry)".to_string(),
        ],
    );
    serde_json::to_string_pretty(&response)
        .map(DocumentRuntimeAllowance::Unavailable)
        .map_err(|err| format!("Serialize error: {err}"))
}

enum DocumentRuntimeAllowance {
    Allowed(RuntimeCapabilityRegistrySnapshot),
    Unavailable(String),
}

fn document_selector_provider_candidates(
    tool_name: &str,
    document_type: &str,
) -> Vec<&'static str> {
    match tool_name {
        "document_parse" | "document_extract" => match document_type {
            "pdf" => vec![
                "runtime_native:pdf_reader",
                "runtime_native:ocr_service",
                "runtime_native:office_preview_adapter",
            ],
            "doc" | "docx" => vec![
                "component_skill:document_parser_component",
                "runtime_native:office_preview_adapter",
                "generic_provider:document_convert_service",
            ],
            "xls" | "xlsx" | "csv" => vec![
                "component_skill:document_parser_component",
                "runtime_native:office_preview_adapter",
                "generic_provider:document_convert_service",
            ],
            "ppt" | "pptx" => vec![
                "component_skill:document_parser_component",
                "runtime_native:office_preview_adapter",
                "generic_provider:document_convert_service",
            ],
            "txt" | "md" | "json" => vec![
                "component_skill:document_parser_component",
                "model_fallback:native_doc_reasoner",
            ],
            _ => vec![
                "runtime_native:ocr_service",
                "runtime_native:office_preview_adapter",
            ],
        },
        "document_preview" => match document_type {
            "pdf" => vec![
                "runtime_native:pdf_reader",
                "runtime_native:office_preview_adapter",
            ],
            "doc" | "docx" | "xls" | "xlsx" | "csv" | "ppt" | "pptx" => {
                vec!["runtime_native:office_preview_adapter"]
            }
            "txt" | "md" | "json" => vec!["runtime_native:office_preview_adapter"],
            _ => vec!["runtime_native:office_preview_adapter"],
        },
        "document_summarize" | "document_compare" => vec![
            "generic_provider:document_convert_service",
            "model_fallback:native_doc_reasoner",
            "runtime_native:pdf_reader",
        ],
        "document_chunk" => vec![
            "component_skill:document_parser_component",
            "runtime_native:pdf_reader",
            "generic_provider:document_convert_service",
        ],
        "document_convert" => vec![
            "runtime_native:office_preview_adapter",
            "generic_provider:document_convert_service",
            "model_fallback:native_doc_reasoner",
        ],
        _ => vec![
            "component_skill:document_parser_component",
            "runtime_native:office_preview_adapter",
            "generic_provider:document_convert_service",
        ],
    }
}

fn document_provider_type(provider_id: &str) -> &'static str {
    match provider_id
        .split_once(':')
        .map(|(prefix, _)| prefix)
        .unwrap_or_default()
    {
        "runtime_native" => "runtime_native",
        "component_skill" => "component_skill",
        "generic_provider" => "generic_provider",
        "model_fallback" => "model_fallback",
        _ => "unknown",
    }
}

fn select_document_runtime_provider(
    snapshot: &RuntimeCapabilityRegistrySnapshot,
    tool_name: &str,
    document_type: &str,
) -> Option<(String, String)> {
    let (capability_key, capability_scope) = capability_descriptor_for_tool(tool_name)?;
    for provider_id in document_selector_provider_candidates(tool_name, document_type) {
        if !registry_provider_is_enabled(snapshot, provider_id, capability_key, capability_scope) {
            continue;
        }
        let provider_type = document_provider_type(provider_id).to_string();
        if provider_type == "component_skill" {
            continue;
        }
        return Some((provider_id.to_string(), provider_type));
    }
    None
}

async fn dispatch_document_skill_if_available(
    tool_name: &str,
    input: &serde_json::Value,
    skill_registry: Option<&SkillRegistry>,
    allowed_skills: Option<&[String]>,
    caller_agent_id: Option<&str>,
    attempts: &mut Vec<String>,
) -> Option<Result<String, String>> {
    let registry = skill_registry?;
    let candidate_names = build_skill_dispatch_tool_candidates(tool_name, input);
    if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
        registry,
        tool_name,
        input,
        allowed_skills,
        true,
        caller_agent_id,
    )
    .await
    {
        return Some(result);
    }
    attempts.push(format!("component_skill({})", candidate_names.join("/")));

    if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
        registry,
        tool_name,
        input,
        allowed_skills,
        false,
        caller_agent_id,
    )
    .await
    {
        return Some(result);
    }
    attempts.push(format!("generic_provider({})", candidate_names.join("/")));
    None
}

async fn tool_document_parse(
    tool_name: &str,
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    caller_agent_id: Option<&str>,
    skill_registry: Option<&SkillRegistry>,
    allowed_skills: Option<&[String]>,
) -> Result<String, String> {
    let mut attempts = Vec::new();
    if let Some(result) = dispatch_document_skill_if_available(
        tool_name,
        input,
        skill_registry,
        allowed_skills,
        caller_agent_id,
        &mut attempts,
    )
    .await
    {
        match result {
            Ok(value) => return Ok(value),
            Err(err) => attempts.push(format!("document_skill_error({err})")),
        }
    }
    let capability_key = if tool_name == "document_extract" {
        "extract.document"
    } else {
        "parse.document"
    };
    let registry_snapshot =
        match ensure_document_runtime_allowed(tool_name, capability_key, caller_agent_id).await? {
            DocumentRuntimeAllowance::Allowed(snapshot) => snapshot,
            DocumentRuntimeAllowance::Unavailable(response) => return Ok(response),
        };
    let source = resolve_document_source(input, workspace_root).await?;
    let (provider_id, provider_type) =
        select_document_runtime_provider(&registry_snapshot, tool_name, &source.document_type)
            .unwrap_or_else(|| {
                (
                    "runtime_native:document_runtime".to_string(),
                    "runtime_native".to_string(),
                )
            });
    let summary = source
        .extracted_text
        .as_deref()
        .map(|text| summarize_document_text(text, 280))
        .filter(|value| !value.is_empty())
        .or_else(|| {
            Some(format!(
                "{} 已接入统一文档能力链路，可预览与下载；当前运行时暂未解析正文。",
                source.file_name
            ))
        });
    let title = if tool_name == "document_extract" {
        "文档提取结果"
    } else {
        "文档解析结果"
    };
    let presentable_result = build_document_presentable_result(
        tool_name,
        title,
        &source,
        summary.as_deref(),
        None,
        Vec::new(),
        Some(serde_json::json!({
            "operation": tool_name,
            "supportsPreview": true,
            "supportsExtractedText": source.extracted_text.is_some(),
        })),
    );
    let response = serde_json::json!({
        "ok": true,
        "tool": tool_name,
        "title": title,
        "file_name": source.file_name,
        "document_type": source.document_type,
        "source_uri": source.source_uri,
        "preview_url": source.preview_uri,
        "download_url": source.download_uri,
        "extracted_text": source.extracted_text,
        "summary": summary,
        "presentable_result": presentable_result,
    });
    let response = enrich_presentable_payload(
        response,
        tool_name,
        &provider_type,
        &provider_id,
        &provider_type,
        tool_name,
        presentable_result,
    );
    serde_json::to_string_pretty(&response).map_err(|err| format!("Serialize error: {err}"))
}

async fn tool_document_preview(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    caller_agent_id: Option<&str>,
    skill_registry: Option<&SkillRegistry>,
    allowed_skills: Option<&[String]>,
) -> Result<String, String> {
    let mut attempts = Vec::new();
    if let Some(result) = dispatch_document_skill_if_available(
        "document_preview",
        input,
        skill_registry,
        allowed_skills,
        caller_agent_id,
        &mut attempts,
    )
    .await
    {
        match result {
            Ok(value) => return Ok(value),
            Err(err) => attempts.push(format!("document_skill_error({err})")),
        }
    }
    let registry_snapshot = match ensure_document_runtime_allowed(
        "document_preview",
        "preview.document",
        caller_agent_id,
    )
    .await?
    {
        DocumentRuntimeAllowance::Allowed(snapshot) => snapshot,
        DocumentRuntimeAllowance::Unavailable(response) => return Ok(response),
    };
    let source = resolve_document_source(input, workspace_root).await?;
    let (provider_id, provider_type) = select_document_runtime_provider(
        &registry_snapshot,
        "document_preview",
        &source.document_type,
    )
    .unwrap_or_else(|| {
        (
            "runtime_native:office_preview_adapter".to_string(),
            "runtime_native".to_string(),
        )
    });
    let summary = source
        .extracted_text
        .as_deref()
        .map(|text| summarize_document_text(text, 200))
        .filter(|value| !value.is_empty())
        .or_else(|| Some(format!("{} 可在桌面端预览。", source.file_name)));
    let presentable_result = build_document_presentable_result(
        "document_preview",
        "文档预览结果",
        &source,
        summary.as_deref(),
        None,
        Vec::new(),
        Some(serde_json::json!({
            "operation": "document_preview",
            "previewOnly": true,
        })),
    );
    let response = serde_json::json!({
        "ok": true,
        "tool": "document_preview",
        "file_name": source.file_name,
        "document_type": source.document_type,
        "source_uri": source.source_uri,
        "preview_url": source.preview_uri,
        "download_url": source.download_uri,
        "summary": summary,
        "presentable_result": presentable_result,
    });
    let response = enrich_presentable_payload(
        response,
        "document_preview",
        &provider_type,
        &provider_id,
        &provider_type,
        "document_preview",
        presentable_result,
    );
    serde_json::to_string_pretty(&response).map_err(|err| format!("Serialize error: {err}"))
}

async fn tool_document_summarize(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    caller_agent_id: Option<&str>,
    skill_registry: Option<&SkillRegistry>,
    allowed_skills: Option<&[String]>,
) -> Result<String, String> {
    let mut attempts = Vec::new();
    if let Some(result) = dispatch_document_skill_if_available(
        "document_summarize",
        input,
        skill_registry,
        allowed_skills,
        caller_agent_id,
        &mut attempts,
    )
    .await
    {
        match result {
            Ok(value) => return Ok(value),
            Err(err) => attempts.push(format!("document_skill_error({err})")),
        }
    }
    let registry_snapshot = match ensure_document_runtime_allowed(
        "document_summarize",
        "summarize.document",
        caller_agent_id,
    )
    .await?
    {
        DocumentRuntimeAllowance::Allowed(snapshot) => snapshot,
        DocumentRuntimeAllowance::Unavailable(response) => return Ok(response),
    };
    let source = resolve_document_source(input, workspace_root).await?;
    let (provider_id, provider_type) = select_document_runtime_provider(
        &registry_snapshot,
        "document_summarize",
        &source.document_type,
    )
    .unwrap_or_else(|| {
        (
            "model_fallback:native_doc_reasoner".to_string(),
            "model_fallback".to_string(),
        )
    });
    let Some(extracted_text) = source
        .extracted_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        let response = build_document_unavailable_response(
            "document_summarize",
            "document_unavailable",
            "当前 document_summarize 仅支持 txt/md/json/csv 等可直接读取文本的文档，二进制文档请先接入组件 skill 或全局文档 provider。",
            &[attempts, vec![provider_id.clone(), provider_type.clone()]].concat(),
        );
        return serde_json::to_string_pretty(&response)
            .map_err(|err| format!("Serialize error: {err}"));
    };
    let summary = summarize_document_text(extracted_text, 360);
    let presentable_result = build_document_presentable_result(
        "document_summarize",
        "文档摘要结果",
        &source,
        Some(&summary),
        None,
        Vec::new(),
        Some(serde_json::json!({
            "operation": "document_summarize",
        })),
    );
    let response = serde_json::json!({
        "ok": true,
        "tool": "document_summarize",
        "file_name": source.file_name,
        "document_type": source.document_type,
        "summary": summary,
        "source_uri": source.source_uri,
        "preview_url": source.preview_uri,
        "download_url": source.download_uri,
        "extracted_text": extracted_text,
        "presentable_result": presentable_result,
    });
    let response = enrich_presentable_payload(
        response,
        "document_summarize",
        &provider_type,
        &provider_id,
        &provider_type,
        "document_summarize",
        presentable_result,
    );
    serde_json::to_string_pretty(&response).map_err(|err| format!("Serialize error: {err}"))
}

async fn tool_document_compare(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    caller_agent_id: Option<&str>,
    skill_registry: Option<&SkillRegistry>,
    allowed_skills: Option<&[String]>,
) -> Result<String, String> {
    let mut attempts = Vec::new();
    if let Some(result) = dispatch_document_skill_if_available(
        "document_compare",
        input,
        skill_registry,
        allowed_skills,
        caller_agent_id,
        &mut attempts,
    )
    .await
    {
        match result {
            Ok(value) => return Ok(value),
            Err(err) => attempts.push(format!("document_skill_error({err})")),
        }
    }
    let registry_snapshot = match ensure_document_runtime_allowed(
        "document_compare",
        "compare.document",
        caller_agent_id,
    )
    .await?
    {
        DocumentRuntimeAllowance::Allowed(snapshot) => snapshot,
        DocumentRuntimeAllowance::Unavailable(response) => return Ok(response),
    };
    let left_input = serde_json::json!({
        "path": pick_document_source_field(input, &["left_path"]).unwrap_or_default(),
        "file": pick_document_source_field(input, &["left_file"]).unwrap_or_default(),
        "url": pick_document_source_field(input, &["left_url"]).unwrap_or_default(),
        "document": pick_document_source_field(input, &["left_document"]).unwrap_or_default(),
        "file_name": pick_document_source_field(input, &["left_file_name"]).unwrap_or_default(),
        "document_type": pick_document_source_field(input, &["left_type"]).unwrap_or_default(),
    });
    let right_input = serde_json::json!({
        "path": pick_document_source_field(input, &["right_path"]).unwrap_or_default(),
        "file": pick_document_source_field(input, &["right_file"]).unwrap_or_default(),
        "url": pick_document_source_field(input, &["right_url"]).unwrap_or_default(),
        "document": pick_document_source_field(input, &["right_document"]).unwrap_or_default(),
        "file_name": pick_document_source_field(input, &["right_file_name"]).unwrap_or_default(),
        "document_type": pick_document_source_field(input, &["right_type"]).unwrap_or_default(),
    });
    let left = resolve_document_source(&left_input, workspace_root).await?;
    let right = resolve_document_source(&right_input, workspace_root).await?;
    let preferred_document_type = if left.document_type != "unknown" {
        left.document_type.clone()
    } else {
        right.document_type.clone()
    };
    let (provider_id, provider_type) = select_document_runtime_provider(
        &registry_snapshot,
        "document_compare",
        &preferred_document_type,
    )
    .unwrap_or_else(|| {
        (
            "model_fallback:native_doc_reasoner".to_string(),
            "model_fallback".to_string(),
        )
    });
    let Some(left_text) = left
        .extracted_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        let response = build_document_unavailable_response(
            "document_compare",
            "document_unavailable",
            "document_compare 当前仅支持可直接读取文本的左侧文档。",
            &[
                attempts.clone(),
                vec![provider_id.clone(), provider_type.clone()],
            ]
            .concat(),
        );
        return serde_json::to_string_pretty(&response)
            .map_err(|err| format!("Serialize error: {err}"));
    };
    let Some(right_text) = right
        .extracted_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        let response = build_document_unavailable_response(
            "document_compare",
            "document_unavailable",
            "document_compare 当前仅支持可直接读取文本的右侧文档。",
            &[attempts, vec![provider_id.clone(), provider_type.clone()]].concat(),
        );
        return serde_json::to_string_pretty(&response)
            .map_err(|err| format!("Serialize error: {err}"));
    };
    let diff =
        build_document_compare_diff(&left.file_name, left_text, &right.file_name, right_text);
    let summary = format!(
        "{} 与 {} 的文本对比已完成，共发现 {} 处差异。",
        left.file_name,
        right.file_name,
        diff["changeCount"].as_u64().unwrap_or(0)
    );
    let compare_source = ResolvedDocumentSource {
        source_uri: left.source_uri.clone(),
        preview_uri: left.preview_uri.clone(),
        download_uri: left.download_uri.clone(),
        file_name: format!("{} vs {}", left.file_name, right.file_name),
        document_type: "compare".to_string(),
        extracted_text: Some(format!(
            "## 左侧文档\n{left_text}\n\n## 右侧文档\n{right_text}"
        )),
    };
    let presentable_result = build_document_presentable_result(
        "document_compare",
        "文档对比结果",
        &compare_source,
        Some(&summary),
        Some(diff.clone()),
        Vec::new(),
        Some(serde_json::json!({
            "operation": "document_compare",
            "leftSource": left.source_uri,
            "rightSource": right.source_uri,
        })),
    );
    let response = serde_json::json!({
        "ok": true,
        "tool": "document_compare",
        "summary": summary,
        "compare_diff": diff,
        "presentable_result": presentable_result,
    });
    let response = enrich_presentable_payload(
        response,
        "document_compare",
        &provider_type,
        &provider_id,
        &provider_type,
        "document_compare",
        presentable_result,
    );
    serde_json::to_string_pretty(&response).map_err(|err| format!("Serialize error: {err}"))
}

async fn tool_document_chunk(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    caller_agent_id: Option<&str>,
    skill_registry: Option<&SkillRegistry>,
    allowed_skills: Option<&[String]>,
) -> Result<String, String> {
    let mut attempts = Vec::new();
    if let Some(result) = dispatch_document_skill_if_available(
        "document_chunk",
        input,
        skill_registry,
        allowed_skills,
        caller_agent_id,
        &mut attempts,
    )
    .await
    {
        match result {
            Ok(value) => return Ok(value),
            Err(err) => attempts.push(format!("document_skill_error({err})")),
        }
    }
    let registry_snapshot =
        match ensure_document_runtime_allowed("document_chunk", "chunk.document", caller_agent_id)
            .await?
        {
            DocumentRuntimeAllowance::Allowed(snapshot) => snapshot,
            DocumentRuntimeAllowance::Unavailable(response) => return Ok(response),
        };
    let source = resolve_document_source(input, workspace_root).await?;
    let (provider_id, provider_type) = select_document_runtime_provider(
        &registry_snapshot,
        "document_chunk",
        &source.document_type,
    )
    .unwrap_or_else(|| {
        (
            "component_skill:document_parser_component".to_string(),
            "component_skill".to_string(),
        )
    });
    let Some(extracted_text) = source
        .extracted_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        let response = build_document_unavailable_response(
            "document_chunk",
            "document_unavailable",
            "document_chunk 当前仅支持 txt/md/json/csv 等可直接读取文本的文档。",
            &[attempts, vec![provider_id.clone(), provider_type.clone()]].concat(),
        );
        return serde_json::to_string_pretty(&response)
            .map_err(|err| format!("Serialize error: {err}"));
    };
    let chunk_size = input["chunk_size"].as_u64().unwrap_or(1200) as usize;
    let overlap = input["overlap"].as_u64().unwrap_or(120) as usize;
    let chunks = chunk_document_text(extracted_text, chunk_size, overlap);
    let summary = format!(
        "{} 已切分为 {} 个文本片段。",
        source.file_name,
        chunks.len()
    );
    let presentable_result = build_document_presentable_result(
        "document_chunk",
        "文档切片结果",
        &source,
        Some(&summary),
        None,
        Vec::new(),
        Some(serde_json::json!({
            "operation": "document_chunk",
            "chunkCount": chunks.len(),
            "chunkSize": chunk_size,
            "overlap": overlap,
        })),
    );
    let response = serde_json::json!({
        "ok": true,
        "tool": "document_chunk",
        "summary": summary,
        "chunks": chunks,
        "presentable_result": presentable_result,
    });
    let response = enrich_presentable_payload(
        response,
        "document_chunk",
        &provider_type,
        &provider_id,
        &provider_type,
        "document_chunk",
        presentable_result,
    );
    serde_json::to_string_pretty(&response).map_err(|err| format!("Serialize error: {err}"))
}

async fn tool_document_convert(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    caller_agent_id: Option<&str>,
    skill_registry: Option<&SkillRegistry>,
    allowed_skills: Option<&[String]>,
) -> Result<String, String> {
    let mut attempts = Vec::new();
    if let Some(result) = dispatch_document_skill_if_available(
        "document_convert",
        input,
        skill_registry,
        allowed_skills,
        caller_agent_id,
        &mut attempts,
    )
    .await
    {
        match result {
            Ok(value) => return Ok(value),
            Err(err) => attempts.push(format!("document_skill_error({err})")),
        }
    }
    let registry_snapshot = match ensure_document_runtime_allowed(
        "document_convert",
        "convert.document",
        caller_agent_id,
    )
    .await?
    {
        DocumentRuntimeAllowance::Allowed(snapshot) => snapshot,
        DocumentRuntimeAllowance::Unavailable(response) => return Ok(response),
    };
    let source = resolve_document_source(input, workspace_root).await?;
    let (provider_id, provider_type) = select_document_runtime_provider(
        &registry_snapshot,
        "document_convert",
        &source.document_type,
    )
    .unwrap_or_else(|| {
        (
            "generic_provider:document_convert_service".to_string(),
            "generic_provider".to_string(),
        )
    });
    let target_format = pick_document_source_field(input, &["target_format", "format"])
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .ok_or("document_convert requires target_format")?;
    let Some(extracted_text) = source
        .extracted_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        let response = build_document_unavailable_response(
            "document_convert",
            "document_unavailable",
            "当前 document_convert 仅支持可直接读取文本的文档转换，请接入组件 skill 或全局转换 provider 处理二进制文档。",
            &[attempts.clone(), vec![provider_id.clone(), provider_type.clone()]].concat(),
        );
        return serde_json::to_string_pretty(&response)
            .map_err(|err| format!("Serialize error: {err}"));
    };
    if !matches!(target_format.as_str(), "txt" | "md" | "json" | "csv") {
        let response = build_document_unavailable_response(
            "document_convert",
            "document_convert_unsupported",
            &format!(
                "当前 runtime document_convert 仅支持转为 txt/md/json/csv，收到: {target_format}"
            ),
            &[attempts, vec![provider_id.clone(), provider_type.clone()]].concat(),
        );
        return serde_json::to_string_pretty(&response)
            .map_err(|err| format!("Serialize error: {err}"));
    }
    let workspace = workspace_root.ok_or("document_convert requires workspace_root")?;
    let output_dir = workspace.join("output");
    tokio::fs::create_dir_all(&output_dir)
        .await
        .map_err(|err| format!("创建文档转换输出目录失败: {err}"))?;
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let base_name = source
        .file_name
        .split('.')
        .next()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("document");
    let output_name = format!("{base_name}_{timestamp}.{target_format}");
    let output_path = output_dir.join(&output_name);
    let output_text = match target_format.as_str() {
        "json" => serde_json::to_string_pretty(&serde_json::json!({
            "sourceFile": source.file_name,
            "documentType": source.document_type,
            "text": extracted_text,
        }))
        .map_err(|err| format!("生成 JSON 转换结果失败: {err}"))?,
        "md" => format!("# {}\n\n{}", source.file_name, extracted_text),
        "csv" if source.document_type == "csv" => extracted_text.to_string(),
        "csv" if document_type_is_spreadsheet(&source.document_type) => {
            let bytes = read_document_source_bytes(input, workspace_root).await?;
            let Some((_sheet_name, rows)) = extract_first_spreadsheet_rows_from_bytes(&bytes)?
            else {
                let response = build_document_unavailable_response(
                    "document_convert",
                    "document_unavailable",
                    "当前 spreadsheet 文档未读取到可导出的工作表数据。",
                    &[
                        attempts.clone(),
                        vec![provider_id.clone(), provider_type.clone()],
                    ]
                    .concat(),
                );
                return serde_json::to_string_pretty(&response)
                    .map_err(|err| format!("Serialize error: {err}"));
            };
            render_rows_as_csv(&rows)
        }
        "csv" => {
            let response = build_document_unavailable_response(
                "document_convert",
                "document_convert_unsupported",
                "当前 runtime 仅支持将 spreadsheet/csv 文档转换为 csv。",
                &[
                    attempts.clone(),
                    vec![provider_id.clone(), provider_type.clone()],
                ]
                .concat(),
            );
            return serde_json::to_string_pretty(&response)
                .map_err(|err| format!("Serialize error: {err}"));
        }
        _ => extracted_text.to_string(),
    };
    tokio::fs::write(&output_path, output_text)
        .await
        .map_err(|err| format!("写入文档转换结果失败: {err}"))?;
    let output_uri = output_path.to_string_lossy().to_string();
    let conversion_outputs = vec![serde_json::json!({
        "format": target_format,
        "asset": build_document_asset_ref(
            &output_uri,
            &target_format,
            Some(&output_name),
            Some(serde_json::json!({
                "tool": "document_convert",
                "sourceFile": source.file_name,
            })),
        ),
    })];
    let summary = format!("{} 已转换为 {}。", source.file_name, target_format);
    let presentable_result = build_document_presentable_result(
        "document_convert",
        "文档转换结果",
        &source,
        Some(&summary),
        None,
        conversion_outputs.clone(),
        Some(serde_json::json!({
            "operation": "document_convert",
            "targetFormat": target_format,
        })),
    );
    let response = serde_json::json!({
        "ok": true,
        "tool": "document_convert",
        "summary": summary,
        "output_file": output_uri,
        "conversion_outputs": conversion_outputs,
        "presentable_result": presentable_result,
    });
    let response = enrich_presentable_payload(
        response,
        "document_convert",
        &provider_type,
        &provider_id,
        &provider_type,
        "document_convert",
        presentable_result,
    );
    serde_json::to_string_pretty(&response).map_err(|err| format!("Serialize error: {err}"))
}

async fn tool_video_generate(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
    skill_registry: Option<&SkillRegistry>,
    allowed_skills: Option<&[String]>,
) -> Result<String, String> {
    let prompt = input["prompt"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("Missing 'prompt' parameter")?;
    let self_expression_request = prompt_hits_self_expression(prompt);
    let has_explicit_media_source = has_any_non_empty_field(
        input,
        &[
            "image_path",
            "image_url",
            "image_base64",
            "source_image",
            "reference_image",
            "video_path",
            "video_url",
            "video_base64",
            "source_video",
        ],
    );
    let source_mode = resolve_video_generate_source_mode(
        input,
        has_explicit_media_source,
        self_expression_request,
    );
    let self_default_source_request = source_mode == "self_default";
    let mut owned_input = input.clone();
    let mut auto_injected_video_source = false;
    let mut auto_injected_video_source_url: Option<String> = None;
    if let Some(object) = owned_input.as_object_mut() {
        object.insert(
            "source_mode".to_string(),
            serde_json::Value::String(source_mode.to_string()),
        );
    }
    if self_default_source_request {
        let purpose = pick_string_field(input, "purpose").unwrap_or("self_video");
        if let Some(object) = owned_input.as_object_mut() {
            object.insert(
                "webot_self_expression_request".to_string(),
                serde_json::Value::Bool(true),
            );
            inject_video_asset_metadata(
                object,
                caller_agent_id,
                "self",
                "video_generate",
                Some(purpose),
                pick_string_field(input, "save_target").or(Some("agent_profile_meta")),
                pick_string_field(input, "meta_label").or(Some(purpose)),
            );
        }
    }
    if !has_explicit_media_source && self_default_source_request {
        if let (Some(kh), Some(agent_id)) = (kernel, caller_agent_id) {
            let self_ctx = kh.get_agent_self_context(agent_id)?;
            let source_url = resolve_self_video_source_url(&self_ctx).ok_or_else(|| {
                "当前没有可用的默认视频源图。请先为该智能体设置默认立绘、默认视频源图或自我照片。".to_string()
            })?;
            if let Some(object) = owned_input.as_object_mut() {
                object.insert(
                    "image_url".to_string(),
                    serde_json::Value::String(source_url.clone()),
                );
                object.insert(
                    "webot_self_expression_request".to_string(),
                    serde_json::Value::Bool(true),
                );
                object.insert(
                    "webot_auto_injected_video_source".to_string(),
                    serde_json::Value::Bool(true),
                );
                object.insert(
                    "webot_auto_injected_video_source_url".to_string(),
                    serde_json::Value::String(source_url.clone()),
                );
            }
            auto_injected_video_source = true;
            auto_injected_video_source_url = Some(source_url);
        }
    } else if self_expression_request {
        if let Some(object) = owned_input.as_object_mut() {
            object.insert(
                "webot_self_expression_request".to_string(),
                serde_json::Value::Bool(true),
            );
        }
    }
    let input = &owned_input;
    let selector_candidates = build_skill_dispatch_tool_candidates("video_generate", input);
    let mut attempts = Vec::new();
    let registry_snapshot =
        fetch_capability_registry_snapshot(caller_agent_id, "generate.video", "generic").await;
    let generic_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "generate.video",
        "generic",
        "generic_provider",
    );
    let model_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "generate.video",
        "generic",
        "model_fallback",
    );

    if let Some(registry) = skill_registry {
        if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
            registry,
            "video_generate",
            input,
            allowed_skills,
            true,
            caller_agent_id,
        )
        .await
        {
            match result {
                Ok(value) => {
                    return normalize_component_skill_media_output(&value, "video_generate")
                }
                Err(err) => attempts.push(format!("component_skill_error({err})")),
            }
        }
        attempts.push(format!(
            "component_skill({})",
            selector_candidates.join("/")
        ));
        if generic_enabled {
            if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
                registry,
                "video_generate",
                input,
                allowed_skills,
                false,
                caller_agent_id,
            )
            .await
            {
                match result {
                    Ok(value) => {
                        return normalize_component_skill_media_output(&value, "video_generate")
                    }
                    Err(err) => attempts.push(format!("generic_skill_error({err})")),
                }
            }
            attempts.push(format!(
                "generic_provider({})",
                selector_candidates.join("/")
            ));
        } else {
            attempts.push("generic_provider(disabled_by_registry)".to_string());
        }
    }

    if model_enabled {
        if let (Some(kernel), Some(agent_id)) = (kernel, caller_agent_id) {
            match kernel
                .generate_video_with_agent_model(agent_id, input)
                .await
            {
                Ok(result_payload) => {
                    let presentable_result =
                        build_video_presentable_result("video_generate", &result_payload, input);
                    let response = serde_json::json!({
                        "ok": true,
                        "tool": "video_generate",
                        "prompt": prompt,
                        "route": "model_fallback",
                        "provider_id": "native_video_model",
                        "provider_type": "model_fallback",
                        "provider_tool": "video_generate",
                        "mime_type": result_payload["mime_type"].as_str().unwrap_or("video/mp4"),
                        "model": result_payload["model"].as_str().unwrap_or_default(),
                        "summary": result_payload["summary"].as_str().unwrap_or_default(),
                        "source_mode": source_mode,
                        "self_expression": self_expression_request,
                        "auto_injected_video_source": auto_injected_video_source,
                        "auto_injected_video_source_url": auto_injected_video_source_url,
                        "save_target": pick_string_field(input, "save_target")
                            .or_else(|| pick_string_field(input, "asset_save_target"))
                            .or(if self_default_source_request {
                                Some("agent_profile_meta")
                            } else {
                                None
                            }),
                        "meta_label": pick_string_field(input, "meta_label")
                            .or_else(|| pick_string_field(input, "asset_meta_label"))
                            .or(if self_default_source_request {
                                pick_string_field(input, "purpose").or(Some("self_video"))
                            } else {
                                None
                            }),
                        "attempts": attempts.clone(),
                        "video_urls": result_payload["video_urls"].clone(),
                        "poster_urls": result_payload["poster_urls"].clone(),
                        "saved_to": result_payload["saved_to"].clone(),
                        "presentable_result": presentable_result,
                    });
                    return serde_json::to_string_pretty(&response)
                        .map_err(|e| format!("Serialize error: {e}"));
                }
                Err(err) => attempts.push(format!("model_fallback({err})")),
            }
        } else {
            attempts.push("model_fallback(unavailable)".to_string());
        }
    } else {
        attempts.push("model_fallback(disabled_by_registry)".to_string());
    }

    let response = build_video_unavailable_response("video_generate", input, &attempts);
    serde_json::to_string_pretty(&response).map_err(|e| format!("Serialize error: {e}"))
}

async fn tool_video_edit(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
    skill_registry: Option<&SkillRegistry>,
    allowed_skills: Option<&[String]>,
) -> Result<String, String> {
    input["prompt"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("Missing 'prompt' parameter")?;
    let has_video_source = has_any_non_empty_field(
        input,
        &[
            "video_path",
            "video_url",
            "video_base64",
            "source_video",
            "video",
        ],
    );
    let has_image_source = has_any_non_empty_field(
        input,
        &[
            "image_path",
            "image_url",
            "image_base64",
            "image",
            "source_image",
            "reference_image",
        ],
    );
    if !has_video_source && !has_image_source {
        return Err("video_edit requires a source video or source image. Provide one of video_path/video_url/video_base64/source_video or image_path/image_url/image_base64/source_image.".to_string());
    }
    let selector_candidates = build_skill_dispatch_tool_candidates("video_edit", input);
    let mut attempts = Vec::new();
    let registry_snapshot =
        fetch_capability_registry_snapshot(caller_agent_id, "edit.video", "generic").await;
    let generic_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "edit.video",
        "generic",
        "generic_provider",
    );
    let model_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "edit.video",
        "generic",
        "model_fallback",
    );

    if let Some(registry) = skill_registry {
        if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
            registry,
            "video_edit",
            input,
            allowed_skills,
            true,
            caller_agent_id,
        )
        .await
        {
            match result {
                Ok(value) => return normalize_component_skill_media_output(&value, "video_edit"),
                Err(err) => attempts.push(format!("component_skill_error({err})")),
            }
        }
        attempts.push(format!(
            "component_skill({})",
            selector_candidates.join("/")
        ));
        if generic_enabled {
            if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
                registry,
                "video_edit",
                input,
                allowed_skills,
                false,
                caller_agent_id,
            )
            .await
            {
                match result {
                    Ok(value) => {
                        return normalize_component_skill_media_output(&value, "video_edit")
                    }
                    Err(err) => attempts.push(format!("generic_skill_error({err})")),
                }
            }
            attempts.push(format!(
                "generic_provider({})",
                selector_candidates.join("/")
            ));
        } else {
            attempts.push("generic_provider(disabled_by_registry)".to_string());
        }
    }

    if model_enabled {
        if let (Some(kernel), Some(agent_id)) = (kernel, caller_agent_id) {
            match kernel.edit_video_with_agent_model(agent_id, input).await {
                Ok(result_payload) => {
                    let presentable_result =
                        build_video_presentable_result("video_edit", &result_payload, input);
                    let response = serde_json::json!({
                        "ok": true,
                        "tool": "video_edit",
                        "route": "model_fallback",
                        "provider_id": "native_video_model",
                        "provider_type": "model_fallback",
                        "provider_tool": "video_edit",
                        "source_mode": pick_string_field(input, "source_mode")
                            .or_else(|| pick_string_field(input, "sourceMode"))
                            .unwrap_or(if has_video_source { "source_video" } else { "source_image" }),
                        "mime_type": result_payload["mime_type"].as_str().unwrap_or("video/mp4"),
                        "model": result_payload["model"].as_str().unwrap_or_default(),
                        "summary": result_payload["summary"].as_str().unwrap_or_default(),
                        "save_target": pick_string_field(input, "save_target")
                            .or_else(|| pick_string_field(input, "asset_save_target")),
                        "meta_label": pick_string_field(input, "meta_label")
                            .or_else(|| pick_string_field(input, "asset_meta_label")),
                        "video_urls": result_payload["video_urls"].clone(),
                        "poster_urls": result_payload["poster_urls"].clone(),
                        "saved_to": result_payload["saved_to"].clone(),
                        "presentable_result": presentable_result,
                    });
                    return serde_json::to_string_pretty(&response)
                        .map_err(|e| format!("Serialize error: {e}"));
                }
                Err(err) => attempts.push(format!("model_fallback({err})")),
            }
        } else {
            attempts.push("model_fallback(unavailable)".to_string());
        }
    } else {
        attempts.push("model_fallback(disabled_by_registry)".to_string());
    }

    let response = build_video_unavailable_response("video_edit", input, &attempts);
    serde_json::to_string_pretty(&response).map_err(|e| format!("Serialize error: {e}"))
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
        "my_upgrade_review" => {
            tool_my_upgrade_review(input, workspace_root, kernel, caller_agent_id).await
        }
        "my_upgrade_apply" => {
            tool_my_upgrade_apply(input, workspace_root, kernel, caller_agent_id).await
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
            if let Some(registry) = skill_registry {
                if let Some(result) = dispatch_skill_tool(
                    registry,
                    "image_analyze",
                    input,
                    allowed_skills,
                    caller_agent_id,
                )
                .await
                {
                    match result {
                        Ok(value) => Ok(value),
                        Err(_) => {
                            tool_image_analyze(
                                input,
                                workspace_root,
                                media_engine,
                                kernel,
                                caller_agent_id,
                            )
                            .await
                        }
                    }
                } else {
                    tool_image_analyze(input, workspace_root, media_engine, kernel, caller_agent_id)
                        .await
                }
            } else {
                tool_image_analyze(input, workspace_root, media_engine, kernel, caller_agent_id)
                    .await
            }
        }

        // Media understanding tools
        "media_describe" => {
            if let Some(registry) = skill_registry {
                if let Some(result) = dispatch_skill_tool(
                    registry,
                    "media_describe",
                    input,
                    allowed_skills,
                    caller_agent_id,
                )
                .await
                {
                    match result {
                        Ok(value) => Ok(value),
                        Err(_) => {
                            tool_media_describe(
                                input,
                                workspace_root,
                                media_engine,
                                kernel,
                                caller_agent_id,
                            )
                            .await
                        }
                    }
                } else {
                    tool_media_describe(
                        input,
                        workspace_root,
                        media_engine,
                        kernel,
                        caller_agent_id,
                    )
                    .await
                }
            } else {
                tool_media_describe(input, workspace_root, media_engine, kernel, caller_agent_id)
                    .await
            }
        }
        "media_transcribe" => tool_media_transcribe(input, media_engine).await,

        // Image generation tool
        "image_generate" => {
            tool_image_generate(
                input,
                workspace_root,
                kernel,
                caller_agent_id,
                skill_registry,
                allowed_skills,
            )
            .await
        }
        "image_edit" => {
            tool_image_edit(
                input,
                workspace_root,
                kernel,
                caller_agent_id,
                skill_registry,
                allowed_skills,
            )
            .await
        }
        "video_generate" => {
            tool_video_generate(
                input,
                kernel,
                caller_agent_id,
                skill_registry,
                allowed_skills,
            )
            .await
        }
        "video_edit" => {
            tool_video_edit(
                input,
                kernel,
                caller_agent_id,
                skill_registry,
                allowed_skills,
            )
            .await
        }
        "document_parse" => {
            tool_document_parse(
                "document_parse",
                input,
                workspace_root,
                caller_agent_id,
                skill_registry,
                allowed_skills,
            )
            .await
        }
        "document_extract" => {
            tool_document_parse(
                "document_extract",
                input,
                workspace_root,
                caller_agent_id,
                skill_registry,
                allowed_skills,
            )
            .await
        }
        "document_preview" => {
            tool_document_preview(
                input,
                workspace_root,
                caller_agent_id,
                skill_registry,
                allowed_skills,
            )
            .await
        }
        "document_summarize" => {
            tool_document_summarize(
                input,
                workspace_root,
                caller_agent_id,
                skill_registry,
                allowed_skills,
            )
            .await
        }
        "document_compare" => {
            tool_document_compare(
                input,
                workspace_root,
                caller_agent_id,
                skill_registry,
                allowed_skills,
            )
            .await
        }
        "document_chunk" => {
            tool_document_chunk(
                input,
                workspace_root,
                caller_agent_id,
                skill_registry,
                allowed_skills,
            )
            .await
        }
        "document_convert" => {
            tool_document_convert(
                input,
                workspace_root,
                caller_agent_id,
                skill_registry,
                allowed_skills,
            )
            .await
        }

        // TTS/STT tools
        "text_to_speech" => {
            tool_text_to_speech(
                input,
                kernel,
                tts_engine,
                workspace_root,
                caller_agent_id,
                skill_registry,
                allowed_skills,
            )
            .await
        }
        "speech_to_text" => {
            tool_speech_to_text(
                input,
                media_engine,
                workspace_root,
                caller_agent_id,
                skill_registry,
                allowed_skills,
            )
            .await
        }

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
                    dispatch_skill_tool(registry, other, input, allowed_skills, caller_agent_id)
                        .await
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
        Ok(content) => {
            maybe_upsert_capability_job_from_tool_output(tool_name, &content, caller_agent_id)
                .await;
            ToolResult {
                tool_use_id: tool_use_id.to_string(),
                content,
                is_error: false,
            }
        }
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
            name: "my_upgrade_review".to_string(),
            description: "Create a structured self-upgrade review for the current agent only. Use this before any risky self identity/memory/system upgrade. The tool stores a review snapshot with a review_id when possible and returns review_result plus an optional confirm_result so the desktop UI can ask for explicit confirmation.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "summary": { "type": "string", "description": "Short upgrade summary in natural language." },
                    "reason": { "type": "string", "description": "Why this upgrade is being proposed." },
                    "target_scope": { "type": "string", "description": "Optional scope label such as identity, memory, appearance, prompt, or mixed." },
                    "risk_level": { "type": "string", "description": "Optional explicit risk level: low, medium, or high." },
                    "requires_confirmation": { "type": "boolean", "description": "Override whether the upgrade must be confirmed by the user before apply." },
                    "proposed_changes": {
                        "type": "array",
                        "description": "Structured proposed changes. Each item can include kind, target, summary, and payload.",
                        "items": { "type": "object" }
                    },
                    "identity_patch": { "type": "object", "description": "Optional my_identity_patch-compatible payload to apply after review." },
                    "memory_patch": { "type": "object", "description": "Optional my_memory_patch-compatible payload to apply after review." },
                    "confirmed_by_user": { "type": "boolean", "description": "Usually false during review; only set true when creating a review after the user has already explicitly approved it." }
                }
            }),
        },
        ToolDefinition {
            name: "my_upgrade_apply".to_string(),
            description: "Apply a previously reviewed self-upgrade for the current agent only. This tool never accepts a free-form high-risk patch by itself; it requires a review object or review_id, and confirmed_by_user=true when confirmation is required.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "review": { "type": "object", "description": "Full review payload returned by my_upgrade_review." },
                    "review_result": { "type": "object", "description": "Alias of review." },
                    "review_id": { "type": "string", "description": "Stored review identifier returned by my_upgrade_review." },
                    "confirmed_by_user": { "type": "boolean", "description": "Must be true when the review requires explicit confirmation." },
                    "reason": { "type": "string", "description": "Optional apply reason for audit logging." }
                }
            }),
        },
        ToolDefinition {
            name: "my_photo_edit".to_string(),
            description: "Edit an existing photo of the current agent while preserving the same identity. Use this for your own outfit change, scene change, expression change, pose tweak, or other local updates when a source self-photo already exists. This tool also supports an optional second reference image for element transfer: the self photo stays as the immutable base, and the reference image only contributes the requested clothing, prop, makeup, hairstyle, or visual element. Prefer this over generic image_edit when the task is about the agent itself. By default, self photos are stored under agent_profile/meta so the agent can manage its own media library later; set save_target='output' only when you explicitly want a temporary/default output copy.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "Describe the exact change to make to the current agent's existing self-photo while preserving the same identity. If you pass a second reference image, describe which elements should be transferred from that reference onto the current agent." },
                    "purpose": { "type": "string", "description": "Optional intent label such as self_photo, scene_variant, outfit_change, avatar_refine, or portrait_refine." },
                    "meta_label": { "type": "string", "description": "Optional personal media label stored under agent_profile/meta, such as 今日穿搭, 居家自拍, 最近视频, or 节日写真." },
                    "save_target": { "type": "string", "description": "Optional save target: 'agent_profile_meta' (default for self media) or 'output'." },
                    "image_path": { "type": "string", "description": "Optional explicit source self-photo path. If omitted, the tool will try the current avatar URL first, then portrait URL." },
                    "image_url": { "type": "string", "description": "Optional explicit source self-photo URL. If omitted, the tool will try the current avatar URL first, then portrait URL." },
                    "image_base64": { "type": "string", "description": "Optional explicit base64 source self-photo." },
                    "mime_type": { "type": "string", "description": "Required when image_base64 is provided." },
                    "reference_image": { "type": "string", "description": "Optional second reference image alias. Use this when the user supplied an external clothing/object/style image that should be merged into the current agent image while keeping the current agent as the base." },
                    "reference_image_path": { "type": "string", "description": "Optional explicit reference image path for element transfer." },
                    "reference_image_url": { "type": "string", "description": "Optional explicit reference image URL for element transfer, such as /api/uploads/... or a remote URL." },
                    "reference_image_base64": { "type": "string", "description": "Optional base64 reference image used only as a material/style/element source." },
                    "reference_mime_type": { "type": "string", "description": "Required when reference_image_base64 is provided." },
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
            description: "Create a new photo of the current agent, but always continue from the current avatar first, or the current portrait as fallback, so the same identity anchor stays locked automatically. The runtime injects this self identity anchor for you; the model does not need to pass any base source image fields. This tool also supports an optional second reference image for element fusion: the current agent remains the base identity, while the reference image only contributes the requested clothing, prop, object, makeup, or style detail. Use this for new self-photos, same-character roleplay scenes, selfies, portraits, or appearance variants of the current agent. This tool must not create a brand-new unrelated face or replace the current self identity anchor; for unrelated characters or fully new people, use the generic image_generate tool instead. By default, self photos are stored under agent_profile/meta so the agent can manage its own personal media library later; set save_target='output' only when you explicitly want the normal workspace output instead.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "Describe the new photo you want of the current agent. If you pass a second reference image, describe which elements from that reference should appear on the current agent while keeping the same face/person." },
                    "purpose": { "type": "string", "description": "Optional intent label such as self_photo, selfie, avatar_candidate, portrait_candidate, roleplay_scene, or scene_variant." },
                    "meta_label": { "type": "string", "description": "Optional personal media label stored under agent_profile/meta, such as 今日穿搭, 自拍合集, 角色扮演, or 节日写真." },
                    "save_target": { "type": "string", "description": "Optional save target: 'agent_profile_meta' (default for self media) or 'output'." },
                    "reference_image": { "type": "string", "description": "Optional second reference image alias. Use this when the user supplied an external clothing/object/style image that should be merged into the current agent's generated photo." },
                    "reference_image_path": { "type": "string", "description": "Optional explicit reference image path for element transfer." },
                    "reference_image_url": { "type": "string", "description": "Optional explicit reference image URL for element transfer, such as /api/uploads/... or a remote URL." },
                    "reference_image_base64": { "type": "string", "description": "Optional base64 reference image used only as a material/style/element source." },
                    "reference_mime_type": { "type": "string", "description": "Required when reference_image_base64 is provided." },
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
            description: "Primary tool for understanding a local, workspace, or chat-uploaded image file. Use this first when the task is to inspect what is in an image, answer questions about an image, summarize a screenshot, or extract visible details from a local image path. When local vision is enabled, the runtime will prefer the local Florence-2 + OCR stack automatically; otherwise it uses the current agent model vision path and then configured fallback vision providers. Without a prompt, returns basic file metadata and a preview for debugging.".to_string(),
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
            description: "Primary tool for understanding local/workspace/chat-uploaded media files. For images it uses the local Florence-2 + OCR stack first, then configured vision providers, and only then current-model vision fallback. For audio it routes to speech transcription. For videos it first tries representative-frame analysis plus optional audio understanding, then configured video understanding providers. Prefer this over browser_navigate for local media files.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to the image/audio/video file (relative to workspace or absolute local file path)" },
                    "prompt": { "type": "string", "description": "Optional prompt to guide understanding, such as extracting all visible text, describing the scene, or focusing on specific details." }
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
            description: "Edit an existing image using a text instruction. Use this when the user wants to keep the same person/identity, the same base picture, or the same overall scene while making targeted changes such as outfit, hairstyle, makeup, pose adjustment, background adjustment, prop changes, retouching, or other fine-to-medium edits. This tool also supports an optional second reference image: the first image is always the base image to preserve and modify, while the reference image only contributes the requested elements that should be merged into the base. This is the correct generic tool when consistency matters for a non-self image workflow. Default rule: only change the user-requested parts and keep everything else unchanged, including identity, style, composition, lighting, camera angle, and unmentioned details. The base source image is required: pass exactly one of `image_path`, `image_url`, `image_base64`, or `source_image` (+ `mime_type` for base64). Prefer passing `image_path` for a file inside the current agent workspace/workdir; the runtime will resolve and upload that local file automatically before editing. Resolution priority: component skill provider first, then configured generic image service editor (ComfyUI built-in Qwen-edit workflow when configured), then the current agent model if it supports image editing. Edited images default to the workspace output/ directory, unless save_target='agent_profile_meta' is explicitly used for self-owned personal media.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "description": "Modify an existing image while keeping the first image as the base. You may optionally provide a second reference image whose elements should be transferred into the base image.",
                "properties": {
                    "prompt": { "type": "string", "description": "Text instruction describing how to modify the existing base image while preserving it as the main image. If a second reference image is provided, explicitly describe which elements should be transferred from the reference image into the base image. Typical use cases: outfit change, clothing transfer, prop merge, background refinement, pose tweak, face cleanup, detail retouching, or other fine-to-medium edits." },
                    "negative_prompt": { "type": "string", "description": "Optional negative prompt for providers that support it" },
                    "image_path": { "type": "string", "description": "Preferred base image path for a real relative or absolute file path inside the agent workspace/local filesystem. This first image is always the one to preserve and modify." },
                    "image_url": { "type": "string", "description": "Base image URL such as /api/uploads/... or an http/https image URL. Prefer this for chat-history images and uploaded images shown in the UI. This first image is always the one to preserve and modify." },
                    "source_image": { "type": "string", "description": "Alias of the base image path or URL. Use this if the calling style already names the main image as source_image." },
                    "image_base64": { "type": "string", "description": "Optional base64-encoded base image data." },
                    "mime_type": { "type": "string", "description": "Required when image_base64 is provided, e.g. image/png" },
                    "reference_image": { "type": "string", "description": "Optional second reference image alias. Use this when the user supplied another image whose clothing/object/style elements should be merged into the base image while keeping the first image as the main subject." },
                    "reference_image_path": { "type": "string", "description": "Optional explicit second reference image path. Only the requested elements from this image should transfer into the base image." },
                    "reference_image_url": { "type": "string", "description": "Optional explicit second reference image URL, such as /api/uploads/... or an http/https image URL." },
                    "reference_image_base64": { "type": "string", "description": "Optional base64-encoded second reference image data." },
                    "reference_mime_type": { "type": "string", "description": "Required when reference_image_base64 is provided, e.g. image/png." },
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
        ToolDefinition {
            name: "video_generate".to_string(),
            description: "Generate a video through the unified runtime video pipeline. Resolution order is fixed: first try injected component skills that expose video abilities (for example image2video/text2video), then try globally configured generic video providers, and finally fall back to the current agent model if it supports native video generation. Use one of three stable modes: `source_mode='self_default'` for a video of the current agent itself, `source_mode='image_to_video'` when you already have a source image, or `source_mode='text_to_video'` for prompt-only generation. For the current agent's own self video, prefer `source_mode='self_default'` and pass only the prompt; do not pass image/video source fields, because the runtime can automatically inject the current default video source, portrait, or self photo. Generated videos default to the workspace output/ directory, unless save_target='agent_profile_meta' is explicitly or implicitly used for the current agent's own personal media. Successful results must flow into standardized job_result -> media_result(video) rendering instead of ad-hoc UI prompt rules.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "Text instruction for the desired video. Required." },
                    "source_mode": { "type": "string", "description": "Optional routing hint: 'self_default', 'image_to_video', or 'text_to_video'. Use 'self_default' for a video of the current agent itself without manually passing source media." },
                    "negative_prompt": { "type": "string", "description": "Optional negative prompt when the provider supports it." },
                    "image_path": { "type": "string", "description": "Optional local image path when the task is image-to-video. Prefer this for workspace files." },
                    "image_url": { "type": "string", "description": "Optional image URL or /api/uploads/... URL when the task is image-to-video." },
                    "image_base64": { "type": "string", "description": "Optional base64 image content when the task is image-to-video." },
                    "source_image": { "type": "string", "description": "Alias of image_url/image_path for image-to-video providers that conceptually name the field as source_image." },
                    "reference_image": { "type": "string", "description": "Alias of image_url/image_path when the provider expects a reference image field." },
                    "mime_type": { "type": "string", "description": "Required when image_base64 is provided, e.g. image/png." },
                    "duration_seconds": { "type": "integer", "description": "Optional target video duration in seconds." },
                    "width": { "type": "integer", "description": "Optional target width." },
                    "height": { "type": "integer", "description": "Optional target height." },
                    "fps": { "type": "integer", "description": "Optional target frames per second." },
                    "count": { "type": "integer", "description": "Optional number of videos to generate. Default 1." },
                    "save_target": { "type": "string", "description": "Optional save target: 'output' (default for normal videos) or 'agent_profile_meta' (default for current-agent self video). Only use agent_profile_meta when the video is explicitly the current agent's own personal media." },
                    "meta_label": { "type": "string", "description": "Optional personal media label used when save_target='agent_profile_meta', such as 今日自拍视频, 打招呼视频, 最近视频, or 舞蹈片段." }
                },
                "required": ["prompt"]
            }),
        },
        ToolDefinition {
            name: "video_edit".to_string(),
            description: "Edit or transform an existing video result while keeping a source asset as the base. Resolution order is fixed: component skills first, then generic configured video providers, then current-model native capability as the last fallback. Provide a source video or a source image when the edit path is source-conditioned. Use `source_mode='source_video'` when modifying an existing video, or `source_mode='source_image'` when generating a new video from a source image plus edit instructions. Edited videos default to the workspace output/ directory, unless save_target='agent_profile_meta' is explicitly used for the current agent's own personal media.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "Text instruction describing how to modify the existing source video or source image into a target video." },
                    "source_mode": { "type": "string", "description": "Optional routing hint: 'source_video' or 'source_image'. Use 'source_video' when editing an existing video, and 'source_image' when turning a source image into a video with edit-style instructions." },
                    "video_path": { "type": "string", "description": "Optional local source video path." },
                    "video_url": { "type": "string", "description": "Optional source video URL or /api/uploads/... URL." },
                    "video_base64": { "type": "string", "description": "Optional base64 source video content." },
                    "source_video": { "type": "string", "description": "Alias of video_url/video_path for providers that conceptually name the field as source_video." },
                    "image_path": { "type": "string", "description": "Optional local source image path for image-conditioned video edit/generation." },
                    "image_url": { "type": "string", "description": "Optional source image URL when the edit is image-conditioned." },
                    "image_base64": { "type": "string", "description": "Optional base64 source image content." },
                    "source_image": { "type": "string", "description": "Alias of image_url/image_path for providers that conceptually name the field as source_image." },
                    "mime_type": { "type": "string", "description": "Required when video_base64 or image_base64 is provided." },
                    "duration_seconds": { "type": "integer", "description": "Optional target duration in seconds." },
                    "width": { "type": "integer", "description": "Optional target width." },
                    "height": { "type": "integer", "description": "Optional target height." },
                    "fps": { "type": "integer", "description": "Optional target frames per second." },
                    "save_target": { "type": "string", "description": "Optional save target: 'output' (default) or 'agent_profile_meta'. Only use agent_profile_meta when the edited video is explicitly the current agent's own personal media." },
                    "meta_label": { "type": "string", "description": "Optional personal media label used only when save_target='agent_profile_meta', such as 最近视频 or 角色短片." }
                },
                "required": ["prompt"]
            }),
        },
        ToolDefinition {
            name: "document_parse".to_string(),
            description: "Parse a document into the unified document_result pipeline. Resolution order is component skills first, then runtime/native/global providers, then structured unavailable fallback. Supports local files, /api/uploads URLs, /api/management URLs, and remote URLs.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Workspace or absolute file path." },
                    "file": { "type": "string", "description": "Alias of path." },
                    "document": { "type": "string", "description": "Alias of path/url." },
                    "url": { "type": "string", "description": "Remote URL or /api/uploads/... URL." },
                    "file_name": { "type": "string", "description": "Optional file name override." },
                    "document_type": { "type": "string", "description": "Optional explicit document type such as pdf/docx/xlsx/pptx/txt/md/json/csv." }
                }
            }),
        },
        ToolDefinition {
            name: "document_extract".to_string(),
            description: "Extract text and structural metadata from a document. Uses the same routing order as document_parse and returns standardized document_result output.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "file": { "type": "string" },
                    "document": { "type": "string" },
                    "url": { "type": "string" },
                    "file_name": { "type": "string" },
                    "document_type": { "type": "string" }
                }
            }),
        },
        ToolDefinition {
            name: "document_summarize".to_string(),
            description: "Summarize a document through the unified document routing layer. Component skills can override it; runtime provides a lightweight text-document fallback.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "file": { "type": "string" },
                    "document": { "type": "string" },
                    "url": { "type": "string" },
                    "file_name": { "type": "string" },
                    "document_type": { "type": "string" }
                }
            }),
        },
        ToolDefinition {
            name: "document_convert".to_string(),
            description: "Convert a document to another format. Component skills/global providers are preferred; runtime provides a lightweight text-document conversion fallback for txt/md/json.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "file": { "type": "string" },
                    "document": { "type": "string" },
                    "url": { "type": "string" },
                    "file_name": { "type": "string" },
                    "document_type": { "type": "string" },
                    "target_format": { "type": "string", "description": "Target format, currently txt/md/json in runtime fallback." }
                },
                "required": ["target_format"]
            }),
        },
        ToolDefinition {
            name: "document_compare".to_string(),
            description: "Compare two documents and return a standardized compare diff inside document_result. Component skills/global providers are preferred; runtime fallback currently supports directly readable text documents.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "left_path": { "type": "string" },
                    "left_file": { "type": "string" },
                    "left_document": { "type": "string" },
                    "left_url": { "type": "string" },
                    "left_file_name": { "type": "string" },
                    "left_type": { "type": "string" },
                    "right_path": { "type": "string" },
                    "right_file": { "type": "string" },
                    "right_document": { "type": "string" },
                    "right_url": { "type": "string" },
                    "right_file_name": { "type": "string" },
                    "right_type": { "type": "string" }
                }
            }),
        },
        ToolDefinition {
            name: "document_preview".to_string(),
            description: "Prepare a document preview through the unified document_result pipeline. Desktop renderers can map the result to OfficePreviewCard or MarkdownPreviewCard, while other channels can degrade to links and summary text.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "file": { "type": "string" },
                    "document": { "type": "string" },
                    "url": { "type": "string" },
                    "file_name": { "type": "string" },
                    "document_type": { "type": "string" }
                }
            }),
        },
        ToolDefinition {
            name: "document_chunk".to_string(),
            description: "Chunk a text-like document into segments through the unified document capability layer. Component skills/global providers are preferred; runtime fallback supports txt/md/json/csv.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "file": { "type": "string" },
                    "document": { "type": "string" },
                    "url": { "type": "string" },
                    "file_name": { "type": "string" },
                    "document_type": { "type": "string" },
                    "chunk_size": { "type": "integer", "description": "Chunk size in characters. Default 1200." },
                    "overlap": { "type": "integer", "description": "Chunk overlap in characters. Default 120." }
                }
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

#[derive(Debug, Default, Clone)]
struct ResolvedToolImageSource {
    image_path: String,
    image_url: String,
    image_base64: String,
    mime_type: String,
}

impl ResolvedToolImageSource {
    fn is_empty(&self) -> bool {
        self.image_path.trim().is_empty()
            && self.image_url.trim().is_empty()
            && self.image_base64.trim().is_empty()
    }

    fn insert_into(
        &self,
        target: &mut serde_json::Map<String, serde_json::Value>,
        prefix: Option<&str>,
    ) {
        let key = |name: &str| match prefix {
            Some(prefix) => format!("{prefix}_{name}"),
            None => name.to_string(),
        };
        if !self.image_path.trim().is_empty() {
            target.insert(
                key("image_path"),
                serde_json::Value::String(self.image_path.clone()),
            );
        }
        if !self.image_url.trim().is_empty() {
            target.insert(
                key("image_url"),
                serde_json::Value::String(self.image_url.clone()),
            );
        }
        if !self.image_base64.trim().is_empty() {
            target.insert(
                key("image_base64"),
                serde_json::Value::String(self.image_base64.clone()),
            );
        }
        if !self.mime_type.trim().is_empty() {
            let mime_key = if prefix == Some("reference") {
                "reference_mime_type".to_string()
            } else {
                key("mime_type")
            };
            target.insert(mime_key, serde_json::Value::String(self.mime_type.clone()));
        }
    }
}

fn pick_first_string_field<'a>(input: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|key| pick_string_field(input, key))
}

fn resolve_tool_image_source(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    path_keys: &[&str],
    url_keys: &[&str],
    base64_keys: &[&str],
    mime_keys: &[&str],
    alias_keys: &[&str],
    slot_label: &str,
    required: bool,
) -> Result<ResolvedToolImageSource, String> {
    let mut raw_path = pick_first_string_field(input, path_keys)
        .unwrap_or_default()
        .trim()
        .to_string();
    let mut image_url = pick_first_string_field(input, url_keys)
        .unwrap_or_default()
        .trim()
        .to_string();
    let image_base64 = pick_first_string_field(input, base64_keys)
        .unwrap_or_default()
        .trim()
        .to_string();
    let mime_type = pick_first_string_field(input, mime_keys)
        .unwrap_or_default()
        .trim()
        .to_string();

    if raw_path.is_empty() && image_url.is_empty() {
        if let Some(alias) = pick_first_string_field(input, alias_keys) {
            if should_treat_image_ref_as_url(alias) {
                image_url = alias.trim().to_string();
            } else {
                raw_path = alias.trim().to_string();
            }
        }
    }

    let mut resolved_image_path = None;
    if !raw_path.trim().is_empty() {
        if should_treat_image_ref_as_url(&raw_path) {
            if image_url.trim().is_empty() {
                image_url = raw_path.trim().to_string();
            }
            if let Some(file_id) = extract_local_upload_id(&raw_path) {
                resolved_image_path =
                    recover_saved_upload_path_from_workspace(file_id, workspace_root)
                        .map(|path| path.to_string_lossy().to_string());
            }
        } else {
            resolved_image_path = Some(
                resolve_media_path(&raw_path, workspace_root)?
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }

    if resolved_image_path.is_none() && !image_url.trim().is_empty() {
        if let Some(file_id) = extract_local_upload_id(&image_url) {
            resolved_image_path = recover_saved_upload_path_from_workspace(file_id, workspace_root)
                .map(|path| path.to_string_lossy().to_string());
        }
    }

    let has_path = resolved_image_path
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let has_url = !image_url.trim().is_empty();
    let has_base64 = !image_base64.trim().is_empty();
    let source_count = [has_path, has_url, has_base64]
        .into_iter()
        .filter(|value| *value)
        .count();

    if source_count == 0 {
        if required {
            return Err(format!(
                "{slot_label} requires exactly one source image. Provide one of image_path/image_url/image_base64{}.",
                if alias_keys.is_empty() {
                    "".to_string()
                } else {
                    format!(" or {}", alias_keys.join("/"))
                }
            ));
        }
        return Ok(ResolvedToolImageSource::default());
    }

    if source_count > 1 {
        return Err(format!(
            "{slot_label} only accepts one source image. Do not mix path/url/base64 inputs in the same slot."
        ));
    }

    if has_base64 && mime_type.trim().is_empty() {
        return Err(format!(
            "{slot_label} requires a MIME type when using base64 input."
        ));
    }

    Ok(ResolvedToolImageSource {
        image_path: resolved_image_path.unwrap_or_default(),
        image_url,
        image_base64,
        mime_type,
    })
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

fn self_upgrade_review_storage_key(agent_id: &str, review_id: &str) -> String {
    format!("self_upgrade_review:{agent_id}:{review_id}")
}

fn normalize_upgrade_risk_level(value: Option<&str>) -> String {
    match value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or("medium")
        .to_ascii_lowercase()
        .as_str()
    {
        "low" => "low".to_string(),
        "high" | "critical" => "high".to_string(),
        _ => "medium".to_string(),
    }
}

fn extract_upgrade_review_record(value: &serde_json::Value) -> Option<serde_json::Value> {
    let object = value.as_object()?;
    if let Some(review) = object.get("review") {
        return extract_upgrade_review_record(review).or_else(|| Some(review.clone()));
    }
    if object.contains_key("review_id") || object.contains_key("reviewId") {
        return Some(value.clone());
    }
    None
}

fn infer_upgrade_target_scope(
    explicit_scope: Option<&str>,
    identity_patch: Option<&serde_json::Value>,
    memory_patch: Option<&serde_json::Value>,
) -> String {
    if let Some(value) = explicit_scope
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        return value.to_string();
    }
    match (identity_patch.is_some(), memory_patch.is_some()) {
        (true, true) => "mixed".to_string(),
        (true, false) => "identity".to_string(),
        (false, true) => "memory".to_string(),
        (false, false) => "self".to_string(),
    }
}

fn infer_upgrade_risk_level(
    explicit_level: Option<&str>,
    identity_patch: Option<&serde_json::Value>,
    memory_patch: Option<&serde_json::Value>,
    target_scope: &str,
) -> String {
    if explicit_level.is_some() {
        return normalize_upgrade_risk_level(explicit_level);
    }
    if let Some(identity_patch) = identity_patch.and_then(serde_json::Value::as_object) {
        if identity_patch.get("system_prompt").is_some()
            || identity_patch.get("avatar_url").is_some()
            || identity_patch
                .get("files")
                .and_then(serde_json::Value::as_object)
                .is_some_and(|files| {
                    files.keys().any(|name| {
                        matches!(
                            name.as_str(),
                            "IDENTITY.md" | "SOUL.md" | "AGENTS.md" | "BOOTSTRAP.md"
                        )
                    })
                })
        {
            return "high".to_string();
        }
    }
    if memory_patch.is_some() || matches!(target_scope, "mixed" | "identity") {
        return "medium".to_string();
    }
    "low".to_string()
}

fn build_upgrade_proposed_changes(
    explicit_changes: Option<&serde_json::Value>,
    identity_patch: Option<&serde_json::Value>,
    memory_patch: Option<&serde_json::Value>,
) -> Vec<serde_json::Value> {
    let mut changes = explicit_changes
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(identity_patch) = identity_patch {
        let summary = if let Some(files) = identity_patch
            .get("files")
            .and_then(serde_json::Value::as_object)
        {
            if files.is_empty() {
                "更新自我身份字段".to_string()
            } else {
                format!(
                    "更新身份文件：{}",
                    files.keys().cloned().collect::<Vec<_>>().join("、")
                )
            }
        } else if identity_patch.get("system_prompt").is_some() {
            "更新系统提示词".to_string()
        } else if identity_patch.get("avatar_url").is_some() {
            "更新头像或外观锚点".to_string()
        } else {
            "更新自我身份配置".to_string()
        };
        changes.push(serde_json::json!({
            "kind": "identity_patch",
            "target": "self_identity",
            "summary": summary,
            "payload": identity_patch,
        }));
    }
    if let Some(memory_patch) = memory_patch {
        let memory_type = memory_patch
            .get("memory_type")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .unwrap_or("self_upgrade_note");
        changes.push(serde_json::json!({
            "kind": "memory_patch",
            "target": "self_memory",
            "summary": format!("写入自我记忆（{memory_type}）"),
            "payload": memory_patch,
        }));
    }
    changes
}

async fn append_capability_audit_log_to_webot(
    action: &str,
    provider_id: Option<&str>,
    agent_id: Option<&str>,
    capability_key: Option<&str>,
    capability_scope: Option<&str>,
    payload: &serde_json::Value,
) {
    let Some(service_base) = webot_service_base_url() else {
        return;
    };
    let body = serde_json::json!({
        "action": action,
        "provider_id": provider_id,
        "agent_id": agent_id,
        "capability_key": capability_key,
        "capability_scope": capability_scope,
        "payload": payload,
    });
    match reqwest::Client::new()
        .post(format!("{service_base}/api/management/audit/capabilities"))
        .timeout(std::time::Duration::from_secs(8))
        .json(&body)
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {}
        Ok(response) => {
            warn!(
                action = action,
                status = %response.status(),
                "Failed to append capability audit log to Webot service"
            );
        }
        Err(error) => {
            warn!(
                action = action,
                error = %error,
                "Failed to post capability audit log to Webot service"
            );
        }
    }
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

fn resolve_video_generate_source_mode(
    input: &serde_json::Value,
    has_explicit_media_source: bool,
    self_expression_request: bool,
) -> &'static str {
    let explicit = pick_string_field(input, "source_mode")
        .or_else(|| pick_string_field(input, "sourceMode"))
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    match explicit.as_str() {
        "self_default" | "self" | "agent_self" | "self_video" => "self_default",
        "image_to_video" | "image2video" | "image" => "image_to_video",
        "text_to_video" | "text2video" | "text" => "text_to_video",
        _ => {
            if self_expression_request {
                "self_default"
            } else if has_explicit_media_source {
                "image_to_video"
            } else {
                "text_to_video"
            }
        }
    }
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
    inject_media_asset_metadata(
        map,
        caller_agent_id,
        owner_scope,
        source_tool,
        "photo",
        "image",
        purpose,
        save_target,
        meta_label,
    );
}

fn inject_video_asset_metadata(
    map: &mut serde_json::Map<String, serde_json::Value>,
    caller_agent_id: Option<&str>,
    owner_scope: &str,
    source_tool: &str,
    purpose: Option<&str>,
    save_target: Option<&str>,
    meta_label: Option<&str>,
) {
    inject_media_asset_metadata(
        map,
        caller_agent_id,
        owner_scope,
        source_tool,
        "video",
        "video",
        purpose,
        save_target,
        meta_label,
    );
}

fn inject_media_asset_metadata(
    map: &mut serde_json::Map<String, serde_json::Value>,
    caller_agent_id: Option<&str>,
    owner_scope: &str,
    source_tool: &str,
    asset_family: &str,
    media_kind: &str,
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
        serde_json::Value::String(asset_family.to_string()),
    );
    map.insert(
        "media_kind".to_string(),
        serde_json::Value::String(media_kind.to_string()),
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

fn embodiment_asset_url(self_ctx: &serde_json::Value, field: &str) -> Option<String> {
    self_ctx
        .get("embodiment")
        .and_then(|value| value.get("assets"))
        .and_then(|value| value.get(field))
        .and_then(|value| value.get("url"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn embodiment_first_self_photo_url(self_ctx: &serde_json::Value) -> Option<String> {
    self_ctx
        .get("embodiment")
        .and_then(|value| value.get("assets"))
        .and_then(|value| value.get("selfPhotos"))
        .and_then(serde_json::Value::as_array)
        .and_then(|items| {
            items.iter().find_map(|item| {
                item.get("url")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string)
            })
        })
}

fn resolve_default_self_image_url(self_ctx: &serde_json::Value) -> Option<String> {
    embodiment_asset_url(self_ctx, "defaultPortrait")
        .or_else(|| embodiment_asset_url(self_ctx, "defaultAvatar"))
        .or_else(|| embodiment_first_self_photo_url(self_ctx))
        .or_else(|| {
            self_ctx
                .get("portrait_url")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .or_else(|| {
            self_ctx
                .get("avatar_url")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
}

fn resolve_self_video_source_url(self_ctx: &serde_json::Value) -> Option<String> {
    embodiment_asset_url(self_ctx, "defaultVideoSource")
        .or_else(|| embodiment_asset_url(self_ctx, "defaultPortrait"))
        .or_else(|| embodiment_first_self_photo_url(self_ctx))
        .or_else(|| {
            self_ctx
                .get("portrait_url")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .or_else(|| {
            self_ctx
                .get("avatar_url")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
}

fn prompt_hits_self_expression(prompt: &str) -> bool {
    let compact = prompt.trim();
    if compact.is_empty() {
        return false;
    }
    if [
        "用你自己",
        "按你当前形象",
        "按你现在的样子",
        "用你现在的样子",
        "用你当前照片",
        "按你当前照片",
        "沿用你当前照片里的形象",
        "沿用你当前形象",
        "用你的照片",
        "用你的立绘",
        "用你的自拍",
        "用你的形象",
        "用你的声音",
        "你自己说",
        "以你自己的身份来表达",
    ]
    .iter()
    .any(|needle| compact.contains(needle))
    {
        return true;
    }

    (compact.contains("你的视频")
        || compact.contains("一段你的视频")
        || compact.contains("你来出镜")
        || compact.contains("让你出镜"))
        && (compact.contains("生成")
            || compact.contains("做")
            || compact.contains("来一段")
            || compact.contains("拍")
            || compact.contains("跳舞")
            || compact.contains("出镜")
            || compact.contains("动起来"))
}

fn resolve_self_default_voice_binding(
    self_ctx: &serde_json::Value,
) -> (Option<String>, Option<String>) {
    let voice_object = self_ctx
        .get("embodiment")
        .and_then(|value| value.get("voice"))
        .and_then(|value| value.get("defaultVoice"));
    let speaker_profile_id = voice_object
        .and_then(|value| value.get("speakerProfileId"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            self_ctx
                .get("tts_config")
                .and_then(|value| value.get("speakerProfileId"))
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        });
    let voice = voice_object
        .and_then(|value| value.get("voice"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    (speaker_profile_id, voice)
}

fn resolve_self_identity_anchor_source(
    self_ctx: &serde_json::Value,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let mut source = serde_json::Map::new();
    if let Some(url) = resolve_default_self_image_url(self_ctx) {
        source.insert(
            "image_url".to_string(),
            serde_json::Value::String(url.to_string()),
        );
        return Ok(source);
    }
    Err(
        "No self-photo identity anchor is available. my_photo_generate can only continue from your current default portrait, avatar, or self photo. Set the current avatar/portrait first. If you want a brand-new unrelated person or roleplay character, use image_generate instead.".to_string(),
    )
}

fn resolve_self_photo_source(
    input: &serde_json::Value,
    self_ctx: &serde_json::Value,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let resolved = resolve_tool_image_source(
        input,
        None,
        &["image_path"],
        &["image_url"],
        &["image_base64"],
        &["mime_type"],
        &["source_image"],
        "my_photo_edit source",
        false,
    )?;
    if resolved.is_empty() {
        return resolve_self_identity_anchor_source(self_ctx);
    }
    let mut source = serde_json::Map::new();
    resolved.insert_into(&mut source, None);
    Ok(source)
}

fn extend_reference_image_source(
    target: &mut serde_json::Map<String, serde_json::Value>,
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    slot_label: &str,
) -> Result<(), String> {
    let resolved = resolve_tool_image_source(
        input,
        workspace_root,
        &["reference_image_path"],
        &["reference_image_url"],
        &["reference_image_base64"],
        &["reference_mime_type"],
        &["reference_image"],
        slot_label,
        false,
    )?;
    if resolved.is_empty() {
        return Ok(());
    }
    resolved.insert_into(target, Some("reference"));
    Ok(())
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

async fn tool_my_upgrade_review(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let (kh, agent_id) = require_self_tool_context(kernel, caller_agent_id)?;
    let _ = workspace_root;
    let self_ctx = kh.get_agent_self_context(agent_id)?;
    let identity_patch = input.get("identity_patch").cloned();
    let memory_patch = input.get("memory_patch").cloned();
    let proposed_changes = build_upgrade_proposed_changes(
        input.get("proposed_changes"),
        identity_patch.as_ref(),
        memory_patch.as_ref(),
    );
    let summary = pick_string_field(input, "summary")
        .or_else(|| pick_string_field(input, "reason"))
        .or_else(|| {
            if proposed_changes.is_empty() {
                None
            } else {
                Some("当前智能体需要执行一轮自我升级")
            }
        })
        .map(ToString::to_string)
        .ok_or_else(|| {
            "my_upgrade_review requires summary/reason or at least one proposed identity/memory change."
                .to_string()
        })?;
    let target_scope = infer_upgrade_target_scope(
        pick_string_field(input, "target_scope"),
        identity_patch.as_ref(),
        memory_patch.as_ref(),
    );
    let risk_level = infer_upgrade_risk_level(
        pick_string_field(input, "risk_level"),
        identity_patch.as_ref(),
        memory_patch.as_ref(),
        &target_scope,
    );
    let requires_confirmation = input
        .get("requires_confirmation")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or_else(|| risk_level != "low");
    let review_id = pick_string_field(input, "review_id")
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("upgrade-review-{}", uuid::Uuid::new_v4()));
    let review_key = self_upgrade_review_storage_key(agent_id, &review_id);
    let review_record = serde_json::json!({
        "review_id": review_id,
        "agent_id": agent_id,
        "target_scope": target_scope,
        "risk_level": risk_level,
        "summary": summary,
        "reason": pick_string_field(input, "reason"),
        "requires_confirmation": requires_confirmation,
        "proposed_changes": proposed_changes,
        "identity_patch": identity_patch,
        "memory_patch": memory_patch,
        "self_context_snapshot": self_ctx,
        "created_at": chrono::Utc::now().to_rfc3339(),
    });
    let stored = kh.memory_store(&review_key, review_record.clone()).is_ok();
    append_capability_audit_log_to_webot(
        "self_upgrade_review",
        None,
        Some(agent_id),
        Some("review.upgrade"),
        Some("self"),
        &serde_json::json!({
            "review_id": review_id,
            "review_key": review_key,
            "stored": stored,
            "risk_level": review_record.get("risk_level").cloned().unwrap_or(serde_json::Value::Null),
            "target_scope": review_record.get("target_scope").cloned().unwrap_or(serde_json::Value::Null),
        }),
    )
    .await;
    let response = serde_json::json!({
        "ok": true,
        "review_id": review_id,
        "review_key": review_key,
        "stored": stored,
        "review": review_record,
        "presentable_result": {
            "kind": "review_result",
            "title": "自我升级审查",
            "summary": summary,
            "reviewId": review_id,
            "targetScope": review_record.get("target_scope").cloned().unwrap_or(serde_json::Value::Null),
            "riskLevel": review_record.get("risk_level").cloned().unwrap_or(serde_json::Value::Null),
            "reason": pick_string_field(input, "reason"),
            "requiresConfirmation": requires_confirmation,
            "proposedChanges": review_record.get("proposed_changes").cloned().unwrap_or_else(|| serde_json::Value::Array(Vec::new())),
            "confirmAction": "confirm_self_upgrade",
            "cancelAction": "cancel_self_upgrade",
            "confirmLabel": "确认升级",
            "cancelLabel": "暂不升级",
            "payload": {
                "reviewId": review_id,
                "review": review_record,
            }
        }
    });
    serde_json::to_string_pretty(&response).map_err(|e| format!("Serialize error: {e}"))
}

async fn tool_my_upgrade_apply(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
) -> Result<String, String> {
    let (kh, agent_id) = require_self_tool_context(kernel, caller_agent_id)?;
    let review = input
        .get("review")
        .and_then(extract_upgrade_review_record)
        .or_else(|| input.get("review_result").and_then(extract_upgrade_review_record))
        .or_else(|| {
            let review_id = pick_string_field(input, "review_id")?;
            let review_key = self_upgrade_review_storage_key(agent_id, &review_id);
            kh.memory_recall(&review_key)
                .ok()
                .flatten()
                .and_then(|value| extract_upgrade_review_record(&value).or(Some(value)))
        })
        .ok_or_else(|| {
            "my_upgrade_apply requires a review object or a resolvable review_id from my_upgrade_review."
                .to_string()
        })?;
    let review_object = review
        .as_object()
        .ok_or_else(|| "upgrade review payload must be a JSON object".to_string())?;
    let review_id = review_object
        .get("review_id")
        .or_else(|| review_object.get("reviewId"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .ok_or_else(|| "upgrade review payload is missing review_id".to_string())?;
    let requires_confirmation = review_object
        .get("requires_confirmation")
        .or_else(|| review_object.get("requiresConfirmation"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true);
    let confirmed_by_user = bool_flag(input, "confirmed_by_user");
    if requires_confirmation && !confirmed_by_user {
        let confirm_response = serde_json::json!({
            "ok": false,
            "review_id": review_id,
            "requires_confirmation": true,
            "presentable_result": {
                "kind": "confirm_result",
                "title": "确认自我升级",
                "summary": review_object.get("summary").cloned().unwrap_or(serde_json::Value::String("该升级需要显式确认".to_string())),
                "description": "当前升级审查被标记为需要用户确认；确认后才允许执行 my_upgrade_apply。",
                "riskLevel": review_object.get("risk_level").or_else(|| review_object.get("riskLevel")).cloned().unwrap_or(serde_json::Value::String("medium".to_string())),
                "confirmAction": "confirm_self_upgrade",
                "cancelAction": "cancel_self_upgrade",
                "confirmLabel": "确认并应用",
                "cancelLabel": "取消升级",
                "payload": {
                    "reviewId": review_id,
                    "review": review,
                }
            }
        });
        return serde_json::to_string_pretty(&confirm_response)
            .map_err(|e| format!("Serialize error: {e}"));
    }

    let mut applied_changes = Vec::new();
    let mut identity_result = None;
    if let Some(identity_patch) = review_object
        .get("identity_patch")
        .and_then(serde_json::Value::as_object)
        .cloned()
    {
        let mut delegated = identity_patch;
        delegated.insert(
            "confirmed_by_user".to_string(),
            serde_json::Value::Bool(true),
        );
        if !delegated.contains_key("reason") {
            delegated.insert(
                "reason".to_string(),
                serde_json::Value::String(
                    pick_string_field(input, "reason")
                        .map(ToString::to_string)
                        .unwrap_or_else(|| format!("apply review {}", review_id)),
                ),
            );
        }
        let result = tool_my_identity_patch(
            &serde_json::Value::Object(delegated),
            workspace_root,
            kernel,
            caller_agent_id,
        )
        .await?;
        identity_result = Some(
            serde_json::from_str::<serde_json::Value>(&result)
                .unwrap_or_else(|_| serde_json::Value::String(result.clone())),
        );
        applied_changes.push("已应用身份与文件更新".to_string());
    }

    let mut memory_result = None;
    if let Some(memory_patch) = review_object
        .get("memory_patch")
        .and_then(serde_json::Value::as_object)
        .cloned()
    {
        let mut delegated = memory_patch;
        if !delegated.contains_key("reason") {
            delegated.insert(
                "reason".to_string(),
                serde_json::Value::String(
                    pick_string_field(input, "reason")
                        .map(ToString::to_string)
                        .unwrap_or_else(|| format!("apply review {}", review_id)),
                ),
            );
        }
        let result = tool_my_memory_patch(
            &serde_json::Value::Object(delegated),
            workspace_root,
            kernel,
            caller_agent_id,
        )
        .await?;
        memory_result = Some(
            serde_json::from_str::<serde_json::Value>(&result)
                .unwrap_or_else(|_| serde_json::Value::String(result.clone())),
        );
        applied_changes.push("已写入自我记忆补丁".to_string());
    }

    if applied_changes.is_empty() {
        return Err(
            "The reviewed upgrade does not contain identity_patch or memory_patch payloads to apply."
                .to_string(),
        );
    }

    append_capability_audit_log_to_webot(
        "self_upgrade_apply",
        None,
        Some(agent_id),
        Some("apply.upgrade"),
        Some("self"),
        &serde_json::json!({
            "review_id": review_id,
            "applied_changes": applied_changes,
        }),
    )
    .await;

    let response = serde_json::json!({
        "ok": true,
        "review_id": review_id,
        "identity_result": identity_result,
        "memory_result": memory_result,
        "presentable_result": {
            "kind": "patch_result",
            "title": "自我升级已应用",
            "summary": review_object.get("summary").cloned().unwrap_or(serde_json::Value::String("已根据审查结果完成自我升级".to_string())),
            "reviewId": review_id,
            "targetScope": review_object.get("target_scope").or_else(|| review_object.get("targetScope")).cloned().unwrap_or(serde_json::Value::String("self".to_string())),
            "riskLevel": review_object.get("risk_level").or_else(|| review_object.get("riskLevel")).cloned().unwrap_or(serde_json::Value::String("medium".to_string())),
            "appliedChanges": applied_changes,
        }
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
    extend_reference_image_source(
        &mut delegated,
        input,
        workspace_root,
        "my_photo_generate reference",
    )?;
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
        None,
        None,
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
    extend_reference_image_source(
        &mut delegated,
        input,
        workspace_root,
        "my_photo_edit reference",
    )?;
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
        None,
        None,
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
    let registry_snapshot =
        fetch_capability_registry_snapshot(caller_agent_id, "analyze.media", "generic").await;
    let local_enabled = registry_snapshot
        .as_ref()
        .map(|snapshot| {
            registry_provider_is_enabled(
                snapshot,
                "runtime_native:local_vision_service",
                "analyze.media",
                "generic",
            ) || registry_provider_is_enabled(
                snapshot,
                "runtime_native:ocr_service",
                "analyze.media",
                "generic",
            )
        })
        .unwrap_or(true);
    let generic_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "analyze.media",
        "generic",
        "generic_provider",
    );
    let model_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "analyze.media",
        "generic",
        "model_fallback",
    );

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
                if !local_enabled && !generic_enabled && !model_enabled {
                    let response = build_capability_unavailable_response(
                        "image_analyze",
                        "视觉分析当前不可用",
                        "vision_unavailable",
                        "视觉分析能力已被 registry 禁用，未找到可用的本地视觉、全局视觉 provider 或模型兜底。",
                        &[
                            "runtime_native(disabled_by_registry)".to_string(),
                            "generic_provider(disabled_by_registry)".to_string(),
                            "model_fallback(disabled_by_registry)".to_string(),
                        ],
                    );
                    return serde_json::to_string_pretty(&response)
                        .map_err(|e| format!("Serialize error: {e}"));
                }
                let local_vision_error = if local_enabled {
                    match crate::local_vision::analyze_image_path_with_local_service_detail(
                        &path,
                        mime_type,
                        Some(prompt),
                    )
                    .await
                    {
                        Ok(Some(detail)) => {
                            let local_json = serde_json::to_value(&detail)
                                .map_err(|e| format!("Serialize error: {e}"))?;
                            result["vision_analysis"] = local_json;
                            return serde_json::to_string_pretty(&result)
                                .map_err(|e| format!("Serialize error: {e}"));
                        }
                        Ok(None) => None,
                        Err(err) => Some(err),
                    }
                } else {
                    Some("Local vision stack disabled by registry.".to_string())
                };
                describe_image_bytes_with_timeouts(
                    prompt,
                    mime_type,
                    &data,
                    media_engine,
                    kernel,
                    caller_agent_id,
                    generic_enabled,
                    model_enabled,
                    std::time::Duration::from_secs(CURRENT_MODEL_VISION_TIMEOUT_SECS),
                    std::time::Duration::from_secs(FALLBACK_VISION_TIMEOUT_SECS),
                )
                .await
                .map_err(|err| match local_vision_error {
                    Some(local_err) => {
                        format!("Local vision stack failed: {local_err} | {err}")
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
            "Describe this media in detail. For images, extract visible text, numbers, tables, charts, UI elements, and any other relevant information. For videos, summarize the visible scene and any spoken or embedded text. For audio, transcribe the content accurately.",
        );
    let path = resolve_media_path(raw_path, workspace_root)?;
    let registry_snapshot =
        fetch_capability_registry_snapshot(caller_agent_id, "analyze.media", "generic").await;
    let local_enabled = registry_snapshot
        .as_ref()
        .map(|snapshot| {
            registry_provider_is_enabled(
                snapshot,
                "runtime_native:local_vision_service",
                "analyze.media",
                "generic",
            ) || registry_provider_is_enabled(
                snapshot,
                "runtime_native:ocr_service",
                "analyze.media",
                "generic",
            )
        })
        .unwrap_or(true);
    let runtime_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "analyze.media",
        "generic",
        "runtime_native",
    );
    let generic_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "analyze.media",
        "generic",
        "generic_provider",
    );
    let model_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "analyze.media",
        "generic",
        "model_fallback",
    );
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" => {
            let data = tokio::fs::read(&path)
                .await
                .map_err(|e| format!("Failed to read image file: {e}"))?;
            let mime = match ext.as_str() {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "bmp" => "image/bmp",
                "svg" => "image/svg+xml",
                _ => unreachable!(),
            };
            if !local_enabled && !generic_enabled && !model_enabled {
                let response = build_capability_unavailable_response(
                    "media_describe",
                    "媒体理解当前不可用",
                    "vision_unavailable",
                    "图片视觉理解能力已被 registry 禁用，未找到可用的 provider。",
                    &[
                        "runtime_native(disabled_by_registry)".to_string(),
                        "generic_provider(disabled_by_registry)".to_string(),
                        "model_fallback(disabled_by_registry)".to_string(),
                    ],
                );
                return serde_json::to_string_pretty(&response)
                    .map_err(|e| format!("Serialize error: {e}"));
            }
            let local_vision_error = if local_enabled {
                match crate::local_vision::analyze_image_path_with_local_service_detail(
                    &path,
                    mime,
                    Some(prompt),
                )
                .await
                {
                    Ok(Some(detail)) => {
                        let payload = enrich_media_describe_payload(
                            serde_json::to_value(&detail)
                                .map_err(|e| format!("Serialize error: {e}"))?,
                            "image",
                            build_media_source_asset_ref(&path, mime),
                            prompt,
                        );
                        return serde_json::to_string_pretty(&payload)
                            .map_err(|e| format!("Serialize error: {e}"));
                    }
                    Ok(None) => None,
                    Err(err) => Some(err),
                }
            } else {
                Some("Local vision stack disabled by registry.".to_string())
            };
            describe_image_bytes_with_timeouts(
                prompt,
                mime,
                &data,
                media_engine,
                kernel,
                caller_agent_id,
                generic_enabled,
                model_enabled,
                current_model_timeout,
                fallback_timeout,
            )
            .await
            .and_then(|raw| {
                let payload = serde_json::from_str::<serde_json::Value>(&raw)
                    .map_err(|e| format!("Serialize error: {e}"))?;
                let payload = enrich_media_describe_payload(
                    payload,
                    "image",
                    build_media_source_asset_ref(&path, mime),
                    prompt,
                );
                serde_json::to_string_pretty(&payload).map_err(|e| format!("Serialize error: {e}"))
            })
            .map_err(|err| match local_vision_error {
                Some(local_err) => format!("Local vision stack failed: {local_err} | {err}"),
                None => err,
            })
        }
        "mp3" | "wav" | "ogg" | "flac" | "m4a" | "webm" => {
            let mime = match ext.as_str() {
                "mp3" => "audio/mpeg",
                "wav" => "audio/wav",
                "ogg" => "audio/ogg",
                "flac" => "audio/flac",
                "m4a" => "audio/mp4",
                "webm" => "audio/webm",
                _ => unreachable!(),
            };
            if !runtime_enabled && !generic_enabled {
                let response = build_capability_unavailable_response(
                    "media_describe",
                    "媒体理解当前不可用",
                    "audio_unavailable",
                    "音频理解能力已被 registry 禁用，未找到可用的分析 provider。",
                    &[
                        "runtime_native(disabled_by_registry)".to_string(),
                        "generic_provider(disabled_by_registry)".to_string(),
                    ],
                );
                return serde_json::to_string_pretty(&response)
                    .map_err(|e| format!("Serialize error: {e}"));
            }
            let size_bytes = tokio::fs::metadata(&path)
                .await
                .map_err(|e| format!("Failed to inspect media file: {e}"))?
                .len();
            let attachment = openfang_types::media::MediaAttachment {
                media_type: openfang_types::media::MediaType::Audio,
                mime_type: mime.to_string(),
                source: openfang_types::media::MediaSource::FilePath {
                    path: path.to_string_lossy().to_string(),
                },
                size_bytes,
            };
            let engine =
                media_engine.ok_or("Media engine not available. Check media configuration.")?;
            let understanding = engine.transcribe_audio(&attachment).await?;
            let payload = enrich_media_describe_payload(
                serde_json::json!({
                    "description": understanding.description,
                    "provider": understanding.provider,
                    "model": understanding.model,
                    "media_type": "audio",
                }),
                "audio",
                build_media_source_asset_ref(&path, mime),
                prompt,
            );
            serde_json::to_string_pretty(&payload).map_err(|e| format!("Serialize error: {e}"))
        }
        "mp4" | "mov" => {
            let mime = match ext.as_str() {
                "mp4" => "video/mp4",
                "mov" => "video/quicktime",
                _ => unreachable!(),
            };
            if !runtime_enabled && !generic_enabled {
                let response = build_capability_unavailable_response(
                    "media_describe",
                    "媒体理解当前不可用",
                    "video_unavailable",
                    "视频理解能力已被 registry 禁用，未找到可用的分析 provider。",
                    &[
                        "runtime_native(disabled_by_registry)".to_string(),
                        "generic_provider(disabled_by_registry)".to_string(),
                    ],
                );
                return serde_json::to_string_pretty(&response)
                    .map_err(|e| format!("Serialize error: {e}"));
            }
            let size_bytes = tokio::fs::metadata(&path)
                .await
                .map_err(|e| format!("Failed to inspect media file: {e}"))?
                .len();
            let attachment = openfang_types::media::MediaAttachment {
                media_type: openfang_types::media::MediaType::Video,
                mime_type: mime.to_string(),
                source: openfang_types::media::MediaSource::FilePath {
                    path: path.to_string_lossy().to_string(),
                },
                size_bytes,
            };
            let engine =
                media_engine.ok_or("Media engine not available. Check media configuration.")?;
            let understanding = engine.describe_video(&attachment).await?;
            let payload = enrich_media_describe_payload(
                serde_json::json!({
                    "description": understanding.description,
                    "provider": understanding.provider,
                    "model": understanding.model,
                    "media_type": "video",
                }),
                "video",
                build_media_source_asset_ref(&path, mime),
                prompt,
            );
            serde_json::to_string_pretty(&payload).map_err(|e| format!("Serialize error: {e}"))
        }
        _ => Err(format!("Unsupported media format: .{ext}")),
    }
}

async fn describe_image_bytes_with_timeouts(
    prompt: &str,
    mime: &str,
    data: &[u8],
    media_engine: Option<&crate::media_understanding::MediaEngine>,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
    allow_generic_provider: bool,
    allow_model_fallback: bool,
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
    let attachment = openfang_types::media::MediaAttachment {
        media_type: openfang_types::media::MediaType::Image,
        mime_type: mime.to_string(),
        source: openfang_types::media::MediaSource::Base64 {
            data: base64_data.clone(),
            mime_type: mime.to_string(),
        },
        size_bytes: data.len() as u64,
    };

    let fallback_error = if allow_generic_provider {
        match media_engine {
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
                Err(err) => Some(err),
            },
            None => Some("Media engine not available. Check media configuration.".to_string()),
        }
    } else {
        Some("Configured vision provider path disabled by registry.".to_string())
    };

    let mut current_model_error = None;
    if allow_model_fallback {
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
    } else {
        current_model_error =
            Some("Current agent model fallback disabled by registry.".to_string());
    }

    let mut parts = Vec::new();
    if let Some(err) = fallback_error {
        parts.push(format!("Configured vision provider path failed: {err}"));
    }
    if let Some(err) = current_model_error {
        parts.push(format!("Current agent model fallback path failed: {err}"));
    }
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
    skill_registry: Option<&SkillRegistry>,
    allowed_skills: Option<&[String]>,
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
    let registry_snapshot =
        fetch_capability_registry_snapshot(caller_agent_id, "generate.image", "generic").await;
    let generic_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "generate.image",
        "generic",
        "generic_provider",
    );
    let model_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "generate.image",
        "generic",
        "model_fallback",
    );
    let mut attempts = Vec::new();

    if let Some(registry) = skill_registry {
        let selector_candidates = build_skill_dispatch_tool_candidates("image_generate", input);
        if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
            registry,
            "image_generate",
            input,
            allowed_skills,
            true,
            caller_agent_id,
        )
        .await
        {
            match result {
                Ok(value) => return Ok(value),
                Err(err) => attempts.push(format!("component_skill_error({err})")),
            }
        }
        attempts.push(format!(
            "component_skill({})",
            selector_candidates.join("/")
        ));

        if generic_enabled {
            if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
                registry,
                "image_generate",
                input,
                allowed_skills,
                false,
                caller_agent_id,
            )
            .await
            {
                match result {
                    Ok(value) => return Ok(value),
                    Err(err) => attempts.push(format!("generic_skill_error({err})")),
                }
            }
            attempts.push(format!(
                "generic_provider({})",
                selector_candidates.join("/")
            ));
        } else {
            attempts.push("generic_provider(disabled_by_registry)".to_string());
        }
    }

    if generic_enabled {
        match crate::image_gen::execute_configured_image_generate_tool(
            &request,
            workspace_root,
            Some(&asset_metadata),
        )
        .await
        {
            Ok(Some(response_json)) => {
                let parsed = serde_json::from_str::<serde_json::Value>(&response_json)
                    .map_err(|e| format!("Parse error: {e}"))?;
                let payload = enrich_presentable_payload(
                    parsed.clone(),
                    "image_generate",
                    "generic_provider",
                    "generic_provider:configured_image_service",
                    "generic_provider",
                    "image_generate",
                    build_image_presentable_result("image_generate", &parsed, input),
                );
                return serde_json::to_string_pretty(&payload)
                    .map_err(|e| format!("Serialize error: {e}"));
            }
            Ok(None) => attempts.push("generic_provider(configured_image_service)".to_string()),
            Err(err) => attempts.push(format!("generic_provider_error({err})")),
        }
    } else {
        attempts.push("generic_provider(disabled_by_registry)".to_string());
    }

    if model_enabled {
        if let (Some(kernel), Some(agent_id)) = (kernel, caller_agent_id) {
            match kernel
                .generate_image_with_agent_model(agent_id, &request)
                .await
            {
                Ok(result) => {
                    let response_payload = build_image_result_response(
                        &result,
                        workspace_root,
                        input,
                        caller_agent_id,
                    );
                    let response = enrich_presentable_payload(
                        response_payload.clone(),
                        "image_generate",
                        "model_fallback",
                        "model_fallback:native_image_model",
                        "model_fallback",
                        "image_generate",
                        build_image_presentable_result("image_generate", &response_payload, input),
                    );
                    return serde_json::to_string_pretty(&response)
                        .map_err(|e| format!("Serialize error: {e}"));
                }
                Err(err) => attempts.push(format!("model_fallback({err})")),
            }
        } else {
            match crate::image_gen::generate_image(&request).await {
                Ok(result) => {
                    let response_payload = build_image_result_response(
                        &result,
                        workspace_root,
                        input,
                        caller_agent_id,
                    );
                    let response = enrich_presentable_payload(
                        response_payload.clone(),
                        "image_generate",
                        "model_fallback",
                        "model_fallback:native_image_model",
                        "model_fallback",
                        "image_generate",
                        build_image_presentable_result("image_generate", &response_payload, input),
                    );
                    return serde_json::to_string_pretty(&response)
                        .map_err(|e| format!("Serialize error: {e}"));
                }
                Err(err) => attempts.push(format!("model_fallback({err})")),
            }
        }
    } else {
        attempts.push("model_fallback(disabled_by_registry)".to_string());
    }
    let response = build_capability_unavailable_response(
        "image_generate",
        "图片生成当前不可用",
        "image_unavailable",
        "图片生成已被 registry 禁用，未找到可用的组件技能、全局 provider 或模型兜底。",
        &attempts,
    );
    serde_json::to_string_pretty(&response).map_err(|e| format!("Serialize error: {e}"))
}

/// Edit a single image using a text instruction.
async fn tool_image_edit(
    input: &serde_json::Value,
    workspace_root: Option<&Path>,
    kernel: Option<&Arc<dyn KernelHandle>>,
    caller_agent_id: Option<&str>,
    skill_registry: Option<&SkillRegistry>,
    allowed_skills: Option<&[String]>,
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

    let primary_source = resolve_tool_image_source(
        input,
        workspace_root,
        &["image_path"],
        &["image_url"],
        &["image_base64"],
        &["mime_type"],
        &["source_image"],
        "image_edit primary source",
        true,
    )?;
    let reference_source = resolve_tool_image_source(
        input,
        workspace_root,
        &["reference_image_path"],
        &["reference_image_url"],
        &["reference_image_base64"],
        &["reference_mime_type"],
        &["reference_image"],
        "image_edit reference source",
        false,
    )?;

    let request = openfang_types::media::ImageEditRequest {
        prompt: prompt.to_string(),
        negative_prompt: input["negative_prompt"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        model,
        image_path: primary_source.image_path,
        image_url: primary_source.image_url,
        image_base64: primary_source.image_base64,
        mime_type: primary_source.mime_type,
        reference_image_path: reference_source.image_path,
        reference_image_url: reference_source.image_url,
        reference_image_base64: reference_source.image_base64,
        reference_mime_type: reference_source.mime_type,
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
    let registry_snapshot =
        fetch_capability_registry_snapshot(caller_agent_id, "edit.image", "generic").await;
    let generic_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "edit.image",
        "generic",
        "generic_provider",
    );
    let model_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "edit.image",
        "generic",
        "model_fallback",
    );
    let mut attempts = Vec::new();

    if let Some(registry) = skill_registry {
        let selector_candidates = build_skill_dispatch_tool_candidates("image_edit", input);
        if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
            registry,
            "image_edit",
            input,
            allowed_skills,
            true,
            caller_agent_id,
        )
        .await
        {
            match result {
                Ok(value) => return Ok(value),
                Err(err) => attempts.push(format!("component_skill_error({err})")),
            }
        }
        attempts.push(format!(
            "component_skill({})",
            selector_candidates.join("/")
        ));

        if generic_enabled {
            if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
                registry,
                "image_edit",
                input,
                allowed_skills,
                false,
                caller_agent_id,
            )
            .await
            {
                match result {
                    Ok(value) => return Ok(value),
                    Err(err) => attempts.push(format!("generic_skill_error({err})")),
                }
            }
            attempts.push(format!(
                "generic_provider({})",
                selector_candidates.join("/")
            ));
        } else {
            attempts.push("generic_provider(disabled_by_registry)".to_string());
        }
    }

    if generic_enabled {
        match crate::image_gen::execute_configured_image_edit_tool(
            &request,
            workspace_root,
            Some(&asset_metadata),
        )
        .await
        {
            Ok(Some(response_json)) => {
                let parsed = serde_json::from_str::<serde_json::Value>(&response_json)
                    .map_err(|e| format!("Parse error: {e}"))?;
                let payload = enrich_presentable_payload(
                    parsed.clone(),
                    "image_edit",
                    "generic_provider",
                    "generic_provider:configured_image_service",
                    "generic_provider",
                    "image_edit",
                    build_image_presentable_result("image_edit", &parsed, input),
                );
                return serde_json::to_string_pretty(&payload)
                    .map_err(|e| format!("Serialize error: {e}"));
            }
            Ok(None) => attempts.push("generic_provider(configured_image_service)".to_string()),
            Err(err) => attempts.push(format!("generic_provider_error({err})")),
        }
    } else {
        attempts.push("generic_provider(disabled_by_registry)".to_string());
    }

    if model_enabled {
        if let (Some(kernel), Some(agent_id)) = (kernel, caller_agent_id) {
            match kernel.edit_image_with_agent_model(agent_id, &request).await {
                Ok(result) => {
                    let response_payload = build_image_result_response(
                        &result,
                        workspace_root,
                        input,
                        caller_agent_id,
                    );
                    let response = enrich_presentable_payload(
                        response_payload.clone(),
                        "image_edit",
                        "model_fallback",
                        "model_fallback:native_image_model",
                        "model_fallback",
                        "image_edit",
                        build_image_presentable_result("image_edit", &response_payload, input),
                    );
                    return serde_json::to_string_pretty(&response)
                        .map_err(|e| format!("Serialize error: {e}"));
                }
                Err(err) => attempts.push(format!("model_fallback({err})")),
            }
        } else {
            match crate::image_gen::generate_openai_compatible_image_edit(
                &request,
                &request.model.to_string(),
                "https://api.openai.com/v1",
                &std::env::var("OPENAI_API_KEY").map_err(|_| {
                    "OPENAI_API_KEY not set. Image editing requires an OpenAI API key."
                })?,
            )
            .await
            {
                Ok(result) => {
                    let response_payload = build_image_result_response(
                        &result,
                        workspace_root,
                        input,
                        caller_agent_id,
                    );
                    let response = enrich_presentable_payload(
                        response_payload.clone(),
                        "image_edit",
                        "model_fallback",
                        "model_fallback:native_image_model",
                        "model_fallback",
                        "image_edit",
                        build_image_presentable_result("image_edit", &response_payload, input),
                    );
                    return serde_json::to_string_pretty(&response)
                        .map_err(|e| format!("Serialize error: {e}"));
                }
                Err(err) => attempts.push(format!("model_fallback({err})")),
            }
        }
    } else {
        attempts.push("model_fallback(disabled_by_registry)".to_string());
    }

    let response = build_capability_unavailable_response(
        "image_edit",
        "图片编辑当前不可用",
        "image_unavailable",
        "图片编辑已被 registry 禁用，未找到可用的组件技能、全局 provider 或模型兜底。",
        &attempts,
    );
    serde_json::to_string_pretty(&response).map_err(|e| format!("Serialize error: {e}"))
}

// ---------------------------------------------------------------------------
// TTS / STT tools
// ---------------------------------------------------------------------------

async fn tool_text_to_speech(
    input: &serde_json::Value,
    kernel: Option<&Arc<dyn KernelHandle>>,
    tts_engine: Option<&crate::tts::TtsEngine>,
    workspace_root: Option<&Path>,
    caller_agent_id: Option<&str>,
    skill_registry: Option<&SkillRegistry>,
    allowed_skills: Option<&[String]>,
) -> Result<String, String> {
    let mut effective_input = input.clone();
    if input.get("voice").is_none() && input.get("speaker_profile_id").is_none() {
        if let (Some(kh), Some(agent_id)) = (kernel, caller_agent_id) {
            let self_ctx = kh.get_agent_self_context(agent_id)?;
            let (speaker_profile_id, voice) = resolve_self_default_voice_binding(&self_ctx);
            if let Some(object) = effective_input.as_object_mut() {
                if let Some(value) = speaker_profile_id {
                    object.insert(
                        "speaker_profile_id".to_string(),
                        serde_json::Value::String(value),
                    );
                }
                if let Some(value) = voice {
                    object.insert("voice".to_string(), serde_json::Value::String(value));
                }
            }
        }
    }
    let input = &effective_input;
    let text = input["text"].as_str().ok_or("Missing 'text' parameter")?;
    let voice = input["voice"].as_str();
    let format = input["format"].as_str();
    let registry_snapshot =
        fetch_capability_registry_snapshot(caller_agent_id, "generate.audio", "generic").await;
    let local_enabled = registry_snapshot
        .as_ref()
        .map(|snapshot| {
            registry_provider_is_enabled(
                snapshot,
                "runtime_native:f5_tts_onnx",
                "generate.audio",
                "generic",
            )
        })
        .unwrap_or(true);
    let generic_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "generate.audio",
        "generic",
        "generic_provider",
    );
    let mut attempts = Vec::new();
    if let Some(registry) = skill_registry {
        let selector_candidates = build_skill_dispatch_tool_candidates("text_to_speech", input);
        if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
            registry,
            "text_to_speech",
            input,
            allowed_skills,
            true,
            caller_agent_id,
        )
        .await
        {
            match result {
                Ok(value) => return Ok(value),
                Err(err) => attempts.push(format!("component_skill_error({err})")),
            }
        }
        attempts.push(format!(
            "component_skill({})",
            selector_candidates.join("/")
        ));

        if generic_enabled {
            if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
                registry,
                "text_to_speech",
                input,
                allowed_skills,
                false,
                caller_agent_id,
            )
            .await
            {
                match result {
                    Ok(value) => return Ok(value),
                    Err(err) => attempts.push(format!("generic_skill_error({err})")),
                }
            }
            attempts.push(format!(
                "generic_provider({})",
                selector_candidates.join("/")
            ));
        } else {
            attempts.push("generic_provider(disabled_by_registry)".to_string());
        }
    }
    let local_tts_error = if local_enabled {
        match synthesize_via_webot_local_tts(input, caller_agent_id).await {
            Ok(Some(result)) => {
                let parsed = serde_json::from_str::<serde_json::Value>(&result)
                    .map_err(|e| format!("Parse error: {e}"))?;
                let payload = enrich_presentable_payload(
                    parsed.clone(),
                    "text_to_speech",
                    "runtime_native",
                    "runtime_native:f5_tts_onnx",
                    "runtime_native",
                    "text_to_speech",
                    build_audio_presentable_result("text_to_speech", &parsed, input),
                );
                return serde_json::to_string_pretty(&payload)
                    .map_err(|e| format!("Serialize error: {e}"));
            }
            Ok(None) => None,
            Err(error) => Some(error),
        }
    } else {
        attempts.push("runtime_native(f5_tts_onnx:disabled_by_registry)".to_string());
        None
    };

    if !local_enabled && !generic_enabled {
        let response = build_capability_unavailable_response(
            "text_to_speech",
            "语音生成当前不可用",
            "audio_unavailable",
            "语音生成能力已被 registry 禁用，未找到可用的本地或全局 TTS provider。",
            &attempts,
        );
        return serde_json::to_string_pretty(&response)
            .map_err(|e| format!("Serialize error: {e}"));
    }
    if !generic_enabled {
        attempts.push("generic_provider(disabled_by_registry)".to_string());
    }

    let engine = tts_engine.ok_or_else(|| {
        if let Some(local_error) = local_tts_error.as_ref() {
            format!(
                "Webot local TTS failed and runtime TTS engine is unavailable: {local_error}"
            )
        } else {
            "TTS engine not available. Configure Webot local TTS or enable runtime tts.enabled/provider.".to_string()
        }
    })?;
    if !generic_enabled {
        let response = build_capability_unavailable_response(
            "text_to_speech",
            "语音生成当前不可用",
            "audio_unavailable",
            "语音生成的全局 provider 已被 registry 禁用。",
            &attempts,
        );
        return serde_json::to_string_pretty(&response)
            .map_err(|e| format!("Serialize error: {e}"));
    }
    let result = match engine.synthesize(text, voice, format).await {
        Ok(result) => result,
        Err(error) => {
            if let Some(local_error) = local_tts_error {
                attempts.push(format!("runtime_native({local_error})"));
            }
            attempts.push(format!("generic_provider({error})"));
            let response = build_capability_unavailable_response(
                "text_to_speech",
                "语音生成当前不可用",
                "audio_unavailable",
                "语音生成未找到可用结果。",
                &attempts,
            );
            return serde_json::to_string_pretty(&response)
                .map_err(|e| format!("Serialize error: {e}"));
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

    let provider_id = format!("generic_provider:{}", result.provider.trim());
    let response = serde_json::json!({
        "tool": "text_to_speech",
        "route": "generic_provider",
        "provider_id": provider_id.clone(),
        "provider_type": "generic_provider",
        "provider_tool": "text_to_speech",
        "saved_to": saved_path,
        "format": result.format,
        "mime_type": format!("audio/{}", result.format),
        "provider": result.provider,
        "duration_estimate_ms": result.duration_estimate_ms,
        "size_bytes": result.audio_data.len(),
    });
    let presentable_result = build_audio_presentable_result("text_to_speech", &response, input);

    let response = enrich_presentable_payload(
        response,
        "text_to_speech",
        "generic_provider",
        &provider_id,
        "generic_provider",
        "text_to_speech",
        presentable_result,
    );
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
    caller_agent_id: Option<&str>,
    skill_registry: Option<&SkillRegistry>,
    allowed_skills: Option<&[String]>,
) -> Result<String, String> {
    let registry_snapshot =
        fetch_capability_registry_snapshot(caller_agent_id, "transcribe.audio", "generic").await;
    let runtime_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "transcribe.audio",
        "generic",
        "runtime_native",
    );
    let generic_enabled = registry_has_enabled_provider_type(
        registry_snapshot.as_ref(),
        "transcribe.audio",
        "generic",
        "generic_provider",
    );
    let mut attempts = Vec::new();
    if let Some(registry) = skill_registry {
        let selector_candidates = build_skill_dispatch_tool_candidates("speech_to_text", input);
        if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
            registry,
            "speech_to_text",
            input,
            allowed_skills,
            true,
            caller_agent_id,
        )
        .await
        {
            match result {
                Ok(value) => return Ok(value),
                Err(err) => attempts.push(format!("component_skill_error({err})")),
            }
        }
        attempts.push(format!(
            "component_skill({})",
            selector_candidates.join("/")
        ));

        if generic_enabled {
            if let Some(result) = dispatch_skill_tool_candidates_from_runtime(
                registry,
                "speech_to_text",
                input,
                allowed_skills,
                false,
                caller_agent_id,
            )
            .await
            {
                match result {
                    Ok(value) => return Ok(value),
                    Err(err) => attempts.push(format!("generic_skill_error({err})")),
                }
            }
            attempts.push(format!(
                "generic_provider({})",
                selector_candidates.join("/")
            ));
        } else {
            attempts.push("generic_provider(disabled_by_registry)".to_string());
        }
    }
    if !runtime_enabled && !generic_enabled {
        attempts.push("runtime_native(disabled_by_registry)".to_string());
        attempts.push("generic_provider(disabled_by_registry)".to_string());
        let response = build_capability_unavailable_response(
            "speech_to_text",
            "语音转文本当前不可用",
            "audio_unavailable",
            "语音转文本能力已被 registry 禁用，未找到可用的 STT provider。",
            &attempts,
        );
        return serde_json::to_string_pretty(&response)
            .map_err(|e| format!("Serialize error: {e}"));
    }
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

    let understanding = match engine.transcribe_audio(&attachment).await {
        Ok(value) => value,
        Err(err) => {
            if !runtime_enabled {
                attempts.push("runtime_native(disabled_by_registry)".to_string());
            }
            if !generic_enabled {
                attempts.push("generic_provider(disabled_by_registry)".to_string());
            }
            attempts.push(format!("transcribe_audio({err})"));
            let response = build_capability_unavailable_response(
                "speech_to_text",
                "语音转文本当前不可用",
                "audio_unavailable",
                "语音转文本未找到可用结果。",
                &attempts,
            );
            return serde_json::to_string_pretty(&response)
                .map_err(|e| format!("Serialize error: {e}"));
        }
    };

    let provider_id = format!("generic_provider:{}", understanding.provider.trim());
    let source_asset = build_media_asset_ref(
        &resolved.to_string_lossy(),
        mime_type,
        "speech_to_text",
        "source_path",
        Some(serde_json::json!({
            "role": "source",
        })),
    );
    let response = serde_json::json!({
        "tool": "speech_to_text",
        "route": "generic_provider",
        "provider_id": provider_id.clone(),
        "provider_type": "generic_provider",
        "provider_tool": "speech_to_text",
        "transcript": understanding.description,
        "provider": understanding.provider,
        "model": understanding.model,
        "mime_type": mime_type,
        "source_path": resolved.to_string_lossy().to_string(),
        "source_asset": source_asset.clone(),
        "sourceAsset": source_asset,
    });
    let presentable_result = build_speech_to_text_presentable_result(&response);

    let response = enrich_presentable_payload(
        response,
        "speech_to_text",
        "generic_provider",
        &provider_id,
        "generic_provider",
        "speech_to_text",
        presentable_result,
    );
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
    use openfang_skills::{
        InstalledSkill, SkillManifest, SkillMeta, SkillRequirements, SkillRuntimeConfig,
        SkillToolDef, SkillTools,
    };
    use std::sync::Arc;

    fn build_minimal_pdf_bytes(text: &str) -> Vec<u8> {
        let escaped = text
            .replace('\\', "\\\\")
            .replace('(', "\\(")
            .replace(')', "\\)");
        let objects = vec![
            "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n".to_string(),
            "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n".to_string(),
            "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n".to_string(),
            format!(
                "4 0 obj\n<< /Length {} >>\nstream\nBT\n/F1 18 Tf\n40 100 Td\n({escaped}) Tj\nET\nendstream\nendobj\n",
                31 + escaped.len()
            ),
            "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n".to_string(),
        ];

        let mut pdf = String::from("%PDF-1.4\n");
        let mut offsets = vec![0usize];
        for object in &objects {
            offsets.push(pdf.len());
            pdf.push_str(object);
        }
        let startxref = pdf.len();
        pdf.push_str("xref\n0 6\n0000000000 65535 f \n");
        for offset in offsets.iter().skip(1) {
            pdf.push_str(&format!("{offset:010} 00000 n \n"));
        }
        pdf.push_str("trailer\n<< /Root 1 0 R /Size 6 >>\n");
        pdf.push_str(&format!("startxref\n{startxref}\n%%EOF\n"));
        pdf.into_bytes()
    }

    fn write_zip_entries(path: &Path, entries: &[(&str, &str)]) {
        let file = std::fs::File::create(path).expect("create zip file");
        let mut writer = zip::ZipWriter::new(file);
        let options: zip::write::SimpleFileOptions = zip::write::FileOptions::default();
        for (name, content) in entries {
            writer.start_file(*name, options).expect("start zip entry");
            std::io::Write::write_all(&mut writer, content.as_bytes()).expect("write zip entry");
        }
        writer.finish().expect("finish zip");
    }

    fn build_test_skill(tool_name: &str, skill_name: &str, tags: &[&str]) -> InstalledSkill {
        InstalledSkill {
            manifest: SkillManifest {
                skill: SkillMeta {
                    name: skill_name.to_string(),
                    version: "0.1.0".to_string(),
                    description: "test skill".to_string(),
                    author: String::new(),
                    license: String::new(),
                    tags: tags.iter().map(|item| item.to_string()).collect(),
                },
                runtime: SkillRuntimeConfig::default(),
                tools: SkillTools {
                    provided: vec![SkillToolDef {
                        name: tool_name.to_string(),
                        description: "test tool".to_string(),
                        input_schema: serde_json::json!({"type":"object"}),
                    }],
                },
                requirements: SkillRequirements::default(),
                prompt_context: None,
                source: None,
            },
            path: PathBuf::from("."),
            enabled: true,
        }
    }

    #[test]
    fn test_selector_score_skill_prefers_pdf_specialization_for_document_parse() {
        let pdf_skill = build_test_skill(
            "document_parse",
            "document_pdf_parser",
            &[
                "component-center",
                "component-skill",
                "base-tool:document_parse",
                "capability-key:parse.document",
                "capability-scope:generic",
                "specialization:pdf",
                "subject-policy:document_first",
                "preferred-mime:application/pdf",
            ],
        );
        let general_skill = build_test_skill(
            "document_parse",
            "document_general_parser",
            &[
                "component-center",
                "component-skill",
                "base-tool:document_parse",
                "capability-key:parse.document",
                "capability-scope:generic",
                "specialization:general",
            ],
        );
        let input = serde_json::json!({
            "path": "sample.pdf",
            "document_type": "pdf",
            "mime_type": "application/pdf",
            "prompt": "请解析这个 PDF 文档"
        });

        let pdf_score = selector_score_skill(&pdf_skill, "document_parse", &input, true);
        let general_score = selector_score_skill(&general_skill, "document_parse", &input, true);

        assert!(
            pdf_score > general_score,
            "pdf specialized skill should score higher"
        );
    }

    #[test]
    fn test_runtime_skill_allowed_by_registry_blocks_disabled_generic_skill() {
        let skill = build_test_skill(
            "text_to_speech",
            "openai_tts",
            &[
                "base-tool:text_to_speech",
                "capability-key:generate.audio",
                "capability-scope:generic",
            ],
        );
        let snapshot = RuntimeCapabilityRegistrySnapshot {
            providers: vec![RuntimeRegistryProviderRecord {
                provider_id: "generic_provider:openai_tts".to_string(),
                provider_type: "generic_provider".to_string(),
                capabilities: vec![RuntimeRegistryCapabilityDescriptor {
                    key: "generate.audio".to_string(),
                    scope: "generic".to_string(),
                }],
                enabled: false,
                health_state: "disabled".to_string(),
            }],
            bindings: Vec::new(),
            health_states: Vec::new(),
            agent_bindings: Vec::new(),
        };

        assert!(!runtime_skill_allowed_by_registry(
            &skill,
            "text_to_speech",
            false,
            Some(&snapshot),
        ));
    }

    #[test]
    fn test_build_skill_dispatch_tool_candidates_prefers_text2video_without_image() {
        let candidates = build_skill_dispatch_tool_candidates(
            "video_generate",
            &serde_json::json!({
                "prompt": "生成一个跳舞视频"
            }),
        );
        assert_eq!(
            candidates,
            vec![
                "text2video".to_string(),
                "video_generate".to_string(),
                "image2video".to_string()
            ]
        );
    }

    #[test]
    fn test_build_skill_dispatch_tool_candidates_prefers_image2video_with_source_image() {
        let candidates = build_skill_dispatch_tool_candidates(
            "video_generate",
            &serde_json::json!({
                "prompt": "用你当前形象生成一段视频",
                "image_url": "https://example.com/portrait.png"
            }),
        );
        assert_eq!(
            candidates,
            vec![
                "image2video".to_string(),
                "video_generate".to_string(),
                "text2video".to_string()
            ]
        );
    }

    #[test]
    fn test_prompt_hits_self_expression_supports_current_portrait_phrases() {
        assert!(prompt_hits_self_expression(
            "沿用你当前照片里的形象生成请安视频"
        ));
        assert!(prompt_hits_self_expression(
            "按你现在的样子向我走来并说早安"
        ));
        assert!(prompt_hits_self_expression("用你的立绘生成一段视频"));
    }

    #[test]
    fn test_selector_score_skill_rejects_media_dependent_video_skill_without_source() {
        let media_dependent_skill = build_test_skill(
            "video_generate",
            "image2video",
            &[
                "base-tool:video_generate",
                "capability-key:generate.video",
                "capability-scope:generic",
                "source-policy:requires_image",
                "requires-slot:image",
                "requires-slot:prompt",
            ],
        );
        let text_only_video_skill = build_test_skill(
            "video_generate",
            "text2video",
            &[
                "base-tool:video_generate",
                "capability-key:generate.video",
                "capability-scope:generic",
                "source-policy:text_only",
                "supports-text-only",
                "requires-slot:prompt",
            ],
        );
        let input = serde_json::json!({
            "prompt": "让角色跳舞"
        });

        assert!(
            selector_score_skill(&media_dependent_skill, "video_generate", &input, true)
                <= i64::MIN / 4
        );
        assert!(selector_score_skill(&text_only_video_skill, "video_generate", &input, true) > 0);
    }

    #[test]
    fn test_build_skill_dispatch_tool_candidates_links_image_analyze_and_media_describe() {
        let image_candidates = build_skill_dispatch_tool_candidates(
            "image_analyze",
            &serde_json::json!({
                "path": "sample.png"
            }),
        );
        let media_image_candidates = build_skill_dispatch_tool_candidates(
            "media_describe",
            &serde_json::json!({
                "path": "sample.png"
            }),
        );
        let media_audio_candidates = build_skill_dispatch_tool_candidates(
            "media_describe",
            &serde_json::json!({
                "path": "sample.mp3"
            }),
        );
        assert_eq!(
            image_candidates,
            vec!["image_analyze".to_string(), "media_describe".to_string()]
        );
        assert_eq!(
            media_image_candidates,
            vec!["media_describe".to_string(), "image_analyze".to_string()]
        );
        assert_eq!(media_audio_candidates, vec!["media_describe".to_string()]);
    }

    #[test]
    fn test_build_skill_dispatch_tool_candidates_links_document_parse_and_extract() {
        let parse_candidates = build_skill_dispatch_tool_candidates(
            "document_parse",
            &serde_json::json!({"path": "sample.pdf"}),
        );
        let extract_candidates = build_skill_dispatch_tool_candidates(
            "document_extract",
            &serde_json::json!({"path": "sample.pdf"}),
        );
        assert_eq!(
            parse_candidates,
            vec!["document_parse".to_string(), "document_extract".to_string()]
        );
        assert_eq!(
            extract_candidates,
            vec!["document_extract".to_string(), "document_parse".to_string()]
        );
    }

    fn build_minimal_docx(path: &Path, text: &str) {
        write_zip_entries(
            path,
            &[
                (
                    "[Content_Types].xml",
                    r#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#,
                ),
                (
                    "_rels/.rels",
                    r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#,
                ),
                (
                    "word/document.xml",
                    &format!(
                        r#"<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>{text}</w:t></w:r></w:p>
  </w:body>
</w:document>"#
                    ),
                ),
            ],
        );
    }

    fn build_minimal_xlsx(path: &Path) {
        write_zip_entries(
            path,
            &[
                (
                    "[Content_Types].xml",
                    r#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#,
                ),
                (
                    "_rels/.rels",
                    r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#,
                ),
                (
                    "xl/workbook.xml",
                    r#"<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>"#,
                ),
                (
                    "xl/_rels/workbook.xml.rels",
                    r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#,
                ),
                (
                    "xl/worksheets/sheet1.xml",
                    r#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>名称</t></is></c>
      <c r="B1" t="inlineStr"><is><t>值</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>测试项</t></is></c>
      <c r="B2"><v>42</v></c>
    </row>
  </sheetData>
</worksheet>"#,
                ),
            ],
        );
    }

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
        // 6 self-management tools
        assert!(names.contains(&"my_identity_patch"));
        assert!(names.contains(&"my_memory_patch"));
        assert!(names.contains(&"my_upgrade_review"));
        assert!(names.contains(&"my_upgrade_apply"));
        assert!(names.contains(&"my_photo_generate"));
        assert!(names.contains(&"my_photo_edit"));
        // 6 media/image/video tools
        assert!(names.contains(&"media_describe"));
        assert!(names.contains(&"media_transcribe"));
        assert!(names.contains(&"image_generate"));
        assert!(names.contains(&"image_edit"));
        assert!(names.contains(&"video_generate"));
        assert!(names.contains(&"video_edit"));
        assert!(names.contains(&"document_parse"));
        assert!(names.contains(&"document_extract"));
        assert!(names.contains(&"document_summarize"));
        assert!(names.contains(&"document_convert"));
        assert!(names.contains(&"document_compare"));
        assert!(names.contains(&"document_preview"));
        assert!(names.contains(&"document_chunk"));
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

        let video_generate = tools
            .iter()
            .find(|tool| tool.name == "video_generate")
            .expect("video_generate tool missing");
        assert!(video_generate
            .description
            .contains("source_mode='self_default'"));
        assert!(video_generate
            .description
            .contains("job_result -> media_result(video)"));
        assert!(video_generate
            .input_schema
            .get("properties")
            .and_then(|properties| properties.get("source_mode"))
            .is_some());
        assert!(video_generate
            .input_schema
            .get("properties")
            .and_then(|properties| properties.get("save_target"))
            .is_some());
        assert!(video_generate
            .input_schema
            .get("properties")
            .and_then(|properties| properties.get("meta_label"))
            .is_some());

        let video_edit = tools
            .iter()
            .find(|tool| tool.name == "video_edit")
            .expect("video_edit tool missing");
        assert!(video_edit
            .description
            .contains("source_mode='source_video'"));
        assert!(video_edit
            .input_schema
            .get("properties")
            .and_then(|properties| properties.get("source_mode"))
            .is_some());
        assert!(video_edit
            .input_schema
            .get("properties")
            .and_then(|properties| properties.get("source_video"))
            .is_some());
        assert!(video_edit
            .input_schema
            .get("properties")
            .and_then(|properties| properties.get("save_target"))
            .is_some());

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
    fn test_resolve_video_generate_source_mode_prefers_explicit_and_self_defaults() {
        let explicit_self = serde_json::json!({
            "source_mode": "self_default",
            "prompt": "生成一段你的视频"
        });
        assert_eq!(
            resolve_video_generate_source_mode(&explicit_self, false, false),
            "self_default"
        );

        let inferred_self = serde_json::json!({
            "prompt": "生成一段你的视频"
        });
        assert_eq!(
            resolve_video_generate_source_mode(&inferred_self, false, true),
            "self_default"
        );

        let inferred_image = serde_json::json!({
            "prompt": "让她走过来",
            "image_url": "https://example.com/portrait.png"
        });
        assert_eq!(
            resolve_video_generate_source_mode(&inferred_image, true, false),
            "image_to_video"
        );

        let inferred_text = serde_json::json!({
            "prompt": "雪夜城市延时摄影"
        });
        assert_eq!(
            resolve_video_generate_source_mode(&inferred_text, false, false),
            "text_to_video"
        );
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
    async fn test_document_parse_text_file_returns_document_result() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let file_path = temp_dir.path().join("doc.md");
        tokio::fs::write(&file_path, "# 标题\n\n这是一个文档能力测试。")
            .await
            .expect("write file");

        let result = tool_document_parse(
            "document_parse",
            &serde_json::json!({
                "path": "doc.md",
            }),
            Some(temp_dir.path()),
            None,
            None,
            None,
        )
        .await
        .expect("document_parse");
        let payload =
            serde_json::from_str::<serde_json::Value>(&result).expect("parse document result");
        assert_eq!(payload["ok"], true);
        assert_eq!(payload["document_type"], "md");
        assert_eq!(payload["presentable_result"]["kind"], "document_result");
        assert!(payload["presentable_result"]["extracted_text"]
            .as_str()
            .unwrap_or_default()
            .contains("文档能力测试"));
    }

    #[tokio::test]
    async fn test_document_convert_text_file_creates_output_file() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let file_path = temp_dir.path().join("source.txt");
        tokio::fs::write(&file_path, "转换测试文本")
            .await
            .expect("write file");

        let result = tool_document_convert(
            &serde_json::json!({
                "path": "source.txt",
                "target_format": "json",
            }),
            Some(temp_dir.path()),
            None,
            None,
            None,
        )
        .await
        .expect("document_convert");
        let payload =
            serde_json::from_str::<serde_json::Value>(&result).expect("parse convert result");
        let output_file = payload["output_file"]
            .as_str()
            .expect("output_file should exist");
        assert!(Path::new(output_file).exists());
        assert_eq!(payload["presentable_result"]["kind"], "document_result");
        assert_eq!(
            payload["presentable_result"]["conversion_outputs"][0]["format"],
            "json"
        );
    }

    #[tokio::test]
    async fn test_document_convert_xlsx_file_to_csv() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let file_path = temp_dir.path().join("sheet.xlsx");
        build_minimal_xlsx(&file_path);

        let result = tool_document_convert(
            &serde_json::json!({
                "path": "sheet.xlsx",
                "target_format": "csv",
            }),
            Some(temp_dir.path()),
            None,
            None,
            None,
        )
        .await
        .expect("document_convert csv");
        let payload =
            serde_json::from_str::<serde_json::Value>(&result).expect("parse convert csv result");
        let output_file = payload["output_file"]
            .as_str()
            .expect("output_file should exist");
        assert!(Path::new(output_file).exists());
        let content = std::fs::read_to_string(output_file).expect("read csv output");
        assert!(content.contains("名称,值"));
        assert!(content.contains("测试项,42"));
        assert_eq!(
            payload["presentable_result"]["conversion_outputs"][0]["format"],
            "csv"
        );
    }

    #[tokio::test]
    async fn test_document_parse_pdf_file_extracts_text() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let file_path = temp_dir.path().join("sample.pdf");
        tokio::fs::write(&file_path, build_minimal_pdf_bytes("PDF SAMPLE TEXT"))
            .await
            .expect("write pdf");

        let result = tool_document_parse(
            "document_parse",
            &serde_json::json!({
                "path": "sample.pdf",
            }),
            Some(temp_dir.path()),
            None,
            None,
            None,
        )
        .await
        .expect("document_parse pdf");
        let payload = serde_json::from_str::<serde_json::Value>(&result).expect("parse pdf result");
        assert_eq!(payload["document_type"], "pdf");
        assert!(payload["presentable_result"]["extracted_text"]
            .as_str()
            .unwrap_or_default()
            .contains("PDF SAMPLE TEXT"));
    }

    #[tokio::test]
    async fn test_document_parse_docx_file_extracts_text() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let file_path = temp_dir.path().join("sample.docx");
        build_minimal_docx(&file_path, "Word 文档测试");

        let result = tool_document_parse(
            "document_parse",
            &serde_json::json!({
                "path": "sample.docx",
            }),
            Some(temp_dir.path()),
            None,
            None,
            None,
        )
        .await
        .expect("document_parse docx");
        let payload =
            serde_json::from_str::<serde_json::Value>(&result).expect("parse docx result");
        assert_eq!(payload["document_type"], "docx");
        assert!(payload["presentable_result"]["extracted_text"]
            .as_str()
            .unwrap_or_default()
            .contains("Word 文档测试"));
    }

    #[tokio::test]
    async fn test_document_parse_xlsx_file_extracts_text() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let file_path = temp_dir.path().join("sample.xlsx");
        build_minimal_xlsx(&file_path);

        let result = tool_document_parse(
            "document_parse",
            &serde_json::json!({
                "path": "sample.xlsx",
            }),
            Some(temp_dir.path()),
            None,
            None,
            None,
        )
        .await
        .expect("document_parse xlsx");
        let payload =
            serde_json::from_str::<serde_json::Value>(&result).expect("parse xlsx result");
        assert_eq!(payload["document_type"], "xlsx");
        let extracted = payload["presentable_result"]["extracted_text"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        assert!(extracted.contains("工作表: Sheet1"));
        assert!(extracted.contains("测试项"));
        assert!(extracted.contains("42"));
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

    #[tokio::test]
    async fn test_my_upgrade_review_returns_review_result() {
        let kernel: Arc<dyn KernelHandle> = Arc::new(MediaDescribeTestKernel {
            mode: MediaDescribeTestKernelMode::Immediate,
        });
        let result = tool_my_upgrade_review(
            &serde_json::json!({
                "summary": "准备修正自我记忆表达风格",
                "memory_patch": {
                    "content": "回答时先给结论再解释",
                    "memory_type": "self_upgrade_note"
                }
            }),
            None,
            Some(&kernel),
            Some("agent-1"),
        )
        .await
        .expect("my_upgrade_review should succeed");
        let payload =
            serde_json::from_str::<serde_json::Value>(&result).expect("parse review payload");
        assert_eq!(payload["presentable_result"]["kind"], "review_result");
        assert_eq!(payload["review"]["agent_id"], "agent-1");
    }

    #[tokio::test]
    async fn test_my_upgrade_apply_requires_confirmation_when_review_demands_it() {
        let kernel: Arc<dyn KernelHandle> = Arc::new(MediaDescribeTestKernel {
            mode: MediaDescribeTestKernelMode::Immediate,
        });
        let result = tool_my_upgrade_apply(
            &serde_json::json!({
                "review": {
                    "review_id": "review-1",
                    "summary": "需要确认后写入记忆",
                    "requires_confirmation": true,
                    "memory_patch": {
                        "content": "确认后再写入",
                        "memory_type": "self_upgrade_note"
                    }
                }
            }),
            None,
            Some(&kernel),
            Some("agent-1"),
        )
        .await
        .expect("my_upgrade_apply should return confirm_result");
        let payload =
            serde_json::from_str::<serde_json::Value>(&result).expect("parse apply payload");
        assert_eq!(payload["presentable_result"]["kind"], "confirm_result");
    }

    #[tokio::test]
    async fn test_my_upgrade_apply_uses_review_payload_when_confirmed() {
        let workspace = std::env::temp_dir().join(format!(
            "openfang_my_upgrade_workspace_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&workspace).unwrap();
        let kernel: Arc<dyn KernelHandle> = Arc::new(MediaDescribeTestKernel {
            mode: MediaDescribeTestKernelMode::Immediate,
        });
        let result = tool_my_upgrade_apply(
            &serde_json::json!({
                "confirmed_by_user": true,
                "review": {
                    "review_id": "review-2",
                    "summary": "写入新的升级记忆",
                    "requires_confirmation": true,
                    "memory_patch": {
                        "content": "升级完成后记住新的表达要求",
                        "memory_type": "self_upgrade_note"
                    }
                }
            }),
            Some(workspace.as_path()),
            Some(&kernel),
            Some("agent-1"),
        )
        .await
        .expect("my_upgrade_apply should succeed");
        let _ = std::fs::remove_dir_all(&workspace);
        let payload = serde_json::from_str::<serde_json::Value>(&result)
            .expect("parse apply success payload");
        assert_eq!(payload["presentable_result"]["kind"], "patch_result");
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
    fn test_resolve_self_photo_source_prefers_embodiment_default_portrait() {
        let self_ctx = serde_json::json!({
            "avatar_url": "https://example.com/avatar.png",
            "embodiment": {
                "assets": {
                    "defaultPortrait": {
                        "url": "https://example.com/embodiment-portrait.png"
                    }
                }
            }
        });
        let source = resolve_self_photo_source(&serde_json::json!({}), &self_ctx)
            .expect("embodiment portrait fallback should resolve");
        assert_eq!(
            source.get("image_url").and_then(serde_json::Value::as_str),
            Some("https://example.com/embodiment-portrait.png")
        );
    }

    #[test]
    fn test_resolve_self_default_voice_binding_prefers_embodiment() {
        let self_ctx = serde_json::json!({
            "tts_config": {
                "speakerProfileId": "legacy-speaker"
            },
            "embodiment": {
                "voice": {
                    "defaultVoice": {
                        "mode": "speaker_profile",
                        "speakerProfileId": "embodiment-speaker",
                        "voice": "soft"
                    }
                }
            }
        });
        let (speaker_profile_id, voice) = resolve_self_default_voice_binding(&self_ctx);
        assert_eq!(speaker_profile_id.as_deref(), Some("embodiment-speaker"));
        assert_eq!(voice.as_deref(), Some("soft"));
    }

    #[test]
    fn test_extract_job_result_payload_supports_camel_case_component_output() {
        let payload = serde_json::json!({
            "presentableResult": {
                "kind": "job_result",
                "job_id": "component-job-1",
                "status": "queued"
            }
        });

        let extracted = extract_job_result_payload(&payload).expect("job_result payload");
        assert_eq!(
            extracted.get("job_id").and_then(serde_json::Value::as_str),
            Some("component-job-1")
        );
        assert_eq!(
            extracted.get("status").and_then(serde_json::Value::as_str),
            Some("queued")
        );
    }

    #[test]
    fn test_normalize_component_skill_media_output_promotes_job_result() {
        let content = serde_json::json!({
            "outputType": "video",
            "presentableResult": {
                "kind": "job_result",
                "job_id": "component-job-2",
                "status": "queued"
            },
            "providerMeta": {
                "providerId": "component_skill:image2video"
            },
            "text": "LTX2.3图片生成视频 已提交，正在生成视频"
        })
        .to_string();

        let normalized = normalize_component_skill_media_output(&content, "video_generate")
            .expect("normalized content");
        let parsed: serde_json::Value = serde_json::from_str(&normalized).expect("normalized json");
        assert_eq!(parsed["tool"], "video_generate");
        assert_eq!(parsed["output_type"], "video");
        assert_eq!(parsed["presentable_result"]["kind"], "job_result");
        assert_eq!(parsed["job_result"]["job_id"], "component-job-2");
        assert_eq!(
            parsed["provider_meta"]["providerId"],
            "component_skill:image2video"
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
            "Configured vision provider path failed: Media engine not available. Check media configuration."
        ));
        assert!(err.contains(
            "Current agent model fallback path failed: Current agent model vision request timed out after 10ms"
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
