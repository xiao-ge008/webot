use std::time::Duration;

use axum::http::{Method, StatusCode};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use reqwest::Client;
use serde_json::Value;
use tracing::warn;

use crate::error::ApiError;

#[derive(Clone)]
pub struct OpenFangClient {
    client: Client,
    stream_client: Client,
    base_url: String,
    api_key: Option<String>,
}

impl OpenFangClient {
    pub fn new(
        base_url: String,
        api_key: Option<String>,
        timeout_ms: u64,
    ) -> Result<Self, reqwest::Error> {
        let client = Client::builder()
            .connect_timeout(Duration::from_millis(timeout_ms))
            .timeout(Duration::from_millis(timeout_ms))
            .build()?;
        let stream_client = Client::builder()
            .connect_timeout(Duration::from_millis(timeout_ms))
            .build()?;

        Ok(Self {
            client,
            stream_client,
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
        })
    }

    pub async fn get_json(&self, path: &str) -> Result<Value, ApiError> {
        self.request_json(Method::GET, path, None).await
    }

    pub async fn get_json_with_query(
        &self,
        path: &str,
        query: &[(String, String)],
    ) -> Result<Value, ApiError> {
        let url = format!("{}/{}", self.base_url, path.trim_start_matches('/'));
        let mut req = self.client.request(Method::GET, &url);

        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }
        if !query.is_empty() {
            req = req.query(query);
        }

        let resp = req.send().await.map_err(|e| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("OpenFang 请求失败({url}): {e}"),
            )
        })?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("OpenFang 响应读取失败({url}): {e}"),
            )
        })?;

        if !status.is_success() {
            return Err(ApiError::new(
                status,
                format!("OpenFang 返回错误({url}): {}", text.trim()),
            ));
        }

        serde_json::from_str::<Value>(&text).map_err(|e| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("OpenFang 返回非 JSON({url}): {e}; body={text}"),
            )
        })
    }

    pub async fn post_json(&self, path: &str, body: Value) -> Result<Value, ApiError> {
        self.request_json(Method::POST, path, Some(body)).await
    }

    pub async fn post_json_with_timeout(
        &self,
        path: &str,
        body: Value,
        timeout: Duration,
    ) -> Result<Value, ApiError> {
        self.request_json_with_timeout(Method::POST, path, Some(body), timeout)
            .await
    }

    pub async fn put_json(&self, path: &str, body: Value) -> Result<Value, ApiError> {
        self.request_json(Method::PUT, path, Some(body)).await
    }

    pub async fn patch_json(&self, path: &str, body: Value) -> Result<Value, ApiError> {
        self.request_json(Method::PATCH, path, Some(body)).await
    }

    pub async fn delete_json(&self, path: &str) -> Result<Value, ApiError> {
        self.request_json(Method::DELETE, path, None).await
    }

    pub async fn post_stream(
        &self,
        path: &str,
        body: Value,
    ) -> Result<reqwest::Response, ApiError> {
        self.request_stream(Method::POST, path, Some(body)).await
    }

    pub async fn post_bytes_json(
        &self,
        path: &str,
        body: Vec<u8>,
        content_type: Option<&str>,
        extra_headers: &[(String, String)],
    ) -> Result<Value, ApiError> {
        let url = format!("{}/{}", self.base_url, path.trim_start_matches('/'));
        let mut req = self.client.request(Method::POST, &url);
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }

        let mut headers = HeaderMap::new();
        if let Some(value) = content_type.and_then(|item| HeaderValue::from_str(item).ok()) {
            headers.insert(CONTENT_TYPE, value);
        }
        for (key, value) in extra_headers {
            let Ok(name) = HeaderName::from_bytes(key.as_bytes()) else {
                continue;
            };
            let Ok(value) = HeaderValue::from_str(value) else {
                continue;
            };
            headers.insert(name, value);
        }
        req = req.headers(headers).body(body);

        let resp = req.send().await.map_err(|e| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("OpenFang 请求失败({url}): {e}"),
            )
        })?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("OpenFang 响应读取失败({url}): {e}"),
            )
        })?;

        if !status.is_success() {
            return Err(ApiError::new(
                status,
                format!("OpenFang 返回错误({url}): {}", text.trim()),
            ));
        }

        serde_json::from_str::<Value>(&text).map_err(|e| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("OpenFang 返回非 JSON({url}): {e}; body={text}"),
            )
        })
    }

    pub async fn request_stream(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<reqwest::Response, ApiError> {
        let url = format!("{}/{}", self.base_url, path.trim_start_matches('/'));
        let mut req = self.stream_client.request(method, &url);
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }
        if let Some(payload) = body {
            req = req.json(&payload);
        }

        let resp = req.send().await.map_err(|e| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("OpenFang 流式请求失败({url}): {e}"),
            )
        })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp
                .text()
                .await
                .unwrap_or_else(|_| String::from("<empty>"));
            return Err(ApiError::new(
                status,
                format!("OpenFang 返回错误({url}): {}", text.trim()),
            ));
        }

        Ok(resp)
    }

    pub async fn request_json(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, ApiError> {
        self.request_json_with_timeout(method, path, body, Duration::from_secs(0))
            .await
    }

    pub async fn request_json_with_timeout(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        timeout: Duration,
    ) -> Result<Value, ApiError> {
        let url = format!("{}/{}", self.base_url, path.trim_start_matches('/'));
        let started_at = std::time::Instant::now();
        let client = if timeout.is_zero() {
            self.client.clone()
        } else {
            Client::builder()
                .connect_timeout(timeout)
                .timeout(timeout)
                .build()
                .map_err(|e| {
                    ApiError::new(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("OpenFang 超时客户端创建失败({url}): {e}"),
                    )
                })?
        };
        let mut req = client.request(method, &url);

        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }
        if let Some(payload) = body {
            req = req.json(&payload);
        }

        let resp = req.send().await.map_err(|e| {
            warn!(
                path = %path,
                url = %url,
                latency_ms = started_at.elapsed().as_millis() as u64,
                error = %e,
                "OpenFang upstream request failed"
            );
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("OpenFang 请求失败({url}): {e}"),
            )
        })?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| {
            warn!(
                path = %path,
                url = %url,
                status = %status,
                latency_ms = started_at.elapsed().as_millis() as u64,
                error = %e,
                "OpenFang upstream response read failed"
            );
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("OpenFang 响应读取失败({url}): {e}"),
            )
        })?;
        if !status.is_success() {
            return Err(ApiError::new(
                status,
                format!("OpenFang 返回错误({url}): {}", text.trim()),
            ));
        }

        serde_json::from_str::<Value>(&text).map_err(|e| {
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                format!("OpenFang 返回非 JSON({url}): {e}; body={text}"),
            )
        })
    }
}
