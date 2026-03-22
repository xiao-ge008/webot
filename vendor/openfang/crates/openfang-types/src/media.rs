//! Media understanding types — shared data structures for media processing.

use serde::{Deserialize, Serialize};

/// Supported media types for understanding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaType {
    Image,
    Audio,
    Video,
}

impl std::fmt::Display for MediaType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MediaType::Image => write!(f, "image"),
            MediaType::Audio => write!(f, "audio"),
            MediaType::Video => write!(f, "video"),
        }
    }
}

/// Source of media content.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum MediaSource {
    /// Path to a local file.
    FilePath { path: String },
    /// URL to fetch the media from (SSRF-checked).
    Url { url: String },
    /// Base64-encoded data.
    Base64 { data: String, mime_type: String },
}

/// A media attachment to be analyzed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaAttachment {
    /// What kind of media this is.
    pub media_type: MediaType,
    /// MIME type (e.g., "image/png", "audio/mp3").
    pub mime_type: String,
    /// Where to get the media data.
    pub source: MediaSource,
    /// File size in bytes (for validation).
    pub size_bytes: u64,
}

/// Result of media analysis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaUnderstanding {
    /// What type of media was analyzed.
    pub media_type: MediaType,
    /// Human-readable description or transcription.
    pub description: String,
    /// Which provider produced this result.
    pub provider: String,
    /// Which model was used.
    pub model: String,
}

/// Configuration for media understanding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct MediaConfig {
    /// Enable image description. Default: true.
    pub image_description: bool,
    /// Enable audio transcription. Default: true.
    pub audio_transcription: bool,
    /// Enable video description. Default: false (expensive).
    pub video_description: bool,
    /// Max concurrent media processing tasks. Default: 2.
    pub max_concurrency: usize,
    /// Preferred image description provider (auto-detect if None).
    pub image_provider: Option<String>,
    /// Preferred audio transcription provider (auto-detect if None).
    pub audio_provider: Option<String>,
}

impl Default for MediaConfig {
    fn default() -> Self {
        Self {
            image_description: true,
            audio_transcription: true,
            video_description: false,
            max_concurrency: 2,
            image_provider: None,
            audio_provider: None,
        }
    }
}

/// Configuration for link understanding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LinkConfig {
    /// Enable automatic link understanding. Default: false.
    pub enabled: bool,
    /// Max links to process per message. Default: 3.
    pub max_links: usize,
    /// Max content size to fetch per link in bytes. Default: 100KB.
    pub max_content_bytes: usize,
    /// Timeout per link fetch in seconds. Default: 10.
    pub timeout_secs: u64,
}

impl Default for LinkConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            max_links: 3,
            max_content_bytes: 102_400,
            timeout_secs: 10,
        }
    }
}

// ---------------------------------------------------------------------------
// Validation constants (SECURITY)
// ---------------------------------------------------------------------------

/// Maximum image size in bytes (10 MB).
pub const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
/// Maximum audio size in bytes (20 MB).
pub const MAX_AUDIO_BYTES: u64 = 20 * 1024 * 1024;
/// Maximum video size in bytes (50 MB).
pub const MAX_VIDEO_BYTES: u64 = 50 * 1024 * 1024;
/// Maximum base64 decoded size (70 MB).
pub const MAX_BASE64_DECODED_BYTES: u64 = 70 * 1024 * 1024;

/// Allowed image MIME types.
pub const ALLOWED_IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif"];

/// Allowed audio MIME types.
pub const ALLOWED_AUDIO_TYPES: &[&str] = &[
    "audio/mpeg",
    "audio/wav",
    "audio/ogg",
    "audio/mp4",
    "audio/webm",
    "audio/x-wav",
    "audio/flac",
];

/// Allowed video MIME types.
pub const ALLOWED_VIDEO_TYPES: &[&str] = &["video/mp4", "video/quicktime", "video/webm"];

