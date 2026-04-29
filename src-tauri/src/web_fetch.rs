use std::net::{IpAddr, ToSocketAddrs};
use std::time::Duration;

use encoding_rs::{Encoding, UTF_8};
use reqwest::header::{ACCEPT, CONTENT_TYPE, LOCATION, USER_AGENT};
use reqwest::{redirect, Client, StatusCode, Url};
use serde::{Deserialize, Serialize};

const DEFAULT_MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_ALLOWED_BYTES: usize = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECONDS: u64 = 15;
const MAX_REDIRECTS: usize = 5;
const USER_AGENT_VALUE: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Mira/0.1";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchRequest {
    url: String,
    max_bytes: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebFetchResult {
    final_url: String,
    status: u16,
    content_type: Option<String>,
    html: String,
    bytes_read: usize,
    is_truncated: bool,
}

/** 判断 IP 是否属于本地、内网或不可路由地址 */
fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.is_unspecified()
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
        }
    }
}

/** 校验 URL 协议与主机，避免 agent 读取本机或内网地址 */
fn validate_public_http_url(url: &Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("只允许读取 http/https URL".to_string());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "URL 缺少主机名".to_string())?
        .trim()
        .trim_end_matches('.')
        .to_ascii_lowercase();

    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return Err("不允许读取本机或局域网地址".to_string());
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err("不允许读取本机或内网 IP 地址".to_string());
        }
        return Ok(());
    }

    let port = url
        .port_or_known_default()
        .ok_or_else(|| "无法识别 URL 端口".to_string())?;
    let addrs = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|_| "无法解析 URL 主机名".to_string())?;

    for addr in addrs {
        if is_blocked_ip(addr.ip()) {
            return Err("不允许读取解析到本机或内网的地址".to_string());
        }
    }

    Ok(())
}

/** 从响应头判断是否是可读网页内容 */
fn validate_content_type(content_type: Option<&str>) -> Result<(), String> {
    let Some(content_type) = content_type else {
        return Ok(());
    };

    let normalized = content_type.to_ascii_lowercase();
    if normalized.contains("text/html")
        || normalized.contains("application/xhtml+xml")
        || normalized.contains("text/plain")
    {
        return Ok(());
    }

    Err(format!("暂不支持读取此内容类型：{}", content_type))
}

/** 从 Content-Type 中提取 charset 标签 */
fn extract_content_type_charset(content_type: &str) -> Option<String> {
    content_type.split(';').find_map(|segment| {
        let (key, value) = segment.split_once('=')?;
        if key.trim().eq_ignore_ascii_case("charset") {
            Some(
                value
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string(),
            )
        } else {
            None
        }
    })
}

/** 从 HTML 头部片段中提取 meta charset 标签 */
fn extract_html_charset(body: &[u8]) -> Option<String> {
    let prefix_len = body.len().min(4096);
    let prefix = String::from_utf8_lossy(&body[..prefix_len]);
    let lower = prefix.to_ascii_lowercase();
    let mut offset = 0;

    while let Some(relative_index) = lower[offset..].find("charset") {
        let charset_index = offset + relative_index + "charset".len();
        let after_charset = &prefix[charset_index..];
        let Some(equal_index) = after_charset.find('=') else {
            offset = charset_index;
            continue;
        };
        let value_start = charset_index + equal_index + 1;
        let value = prefix[value_start..].trim_start();
        let value = value.trim_start_matches('"').trim_start_matches('\'');
        let label: String = value
            .chars()
            .take_while(|char| char.is_ascii_alphanumeric() || matches!(char, '-' | '_' | '.'))
            .collect();
        if !label.is_empty() {
            return Some(label);
        }
        offset = charset_index;
    }

    None
}

/** 根据响应头或 HTML meta charset 解码网页字节 */
fn decode_body(body: &[u8], content_type: Option<&str>) -> String {
    let encoding = content_type
        .and_then(extract_content_type_charset)
        .or_else(|| extract_html_charset(body))
        .and_then(|label| Encoding::for_label(label.as_bytes()))
        .unwrap_or(UTF_8);
    let (text, _, _) = encoding.decode(body);
    text.into_owned()
}

/** 从响应体按块读取 HTML，并限制最大字节数 */
async fn read_limited_body(
    mut response: reqwest::Response,
    max_bytes: usize,
) -> Result<(Vec<u8>, bool), String> {
    let mut body = Vec::new();
    let mut is_truncated = false;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("读取网页内容失败：{}", error))?
    {
        if body.len() + chunk.len() > max_bytes {
            let remaining = max_bytes.saturating_sub(body.len());
            body.extend_from_slice(&chunk[..remaining]);
            is_truncated = true;
            break;
        }
        body.extend_from_slice(&chunk);
    }

    Ok((body, is_truncated))
}

