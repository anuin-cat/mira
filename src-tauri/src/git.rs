use std::fs;
use std::io::ErrorKind;

use crate::git_policy::validate_readonly_command;
use crate::git_process::{
    clip_output, clip_text, join_outputs, normalize_vault_path, optional_git_stdout,
    run_git_checked, run_git_dynamic_checked, run_git_strings, validate_relative_path,
    validate_relative_paths, validate_remote_url, ProcessOutput, DEFAULT_TIMEOUT,
    DIFF_OUTPUT_LIMIT, PUSH_TIMEOUT, READONLY_OUTPUT_LIMIT, READONLY_TIMEOUT,
};
use crate::git_status::{
    build_status, collect_stageable_paths, create_untracked_diff, current_branch,
    ensure_repo_root_fast, has_head, init_local_repository, is_untracked_path,
    prepare_local_repository, push_current_branch,
};
use crate::git_types::{
    GitCommitRequest, GitDiffRequest, GitDiffResult, GitOperationResult, GitPathsRequest,
    GitReadonlyRequest, GitReadonlyResult, GitRemoteConnectRequest, GitStatusResult,
};

/** 查询当前 vault 的 Git 状态 */
#[tauri::command]
pub fn git_get_status(vault_path: String) -> Result<GitStatusResult, String> {
    let vault = normalize_vault_path(&vault_path)?;
    build_status(&vault)
}

/** 初始化本地 Git 仓库，不创建 GitHub 远端 */
#[tauri::command]
pub fn git_init_local_repository(vault_path: String) -> Result<GitOperationResult, String> {
    let vault = normalize_vault_path(&vault_path)?;
    init_local_repository(&vault)?;
    create_operation_result(
        &vault,
        ProcessOutput {
            code: 0,
            stdout: "本地 Git 仓库已初始化。".to_string(),
            stderr: String::new(),
        },
    )
}

/** 读取指定文件的 staged 或 unstaged diff */
#[tauri::command]
pub fn git_get_diff(request: GitDiffRequest) -> Result<GitDiffResult, String> {
    let vault = normalize_vault_path(&request.vault_path)?;
    ensure_repo_root_fast(&vault)?;
    let path = validate_relative_path(&request.path)?;
    let diff = match request.mode.as_str() {
        "staged" => {
            run_git_checked(
                &vault,
                &[
                    "diff",
                    "--cached",
                    "--no-ext-diff",
                    "--no-color",
                    "--",
                    &path,
                ],
                DEFAULT_TIMEOUT,
            )?
            .stdout
        }
        "unstaged" => {
            let output = run_git_checked(
                &vault,
                &["diff", "--no-ext-diff", "--no-color", "--", &path],
                DEFAULT_TIMEOUT,
            )?
            .stdout;
            if output.trim().is_empty() && is_untracked_path(&vault, &path)? {
                create_untracked_diff(&vault, &path)?
            } else {
                output
            }
        }
        _ => return Err("未知 diff 模式".to_string()),
    };
    let (diff, is_truncated) = clip_output(diff, DIFF_OUTPUT_LIMIT);

    Ok(GitDiffResult {
        path,
        mode: request.mode,
        diff,
        is_truncated,
    })
}

/** 文件级 stage；paths 为空时 stage 全部变更 */
#[tauri::command]
pub fn git_stage_paths(request: GitPathsRequest) -> Result<GitOperationResult, String> {
    let vault = normalize_vault_path(&request.vault_path)?;
    ensure_repo_root_fast(&vault)?;
    let output = if request.paths.is_empty() {
        let paths = collect_stageable_paths(&vault)?;
        if paths.is_empty() {
            ProcessOutput {
                code: 0,
                stdout: String::new(),
                stderr: String::new(),
            }
        } else {
            run_git_dynamic_checked(&vault, vec!["add", "--all", "--"], &paths, DEFAULT_TIMEOUT)?
        }
    } else {
        let paths = validate_relative_paths(&request.paths)?;
        run_git_dynamic_checked(&vault, vec!["add", "--all", "--"], &paths, DEFAULT_TIMEOUT)?
    };
    create_operation_result(&vault, output)
}

/** 文件级 unstage；paths 为空时 unstage 全部变更 */
#[tauri::command]
pub fn git_unstage_paths(request: GitPathsRequest) -> Result<GitOperationResult, String> {
    let vault = normalize_vault_path(&request.vault_path)?;
    ensure_repo_root_fast(&vault)?;
    let output = if request.paths.is_empty() {
        if has_head(&vault) {
            run_git_checked(&vault, &["restore", "--staged", "--", "."], DEFAULT_TIMEOUT)?
        } else {
            run_git_checked(
                &vault,
                &["rm", "--cached", "-r", "--ignore-unmatch", "--", "."],
                DEFAULT_TIMEOUT,
            )?
        }
    } else {
        let paths = validate_relative_paths(&request.paths)?;
        if has_head(&vault) {
            run_git_dynamic_checked(
                &vault,
                vec!["restore", "--staged", "--"],
                &paths,
                DEFAULT_TIMEOUT,
            )?
        } else {
            run_git_dynamic_checked(
                &vault,
                vec!["rm", "--cached", "--ignore-unmatch", "--"],
                &paths,
                DEFAULT_TIMEOUT,
            )?
        }
    };
    create_operation_result(&vault, output)
}