impl MediaAttachment {
    /// Validate the attachment against security constraints.
    pub fn validate(&self) -> Result<(), String> {
        // Check MIME type allowlist
        let allowed = match self.media_type {
            MediaType::Image => ALLOWED_IMAGE_TYPES.contains(&self.mime_type.as_str()),
            MediaType::Audio => ALLOWED_AUDIO_TYPES.contains(&self.mime_type.as_str()),
            MediaType::Video => ALLOWED_VIDEO_TYPES.contains(&self.mime_type.as_str()),
        };
        if !allowed {
            return Err(format!(
                "Unsupported MIME type '{}' for {:?} media",
                self.mime_type, self.media_type
            ));
        }

        // Check size limits
        let max_bytes = match self.media_type {
            MediaType::Image => MAX_IMAGE_BYTES,
            MediaType::Audio => MAX_AUDIO_BYTES,
            MediaType::Video => MAX_VIDEO_BYTES,
        };
        if self.size_bytes > max_bytes {
            return Err(format!(
                "{} file too large: {} bytes (max {} bytes)",
                self.media_type, self.size_bytes, max_bytes
            ));
        }

        Ok(())
    }
}

/// Supported image generation models.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ImageGenModel {
    #[default]
    DallE3,
    DallE2,
    #[serde(rename = "gpt-image-1")]
    GptImage1,
}

impl std::fmt::Display for ImageGenModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImageGenModel::DallE3 => write!(f, "dall-e-3"),
            ImageGenModel::DallE2 => write!(f, "dall-e-2"),
            ImageGenModel::GptImage1 => write!(f, "gpt-image-1"),
        }
    }
}

/// Image generation request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenRequest {
    /// The prompt describing the image to generate.
    pub prompt: String,
    /// Optional negative prompt for providers that support it.
    #[serde(default)]
    pub negative_prompt: String,
    /// Which model to use.
    #[serde(default)]
    pub model: ImageGenModel,
    /// Image size (e.g., "1024x1024").
    #[serde(default = "default_image_size")]
    pub size: String,
    /// Explicit image width override.
    #[serde(default)]
    pub width: Option<u32>,
    /// Explicit image height override.
    #[serde(default)]
    pub height: Option<u32>,
    /// Quality level (e.g., "standard", "hd").
    #[serde(default = "default_image_quality")]
    pub quality: String,
    /// Number of images to generate (1-4, DALL-E 3 only supports 1).
    #[serde(default = "default_image_count")]
    pub count: u8,
}

fn default_image_size() -> String {
    "1024x1024".to_string()
}

fn default_image_quality() -> String {
    "standard".to_string()
}

fn default_image_count() -> u8 {
    1
}

fn default_image_edit_model() -> ImageGenModel {
    ImageGenModel::GptImage1
}

/// Allowed sizes per model.
pub const DALLE3_SIZES: &[&str] = &["1024x1024", "1792x1024", "1024x1792"];
pub const DALLE2_SIZES: &[&str] = &["256x256", "512x512", "1024x1024"];
pub const GPT_IMAGE1_SIZES: &[&str] = &["1024x1024", "1536x1024", "1024x1536"];

impl ImageGenRequest {
    /// Max prompt length in characters.
    pub const MAX_PROMPT_LEN: usize = 4000;

    /// Validate provider-agnostic fields.
    pub fn validate_common(&self) -> Result<(), String> {
        validate_prompt_text(&self.prompt, "Image generation prompt")?;
        validate_prompt_text(&self.negative_prompt, "Image generation negative prompt")?;

        match (self.width, self.height) {
            (Some(width), Some(height)) => {
                if width == 0 || height == 0 {
                    return Err("Image width and height must be greater than 0".into());
                }
            }
            (Some(_), None) | (None, Some(_)) => {
                return Err(
                    "Image width and height must both be provided when overriding dimensions"
                        .into(),
                );
            }
            (None, None) => {
                let _ = self.effective_size()?;
            }
        }

        Ok(())
    }

    /// Resolve the request to a concrete `WIDTHxHEIGHT` size string.
    pub fn effective_size(&self) -> Result<String, String> {
        match (self.width, self.height) {
            (Some(width), Some(height)) => Ok(format!("{width}x{height}")),
            (Some(_), None) | (None, Some(_)) => Err(
                "Image width and height must both be provided when overriding dimensions"
                    .to_string(),
            ),
            (None, None) => {
                let trimmed = self.size.trim();
                if trimmed.is_empty() {
                    Err("Image size cannot be empty".to_string())
                } else {
                    parse_size_string(trimmed)?;
                    Ok(trimmed.to_string())
                }
            }
        }
    }

    /// Resolve the request to concrete numeric dimensions.
    pub fn dimensions(&self) -> Result<(u32, u32), String> {
        match (self.width, self.height) {
            (Some(width), Some(height)) => Ok((width, height)),
            (Some(_), None) | (None, Some(_)) => Err(
                "Image width and height must both be provided when overriding dimensions"
                    .to_string(),
            ),
            (None, None) => parse_size_string(self.size.trim()),
        }
    }

