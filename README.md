# 璇玑 (Xuanji)

> 一个现代化的 AI 编程助手 CLI 工具

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org)

## ✨ 特性

- 🤖 **智能代码助手** — 基于 Claude/OpenAI 的编程助手
- 🎨 **终端 UI** — 基于 Ink 5 (React) 的精美终端界面
- 🔧 **丰富工具集** — 文件读写、代码搜索、Shell 执行等
- 🛡️ **权限控制** — 双层防护，保护系统安全
- 📊 **项目感知** — 自动识别项目类型和依赖
- 🌐 **多模型支持** — Anthropic/OpenAI/Ollama
- 🔌 **MCP 协议** — 支持外部工具扩展
- 🌍 **国际化** — 中英文完整支持

## 🚀 快速开始

### 安装

```bash
npm install -g @shibit/xuanji
```

### 配置

```bash
# 配置 API Key
xuanji config set anthropic.apiKey YOUR_API_KEY

# 或使用环境变量
export XUANJI_API_KEY=YOUR_API_KEY
```

### 使用

```bash
# 启动交互式 CLI
xuanji

# 查看帮助
xuanji --help

# 快速提问
xuanji "帮我分析这个项目的架构"
```

## 📖 文档

- [开发指南](DEVELOPMENT.md) — 本地开发和调试
- [配置说明](CLAUDE.md) — 项目约定和核心模块
- [更新日志](CHANGELOG.md) — 版本变更记录

## 🛠️ 开发

```bash
# 克隆仓库
git clone https://github.com/shibit/xuanji.git
cd xuanji

# 安装依赖
npm install

# 启动开发模式
npm run dev

# 运行测试
npm test

# 构建
npm run build
```

## 📦 技术栈

- **运行时**: Node.js 20+ / tsx
- **UI 框架**: Ink 5 (React 18 终端渲染)
- **LLM SDK**: @anthropic-ai/sdk, openai
- **语言**: TypeScript 5.7
- **测试**: Vitest
- **构建**: tsup

## 🏗️ 核心模块

| 模块 | 说明 |
|------|------|
| `src/adapters/cli/` | 终端 UI (Ink React 组件) |
| `src/agent/` | Agent 调度 (ReAct 循环) |
| `src/context/` | 上下文引擎 (项目感知/代码索引) |
| `src/memory/` | 记忆系统 (短期/长期/项目知识) |
| `src/permission/` | 权限控制 (文件/命令守卫) |
| `src/tools/` | 工具注册与执行 |
| `src/providers/` | LLM Provider 实现 |
| `src/mcp/` | MCP 协议支持 |
| `src/config/` | 配置管理 |

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

提交代码前请确保：
```bash
npm run typecheck  # 类型检查
npm run lint       # 代码规范检查
npm run test       # 单元测试
```

## 📄 许可证

[MIT](LICENSE)

## 🙏 致谢

- [Anthropic Claude](https://www.anthropic.com) — 强大的 AI 模型
- [Ink](https://github.com/vadimdemedes/ink) — React 终端 UI 框架
- [MCP](https://modelcontextprotocol.io) — 模型上下文协议

---

**Shibit Xuanji · 璇玑** — 让 AI 编程助手更智能、更安全、更高效
