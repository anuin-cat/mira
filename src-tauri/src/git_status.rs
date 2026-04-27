use crate::git_process::{
    normalize_vault_path, optional_git_stdout, run_git, run_git_checked, ProcessOutput,
    DEFAULT_TIMEOUT, PUSH_TIMEOUT,
};
use crate::git_types::{GitChangedFile, GitStatusResult};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::Path;

const MAX_UNTRACKED_LINE_COUNT_BYTES: u64 = 128_000;
const MAX_TOTAL_UNTRACKED_LINE_COUNT_BYTES: u64 = 750_000;
const MAX_UNTRACKED_DIFF_BYTES: u64 = 120_000;
const INITIAL_COMMIT_MESSAGE: &str = "Initial Mira vault backup";
const DEFAULT_GITIGNORE_ENTRIES: [&str; 11] = [
    ".mira/",
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    "*.swp",
    "*.swo",
    "*~",
    ".Spotlight-V100/",
    ".Trashes/",
    "__MACOSX/",
    ".vscode/",
];

#[derive(Debug)]
struct RepositoryInfo {
    is_git_repository: bool,
    is_vault_git_root: bool,
    repository_problem: Option<String>,
    branch: Option<String>,
    remote_url: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    has_head: bool,
}

#[derive(Debug)]
struct StatusEntry {
    path: String,
    old_path: Option<String>,
    index_status: char,
    worktree_status: char,
}

#[derive(Debug, Default, Clone)]
struct LineStat {
    additions: u32,
    deletions: u32,
}

