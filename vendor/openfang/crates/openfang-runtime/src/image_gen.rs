//! Image generation runtime helpers.

use base64::Engine;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImage, ImageBuffer, ImageFormat, Rgba};
use openfang_types::media::{GeneratedImage, ImageEditRequest, ImageGenRequest, ImageGenResult};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use serde::Deserialize;
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::warn;

const MAX_BASE64_BYTES: usize = 10 * 1024 * 1024;
const FIXED_IMAGE_EDIT_INSTRUCTION_PREFIX: &str = "Describe the key features of the input image (color, shape, size, texture, objects, background), then explain how the user's text instruction should alter or modify the image. Generate a new image that meets the user's requirements while maintaining consistency with the original input where appropriate.";

#[derive(Debug, Default, Clone, Copy)]
struct ImageEditScope {
    changes_composition: bool,
    changes_pose: bool,
    changes_camera: bool,
    changes_outfit: bool,
    changes_background: bool,
    changes_hair: bool,
    changes_accessories: bool,
    changes_makeup: bool,
    changes_body: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ImageEditWorkflowKind {
    SingleSourceEdit,
    BaseWithReferenceMerge,
}

#[derive(Debug, Clone)]
struct LoadedImageEditSource {
    bytes: Vec<u8>,
    mime_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalImageServiceEnvelope {
    handled: bool,
    #[serde(default)]
    message: String,
    #[serde(default)]
    response: Option<Value>,
}

pub async fn generate_image(request: &ImageGenRequest) -> Result<ImageGenResult, String> {
    request.validate()?;

    let api_key = env::var("OPENAI_API_KEY")
        .map_err(|_| "OPENAI_API_KEY not set. Image generation requires an OpenAI API key.")?;

    generate_openai_compatible_image(
        request,
        &request.model.to_string(),
        "https://api.openai.com/v1",
        &api_key,
    )
    .await
}

pub async fn generate_openai_compatible_image(
    request: &ImageGenRequest,
    model_name: &str,
    base_url: &str,
    api_key: &str,
) -> Result<ImageGenResult, String> {
    request.validate()?;

    if api_key.trim().is_empty() {
        return Err("Image generation API key is empty".to_string());
    }

    let size = request.effective_size()?;
    let endpoint = join_endpoint(base_url, "images/generations");
    let mut body = json!({
        "model": model_name,
        "prompt": request.prompt,
        "n": request.count,
        "size": size,
        "response_format": "b64_json",
    });

    if request.model == openfang_types::media::ImageGenModel::DallE3 {
        body["quality"] = json!(request.quality);
    } else if matches!(
        request.quality.as_str(),
        "standard" | "auto" | "high" | "medium" | "low"
    ) {
        body["quality"] = json!(request.quality);
    }

    let client = build_http_client(120)?;
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", api_key.trim()))
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, crate::USER_AGENT)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Image generation API request failed: {e}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read image generation response: {e}"))?;

    if !status.is_success() {
        let truncated = crate::str_utils::safe_truncate_str(&text, 500);
        return Err(format!(
            "Image generation failed (HTTP {}): {}",
            status, truncated
        ));
    }

    let result: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse image generation response: {e}"))?;
    parse_openai_like_result(&result, model_name)
}

pub async fn generate_openai_compatible_image_edit(
    request: &ImageEditRequest,
    model_name: &str,
    base_url: &str,
    api_key: &str,
) -> Result<ImageGenResult, String> {
    request.validate()?;

    if api_key.trim().is_empty() {
        return Err("Image editing API key is empty".to_string());
    }

    let client = build_http_client(120)?;
    let (image_bytes, mime_type, workflow_kind) =
        prepare_image_edit_source(&client, request).await?;
    let size = request.effective_size()?;
    let filename = format!(
        "image-edit-input.{}",
        extension_from_mime_type(&mime_type).unwrap_or("png")
    );
    let image_part = reqwest::multipart::Part::bytes(image_bytes)
        .file_name(filename)
        .mime_str(&mime_type)
        .map_err(|err| format!("Invalid image MIME type '{mime_type}': {err}"))?;
    let prompt = build_image_edit_instruction_prompt(&request.prompt, workflow_kind);

    let mut form = reqwest::multipart::Form::new()
        .part("image", image_part)
        .text("model", model_name.to_string())
        .text("prompt", prompt)
        .text("n", request.count.to_string())
        .text("size", size)
        .text("response_format", "b64_json".to_string());

    if matches!(
        request.quality.as_str(),
        "standard" | "auto" | "high" | "medium" | "low"
    ) {
        form = form.text("quality", request.quality.clone());
    }

    let endpoint = join_endpoint(base_url, "images/edits");
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", api_key.trim()))
        .header(USER_AGENT, crate::USER_AGENT)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Image editing API request failed: {e}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read image editing response: {e}"))?;

    if !status.is_success() {
        let truncated = crate::str_utils::safe_truncate_str(&text, 500);
        return Err(format!(
            "Image editing failed (HTTP {}): {}",
            status, truncated
        ));
    }

    let result: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse image editing response: {e}"))?;
    parse_openai_like_result(&result, model_name)
}

pub fn save_images_to_workspace(
    result: &ImageGenResult,
    workspace: &Path,
) -> Result<Vec<String>, String> {
    let output_dir = workspace.join("output");
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output dir: {e}"))?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let mut paths = Vec::new();

    for (i, image) in result.images.iter().enumerate() {
        let filename = if result.images.len() == 1 {
            format!("image_{timestamp}.png")
        } else {
            format!("image_{timestamp}_{i}.png")
        };

        let path = output_dir.join(&filename);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&image.data_base64)
            .map_err(|e| format!("Failed to decode base64 image: {e}"))?;

        if decoded.len() > MAX_BASE64_BYTES {
            return Err("Decoded image exceeds 10MB limit".into());
        }

        std::fs::write(&path, &decoded)
            .map_err(|e| format!("Failed to write image to {}: {e}", path.display()))?;
        paths.push(path.display().to_string());
    }

