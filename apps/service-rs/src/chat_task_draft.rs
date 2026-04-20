use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::time::{timeout, Duration};

use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatTaskDraftPayload {
    #[serde(default)]
    pub objective: Option<String>,
    #[serde(default, alias = "reportCondition")]
    pub report_condition: Option<String>,
    #[serde(default, alias = "everyMs")]
    pub every_ms: Option<u64>,
    #[serde(default, alias = "maxRuns")]
    pub max_runs: Option<u32>,
    #[serde(default, alias = "durationMs")]
    pub duration_ms: Option<u64>,
    #[serde(default, alias = "scheduleText")]
    pub schedule_text: Option<String>,
    #[serde(default, alias = "sourceMessageText")]
    pub source_message_text: Option<String>,
    #[serde(default, alias = "createdAt")]
    pub created_at: Option<String>,
    #[serde(default, alias = "missingSlots")]
    pub missing_slots: Vec<String>,
    #[serde(default, alias = "readyToConfirm")]
    pub ready_to_confirm: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AnalyzeChatTaskDraftRequest {
    pub message: String,
    #[serde(default)]
    pub current_draft: Option<ChatTaskDraftPayload>,
    #[serde(default)]
    pub session_messages: Vec<ChatTaskContextMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatTaskContextMessage {
    pub role: String,
    pub content: String,
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
        "1) 先像真实执行者一样理解这次轮次的任务身份、监控目标、异常标准、用户要的结果，再决定是否调用工具。".to_string(),
        "2) 必须返回可读的结论。".to_string(),
        "3) 若失败，返回失败原因。".to_string(),
        "4) 不要输出额外格式包装。".to_string(),
        "5) 禁止输出“是否创建任务/请确认/确认后执行”等二次确认语句。".to_string(),
        "6) 禁止复述调度信息（如每几分钟执行一次），仅输出本次查询结果。".to_string(),
        "7) 监控/阈值类任务必须说明关键数值、阈值比较、与上一轮相比是否有变化、变化方向或幅度、是否命中汇报条件，以及为什么触发或未触发告警。".to_string(),
        "8) 严禁再次创建、修改、发布、暂停、删除、查询任何任务或调度，不要调用 cron_create、cron_list、cron_delete、schedule_create、schedule_list、schedule_delete、任务中心或调度类工具。".to_string(),
        "9) 回复最后必须单独追加一行机器结果，格式严格如下：".to_string(),
        "<task-result>{\"status\":\"ok\",\"alert\":false,\"summary\":\"一句话总结\",\"details\":\"补充说明，可为空\"}</task-result>".to_string(),
        "10) 如果任务执行失败，把 status 改为 error，并在 summary/details 中写明失败原因。".to_string(),
        "11) 如果命中异常或阈值，把 alert 改为 true；未命中则为 false。".to_string(),
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

fn build_analysis_unavailable_response(
    draft: Option<ChatTaskDraftPayload>,
) -> AnalyzeChatTaskDraftResponse {
    let Some(draft) = draft else {
        return default_unmatched_response();
    };
    AnalyzeChatTaskDraftResponse {
        matched: true,
        cancelled: false,
        ready_to_confirm: false,
        draft: Some(draft),
        prompt_text: Some(
            "当前智能体的任务草案分析暂时不可用，本次没有生成任务卡。请稍后重试，或重新补充一次任务要求。"
                .to_string(),
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

async fn current_task_draft_analysis_session_id(
    state: &Arc<AppState>,
    agent_id: &str,
) -> Option<String> {
    state
        .openfang
        .get_json(&format!("/api/agents/{agent_id}/session"))
        .await
        .ok()?
        .get("session_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

async fn create_task_draft_analysis_request_session(
    state: &Arc<AppState>,
    agent_id: &str,
) -> Result<(Option<String>, String), String> {
    let original_session_id = current_task_draft_analysis_session_id(state, agent_id).await;
    let request_session_id = state
        .openfang
        .post_json(&format!("/api/agents/{agent_id}/sessions"), json!({}))
        .await
        .map_err(|err| format!("create analysis session failed: {}", err.message))?
        .get("session_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "create analysis session returned empty session_id".to_string())?;
    state
        .openfang
        .post_json(
            &format!("/api/agents/{agent_id}/sessions/{request_session_id}/switch"),
            json!({}),
        )
        .await
        .map_err(|err| format!("switch analysis session failed: {}", err.message))?;
    Ok((original_session_id, request_session_id))
}

async fn cleanup_task_draft_analysis_request_session(
    state: &Arc<AppState>,
    agent_id: &str,
    original_session_id: Option<&str>,
    request_session_id: &str,
) {
    if let Some(original_session_id) = original_session_id
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != request_session_id)
    {
        let _ = state
            .openfang
            .post_json(
                &format!("/api/agents/{agent_id}/sessions/{original_session_id}/switch"),
                json!({}),
            )
            .await;
    }
    let _ = state
        .openfang
        .delete_json(&format!("/api/sessions/{request_session_id}"))
        .await;
}

fn build_model_user_prompt_with_context(
    message: &str,
    current_draft: &Option<ChatTaskDraftPayload>,
    session_messages: &[ChatTaskContextMessage],
) -> String {
    let current_json = serde_json::to_string(current_draft).unwrap_or_else(|_| "null".to_string());
    let session_json = serde_json::to_string(session_messages).unwrap_or_else(|_| "[]".to_string());
    let transcript = session_messages
        .iter()
        .map(|item| {
            format!(
                "{}: {}",
                item.role.trim(),
                item.content
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "你正在作为当前聊天智能体本人，分析这条消息是否是在创建或补充聊天任务草案。你只能返回一个 JSON 对象，禁止 Markdown、禁止代码块、禁止解释。\n\n规则：\n1. 必须优先做语义理解，不能只看关键词。\n2. 如果当前没有任务草稿，只有当用户真的在表达定时执行、周期监控、条件提醒、持续跟踪、自动汇报这类任务意图时，matched 才能为 true。\n3. 如果当前已经有任务草稿，也不能无脑拦截。像“ai”“你好”“在吗”“继续聊”“随便”这类与补充任务参数无关的话，必须返回 matched=false。\n4. 如果最近会话已经明确了监控对象或目标，而最新消息只是在补充频率、持续时间、汇报方式、取消等信息，你应当结合上下文补全 objective，而不是返回 unmatched。\n5. 如果最近会话已经明确说过频率、持续时间、总次数、汇报方式，而最新消息只是“开始”“就按这个来”“照刚才那个执行”“开始盯 BTC 价格”这类触发语，你必须复用上下文里已经明确过的参数。\n6. 如果用户明确表示取消当前任务草稿，例如“取消任务”“不建了”“先别建”，返回 matched=true、cancelled=true。\n7. 普通问答、寒暄、追问看法，即使上下文里刚聊过任务，也必须返回 matched=false，除非这条最新消息本身明确是在补充任务参数或确认执行。\n8. 如果 matched=true，请尽量提取 objective、every_ms、report_condition、duration_ms、max_runs、task_name、prompt_text。\n9. 若信息缺失，prompt_text 必须由你自己用自然中文追问 1 到 2 个关键缺口，不要套模板话。\n10. ready_to_confirm 由服务端自行计算，你不用输出。\n11. 不要捏造字段；无法确定时用 null。\n\n输出字段固定为：\n{{\"matched\":true,\"cancelled\":false,\"objective\":\"字符串或 null\",\"report_condition\":\"字符串或 null\",\"every_ms\":300000,\"duration_ms\":null,\"max_runs\":null,\"task_name\":\"字符串或 null\",\"prompt_text\":\"字符串或 null\"}}\n\n当前任务草稿：{}\n\n最近会话上下文(JSON)：{}\n\n最近会话上下文(按时间顺序转写)：\n{}\n\n最新用户消息：{}\n\n注意：如果最新消息本身没有频率或时长，但最近上下文已经明确过，请直接复用上下文参数，不要重复追问。",
        current_json,
        session_json,
        transcript,
        serde_json::to_string(message).unwrap_or_else(|_| "\"\"".to_string())
    )
}

async fn analyze_chat_task_draft_via_model(
    state: &Arc<AppState>,
    agent_id: &str,
    request: &AnalyzeChatTaskDraftRequest,
) -> Result<ModelTaskDraftAnalysis, String> {
    let agent_id = agent_id.trim();
    if agent_id.is_empty() {
        return Err("empty agent_id".to_string());
    }
    let (original_session_id, request_session_id) =
        create_task_draft_analysis_request_session(state, agent_id).await?;
    let upstream_payload = json!({
        "message": build_model_user_prompt_with_context(
            &request.message,
            &request.current_draft,
            &request.session_messages,
        )
    });
    let response = timeout(
        Duration::from_secs(20),
        state
            .openfang
            .post_json(&format!("/api/agents/{agent_id}/message"), upstream_payload),
    )
    .await
    .map_err(|_| "analysis request timed out".to_string())?;
    cleanup_task_draft_analysis_request_session(
        state,
        agent_id,
        original_session_id.as_deref(),
        &request_session_id,
    )
    .await;
    let response = response.map_err(|err| format!("analysis request failed: {}", err.message))?;
    let content = response
        .get("response")
        .or_else(|| response.get("content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "analysis response content is empty".to_string())?;
    parse_model_task_draft_analysis(content).ok_or_else(|| {
        let snippet = content.chars().take(240).collect::<String>();
        format!(
            "analysis response is not valid task draft JSON: {}",
            snippet
        )
    })
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

    let parsed_objective = trim_optional_string(analysis.objective).or_else(|| {
        current
            .as_ref()
            .and_then(|draft| trim_optional_string(draft.objective.clone()))
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
    if !ready_to_confirm && prompt_text.is_none() {
        return build_analysis_unavailable_response(Some(draft));
    }

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
    agent_id: &str,
    request: AnalyzeChatTaskDraftRequest,
) -> AnalyzeChatTaskDraftResponse {
    let trimmed = request.message.trim();
    if trimmed.is_empty() {
        return default_unmatched_response();
    }
    let current_draft = request.current_draft.clone();
    let model_result = timeout(
        Duration::from_secs(24),
        analyze_chat_task_draft_via_model(state, agent_id, &request),
    )
    .await;
    match model_result {
        Ok(Ok(analysis)) => build_response_from_analysis(request, analysis),
        Ok(Err(error)) => {
            tracing::warn!(
                agent_id = %agent_id,
                error = %error,
                "chat task draft analysis failed"
            );
            build_analysis_unavailable_response(current_draft)
        }
        Err(_) => {
            tracing::warn!(
                agent_id = %agent_id,
                "chat task draft analysis timed out"
            );
            build_analysis_unavailable_response(current_draft)
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_current_draft() -> ChatTaskDraftPayload {
        ChatTaskDraftPayload {
            objective: Some("监控比特币价格".to_string()),
            report_condition: Some("执行后立刻汇报".to_string()),
            every_ms: Some(60_000),
            max_runs: Some(5),
            duration_ms: None,
            schedule_text: Some("每 1 分钟，共 5 次".to_string()),
            source_message_text: Some("帮我盯下比特币价格".to_string()),
            created_at: Some("2026-04-06T00:00:00Z".to_string()),
            missing_slots: Vec::new(),
            ready_to_confirm: true,
        }
    }

    #[test]
    fn matched_false_no_longer_force_uses_existing_draft() {
        let request = AnalyzeChatTaskDraftRequest {
            message: "我觉得现在行情怎么看".to_string(),
            current_draft: Some(sample_current_draft()),
            session_messages: Vec::new(),
        };
        let response = build_response_from_analysis(
            request,
            ModelTaskDraftAnalysis {
                matched: false,
                ..ModelTaskDraftAnalysis::default()
            },
        );

        assert!(!response.matched);
        assert!(response.draft.is_none());
        assert!(response.task_card.is_none());
    }

    #[test]
    fn missing_prompt_text_falls_back_to_analysis_unavailable_notice() {
        let request = AnalyzeChatTaskDraftRequest {
            message: "帮我盯下比特币价格".to_string(),
            current_draft: None,
            session_messages: Vec::new(),
        };
        let response = build_response_from_analysis(
            request,
            ModelTaskDraftAnalysis {
                matched: true,
                objective: Some("监控比特币价格".to_string()),
                report_condition: Some("执行后立刻汇报".to_string()),
                ..ModelTaskDraftAnalysis::default()
            },
        );

        assert!(response.matched);
        assert!(!response.ready_to_confirm);
        assert!(response.task_card.is_none());
        assert_eq!(
            response.prompt_text.as_deref(),
            Some("当前智能体的任务草案分析暂时不可用，本次没有生成任务卡。请稍后重试，或重新补充一次任务要求。")
        );
    }
}
