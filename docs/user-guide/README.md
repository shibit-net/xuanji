# Xuanji 用户文档

欢迎使用 **Shibit Xuanji（璇玑）** — 强大、智能的开源 AI 助手。

> 最后更新：2026-03-14

---

## 什么是 Xuanji？

Xuanji（璇玑）是一款基于 Claude、GPT 等大语言模型的终端 AI 助手，类似 Claude Code，提供强大的代码编辑、文件操作、命令执行、Web 搜索、记忆管理等能力。

### 核心特性

- **智能对话**：支持 Anthropic Claude、OpenAI GPT 等多种大语言模型
- **工具生态**：16+ 内置工具，支持文件读写、代码编辑、命令执行、Web 搜索等
- **记忆系统**：短期记忆 + 长期记忆 + 项目知识，基于向量检索的智能回忆
- **会话管理**：保存、恢复、checkpoint、回退，永不丢失工作进度
- **权限控制**：三级风险分类（safe/warn/danger），智能确认策略
- **Skills 系统**：内置 7 个场景化 Skill，支持自定义扩展
- **MCP 集成**：支持 Model Context Protocol，扩展外部工具
- **子代理系统**：SubAgent 并发执行，支持复杂任务分解
- **Hook 系统**：14 种事件钩子，支持自定义工作流
- **多语言支持**：中文、英文界面

---

## 快速开始

5 分钟快速上手 Xuanji：

1. **安装**：`npm install -g xuanji`（需要 Node.js 20+）
2. **配置 API Key**：`export ANTHROPIC_API_KEY=sk-ant-...`
3. **启动**：`xuanji`
4. **第一次对话**：输入 "读取 package.json 并总结"

详见 [快速开始指南](./getting-started.md)。

---

## 文档目录

### 入门指南

- [快速开始](./getting-started.md) — 5 分钟快速上手
- [安装指南](./installation.md) — 详细的安装步骤和环境配置
- [配置参考](./configuration.md) — 完整的配置项说明

### 核心功能

- [架构指南](./architecture.md) — 系统架构、Agent 类型、执行模式
- [工具参考](./tools-reference.md) — 所有内置工具的使用说明
- [Skills 使用指南](./skills-guide.md) — 内置 Skill 和自定义 Skill
- [权限系统](./permission-system.md) — 权限控制和确认策略
- [记忆系统](./memory-system.md) — 短期、长期、项目知识管理
- [会话管理](./session-management.md) — 保存、恢复、checkpoint

### 高级功能

- [MCP 集成指南](./mcp-integration.md) — 外部工具扩展
- [Web 能力](./web-capabilities.md) — Web 搜索和网页抓取
- [子代理系统](./subagent-system.md) — 任务分解和并发执行
- [Hook 系统](./hooks-system.md) — 事件驱动和自定义工作流

### 帮助与支持

- [故障排查](./troubleshooting.md) — 常见问题和解决方案
- [常见问题 FAQ](./faq.md) — 高频问题快速解答

---

## 社区支持

- **GitHub 仓库**：[github.com/shibit/xuanji](https://github.com/shibit/xuanji)
- **问题反馈**：[GitHub Issues](https://github.com/shibit/xuanji/issues)
- **讨论区**：[GitHub Discussions](https://github.com/shibit/xuanji/discussions)
- **官方网站**：[shibit.net](https://shibit.net)
- **Email**：dev@shibit.net

---

## 开源协议

Xuanji 采用 [MIT License](https://github.com/shibit/xuanji/blob/master/LICENSE) 开源。

---

## 贡献指南

欢迎贡献代码、文档、翻译！详见 [CONTRIBUTING.md](https://github.com/shibit/xuanji/blob/master/CONTRIBUTING.md)。

---

## 致谢

Xuanji 灵感来源于 [Claude Code](https://claude.com/claude-code)，使用以下开源项目：

- [Ink](https://github.com/vadimdemedes/ink) — React 终端渲染
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) — Claude API
- [OpenAI SDK](https://github.com/openai/openai-node) — GPT API
- [tree-sitter](https://tree-sitter.github.io/) — 代码解析
- [@xenova/transformers](https://huggingface.co/docs/transformers.js) — 本地 Embedding
- [sqlite-vec](https://github.com/asg017/sqlite-vec) — SQLite 向量扩展

感谢所有贡献者和开源社区！
