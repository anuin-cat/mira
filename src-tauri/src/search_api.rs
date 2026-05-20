use std::time::Duration;

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const DEFAULT_TIMEOUT_SECONDS: u64 = 30;
const BOCHA_SEARCH_ENDPOINT: &str = "https://api.bocha.cn/v1/web-search";
const EXA_SEARCH_ENDPOINT: &str = "https://api.exa.ai/search";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchApiPostJsonRequest {
    provider_id: String,
    api_key: String,
    body: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchApiPostJsonResult {
    status: u16,
    body: Value,
}

/** 根据搜索 provider 生成固定 API endpoint，避免前端把此命令当通用代理使用 */
fn resolve_search_endpoint(provider_id: &str) -> Result<&'static str, String> {
    match provider_id {
        "bocha" => Ok(BOCHA_SEARCH_ENDPOINT),
        "exa" => Ok(EXA_SEARCH_ENDPOINT),
        _ => Err("不支持的搜索服务".to_string()),
    }
}

/** 按 provider 写入鉴权头 */
fn apply_auth_headers(
    request: reqwest::RequestBuilder,
    provider_id: &str,
    api_key: &str,
) -> reqwest::RequestBuilder {
    match provider_id {
        "bocha" => request.header(AUTHORIZATION, format!("Bearer {}", api_key)),
        "exa" => request.header("x-api-key", api_key),
        _ => request,
    }
}

/** 通过 Tauri 后端调用搜索 API，绕过 WebView CORS 限制 */
#[tauri::command]
pub async fn search_api_post_json(
    request: SearchApiPostJsonRequest,
) -> Result<SearchApiPostJsonResult, String> {
    let provider_id = request.provider_id.trim();
    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return Err("请先填写搜索服务 API Key".to_string());
    }

    let endpoint = resolve_search_endpoint(provider_id)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| format!("创建搜索请求客户端失败：{}", error))?;

    let body = serde_json::to_vec(&request.body)
        .map_err(|error| format!("序列化搜索请求失败：{}", error))?;
    let response = apply_auth_headers(client.post(endpoint), provider_id, api_key)
        .header(CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|error| format!("搜索请求失败：{}", error))?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取搜索响应失败：{}", error))?;
    let body = serde_json::from_str(&text).unwrap_or(Value::String(text));

    Ok(SearchApiPostJsonResult { status, body })
}
