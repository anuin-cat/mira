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
- Tailwind CSS v4
- shadcn/ui
- Radix UI（通过 shadcn/ui 组件使用）
- lucide-react
- MDXEditor（Markdown/MDX 富文本编辑器，Lexical 底层，输入输出原生 .md 文件）
- date-fns（日期格式化）

## 前端样式

- **优先**使用 [shadcn/ui](https://ui.shadcn.com/) 已有组件（`src/components/ui`）组合与扩展，保持交互、无障碍与视觉与项目其余部分一致
- **其次**用 Tailwind 工具类在 JSX 上微调布局、间距、排版、颜色等；需要可复用样式时，优先 Tailwind 的 `@apply` 或组件级 class 组合，避免散落魔法字符串
- **仅在必要时**再写独立 CSS（如第三方库深度定制、无法用工具类表达的复杂动画或全局主题变量）；新样式文件应有明确理由，并尽量收窄作用域（避免全局污染）

## 基本原则

- 本地优先
- 文件优先
- Markdown 是用户主数据；JSON 仅用于 `.mira/` 内部可重建状态
- React 只做 UI
- TypeScript 负责业务逻辑
- Tauri 负责桌面能力和文件系统访问

## 产品与数据设计原则

- 人类可读优先，再考虑 AI/机器可读；一般情况下，人类可读的结构天然也利于 AI 理解
- vault 在 Finder、Obsidian、普通编辑器和 Git 中都应自然可读、可迁移、可备份
- 用户可见文件夹和文件名应承载主要分类语义，避免用过度程序化命名或隐藏索引替代用户可理解的组织方式
- 新增文件优先使用低心智负担交互：在文件树中创建实体，再让用户直接重命名；避免要求普通用户输入抽象相对路径
- 索引、缓存、最近打开、展开状态等只能作为 `.mira/` 内部可重建数据，不应成为理解或恢复 vault 的必要条件
- vault 的目录结构应可直接从用户可见的文件夹与 Markdown 文件恢复，不依赖额外语义目录文件

## macOS 菜单规范

- 所有全局操作（换 vault、设置、导出等）一律加到原生菜单栏，不在 UI 内另加按钮或工具栏
- 菜单在 `src-tauri/src/lib.rs` 的 `.setup()` 中用 Tauri 2 `Menu` / `Submenu` / `MenuItem` API 注册
- 菜单点击通过 `app.emit("menu:<event-id>", ())` 发送事件到前端
- 前端在 `App.tsx` 的 `useEffect` 中用 `listen("menu:<event-id>", ...)` 监听并响应
- macOS 必须保留原生 `Edit` 菜单，并优先用系统预定义菜单项承接 `Undo` / `Redo` / `Cut` / `Copy` / `Paste` / `Select All`，避免 WebView 内文本编辑快捷键失效
- 新增菜单项时，同步在此处登记：
  - `File > 新建文件` → `new_file` → `menu:new-file`
  - `File > 新建文件夹` → `new_folder` → `menu:new-folder`
  - `File > 保存当前文件` → `save_file` → `menu:save-file`
  - `File > 更换 Vault...` → `change_vault` → `menu:change-vault`
  - `File > 刷新 Vault` → `refresh_vault` → `menu:refresh-vault`
  - `File > 重命名` → `rename_entry` → `menu:rename-entry`
  - `File > 删除` → `delete_entry` → `menu:delete-entry`
  - `File > 在 Finder 中显示` → `reveal_in_finder` → `menu:reveal-in-finder`
  - `Search > 当前文件内搜索` → `find_in_file` → `menu:find-in-file`
  - `Search > 全 Vault 搜索` → `search_vault` → `menu:search-vault`
  - `Navigate > 快速打开文件` → `quick_open` → `menu:quick-open`
  - `Navigate > 命令面板` → `command_palette` → `menu:command-palette`
  - `Navigate > 返回上一个文件` → `history_back` → `menu:history-back`
  - `Navigate > 前进到下一个文件` → `history_forward` → `menu:history-forward`
  - `View > 显示/隐藏文件侧栏` → `toggle_file_sidebar` → `menu:toggle-file-sidebar`
  - `View > 显示/隐藏 AI 对话栏` → `toggle_ai_sidebar` → `menu:toggle-ai-sidebar`
  - `View > 缩小字体` → `font_decrease` → `menu:font-decrease`
  - `View > 放大字体` → `font_increase` → `menu:font-increase`
  - `View > 重置字体大小` → `font_reset` → `menu:font-reset`
  - `View > 小` → `font_small` → `menu:font-size-small`
  - `View > 中` → `font_medium` → `menu:font-size-medium`
  - `View > 大` → `font_large` → `menu:font-size-large`
  - `View > 特大` → `font_xlarge` → `menu:font-size-xlarge`
  - `View > 主题 > 默认` → `theme_default` → `menu:theme-default`
  - `View > 主题 > 纸质书页` → `theme_warm_paper` → `menu:theme-warm-paper`
  - `View > 主题 > 暮光蓝` → `theme_twilight` → `menu:theme-twilight`
  - `View > 主题 > 森林绿` → `theme_forest` → `menu:theme-forest`
  - `View > 主题 > 经典深色` → `theme_dark_classic` → `menu:theme-dark-classic`
  - `Git > 打开 Git 面板` → `git_panel` → `menu:git-panel`
  - `Git > 连接 GitHub 远端...` → `git_connect_remote` → `menu:git-connect-remote`
  - `Git > Stage 全部变更` → `git_stage_all` → `menu:git-stage-all`
  - `Git > Commit...` → `git_commit` → `menu:git-commit`
  - `Git > Push` → `git_push` → `menu:git-push`
  - `AI > 新建 AI 对话` → `ai_new_chat` → `menu:ai-new-chat`
  - `AI > 基于当前笔记提问` → `ai_ask_current_note` → `menu:ai-ask-current-note`
  - `App > 设置` → `app_settings` → `menu:app-settings`

## 依赖选型原则

- 能用成熟库解决的问题，不要自己造轮子
- 优先选择：轻量、兼容性好、社区口碑好的库
- 使用到某个库的特性时，先查该库官方文档并优先采用官方推荐用法与最佳实践，不凭经验臆测或自行重写同类实现
- 如果候选库较重或不确定是否合适，先向用户确认再引入

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
- `src/features/editor/currentFileSearch.ts`：当前编辑器内搜索、高亮与滚动定位逻辑
- `src/features/git`：Git 面板 UI，包括变更列表、diff、stage/unstage、commit、push、本地 Git 初始化与 GitHub 远端连接入口
- `src/features/vault/search`：vault 级搜索逻辑；命令弹层只负责展示和调度，不承载搜索算法
- `src/lib`：共享工具与轻量基础能力
- `src/services`：文件、索引、AI 服务
- `src/services/agent`：AI agent 内核；`tools` 放可控工具，`utils` 放工具共享辅助逻辑
- `src/services/aiCompatibility`：AI provider 兼容层；DeepSeek、KIMI、硅基流动等平台差异必须分文件维护，主流程只调用统一 adapter
- `src/domain`：类型与规则
- `src/tauri`：Tauri 封装

## 数据约定

推荐结构：

vault/
  日常/
    今天想法.md
  项目/
    Mira 设计.md
  .mira/
    state.json

其中：

* 用户可见的目录和 `.md` 文件是唯一主数据，文件名和文件夹名应尽量人类可读
* `.mira/` 是应用内部目录，只能存放可丢弃、可重建的状态、索引或缓存
* 删除 `.mira/` 后，应用必须能根据 vault 中的 Markdown 文件重新扫描恢复

## Git 自动化约定

- Git 功能要求 vault 根目录就是 Git 仓库根目录，不操作外层仓库
- 用户触发的 `add` / `commit` / `push` / remote 连接只能通过 Git 面板或原生 `Git` 菜单执行
- agent 只能调用内置 allowlist 中已启用的 `git_readonly` 命令，禁止执行会改变仓库状态的 Git 命令
- 初始化本地 Git 仓库时默认把 `.mira/` 与常见系统缓存规则写到 `.gitignore` 顶部
- Mira 不负责创建 GitHub 远端仓库；用户在 GitHub 网页创建仓库后粘贴 remote URL，Mira 只执行本地 `git remote add/set-url` 与 `git push`

## AI 文件编辑约定

- agent 修改 Markdown 文件只能通过 `vault_edit_note` 执行精确替换、删除或插入，写入前必须校验 `vault_read_note` 返回的 `contentHash`
- 单次编辑调用必须先完整校验所有编辑项；任一 `oldText` 或 `anchorText` 找不到、命中次数不符、hash 不一致或当前打开文件存在未保存内容时，不得写入文件
- 新增文本优先使用 `insert_before` / `insert_after` 搭配唯一 `anchorText` 定位；只有明确文首/文末语义时才用 `prepend` / `append`，不要用裸行号或模糊匹配定位
- assistant 消息必须展示本次 agent 修改的文件列表与增删行数，并保留一键回退本次修改的入口
- 回退只能在目标文件仍保持 AI 修改后的 hash 时执行；若用户或外部程序后续改动过文件，必须拒绝回退以避免覆盖用户新内容

## 搜索性能约定

- 全 Vault 搜索必须按 vault 规模选择策略：小 vault 可构建轻量内存索引，大 vault 或大文件按需逐文件扫描，避免打开搜索面板就把所有正文读入内存
- 文件树扫描应保留 Markdown 文件 `sizeBytes`，搜索策略用文件数、总字节数和单文件大小判断是否降级
- 当前文件搜索只扫描已打开编辑器内容；高亮与跳转逻辑集中在 `src/features/editor/currentFileSearch.ts`

## 平台限制与解决方案

### Tauri macOS HTML5 拖拽注意事项

**问题**：在 macOS Tauri 中，如果依赖 HTML5 DnD，可能出现 `dragstart` / `dragend` 有效，但 `dragover`、`dragenter`、`drop` 不稳定或不触发。不要简单归因于 WKWebView 不支持，优先检查 Tauri 默认的 `dragDropEnabled` 原生拖放处理是否拦截了前端拖拽事件。react-arborist 内置拖拽依赖 react-dnd-html5-backend，因此也会受影响。

**解决**：如果要使用前端 HTML5 DnD，先确认是否可以关闭 Tauri 原生拖放处理；如果仍不稳定，就避开 HTML5 DnD。`src/features/file-tree/FileTree.tsx` 当前使用原生鼠标事件（`mousedown` → `mousemove` → `mouseup`）实现自定义拖拽：

- `disableDrag` + `disableDrop` 禁用 react-arborist 内置 DnD
- `data-path` / `data-kind` 属性挂在 DOM 节点上，通过事件委托在容器层统一捕获
- 拖拽预览、目标高亮、边界自动滚动、悬停自动展开目录均通过直接 DOM 操作实现
- 落点合法性校验：同目录跳过、禁止目录自嵌套

### shadcn/ui 与全局 CSS Reset 冲突

**问题**：shadcn 组件（如 `Select`、`Card` 等）的 Tailwind 工具类（`py-1`、`px-2`、`shadow-md` 等）不生效，表现为内边距为零、无阴影、无圆角。

**根本原因**：`App.css` 里的 `* { margin: 0; padding: 0; }` 是普通 CSS（不在任何 `@layer` 里），CSS 规范规定不在 `@layer` 里的规则优先级高于任何 `@layer` 里的规则，而 Tailwind 工具类在 `@layer utilities` 里，因此全局 reset 会覆盖所有 shadcn 组件的间距类。

**解决**：把全局 reset 移入 `@layer base`，让 Tailwind 工具类能正常覆盖它：

```css
@layer base {
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
}
```

### shadcn/ui 组合约束

**问题**：shadcn 组件源码已复制进项目后，若没有按官方组合结构使用，常见表现是“样式不全”而不是直接报错。例如 `SelectContent` 里直接放 `SelectItem`，视觉上会少一层弹出层内边距。

**根本原因**：部分间距、分组、滚动等样式并不挂在最外层容器，而是挂在特定子组件上。以当前 `src/components/ui/select.tsx` 为例，弹出层那圈 `p-1` 是由 `SelectGroup` 提供的，不加这一层就会看起来像“样式丢了”。

**解决**：使用 shadcn 组件前，先按官方文档的 composition 结构组合，不要只拷贝能跑通的最短 JSX。当前项目里 `Select` 的推荐结构是：

```tsx
<Select>
  <SelectTrigger>
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectItem value="...">...</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>
```

### MDXEditor 弹层层级注意事项

MDXEditor 的下拉菜单会 portal 到 `body > .mdxeditor-popup-container`，该外壳自身会形成 stacking context。若弹层被 sticky 工具栏遮挡，优先抬高 portal 外壳的 `z-index`，不要只调 Radix 内层 wrapper；视觉上避免把菜单和按钮硬拼接，优先使用独立浮层、完整圆角和少量间距。

## 编码要求

* 优先写清晰的小模块
* 不要把业务逻辑塞进 React 组件
* 避免无必要依赖
* 保持改动小而聚焦
* 修改数据格式时尽量保持兼容
* 输入框按 Enter 触发提交时必须兼容 IME（拼音等）组合输入：组合过程中 Enter 仅用于确认候选，不能触发提交

## 组织原则

- 保持项目结构清晰，遵循模块化原则
- 相关功能放在同一目录下，目录名应反映其内容
- 单个代码文件不宜超过 600 行，300 行以内最佳
- 单个函数尽量控制在 100 行以内（复杂函数可适当放宽）
- 拆分优先级：先拆逻辑层（`src/services/`、`src/features/`）再拆展示层（`src/components/`）

## 编码原则

**目标：在保证可维护性的前提下，优先交付简单、稳定、可读的实现；避免过早抽象与过度工程化**

**重构可大刀阔斧**，重构不需要考虑对已删除老代码的兼容性，项目处于早期开发阶段，应尽可能减少冗余代码，提高代码健壮性。

## Git 规范

- 允许执行只读 Git 操作（如 `git status`、`git log`、`git diff`、`git branch`）以了解仓库状态
- **禁止执行任何会改变仓库状态的 Git 操作**，包括但不限于：`commit`、`merge`、`rebase`、`push`、`pull`、`reset`、`checkout`（切换分支）、`stash` 等
- 所有涉及状态变更的 Git 操作一律由用户自行完成

## 测试规范

- 新增逻辑若容易出错（解析/状态机/边界条件/存储），优先补最小必要的验证
- 测试必须使用本地 Mock 数据，严禁对用户真实 vault 数据执行写入/删除操作
- 修改完成后无需启动项目给用户查看，用户会自己启动（重复启动会产生端口冲突）

## 命名规范

- **类名**：PascalCase
- **函数名**：camelCase
- **常量**：UPPER_SNAKE_CASE，放到文件顶部
- **函数参数**：语义化命名（如 `entryId` 而非 `id1`）
- **接口/类型**：具体化命名（如 `EntryListProps` 而非 `IProps`）
- **布尔变量**：以 `is`/`has`/`can` 开头（`isLoading`、`hasReflection`）
- **事件处理**：`handle[元素][事件]`（如 `handleInputChange`、`handleSubmitClick`）
- **文件名**：参考现有文件名风格，不要过度自描述

## 注释规范

- 函数必须有简洁的中文注释，除非函数过短或逻辑显而易见
- **函数注释**：使用 JSDoc 格式 `/** 功能说明 */`，说明函数用途；必要时注明参数含义与返回值
- **函数大纲注释**：在函数体第一缩进层级，用 `// 1. ...`、`// 2. ...` 编号标记主要逻辑块，充当函数的"目录"
- 子块可用 `// 2.1` 或无编号折行说明，与大纲保持一个缩进层级
- 简单的行内说明可直接放到该行末尾，防止代码行数膨胀
- 所有注释使用中文撰写
- **终极目标**：任意开发者通过注释大纲，一眼就能看懂函数的功能和逻辑分区

## 常用命令

* `pnpm install`
* `pnpm tauri dev`
* `pnpm tauri build`
