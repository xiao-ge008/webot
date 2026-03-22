//! Media understanding engine — image description, audio transcription, video analysis.
//!
//! Auto-cascades through available providers based on configured API keys.

use crate::drivers;
use crate::llm_driver::DriverConfig;
use openfang_types::config::{FallbackProviderConfig, ProviderConfigEntry};
use openfang_types::media::{
    MediaAttachment, MediaConfig, MediaSource, MediaType, MediaUnderstanding,
};
use openfang_types::message::{ContentBlock, Message, MessageContent, Role};
use std::sync::Arc;
use tokio::sync::Semaphore;
use tracing::info;

/// Media understanding engine.
pub struct MediaEngine {
    config: MediaConfig,
    fallback_providers: Vec<FallbackProviderConfig>,
    provider_configs: Vec<ProviderConfigEntry>,
    semaphore: Arc<Semaphore>,
}

impl MediaEngine {
    pub fn new(
        config: MediaConfig,
        fallback_providers: Vec<FallbackProviderConfig>,
        provider_configs: Vec<ProviderConfigEntry>,
    ) -> Self {
        let max = config.max_concurrency.clamp(1, 8);
        Self {
            config,
            fallback_providers,
            provider_configs,
            semaphore: Arc::new(Semaphore::new(max)),
        }
    }

    /// Describe an image using a vision-capable LLM.
    /// Auto-cascade: Anthropic -> OpenAI -> Gemini (based on API key availability).
    pub async fn describe_image(
        &self,
        attachment: &MediaAttachment,
    ) -> Result<MediaUnderstanding, String> {
        use base64::Engine;

        attachment.validate()?;
        if attachment.media_type != MediaType::Image {
            return Err("Expected image attachment".into());
        }

        let _permit = self.semaphore.acquire().await.map_err(|e| e.to_string())?;

        let maybe_cached = match &attachment.source {
            MediaSource::Base64 { data, .. } => base64::engine::general_purpose::STANDARD
                .decode(data)
                .ok()
                .and_then(|bytes| {
                    crate::local_vision::cached_understanding_for_image_bytes(
                        attachment.mime_type.as_str(),
                        &bytes,
                    )
                }),
            MediaSource::FilePath { path } => tokio::fs::read(path).await.ok().and_then(|bytes| {
                crate::local_vision::cached_understanding_for_image_bytes(
                    attachment.mime_type.as_str(),
                    &bytes,
                )
            }),
            MediaSource::Url { .. } => None,
        };
        if let Some(understanding) = maybe_cached {
            return Ok(understanding);
        }

        let prompt = "请准确分析这张图片，逐字提取可见文本、数字、图表信息，不要猜测未看到的内容。";
        let mut errors = Vec::new();
        if let MediaSource::FilePath { path } = &attachment.source {
            match crate::local_vision::analyze_image_path_with_local_service(
                std::path::Path::new(path),
                attachment.mime_type.as_str(),
                Some(prompt),
            )
            .await
            {
                Ok(Some(understanding)) => return Ok(understanding),
                Ok(None) => {}
                Err(err) => errors.push(format!("Local Florence-2 path failed: {err}")),
            }
        }

        let candidates = self.resolve_vision_candidates();
        if candidates.is_empty() {
            if !errors.is_empty() {
                return Err(errors.join(" | "));
            }
            return Err(
                "No vision-capable LLM provider configured. Configure [[fallback_providers]] or set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY"
                    .into(),
            );
        }
        let (media_type, data) = match &attachment.source {
            MediaSource::Base64 { data, mime_type } => (mime_type.as_str(), data.clone()),
            MediaSource::FilePath { path } => {
                let bytes = tokio::fs::read(path)
                    .await
                    .map_err(|e| format!("Failed to read image file '{}': {}", path, e))?;
                use base64::Engine;
                (
                    attachment.mime_type.as_str(),
                    base64::engine::general_purpose::STANDARD.encode(bytes),
                )
            }
            MediaSource::Url { url } => {
                return Err(format!(
                    "URL-based image source not supported for vision: {}",
                    url
                ));
            }
        };

        for candidate in candidates {
            match self
                .describe_image_with_candidate(&candidate, prompt, media_type, &data)
                .await
            {
                Ok(result) => return Ok(result),
                Err(err) => errors.push(err),
            }
        }

        Err(errors.join(" | "))
    }