    /// Validate the request against model-specific constraints.
    pub fn validate(&self) -> Result<(), String> {
        self.validate_common()?;
        let effective_size = self.effective_size()?;

        // Model-specific size validation
        let allowed_sizes = match self.model {
            ImageGenModel::DallE3 => DALLE3_SIZES,
            ImageGenModel::DallE2 => DALLE2_SIZES,
            ImageGenModel::GptImage1 => GPT_IMAGE1_SIZES,
        };
        if !allowed_sizes.contains(&effective_size.as_str()) {
            return Err(format!(
                "Invalid size '{}' for {}. Allowed: {:?}",
                effective_size, self.model, allowed_sizes
            ));
        }

        // Count validation
        match self.model {
            ImageGenModel::DallE3 => {
                if self.count != 1 {
                    return Err("DALL-E 3 only supports count=1".into());
                }
            }
            ImageGenModel::DallE2 | ImageGenModel::GptImage1 => {
                if self.count == 0 || self.count > 4 {
                    return Err(format!(
                        "Invalid count {} for {}. Must be 1-4",
                        self.count, self.model
                    ));
                }
            }
        }

        // Quality validation
        match self.model {
            ImageGenModel::DallE3 => {
                if self.quality != "standard" && self.quality != "hd" {
                    return Err(format!(
                        "Invalid quality '{}' for DALL-E 3. Must be 'standard' or 'hd'",
                        self.quality
                    ));
                }
            }
            _ => {
                if self.quality != "standard"
                    && self.quality != "auto"
                    && self.quality != "high"
                    && self.quality != "medium"
                    && self.quality != "low"
                {
                    return Err(format!(
                        "Invalid quality '{}'. Must be 'standard', 'auto', 'high', 'medium', or 'low'",
                        self.quality
                    ));
                }
            }
        }

        Ok(())
    }
}

/// Image edit request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageEditRequest {
    /// The text instruction describing how to modify the image.
    pub prompt: String,
    /// Optional negative prompt for providers that support it.
    #[serde(default)]
    pub negative_prompt: String,
    /// Which fallback model to use for direct OpenAI-compatible editing.
    #[serde(default = "default_image_edit_model")]
    pub model: ImageGenModel,
    /// Workspace/local image path.
    #[serde(default)]
    pub image_path: String,
    /// Remote or session image URL.
    #[serde(default)]
    pub image_url: String,
    /// Base64-encoded input image data.
    #[serde(default)]
    pub image_base64: String,
    /// MIME type for `image_base64`.
    #[serde(default)]
    pub mime_type: String,
    /// Output image size (e.g. "1024x1024").
    #[serde(default = "default_image_size")]
    pub size: String,
    /// Explicit output image width override.
    #[serde(default)]
    pub width: Option<u32>,
    /// Explicit output image height override.
    #[serde(default)]
    pub height: Option<u32>,
    /// Quality level for providers that support it.
    #[serde(default = "default_image_quality")]
    pub quality: String,
    /// Number of edited images to generate.
    #[serde(default = "default_image_count")]
    pub count: u8,
}

impl ImageEditRequest {
    /// Validate provider-agnostic fields.
    pub fn validate_common(&self) -> Result<(), String> {
        validate_prompt_text(&self.prompt, "Image edit prompt")?;
        validate_prompt_text(&self.negative_prompt, "Image edit negative prompt")?;
        self.validate_image_source()?;

        match (self.width, self.height) {
            (Some(width), Some(height)) => {
                if width == 0 || height == 0 {
                    return Err("Image width and height must be greater than 0".into());
                }
            }
            (Some(_), None) | (None, Some(_)) => {
                return Err(
                    "Image width and height must both be provided when overriding dimensions"
                        .into(),
                );
            }
            (None, None) => {
                let _ = self.effective_size()?;
            }
        }

        if self.count != 1 {
            return Err(format!(
                "Image editing currently only supports count=1, got {}",
                self.count
            ));
        }

        Ok(())
    }

