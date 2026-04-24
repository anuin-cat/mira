# 0. AGENTS.md 维护规则

- 进行内容修改前，先阅读 AGENTS.md 了解项目结构和规范
- 针对新增或删除的功能，操作完成后检查 AGENTS.md 是否需要更新
- 仅在确有必要时才执行新增或修改，严禁添加冗余内容
- 禁止删除仍然存在的组件所对应的描述内容

## 项目说明

这是一个 mac 优先的本地桌面应用，用于记录个人行为、想法与反思，并结合 AI 做总结、追问、关联与回顾。

## 技术栈

- Tauri 2
- React
- TypeScript
- Vite
- pnpm

## 基本原则

- 本地优先
- 文件优先
- Markdown + JSON 为唯一事实来源
- React 只做 UI
- TypeScript 负责业务逻辑
- Tauri 负责桌面能力和文件系统访问

## 不要主动引入

除非明确要求，否则不要添加：

- Python
- 后端服务
- 数据库
- 云同步
- 认证系统
- 遥测
- 重型状态管理

## 目录约定

- `src/components`：UI 组件
- `src/features`：功能模块
- `src/services`：文件、索引、AI 服务
- `src/domain`：类型与规则
- `src/tauri`：Tauri 封装

## 数据约定

推荐结构：

vault/
  entries/
  meta/
  reflections/
  indexes/
  attachments/
  config/

其中：

* `entries/` 和 `meta/` 是源数据
* `indexes/` 是可重建缓存

## 编码要求

* 优先写清晰的小模块
* 不要把业务逻辑塞进 React 组件
* 避免无必要依赖
* 保持改动小而聚焦
* 修改数据格式时尽量保持兼容

## 常用命令

* `pnpm install`
* `pnpm tauri dev`
* `pnpm tauri build`
