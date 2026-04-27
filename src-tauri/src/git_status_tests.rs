use crate::git_status::ensure_default_gitignore;
use std::fs;

fn create_temp_vault(name: &str) -> std::path::PathBuf {
    let path =
        std::env::temp_dir().join(format!("mira-git-status-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn creates_gitignore_with_default_entries() {
    let vault = create_temp_vault("create");
    ensure_default_gitignore(&vault).unwrap();
    let content = fs::read_to_string(vault.join(".gitignore")).unwrap();
    assert!(content.starts_with("# Mira local and system files\n.mira/\n.DS_Store\n"));
    assert!(content.contains(".vscode/\n"));
    fs::remove_dir_all(vault).unwrap();
}

#[test]
fn prepends_missing_gitignore_entries_without_duplicates() {
    let vault = create_temp_vault("prepend");
    fs::write(
        vault.join(".gitignore"),
        ".DS_Store\n\n# user rules\nnotes/private.md\n",
    )
    .unwrap();
    ensure_default_gitignore(&vault).unwrap();
    let content = fs::read_to_string(vault.join(".gitignore")).unwrap();
    assert!(content.starts_with("# Mira local and system files\n.mira/\nThumbs.db\n"));
    assert_eq!(content.matches(".DS_Store").count(), 1);
    assert!(content.ends_with("# user rules\nnotes/private.md\n"));
    fs::remove_dir_all(vault).unwrap();
}