/** 文件级撤销修改；只回退 worktree 中未 staged 的变更 */
#[tauri::command]
pub fn git_discard_paths(request: GitPathsRequest) -> Result<GitOperationResult, String> {
    let vault = normalize_vault_path(&request.vault_path)?;
    ensure_repo_root_fast(&vault)?;
    let paths = validate_relative_paths(&request.paths)?;
    if paths.is_empty() {
        return Err("至少选择一个文件".to_string());
    }

    // 1. 先按 Git 视角拆分 tracked / untracked，避免把未跟踪文件交给 git restore
    let mut tracked_paths = Vec::new();
    let mut untracked_paths = Vec::new();
    for path in &paths {
        if is_untracked_path(&vault, path)? {
            untracked_paths.push(path.clone());
        } else {
            tracked_paths.push(path.clone());
        }
    }

    // 2. tracked 文件只回退 worktree 到 index，保留已 staged 的内容
    let restore_output = if tracked_paths.is_empty() {
        ProcessOutput {
            code: 0,
            stdout: String::new(),
            stderr: String::new(),
        }
    } else {
        run_git_dynamic_checked(
            &vault,
            vec!["restore", "--worktree", "--"],
            &tracked_paths,
            DEFAULT_TIMEOUT,
        )?
    };

    // 3. untracked 文件没有可恢复基线，直接删除以回到“原始不存在”的状态
    let deleted_count = discard_untracked_files(&vault, &untracked_paths)?;
    let delete_stdout = if deleted_count == 0 {
        String::new()
    } else {
        format!("已删除 {} 个未跟踪文件。", deleted_count)
    };

    create_operation_result(
        &vault,
        ProcessOutput {
            code: 0,
            stdout: join_outputs(&restore_output.stdout, &delete_stdout),
            stderr: restore_output.stderr,
        },
    )
}

/** 创建一次 Git commit */
#[tauri::command]
pub fn git_commit(request: GitCommitRequest) -> Result<GitOperationResult, String> {
    let vault = normalize_vault_path(&request.vault_path)?;
    ensure_repo_root_fast(&vault)?;
    let message = request.message.trim();
    if message.is_empty() {
        return Err("提交信息不能为空".to_string());
    }
    let output = run_git_checked(&vault, &["commit", "-m", message], DEFAULT_TIMEOUT)?;
    create_operation_result(&vault, output)
}

/** 推送当前分支；没有 upstream 时默认推到 origin */
#[tauri::command]
pub fn git_push(vault_path: String) -> Result<GitOperationResult, String> {
    let vault = normalize_vault_path(&vault_path)?;
    ensure_repo_root_fast(&vault)?;
    let branch = current_branch(&vault)?.unwrap_or_else(|| "main".to_string());
    let output = if optional_git_stdout(
        &vault,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
        DEFAULT_TIMEOUT,
    )
    .is_some()
    {
        run_git_checked(&vault, &["push"], PUSH_TIMEOUT)?
    } else {
        run_git_checked(&vault, &["push", "-u", "origin", &branch], PUSH_TIMEOUT)?
    };
    create_operation_result(&vault, output)
}

/** 使用用户粘贴的 remote URL 连接 GitHub 仓库并推送 */
#[tauri::command]
pub fn git_connect_remote_repository(
    request: GitRemoteConnectRequest,
) -> Result<GitOperationResult, String> {
    let vault = normalize_vault_path(&request.vault_path)?;
    let remote_url = validate_remote_url(&request.remote_url)?;
    prepare_local_repository(&vault)?;

    let output = if optional_git_stdout(&vault, &["remote", "get-url", "origin"], DEFAULT_TIMEOUT)
        .is_some()
    {
        run_git_checked(
            &vault,
            &["remote", "set-url", "origin", &remote_url],
            DEFAULT_TIMEOUT,
        )?
    } else {
        run_git_checked(
            &vault,
            &["remote", "add", "origin", &remote_url],
            DEFAULT_TIMEOUT,
        )?
    };
    let push_output = push_current_branch(&vault)?;

    create_operation_result(
        &vault,
        ProcessOutput {
            code: push_output.code,
            stdout: join_outputs(&output.stdout, &push_output.stdout),
            stderr: join_outputs(&output.stderr, &push_output.stderr),
        },
    )
}

/** 执行 agent 可用的只读 Git 命令 */
#[tauri::command]
pub fn git_run_readonly(request: GitReadonlyRequest) -> Result<GitReadonlyResult, String> {
    let vault = normalize_vault_path(&request.vault_path)?;
    ensure_repo_root_fast(&vault)?;
    let validated = validate_readonly_command(&request.command)?;
    let output = run_git_strings(&vault, &validated.args, READONLY_TIMEOUT)?;
    let combined_len = output.stdout.len() + output.stderr.len();
    let is_truncated = combined_len > READONLY_OUTPUT_LIMIT;
    let stdout = clip_text(output.stdout, READONLY_OUTPUT_LIMIT);
    let stderr_limit = READONLY_OUTPUT_LIMIT.saturating_sub(stdout.len());
    let stderr = clip_text(output.stderr, stderr_limit);

    Ok(GitReadonlyResult {
        command_id: validated.command_id,
        stdout,
        stderr,
        code: output.code,
        is_truncated,
    })
}

/** 删除未跟踪文件，使其回到 Git 视角下的“原始不存在”状态 */
fn discard_untracked_files(vault: &std::path::Path, paths: &[String]) -> Result<usize, String> {
    let mut deleted_count = 0;

    for path in paths {
        let absolute_path = vault.join(path);
        match fs::remove_file(&absolute_path) {
            Ok(()) => deleted_count += 1,
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(format!("删除未跟踪文件失败（{}）：{}", path, error)),
        }
    }

    Ok(deleted_count)
}

/** 创建带最新状态的操作结果 */
fn create_operation_result(
    vault: &std::path::Path,
    output: ProcessOutput,
) -> Result<GitOperationResult, String> {
    Ok(GitOperationResult {
        status: build_status(vault)?,
        stdout: output.stdout,
        stderr: output.stderr,
    })
}