/** 跟随 HTTP 重定向，每一步都重新校验目标 URL */
async fn fetch_with_safe_redirects(
    client: &Client,
    initial_url: Url,
    max_bytes: usize,
) -> Result<WebFetchResult, String> {
    let mut current_url = initial_url;

    for redirect_index in 0..=MAX_REDIRECTS {
        validate_public_http_url(&current_url)?;

        let response = client
            .get(current_url.clone())
            .header(USER_AGENT, USER_AGENT_VALUE)
            .header(
                ACCEPT,
                "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2",
            )
            .send()
            .await
            .map_err(|error| format!("请求网页失败：{}", error))?;

        let status = response.status();
        if status.is_redirection() {
            if redirect_index >= MAX_REDIRECTS {
                return Err("网页重定向次数过多".to_string());
            }

            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "网页重定向缺少 Location".to_string())?;
            current_url = current_url
                .join(location)
                .map_err(|_| "网页重定向目标不是合法 URL".to_string())?;
            continue;
        }

        if status != StatusCode::OK {
            return Err(format!("网页请求失败：HTTP {}", status.as_u16()));
        }

        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        validate_content_type(content_type.as_deref())?;

        let final_url = response.url().to_string();
        let (body, is_truncated) = read_limited_body(response, max_bytes).await?;
        let bytes_read = body.len();
        let html = decode_body(&body, content_type.as_deref());

        return Ok(WebFetchResult {
            final_url,
            status: status.as_u16(),
            content_type,
            html,
            bytes_read,
            is_truncated,
        });
    }

    Err("网页重定向次数过多".to_string())
}

/** 本地抓取公开网页 HTML，供前端清洗为 AI 可读文本 */
#[tauri::command]
pub async fn web_fetch_url(request: WebFetchRequest) -> Result<WebFetchResult, String> {
    let url = Url::parse(request.url.trim()).map_err(|_| "URL 格式不正确".to_string())?;
    let max_bytes = request
        .max_bytes
        .unwrap_or(DEFAULT_MAX_BYTES)
        .clamp(1, MAX_ALLOWED_BYTES);
    let client = Client::builder()
        .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECONDS))
        .redirect(redirect::Policy::none())
        .build()
        .map_err(|error| format!("创建网页请求客户端失败：{}", error))?;

    fetch_with_safe_redirects(&client, url, max_bytes).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_public_http_url_rejects_unsafe_targets() {
        let urls = [
            "http://localhost/test",
            "http://127.0.0.1/test",
            "http://10.0.0.1/test",
            "http://172.16.0.1/test",
            "http://192.168.1.1/test",
            "http://[::1]/test",
            "file:///tmp/test.html",
        ];

        for value in urls {
            let url = Url::parse(value).expect("测试 URL 应该合法");
            assert!(
                validate_public_http_url(&url).is_err(),
                "{} 应该被拒绝",
                value
            );
        }
    }

    #[test]
    fn validate_public_http_url_accepts_public_ip() {
        let url = Url::parse("https://93.184.216.34/").expect("测试 URL 应该合法");
        assert!(validate_public_http_url(&url).is_ok());
    }

    #[test]
    fn validate_content_type_allows_readable_text() {
        assert!(validate_content_type(Some("text/html; charset=utf-8")).is_ok());
        assert!(validate_content_type(Some("application/xhtml+xml")).is_ok());
        assert!(validate_content_type(Some("text/plain")).is_ok());
        assert!(validate_content_type(None).is_ok());
    }

    #[test]
    fn validate_content_type_rejects_binary_content() {
        assert!(validate_content_type(Some("application/pdf")).is_err());
        assert!(validate_content_type(Some("image/png")).is_err());
    }

    #[test]
    fn decode_body_uses_content_type_charset() {
        let (bytes, _, _) = encoding_rs::GBK.encode("中文网页内容");
        assert_eq!(
            decode_body(&bytes, Some("text/html; charset=gbk")),
            "中文网页内容"
        );
    }

    #[test]
    fn decode_body_uses_html_meta_charset() {
        let html = r#"<html><head><meta charset="gbk"></head><body>中文网页内容</body></html>"#;
        let (bytes, _, _) = encoding_rs::GBK.encode(html);
        assert_eq!(decode_body(&bytes, Some("text/html")), html);
    }
}
