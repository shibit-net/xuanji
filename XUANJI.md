# xuanji

## 项目信息

- **类型**: node
- **路径**: /Users/kevinshi/Documents/workspace/codebase/shibit/xuanji
- **首次分析时间**: 2026-05-24
- **Git 仓库**: 是
- **配置文件**: package.json

## 项目概述

xuanji 多智能体协调系统。Electron 桌面应用，前端 React + Vite，后端 TypeScript（agent-bridge 子进程）。支持 MCP (Model Context Protocol) 插件系统、Skills 技能系统、天工坊市场等。

## 架构

```
desktop/                          ← Electron 前端应用
  ├─ main/
  │   ├─ agent/index.ts           ← agent-bridge 子进程启动/管理
  │   ├─ agent-bridge.ts          ← 子进程入口（IPC + 核心逻辑）
  │   └─ ipc/                     ← IPC handlers（mcp, skill, session, ...）
  └─ renderer/                    ← React UI

src/                              ← 核心库（被 agent-bridge 子进程使用）
  ├─ core/                        ← Agent 核心、Provider、Tools、Templates
  ├─ mcp/                         ← MCP 客户端实现
  │   ├─ MCPClient.ts             ← stdio JSON-RPC 客户端
  │   ├─ MCPManager.ts            ← 多服务器管理器（单例）
  │   ├─ MCPSSEClient.ts          ← SSE 传输客户端
  │   ├─ HttpMCPClient.ts         ← HTTP 传输客户端
  │   ├─ config/                  ← 配置持久化（settings-persistence）
  │   └─ market/                  ← 天工坊市场集成
  ├─ session/                     ← 会话管理
  ├─ platform/                    ← 平台适配
  ├─ permission/                  ← 权限控制
  ├─ shared/utils/                ← 跨平台工具函数
  └─ context/                     ← 上下文管理
```

## 模块地图

- `src/mcp/MCPClient.ts` — stdio MCP 客户端，JSON-RPC 2.0 通信，自动重连
- `src/mcp/MCPManager.ts` — 多 MCP 服务器管理器（单例），支持热重载
- `src/mcp/MCPSSEClient.ts` — SSE 传输方式 MCP 客户端
- `src/mcp/HttpMCPClient.ts` — HTTP 传输方式 MCP 客户端
- `src/mcp/config/settings-persistence.ts` — mcp.json 读写（~/.xuanji/mcp.json）
- `src/core/tools/adapters/PlatformAdapter.ts` — 媒体生成平台适配器接口（ContentBlockResult + MediaGenInput + PlatformAdapter）
- `src/core/tools/adapters/ArkAdapter.ts` — 火山引擎豆包适配器（生图 + repaint 编辑）
- `src/core/tools/adapters/AdapterFactory.ts` — 平台适配器工厂（provider → adapter 映射）
- `src/core/tools/adapters/adapter-utils.ts` — 共享工具函数（apiPost/apiGet/parseB64Images/resolveSize/waitForAsyncTask）
- `src/core/tools/AbstractMediaGenTool.ts` — 媒体生成工具基类（校验 + config 读取 + 错误处理）
- `src/core/tools/GenerateImageTool.ts` — 文生图工具
- `src/core/tools/EditImageTool.ts` — 图片编辑工具（repaint）
- `src/core/tools/ToolConfigManager.ts` — 工具配置管理单例（从 Agent YAML tools[].config 加载）
- `src/shared/utils/crossPlatform.ts` — 跨平台工具（进程终止、Shell 适配、npm-cli.js 查找）
- `desktop/main/agent/index.ts` — agent-bridge 子进程启动/重启逻辑
- `desktop/main/agent-bridge.ts` — agent-bridge 子进程主入口

## 可复用组件 & 工具

