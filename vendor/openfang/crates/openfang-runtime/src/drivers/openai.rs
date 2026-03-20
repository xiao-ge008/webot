//! OpenAI-compatible API driver.
//!
//! Works with OpenAI, Ollama, vLLM, and any other OpenAI-compatible endpoint.

use crate::llm_driver::{CompletionRequest, CompletionResponse, LlmDriver, LlmError, StreamEvent};
use crate::think_filter::{FilterAction, StreamingThinkFilter};
use async_trait::async_trait;
use futures::StreamExt;
use openfang_types::message::{ContentBlock, MessageContent, Role, StopReason, TokenUsage};
use openfang_types::tool::ToolCall;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::{debug, warn};
use zeroize::Zeroizing;

/// OpenAI-compatible API driver.
pub struct OpenAIDriver {
    api_key: Zeroizing<String>,
    base_url: String,
    client: reqwest::Client,
    extra_headers: Vec<(String, String)>,
}

impl OpenAIDriver {
    /// Create a new OpenAI-compatible driver.
    pub fn new(api_key: String, base_url: String) -> Self {
        Self {
            api_key: Zeroizing::new(api_key),
            base_url,
            client: reqwest::Client::builder()
                .user_agent(crate::USER_AGENT)
                .build()
                .unwrap_or_default(),
            extra_headers: Vec::new(),
        }
    }

    /// Moonshot/Kimi 一类模型在多轮 tool_call 场景下要求显式处理 reasoning 内容。
    fn kimi_needs_reasoning_content(&self, model: &str) -> bool {
        self.base_url.contains("moonshot") || model.to_lowercase().contains("kimi")
    }

    /// Create a driver with additional HTTP headers (e.g. for Copilot IDE auth).
    pub fn with_extra_headers(mut self, headers: Vec<(String, String)>) -> Self {
        self.extra_headers = headers;
        self
    }
}

#[derive(Debug, Serialize)]
struct OaiRequest {
    model: String,
    messages: Vec<OaiMessage>,
    /// Classic token limit field (used by most models).
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    /// New token limit field required by GPT-5 and o-series reasoning models.
    #[serde(skip_serializing_if = "Option::is_none")]
    max_completion_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<OaiTool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_options: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<serde_json::Value>,
}

/// Returns true if a model uses `max_completion_tokens` instead of `max_tokens`.
fn uses_completion_tokens(model: &str) -> bool {
    let m = model.to_lowercase();
    m.starts_with("gpt-5")
        || m.starts_with("gpt5")
        || m.starts_with("o1")
        || m.starts_with("o3")
        || m.starts_with("o4")
}

/// OpenAI o 系列、部分 reasoning 模型会拒绝 temperature 参数。
fn rejects_temperature(model: &str) -> bool {
    let m = model.to_lowercase();
    m.starts_with("o1")
        || m.starts_with("o3")
        || m.starts_with("o4")
        || m.starts_with("gpt-5-mini")
        || m.starts_with("gpt5-mini")
        || m.contains("-reasoning")
}

/// Kimi K2/K2.5 等模型只接受 temperature = 1。
fn temperature_must_be_one(model: &str) -> bool {
    let m = model.to_lowercase();
    m.starts_with("kimi-k2") || m == "kimi-k2.5" || m == "kimi-k2.5-0711"
}

/// Merge a streamed tool/function name chunk without letting later empty deltas
/// erase an earlier valid name.
fn merge_streamed_tool_name(current: &mut String, delta: &str) -> bool {
    if delta.is_empty() {
        return false;
    }

    let was_empty = current.is_empty();
    if was_empty {
        current.push_str(delta);
        return true;
    }

    if current == delta || current.ends_with(delta) {
        return false;
    }

    if delta.starts_with(current.as_str()) {
        current.clear();
        current.push_str(delta);
        return false;
    }

    let max_overlap = current.len().min(delta.len());
    let overlap = (1..=max_overlap)
        .rev()
        .find(|&len| current.ends_with(&delta[..len]))
        .unwrap_or(0);
    current.push_str(&delta[overlap..]);
    false
}

#[derive(Debug, Serialize)]
struct OaiMessage {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<OaiMessageContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<OaiToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_content: Option<String>,
}

/// Content can be a plain string or an array of content parts (for images).
#[derive(Debug, Serialize)]
#[serde(untagged)]
enum OaiMessageContent {
    Text(String),
    Parts(Vec<OaiContentPart>),
}

/// A content part for multi-modal messages.
#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum OaiContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: OaiImageUrl },
}