    Ok(paths)
}

pub async fn execute_configured_image_generate_tool(
    request: &ImageGenRequest,
    workspace_root: Option<&Path>,
    asset_metadata: Option<&Value>,
) -> Result<Option<String>, String> {
    let client = build_http_client(240)?;
    let mut payload = json!({
        "prompt": request.prompt,
        "negativePrompt": request.negative_prompt,
        "size": request.size,
        "width": request.width,
        "height": request.height,
        "quality": request.quality,
        "count": request.count,
        "workspaceRoot": workspace_root.map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
    });
    if let (Some(metadata), Some(object)) = (asset_metadata, payload.as_object_mut()) {
        if let Some(extra) = metadata.as_object() {
            for (key, value) in extra {
                object.insert(key.clone(), value.clone());
            }
        }
    }
    let response = client
        .post(format!(
            "{}/api/management/image-generation/generate",
            local_image_service_base_url()
        ))
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, crate::USER_AGENT)
        .json(&payload)
        .send()
        .await
        .map_err(|err| format!("调用本地图片生成服务失败: {err}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("读取本地图片生成服务响应失败: {err}"))?;
    if !status.is_success() {
        return Err(format!(
            "本地图片生成服务返回错误({status}): {}",
            body.trim()
        ));
    }
    let payload = serde_json::from_str::<LocalImageServiceEnvelope>(&body)
        .map_err(|err| format!("解析本地图片生成服务响应失败: {err}; body={body}"))?;
    if !payload.handled {
        return Ok(None);
    }
    let response_json = payload
        .response
        .ok_or_else(|| format!("本地图片生成服务未返回结果: {}", payload.message))?;
    serde_json::to_string_pretty(&response_json)
        .map(Some)
        .map_err(|err| format!("序列化图片生成结果失败: {err}"))
}

pub async fn execute_configured_image_edit_tool(
    request: &ImageEditRequest,
    workspace_root: Option<&Path>,
    asset_metadata: Option<&Value>,
) -> Result<Option<String>, String> {
    let client = build_http_client(240)?;
    let mut image_path = request.image_path.clone();
    let mut image_url = request.image_url.clone();
    let mut image_base64 = request.image_base64.clone();
    let mut mime_type = request.mime_type.clone();
    let mut reference_image_path = request.reference_image_path.clone();
    let mut reference_image_url = request.reference_image_url.clone();
    let reference_image_base64 = request.reference_image_base64.clone();
    let reference_mime_type = request.reference_mime_type.clone();

    if image_path.trim().is_empty() && image_base64.trim().is_empty() {
        if let Some(materialized_path) =
            materialize_local_management_image_source(&client, &image_url).await?
        {
            image_path = materialized_path;
            image_url.clear();
            image_base64.clear();
            mime_type.clear();
        }
    }
    if reference_image_path.trim().is_empty() && reference_image_base64.trim().is_empty() {
        if let Some(materialized_path) =
            materialize_local_management_image_source(&client, &reference_image_url).await?
        {
            reference_image_path = materialized_path;
            reference_image_url.clear();
        }
    }

    let mut payload = json!({
        "prompt": request.prompt,
        "negativePrompt": request.negative_prompt,
        "size": request.size,
        "width": request.width,
        "height": request.height,
        "quality": request.quality,
        "count": request.count,
        "imagePath": image_path,
        "imageUrl": image_url,
        "imageBase64": image_base64,
        "mimeType": mime_type,
        "referenceImagePath": reference_image_path,
        "referenceImageUrl": reference_image_url,
        "referenceImageBase64": reference_image_base64,
        "referenceMimeType": reference_mime_type,
        "workspaceRoot": workspace_root.map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
    });
    if let (Some(metadata), Some(object)) = (asset_metadata, payload.as_object_mut()) {
        if let Some(extra) = metadata.as_object() {
            for (key, value) in extra {
                object.insert(key.clone(), value.clone());
            }
        }
    }
    let response = client
        .post(format!(
            "{}/api/management/image-generation/edit",
            local_image_service_base_url()
        ))
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, crate::USER_AGENT)
        .json(&payload)
        .send()
        .await
        .map_err(|err| format!("调用本地图片修改服务失败: {err}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("读取本地图片修改服务响应失败: {err}"))?;
    if !status.is_success() {
        return Err(format!(
            "本地图片修改服务返回错误({status}): {}",
            body.trim()
        ));
    }
    let payload = serde_json::from_str::<LocalImageServiceEnvelope>(&body)
        .map_err(|err| format!("解析本地图片修改服务响应失败: {err}; body={body}"))?;
    if !payload.handled {
        return Ok(None);
    }
    let response_json = payload
        .response
        .ok_or_else(|| format!("本地图片修改服务未返回结果: {}", payload.message))?;
    serde_json::to_string_pretty(&response_json)
        .map(Some)
        .map_err(|err| format!("序列化图片修改结果失败: {err}"))
}

fn is_local_management_media_path(image_url: &str) -> bool {
    let trimmed = image_url.trim();
    if trimmed.is_empty() {
        return false;
    }
    let path_like = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let Some(index) = trimmed.find("/api/management/agents/") else {
            return false;
        };
        &trimmed[index..]
    } else {
        trimmed
    };
    let path_only = path_like
        .split('#')
        .next()
        .unwrap_or(path_like)
        .split('?')
        .next()
        .unwrap_or(path_like);
    let Some(rest) = path_only.strip_prefix("/api/management/agents/") else {
        return false;
    };
    let Some((_, tail)) = rest.split_once('/') else {
        return false;
    };
    tail.starts_with("avatar/") || tail.starts_with("portrait/")
}

fn resolve_local_management_media_url(image_url: &str) -> Option<String> {
    let trimmed = image_url.trim();
    if !is_local_management_media_path(trimmed) {
        return None;
    }
    if trimmed.starts_with("/api/management/agents/") {
        return Some(format!("{}{}", local_image_service_base_url(), trimmed));
    }
    let base = local_image_service_base_url();
    let prefixed = format!("{base}/api/management/agents/");
    if trimmed.starts_with(&prefixed) {
        return Some(trimmed.to_string());
    }
    None
}

async fn materialize_local_management_image_source(
    client: &reqwest::Client,
    image_url: &str,
) -> Result<Option<String>, String> {
    let Some(request_url) = resolve_local_management_media_url(image_url) else {
        return Ok(None);
    };

    let response = client
        .get(&request_url)
        .header(USER_AGENT, crate::USER_AGENT)
        .send()
        .await
        .map_err(|err| {
            format!(
                "Failed to fetch local management image URL '{}': {err}",
                image_url.trim()
            )
        })?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Local management image URL fetch failed ({}): {}",
            status,
            body.trim()
        ));
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(normalize_image_mime_type)
        .map(str::to_string);
    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("Failed to read local management image URL bytes: {err}"))?
        .to_vec();
    let extension = content_type
        .as_deref()
        .and_then(extension_from_mime_type)
        .or_else(|| {
            detect_image_mime_from_path_or_bytes(None, &bytes).and_then(extension_from_mime_type)
        })
        .unwrap_or("png");
    let tick = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let temp_dir = env::temp_dir().join("openfang_runtime_image_sources");
    tokio::fs::create_dir_all(&temp_dir).await.map_err(|err| {
        format!(
            "Failed to create runtime image source cache '{}': {err}",
            temp_dir.display()
        )
    })?;
    let temp_path = temp_dir.join(format!(
        "management-media-{}-{}.{}",
        std::process::id(),
        tick,
        extension
    ));
    tokio::fs::write(&temp_path, &bytes).await.map_err(|err| {
        format!(
            "Failed to persist local management image source '{}': {err}",
            temp_path.display()
        )
    })?;
    Ok(Some(temp_path.to_string_lossy().to_string()))
}