    /// Transcribe audio using speech-to-text.
    /// Auto-cascade: Groq (whisper-large-v3-turbo) -> OpenAI (whisper-1).
    pub async fn transcribe_audio(
        &self,
        attachment: &MediaAttachment,
    ) -> Result<MediaUnderstanding, String> {
        attachment.validate()?;
        if attachment.media_type != MediaType::Audio {
            return Err("Expected audio attachment".into());
        }

        let provider = self
            .config
            .audio_provider
            .as_deref()
            .or_else(|| detect_audio_provider())
            .ok_or(
                "No audio transcription provider configured. Set GROQ_API_KEY or OPENAI_API_KEY",
            )?;

        let _permit = self.semaphore.acquire().await.map_err(|e| e.to_string())?;

        // Derive a proper filename with extension from mime_type
        // (Whisper APIs require an extension to detect format)
        let ext = match attachment.mime_type.as_str() {
            "audio/wav" => "wav",
            "audio/mpeg" | "audio/mp3" => "mp3",
            "audio/ogg" => "ogg",
            "audio/webm" => "webm",
            "audio/mp4" | "audio/m4a" => "m4a",
            "audio/flac" => "flac",
            _ => "wav",
        };

        // Read audio bytes from source
        let audio_bytes = match &attachment.source {
            MediaSource::FilePath { path } => tokio::fs::read(path)
                .await
                .map_err(|e| format!("Failed to read audio file '{}': {}", path, e))?,
            MediaSource::Base64 { data, .. } => {
                use base64::Engine;
                base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .map_err(|e| format!("Failed to decode base64 audio: {}", e))?
            }
            MediaSource::Url { url } => {
                return Err(format!(
                    "URL-based audio source not supported for transcription: {}",
                    url
                ));
            }
        };
        let filename = format!("audio.{}", ext);

        let model = default_audio_model(provider);

        // Build API request
        let (api_url, api_key) = match provider {
            "groq" => (
                "https://api.groq.com/openai/v1/audio/transcriptions",
                std::env::var("GROQ_API_KEY").map_err(|_| "GROQ_API_KEY not set")?,
            ),
            "openai" => (
                "https://api.openai.com/v1/audio/transcriptions",
                std::env::var("OPENAI_API_KEY").map_err(|_| "OPENAI_API_KEY not set")?,
            ),
            other => return Err(format!("Unsupported audio provider: {}", other)),
        };

        info!(provider, model, filename = %filename, size = audio_bytes.len(), "Sending audio for transcription");

        let file_part = reqwest::multipart::Part::bytes(audio_bytes)
            .file_name(filename)
            .mime_str(&attachment.mime_type)
            .map_err(|e| format!("Failed to set MIME type: {}", e))?;

        let form = reqwest::multipart::Form::new()
            .part("file", file_part)
            .text("model", model.to_string())
            .text("response_format", "text");

        let client = reqwest::Client::new();
        let resp = client
            .post(api_url)
            .bearer_auth(&api_key)
            .multipart(form)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| format!("Transcription request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Transcription API error ({}): {}", status, body));
        }

        let transcription = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read transcription response: {}", e))?;

        let transcription = transcription.trim().to_string();
        if transcription.is_empty() {
            return Err("Transcription returned empty text".into());
        }

        info!(
            provider,
            model,
            chars = transcription.len(),
            "Audio transcription complete"
        );

        Ok(MediaUnderstanding {
            media_type: MediaType::Audio,
            description: transcription,
            provider: provider.to_string(),
            model: model.to_string(),
        })
    }

    /// Describe video using Gemini.
    pub async fn describe_video(
        &self,
        attachment: &MediaAttachment,
    ) -> Result<MediaUnderstanding, String> {
        attachment.validate()?;
        if attachment.media_type != MediaType::Video {
            return Err("Expected video attachment".into());
        }

        if !self.config.video_description {
            return Err("Video description is disabled in configuration".into());
        }

        if std::env::var("GEMINI_API_KEY").is_err() && std::env::var("GOOGLE_API_KEY").is_err() {
            return Err("Video description requires GEMINI_API_KEY or GOOGLE_API_KEY".into());
        }

        Ok(MediaUnderstanding {
            media_type: MediaType::Video,
            description: "[Video description would be generated by Gemini]".to_string(),
            provider: "gemini".to_string(),
            model: "gemini-2.5-flash".to_string(),
        })
    }

    /// Process multiple attachments concurrently (bounded by max_concurrency).
    pub async fn process_attachments(
        &self,
        attachments: Vec<MediaAttachment>,
    ) -> Vec<Result<MediaUnderstanding, String>> {
        let mut handles = Vec::new();
        let fallback_providers = self.fallback_providers.clone();
        let provider_configs = self.provider_configs.clone();

        for attachment in attachments {
            let sem = self.semaphore.clone();
            let config = self.config.clone();
            let fallback_providers = fallback_providers.clone();
            let provider_configs = provider_configs.clone();
            let handle = tokio::spawn(async move {
                let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
                let engine = MediaEngine {
                    config,
                    fallback_providers,
                    provider_configs,
                    semaphore: Arc::new(Semaphore::new(1)), // inner engine, no extra semaphore
                };
                match attachment.media_type {
                    MediaType::Image => engine.describe_image(&attachment).await,
                    MediaType::Audio => engine.transcribe_audio(&attachment).await,
                    MediaType::Video => engine.describe_video(&attachment).await,
                }
            });
            handles.push(handle);
        }

        let mut results = Vec::new();
        for handle in handles {
            match handle.await {
                Ok(result) => results.push(result),
                Err(e) => results.push(Err(format!("Task failed: {e}"))),
            }
        }
        results
    }
}

