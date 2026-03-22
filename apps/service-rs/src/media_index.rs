use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};
use sha2::Digest;

use crate::assignment_store::{self, MediaAssetRecord, UpsertMediaAssetRecord};
use crate::vision_analysis::{self, AnalyzeVisionImageRequest};

#[derive(Debug, Clone)]
pub struct PhotoIndexRequest {
    pub agent_id: Option<String>,
    pub owner_scope: String,
    pub asset_family: String,
    pub media_kind: String,
    pub source_tool: String,
    pub purpose: Option<String>,
    pub prompt_text: Option<String>,
    pub negative_prompt: Option<String>,
    pub model: Option<String>,
    pub mime_type: Option<String>,
    pub file_name: Option<String>,
    pub saved_path: String,
    pub image_url: Option<String>,
    pub relative_path: Option<String>,
    pub metadata: Value,
}

pub async fn index_photo_asset(request: PhotoIndexRequest) -> Result<MediaAssetRecord, String> {
    let saved_path = request.saved_path.trim();
    if saved_path.is_empty() {
        return Err("照片索引 saved_path 不能为空".to_string());
    }

    let path = PathBuf::from(saved_path);
    if !path.is_absolute() {
        return Err(format!("照片索引路径必须是绝对路径: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("照片索引源文件不存在: {}", path.display()));
    }

    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|err| format!("读取照片索引源文件失败({}): {err}", path.display()))?;
    let sha256 = format!("{:x}", sha2::Sha256::digest(bytes.as_slice()));
    let byte_size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);

    let base_mime_type = request
        .mime_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| guess_image_mime_type(&path).to_string());

    let vision = vision_analysis::analyze_vision_image_best_effort(AnalyzeVisionImageRequest {
        image_path: path.to_string_lossy().to_string(),
        sha256: Some(sha256.clone()),
        mime_type: base_mime_type.clone(),
        relative_path: request.relative_path.clone(),
        saved_path: Some(path.to_string_lossy().to_string()),
        upstream_file_id: None,
        file_name: request.file_name.clone(),
        source: request.source_tool.clone(),
        user_text: String::new(),
    })
    .await?;

    let mime_type = vision
        .as_ref()
        .map(|analysis| analysis.mime_type.clone())
        .unwrap_or(base_mime_type);
    let vision_summary = vision.as_ref().map(|analysis| analysis.summary.clone());
    let width = vision.as_ref().and_then(|analysis| analysis.width);
    let height = vision.as_ref().and_then(|analysis| analysis.height);
    let tags = build_photo_tags(&request, vision_summary.as_deref(), width, height, &path);
    let metadata = build_photo_metadata(
        request.metadata.clone(),
        &request,
        &path,
        &sha256,
        byte_size,
        width,
        height,
    );

    assignment_store::upsert_media_asset(UpsertMediaAssetRecord {
        agent_id: request.agent_id,
        owner_scope: request.owner_scope,
        asset_family: request.asset_family,
        media_kind: request.media_kind,
        source_tool: Some(request.source_tool),
        purpose: request.purpose,
        prompt_text: request.prompt_text,
        negative_prompt: request.negative_prompt,
        model: request.model,
        mime_type,
        sha256,
        width,
        height,
        byte_size,
        file_name: request.file_name,
        saved_path: Some(path.to_string_lossy().to_string()),
        image_url: request.image_url,
        relative_path: request.relative_path,
        vision_summary,
        tags,
        metadata,
    })
}