fn build_image_edit_instruction_prompt(
    prompt: &str,
    workflow_kind: ImageEditWorkflowKind,
) -> String {
    let user_prompt = prompt.trim();
    let scope = infer_image_edit_scope(user_prompt);
    let mut requested_change_groups = Vec::new();

    if scope.changes_composition {
        requested_change_groups.push("framing/composition");
    }
    if scope.changes_camera {
        requested_change_groups.push("camera angle/viewpoint");
    }
    if scope.changes_pose {
        requested_change_groups.push("pose/gesture");
    }
    if scope.changes_outfit {
        requested_change_groups.push("outfit/fabric/clothing details");
    }
    if scope.changes_accessories {
        requested_change_groups.push("accessories/jewelry");
    }
    if scope.changes_hair {
        requested_change_groups.push("hair/hairstyle");
    }
    if scope.changes_makeup {
        requested_change_groups.push("makeup/beauty details");
    }
    if scope.changes_body {
        requested_change_groups.push("body visibility/body-detail emphasis");
    }
    if scope.changes_background {
        requested_change_groups.push("background/scene");
    }

    let requested_change_instruction = if requested_change_groups.is_empty() {
        "The requested edit is a local or medium modification. Keep framing, pose, outfit, background, and camera language unchanged unless the user explicitly says otherwise.".to_string()
    } else {
        format!(
            "The user explicitly requested changes to {}. Those requested changes must happen. Preserve identity and every other unspecified element.",
            requested_change_groups.join(", ")
        )
    };

    let workflow_instruction = match workflow_kind {
        ImageEditWorkflowKind::SingleSourceEdit => {
            "Edit the provided source image instead of creating a brand-new image. Preserve the same subject identity, face, recognizable person, hairstyle, body characteristics, lighting style, color palette, and overall visual language unless the user explicitly asked to change them.".to_string()
        }
        ImageEditWorkflowKind::BaseWithReferenceMerge => {
            "The provided input image is a two-panel reference sheet. The LEFT panel is the base image to preserve and edit. The RIGHT panel is a reference image that only provides the requested transferable elements. The final result must be a single normal image based on the LEFT panel subject, identity, framing, pose, camera language, and scene ownership. Use the RIGHT panel only to copy or merge the requested clothing, object, material, accessory, makeup, hairstyle, or style cues. Do not output a collage, split screen, diptych, side-by-side comparison, or two people unless the user explicitly asked for that.".to_string()
        }
    };

    format!(
        "{}\n\n{} {} Only modify the exact parts requested below. Do not add extra accessories, props, beautification, outfit redesigns, pose changes, background rewrites, or scene inventions beyond the user's request. Everything not explicitly requested must remain unchanged.\n\nRequested edit:\n{}",
        FIXED_IMAGE_EDIT_INSTRUCTION_PREFIX,
        workflow_instruction,
        requested_change_instruction,
        user_prompt
    )
}

