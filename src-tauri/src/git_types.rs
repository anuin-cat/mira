use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub kind: String,
    pub is_staged: bool,
    pub is_unstaged: bool,
    pub staged_additions: u32,
    pub staged_deletions: u32,
    pub unstaged_additions: u32,
    pub unstaged_deletions: u32,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    pub is_git_repository: bool,
    pub is_vault_git_root: bool,
    pub repository_problem: Option<String>,
    pub branch: Option<String>,
    pub remote_url: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub has_head: bool,
    pub changed_files: Vec<GitChangedFile>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub path: String,
    pub mode: String,
    pub diff: String,
    pub is_truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationResult {
    pub status: GitStatusResult,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReadonlyResult {
    pub command_id: String,
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
    pub is_truncated: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffRequest {
    pub vault_path: String,
    pub path: String,
    pub mode: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPathsRequest {
    pub vault_path: String,
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRequest {
    pub vault_path: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubInitRequest {
    pub vault_path: String,
    pub repo_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteConnectRequest {
    pub vault_path: String,
    pub remote_url: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReadonlyRequest {
    pub vault_path: String,
    pub command: String,
}