    /// Validate the request against current-model fallback constraints.
    pub fn validate(&self) -> Result<(), String> {
        self.validate_common()?;
        let effective_size = self.effective_size()?;

        let allowed_sizes = match self.model {
            ImageGenModel::GptImage1 => GPT_IMAGE1_SIZES,
            ImageGenModel::DallE2 => DALLE2_SIZES,
            ImageGenModel::DallE3 => {
                return Err("DALL-E 3 does not support image editing fallback".to_string());
            }
        };
        if !allowed_sizes.contains(&effective_size.as_str()) {
            return Err(format!(
                "Invalid size '{}' for {} image edit. Allowed: {:?}",
                effective_size, self.model, allowed_sizes
            ));
        }

        if self.quality != "standard"
            && self.quality != "auto"
            && self.quality != "high"
            && self.quality != "medium"
            && self.quality != "low"
        {
            return Err(format!(
                "Invalid quality '{}'. Must be 'standard', 'auto', 'high', 'medium', or 'low'",
                self.quality
            ));
        }

        Ok(())
    }

    /// Resolve the request to a concrete `WIDTHxHEIGHT` size string.
    pub fn effective_size(&self) -> Result<String, String> {
        match (self.width, self.height) {
            (Some(width), Some(height)) => Ok(format!("{width}x{height}")),
            (Some(_), None) | (None, Some(_)) => Err(
                "Image width and height must both be provided when overriding dimensions"
                    .to_string(),
            ),
            (None, None) => {
                let trimmed = self.size.trim();
                if trimmed.is_empty() {
                    Err("Image size cannot be empty".to_string())
                } else {
                    parse_size_string(trimmed)?;
                    Ok(trimmed.to_string())
                }
            }
        }
    }

    /// Resolve the request to concrete numeric dimensions.
    pub fn dimensions(&self) -> Result<(u32, u32), String> {
        match (self.width, self.height) {
            (Some(width), Some(height)) => Ok((width, height)),
            (Some(_), None) | (None, Some(_)) => Err(
                "Image width and height must both be provided when overriding dimensions"
                    .to_string(),
            ),
            (None, None) => parse_size_string(self.size.trim()),
        }
    }

    fn validate_image_source(&self) -> Result<(), String> {
        let mut count = 0;
        if !self.image_path.trim().is_empty() {
            count += 1;
        }
        if !self.image_url.trim().is_empty() {
            count += 1;
        }
        if !self.image_base64.trim().is_empty() {
            count += 1;
            if self.mime_type.trim().is_empty() {
                return Err("mime_type is required when image_base64 is provided".to_string());
            }
        }

        if count == 0 {
            return Err(
                "Exactly one input image source is required: image_path, image_url, or image_base64"
                    .to_string(),
            );
        }
        if count > 1 {
            return Err(
                "Only one input image source may be provided: image_path, image_url, or image_base64"
                    .to_string(),
            );
        }

        Ok(())
    }
}

fn validate_prompt_text(value: &str, field_name: &str) -> Result<(), String> {
    if value.len() > ImageGenRequest::MAX_PROMPT_LEN {
        return Err(format!(
            "{field_name} too long: {} chars (max {})",
            value.len(),
            ImageGenRequest::MAX_PROMPT_LEN
        ));
    }
    if value
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
    {
        return Err(format!("{field_name} contains invalid control characters"));
    }
    if field_name == "Image generation prompt" && value.trim().is_empty() {
        return Err("Image generation prompt cannot be empty".into());
    }
    Ok(())
}

fn parse_size_string(input: &str) -> Result<(u32, u32), String> {
    let (width, height) = input.split_once('x').ok_or_else(|| {
        format!(
            "Invalid image size '{}'. Expected format WIDTHxHEIGHT",
            input
        )
    })?;
    let width = width
        .trim()
        .parse::<u32>()
        .map_err(|_| format!("Invalid image width in size '{}'", input))?;
    let height = height
        .trim()
        .parse::<u32>()
        .map_err(|_| format!("Invalid image height in size '{}'", input))?;
    if width == 0 || height == 0 {
        return Err(format!(
            "Invalid image size '{}'. Width and height must be greater than 0",
            input
        ));
    }
    Ok((width, height))
}

/// Result of image generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenResult {
    /// Generated images.
    pub images: Vec<GeneratedImage>,
    /// Which model was used.
    pub model: String,
    /// Revised prompt (DALL-E 3 rewrites prompts for quality).
    pub revised_prompt: Option<String>,
}