fn infer_image_edit_scope(prompt: &str) -> ImageEditScope {
    let normalized = prompt.trim().to_ascii_lowercase();
    ImageEditScope {
        changes_composition: contains_any_edit_keyword(
            &normalized,
            &[
                "full body",
                "full-body",
                "upper body",
                "close-up",
                "close up",
                "wide shot",
                "long shot",
                "portrait crop",
                "framing",
                "composition",
                "shot",
                "全身",
                "半身",
                "特写",
                "近景",
                "远景",
                "构图",
                "景别",
                "镜头",
            ],
        ),
        changes_pose: contains_any_edit_keyword(
            &normalized,
            &[
                "pose", "posing", "gesture", "holding", "stand", "standing", "sit", "sitting",
                "kneel", "kneeling", "双手", "手持", "姿势", "动作", "站姿", "坐姿", "跪姿",
            ],
        ),
        changes_camera: contains_any_edit_keyword(
            &normalized,
            &[
                "camera angle",
                "viewpoint",
                "angle",
                "perspective",
                "视角",
                "角度",
                "机位",
            ],
        ),
        changes_outfit: contains_any_edit_keyword(
            &normalized,
            &[
                "outfit",
                "dress",
                "gown",
                "clothes",
                "clothing",
                "wearing",
                "v-neck",
                "deep v",
                "slit",
                "stockings",
                "pantyhose",
                "丝袜",
                "服装",
                "衣服",
                "裙子",
                "领口",
                "高开叉",
                "晚礼服",
                "换装",
            ],
        ),
        changes_background: contains_any_edit_keyword(
            &normalized,
            &[
                "background",
                "scene",
                "setting",
                "location",
                "indoors",
                "outdoors",
                "背景",
                "场景",
                "环境",
                "宫殿",
                "办公室",
            ],
        ),
        changes_hair: contains_any_edit_keyword(
            &normalized,
            &[
                "hair",
                "hairstyle",
                "bangs",
                "ponytail",
                "发型",
                "头发",
                "刘海",
                "马尾",
            ],
        ),
        changes_accessories: contains_any_edit_keyword(
            &normalized,
            &[
                "accessory",
                "accessories",
                "jewelry",
                "necklace",
                "earring",
                "earrings",
                "bracelet",
                "choker",
                "collar",
                "配饰",
                "首饰",
                "项链",
                "耳环",
                "耳坠",
                "手链",
                "颈圈",
            ],
        ),
        changes_makeup: contains_any_edit_keyword(
            &normalized,
            &[
                "makeup",
                "beauty",
                "lipstick",
                "eyeliner",
                "retouch",
                "face more beautiful",
                "妆容",
                "美化",
                "美颜",
                "修脸",
            ],
        ),
        changes_body: contains_any_edit_keyword(
            &normalized,
            &[
                "body", "figure", "legs", "waist", "bust", "胸", "腿", "身材", "腰", "曲线",
            ],
        ),
    }
}

