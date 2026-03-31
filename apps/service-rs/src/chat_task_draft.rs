use std::sync::{Arc, OnceLock};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

use crate::assignment_store;
use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatTaskDraftPayload {
    #[serde(default)]
    pub objective: Option<String>,
    #[serde(default)]
    pub report_condition: Option<String>,
    #[serde(default)]
    pub every_ms: Option<u64>,
    #[serde(default)]
    pub max_runs: Option<u32>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub schedule_text: Option<String>,
    #[serde(default)]
    pub source_message_text: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub missing_slots: Vec<String>,
    #[serde(default)]
    pub ready_to_confirm: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AnalyzeChatTaskDraftRequest {
    pub message: String,
    #[serde(default)]
    pub current_draft: Option<ChatTaskDraftPayload>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnalyzeChatTaskDraftResponse {
    pub matched: bool,
    #[serde(default)]
    pub cancelled: bool,
    #[serde(default)]
    pub ready_to_confirm: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft: Option<ChatTaskDraftPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_card: Option<ChatTaskCardResponse>,
}

#[derive(Debug, Clone, Default)]
struct ModelTaskDraftAnalysis {
    matched: bool,
    cancelled: bool,
    objective: Option<String>,
    report_condition: Option<String>,
    every_ms: Option<u64>,
    max_runs: Option<u32>,
    duration_ms: Option<u64>,
    prompt_text: Option<String>,
    task_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatTaskTimelineItemResponse {
    pub id: String,
    pub kind: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatTaskCardResponse {
    pub task_name: String,
    pub objective: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_condition: Option<String>,
    pub schedule_text: String,
    pub every_ms: u64,
    pub max_runs: u32,
    pub run_count: u32,
    pub execution_prompt: String,
    pub source_message_text: String,
    pub stage: String,
    pub created_at: String,
    pub updated_at: String,
    pub can_create: bool,
    pub can_cancel: bool,
    pub can_delete: bool,
    pub notify_on_complete: bool,
    pub completed_notified: bool,
    pub task_kind: String,
    pub report_status: String,
    pub progress_percent: u32,
    pub timeline: Vec<ChatTaskTimelineItemResponse>,
}

const TASK_DRAFT_PARSER_AGENT_NAME: &str = "webot-task-draft-parser";
const TASK_DRAFT_PARSER_AGENT_DESCRIPTION: &str =
    "Webot 内部任务草稿解析智能体，只负责结构化理解聊天任务意图。";
static TASK_DRAFT_PARSER_AGENT_CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn build_task_name(objective: &str, fallback: &str) -> String {
    let seed = if objective.trim().is_empty() {
        fallback.trim()
    } else {
        objective.trim()
    };
    if seed.is_empty() {
        return "任务定时器".to_string();
    }
    let compact = seed
        .replace(['。', '！', '？', '!'], "")
        .split_whitespace()
        .collect::<String>();
    let compact = compact.trim();
    if compact.is_empty() {
        return "任务定时器".to_string();
    }
    if compact.chars().count() <= 14 {
        return compact.to_string();
    }
    compact.chars().take(14).collect::<String>() + "..."
}

fn format_every_ms(every_ms: u64) -> String {
    let safe = every_ms.max(1000);
    if safe % 86_400_000 == 0 {
        return format!("每 {} 天", safe / 86_400_000);
    }
    if safe % 3_600_000 == 0 {
        return format!("每 {} 小时", safe / 3_600_000);
    }
    if safe % 60_000 == 0 {
        return format!("每 {} 分钟", safe / 60_000);
    }
    if safe % 1000 == 0 {
        return format!("每 {} 秒", safe / 1000);
    }
    format!("每 {} 毫秒", safe)
}

fn format_duration(duration_ms: u64) -> String {
    let safe = duration_ms.max(1000);
    if safe % 86_400_000 == 0 {
        return format!("{} 天", safe / 86_400_000);
    }
    if safe % 3_600_000 == 0 {
        return format!("{} 小时", safe / 3_600_000);
    }
    if safe % 60_000 == 0 {
        return format!("{} 分钟", safe / 60_000);
    }
    if safe % 1000 == 0 {
        return format!("{} 秒", safe / 1000);
    }
    format!("{} 毫秒", safe)
}

fn build_schedule_text(every_ms: u64, max_runs: u32) -> String {
    if max_runs > 0 {
        format!("{}，共 {} 次", format_every_ms(every_ms), max_runs)
    } else {
        format!("{}，持续运行", format_every_ms(every_ms))
    }
}

fn build_execution_prompt(
    objective: &str,
    max_runs: u32,
    report_condition: Option<&str>,
) -> String {
    let mut lines = vec![
        "你是任务执行助手。请直接执行以下任务并给出简洁结果：".to_string(),
        objective.trim().to_string(),
    ];
    lines.push(format!(
        "汇报条件：{}",
        report_condition.unwrap_or("出现异常或命中阈值时立即汇报")
    ));
    lines.push(if max_runs > 0 {
        format!("任务总执行次数上限：{} 次。达到上限后停止。", max_runs)
    } else {
        "任务总执行次数上限：无限次。".to_string()
    });
    lines.extend([
        "要求：".to_string(),
        "0) 这是已经创建好的任务的一次实际执行轮次，不是在创建任务。".to_string(),
        "1) 必须返回可读的结论。".to_string(),
        "2) 若失败，返回失败原因。".to_string(),
        "3) 不要输出额外格式包装。".to_string(),
        "4) 禁止输出“是否创建任务/请确认/确认后执行”等二次确认语句。".to_string(),
        "5) 禁止复述调度信息（如每几分钟执行一次），仅输出本次查询结果。".to_string(),
        "6) 监控/阈值类任务必须说明关键数值、阈值比较和是否触发告警。".to_string(),
        "7) 严禁再次创建、修改、发布、暂停、删除、查询任何任务或调度，不要调用 cron_create、cron_list、cron_delete、schedule_create、schedule_list、schedule_delete、任务中心或调度类工具。".to_string(),
        "8) 回复最后必须单独追加一行机器结果，格式严格如下：".to_string(),
        "<task-result>{\"status\":\"ok\",\"alert\":false,\"summary\":\"一句话总结\",\"details\":\"补充说明，可为空\"}</task-result>".to_string(),
        "9) 如果任务执行失败，把 status 改为 error，并在 summary/details 中写明失败原因。".to_string(),
        "10) 如果命中异常或阈值，把 alert 改为 true；未命中则为 false。".to_string(),
    ]);
    lines.join("\n")
}

fn default_unmatched_response() -> AnalyzeChatTaskDraftResponse {
    AnalyzeChatTaskDraftResponse {
        matched: false,
        cancelled: false,
        ready_to_confirm: false,
        draft: None,
        prompt_text: None,
        task_name: None,
        schedule_text: None,
        execution_prompt: None,
        task_card: None,
    }
}

fn build_parser_unavailable_response(
    current_draft: Option<ChatTaskDraftPayload>,
) -> AnalyzeChatTaskDraftResponse {
    let Some(draft) = current_draft else {
        return default_unmatched_response();
    };
    AnalyzeChatTaskDraftResponse {
        matched: true,
        cancelled: false,
        ready_to_confirm: false,
        draft: Some(draft),
        prompt_text: Some(
            "任务草稿解析暂时不可用，请稍后重试，或重新补充一次频率和汇报条件。".to_string(),
        ),
        task_name: None,
        schedule_text: None,
        execution_prompt: None,
        task_card: None,
    }
}

fn trim_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn parse_bool_value(value: Option<&Value>) -> Option<bool> {
    match value? {
        Value::Bool(flag) => Some(*flag),
        Value::String(text) => match text.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => Some(true),
            "false" | "0" | "no" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn parse_u64_value(value: Option<&Value>) -> Option<u64> {
    match value? {
        Value::Number(number) => number.as_u64(),
        Value::String(text) => text.trim().parse::<u64>().ok(),
        _ => None,
    }
}

fn parse_u32_value(value: Option<&Value>) -> Option<u32> {
    parse_u64_value(value).and_then(|value| u32::try_from(value).ok())
}

fn parse_string_value(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => trim_optional_string(Some(text.clone())),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

fn extract_json_object(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed);
    }
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    (start < end).then_some(&trimmed[start..=end])
}

fn parse_model_task_draft_analysis(raw: &str) -> Option<ModelTaskDraftAnalysis> {
    let json_text = extract_json_object(raw)?;
    let payload: Value = serde_json::from_str(json_text).ok()?;
    let object = payload.as_object()?;
    Some(ModelTaskDraftAnalysis {
        matched: parse_bool_value(object.get("matched")).unwrap_or(false),
        cancelled: parse_bool_value(object.get("cancelled")).unwrap_or(false),
        objective: parse_string_value(object.get("objective")),
        report_condition: parse_string_value(object.get("report_condition")),
        every_ms: parse_u64_value(object.get("every_ms")).filter(|value| *value > 0),
        max_runs: parse_u32_value(object.get("max_runs")).filter(|value| *value > 0),
        duration_ms: parse_u64_value(object.get("duration_ms")).filter(|value| *value > 0),
        prompt_text: parse_string_value(object.get("prompt_text")),
        task_name: parse_string_value(object.get("task_name")),
    })
}

fn build_model_system_prompt() -> &'static str {
    r#"你是“任务草稿解析器”。
你的职责是判断一条聊天消息，是否应该被识别为“创建任务/补充任务草稿”的输入，并提取结构化字段。

严格规则：
1. 只能输出一个 JSON 对象，禁止 Markdown、禁止代码块、禁止任何解释。
2. 如果当前没有任务草稿，只有当用户明显在表达“定时执行、周期监控、条件提醒、持续跟踪、自动汇报”这类任务意图时，matched 才能为 true。
3. 如果当前已经有任务草稿，也不能无脑拦截。像“ai”“你好”“在吗”“继续聊”“随便”这类与补充任务参数无关的话，必须返回 matched=false。
4. 如果用户明确表示取消当前任务草稿，例如“取消任务”“不建了”“先别建”，返回 matched=true、cancelled=true。
5. 如果 matched=true，请尽量提取：
   - objective: 任务要做什么
   - every_ms: 执行频率，单位毫秒
   - report_condition: 何时通知/汇报
   - duration_ms: 持续时长，单位毫秒
   - max_runs: 总执行次数上限；只有用户明确说了次数，或者语义非常明确时才填写
   - task_name: 简短任务名，可留空
   - prompt_text: 给用户展示的简短中文回复。若信息缺失，最多追问 1 到 2 个关键缺口；若已足够创建任务，可留空或只保留一句极简确认，不要套模板话。
6. ready_to_confirm 由服务端自行计算，你不用输出它。
7. 不要捏造字段；无法确定时用 null。

输出字段固定为：
{
  "matched": true,
  "cancelled": false,
  "objective": "字符串或 null",
  "report_condition": "字符串或 null",
  "every_ms": 300000,
  "duration_ms": null,
  "max_runs": null,
  "task_name": "字符串或 null",
  "prompt_text": "字符串或 null"
}"#
}

fn escape_toml_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

fn resolve_default_model_tuple() -> Option<(String, String)> {
    let models_value = assignment_store::list_model_assignments().ok()?;
    let default_id = assignment_store::get_default_model().ok().flatten()?;
    let hit = models_value
        .into_iter()
        .find(|item| item.model_id == default_id)?;
    Some((hit.provider_id, hit.model_name))
}

fn build_task_draft_parser_manifest_toml(provider: &str, model: &str) -> String {
    [
        format!(
            "name = \"{}\"",
            escape_toml_string(TASK_DRAFT_PARSER_AGENT_NAME)
        ),
        format!(
            "description = \"{}\"",
            escape_toml_string(TASK_DRAFT_PARSER_AGENT_DESCRIPTION)
        ),
        "profile = \"full\"".to_string(),
        String::new(),
        "[model]".to_string(),
        format!("provider = \"{}\"", escape_toml_string(provider)),
        format!("model = \"{}\"", escape_toml_string(model)),
        format!(
            "system_prompt = \"{}\"",
            escape_toml_string(build_model_system_prompt())
        ),
    ]
    .join("\n")
}

async fn ensure_task_draft_parser_agent(state: &Arc<AppState>) -> Option<String> {
    let cache = TASK_DRAFT_PARSER_AGENT_CACHE.get_or_init(|| Mutex::new(None));
    if let Some(cached) = cache.lock().await.clone() {
        return Some(cached);
    }

    let mut guard = cache.lock().await;
    if let Some(cached) = guard.clone() {
        return Some(cached);
    }

    let agents_payload = state.openfang.get_json("/api/agents").await.ok()?;
    let rows = agents_payload.as_array().cloned().unwrap_or_default();
    let existing_id = rows.iter().find_map(|row| {
        let name = row.get("name").and_then(Value::as_str)?.trim();
        if name != TASK_DRAFT_PARSER_AGENT_NAME {
            return None;
        }
        row.get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    });

    let agent_id = if let Some(agent_id) = existing_id {
        let _ = state
            .openfang
            .patch_json(
                &format!("/api/agents/{agent_id}/config"),
                json!({
                    "system_prompt": build_model_system_prompt(),
                    "description": TASK_DRAFT_PARSER_AGENT_DESCRIPTION,
                }),
            )
            .await;
        agent_id
    } else {
        let (provider, model) = resolve_default_model_tuple()?;
        let created = state
            .openfang
            .post_json(
                "/api/agents",
                json!({
                    "manifest_toml": build_task_draft_parser_manifest_toml(&provider, &model)
                }),
            )
            .await
            .ok()?;
        created
            .get("agent_id")
            .or_else(|| created.get("id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)?
    };

    let _ = assignment_store::set_agent_hidden(&agent_id, true);
    *guard = Some(agent_id.clone());
    Some(agent_id)
}

pub async fn warm_task_draft_parser_agent(state: &Arc<AppState>) {
    let Some(agent_id) = ensure_task_draft_parser_agent(state).await else {
        return;
    };
    let _ = analyze_chat_task_draft_via_model(
        state,
        &agent_id,
        &AnalyzeChatTaskDraftRequest {
            message: "这不是任务请求，请返回 matched=false。".to_string(),
            current_draft: None,
        },
    )
    .await;
}

fn build_model_user_prompt(message: &str, current_draft: &Option<ChatTaskDraftPayload>) -> String {
    let current_json = serde_json::to_string(current_draft).unwrap_or_else(|_| "null".to_string());
    format!(
        "请分析最新用户消息，并仅返回 JSON。\n\n当前任务草稿：{}\n\n最新用户消息：{}",
        current_json,
        serde_json::to_string(message).unwrap_or_else(|_| "\"\"".to_string())
    )
}

async fn analyze_chat_task_draft_via_model(
    state: &Arc<AppState>,
    model_ref: &str,
    request: &AnalyzeChatTaskDraftRequest,
) -> Option<ModelTaskDraftAnalysis> {
    let model_ref = model_ref.trim();
    if model_ref.is_empty() {
        return None;
    }

    let upstream_payload = json!({
        "model": model_ref,
        "messages": [
            {
                "role": "user",
                "content": build_model_user_prompt(&request.message, &request.current_draft),
            }
        ],
        "temperature": 0.1,
        "stream": false
    });
    let response = timeout(
        Duration::from_secs(20),
        state
            .openfang
            .post_json("/v1/chat/completions", upstream_payload),
    )
    .await
    .ok()?
    .ok()?;
    let content = response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|rows| rows.first())
        .and_then(|row| row.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    parse_model_task_draft_analysis(content)
}

fn build_response_from_analysis(
    request: AnalyzeChatTaskDraftRequest,
    analysis: ModelTaskDraftAnalysis,
) -> AnalyzeChatTaskDraftResponse {
    let trimmed = request.message.trim().to_string();
    let current = request.current_draft;

    if analysis.cancelled {
        return AnalyzeChatTaskDraftResponse {
            matched: true,
            cancelled: true,
            ready_to_confirm: false,
            draft: None,
            prompt_text: trim_optional_string(analysis.prompt_text)
                .or_else(|| Some("已取消当前任务草稿。".to_string())),
            task_name: None,
            schedule_text: None,
            execution_prompt: None,
            task_card: None,
        };
    }

    if !analysis.matched {
        return default_unmatched_response();
    }

    let parsed_objective = trim_optional_string(analysis.objective)
        .or_else(|| {
            current
                .as_ref()
                .and_then(|draft| trim_optional_string(draft.objective.clone()))
        })
        .or_else(|| {
            if current.is_none() {
                trim_optional_string(Some(trimmed.clone()))
            } else {
                None
            }
        });
    let report_condition = trim_optional_string(analysis.report_condition).or_else(|| {
        current
            .as_ref()
            .and_then(|draft| trim_optional_string(draft.report_condition.clone()))
    });
    let every_ms = analysis.every_ms.filter(|value| *value > 0).or_else(|| {
        current
            .as_ref()
            .and_then(|draft| draft.every_ms)
            .filter(|value| *value > 0)
    });
    let duration_ms = analysis.duration_ms.filter(|value| *value > 0).or_else(|| {
        current
            .as_ref()
            .and_then(|draft| draft.duration_ms)
            .filter(|value| *value > 0)
    });
    let explicit_max_runs = analysis.max_runs.filter(|value| *value > 0).or_else(|| {
        current
            .as_ref()
            .and_then(|draft| draft.max_runs)
            .filter(|value| *value > 0)
    });
    let max_runs = explicit_max_runs.or_else(|| {
        if let (Some(duration_ms), Some(every_ms)) = (duration_ms, every_ms) {
            Some(((duration_ms + every_ms - 1) / every_ms).max(1) as u32)
        } else {
            None
        }
    });
    let source_message_text = current
        .as_ref()
        .and_then(|draft| trim_optional_string(draft.source_message_text.clone()))
        .unwrap_or_else(|| trimmed.clone());
    let created_at = current
        .as_ref()
        .and_then(|draft| trim_optional_string(draft.created_at.clone()));

    let mut missing_slots = Vec::new();
    if parsed_objective
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
    {
        missing_slots.push("objective".to_string());
    }
    if every_ms.unwrap_or_default() == 0 {
        missing_slots.push("check_frequency".to_string());
    }
    if report_condition
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
    {
        missing_slots.push("report_condition".to_string());
    }

    let ready_to_confirm = missing_slots.is_empty();
    let schedule_text = every_ms.map(|value| build_schedule_text(value, max_runs.unwrap_or(0)));
    let draft = ChatTaskDraftPayload {
        objective: parsed_objective.clone(),
        report_condition: report_condition.clone(),
        every_ms,
        max_runs,
        duration_ms,
        schedule_text: schedule_text.clone(),
        source_message_text: Some(source_message_text.clone()),
        created_at,
        missing_slots,
        ready_to_confirm,
    };
    let prompt_text = trim_optional_string(analysis.prompt_text);
    let task_name = trim_optional_string(analysis.task_name).or_else(|| {
        parsed_objective
            .as_deref()
            .map(|value| build_task_name(value, &source_message_text))
            .or_else(|| Some(build_task_name("", &source_message_text)))
    });
    let execution_prompt = if ready_to_confirm {
        parsed_objective.as_deref().map(|value| {
            build_execution_prompt(value, max_runs.unwrap_or(0), report_condition.as_deref())
        })
    } else {
        None
    };
    let task_card = if ready_to_confirm {
        Some(build_task_card_response(
            &draft,
            task_name.as_deref(),
            execution_prompt.as_deref(),
        ))
    } else {
        None
    };

    AnalyzeChatTaskDraftResponse {
        matched: true,
        cancelled: false,
        ready_to_confirm,
        draft: Some(draft),
        prompt_text,
        task_name,
        schedule_text,
        execution_prompt,
        task_card,
    }
}

pub async fn analyze_chat_task_draft(
    state: &Arc<AppState>,
    _model_ref: &str,
    request: AnalyzeChatTaskDraftRequest,
) -> AnalyzeChatTaskDraftResponse {
    let trimmed = request.message.trim();
    if trimmed.is_empty() {
        return default_unmatched_response();
    }
    let parser_agent_id = ensure_task_draft_parser_agent(state).await;
    let model_result = if let Some(agent_id) = parser_agent_id {
        timeout(
            Duration::from_secs(24),
            analyze_chat_task_draft_via_model(state, &agent_id, &request),
        )
        .await
        .ok()
        .flatten()
    } else {
        None
    };
    if let Some(analysis) = model_result {
        return build_response_from_analysis(request, analysis);
    }
    build_parser_unavailable_response(request.current_draft)
}

fn build_task_card_schedule_segments(draft: &ChatTaskDraftPayload) -> Vec<String> {
    let mut segments = draft
        .schedule_text
        .as_deref()
        .map(|text| {
            text.split(['；', ';'])
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| {
            vec![
                draft
                    .every_ms
                    .filter(|value| *value > 0)
                    .map(format_every_ms)
                    .unwrap_or_else(|| "待补充频率".to_string()),
                if draft.max_runs.unwrap_or(0) > 0 {
                    format!("共 {} 次", draft.max_runs.unwrap_or(0))
                } else {
                    "持续运行".to_string()
                },
            ]
        });
    if let Some(duration_ms) = draft.duration_ms.filter(|value| *value > 0) {
        segments.push(format!("持续 {}", format_duration(duration_ms)));
    }
    segments
}

fn build_task_card_response(
    draft: &ChatTaskDraftPayload,
    task_name: Option<&str>,
    execution_prompt: Option<&str>,
) -> ChatTaskCardResponse {
    let now = Utc::now().to_rfc3339();
    let objective = draft
        .objective
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名任务")
        .to_string();
    let created_at = draft
        .created_at
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(now.as_str())
        .to_string();
    let updated_at = now.clone();
    let schedule_segments = build_task_card_schedule_segments(draft);
    let schedule_text = schedule_segments.join("，");
    let mut detail_segments = vec![schedule_text.clone()];
    if let Some(report_condition) = draft
        .report_condition
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        detail_segments.push(format!("汇报条件：{}", report_condition));
    }
    let timeline = vec![ChatTaskTimelineItemResponse {
        id: format!(
            "task-draft-created-{}",
            draft
                .created_at
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("now")
        ),
        kind: "created".to_string(),
        title: "已补全任务草案".to_string(),
        detail: if detail_segments.is_empty() {
            None
        } else {
            Some(detail_segments.join("；"))
        },
        at: updated_at.clone(),
        run_count: None,
        level: Some("info".to_string()),
    }];
    ChatTaskCardResponse {
        task_name: task_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("任务定时器")
            .to_string(),
        objective,
        report_condition: trim_optional_string(draft.report_condition.clone()),
        schedule_text,
        every_ms: draft.every_ms.unwrap_or(0),
        max_runs: draft.max_runs.unwrap_or(0),
        run_count: 0,
        execution_prompt: execution_prompt
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
            .to_string(),
        source_message_text: draft
            .source_message_text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
            .to_string(),
        stage: "proposal".to_string(),
        created_at,
        updated_at,
        can_create: true,
        can_cancel: true,
        can_delete: false,
        notify_on_complete: true,
        completed_notified: false,
        task_kind: "chat_schedule".to_string(),
        report_status: "pending".to_string(),
        progress_percent: 0,
        timeline,
    }
}