#[derive(Debug, Serialize)]
struct OaiImageUrl {
    url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct OaiToolCall {
    id: String,
    #[serde(rename = "type")]
    call_type: String,
    function: OaiFunction,
}

#[derive(Debug, Serialize, Deserialize)]
struct OaiFunction {
    name: String,
    arguments: String,
}

#[derive(Debug, Serialize)]
struct OaiTool {
    #[serde(rename = "type")]
    tool_type: String,
    function: OaiToolDef,
}

#[derive(Debug, Serialize)]
struct OaiToolDef {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct OaiResponse {
    choices: Vec<OaiChoice>,
    usage: Option<OaiUsage>,
}

#[derive(Debug, Deserialize)]
struct OaiChoice {
    message: OaiResponseMessage,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OaiResponseMessage {
    content: Option<String>,
    tool_calls: Option<Vec<OaiToolCall>>,
    reasoning_content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OaiUsage {
    prompt_tokens: u64,
    completion_tokens: u64,
}

#[async_trait]
impl LlmDriver for OpenAIDriver {
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, LlmError> {
        let mut oai_messages: Vec<OaiMessage> = Vec::new();
        let mut tool_name_by_call_id: HashMap<String, String> = HashMap::new();

        // Add system message if present
        if let Some(ref system) = request.system {
            oai_messages.push(OaiMessage {
                role: "system".to_string(),
                content: Some(OaiMessageContent::Text(system.clone())),
                name: None,
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            });
        }

        // Convert messages
        for msg in &request.messages {
            match (&msg.role, &msg.content) {
                (Role::System, MessageContent::Text(text)) => {
                    if request.system.is_none() {
                        oai_messages.push(OaiMessage {
                            role: "system".to_string(),
                            content: Some(OaiMessageContent::Text(text.clone())),
                            name: None,
                            tool_calls: None,
                            tool_call_id: None,
                            reasoning_content: None,
                        });
                    }
                }
                (Role::User, MessageContent::Text(text)) => {
                    oai_messages.push(OaiMessage {
                        role: "user".to_string(),
                        content: Some(OaiMessageContent::Text(text.clone())),
                        name: None,
                        tool_calls: None,
                        tool_call_id: None,
                        reasoning_content: None,
                    });
                }
                (Role::Assistant, MessageContent::Text(text)) => {
                    oai_messages.push(OaiMessage {
                        role: "assistant".to_string(),
                        content: Some(OaiMessageContent::Text(text.clone())),
                        name: None,
                        tool_calls: None,
                        tool_call_id: None,
                        reasoning_content: None,
                    });
                }
                (Role::User, MessageContent::Blocks(blocks)) => {
                    // Handle tool results and images in user messages
                    let mut parts: Vec<OaiContentPart> = Vec::new();
                    let mut has_tool_results = false;
                    for block in blocks {
                        match block {
                            ContentBlock::ToolResult {
                                tool_use_id,
                                tool_name,
                                content,
                                ..
                            } => {
                                has_tool_results = true;
                                let resolved_tool_name = if tool_name.trim().is_empty() {
                                    tool_name_by_call_id.get(tool_use_id).cloned()
                                } else {
                                    Some(tool_name.clone())
                                };
                                oai_messages.push(OaiMessage {
                                    role: "tool".to_string(),
                                    content: Some(OaiMessageContent::Text(if content.is_empty() {
                                        "(empty)".to_string()
                                    } else {
                                        content.clone()
                                    })),
                                    name: resolved_tool_name,
                                    tool_calls: None,
                                    tool_call_id: Some(tool_use_id.clone()),
                                    reasoning_content: None,
                                });
                            }
                            ContentBlock::Text { text } => {
                                parts.push(OaiContentPart::Text { text: text.clone() });
                            }
                            ContentBlock::Image { media_type, data } => {
                                parts.push(OaiContentPart::ImageUrl {
                                    image_url: OaiImageUrl {
                                        url: format!("data:{media_type};base64,{data}"),
                                    },
                                });
                            }
                            ContentBlock::Thinking { .. } => {}
                            _ => {}
                        }
                    }
                    if !parts.is_empty() && !has_tool_results {
                        oai_messages.push(OaiMessage {
                            role: "user".to_string(),
                            content: Some(OaiMessageContent::Parts(parts)),
                            name: None,
                            tool_calls: None,
                            tool_call_id: None,
                            reasoning_content: None,
                        });
                    }
                }
                (Role::Assistant, MessageContent::Blocks(blocks)) => {
                    let mut text_parts = Vec::new();
                    let mut tool_calls = Vec::new();
                    for block in blocks {
                        match block {
                            ContentBlock::Text { text } => text_parts.push(text.clone()),
                            ContentBlock::ToolUse { id, name, input } => {
                                tool_name_by_call_id.insert(id.clone(), name.clone());
                                tool_calls.push(OaiToolCall {
                                    id: id.clone(),
                                    call_type: "function".to_string(),
                                    function: OaiFunction {
                                        name: name.clone(),
                                        arguments: serde_json::to_string(input).unwrap_or_default(),
                                    },
                                });
                            }
                            ContentBlock::Thinking { .. } => {}
                            _ => {}
                        }
                    }
                    let has_tool_calls = !tool_calls.is_empty();
                    oai_messages.push(OaiMessage {
                        role: "assistant".to_string(),
                        content: if text_parts.is_empty() {
                            if has_tool_calls {
                                Some(OaiMessageContent::Text(String::new()))
                            } else {
                                None
                            }
                        } else {
                            Some(OaiMessageContent::Text(text_parts.join("")))
                        },
                        tool_calls: if tool_calls.is_empty() {
                            None
                        } else {
                            Some(tool_calls)
                        },
                        name: None,
                        tool_call_id: None,
                        reasoning_content: if has_tool_calls
                            && self.kimi_needs_reasoning_content(&request.model)
                        {
                            Some(String::new())
                        } else {
                            None
                        },
                    });
                }
                _ => {}
            }
        }

        let oai_tools: Vec<OaiTool> = request
            .tools
            .iter()
            .map(|t| OaiTool {
                tool_type: "function".to_string(),
                function: OaiToolDef {
                    name: t.name.clone(),
                    description: t.description.clone(),
                    parameters: openfang_types::tool::normalize_schema_for_provider(
                        &t.input_schema,
                        "openai",
                    ),
                },
            })
            .collect();

        let tool_choice = if oai_tools.is_empty() {
            None
        } else {
            Some(serde_json::json!("auto"))
        };

        let (mt, mct) = if uses_completion_tokens(&request.model) {
            (None, Some(request.max_tokens))
        } else {
            (Some(request.max_tokens), None)
        };
        let mut oai_request = OaiRequest {
            model: request.model.clone(),
            messages: oai_messages,
            max_tokens: mt,
            max_completion_tokens: mct,
            temperature: if self.kimi_needs_reasoning_content(&request.model) {
                Some(0.6)
            } else if temperature_must_be_one(&request.model) {
                Some(1.0)
            } else if rejects_temperature(&request.model) {
                None
            } else {
                Some(request.temperature)
            },
            tools: oai_tools,
            tool_choice,
            stream: false,
            stream_options: None,
            thinking: if self.kimi_needs_reasoning_content(&request.model) {
                Some(serde_json::json!({"type": "disabled"}))
            } else {
                None
            },
        };

        let max_retries = 3;
        for attempt in 0..=max_retries {
            let url = format!("{}/chat/completions", self.base_url);
            debug!(url = %url, attempt, "Sending OpenAI API request");

            let mut req_builder = self
                .client
                .post(&url)
                .header("content-type", "application/json")
                .json(&oai_request);

            if !self.api_key.as_str().is_empty() {
                req_builder = req_builder
                    .header("authorization", format!("Bearer {}", self.api_key.as_str()));
            }
            for (k, v) in &self.extra_headers {
                req_builder = req_builder.header(k, v);
            }

            let resp = req_builder
                .send()
                .await
                .map_err(|e| LlmError::Http(e.to_string()))?;

            let status = resp.status().as_u16();
            if status == 429 {
                if attempt < max_retries {
                    let retry_ms = (attempt + 1) as u64 * 2000;
                    warn!(status, retry_ms, "Rate limited, retrying");
                    tokio::time::sleep(std::time::Duration::from_millis(retry_ms)).await;
                    continue;
                }
                return Err(LlmError::RateLimited {
                    retry_after_ms: 5000,
                });
            }

            if !resp.status().is_success() {
                let body = resp.text().await.unwrap_or_default();

                // Groq "tool_use_failed": model generated tool call in XML format.
                // Parse the failed_generation and convert to a proper tool call response.
                if status == 400 && body.contains("tool_use_failed") {
                    if let Some(response) = parse_groq_failed_tool_call(&body) {
                        warn!("Recovered tool call from Groq failed_generation");
                        return Ok(response);
                    }
                    // If parsing fails, retry on next attempt
                    if attempt < max_retries {
                        let retry_ms = (attempt + 1) as u64 * 1500;
                        warn!(status, attempt, retry_ms, "tool_use_failed, retrying");
                        tokio::time::sleep(std::time::Duration::from_millis(retry_ms)).await;
                        continue;
                    }
                }

                if status == 400
                    && body.contains("temperature")
                    && body.contains("unsupported_parameter")
                    && oai_request.temperature.is_some()
                    && attempt < max_retries
                {
                    warn!(model = %oai_request.model, "Stripping temperature for this model");
                    oai_request.temperature = None;
                    continue;
                }

                // GPT-5 / o-series: switch from max_tokens to max_completion_tokens
                if status == 400
                    && body.contains("max_tokens")
                    && (body.contains("unsupported_parameter")
                        || body.contains("max_completion_tokens"))
                    && oai_request.max_tokens.is_some()
                    && attempt < max_retries
                {
                    let val = oai_request.max_tokens.unwrap();
                    warn!(model = %oai_request.model, "Switching to max_completion_tokens for this model");
                    oai_request.max_tokens = None;
                    oai_request.max_completion_tokens = Some(val);
                    continue;
                }

                // Auto-cap max_tokens when model rejects our value (e.g. Groq Maverick limit 8192)
                if status == 400 && body.contains("max_tokens") && attempt < max_retries {
                    let current = oai_request
                        .max_tokens
                        .or(oai_request.max_completion_tokens)
                        .unwrap_or(4096);
                    let cap = extract_max_tokens_limit(&body).unwrap_or(current / 2);
                    warn!(
                        old = current,
                        new = cap,
                        "Auto-capping max_tokens to model limit"
                    );
                    if oai_request.max_completion_tokens.is_some() {
                        oai_request.max_completion_tokens = Some(cap);
                    } else {
                        oai_request.max_tokens = Some(cap);
                    }
                    continue;
                }

                // Model doesn't support function calling — retry without tools
                // (e.g. GLM-5 on DashScope returns 500 "internal error" when tools are sent)
                let body_lower = body.to_lowercase();
                if !oai_request.tools.is_empty()
                    && attempt < max_retries
                    && (status == 500
                        || body_lower.contains("internal error")
                        || (status == 400
                            && (body_lower.contains("does not support tools")
                                || body_lower.contains("tool")
                                    && body_lower.contains("not supported"))))
                {
                    warn!(
                        model = %oai_request.model,
                        status,
                        "Model may not support tools, retrying without tools"
                    );
                    oai_request.tools.clear();
                    oai_request.tool_choice = None;
                    continue;
                }

                return Err(LlmError::Api {
                    status,
                    message: body,
                });
            }

            let body = resp
                .text()
                .await
                .map_err(|e| LlmError::Http(e.to_string()))?;
            let oai_response: OaiResponse =
                serde_json::from_str(&body).map_err(|e| LlmError::Parse(e.to_string()))?;

            let choice = oai_response
                .choices
                .into_iter()
                .next()
                .ok_or_else(|| LlmError::Parse("No choices in response".to_string()))?;

            let mut content = Vec::new();
            let mut tool_calls = Vec::new();

            if let Some(ref reasoning) = choice.message.reasoning_content {
                if !reasoning.is_empty() {
                    debug!(
                        len = reasoning.len(),
                        "Captured reasoning_content from response"
                    );
                    content.push(ContentBlock::Thinking {
                        thinking: reasoning.clone(),
                    });
                }
            }

            if let Some(text) = choice.message.content {
                if !text.is_empty() {
                    let (cleaned, thinking) = extract_think_tags(&text);
                    if let Some(think_text) = thinking {
                        if choice.message.reasoning_content.is_none() {
                            content.push(ContentBlock::Thinking {
                                thinking: think_text,
                            });
                        }
                    }
                    if !cleaned.is_empty() {
                        content.push(ContentBlock::Text { text: cleaned });
                    }
                }
            }

            let has_text = content
                .iter()
                .any(|block| matches!(block, ContentBlock::Text { .. }));
            let has_thinking = content
                .iter()
                .any(|block| matches!(block, ContentBlock::Thinking { .. }));
            if has_thinking && !has_text && choice.message.tool_calls.is_none() {
                let thinking_text = content
                    .iter()
                    .find_map(|block| match block {
                        ContentBlock::Thinking { thinking } => Some(thinking.as_str()),
                        _ => None,
                    })
                    .unwrap_or("");
                content.push(ContentBlock::Text {
                    text: extract_thinking_summary(thinking_text),
                });
            }

            if let Some(calls) = choice.message.tool_calls {
                for call in calls {
                    let input: serde_json::Value =
                        serde_json::from_str(&call.function.arguments).unwrap_or_default();
                    content.push(ContentBlock::ToolUse {
                        id: call.id.clone(),
                        name: call.function.name.clone(),
                        input: input.clone(),
                    });
                    tool_calls.push(ToolCall {
                        id: call.id,
                        name: call.function.name,
                        input,
                    });
                }
            }

            let stop_reason = match choice.finish_reason.as_deref() {
                Some("stop") => StopReason::EndTurn,
                Some("tool_calls") => StopReason::ToolUse,
                Some("length") => StopReason::MaxTokens,
                _ => {
                    if !tool_calls.is_empty() {
                        StopReason::ToolUse
                    } else {
                        StopReason::EndTurn
                    }
                }
            };

            let usage = oai_response
                .usage
                .map(|u| TokenUsage {
                    input_tokens: u.prompt_tokens,
                    output_tokens: u.completion_tokens,
                })
                .unwrap_or_default();

            let usage =
                if !content.is_empty() && usage.input_tokens == 0 && usage.output_tokens == 0 {
                    let mut synthetic = usage;
                    synthetic.output_tokens = 1;
                    synthetic
                } else {
                    usage
                };

            return Ok(CompletionResponse {
                content,
                stop_reason,
                tool_calls,
                usage,
            });
        }

        Err(LlmError::Api {
            status: 0,
            message: "Max retries exceeded".to_string(),
        })
    }

    async fn stream(
        &self,
        request: CompletionRequest,
        tx: tokio::sync::mpsc::Sender<StreamEvent>,
    ) -> Result<CompletionResponse, LlmError> {
        // Build request (same as complete but with stream: true)
        let mut oai_messages: Vec<OaiMessage> = Vec::new();
        let mut tool_name_by_call_id: HashMap<String, String> = HashMap::new();

        if let Some(ref system) = request.system {
            oai_messages.push(OaiMessage {
                role: "system".to_string(),
                content: Some(OaiMessageContent::Text(system.clone())),
                name: None,
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            });
        }

        for msg in &request.messages {
            match (&msg.role, &msg.content) {
                (Role::System, MessageContent::Text(text)) => {
                    if request.system.is_none() {
                        oai_messages.push(OaiMessage {
                            role: "system".to_string(),
                            content: Some(OaiMessageContent::Text(text.clone())),
                            name: None,
                            tool_calls: None,
                            tool_call_id: None,
                            reasoning_content: None,
                        });
                    }
                }
                (Role::User, MessageContent::Text(text)) => {
                    oai_messages.push(OaiMessage {
                        role: "user".to_string(),
                        content: Some(OaiMessageContent::Text(text.clone())),
                        name: None,
                        tool_calls: None,
                        tool_call_id: None,
                        reasoning_content: None,
                    });
                }
                (Role::Assistant, MessageContent::Text(text)) => {
                    oai_messages.push(OaiMessage {
                        role: "assistant".to_string(),
                        content: Some(OaiMessageContent::Text(text.clone())),
                        name: None,
                        tool_calls: None,
                        tool_call_id: None,
                        reasoning_content: None,
                    });
                }
                (Role::User, MessageContent::Blocks(blocks)) => {
                    for block in blocks {
                        if let ContentBlock::ToolResult {
                            tool_use_id,
                            tool_name,
                            content,
                            ..
                        } = block
                        {
                            let resolved_tool_name = if tool_name.trim().is_empty() {
                                tool_name_by_call_id.get(tool_use_id).cloned()
                            } else {
                                Some(tool_name.clone())
                            };
                            oai_messages.push(OaiMessage {
                                role: "tool".to_string(),
                                content: Some(OaiMessageContent::Text(if content.is_empty() {
                                    "(empty)".to_string()
                                } else {
                                    content.clone()
                                })),
                                name: resolved_tool_name,
                                tool_calls: None,
                                tool_call_id: Some(tool_use_id.clone()),
                                reasoning_content: None,
                            });
                        }
                    }
                }
                (Role::Assistant, MessageContent::Blocks(blocks)) => {
                    let mut text_parts = Vec::new();
                    let mut tool_calls_out = Vec::new();
                    for block in blocks {
                        match block {
                            ContentBlock::Text { text } => text_parts.push(text.clone()),
                            ContentBlock::ToolUse { id, name, input } => {
                                tool_name_by_call_id.insert(id.clone(), name.clone());
                                tool_calls_out.push(OaiToolCall {
                                    id: id.clone(),
                                    call_type: "function".to_string(),
                                    function: OaiFunction {
                                        name: name.clone(),
                                        arguments: serde_json::to_string(input).unwrap_or_default(),
                                    },
                                });
                            }
                            ContentBlock::Thinking { .. } => {}
                            _ => {}
                        }
                    }
                    let has_tool_calls = !tool_calls_out.is_empty();
                    oai_messages.push(OaiMessage {
                        role: "assistant".to_string(),
                        content: if text_parts.is_empty() {
                            if has_tool_calls {
                                Some(OaiMessageContent::Text(String::new()))
                            } else {
                                None
                            }
                        } else {
                            Some(OaiMessageContent::Text(text_parts.join("")))
                        },
                        tool_calls: if tool_calls_out.is_empty() {
                            None
                        } else {
                            Some(tool_calls_out)
                        },
                        name: None,
                        tool_call_id: None,
                        reasoning_content: if has_tool_calls
                            && self.kimi_needs_reasoning_content(&request.model)
                        {
                            Some(String::new())
                        } else {
                            None
                        },
                    });
                }
                _ => {}
            }
        }

        let oai_tools: Vec<OaiTool> = request
            .tools
            .iter()
            .map(|t| OaiTool {
                tool_type: "function".to_string(),
                function: OaiToolDef {
                    name: t.name.clone(),
                    description: t.description.clone(),
                    parameters: openfang_types::tool::normalize_schema_for_provider(
                        &t.input_schema,
                        "openai",
                    ),
                },
            })
            .collect();

        let tool_choice = if oai_tools.is_empty() {
            None
        } else {
            Some(serde_json::json!("auto"))
        };

        let (mt, mct) = if uses_completion_tokens(&request.model) {
            (None, Some(request.max_tokens))
        } else {
            (Some(request.max_tokens), None)
        };
        let mut oai_request = OaiRequest {
            model: request.model.clone(),
            messages: oai_messages,
            max_tokens: mt,
            max_completion_tokens: mct,
            temperature: if self.kimi_needs_reasoning_content(&request.model) {
                Some(0.6)
            } else if temperature_must_be_one(&request.model) {
                Some(1.0)
            } else if rejects_temperature(&request.model) {
                None
            } else {
                Some(request.temperature)
            },
            tools: oai_tools,
            tool_choice,
            stream: true,
            stream_options: Some(serde_json::json!({"include_usage": true})),
            thinking: if self.kimi_needs_reasoning_content(&request.model) {
                Some(serde_json::json!({"type": "disabled"}))
            } else {
                None
            },
        };

        // Retry loop for the initial HTTP request
        let max_retries = 3;
        for attempt in 0..=max_retries {
            let url = format!("{}/chat/completions", self.base_url);
            debug!(url = %url, attempt, "Sending OpenAI streaming request");

            let mut req_builder = self
                .client
                .post(&url)
                .header("content-type", "application/json")
                .json(&oai_request);

            if !self.api_key.as_str().is_empty() {
                req_builder = req_builder
                    .header("authorization", format!("Bearer {}", self.api_key.as_str()));
            }
            for (k, v) in &self.extra_headers {
                req_builder = req_builder.header(k, v);
            }

            let resp = req_builder
                .send()
                .await
                .map_err(|e| LlmError::Http(e.to_string()))?;

            let status = resp.status().as_u16();
            if status == 429 {
                if attempt < max_retries {
                    let retry_ms = (attempt + 1) as u64 * 2000;
                    warn!(status, retry_ms, "Rate limited (stream), retrying");
                    tokio::time::sleep(std::time::Duration::from_millis(retry_ms)).await;
                    continue;
                }
                return Err(LlmError::RateLimited {
                    retry_after_ms: 5000,
                });
            }

            if !resp.status().is_success() {
                let body = resp.text().await.unwrap_or_default();

                // Groq "tool_use_failed": parse and recover (streaming path)
                if status == 400 && body.contains("tool_use_failed") {
                    if let Some(response) = parse_groq_failed_tool_call(&body) {
                        warn!("Recovered tool call from Groq failed_generation (stream)");
                        return Ok(response);
                    }
                    if attempt < max_retries {
                        let retry_ms = (attempt + 1) as u64 * 1500;
                        warn!(
                            status,
                            attempt, retry_ms, "tool_use_failed (stream), retrying"
                        );
                        tokio::time::sleep(std::time::Duration::from_millis(retry_ms)).await;
                        continue;
                    }
                }

                if status == 400
                    && body.contains("temperature")
                    && body.contains("unsupported_parameter")
                    && oai_request.temperature.is_some()
                    && attempt < max_retries
                {
                    warn!(
                        model = %oai_request.model,
                        "Stripping temperature for this model (stream)"
                    );
                    oai_request.temperature = None;
                    continue;
                }

                // GPT-5 / o-series: switch from max_tokens to max_completion_tokens
                if status == 400
                    && body.contains("max_tokens")
                    && (body.contains("unsupported_parameter")
                        || body.contains("max_completion_tokens"))
                    && oai_request.max_tokens.is_some()
                    && attempt < max_retries
                {
                    let val = oai_request.max_tokens.unwrap();
                    warn!(model = %oai_request.model, "Switching to max_completion_tokens for this model (stream)");
                    oai_request.max_tokens = None;
                    oai_request.max_completion_tokens = Some(val);
                    continue;
                }

                // Auto-cap max_tokens when model rejects our value
                if status == 400 && body.contains("max_tokens") && attempt < max_retries {
                    let current = oai_request
                        .max_tokens
                        .or(oai_request.max_completion_tokens)
                        .unwrap_or(4096);
                    let cap = extract_max_tokens_limit(&body).unwrap_or(current / 2);
                    warn!(old = current, new = cap, "Auto-capping max_tokens (stream)");
                    if oai_request.max_completion_tokens.is_some() {
                        oai_request.max_completion_tokens = Some(cap);
                    } else {
                        oai_request.max_tokens = Some(cap);
                    }
                    continue;
                }

                // Model doesn't support function calling — retry without tools
                let body_lower = body.to_lowercase();
                if !oai_request.tools.is_empty()
                    && attempt < max_retries
                    && (status == 500
                        || body_lower.contains("internal error")
                        || (status == 400
                            && (body_lower.contains("does not support tools")
                                || body_lower.contains("tool")
                                    && body_lower.contains("not supported"))))
                {
                    warn!(
                        model = %oai_request.model,
                        status,
                        "Model may not support tools (stream), retrying without tools"
                    );
                    oai_request.tools.clear();
                    oai_request.tool_choice = None;
                    continue;
                }

                return Err(LlmError::Api {
                    status,
                    message: body,
                });
            }

            // Parse the SSE stream
            let mut buffer = String::new();
            let mut text_content = String::new();
            let mut reasoning_content = String::new();
            let mut think_filter = StreamingThinkFilter::new();
            // Track tool calls: index -> (id, name, arguments)
            let mut tool_accum: Vec<(String, String, String)> = Vec::new();
            let mut finish_reason: Option<String> = None;
            let mut usage = TokenUsage::default();

            let mut byte_stream = resp.bytes_stream();
            while let Some(chunk_result) = byte_stream.next().await {
                let chunk = chunk_result.map_err(|e| LlmError::Http(e.to_string()))?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                // Process complete lines
                while let Some(pos) = buffer.find('\n') {
                    let line = buffer[..pos].trim_end().to_string();
                    buffer = buffer[pos + 1..].to_string();

                    if line.is_empty() || line.starts_with(':') {
                        continue;
                    }

                    let data = match line.strip_prefix("data:") {
                        Some(d) => d.trim_start(),
                        None => continue,
                    };

                    if data == "[DONE]" {
                        continue;
                    }

                    let json: serde_json::Value = match serde_json::from_str(data) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    // Extract usage if present (some providers send it in the last chunk)
                    if let Some(u) = json.get("usage") {
                        if let Some(pt) = u["prompt_tokens"].as_u64() {
                            usage.input_tokens = pt;
                        }
                        if let Some(ct) = u["completion_tokens"].as_u64() {
                            usage.output_tokens = ct;
                        }
                    }

                    let choices = match json["choices"].as_array() {
                        Some(c) => c,
                        None => continue,
                    };

                    for choice in choices {
                        let delta = &choice["delta"];

                        // Text content delta
                        if let Some(text) = delta["content"].as_str() {
                            if !text.is_empty() {
                                for action in think_filter.process(text) {
                                    match action {
                                        FilterAction::EmitText(visible) => {
                                            if !visible.is_empty() {
                                                text_content.push_str(&visible);
                                                let _ = tx
                                                    .send(StreamEvent::TextDelta { text: visible })
                                                    .await;
                                            }
                                        }
                                        FilterAction::EmitThinking(thinking) => {
                                            if !thinking.is_empty() {
                                                reasoning_content.push_str(&thinking);
                                                let _ = tx
                                                    .send(StreamEvent::ThinkingDelta {
                                                        text: thinking,
                                                    })
                                                    .await;
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if let Some(reasoning) = delta["reasoning_content"].as_str() {
                            if !reasoning.is_empty() {
                                reasoning_content.push_str(reasoning);
                                let _ = tx
                                    .send(StreamEvent::ThinkingDelta {
                                        text: reasoning.to_string(),
                                    })
                                    .await;
                            }
                        }

                        // Tool call deltas
                        if let Some(calls) = delta["tool_calls"].as_array() {
                            for call in calls {
                                let idx = call["index"].as_u64().unwrap_or(0) as usize;

                                // Ensure tool_accum has enough entries
                                while tool_accum.len() <= idx {
                                    tool_accum.push((String::new(), String::new(), String::new()));
                                }

                                // ID (sent in first chunk for this tool)
                                if let Some(id) = call["id"].as_str() {
                                    tool_accum[idx].0 = id.to_string();
                                }

                                if let Some(func) = call.get("function") {
                                    // Name (sent in first chunk)
                                    if let Some(name) = func["name"].as_str() {
                                        if merge_streamed_tool_name(&mut tool_accum[idx].1, name) {
                                            let _ = tx
                                                .send(StreamEvent::ToolUseStart {
                                                    id: tool_accum[idx].0.clone(),
                                                    name: tool_accum[idx].1.clone(),
                                                })
                                                .await;
                                        }
                                    }

                                    // Arguments delta
                                    if let Some(args) = func["arguments"].as_str() {
                                        tool_accum[idx].2.push_str(args);
                                        if !args.is_empty() {
                                            let _ = tx
                                                .send(StreamEvent::ToolInputDelta {
                                                    text: args.to_string(),
                                                })
                                                .await;
                                        }
                                    }
                                }
                            }
                        }

                        // Finish reason
                        if let Some(fr) = choice["finish_reason"].as_str() {
                            finish_reason = Some(fr.to_string());
                        }
                    }
                }
            }

            // Build the final response
            let mut content = Vec::new();
            let mut tool_calls = Vec::new();

            for action in think_filter.flush() {
                match action {
                    FilterAction::EmitText(visible) => {
                        if !visible.is_empty() {
                            text_content.push_str(&visible);
                        }
                    }
                    FilterAction::EmitThinking(thinking) => {
                        if !thinking.is_empty() {
                            reasoning_content.push_str(&thinking);
                        }
                    }
                }
            }

            if !text_content.is_empty() {
                content.push(ContentBlock::Text { text: text_content });
            }

            if !reasoning_content.is_empty() {
                content.push(ContentBlock::Thinking {
                    thinking: reasoning_content.clone(),
                });
            }

            for (id, name, arguments) in &tool_accum {
                let input: serde_json::Value = serde_json::from_str(arguments).unwrap_or_default();
                content.push(ContentBlock::ToolUse {
                    id: id.clone(),
                    name: name.clone(),
                    input: input.clone(),
                });
                tool_calls.push(ToolCall {
                    id: id.clone(),
                    name: name.clone(),
                    input,
                });

                let _ = tx
                    .send(StreamEvent::ToolUseEnd {
                        id: id.clone(),
                        name: name.clone(),
                        input: serde_json::from_str(arguments).unwrap_or_default(),
                    })
                    .await;
            }

            let stop_reason = match finish_reason.as_deref() {
                Some("stop") => StopReason::EndTurn,
                Some("tool_calls") => StopReason::ToolUse,
                Some("length") => StopReason::MaxTokens,
                _ => {
                    if !tool_calls.is_empty() {
                        StopReason::ToolUse
                    } else {
                        StopReason::EndTurn
                    }
                }
            };

            let has_text = content
                .iter()
                .any(|block| matches!(block, ContentBlock::Text { .. }));
            let has_thinking = content
                .iter()
                .any(|block| matches!(block, ContentBlock::Thinking { .. }));
            if has_thinking && !has_text && tool_calls.is_empty() {
                content.push(ContentBlock::Text {
                    text: extract_thinking_summary(&reasoning_content),
                });
            }

            if !content.is_empty() && usage.input_tokens == 0 && usage.output_tokens == 0 {
                usage.output_tokens = 1;
            }

            let _ = tx
                .send(StreamEvent::ContentComplete { stop_reason, usage })
                .await;

            return Ok(CompletionResponse {
                content,
                stop_reason,
                tool_calls,
                usage,
            });
        }

        Err(LlmError::Api {
            status: 0,
            message: "Max retries exceeded".to_string(),
        })
    }
}

/// Parse Groq's `tool_use_failed` error and extract the tool call from `failed_generation`.
/// Extract the max_tokens limit from an API error message.
/// Looks for patterns like: `must be less than or equal to \`8192\``
fn extract_max_tokens_limit(body: &str) -> Option<u32> {
    // Pattern: "must be <= `N`" or "must be less than or equal to `N`"
    let patterns = [
        "less than or equal to `",
        "must be <= `",
        "maximum value for `max_tokens` is `",
    ];
    for pat in &patterns {
        if let Some(idx) = body.find(pat) {
            let after = &body[idx + pat.len()..];
            let end = after
                .find('`')
                .or_else(|| after.find('"'))
                .unwrap_or(after.len());
            if let Ok(n) = after[..end].trim().parse::<u32>() {
                return Some(n);
            }
        }
    }
    None
}

/// 提取内容中的 `<think>...</think>` 块，返回清理后的正文和可选 thinking 文本。
fn extract_think_tags(text: &str) -> (String, Option<String>) {
    let mut cleaned = String::new();
    let mut collected = Vec::new();
    let mut remaining = text;

    while let Some(start) = remaining.find("<think>") {
        cleaned.push_str(&remaining[..start]);
        let after_start = &remaining[start + "<think>".len()..];
        if let Some(end) = after_start.find("</think>") {
            let thinking = after_start[..end].trim();
            if !thinking.is_empty() {
                collected.push(thinking.to_string());
            }
            remaining = &after_start[end + "</think>".len()..];
        } else {
            collected.push(after_start.trim().to_string());
            remaining = "";
            break;
        }
    }

    cleaned.push_str(remaining);
    let cleaned = cleaned.trim().to_string();
    let thinking = if collected.is_empty() {
        None
    } else {
        Some(collected.join("\n\n"))
    };

    (cleaned, thinking)
}

/// 当模型只返回思维链没有最终正文时，抽取一个可展示的简短结果，避免空响应。
fn extract_thinking_summary(thinking: &str) -> String {
    let trimmed = thinking.trim();
    if trimmed.is_empty() {
        return "[模型只返回了思考内容，没有最终答案。请尝试重新提问。]".to_string();
    }

    let lines: Vec<&str> = trimmed
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();

    if let Some(last) = lines.last() {
        if !last.is_empty() {
            return (*last).to_string();
        }
    }

    trimmed
        .split_terminator(['.', '!', '?', '。', '！', '？'])
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .last()
        .map(ToString::to_string)
        .unwrap_or_else(|| "[模型只返回了思考内容，没有最终答案。请尝试重新提问。]".to_string())
}

///
/// Some models (e.g. Llama 3.3) generate tool calls as XML: `<function=NAME ARGS></function>`
/// instead of the proper JSON format. Groq rejects these with `tool_use_failed` but includes
/// the raw generation. We parse it and construct a proper CompletionResponse.
fn parse_groq_failed_tool_call(body: &str) -> Option<CompletionResponse> {
    let json_body: serde_json::Value = serde_json::from_str(body).ok()?;
    let failed = json_body
        .pointer("/error/failed_generation")
        .and_then(|v| v.as_str())?;

    // Parse all tool calls from the failed generation.
    // Format: <function=tool_name{"arg":"val"}></function> or <function=tool_name {"arg":"val"}></function>
    let mut tool_calls = Vec::new();
    let mut remaining = failed;

    while let Some(start) = remaining.find("<function=") {
        remaining = &remaining[start + 10..]; // skip "<function="
                                              // Find the end tag
        let end = remaining.find("</function>")?;
        let mut call_content = &remaining[..end];
        remaining = &remaining[end + 11..]; // skip "</function>"

        // Strip trailing ">" from the XML opening tag close
        call_content = call_content.strip_suffix('>').unwrap_or(call_content);

        // Split into name and args: "tool_name{"arg":"val"}" or "tool_name {"arg":"val"}"
        let (name, args) = if let Some(brace_pos) = call_content.find('{') {
            let name = call_content[..brace_pos].trim();
            let args = &call_content[brace_pos..];
            (name, args)
        } else {
            // No args — just a tool name
            (call_content.trim(), "{}")
        };

        // Parse args as JSON Value
        let args_value: serde_json::Value =
            serde_json::from_str(args).unwrap_or(serde_json::json!({}));

        tool_calls.push(ToolCall {
            id: format!("groq_recovered_{}", tool_calls.len()),
            name: name.to_string(),
            input: args_value,
        });
    }

    if tool_calls.is_empty() {
        // No tool calls found — the model generated plain text but Groq rejected it.
        // Return it as a normal text response instead of failing.
        if !failed.trim().is_empty() {
            warn!("Recovering plain text from Groq failed_generation (no tool calls)");
            return Some(CompletionResponse {
                content: vec![ContentBlock::Text {
                    text: failed.to_string(),
                }],
                tool_calls: vec![],
                stop_reason: StopReason::EndTurn,
                usage: TokenUsage {
                    input_tokens: 0,
                    output_tokens: 0,
                },
            });
        }
        return None;
    }

    Some(CompletionResponse {
        content: vec![],
        tool_calls,
        stop_reason: StopReason::ToolUse,
        usage: TokenUsage {
            input_tokens: 0,
            output_tokens: 0,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_openai_driver_creation() {
        let driver = OpenAIDriver::new("test-key".to_string(), "http://localhost".to_string());
        assert_eq!(driver.api_key.as_str(), "test-key");
    }

    #[test]
    fn test_parse_groq_failed_tool_call() {
        let body = r#"{"error":{"message":"Failed to call a function.","type":"invalid_request_error","code":"tool_use_failed","failed_generation":"<function=web_fetch{\"url\": \"https://example.com\"}></function>\n"}}"#;
        let result = parse_groq_failed_tool_call(body);
        assert!(result.is_some());
        let resp = result.unwrap();
        assert_eq!(resp.tool_calls.len(), 1);
        assert_eq!(resp.tool_calls[0].name, "web_fetch");
        assert!(resp.tool_calls[0]
            .input
            .to_string()
            .contains("https://example.com"));
    }

    #[test]
    fn test_parse_groq_failed_tool_call_with_space() {
        let body = r#"{"error":{"message":"Failed","type":"invalid_request_error","code":"tool_use_failed","failed_generation":"<function=shell_exec {\"command\": \"ls -la\"}></function>"}}"#;
        let result = parse_groq_failed_tool_call(body);
        assert!(result.is_some());
        let resp = result.unwrap();
        assert_eq!(resp.tool_calls[0].name, "shell_exec");
    }

    #[test]
    fn test_extract_think_tags() {
        let (cleaned, thinking) = extract_think_tags("abc<think>reason</think>xyz");
        assert_eq!(cleaned, "abcxyz");
        assert_eq!(thinking.as_deref(), Some("reason"));
    }

    #[test]
    fn test_rejects_temperature_reasoning_models() {
        assert!(rejects_temperature("o3-mini"));
        assert!(rejects_temperature("gpt-5-mini"));
        assert!(!rejects_temperature("gpt-4o"));
    }

    #[test]
    fn test_merge_streamed_tool_name_ignores_empty_deltas() {
        let mut current = String::new();
        assert!(merge_streamed_tool_name(&mut current, "time"));
        assert_eq!(current, "time");
        assert!(!merge_streamed_tool_name(&mut current, ""));
        assert_eq!(current, "time");
    }

    #[test]
    fn test_merge_streamed_tool_name_appends_partial_chunks() {
        let mut current = String::new();
        assert!(merge_streamed_tool_name(&mut current, "ti"));
        assert_eq!(current, "ti");
        assert!(!merge_streamed_tool_name(&mut current, "me"));
        assert_eq!(current, "time");
    }
}
