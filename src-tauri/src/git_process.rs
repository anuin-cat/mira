use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(20);
pub const PUSH_TIMEOUT: Duration = Duration::from_secs(120);
pub const READONLY_TIMEOUT: Duration = Duration::from_secs(20);
pub const READONLY_OUTPUT_LIMIT: usize = 80_000;
pub const DIFF_OUTPUT_LIMIT: usize = 120_000;

#[derive(Debug)]
pub struct ProcessOutput {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

/** 运行 git 并要求退出码为 0 */
pub fn run_git_checked(
    cwd: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<ProcessOutput, String> {
    checked_output(run_git(cwd, args, timeout)?)
}

/** 动态拼接 git 参数并要求退出码为 0 */
pub fn run_git_dynamic_checked(
    cwd: &Path,
    base_args: Vec<&str>,
    path_args: &[String],
    timeout: Duration,
) -> Result<ProcessOutput, String> {
    let args = base_args
        .into_iter()
        .map(str::to_string)
        .chain(path_args.iter().cloned())
        .collect::<Vec<_>>();
    checked_output(run_git_strings(cwd, &args, timeout)?)
}

/** 运行 git，参数为字符串切片 */
pub fn run_git(cwd: &Path, args: &[&str], timeout: Duration) -> Result<ProcessOutput, String> {
    let string_args = args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
    run_git_strings(cwd, &string_args, timeout)
}

/** 运行 git，统一禁用分页器和交互凭据提示 */
pub fn run_git_strings(
    cwd: &Path,
    args: &[String],
    timeout: Duration,
) -> Result<ProcessOutput, String> {
    let mut final_args = vec!["--no-pager".to_string()];
    final_args.extend(args.iter().cloned());
    run_program("git", &final_args, cwd, timeout)
}

/** 运行外部程序并要求退出码为 0 */
pub fn run_program_checked(
    program: &str,
    args: &[&str],
    cwd: &Path,
    timeout: Duration,
) -> Result<ProcessOutput, String> {
    let output = run_program(
        program,
        &args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>(),
        cwd,
        timeout,
    )?;
    checked_output(output)
}

/** 运行外部程序并捕获输出 */
fn run_program(
    program: &str,
    args: &[String],
    cwd: &Path,
    timeout: Duration,
) -> Result<ProcessOutput, String> {
    let mut child = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动命令失败：{} {}", program, error))?;

    let started_at = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|error| format!("等待命令失败：{}", error))?
            .is_some()
        {
            let output = child
                .wait_with_output()
                .map_err(|error| format!("读取命令输出失败：{}", error))?;
            return Ok(ProcessOutput {
                code: output.status.code().unwrap_or(-1),
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            });
        }

        if started_at.elapsed() >= timeout {
            let _ = child.kill();
            let output = child
                .wait_with_output()
                .map_err(|error| format!("读取超时命令输出失败：{}", error))?;
            return Err(format!(
                "命令执行超时：{} {}\n{}{}",
                program,
                args.join(" "),
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        thread::sleep(Duration::from_millis(30));
    }
}

/** 将非 0 退出码转换为错误 */
fn checked_output(output: ProcessOutput) -> Result<ProcessOutput, String> {
    if output.code == 0 {
        return Ok(output);
    }
    Err(format!(
        "Git 命令执行失败（退出码 {}）：\n{}{}",
        output.code, output.stdout, output.stderr
    ))
}

/** 读取可失败的 git stdout */
pub fn optional_git_stdout(cwd: &Path, args: &[&str], timeout: Duration) -> Option<String> {
    let output = run_git(cwd, args, timeout).ok()?;
    if output.code != 0 {
        return None;
    }
    let value = output.stdout.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/** 标准化 vault 路径，并确认路径存在 */
pub fn normalize_vault_path(path: &str) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|error| format!("无效 vault 路径：{}", error))
}

/** 校验 vault 内相对路径，避免命令逃逸到 vault 外 */
pub fn validate_relative_path(path: &str) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("路径不能为空".to_string());
    }
    if path.contains('\0') {
        return Err("路径不能包含空字符".to_string());
    }
    let relative = Path::new(path);
    if relative.is_absolute() {
        return Err("只能使用 vault 内相对路径".to_string());
    }
    for component in relative.components() {
        if matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) {
            return Err("路径不能包含 .. 或绝对路径前缀".to_string());
        }
    }
    Ok(path.replace('\\', "/"))
}

/** 批量校验相对路径 */
pub fn validate_relative_paths(paths: &[String]) -> Result<Vec<String>, String> {
    paths
        .iter()
        .map(|path| validate_relative_path(path))
        .collect()
}

/** 生成或清理 GitHub 仓库名 */
pub fn normalize_repo_name(input: Option<&str>, vault: &Path) -> Result<String, String> {
    let raw = input
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            vault
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "mira-vault".to_string());
    let normalized = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches(&['-', '.', '_'][..])
        .to_string();

    if normalized.is_empty() {
        return Err("GitHub 仓库名不能为空".to_string());
    }
    Ok(normalized)
}

/** 校验用户粘贴的 GitHub remote URL */
pub fn validate_remote_url(input: &str) -> Result<String, String> {
    let value = input.trim();
    if value.starts_with("https://github.com/") || value.starts_with("git@github.com:") {
        return Ok(value.to_string());
    }
    Err("remote URL 必须是 GitHub HTTPS 或 SSH 地址".to_string())
}

/** 裁剪长输出并返回是否截断 */
pub fn clip_output(value: String, limit: usize) -> (String, bool) {
    if value.len() <= limit {
        return (value, false);
    }
    (clip_text(value, limit), true)
}

/** 裁剪长文本 */
pub fn clip_text(value: String, limit: usize) -> String {
    if value.len() <= limit {
        return value;
    }
    let split_at = value
        .char_indices()
        .map(|(index, _)| index)
        .take_while(|index| *index <= limit)
        .last()
        .unwrap_or(0);
    format!(
        "{}\n\n[输出已截断，剩余 {} 字节未显示]",
        &value[..split_at],
        value.len() - split_at
    )
}

/** 拼接可为空的命令输出 */
pub fn join_outputs(first: &str, second: &str) -> String {
    [first.trim(), second.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}