fn build_photo_metadata(
    metadata: Value,
    request: &PhotoIndexRequest,
    path: &Path,
    sha256: &str,
    byte_size: u64,
    width: Option<u32>,
    height: Option<u32>,
) -> Value {
    let mut object = match metadata {
        Value::Object(map) => map,
        Value::Null => Map::new(),
        other => {
            let mut map = Map::new();
            map.insert("raw".to_string(), other);
            map
        }
    };
    object.insert("sha256".to_string(), Value::String(sha256.to_string()));
    object.insert("byte_size".to_string(), json!(byte_size));
    object.insert(
        "indexed_from".to_string(),
        Value::String(path.to_string_lossy().to_string()),
    );
    object.insert(
        "source_tool".to_string(),
        Value::String(request.source_tool.clone()),
    );
    object.insert(
        "owner_scope".to_string(),
        Value::String(request.owner_scope.clone()),
    );
    object.insert(
        "asset_family".to_string(),
        Value::String(request.asset_family.clone()),
    );
    object.insert(
        "media_kind".to_string(),
        Value::String(request.media_kind.clone()),
    );
    if let Some(width) = width {
        object.insert("width".to_string(), json!(width));
    }
    if let Some(height) = height {
        object.insert("height".to_string(), json!(height));
    }
    Value::Object(object)
}

fn build_photo_tags(
    request: &PhotoIndexRequest,
    vision_summary: Option<&str>,
    width: Option<u32>,
    height: Option<u32>,
    path: &Path,
) -> Vec<String> {
    let mut tags = BTreeSet::new();
    tags.insert("photo".to_string());
    tags.insert("image".to_string());
    tags.insert(normalize_tag_value(&request.owner_scope));
    tags.insert(normalize_tag_value(&request.source_tool));

    if let Some(purpose) = request.purpose.as_deref() {
        push_tokenized_tags(&mut tags, purpose);
    }
    if let Some(prompt) = request.prompt_text.as_deref() {
        push_tokenized_tags(&mut tags, prompt);
    }
    if let Some(summary) = vision_summary {
        push_tokenized_tags(&mut tags, summary);
    }
    if let Some(file_name) = request
        .file_name
        .as_deref()
        .or_else(|| path.file_name().and_then(|item| item.to_str()))
    {
        push_tokenized_tags(&mut tags, file_name);
    }
    if let (Some(width), Some(height)) = (width, height) {
        tags.insert(format!("{width}x{height}"));
    }

    tags.retain(|item| !item.is_empty());
    tags.into_iter().take(24).collect()
}

fn push_tokenized_tags(output: &mut BTreeSet<String>, raw: &str) {
    for token in tokenize_text(raw) {
        if !token.is_empty() {
            output.insert(token);
        }
    }
}

fn tokenize_text(raw: &str) -> Vec<String> {
    let mut output = Vec::new();
    let mut current = String::new();
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || is_cjk(ch) {
            current.push(ch);
            continue;
        }
        flush_tag_token(&mut current, &mut output);
    }
    flush_tag_token(&mut current, &mut output);
    output
}

fn flush_tag_token(current: &mut String, output: &mut Vec<String>) {
    let normalized = normalize_tag_value(current);
    current.clear();
    if normalized.is_empty() {
        return;
    }
    if normalized.is_ascii() && normalized.len() < 2 {
        return;
    }
    output.push(normalized);
}

fn normalize_tag_value(raw: &str) -> String {
    raw.trim()
        .trim_matches(|ch: char| matches!(ch, '"' | '\'' | ',' | '.' | '_' | '-' | '/' | '\\'))
        .to_ascii_lowercase()
}

fn is_cjk(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0x20000..=0x2A6DF
            | 0x2A700..=0x2B73F
            | 0x2B740..=0x2B81F
            | 0x2B820..=0x2CEAF
            | 0x2CEB0..=0x2EBEF
            | 0x30000..=0x3134F
    )
}

fn guess_image_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        _ => "image/png",
    }
}

#[cfg(test)]
mod tests {
    use super::tokenize_text;

    #[test]
    fn tokenize_text_keeps_cjk_and_ascii_keywords() {
        let tags = tokenize_text("头像 自拍 red dress 城市场景");
        assert!(tags.iter().any(|item| item == "头像"));
        assert!(tags.iter().any(|item| item == "自拍"));
        assert!(tags.iter().any(|item| item == "red"));
        assert!(tags.iter().any(|item| item == "dress"));
        assert!(tags.iter().any(|item| item == "城市场景"));
    }
}