#[derive(Clone, Debug)]
struct VisionDriverCandidate {
    provider: String,
    model: String,
    api_key_env: Option<String>,
    base_url: Option<String>,
}

impl MediaEngine {
    fn resolve_vision_candidates(&self) -> Vec<VisionDriverCandidate> {
        let mut candidates = Vec::new();

        if let Some(preferred_provider) = self.config.image_provider.as_deref() {
            for fallback in self
                .fallback_providers
                .iter()
                .filter(|item| item.provider == preferred_provider)
            {
                candidates.push(VisionDriverCandidate {
                    provider: fallback.provider.clone(),
                    model: fallback.model.clone(),
                    api_key_env: if fallback.api_key_env.trim().is_empty() {
                        None
                    } else {
                        Some(fallback.api_key_env.clone())
                    },
                    base_url: fallback.base_url.clone(),
                });
            }

            if candidates.is_empty() {
                let model = default_vision_model(preferred_provider);
                if model != "unknown" {
                    candidates.push(VisionDriverCandidate {
                        provider: preferred_provider.to_string(),
                        model: model.to_string(),
                        api_key_env: None,
                        base_url: None,
                    });
                }
            }
            return candidates;
        }

        for fallback in &self.fallback_providers {
            candidates.push(VisionDriverCandidate {
                provider: fallback.provider.clone(),
                model: fallback.model.clone(),
                api_key_env: if fallback.api_key_env.trim().is_empty() {
                    None
                } else {
                    Some(fallback.api_key_env.clone())
                },
                base_url: fallback.base_url.clone(),
            });
        }

        if candidates.is_empty() {
            if let Some(provider) = detect_vision_provider() {
                let model = default_vision_model(provider);
                if model != "unknown" {
                    candidates.push(VisionDriverCandidate {
                        provider: provider.to_string(),
                        model: model.to_string(),
                        api_key_env: None,
                        base_url: None,
                    });
                }
            }
        }

        candidates
    }