/// A single generated image.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedImage {
    /// Base64-encoded image data.
    pub data_base64: String,
    /// Temporary URL (may expire).
    pub url: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_media_type_display() {
        assert_eq!(MediaType::Image.to_string(), "image");
        assert_eq!(MediaType::Audio.to_string(), "audio");
        assert_eq!(MediaType::Video.to_string(), "video");
    }

    #[test]
    fn test_media_config_default() {
        let config = MediaConfig::default();
        assert!(config.image_description);
        assert!(config.audio_transcription);
        assert!(!config.video_description);
        assert_eq!(config.max_concurrency, 2);
        assert!(config.image_provider.is_none());
    }

    #[test]
    fn test_link_config_default() {
        let config = LinkConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.max_links, 3);
        assert_eq!(config.max_content_bytes, 102_400);
        assert_eq!(config.timeout_secs, 10);
    }

    #[test]
    fn test_attachment_validate_valid_image() {
        let a = MediaAttachment {
            media_type: MediaType::Image,
            mime_type: "image/png".to_string(),
            source: MediaSource::FilePath {
                path: "test.png".to_string(),
            },
            size_bytes: 1024,
        };
        assert!(a.validate().is_ok());
    }

    #[test]
    fn test_attachment_validate_bad_mime() {
        let a = MediaAttachment {
            media_type: MediaType::Image,
            mime_type: "application/pdf".to_string(),
            source: MediaSource::FilePath {
                path: "test.pdf".to_string(),
            },
            size_bytes: 1024,
        };
        assert!(a.validate().is_err());
    }

    #[test]
    fn test_attachment_validate_too_large() {
        let a = MediaAttachment {
            media_type: MediaType::Image,
            mime_type: "image/png".to_string(),
            source: MediaSource::FilePath {
                path: "big.png".to_string(),
            },
            size_bytes: MAX_IMAGE_BYTES + 1,
        };
        assert!(a.validate().is_err());
    }

    #[test]
    fn test_attachment_validate_audio() {
        let a = MediaAttachment {
            media_type: MediaType::Audio,
            mime_type: "audio/mpeg".to_string(),
            source: MediaSource::Url {
                url: "https://example.com/a.mp3".to_string(),
            },
            size_bytes: 5_000_000,
        };
        assert!(a.validate().is_ok());
    }

    #[test]
    fn test_attachment_validate_video_too_large() {
        let a = MediaAttachment {
            media_type: MediaType::Video,
            mime_type: "video/mp4".to_string(),
            source: MediaSource::FilePath {
                path: "big.mp4".to_string(),
            },
            size_bytes: MAX_VIDEO_BYTES + 1,
        };
        assert!(a.validate().is_err());
    }

    #[test]
    fn test_image_gen_model_display() {
        assert_eq!(ImageGenModel::DallE3.to_string(), "dall-e-3");
        assert_eq!(ImageGenModel::DallE2.to_string(), "dall-e-2");
        assert_eq!(ImageGenModel::GptImage1.to_string(), "gpt-image-1");
    }

    #[test]
    fn test_image_gen_request_validate_valid() {
        let req = ImageGenRequest {
            prompt: "A sunset over mountains".to_string(),
            negative_prompt: String::new(),
            model: ImageGenModel::DallE3,
            size: "1024x1024".to_string(),
            width: None,
            height: None,
            quality: "hd".to_string(),
            count: 1,
        };
        assert!(req.validate().is_ok());
    }

    #[test]
    fn test_image_gen_request_validate_empty_prompt() {
        let req = ImageGenRequest {
            prompt: String::new(),
            negative_prompt: String::new(),
            model: ImageGenModel::DallE3,
            size: "1024x1024".to_string(),
            width: None,
            height: None,
            quality: "standard".to_string(),
            count: 1,
        };
        assert!(req.validate().is_err());
    }

    #[test]
    fn test_image_gen_request_validate_bad_size() {
        let req = ImageGenRequest {
            prompt: "test".to_string(),
            negative_prompt: String::new(),
            model: ImageGenModel::DallE3,
            size: "512x512".to_string(),
            width: None,
            height: None,
            quality: "standard".to_string(),
            count: 1,
        };
        assert!(req.validate().is_err());
    }

    #[test]
    fn test_image_gen_request_validate_dalle3_count() {
        let req = ImageGenRequest {
            prompt: "test".to_string(),
            negative_prompt: String::new(),
            model: ImageGenModel::DallE3,
            size: "1024x1024".to_string(),
            width: None,
            height: None,
            quality: "standard".to_string(),
            count: 2,
        };
        assert!(req.validate().is_err());
    }

    #[test]
    fn test_image_gen_request_validate_dalle2_multi() {
        let req = ImageGenRequest {
            prompt: "test".to_string(),
            negative_prompt: String::new(),
            model: ImageGenModel::DallE2,
            size: "512x512".to_string(),
            width: None,
            height: None,
            quality: "standard".to_string(),
            count: 4,
        };
        assert!(req.validate().is_ok());
    }

    #[test]
    fn test_image_gen_request_validate_control_chars() {
        let req = ImageGenRequest {
            prompt: "test\x00prompt".to_string(),
            negative_prompt: String::new(),
            model: ImageGenModel::DallE3,
            size: "1024x1024".to_string(),
            width: None,
            height: None,
            quality: "standard".to_string(),
            count: 1,
        };
        assert!(req.validate().is_err());
    }

    #[test]
    fn test_image_gen_request_validate_explicit_dimensions() {
        let req = ImageGenRequest {
            prompt: "test".to_string(),
            negative_prompt: "bad hands".to_string(),
            model: ImageGenModel::DallE3,
            size: "1024x1024".to_string(),
            width: Some(1024),
            height: Some(1024),
            quality: "standard".to_string(),
            count: 1,
        };
        assert!(req.validate().is_ok());
        assert_eq!(req.effective_size().unwrap(), "1024x1024");
        assert_eq!(req.dimensions().unwrap(), (1024, 1024));
    }

    #[test]
    fn test_image_gen_request_validate_partial_dimensions() {
        let req = ImageGenRequest {
            prompt: "test".to_string(),
            negative_prompt: String::new(),
            model: ImageGenModel::DallE3,
            size: "1024x1024".to_string(),
            width: Some(1024),
            height: None,
            quality: "standard".to_string(),
            count: 1,
        };
        assert!(req.validate_common().is_err());
    }

    #[test]
    fn test_image_edit_request_requires_exactly_one_source() {
        let req = ImageEditRequest {
            prompt: "edit".to_string(),
            negative_prompt: String::new(),
            model: ImageGenModel::GptImage1,
            image_path: "a.png".to_string(),
            image_url: "/api/uploads/x".to_string(),
            image_base64: String::new(),
            mime_type: String::new(),
            size: "1024x1024".to_string(),
            width: None,
            height: None,
            quality: "standard".to_string(),
            count: 1,
        };
        assert!(req.validate_common().is_err());
    }

    #[test]
    fn test_image_edit_request_validate_common_accepts_path_source() {
        let req = ImageEditRequest {
            prompt: "make it red".to_string(),
            negative_prompt: String::new(),
            model: ImageGenModel::GptImage1,
            image_path: "a.png".to_string(),
            image_url: String::new(),
            image_base64: String::new(),
            mime_type: String::new(),
            size: "1024x1024".to_string(),
            width: None,
            height: None,
            quality: "standard".to_string(),
            count: 1,
        };
        assert!(req.validate_common().is_ok());
    }

    #[test]
    fn test_image_edit_request_requires_mime_for_base64() {
        let req = ImageEditRequest {
            prompt: "make it red".to_string(),
            negative_prompt: String::new(),
            model: ImageGenModel::GptImage1,
            image_path: String::new(),
            image_url: String::new(),
            image_base64: "abc".to_string(),
            mime_type: String::new(),
            size: "1024x1024".to_string(),
            width: None,
            height: None,
            quality: "standard".to_string(),
            count: 1,
        };
        assert!(req.validate_common().is_err());
    }

    #[test]
    fn test_media_type_serde_roundtrip() {
        let mt = MediaType::Audio;
        let json = serde_json::to_string(&mt).unwrap();
        assert_eq!(json, "\"audio\"");
        let parsed: MediaType = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, mt);
    }

    #[test]
    fn test_image_gen_model_serde_roundtrip() {
        let m = ImageGenModel::GptImage1;
        let json = serde_json::to_string(&m).unwrap();
        assert_eq!(json, "\"gpt-image-1\"");
        let parsed: ImageGenModel = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, m);
    }

    #[test]
    fn test_media_config_serde_roundtrip() {
        let config = MediaConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let parsed: MediaConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.max_concurrency, 2);
        assert!(parsed.image_description);
    }
}
