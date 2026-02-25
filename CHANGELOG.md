# Changelog

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
