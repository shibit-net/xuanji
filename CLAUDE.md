# 璇玑 (Xuanji)

## 语言偏好
- 始终使用中文回复

## 项目定位
- 开源 AI 助手，类 Claude Code
- 品牌全称: Shibit Xuanji · 璇玑
- 技术栈: TypeScript + Ink (React) + Node.js

## 项目约定
- 运行时: Node.js 20+ / tsx
- UI 框架: Ink 5 (React 18 终端渲染)
- LLM SDK: @anthropic-ai/sdk (主), openai (次)
- 端口: 无 (CLI 工具，非服务端)
- 配置目录: `~/.xuanji/` (全局) 和 `.xuanji/` (项目级)

## 顶层模块职责

| 目录 | 职责 |
|------|------|
| `src/adapters/cli/` | 终端 UI（Ink/React）、斜杠命令、主题 |
| `src/adapters/im/` | IM 机器人（钉钉/企业微信/飞书） |
| `src/adapters/electron/` | Electron 桌面应用适配 |
| `src/auth/` | API Key、Cookie、加密存储、OAuth |
| `src/butler/` | 主动管家：后台任务监控与推送 |
| `src/context/` | 项目上下文：代码索引、符号提取、依赖分析 |
| `src/core/` | 核心引擎（见下方详细说明） |
| `src/embedding/` | 向量化服务，用于记忆检索和语义匹配 |
| `src/hooks/` | 事件驱动系统，支持配置化 Hook 触发器 |
| `src/mcp/` | MCP 协议适配，接入外部工具（Web Search 等） |
| `src/memory/` | 分层记忆：短期对话 + 长期索引 + 项目知识 |
| `src/permission/` | 权限守卫：文件/命令/网络分级控制 |
| `src/reminder/` | 提醒引擎：定时任务、日程管理 |
| `src/session/` | 会话持久化、检查点、摘要 |
| `src/tiangong/` | 天工插件市场：Skill/MCP 安装与发布 |

## core/ 子模块详情

### 执行引擎
- `core/agent/AgentLoop.ts` — ReAct 主循环（消息构建 → 流式 LLM 调用 → 工具执行 → 迭代）
- `core/agent/AgentExecutor.ts` — 包装 AgentLoop，管理生命周期
- `core/agent/SubAgentLoop.ts` — 独立子代理循环，支持超时/最大迭代/隔离模式
- `core/agent/SubAgentFactory.ts` — 统一子代理创建入口，查询 AgentRegistry → 工具过滤 → 创建循环
- `core/agent/AgentRegistry.ts` — Agent 配置注册表，扫描 builtin/global/project（优先级：project > global > builtin）
- `core/agent/team/TeamManager.ts` — 多 Agent 团队协作（sequential/parallel/hierarchical/debate/pipeline）

### 工具系统（src/core/tools/）
- **ToolRegistry.ts** — 注册/执行工具，支持 Plan Mode
- **DynamicToolFilter.ts** — 按场景（coding/life）动态过滤 LLM 可见工具集，包装器模式零侵入
- **ToolCategories.ts** — 按场景计算允许的工具集
- 核心工具：ReadTool / WriteTool / EditTool / MultiEditTool / BashTool / GlobTool / GrepTool
- 子代理工具：TaskTool（子任务委托）/ TeamTool（团队编排）/ ListAgentsTool / MatchAgentTool
- 任务管理：TodoCreateTool / TodoUpdateTool / PlanReviewTool / EnterPlanModeTool
- 记忆工具：MemoryStoreTool / MemorySearchTool / RetrieveMemoryTool

### Prompt 构建（src/core/prompt/）
**唯一系统**：`LayeredPromptBuilder`（按需加载，按意图复杂度动态组合）

分层组件（L0 总是加载，L1 按场景，L2+ 按复杂度）：

| 层 | 组件 | 触发 |
|----|------|------|
| L0 | l0-identity, l0-safety | 总是 |
| L1 | l1-coding, l1-life | 对应场景 |
| L2 | l2-planning, l2-agent-rules, l2-safety | complex+ |
| L3 | l3-project | 总是（项目上下文）|

> ⚠️ 旧系统（`SystemPromptBuilder`、`SceneMatcher`、`blocks/`）已于 2026-04 删除。

### 其他核心模块
- `core/chat/ChatSession.ts` — 统一会话入口，初始化所有依赖，管理 AgentLoop 生命周期；职责已拆分到以下三个类
- `core/chat/SkillRouter.ts` — Skill 路由（意图识别 → Skill 执行），从 ChatSession 拆出
- `core/chat/PromptOrchestrator.ts` — System Prompt 编排（LayeredPromptBuilder 调用 + 工具过滤 + thinking 配置），缓存 builder 实例
- `core/chat/TurnLifecycleManager.ts` — 轮次生命周期（自动保存 + 消息淘汰 + 归档），统一入口 afterTurn()
- `core/providers/` — LLM 适配（AnthropicProvider / OpenAIProvider），ProviderManager 按 Agent 配置路由
- `core/config/` — 多层配置合并（运行时参数 > 环境变量 > 项目配置 > 全局配置 > 默认值）
- `core/skills/` — Skill 系统（工作流级，如 commit/review-pr）
- `core/logger/` — 统一日志系统（详见下方说明）

