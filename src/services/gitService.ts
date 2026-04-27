import { invoke } from '@tauri-apps/api/core'
import type {
  GitDiffMode,
  GitDiffResult,
  GitOperationResult,
  GitReadonlyResult,
  GitStatusResult,
} from '../domain/git'

/** 读取当前 vault 的 Git 状态 */
export async function getGitStatus(vaultPath: string): Promise<GitStatusResult> {
  return await invoke<GitStatusResult>('git_get_status', { vaultPath })
}

/** 读取指定文件的 staged 或 unstaged diff */
export async function getGitDiff(
  vaultPath: string,
  path: string,
  mode: GitDiffMode
): Promise<GitDiffResult> {
  return await invoke<GitDiffResult>('git_get_diff', {
    request: { vaultPath, path, mode },
  })
}

/** stage 指定文件；paths 为空表示 stage 全部 */
export async function stageGitPaths(vaultPath: string, paths: string[]): Promise<GitOperationResult> {
  return await invoke<GitOperationResult>('git_stage_paths', {
    request: { vaultPath, paths },
  })
}

/** unstage 指定文件；paths 为空表示 unstage 全部 */
export async function unstageGitPaths(vaultPath: string, paths: string[]): Promise<GitOperationResult> {
  return await invoke<GitOperationResult>('git_unstage_paths', {
    request: { vaultPath, paths },
  })
}

/** 创建 Git commit */
export async function commitGitChanges(vaultPath: string, message: string): Promise<GitOperationResult> {
  return await invoke<GitOperationResult>('git_commit', {
    request: { vaultPath, message },
  })
}

/** 推送当前分支 */
export async function pushGitBranch(vaultPath: string): Promise<GitOperationResult> {
  return await invoke<GitOperationResult>('git_push', { vaultPath })
}

/** 用 GitHub CLI 创建私有仓库并连接当前 vault */
export async function initGitHubRepository(
  vaultPath: string,
  repoName: string | null
): Promise<GitOperationResult> {
  return await invoke<GitOperationResult>('git_init_github_repository', {
    request: { vaultPath, repoName },
  })
}

/** 用用户粘贴的 remote URL 连接 GitHub 仓库 */
export async function connectGitRemoteRepository(
  vaultPath: string,
  remoteUrl: string
): Promise<GitOperationResult> {
  return await invoke<GitOperationResult>('git_connect_remote_repository', {
    request: { vaultPath, remoteUrl },
  })
}

/** 执行 agent 可用的只读 Git 命令 */
export async function runReadonlyGitCommand(
  vaultPath: string,
  command: string
): Promise<GitReadonlyResult> {
  return await invoke<GitReadonlyResult>('git_run_readonly', {
    request: { vaultPath, command },
  })
}
