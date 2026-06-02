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
- `src/shared/utils/crossPlatform.ts` — 跨平台工具（进程终止、Shell 适配、npm-cli.js 查找）
- `desktop/main/agent/index.ts` — agent-bridge 子进程启动/重启逻辑
- `desktop/main/agent-bridge.ts` — agent-bridge 子进程主入口

## 可复用组件 & 工具

- **findNpmCliPath()** (`src/shared/utils/crossPlatform.ts`) — 跨平台查找 npm-cli.js，优先级：Electron resourcesPath → process.execPath → 系统 PATH
- **injectNodeBinToPath()** (`src/mcp/MCPClient.ts`) — 将 Node.js bin 目录注入子进程 PATH，确保 MCP 子进程能找到 npx/node/npm
- **crossPlatformKill()** (`src/shared/utils/crossPlatform.ts`) — 跨平台强制终止子进程（Windows: taskkill，POSIX: SIGTERM/SIGKILL）

## 关键变更日志

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

- 当前阶段: Prompt / Agent 行为优化
- 进行中: Prompt / Agent 行为优化后续实测观察
- 已完成: Prompt 能力发现与质量闸门轻量闭环改造（2026-06-02）；agent/tool/scene/Skills/MCP 选择链路审查与修复（2026-06-02）；TypeScript 类型检查修复（2026-06-02）；MCP PATH 隔离问题修复（2026-06-01）
- 计划下一步: 若 prompt + Task/todo + XUANJI.md write-back 仍不稳定，再引入 `ProjectKnowledgeService` / `QualityGateManager`
