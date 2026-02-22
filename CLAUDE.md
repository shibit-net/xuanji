# 璇玑 (Xuanji)

## 语言偏好
- 始终使用中文回复

## 项目定位
- 开源 AI 助手，类 Claude Code
- 品牌全称: Shibit Xuanji · 璇玑
- 技术栈: TypeScript + Ink (React) + Bun

## 项目约定
- 运行时: Node.js 20+ / tsx
- UI 框架: Ink 5 (React 18 终端渲染)
- LLM SDK: @anthropic-ai/sdk (主), openai (次)
- 端口: 无 (CLI 工具，非服务端)
- 配置目录: `~/.xuanji/` (全局) 和 `.xuanji/` (项目级)

## 核心模块
- `src/cli/` — M1 终端 UI (Ink React 组件)
- `src/agent/` — M2 Agent 调度 (ReAct 循环)
- `src/context/` — M3 上下文引擎 (项目感知/代码索引)
- `src/memory/` — M4 记忆系统 (短期/长期/项目知识)
- `src/permission/` — M5 权限控制 (文件/命令守卫)
- `src/tools/` — M6 工具注册与执行 (Read/Write/Edit/Bash/Grep/Glob)
- `src/providers/` — M7 LLM Provider (Anthropic/OpenAI/Ollama)
- `src/mcp/` — M8 MCP 协议 (外部工具扩展)
- `src/config/` — M9 配置管理 (多层配置合并)
- `src/telemetry/` — M10 日志与遥测

## 启动方式
```bash
# 开发
npm run dev

# 构建
npm run build

# 测试
npm test

# 类型检查
npm run typecheck
```

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