fn contains_any_edit_keyword(value: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|keyword| value.contains(keyword))
}

async fn prepare_image_edit_source(
    client: &reqwest::Client,
    request: &ImageEditRequest,
) -> Result<(Vec<u8>, String, ImageEditWorkflowKind), String> {
    let primary = load_named_image_edit_source(
        client,
        &request.image_path,
        &request.image_url,
        &request.image_base64,
        &request.mime_type,
        "primary",
    )
    .await?;
    let reference = load_optional_named_image_edit_source(
        client,
        &request.reference_image_path,
        &request.reference_image_url,
        &request.reference_image_base64,
        &request.reference_mime_type,
        "reference",
    )
    .await?;
    if let Some(reference) = reference {
        let merged = compose_reference_sheet(&primary, &reference)?;
        return Ok((
            merged.bytes,
            merged.mime_type,
            ImageEditWorkflowKind::BaseWithReferenceMerge,
        ));
    }
    Ok((
        primary.bytes,
        primary.mime_type,
        ImageEditWorkflowKind::SingleSourceEdit,
    ))
}

async fn load_optional_named_image_edit_source(
    client: &reqwest::Client,
    image_path: &str,
    image_url: &str,
    image_base64: &str,
    mime_type: &str,
    label: &str,
) -> Result<Option<LoadedImageEditSource>, String> {
    if image_path.trim().is_empty() && image_url.trim().is_empty() && image_base64.trim().is_empty()
    {
        return Ok(None);
    }
    load_named_image_edit_source(
        client,
        image_path,
        image_url,
        image_base64,
        mime_type,
        label,
    )
    .await
    .map(Some)
}