- **findNpmCliPath()** (`src/shared/utils/crossPlatform.ts`) — 跨平台查找 npm-cli.js，优先级：Electron resourcesPath → process.execPath → 系统 PATH
- **injectNodeBinToPath()** (`src/mcp/MCPClient.ts`) — 将 Node.js bin 目录注入子进程 PATH，确保 MCP 子进程能找到 npx/node/npm
- **crossPlatformKill()** (`src/shared/utils/crossPlatform.ts`) — 跨平台强制终止子进程（Windows: taskkill，POSIX: SIGTERM/SIGKILL）
- **apiDelete()** (`src/core/tools/adapters/adapter-utils.ts`) — HTTP DELETE 请求工具函数，用于取消视频/音频异步任务
- **VideoTaskStatus** (`src/core/tools/adapters/PlatformAdapter.ts`) — 视频异步任务状态类型（taskId, status, progress?, videoUrl?, error?）
- **MediaTaskTracker** (`src/core/tools/MediaTaskTracker.ts`) — 异步媒体任务注册表（单例），追踪 generate_video(async=true) 等后台任务，Agent 通过 list_media_tasks 感知

## 关键变更日志

- [2026-06-03] **Skill 自动激活机制修复** — xuanji 从不主动使用 Skill 的根因修复：

  1. **运行时 xuanji.yaml**: systemPrompt 最顶部新增 `Skill Activation Protocol (NON-NEGOTIABLE)`，每轮对话强制先调 `skill_call("using-superpowers")`；工具列表中新增 `skill_manage`，`skill_call` + `skill_manage` 改为 `required: true`
  2. **模板 xuanji.yaml** (`src/core/templates/agents/xuanji.yaml`): 同步更新
  3. **打包版** (`desktop/release/mac/xuanji.app/.../xuanji.yaml`): 同步更新
  4. 根因: systemPrompt 中 Skill 发现规则埋在 Working Principles 第 2 条，权重不足，AI 从未触发 `skill_manage(list)` 或 `skill_call`

- [2026-06-03] **MediaTaskTracker + list_media_tasks** — Agent 感知后台异步任务的新机制。generate_video(async=true) 提交后自动注册到 MediaTaskTracker，Agent 通过 `list_media_tasks` 工具查看所有挂起任务，选择合适的时机查询/取消。核心改动：

  1. **MediaTaskTracker** (`src/core/tools/MediaTaskTracker.ts`): 轻量级内存单例，register / updateStatus / syncTask / list / listPending / markCancelled
  2. **ListMediaTasksTool** (`src/core/tools/ListMediaTasksTool.ts`): 列出异步媒体任务，支持 filter(pending/all) + sync(从远程刷新状态)
  3. **GenerateVideoTool**: async 提交后调 `tracker.register()`，输出中告知 Agent「当前 N 个视频任务在后台运行」并提示 list_media_tasks
  4. **QueryVideoTaskTool**: 查询后自动 sync 结果到 MediaTaskTracker
  5. **CancelVideoTaskTool**: 取消后自动 markCancelled
  6. **ToolRegistry**: 注册 list_media_tasks

- [2026-06-03] **视频异步任务管理（Option A）** — generate_video 新增 `async` 参数（默认 true），提交后立即返回 task_id，不再阻塞等待。新增 `query_video_task` 和 `cancel_video_task` 两个独立工具。核心改动：

  1. **PlatformAdapter 接口**: 新增 `submitVideoTask` / `queryVideoTask` / `cancelVideoTask` 三个方法，以及 `VideoTaskStatus` 类型
  2. **adapter-utils.ts**: 新增 `apiDelete()` HTTP DELETE 函数（支持 204 响应）
  3. **ArkAdapter**: 新增 `submitVideoTask`（公开入口 → buildVideoBody → createVideoTask）, `queryVideoTask`（GET 查询 → VideoTaskStatus）, `cancelVideoTask`（DELETE 取消）；`createVideoTask` 保持公开供内部使用
  4. **BailianAdapter**: 新增 `submitVideoTask`（POST /videos/generations → task_id）, `queryVideoTask`（GET 查询）, `cancelVideoTask`（DELETE 取消）
  5. **GenerateVideoTool**: 新增 `async` 参数（默认 true），async=true 调 `submitVideoTask` 返回 task_id，async=false 保持阻塞行为
  6. **新增文件**: `QueryVideoTaskTool.ts`（查状态）, `CancelVideoTaskTool.ts`（取消任务）；**改动文件**: `ArkAdapter.ts`, `BailianAdapter.ts`, `PlatformAdapter.ts`, `adapter-utils.ts`, `GenerateVideoTool.ts`, `ToolRegistry.ts`
  7. 改动: +2 新文件, +6 文件修改；`npx tsc --noEmit --skipLibCheck` 通过

