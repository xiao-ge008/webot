use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use openfang_types::media::{MediaType, MediaUnderstanding};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const WEBOT_HOME_DIR_NAME: &str = ".webot";
const FLORENCE_PROVIDER: &str = "florence2";
const FLORENCE_MODEL_ID: &str = "laub/Florence-2-large-PromptGen-v2.0-onnx";
const LEGACY_FLORENCE_MODEL_ID: &str = "onnx-community/Florence-2-large-ft";
const DEFAULT_SERVICE_BASE_URL: &str = "http://127.0.0.1:4310";

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VisionAnalysisConfig {
    #[serde(default)]
    enabled: bool,
    #[serde(default = "default_cache_enabled")]
    cache_enabled: bool,
    #[serde(default = "default_provider")]
    provider: String,
    #[serde(default = "default_model_id")]
    model_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VisionCacheRecord {
    sha256: String,
    summary: String,
    #[serde(default)]
    provider: String,
    #[serde(default)]
    model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeVisionImageRequest {
    image_path: String,
    mime_type: String,
    source: String,
    user_text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeVisionImageEnvelope {
    analysis: AnalyzeVisionImageResponse,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeVisionImageResponse {
    sha256: String,
    summary: String,
    provider: String,
    model: String,
}

fn default_cache_enabled() -> bool {
    true
}

fn default_provider() -> String {
    FLORENCE_PROVIDER.to_string()
}

fn default_model_id() -> String {
    FLORENCE_MODEL_ID.to_string()
}

fn user_home_dir() -> Option<PathBuf> {
    env::var_os("WEBOT_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("USERPROFILE")
                .map(PathBuf::from)
                .map(|path| path.join(WEBOT_HOME_DIR_NAME))
        })
        .or_else(|| {
            env::var_os("HOME")
                .map(PathBuf::from)
                .map(|path| path.join(WEBOT_HOME_DIR_NAME))
        })
}

fn vision_analysis_config_path() -> Option<PathBuf> {
    user_home_dir().map(|path| path.join("vision-analysis.json"))
}

fn service_url_path() -> Option<PathBuf> {
    user_home_dir().map(|path| path.join("service-url.txt"))
}

fn vision_cache_dir() -> Option<PathBuf> {
    user_home_dir().map(|path| path.join("shared").join("data").join("vision-cache"))
}

fn read_vision_analysis_config() -> Option<VisionAnalysisConfig> {
    let path = vision_analysis_config_path()?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<VisionAnalysisConfig>(&content).ok()
}

fn normalize_provider(provider: &str) -> String {
    let trimmed = provider.trim();
    if trimmed.is_empty() {
        FLORENCE_PROVIDER.to_string()
    } else {
        trimmed.to_ascii_lowercase()
    }
}

fn normalize_model(model: &str) -> String {
    let trimmed = model.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case(LEGACY_FLORENCE_MODEL_ID) {
        FLORENCE_MODEL_ID.to_string()
    } else {
        trimmed.to_string()
    }
}

fn cache_record_path(sha256: &str) -> Option<PathBuf> {
    vision_cache_dir().map(|path| path.join(format!("{sha256}.json")))
}

fn service_base_url() -> String {
    if let Ok(url) = env::var("WEBOT_SERVICE_BASE_URL") {
        let trimmed = url.trim();
        if !trimmed.is_empty() {
            return trimmed.trim_end_matches('/').to_string();
        }
    }
    if let Some(path) = service_url_path() {
        if let Ok(content) = fs::read_to_string(path) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                return trimmed.trim_end_matches('/').to_string();
            }
        }
    }
    DEFAULT_SERVICE_BASE_URL.to_string()
}

pub fn cached_understanding_for_image_bytes(
    mime_type: &str,
    data: &[u8],
) -> Option<MediaUnderstanding> {
    let config = read_vision_analysis_config()?;
    if !config.enabled || !config.cache_enabled {
        return None;
    }
    if normalize_provider(&config.provider) != FLORENCE_PROVIDER {
        return None;
    }

    let sha256 = format!("{:x}", Sha256::digest(data));
    let path = cache_record_path(&sha256)?;
    let content = fs::read_to_string(path).ok()?;
    let record = serde_json::from_str::<VisionCacheRecord>(&content).ok()?;
    if record.sha256.trim().eq_ignore_ascii_case(&sha256) && !record.summary.trim().is_empty() {
        return Some(MediaUnderstanding {
            media_type: MediaType::Image,
            description: record.summary.trim().to_string(),
            provider: if record.provider.trim().is_empty() {
                FLORENCE_PROVIDER.to_string()
            } else {
                record.provider.trim().to_string()
            },
            model: if record.model.trim().is_empty() {
                normalize_model(&config.model_id)
            } else {
                record.model.trim().to_string()
            },
        });
    }

    let _ = mime_type;
    None
}

pub async fn analyze_image_path_with_local_service(
    path: &Path,
    mime_type: &str,
    user_text: Option<&str>,
) -> Result<Option<MediaUnderstanding>, String> {
    let config = match read_vision_analysis_config() {
        Some(config) => config,
        None => return Ok(None),
    };
    if !config.enabled || normalize_provider(&config.provider) != FLORENCE_PROVIDER {
        return Ok(None);
    }
    if !path.is_file() {
        return Err(format!("本地视觉图片不存在: {}", path.display()));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(240))
        .build()
        .map_err(|err| format!("创建本地视觉客户端失败: {err}"))?;
    let response = client
        .post(format!(
            "{}/api/management/vision-analysis/analyze",
            service_base_url()
        ))
        .json(&AnalyzeVisionImageRequest {
            image_path: path.to_string_lossy().to_string(),
            mime_type: mime_type.to_string(),
            source: "openfang-runtime".to_string(),
            user_text: user_text.unwrap_or_default().trim().to_string(),
        })
        .send()
        .await
        .map_err(|err| format!("请求本地 Florence-2 服务失败: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "本地 Florence-2 服务返回错误: HTTP {} {}",
            status, body
        ));
    }

    let payload = response
        .json::<AnalyzeVisionImageEnvelope>()
        .await
        .map_err(|err| format!("解析本地 Florence-2 响应失败: {err}"))?;
    let analysis = payload.analysis;
    if analysis.summary.trim().is_empty() {
        return Err("本地 Florence-2 未返回可用解析结果".to_string());
    }

    let _ = analysis.sha256;
    Ok(Some(MediaUnderstanding {
        media_type: MediaType::Image,
        description: analysis.summary.trim().to_string(),
        provider: if analysis.provider.trim().is_empty() {
            FLORENCE_PROVIDER.to_string()
        } else {
            analysis.provider.trim().to_string()
        },
        model: if analysis.model.trim().is_empty() {
            normalize_model(&config.model_id)
        } else {
            analysis.model.trim().to_string()
        },
    }))
}