async fn load_named_image_edit_source(
    client: &reqwest::Client,
    image_path: &str,
    image_url: &str,
    image_base64: &str,
    mime_type: &str,
    label: &str,
) -> Result<LoadedImageEditSource, String> {
    if !image_base64.trim().is_empty() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(image_base64.trim())
            .map_err(|err| format!("Failed to decode {label} image_base64: {err}"))?;
        let mime_type = normalize_image_mime_type(mime_type.trim())
            .ok_or_else(|| format!("Unsupported {label} image MIME type: {}", mime_type.trim()))?;
        return Ok(LoadedImageEditSource {
            bytes,
            mime_type: mime_type.to_string(),
        });
    }

    if !image_path.trim().is_empty() {
        let path = PathBuf::from(image_path.trim());
        let bytes = tokio::fs::read(&path).await.map_err(|err| {
            format!(
                "Failed to read {label} image file '{}': {err}",
                path.display()
            )
        })?;
        let mime_type = detect_image_mime_from_path_or_bytes(path.to_str(), &bytes)
            .ok_or_else(|| format!("Unsupported {label} image format: {}", path.display()))?;
        return Ok(LoadedImageEditSource {
            bytes,
            mime_type: mime_type.to_string(),
        });
    }

    let image_url = image_url.trim();
    if image_url.is_empty() {
        return Err(format!("Missing {label} image source"));
    }

    if let Some(file_id) = extract_local_upload_id(image_url) {
        let cache_path = env::temp_dir().join("openfang_uploads").join(file_id);
        let (bytes, path_for_mime) = match tokio::fs::read(&cache_path).await {
            Ok(bytes) => (bytes, cache_path.clone()),
            Err(cache_err) => {
                let restored_path = recover_persisted_upload_path(file_id).ok_or_else(|| {
                    format!(
                        "Failed to read uploaded {label} image '{}' from local cache: {cache_err}",
                        image_url
                    )
                })?;
                let restored_bytes = tokio::fs::read(&restored_path).await.map_err(|err| {
                    format!(
                        "Failed to read restored uploaded {label} image '{}' from '{}': {err}",
                        image_url,
                        restored_path.display()
                    )
                })?;
                if let Err(err) = repopulate_local_upload_cache(file_id, &restored_bytes) {
                    warn!(
                        file_id,
                        error = %err,
                        "Failed to repopulate openfang upload cache from restored image"
                    );
                }
                (restored_bytes, restored_path)
            }
        };
        let mime_type = detect_image_mime_from_path_or_bytes(path_for_mime.to_str(), &bytes)
            .ok_or_else(|| format!("Unsupported uploaded {label} image format: {}", image_url))?;
        return Ok(LoadedImageEditSource {
            bytes,
            mime_type: mime_type.to_string(),
        });
    }

    if !(image_url.starts_with("http://") || image_url.starts_with("https://")) {
        return Err(format!(
            "Unsupported {label} image_url '{}'. Use image_path, /api/uploads/... or http(s) URL.",
            image_url
        ));
    }

    let response = client
        .get(image_url)
        .header(USER_AGENT, crate::USER_AGENT)
        .send()
        .await
        .map_err(|err| format!("Failed to fetch {label} image URL '{}': {err}", image_url))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "{label} image URL fetch failed ({}): {}",
            status,
            body.trim()
        ));
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(normalize_image_mime_type)
        .map(str::to_string);
    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("Failed to read {label} image URL bytes: {err}"))?
        .to_vec();
    let resolved_mime = content_type
        .or_else(|| detect_image_mime_from_path_or_bytes(None, &bytes).map(str::to_string))
        .ok_or_else(|| format!("Unsupported remote {label} image format: {}", image_url))?;
    Ok(LoadedImageEditSource {
        bytes,
        mime_type: resolved_mime,
    })
}

fn compose_reference_sheet(
    primary: &LoadedImageEditSource,
    reference: &LoadedImageEditSource,
) -> Result<LoadedImageEditSource, String> {
    let primary_image = decode_dynamic_image(&primary.bytes, "primary")?;
    let reference_image = decode_dynamic_image(&reference.bytes, "reference")?;
    let target_height = primary_image
        .height()
        .max(reference_image.height())
        .max(512);

    let resized_primary = primary_image.resize(u32::MAX, target_height, FilterType::Lanczos3);
    let resized_reference = reference_image.resize(u32::MAX, target_height, FilterType::Lanczos3);

    let gap = 24;
    let padding = 24;
    let canvas_width = resized_primary
        .width()
        .saturating_add(resized_reference.width())
        .saturating_add(gap)
        .saturating_add(padding * 2);
    let canvas_height = target_height.saturating_add(padding * 2);
    let mut canvas = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(
        canvas_width,
        canvas_height,
        Rgba([245, 245, 245, 255]),
    ));

    canvas
        .copy_from(&resized_primary.to_rgba8(), padding, padding)
        .map_err(|_| "Failed to place primary image into reference sheet".to_string())?;
    canvas
        .copy_from(
            &resized_reference.to_rgba8(),
            padding + resized_primary.width() + gap,
            padding,
        )
        .map_err(|_| "Failed to place reference image into reference sheet".to_string())?;

    let mut encoded = std::io::Cursor::new(Vec::new());
    canvas
        .write_to(&mut encoded, ImageFormat::Png)
        .map_err(|err| format!("Failed to encode reference sheet PNG: {err}"))?;
    Ok(LoadedImageEditSource {
        bytes: encoded.into_inner(),
        mime_type: "image/png".to_string(),
    })
}

fn decode_dynamic_image(bytes: &[u8], label: &str) -> Result<DynamicImage, String> {
    image::load_from_memory(bytes).map_err(|err| {
        format!("Failed to decode {label} image for reference-sheet composition: {err}")
    })
}

fn extract_local_upload_id(image_url: &str) -> Option<&str> {
    let trimmed = image_url.trim();
    trimmed
        .strip_prefix("/api/uploads/")
        .or_else(|| trimmed.strip_prefix("api/uploads/"))
        .or_else(|| {
            let marker = "/api/uploads/";
            let index = trimmed.find(marker)?;
            let rest = &trimmed[index + marker.len()..];
            let id = rest.split(['/', '?', '#']).next()?;
            if id.is_empty() {
                None
            } else {
                Some(id)
            }
        })
        .filter(|value| !value.is_empty())
}