- [2026-06-03] **模板 YAML maxTokens 残留清理** — 从 6 个系统 agent 模板 YAML（`xuanji`/`software-engineer`/`memory-manager`/`scene-classifier`/`product-manager`/`ui-designer`）及运行时 xuanji.yaml 中移除 `model.maxTokens` 字段。之前 `AgentEditor.tsx` 的 `DEFAULT_CONFIG` 已清理，此次补全模板文件。`maxTokens` 应由 provider 或运行时按模型自动确定，不应硬编码在 Agent 配置中。

- [2026-06-02] **多模态生成配置架构升级** — 修复 `ToolConfigManager.loadFromAgentConfig()` 中 `clear()` 导致切换主 Agent 配置丢失的问题。核心改造 5 步：

  1. **类型定义**: `shared/types/config.ts` 新增 `ModelProvidersConfig`（含 `media: Record<string, ToolMediaGenConfig>`），`AppConfig` 新增 `modelProviders` 字段
  2. **ToolConfigManager**: 新增 `loadFromModelProviders()` 方法从 RuntimeConfig 读取，`loadFromAgentConfig()` 改为 merge 模式（去 clear，不覆盖已有 key）
  3. **SessionFactory**: `create()` 中先调 `loadFromModelProviders()` 再调 `loadFromAgentConfig()`，优先级：用户级 > Agent YAML
  4. **agent-bridge**: `handleUpdateConfig` 新增 `modelProviders` section 处理，配置更新后自动重载 ToolConfigManager
  5. **SettingsPage**: 新增「模型配置」Tab，支持独立配置 `generate_image`/`edit_image` 的 provider/model/apiKey/baseURL
  6. 改动文件：`ToolConfigManager.ts`, `SessionFactory.ts`, `agent-bridge.ts`, `SettingsPage.tsx`, `i18n.ts`, `config.ts`

- [2026-06-02] **多模态生成能力 Phase 1 实现** — 新增 `generate_image`（文生图）和 `edit_image`（图片编辑/repaint）两个内置工具，采用 Adapter 模式对接火山引擎豆包 API。设计规格书: `docs/superpowers/specs/2026-06-02-multimodal-generation-phase1-design.md`。核心设计:
  1. `PlatformAdapter` 接口封装平台差异，目前在 `ArkAdapter` 中实现；新增千问等平台只需实现接口 + 1 行注册
  2. `AbstractMediaGenTool` 继承 `BaseTool`，提供校验/配置读取/错误处理；具体工具只需实现 `doExecute()`
  3. 每个工具独立配置 `tools[].config`（provider/model/apiKey/baseURL），通过 `ToolConfigManager` 单例在 Agent 初始化时从 YAML 加载
  4. BaseTool 新增 `toolConfig` 字段（命名为 toolConfig 避免与 EnhancedWebSearchTool/WebSearchTool 已有 `config` 冲突）
  5. 改动: 8 个新文件（~540 行），BaseTool +3 行，ToolRegistry +5 行，SessionFactory +8 行，config.ts +28 行；`npx tsc --noEmit --skipLibCheck` 通过
  6. AgentEditor 前端新增媒体工具配置表单：启用 `generate_image`/`edit_image` 时展示平台/模型/API Key/分辨率/水印等配置项，默认填充豆包参数
  7. 配置保存链路完整验证：前端 → IPC → agent-bridge → stringifyYAML → .yaml → parseYAML → ToolConfigManager