/** 构造完整状态，非仓库状态也以结构化结果返回 */
pub fn build_status(vault: &Path) -> Result<GitStatusResult, String> {
    let repo = inspect_repository(vault)?;
    if !repo.is_git_repository || !repo.is_vault_git_root {
        return Ok(status_from_repo(repo, Vec::new()));
    }

    ensure_default_gitignore(vault)?;
    let entries = read_status_entries(vault)?;
    let staged_stats = read_numstat(vault, &["diff", "--cached", "--numstat", "-z"])?;
    let unstaged_stats = read_numstat(vault, &["diff", "--numstat", "-z"])?;
    let mut untracked_line_count_budget = MAX_TOTAL_UNTRACKED_LINE_COUNT_BYTES;
    let changed_files = entries
        .into_iter()
        .filter_map(|entry| {
            match create_changed_file(
                vault,
                entry,
                &staged_stats,
                &unstaged_stats,
                &mut untracked_line_count_budget,
            ) {
                Ok(Some(file)) => Some(Ok(file)),
                Ok(None) => None,
                Err(error) => Some(Err(error)),
            }
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(status_from_repo(repo, changed_files))
}

/** 确认仓库存在且 vault 本身就是仓库根目录 */
pub fn ensure_repo_root(vault: &Path) -> Result<(), String> {
    let repo = inspect_repository(vault)?;
    if !repo.is_git_repository {
        return Err("当前 vault 还不是 Git 仓库，请先初始化本地 Git 仓库。".to_string());
    }
    if !repo.is_vault_git_root {
        return Err(repo
            .repository_problem
            .unwrap_or_else(|| "当前 vault 不是 Git 仓库根目录".to_string()));
    }
    Ok(())
}

/** 只用必要查询确认 vault 是 Git 仓库根目录 */
pub fn ensure_repo_root_fast(vault: &Path) -> Result<(), String> {
    let output = run_git_checked(vault, &["rev-parse", "--show-toplevel"], DEFAULT_TIMEOUT)
        .map_err(|error| {
            if error.contains("not a git repository") {
                "当前 vault 还不是 Git 仓库，请先初始化本地 Git 仓库。".to_string()
            } else {
                error
            }
        })?;
    let top_level = output.stdout.trim();
    let top_level_path = normalize_vault_path(top_level)?;
    if top_level_path != vault {
        return Err(
            "当前 vault 位于一个更大的 Git 仓库中；Mira 要求 vault 根目录就是 Git 仓库根目录。"
                .to_string(),
        );
    }
    Ok(())
}

/** 初始化本地 Git 仓库，并写入默认忽略规则 */
pub fn init_local_repository(vault: &Path) -> Result<(), String> {
    // 1. 非仓库时初始化为 main 分支
    let repo = inspect_repository(vault)?;
    if !repo.is_git_repository {
        let init_output = run_git(vault, &["init", "-b", "main"], DEFAULT_TIMEOUT)?;
        if init_output.code != 0 {
            run_git_checked(vault, &["init"], DEFAULT_TIMEOUT)?;
            run_git_checked(
                vault,
                &["symbolic-ref", "HEAD", "refs/heads/main"],
                DEFAULT_TIMEOUT,
            )?;
        }
    }

    // 2. 初始化后再次确认根目录约束，并确保 .mira 不进入 Git
    ensure_repo_root(vault)?;
    ensure_default_gitignore(vault)?;

    Ok(())
}

/** 准备本地仓库：git init、忽略 .mira、必要时创建初始提交 */
pub fn prepare_local_repository(vault: &Path) -> Result<(), String> {
    init_local_repository(vault)?;

    // 1. 空仓库创建初始提交，供 GitHub 远端第一次推送
    if !has_head(vault) {
        let paths = collect_stageable_paths(vault)?;
        if !paths.is_empty() {
            let path_refs = paths.iter().map(String::as_str).collect::<Vec<_>>();
            let mut args = vec!["add", "--all", "--"];
            args.extend(path_refs);
            run_git_checked(vault, &args, DEFAULT_TIMEOUT)?;
            run_git_checked(
                vault,
                &["commit", "-m", INITIAL_COMMIT_MESSAGE],
                DEFAULT_TIMEOUT,
            )?;
        }
    }

    Ok(())
}

/** 收集当前可以被 UI 展示和一键 stage 的文件路径 */
pub fn collect_stageable_paths(vault: &Path) -> Result<Vec<String>, String> {
    ensure_default_gitignore(vault)?;
    let staged_stats = read_numstat(vault, &["diff", "--cached", "--numstat", "-z"])?;
    let unstaged_stats = read_numstat(vault, &["diff", "--numstat", "-z"])?;
    let mut untracked_line_count_budget = 0;
    read_status_entries(vault)?
        .into_iter()
        .filter_map(|entry| {
            match create_changed_file(
                vault,
                entry,
                &staged_stats,
                &unstaged_stats,
                &mut untracked_line_count_budget,
            ) {
                Ok(Some(file)) => Some(Ok(file.path)),
                Ok(None) => None,
                Err(error) => Some(Err(error)),
            }
        })
        .collect()
}

/** 当前分支名，空仓库可能没有分支 */
pub fn current_branch(vault: &Path) -> Result<Option<String>, String> {
    Ok(
        optional_git_stdout(vault, &["branch", "--show-current"], DEFAULT_TIMEOUT)
            .filter(|value| !value.is_empty()),
    )
}

/** 判断指定路径是否为 untracked */
pub fn is_untracked_path(vault: &Path, path: &str) -> Result<bool, String> {
    let output = run_git_checked(
        vault,
        &["status", "--porcelain=v1", "-z", "--", path],
        DEFAULT_TIMEOUT,
    )?;
    Ok(output
        .stdout
        .split('\0')
        .any(|record| record.starts_with("?? ")))
}

/** 为未跟踪文件生成简单 diff */
pub fn create_untracked_diff(vault: &Path, path: &str) -> Result<String, String> {
    let absolute = vault.join(path);
    let mut file =
        fs::File::open(&absolute).map_err(|error| format!("读取未跟踪文件失败：{}", error))?;
    let mut bytes = Vec::new();
    file.by_ref()
        .take(MAX_UNTRACKED_DIFF_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取未跟踪文件失败：{}", error))?;
    let is_truncated = bytes.len() as u64 > MAX_UNTRACKED_DIFF_BYTES;
    if is_truncated {
        bytes.truncate(MAX_UNTRACKED_DIFF_BYTES as usize);
    }
    let content = String::from_utf8_lossy(&bytes);
    let mut diff = format!(
        "diff --git a/{0} b/{0}\nnew file mode 100644\n--- /dev/null\n+++ b/{0}\n",
        path
    );
    for line in content.lines() {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }
    if is_truncated {
        diff.push_str(&format!(
            "\n[未跟踪文件过大，仅显示前 {} 字节]\n",
            MAX_UNTRACKED_DIFF_BYTES
        ));
    }
    Ok(diff)
}

/** 推送当前分支并设置 upstream */
pub fn push_current_branch(vault: &Path) -> Result<ProcessOutput, String> {
    let branch = current_branch(vault)?.unwrap_or_else(|| "main".to_string());
    run_git_checked(vault, &["push", "-u", "origin", &branch], PUSH_TIMEOUT)
}

/** 把仓库信息和文件列表合并成前端状态 */
fn status_from_repo(repo: RepositoryInfo, changed_files: Vec<GitChangedFile>) -> GitStatusResult {
    GitStatusResult {
        is_git_repository: repo.is_git_repository,
        is_vault_git_root: repo.is_vault_git_root,
        repository_problem: repo.repository_problem,
        branch: repo.branch,
        remote_url: repo.remote_url,
        upstream: repo.upstream,
        ahead: repo.ahead,
        behind: repo.behind,
        has_head: repo.has_head,
        changed_files,
    }
}

/** 检查当前目录是否为 vault 根目录对应的 Git 仓库 */
fn inspect_repository(vault: &Path) -> Result<RepositoryInfo, String> {
    let inside = run_git(
        vault,
        &["rev-parse", "--is-inside-work-tree"],
        DEFAULT_TIMEOUT,
    );
    match inside {
        Ok(output) if output.code == 0 && output.stdout.trim() == "true" => {}
        Ok(_) => return Ok(empty_repo_info(false, false, None)),
        Err(error) if error.contains("not a git repository") => {
            return Ok(empty_repo_info(false, false, None));
        }
        Err(error) => return Err(error),
    };

    let top_level = run_git_checked(vault, &["rev-parse", "--show-toplevel"], DEFAULT_TIMEOUT)?
        .stdout
        .trim()
        .to_string();
    let top_level_path = normalize_vault_path(&top_level)?;
    let is_vault_git_root = top_level_path == vault;
    let repository_problem = if is_vault_git_root {
        None
    } else {
        Some(
            "当前 vault 位于一个更大的 Git 仓库中；Mira 要求 vault 根目录就是 Git 仓库根目录。"
                .to_string(),
        )
    };

    let (ahead, behind) = read_ahead_behind(vault);

    Ok(RepositoryInfo {
        is_git_repository: true,
        is_vault_git_root,
        repository_problem,
        branch: current_branch(vault)?,
        remote_url: optional_git_stdout(vault, &["remote", "get-url", "origin"], DEFAULT_TIMEOUT),
        upstream: optional_git_stdout(
            vault,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
            DEFAULT_TIMEOUT,
        ),
        ahead,
        behind,
        has_head: has_head(vault),
    })
}

/** 生成空仓库信息 */
fn empty_repo_info(
    is_git_repository: bool,
    is_vault_git_root: bool,
    repository_problem: Option<String>,
) -> RepositoryInfo {
    RepositoryInfo {
        is_git_repository,
        is_vault_git_root,
        repository_problem,
        branch: None,
        remote_url: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        has_head: false,
    }
}

/** 是否已有 HEAD 提交 */
fn has_head(vault: &Path) -> bool {
    run_git(vault, &["rev-parse", "--verify", "HEAD"], DEFAULT_TIMEOUT)
        .map(|output| output.code == 0)
        .unwrap_or(false)
}

/** 读取 ahead/behind 数量，没有 upstream 时返回 0 */
fn read_ahead_behind(vault: &Path) -> (u32, u32) {
    let Some(raw) = optional_git_stdout(
        vault,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        DEFAULT_TIMEOUT,
    ) else {
        return (0, 0);
    };
    let mut parts = raw.split_whitespace();
    let ahead = parts
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0);
    let behind = parts
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0);
    (ahead, behind)
}

/** 读取 porcelain -z 状态列表 */
fn read_status_entries(vault: &Path) -> Result<Vec<StatusEntry>, String> {
    let output = run_git_checked(
        vault,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        DEFAULT_TIMEOUT,
    )?;
    let parts: Vec<&str> = output
        .stdout
        .split('\0')
        .filter(|part| !part.is_empty())
        .collect();
    let mut entries = Vec::new();
    let mut index = 0;

    while index < parts.len() {
        let record = parts[index];
        let bytes = record.as_bytes();
        if bytes.len() < 4 {
            index += 1;
            continue;
        }

        let index_status = bytes[0] as char;
        let worktree_status = bytes[1] as char;
        let path = record[3..].to_string();
        let mut old_path = None;
        index += 1;

        if matches!(index_status, 'R' | 'C') && index < parts.len() {
            old_path = Some(parts[index].to_string());
            index += 1;
        }

        entries.push(StatusEntry {
            path,
            old_path,
            index_status,
            worktree_status,
        });
    }

    Ok(entries)
}

/** 读取 diff numstat 并按路径聚合 */
fn read_numstat(vault: &Path, args: &[&str]) -> Result<HashMap<String, LineStat>, String> {
    let output = run_git_checked(vault, args, DEFAULT_TIMEOUT)?;
    let mut stats = HashMap::new();

    for record in output.stdout.split('\0').filter(|part| !part.is_empty()) {
        let mut parts = record.split('\t');
        let additions = parse_numstat_value(parts.next());
        let deletions = parse_numstat_value(parts.next());
        let Some(path) = parts.next() else {
            continue;
        };
        stats.insert(
            path.to_string(),
            LineStat {
                additions,
                deletions,
            },
        );
    }

    Ok(stats)
}

/** 将 numstat 单元格转换为数字，二进制文件按 0 处理 */
fn parse_numstat_value(value: Option<&str>) -> u32 {
    value.and_then(|item| item.parse::<u32>().ok()).unwrap_or(0)
}

/** 把状态项和行数统计合成前端文件记录 */
fn create_changed_file(
    vault: &Path,
    entry: StatusEntry,
    staged_stats: &HashMap<String, LineStat>,
    unstaged_stats: &HashMap<String, LineStat>,
    untracked_line_count_budget: &mut u64,
) -> Result<Option<GitChangedFile>, String> {
    if should_skip_status_entry(vault, &entry)? {
        return Ok(None);
    }

    let is_untracked = entry.index_status == '?' && entry.worktree_status == '?';
    let is_staged = entry.index_status != ' ' && entry.index_status != '?';
    let is_unstaged = entry.worktree_status != ' ' || is_untracked;
    let staged_stat = staged_stats.get(&entry.path).cloned().unwrap_or_default();
    let mut unstaged_stat = unstaged_stats.get(&entry.path).cloned().unwrap_or_default();
    if is_untracked && unstaged_stat.additions == 0 && unstaged_stat.deletions == 0 {
        unstaged_stat.additions =
            count_file_lines(vault, &entry.path, untracked_line_count_budget)?;
    }
    let stat = merge_stats(&staged_stat, &unstaged_stat);

    Ok(Some(GitChangedFile {
        path: entry.path.clone(),
        old_path: entry.old_path,
        index_status: entry.index_status.to_string(),
        worktree_status: entry.worktree_status.to_string(),
        kind: status_kind(entry.index_status, entry.worktree_status),
        is_staged,
        is_unstaged,
        staged_additions: staged_stat.additions,
        staged_deletions: staged_stat.deletions,
        unstaged_additions: unstaged_stat.additions,
        unstaged_deletions: unstaged_stat.deletions,
        additions: stat.additions,
        deletions: stat.deletions,
    }))
}

/** 过滤目录和空文件，保证 Git 面板只展示可操作文件 */
fn should_skip_status_entry(vault: &Path, entry: &StatusEntry) -> Result<bool, String> {
    let absolute = vault.join(&entry.path);
    let is_deleted = entry.index_status == 'D' || entry.worktree_status == 'D';
    let Ok(metadata) = fs::metadata(&absolute) else {
        return Ok(!is_deleted);
    };

    if metadata.is_dir() {
        return Ok(true);
    }
    if metadata.is_file() && metadata.len() == 0 && !is_deleted {
        return Ok(true);
    }

    Ok(false)
}

/** 合并 staged 与 unstaged 的行数统计 */
fn merge_stats(staged: &LineStat, unstaged: &LineStat) -> LineStat {
    LineStat {
        additions: staged.additions + unstaged.additions,
        deletions: staged.deletions + unstaged.deletions,
    }
}

/** 映射 Git XY 状态为 UI 可读分类 */
fn status_kind(index_status: char, worktree_status: char) -> String {
    if index_status == '?' && worktree_status == '?' {
        return "untracked".to_string();
    }
    if matches!(
        (index_status, worktree_status),
        ('U', _) | (_, 'U') | ('A', 'A') | ('D', 'D')
    ) {
        return "conflicted".to_string();
    }
    if index_status == 'R' || worktree_status == 'R' {
        return "renamed".to_string();
    }
    if index_status == 'A' || worktree_status == 'A' {
        return "added".to_string();
    }
    if index_status == 'D' || worktree_status == 'D' {
        return "deleted".to_string();
    }
    "modified".to_string()
}

/** 小文件按行数统计未跟踪文件新增行数 */
fn count_file_lines(vault: &Path, path: &str, remaining_budget: &mut u64) -> Result<u32, String> {
    let absolute = vault.join(path);
    let metadata =
        fs::metadata(&absolute).map_err(|error| format!("读取文件信息失败：{}", error))?;
    if metadata.len() > MAX_UNTRACKED_LINE_COUNT_BYTES || metadata.len() > *remaining_budget {
        return Ok(0);
    }
    *remaining_budget = remaining_budget.saturating_sub(metadata.len());
    let content = fs::read_to_string(&absolute).unwrap_or_default();
    Ok(content.lines().count() as u32)
}

/** 确保 .gitignore 存在，并把常见本地缓存忽略规则写到文件顶部 */
pub(crate) fn ensure_default_gitignore(vault: &Path) -> Result<(), String> {
    let path = vault.join(".gitignore");
    let content = fs::read_to_string(&path).unwrap_or_default();

    let missing_entries = DEFAULT_GITIGNORE_ENTRIES
        .iter()
        .filter(|entry| !content.lines().any(|line| line.trim() == **entry))
        .copied()
        .collect::<Vec<_>>();
    if missing_entries.is_empty() {
        return Ok(());
    }

    let mut prefix = String::from("# Mira local and system files\n");
    for entry in missing_entries {
        prefix.push_str(entry);
        prefix.push('\n');
    }
    if !content.is_empty() {
        prefix.push('\n');
        prefix.push_str(&content);
        if !prefix.ends_with('\n') {
            prefix.push('\n');
        }
    }

    fs::write(path, prefix).map_err(|error| format!("写入 .gitignore 失败：{}", error))
}