fn repopulate_local_upload_cache(file_id: &str, bytes: &[u8]) -> Result<(), String> {
    let upload_dir = env::temp_dir().join("openfang_uploads");
    fs::create_dir_all(&upload_dir)
        .map_err(|err| format!("Failed to recreate upload cache directory: {err}"))?;
    fs::write(upload_dir.join(file_id), bytes)
        .map_err(|err| format!("Failed to write restored upload cache file: {err}"))
}

fn recover_persisted_upload_path(file_id: &str) -> Option<PathBuf> {
    for workspaces_dir in runtime_workspace_roots() {
        if !workspaces_dir.exists() {
            continue;
        }

        let Ok(entries) = fs::read_dir(&workspaces_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let workspace_path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }

            let sessions_dir = workspace_path.join("sessions");
            if !sessions_dir.exists() {
                continue;
            }

            if let Some(path) = recover_persisted_upload_path_from_sessions(&sessions_dir, file_id)
            {
                return Some(path);
            }
        }
    }

    None
}

fn recover_persisted_upload_path_from_sessions(
    sessions_dir: &Path,
    file_id: &str,
) -> Option<PathBuf> {
    let entries = fs::read_dir(sessions_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }

        let Ok(file) = fs::File::open(&path) else {
            continue;
        };
        let reader = BufReader::new(file);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(saved_path) =
                recover_persisted_upload_path_from_session_line(&line, file_id)
            {
                return Some(saved_path);
            }
        }
    }
    None
}

fn recover_persisted_upload_path_from_session_line(line: &str, file_id: &str) -> Option<PathBuf> {
    let payload = serde_json::from_str::<Value>(line).ok()?;
    let tool_use_entries = payload.get("tool_use")?.as_array()?;
    for entry in tool_use_entries {
        let Some(content) = entry.get("content").and_then(Value::as_str) else {
            continue;
        };
        if let Some(path) = recover_persisted_upload_path_from_tool_result(content, file_id) {
            return Some(path);
        }
    }
    None
}

fn recover_persisted_upload_path_from_tool_result(content: &str, file_id: &str) -> Option<PathBuf> {
    let payload = serde_json::from_str::<Value>(content).ok()?;
    let image_urls = payload.get("image_urls")?.as_array()?;
    let saved_to = payload.get("saved_to")?.as_array()?;

    for (image_url, saved_path) in image_urls.iter().zip(saved_to.iter()) {
        let Some(image_url) = image_url.as_str() else {
            continue;
        };
        let Some(saved_path) = saved_path.as_str() else {
            continue;
        };
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

fn runtime_workspace_roots() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(path) = env::var_os("WEBOT_HOME").filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(path).join("workspaces"));
    }
    if let Some(path) = env::var_os("OPENFANG_HOME").filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(path).join("workspaces"));
    }

    let runtime_home = runtime_image_generation_home_dir();
    candidates.push(runtime_home.join("workspaces"));

    let user_home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir);
    candidates.push(user_home.join(".webot").join("workspaces"));
    candidates.push(user_home.join(".openfang").join("workspaces"));

    let mut deduped = Vec::new();
    for candidate in candidates {
        if deduped.iter().any(|existing| existing == &candidate) {
            continue;
        }
        deduped.push(candidate);
    }
    deduped
}

fn normalize_image_mime_type(value: &str) -> Option<&'static str> {
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "image/png" | "png" => Some("image/png"),
        "image/jpeg" | "image/jpg" | "jpg" | "jpeg" => Some("image/jpeg"),
        "image/webp" | "webp" => Some("image/webp"),
        "image/gif" | "gif" => Some("image/gif"),
        "image/bmp" | "bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn extension_from_mime_type(mime_type: &str) -> Option<&'static str> {
    match normalize_image_mime_type(mime_type)? {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        "image/bmp" => Some("bmp"),
        _ => None,
    }
}

fn detect_image_mime_from_path_or_bytes(path: Option<&str>, bytes: &[u8]) -> Option<&'static str> {
    if let Some(path) = path {
        let extension = Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if let Some(mime_type) = normalize_image_mime_type(extension) {
            return Some(mime_type);
        }
    }

    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("image/bmp");
    }

    None
}