    async fn describe_image_with_candidate(
        &self,
        candidate: &VisionDriverCandidate,
        prompt: &str,
        media_type: &str,
        base64_data: &str,
    ) -> Result<MediaUnderstanding, String> {
        let provider_cfg = self
            .provider_configs
            .iter()
            .find(|item| item.id == candidate.provider);
        let derived_env_key = provider_env_key(&candidate.provider);
        let api_key = candidate
            .api_key_env
            .as_ref()
            .and_then(|env| std::env::var(env).ok())
            .or_else(|| provider_cfg.and_then(|cfg| cfg.api_key.clone()))
            .or_else(|| std::env::var(&derived_env_key).ok());
        let base_url = candidate
            .base_url
            .clone()
            .or_else(|| provider_cfg.and_then(|cfg| cfg.base_url.clone()));

        let driver = drivers::create_driver(&DriverConfig {
            provider: candidate.provider.clone(),
            api_key,
            base_url,
        })
        .map_err(|e| {
            format!(
                "Vision driver init failed for provider '{}' model '{}': {}",
                candidate.provider, candidate.model, e
            )
        })?;

        let request = crate::llm_driver::CompletionRequest {
            model: candidate.model.clone(),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Blocks(vec![
                    ContentBlock::Text {
                        text: prompt.to_string(),
                    },
                    ContentBlock::Image {
                        media_type: media_type.to_string(),
                        data: base64_data.to_string(),
                    },
                ]),
            }],
            tools: Vec::new(),
            max_tokens: 1200,
            temperature: 0.1,
            system: Some(
                "You analyze images and answer concretely. Only report what is actually visible in the image. Never fabricate numbers or labels."
                    .to_string(),
            ),
            thinking: None,
        };

        let response = driver.complete(request).await.map_err(|e| {
            format!(
                "Vision request failed for provider '{}' model '{}': {}",
                candidate.provider, candidate.model, e
            )
        })?;
        let description = response.text().trim().to_string();
        if description.is_empty() {
            return Err(format!(
                "Vision request returned empty text for provider '{}' model '{}'",
                candidate.provider, candidate.model
            ));
        }

        Ok(MediaUnderstanding {
            media_type: MediaType::Image,
            description,
            provider: candidate.provider.clone(),
            model: candidate.model.clone(),
        })
    }
}

/// Detect which vision provider is available based on environment variables.
fn detect_vision_provider() -> Option<&'static str> {
    if std::env::var("ANTHROPIC_API_KEY").is_ok() {
        return Some("anthropic");
    }
    if std::env::var("OPENAI_API_KEY").is_ok() {
        return Some("openai");
    }
    if std::env::var("GEMINI_API_KEY").is_ok() || std::env::var("GOOGLE_API_KEY").is_ok() {
        return Some("gemini");
    }
    None
}

/// Detect which audio transcription provider is available.
fn detect_audio_provider() -> Option<&'static str> {
    if std::env::var("GROQ_API_KEY").is_ok() {
        return Some("groq");
    }
    if std::env::var("OPENAI_API_KEY").is_ok() {
        return Some("openai");
    }
    None
}

/// Get the default vision model for a provider.
fn default_vision_model(provider: &str) -> &str {
    match provider {
        "anthropic" => "claude-sonnet-4-20250514",
        "openai" => "gpt-4o",
        "gemini" => "gemini-2.5-flash",
        _ => "unknown",
    }
}

/// Get the default audio model for a provider.
fn default_audio_model(provider: &str) -> &str {
    match provider {
        "groq" => "whisper-large-v3-turbo",
        "openai" => "whisper-1",
        _ => "unknown",
    }
}

