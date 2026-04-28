const MAX_READONLY_COMMAND_CHARS: usize = 2000;
const MAX_READONLY_ARGS: usize = 64;

const FORBIDDEN_DIFF_OPTIONS: [&str; 6] = [
    "--output",
    "--ext-diff",
    "--no-index",
    "--textconv",
    "--word-diff-regex",
    "--external-diff",
];

const FORBIDDEN_BRANCH_OPTIONS: [&str; 12] = [
    "-d",
    "-D",
    "-m",
    "-M",
    "-c",
    "-C",
    "--delete",
    "--move",
    "--copy",
    "--set-upstream-to",
    "--unset-upstream",
    "--edit-description",
];

#[derive(Clone, Debug)]
pub struct ValidatedGitReadonlyCommand {
    pub command_id: String,
    pub args: Vec<String>,
}

/** 校验 agent 填写的 Git 命令是否属于内置只读命令集 */
pub fn validate_readonly_command(command: &str) -> Result<ValidatedGitReadonlyCommand, String> {
    // 1. 解析命令字符串，拒绝空命令和过长命令
    if command.len() > MAX_READONLY_COMMAND_CHARS {
        return Err("Git 命令过长".to_string());
    }
    let tokens = parse_command_words(command)?;
    if tokens.is_empty() {
        return Err("Git 命令不能为空".to_string());
    }
    if tokens.len() > MAX_READONLY_ARGS {
        return Err("Git 命令参数过多".to_string());
    }
    if tokens[0] != "git" {
        return Err("只允许执行 git 命令".to_string());
    }

    // 2. 识别内置只读命令
    let args = tokens[1..].to_vec();
    if args.is_empty() {
        return Err("缺少 git 子命令".to_string());
    }

    let command_id = resolve_readonly_command_id(&args)?;
    Ok(ValidatedGitReadonlyCommand { command_id, args })
}

/** 将命令行文本拆成参数，不经过 shell 执行 */
fn parse_command_words(command: &str) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut chars = command.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        if ch == '\0' || ch == '\n' || ch == '\r' {
            return Err("Git 命令不能包含换行或空字符".to_string());
        }

        match quote {
            Some('\'') => {
                if ch == '\'' {
                    quote = None;
                } else {
                    current.push(ch);
                }
            }
            Some('"') => {
                if ch == '"' {
                    quote = None;
                } else if ch == '\\' {
                    if let Some(next_ch) = chars.next() {
                        current.push(next_ch);
                    }
                } else {
                    current.push(ch);
                }
            }
            Some(_) => unreachable!(),
            None => {
                if ch.is_whitespace() {
                    if !current.is_empty() {
                        tokens.push(std::mem::take(&mut current));
                    }
                } else if ch == '\'' || ch == '"' {
                    quote = Some(ch);
                } else if ch == '\\' {
                    if let Some(next_ch) = chars.next() {
                        current.push(next_ch);
                    }
                } else {
                    current.push(ch);
                }
            }
        }
    }

    if quote.is_some() {
        return Err("Git 命令引号未闭合".to_string());
    }
    if !current.is_empty() {
        tokens.push(current);
    }

    Ok(tokens)
}

/** 根据参数识别并限制具体只读命令 */
fn resolve_readonly_command_id(args: &[String]) -> Result<String, String> {
    match args[0].as_str() {
        "status" => Ok("status".to_string()),
        "diff" => {
            ensure_no_forbidden_option(args, &FORBIDDEN_DIFF_OPTIONS)?;
            Ok("diff".to_string())
        }
        "log" => Ok("log".to_string()),
        "show" => {
            ensure_no_forbidden_option(args, &FORBIDDEN_DIFF_OPTIONS)?;
            Ok("show".to_string())
        }
        "branch" => validate_branch_command(args),
        "remote" => validate_remote_command(args),
        "rev-parse" => Ok("rev_parse".to_string()),
        "ls-files" => Ok("ls_files".to_string()),
        "grep" => Ok("grep".to_string()),
        _ => Err(format!("不在只读 Git 命令清单中：git {}", args[0])),
    }
}

/** 禁止 diff/show 中可能写文件或执行外部程序的参数 */
fn ensure_no_forbidden_option(args: &[String], forbidden_options: &[&str]) -> Result<(), String> {
    for arg in args {
        if forbidden_options
            .iter()
            .any(|option| arg == option || arg.starts_with(&format!("{}=", option)))
        {
            return Err(format!("只读 Git 命令禁止使用参数：{}", arg));
        }
    }

    Ok(())
}

/** 限制 git branch 只能查看分支，不能创建、移动或删除分支 */
fn validate_branch_command(args: &[String]) -> Result<String, String> {
    ensure_no_forbidden_option(args, &FORBIDDEN_BRANCH_OPTIONS)?;

    if args.len() == 1 {
        return Ok("branch".to_string());
    }

    let first_arg = args[1].as_str();
    let is_list_variant = matches!(
        first_arg,
        "--show-current" | "--list" | "-l" | "--all" | "-a" | "--remotes" | "-r" | "-v" | "-vv"
    );

    if is_list_variant || first_arg.starts_with("--format=") {
        return Ok("branch".to_string());
    }

    Err("git branch 只允许查看分支列表或当前分支".to_string())
}

/** 限制 git remote 只能查看远端，不能添加、修改或删除远端 */
fn validate_remote_command(args: &[String]) -> Result<String, String> {
    if args.len() == 1 {
        return Ok("remote".to_string());
    }
    if args.len() == 2 && args[1] == "-v" {
        return Ok("remote".to_string());
    }
    if args.len() == 3 && args[1] == "get-url" {
        return Ok("remote".to_string());
    }

    Err("git remote 只允许查看远端列表或读取远端 URL".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_basic_readonly_commands() {
        let validated = validate_readonly_command("git status --short").unwrap();
        assert_eq!(validated.command_id, "status");
        assert_eq!(validated.args, vec!["status", "--short"]);
    }

    #[test]
    fn rejects_write_commands() {
        let error = validate_readonly_command("git commit -m hi").unwrap_err();
        assert!(error.contains("不在只读 Git 命令清单"));
    }

    #[test]
    fn rejects_dangerous_diff_output() {
        let error = validate_readonly_command("git diff --output=/tmp/x.patch").unwrap_err();
        assert!(error.contains("--output"));
    }

    #[test]
    fn rejects_branch_creation_shape() {
        let error = validate_readonly_command("git branch new-topic").unwrap_err();
        assert!(error.contains("只允许查看"));
    }

    #[test]
    fn parses_quoted_paths() {
        let validated = validate_readonly_command("git show HEAD:\"foo bar.md\"").unwrap();
        assert_eq!(validated.args, vec!["show", "HEAD:foo bar.md"]);
    }
}