- [2026-06-02] **Prompt 能力发现与质量闸门改造** — 根据 `docs/agent-quality-gate-final-design.md` 和 `docs/full-prompt-optimization-design.md` 完成轻量闭环改造：
  1. 主 Agent 和 L0/L1/L2 prompt 改为 Conditional Capability Discovery，简单任务直接执行，流程型任务按需查询 Skills，外部系统任务按需查询 MCP
  2. 严格任务通过 Task/todo 跟踪质量闸门阶段，交付前执行验证和 `XUANJI.md` write-back check
  3. Memory 只存用户级长期上下文和项目知识指针，具体项目事实、进度、架构和踩坑写入 `XUANJI.md`
  4. `RulesLoader` 对 `XUANJI.md` 注入 section index 而非全文，减少常驻 prompt；Agent Team protocol 瘦身为按需短规则
  5. `skill_manage` / `mcp_settings` 增强摘要信息，`install` 增加用户确认门
  6. 二次 review 修复模板同步链路：跳过 `.template-backups`，并阻止项目/备份同 ID 旧 prompt 覆盖新版内置 prompt
  7. 二次 review 修复能力工具依赖注入：`mcp_settings` / `skill_manage` / `skill_call` 在高级工具注册阶段注入，不再依赖 Memory/LearnTool 初始化路径
  8. 修复既有 TypeScript 类型错误，`npm run typecheck` 已通过；同时调整 `list_scenes` 文案，明确 scene prompt 基于意图分析结果按需查询
  9. 三次 review 修复 scene/agent 发现链路：移除 `match_scene` / `match_agent` / Task / Team 中的强制查询措辞，改为优先使用意图分析结果；修复 `match_scene` 场景列表使用组件 ID 而非 `scenes` 字段的问题，并把 `match_scene` 加入委托发现工具白名单
  10. 明确意图分析结果只指导前台主 Agent；使用 `task` / `agent_team` 拆分后，需要按子任务或成员目标重新分配 1-3 个 scene，不能盲目沿用前台 scene
  11. 四次 review 修复组件选择链路：子 Agent 多 scene 可加载多个 L1；`scenes[]` 不再在 AgentFactory 丢失；hierarchical leader 补齐 `list_agents` / `match_scene`；agent 向量匹配输入补齐 id/name/description/tags/triggers/capabilities/examples

- [2026-06-01] **MCP PATH 隔离问题修复** — 修复 macOS GUI 启动时 MCP 子进程找不到 npx/node 的问题。两处修改：
  1. `findNpmCliPath()` 新增第 2 优先级：通过 `process.execPath` 反向推导内置 Node 的 npm-cli.js（`../lib/node_modules/npm/bin/npm-cli.js`），覆盖打包 Electron 子进程没有 `resourcesPath` 的场景
  2. `MCPClient._startInternal()` 新增 `injectNodeBinToPath()`：启动 MCP 子进程前将 Node bin 目录注入 `env.PATH`

## 注意事项 & 踩坑记录

- **macOS GUI 应用 PATH 隔离**：Electron GUI 应用启动时 PATH 只有 `/usr/bin:/bin:/usr/sbin:/sbin`，不包含 nvm/brew 等用户安装的 Node.js 路径。MCP Server 子进程继承此 PATH，导致 `npx`/`node`/`npm` 命令找不到。修复方案在 `MCPClient.injectNodeBinToPath()` 中
- **打包 Electron 子进程没有 resourcesPath**：agent-bridge 子进程通过 `spawn(bundledNode, ...)` 启动，`process.resourcesPath` 为 `undefined`。`findNpmCliPath()` 通过 `process.execPath`（指向内置 Node 路径如 `/Applications/xuanji.app/.../node/bin/node`）反向推导 npm-cli.js 位置

## 约定

- 代码风格: 使用项目已有的 TypeScript 严格模式
- 测试: 通过 vitest 运行

## 开发进展

- 当前阶段: 多模态生成能力 Phase 2（视频异步任务管理）
- 进行中: 异步视频任务功能验证（query_video_task / cancel_video_task → Ark API → 前端渲染）
- 已完成: 视频异步任务管理 Option A 实施（2026-06-03）；Prompt 能力发现与质量闸门轻量闭环改造（2026-06-02）；agent/tool/scene/Skills/MCP 选择链路审查与修复（2026-06-02）；TypeScript 类型检查修复（2026-06-02）；MCP PATH 隔离问题修复（2026-06-01）；多模态生成 Phase 1 代码实现（2026-06-02）
- 计划下一步: 功能验证（Agent 配置 generate_video → async 任务提交 → query_video_task 查询 → cancel_video_task 取消）