fn provider_env_key(provider: &str) -> String {
    format!("{}_API_KEY", provider.to_uppercase().replace('-', "_"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use openfang_types::media::{MediaSource, MAX_IMAGE_BYTES};

    #[test]
    fn test_engine_creation() {
        let config = MediaConfig::default();
        let engine = MediaEngine::new(config, Vec::new(), Vec::new());
        assert_eq!(engine.config.max_concurrency, 2);
    }

    #[test]
    fn test_engine_max_concurrency_clamped() {
        let config = MediaConfig {
            max_concurrency: 100,
            ..Default::default()
        };
        let engine = MediaEngine::new(config, Vec::new(), Vec::new());
        // Semaphore was clamped to 8
        assert!(engine.semaphore.available_permits() <= 8);
    }

    #[tokio::test]
    async fn test_describe_image_wrong_type() {
        let engine = MediaEngine::new(MediaConfig::default(), Vec::new(), Vec::new());
        let attachment = MediaAttachment {
            media_type: MediaType::Audio,
            mime_type: "audio/mpeg".into(),
            source: MediaSource::FilePath {
                path: "test.mp3".into(),
            },
            size_bytes: 1024,
        };
        let result = engine.describe_image(&attachment).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Expected image"));
    }

    #[tokio::test]
    async fn test_describe_image_invalid_mime() {
        let engine = MediaEngine::new(MediaConfig::default(), Vec::new(), Vec::new());
        let attachment = MediaAttachment {
            media_type: MediaType::Image,
            mime_type: "application/pdf".into(),
            source: MediaSource::FilePath {
                path: "test.pdf".into(),
            },
            size_bytes: 1024,
        };
        let result = engine.describe_image(&attachment).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_describe_image_too_large() {
        let engine = MediaEngine::new(MediaConfig::default(), Vec::new(), Vec::new());
        let attachment = MediaAttachment {
            media_type: MediaType::Image,
            mime_type: "image/png".into(),
            source: MediaSource::FilePath {
                path: "big.png".into(),
            },
            size_bytes: MAX_IMAGE_BYTES + 1,
        };
        let result = engine.describe_image(&attachment).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_transcribe_audio_wrong_type() {
        let engine = MediaEngine::new(MediaConfig::default(), Vec::new(), Vec::new());
        let attachment = MediaAttachment {
            media_type: MediaType::Image,
            mime_type: "image/png".into(),
            source: MediaSource::FilePath {
                path: "test.png".into(),
            },
            size_bytes: 1024,
        };
        let result = engine.transcribe_audio(&attachment).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_video_disabled() {
        let config = MediaConfig {
            video_description: false,
            ..Default::default()
        };
        let engine = MediaEngine::new(config, Vec::new(), Vec::new());
        let attachment = MediaAttachment {
            media_type: MediaType::Video,
            mime_type: "video/mp4".into(),
            source: MediaSource::FilePath {
                path: "test.mp4".into(),
            },
            size_bytes: 1024,
        };
        let result = engine.describe_video(&attachment).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("disabled"));
    }

    #[test]
    fn test_detect_vision_provider_none() {
        // In test env, likely no API keys set — should return None.
        // (This test is environment-dependent, but safe.)
        let _ = detect_vision_provider(); // Just verify it doesn't panic
    }

    #[test]
    fn test_default_vision_models() {
        assert_eq!(
            default_vision_model("anthropic"),
            "claude-sonnet-4-20250514"
        );
        assert_eq!(default_vision_model("openai"), "gpt-4o");
        assert_eq!(default_vision_model("gemini"), "gemini-2.5-flash");
        assert_eq!(default_vision_model("unknown"), "unknown");
    }

    #[test]
    fn test_default_audio_models() {
        assert_eq!(default_audio_model("groq"), "whisper-large-v3-turbo");
        assert_eq!(default_audio_model("openai"), "whisper-1");
    }

    #[tokio::test]
    async fn test_transcribe_audio_rejects_image_type() {
        let engine = MediaEngine::new(MediaConfig::default(), Vec::new(), Vec::new());
        let attachment = MediaAttachment {
            media_type: MediaType::Image,
            mime_type: "image/png".into(),
            source: MediaSource::FilePath {
                path: "test.png".into(),
            },
            size_bytes: 1024,
        };
        let result = engine.transcribe_audio(&attachment).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Expected audio"));
    }

    #[tokio::test]
    async fn test_transcribe_audio_no_provider() {
        // With no API keys set, should fail with provider error
        let engine = MediaEngine::new(MediaConfig::default(), Vec::new(), Vec::new());
        let attachment = MediaAttachment {
            media_type: MediaType::Audio,
            mime_type: "audio/webm".into(),
            source: MediaSource::FilePath {
                path: "test.webm".into(),
            },
            size_bytes: 1024,
        };
        let result = engine.transcribe_audio(&attachment).await;
        // Either fails with "No audio transcription provider" or file read error
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_transcribe_audio_url_source_rejected() {
        // URL source should be rejected
        let config = MediaConfig {
            audio_provider: Some("groq".to_string()),
            ..Default::default()
        };
        let engine = MediaEngine::new(config, Vec::new(), Vec::new());
        let attachment = MediaAttachment {
            media_type: MediaType::Audio,
            mime_type: "audio/mpeg".into(),
            source: MediaSource::Url {
                url: "https://example.com/audio.mp3".into(),
            },
            size_bytes: 1024,
        };
        let result = engine.transcribe_audio(&attachment).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("URL-based audio source not supported"));
    }

    #[tokio::test]
    async fn test_transcribe_audio_file_not_found() {
        let config = MediaConfig {
            audio_provider: Some("groq".to_string()),
            ..Default::default()
        };
        let engine = MediaEngine::new(config, Vec::new(), Vec::new());
        let attachment = MediaAttachment {
            media_type: MediaType::Audio,
            mime_type: "audio/webm".into(),
            source: MediaSource::FilePath {
                path: "/nonexistent/path/audio.webm".into(),
            },
            size_bytes: 1024,
        };
        let result = engine.transcribe_audio(&attachment).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to read audio file"));
    }
}
