# Changelog

## [Unreleased]

### 新增

- **并行工具 UI 优化** — 树状结构展示，提升视觉清晰度
  - 新增 `ParallelToolGroup` 组件：动态执行区域的树状展示（使用 `┌─`, `├─`, `└─` 构建层级）
  - 新增 `ParallelToolGroupCompact` 组件：静态历史区域的紧凑/展开模式
  - 新增 `tool_group` 消息类型：统一展示已完成的并行工具组
  - 实时进度显示：`⚡ Parallel Execution (2/3 completed)`
  - 支持 Tab 导航和 Enter 展开/折叠并行工具组
  - 文档: `doc/parallel-ui-optimization.md`

- **Agent Team 优化** — 大幅提升团队协作功能的可用性
  - 新增 `quick_team` 工具：使用预定义模板快速创建团队（只需 2 个参数）
  - 5 个内置模板：code-review, research, architecture-debate, data-pipeline, feature-development
  - 优化 `agent_team` tool description：明确的使用场景和决策指引
  - System prompt 增加多 agent 协作指引：何时使用 SubAgent vs Team
  - 新增团队模板系统（`src/core/agent/team/templates.ts`）
  - 文档：`docs/agent-team-optimization.md`

- **权限系统优化** — 分层确认机制，平衡安全与效率
  - 新增 `confirmWrite` 配置：控制文件写入确认策略
    - `ask`: 每次写入都需要确认（保守模式）
    - `plan-only`: 依赖 LLM 通过 plan_review 主动确认（默认，平衡模式）
    - `auto`: 项目内写入自动放行（激进模式）
  - `warnLevel` 默认值从 `auto-allow` 改为 `ask`（更保守）
  - GuardCheckResult 增加上下文信息（isProjectPath、isSensitiveFile）
  - 优化决策逻辑：safe/warn/danger 分层处理
  - 文档: `docs/permission-optimization.md`

- **Agent Team 协作功能** — 多 agent 协同完成复杂任务
  - 新增 `agent_team` 工具：创建和管理 agent 团队
  - 支持 5 种协作策略：sequential（串行）、parallel（并行）、hierarchical（层级）、debate（辩论）、pipeline（流水线）
  - 团队成员配置：角色、能力、优先级、系统提示
  - Hook 事件支持：TeamStart、TeamEnd、TeamMemberStart、TeamMemberEnd
  - 文档: `docs/agent-team.md`
  - 示例: `examples/agent-team-examples.js`

- **Light Model 配置支持** — 支持单独配置轻量模型
  - Settings UI 新增 "轻量模型" 配置项（快捷键 2）
  - 新增环境变量 `XUANJI_LIGHT_MODEL`
  - 用于上下文压缩、子代理等低复杂度任务
  - 相比主模型节省约 67% 成本（Haiku vs Sonnet）
  - 文档: `docs/LIGHT_MODEL_GUIDE.md`

### 优化

- **CLI UI 系统重构** — 模块化和交互增强
  - `SlashCommand` 类型增强：支持 `group`（分组）、`icon`（图标）、`usage`（使用示例）、`aliases`（别名）、`hidden`（隐藏）
  - `SlashCommandRegistry.formatHelp()`：按分组显示命令，支持图标和使用说明
  - 新增 `HelpPanel` 组件：交互式帮助面板，支持 ↑↓ 导航、Enter 查看详情、/ 搜索过滤
  - `QuickAction` 类型增强：支持 `icon`（图标）、`priority`（优先级排序）
  - `QuickActions` 组件优化：自动按优先级排序，显示图标
  - `SettingsMode` 视觉优化：增加边框、版本显示、选中项描述、操作提示框
- **国际化系统重构** — 模块化组织
  - 拆分 `messages.ts` 为多个模块：`zh_common`、`en_common`、`zh_settings`、`en_settings`
  - 新增 `locales/` 目录，按功能分类翻译文件
  - 更好的维护性和可扩展性

## [0.2.0] - 2026-02-26

P1 阶段完成 — 权限控制、项目感知、遥测日志、搜索工具。

### 新增

- **M5 权限控制系统** — 双层防护架构
  - FileGuard: 文件路径风险评估（系统路径/敏感目录/敏感文件/项目外写入）
  - CommandGuard: 命令风险评估（极度危险/潜在危险/安全）
  - PolicyEngine: 策略引擎，支持命令和路径黑白名单
  - PathMatcher: 零依赖 glob→regex 匹配
  - PermissionController: 决策核心，safe/warn 自动放行，danger 强制用户确认
  - PermissionPrompt: Ink 终端确认对话框（Y/N/A/V 快捷键）
  - PlanReview: Ink 计划审查对话框（approve/reject/supplement）
- **M3 上下文引擎** — 项目感知
  - ProjectScanner: 自动检测项目类型（Node/Python/Java/Go/Rust）
  - RulesLoader: 加载 XUANJI.md / .xuanji/rules.md，500KB 限制+敏感内容检测
  - ContextBuilder: 组装项目上下文为 system prompt 片段
  - GitIntegration: 获取分支名、dirty 状态、最近提交
- **M10 遥测系统** — 日志与统计
  - SessionRecorder: 会话级 token 统计持久化（JSONL）
  - UsageStatsRecorder: 工具调用统计+按模型/工具维度聚合分析
  - AuditLogger: 权限决策和计划审查事件审计日志，支持脱敏
  - `/cost` 命令: 显示最近 7 天使用统计
- **M6 搜索工具**
  - GlobTool: 文件名 glob 搜索（基于 fast-glob）
  - GrepTool: 文件内容正则搜索（基于 Node.js 流式读取）
- **M6 PlanReviewTool** — LLM 提交执行计划供用户审查
- **M9 自动初始化项目配置** — 首次启动自动创建 .xuanji/config.json（含完整模板）
- **Skills 增强** — project-rules Skill + 依赖注入渲染

### 改进

- `/init` 命令改为重置配置（覆盖为完整默认模板）
- ToolRegistry 集成权限检查（每次工具执行前校验）
- AgentLoop 集成 SessionRecorder + UsageStatsRecorder
- ChatSession 初始化 PermissionController 并注入到 ToolRegistry

## [0.1.0] - 2026-02-20

P0 阶段完成 — 基础架构搭建。

### 新增

- **M1 终端 UI** — Ink 5 React 终端渲染
  - 流式文本输出（throttle 100ms）
  - 工具结果折叠/展开
  - 多模式切换（chat/settings/logs/bots）
  - 斜杠命令（/help /clear /reset /settings /logs /bots /lang /exit）
  - Kitty 键盘协议支持
- **M2 Agent 循环** — ReAct 推理核心
  - 流式 LLM 调用 + 工具执行 + 结果回传
  - 并行+串行混合工具执行（readonly 工具并行）
  - max_tokens 截断自动重试
  - 最大迭代次数限制（默认 50）
- **M7 LLM Provider** — 多模型支持
  - Anthropic 适配器（Messages API + 流式）
  - OpenAI 适配器（Chat Completions API + 流式）
- **M6 工具系统** — 核心工具集
  - read_file / write_file / edit_file / bash
- **M9 配置管理** — 多层配置合并
  - 五层优先级：默认 → 全局 → 项目 → 环境变量 → CLI
  - 全局配置 ~/.xuanji/config.json
  - 项目配置 .xuanji/config.json
- **Skills 系统** — Prompt Skill 注册表
  - xuanji-assistant / tool-guidance / security-rules / agent-rules
- **Electron GUI** — 桌面应用
- **IM 机器人** — 钉钉/飞书/企业微信适配器
- **国际化** — 中英文完整支持
