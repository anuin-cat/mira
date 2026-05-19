# Mira

Mira 是一个本地优先的桌面笔记应用，用 Markdown 记录想法、行动与反思，并通过 AI 帮助总结、追问和关联上下文。

## 特性

- 本地文件优先：笔记以 `.md` 文件存放，vault 可直接用 Finder、资源管理器、Obsidian 或普通编辑器打开。
- Markdown 原生：内容保持可读、可迁移、可备份，不把用户数据锁进数据库。
- AI 辅助：围绕当前笔记和选中文本进行提问、总结、改写和文件编辑。
- 桌面体验：支持文件树、富文本 Markdown 编辑、全局搜索、命令面板、主题和字号调整。

## 下载

前往 [GitHub Releases](https://github.com/anuin-cat/mira/releases/latest) 下载最新版安装包。

当前发布的是未签名的早期版本：

- macOS 首次打开可能需要在“系统设置 > 隐私与安全性”中选择“仍要打开”。
- Windows 首次运行可能出现 SmartScreen 提示，可选择“更多信息 > 仍要运行”。

## 开发

```bash
pnpm install
pnpm tauri dev
```