fn parse_openai_like_result(result: &Value, model_name: &str) -> Result<ImageGenResult, String> {
    let mut images = Vec::new();
    let mut revised_prompt = None;

    if let Some(data) = result.get("data").and_then(Value::as_array) {
        for item in data {
            let b64 = item
                .get("b64_json")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let url = item
                .get("url")
                .and_then(Value::as_str)
                .map(|s| s.to_string());

            if b64.len() > MAX_BASE64_BYTES {
                warn!("Generated image data exceeds 10MB, skipping");
                continue;
            }
            if b64.is_empty() && url.is_none() {
                continue;
            }

            images.push(GeneratedImage {
                data_base64: b64,
                url,
            });

            if revised_prompt.is_none() {
                revised_prompt = item
                    .get("revised_prompt")
                    .and_then(Value::as_str)
                    .map(|s| s.to_string());
            }
        }
    }

    if images.is_empty() {
        return Err("No images returned by the API".into());
    }

    Ok(ImageGenResult {
        images,
        model: model_name.to_string(),
        revised_prompt,
    })
}

fn build_http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|err| format!("创建图片生成客户端失败: {err}"))
}

fn join_endpoint(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn runtime_image_generation_home_dir() -> PathBuf {
    if let Some(path) = env::var_os("WEBOT_HOME").filter(|value| !value.is_empty()) {
        return PathBuf::from(path);
    }
    if let Some(path) = env::var_os("OPENFANG_HOME").filter(|value| !value.is_empty()) {
        return PathBuf::from(path);
    }

    let user_home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir);
    let webot_home = user_home.join(".webot");
    let legacy_openfang_home = user_home.join(".openfang");

    if webot_home.join("image-generation.json").exists() || webot_home.exists() {
        webot_home
    } else {
        legacy_openfang_home
    }
}

fn service_url_path() -> PathBuf {
    runtime_image_generation_home_dir().join("service-url.txt")
}

fn local_image_service_base_url() -> String {
    if let Ok(url) = env::var("WEBOT_SERVICE_BASE_URL") {
        let trimmed = url.trim();
        if !trimmed.is_empty() {
            return trimmed.trim_end_matches('/').to_string();
        }
    }

    if let Ok(content) = fs::read_to_string(service_url_path()) {
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            return trimmed.trim_end_matches('/').to_string();
        }
    }

    "http://127.0.0.1:4310".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_image_edit_instruction_prompt_adds_preservation_rules() {
        let prompt = build_image_edit_instruction_prompt(
            "只把耳环换成细链款",
            ImageEditWorkflowKind::SingleSourceEdit,
        );
        assert!(
            prompt.contains("Edit the provided source image instead of creating a brand-new image")
        );
        assert!(prompt.contains("Everything not explicitly requested must remain unchanged"));
        assert!(prompt.contains("只把耳环换成细链款"));
    }

    #[test]
    fn test_build_image_edit_instruction_prompt_for_reference_merge_marks_left_right_roles() {
        let prompt = build_image_edit_instruction_prompt(
            "以第一张图为主，把第二张图里的衣服穿到主图人物身上",
            ImageEditWorkflowKind::BaseWithReferenceMerge,
        );
        assert!(prompt.contains("LEFT panel is the base image"));
        assert!(prompt.contains("RIGHT panel is a reference image"));
        assert!(prompt.contains("Do not output a collage"));
    }

    #[test]
    fn test_extract_local_upload_id_supports_relative_and_absolute_urls() {
        assert_eq!(
            extract_local_upload_id("/api/uploads/abc-123"),
            Some("abc-123")
        );
        assert_eq!(
            extract_local_upload_id("http://127.0.0.1:4310/api/uploads/def-456?x=1"),
            Some("def-456")
        );
        assert_eq!(extract_local_upload_id("C:\\temp\\foo.png"), None);
    }

    #[test]
    fn test_is_local_management_media_path_matches_management_avatar_and_portrait() {
        assert!(is_local_management_media_path(
            "/api/management/agents/demo-agent/portrait/portrait-1.png"
        ));
        assert!(is_local_management_media_path(
            "http://127.0.0.1:4310/api/management/agents/demo-agent/avatar/avatar-1.png?x=1"
        ));
        assert!(!is_local_management_media_path(
            "/api/management/agents/demo-agent/context-files/TOOLS.md"
        ));
    }

    #[test]
    fn test_parse_openai_like_result_collects_images() {
        let payload = json!({
            "data": [
                {
                    "b64_json": "aGVsbG8=",
                    "revised_prompt": "revised"
                }
            ]
        });
        let result = parse_openai_like_result(&payload, "gpt-image-1").unwrap();
        assert_eq!(result.model, "gpt-image-1");
        assert_eq!(result.images.len(), 1);
        assert_eq!(result.revised_prompt.as_deref(), Some("revised"));
    }
}