### 日志系统（src/core/logger/）
**统一日志接口**，支持分级输出、颜色区分、文件持久化。

**特性：**
- 日志分级：debug / info / warn / error
- 按级别分文件：`~/.xuanji/logs/{debug,info,warn,error}.log`
- 颜色区分：debug(灰) / info(蓝) / warn(黄) / error(红)
- 双输出：同时输出到控制台和文件
- 命名空间：支持模块级 Logger（如 `xuanji:AgentLoop`）
- 环境适配：开发环境用 debug 包，生产环境用 consola

**使用方式：**
```typescript
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MyModule' });
log.debug('调试信息', { data: 123 });
log.info('操作成功');
log.warn('警告信息');
log.error('错误信息', error);
```

**环境变量：**
- `XUANJI_LOG_LEVEL` — 日志级别（debug/info/warn/error）
- `XUANJI_LOG_DIR` — 日志目录（默认: ~/.xuanji/logs）
- `XUANJI_LOGGER_TYPE` — 强制使用特定实现（debug/consola）
- `DEBUG` — 开发环境命名空间过滤（如 `DEBUG=xuanji:AgentLoop:*`）

**详细文档：** `src/core/logger/README.md`

## 内置 Agent 配置（src/core/agent/builtin/）

| 文件 | Agent ID | 用途 |
|------|---------|------|
| xuanji.json5 | xuanji | 主 Agent，全量工具，思考模式 |
| general-purpose.json5 | general-purpose | 默认子代理降级目标 |
| coder.json5 | coder | 编码专家 |
| explore.json5 | explore | 项目探索 |
| plan.json5 | plan | 计划制定 |
| refactor-expert.json5 | refactor-expert | 重构专家 |
| test-writer.json5 | test-writer | 测试专家 |
| doc-writer.json5 | doc-writer | 文档专家 |
| intent-analyzer.json5 | intent-analyzer | 意图分析（Haiku） |
| context-compressor.json5 | context-compressor | 上下文压缩（Haiku） |
| memory-extractor.json5 | memory-extractor | 记忆提取 |

用户可在 `~/.xuanji/agents/` 或 `.xuanji/agents/` 中创建同名文件覆盖内置配置。

## 工具注册方式（三种）

1. **静态注册**（ToolRegistry 构造函数中）— 核心工具，read/write/edit/bash/grep 等
2. **动态注册**（ChatSession.initTaskTool() 中）— 需要运行时依赖注入的工具：task/team/list_agents/match_agent
3. **JSON5 声明**（Agent 配置 tools 数组）— 仅对子代理有效，用于限制子代理可用的工具集

> ⚠️ xuanji.json5 中的 tools 列表对**主 Agent 无效**（主 Agent 用 baseRegistry 动态注册），
> 只有当 xuanji 作为子代理时才生效。

## 扩展点速查

| 要新增什么 | 需要改的文件 |
|-----------|------------|
| 新工具 | 1. 创建 `core/tools/XxxTool.ts` 2. 在 `ToolRegistry.ts` 中注册 3. 可选：加到 `ToolCategories.ts` 场景过滤 |
| 新内置 Agent | 在 `src/core/agent/builtin/` 下新建 `.json5` 文件即可 |
| 新 Prompt 组件 | 创建 `core/prompt/components/lX-xxx.ts`，导出满足 `PromptComponent` 接口的对象即可（自动扫描注册，无需改其他文件） |
| 新 MCP 适配器 | 1. 创建 `mcp/transports/XxxTransport.ts` 2. 在 `MCPManager.ts` 中注册 |
| 新 IM Bot | 1. 创建 `adapters/im/XxxBot.ts` 2. 加到 `adapters/im/index.ts` |
| 新日志模块 | 使用 `logger.child({ module: 'ModuleName' })` 创建模块级 Logger |

## 启动方式
```bash
# CLI 模式 (默认)
npm run dev

# GUI 桌面模式
npm run dev:gui

# IM 机器人模式
npm run dev:bot

# 构建
npm run build           # CLI
npm run build:gui       # GUI

# 测试
npm test

# 类型检查
npm run typecheck
```

## GUI 桌面应用
- 位置: `desktop/`
- 技术栈: Electron + React 18 + TypeScript + Vite + TailwindCSS
- 独立项目结构，有自己的 `package.json`
- 三栏布局: 会话列表 + 对话区 + 右侧面板
- 气泡式对话界面 + Markdown 渲染 + 代码高亮
- 工具调用可视化 + 状态栏统计

## 设计原则
1. 最小依赖原则: 核心功能自实现
2. 接口抽象原则: 所有模块通过接口交互
3. 流式优先原则: 所有 LLM 调用使用流式响应
4. 错误隔离原则: 单个工具执行失败不影响整体循环
5. 配置外置原则: 所有可配置项支持环境变量和配置文件

## 文档
- 技术调研: `../doc/prd/xuanji/tech-research.md`
- 模块设计: `../doc/prd/xuanji/module-design.md`
- 开发规划: `../doc/prd/xuanji/development-plan.md`
- P0 架构: `../doc/tad/xuanji/01-p0-architecture.md`
