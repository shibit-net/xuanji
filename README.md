# 璇玑 (Xuanji) — Agentic OS

<p align="center">
  <strong>不是单一 Agent，而是一整个团队为你工作</strong>
</p>

<p align="center">
  <a href="https://github.com/shibit/xuanji"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License"></a>
  <a href="https://github.com/shibit/xuanji"><img src="https://img.shields.io/badge/Node.js-20+-green?style=for-the-badge" alt="Node.js"></a>
</p>

<p align="center">
  <strong>中文版本</strong> | <a href="./README_EN.md">English Version</a>
</p>

---

## 什么是璇玑？

璇玑是一个开源的 **Agentic OS**（智能体操作系统），专为**多智能体协作**而设计。

### 产品定位

- **不是单一 AI 助手**，而是可以组织最多 10 个智能体的协作平台
- **不是简单的工具集成**，而是拥有完整的桌面应用和可视化界面
- **不是静态的系统**，而是具有记忆驱动学习能力，越用越懂你

### 核心价值

1. **1+1>2 的协作效应**：多个智能体协作，比单一 Agent 更强大
2. **可视化协作过程**：通过 React Flow 和 Cytoscape 直观看到智能体如何工作
3. **安全可靠**：双层安全架构，即使 AI 判断失误也有代码层面保护
4. **无限扩展**：MCP 生态集成，Playwright 浏览器自动化等，能力随需扩展

### 适用人群

- **软件开发者**：需要编写代码、调试、重构的程序员
- **知识工作者**：需要研究资料、整理信息、做决策的专业人士
- **产品设计师**：需要设计 UI/UX、分析需求的产品人员
- **学生/自学者**：需要个性化学习路径的学习者
- **任何需要提高效率的人**：需要自动化工作流、处理复杂任务的人

---

璇玑还是一个完整的桌面应用，拥有可视化的协作流程图、知识图谱展示，以及记忆驱动的学习能力。不像 OpenClaw 或 Hermes 那样聚焦单一 Agent，璇玑可以组织最多 10 个智能体，通过 5 种协作策略，一起完成复杂任务。

---

## 为什么选择璇玑？

| 特性 | 璇玑 | OpenClaw | Hermes |
|------|------|----------|--------|
| 多智能体协作 | ✅ 5 种策略（串行/并行/层级/辩论/流水线）| ❌ 单一 Agent | ⚠️ 简单子 Agent |
| Electron 桌面 GUI | ✅ 可视化协作 + 知识图谱 | ⚠️ 菜单栏工具 | ❌ CLI 优先 |
| 双层安全架构 | ✅ LLM 审计 + 硬编码守卫 | ⚠️ 基础沙箱 | ✅ 用户授权 |
| 分层提示词系统 | ✅ L0-L2 三层架构 | ❌ 简单 SOUL.md | ❌ 简单模板 |
| 记忆驱动学习 | ✅ 反馈循环 + 自适应调整 | ⚠️ 静态记忆 | ✅ 自学习技能 |
| 代码深度理解 | ✅ tree-sitter + 依赖分析 | ⚠️ 基础文件操作 | ❌ 无深度代码分析 |
| MCP 生态集成 | ✅ 天工坊市场 + Playwright 等 | ✅ ClawHub | ✅ MCP 支持 |

---

## 核心特性

### 🚀 多智能体协作 - 一个团队为你工作

璇玑不是单一的 AI 助手，而是可以组织**最多 10 个智能体**的协作平台：

- **串行协作**：一个接一个，前一个的输出是后一个的输入
- **并行协作**：同时执行多个独立任务，高效并行处理
- **层级协作**：Leader 分配任务，子 Agent 执行，最后汇总
- **辩论协作**：多个 Agent 各抒己见，通过辩论达成共识
- **流水线协作**：像工厂流水线一样，逐步处理任务

**更多详情**：[多智能体协作系统文档](./docs/multi-agent-system.md)

---

### 🧠 记忆驱动学习 - 越用越懂你

璇玑的记忆系统会从你的互动中学习：

- **实体-关系-事件模型**：存储知识图谱
- **FTS5 + 语义搜索**：快速回忆历史
- **Ebbinghaus 遗忘曲线**：智能遗忘不重要信息
- **反馈循环**：你的肯定/否定会影响后续行为
- **每周自动优化**：后台分析你的行为，调整提示词

**更多详情**：[记忆驱动学习系统文档](./docs/memory-system.md)

---

### 📚 分层提示词系统 - 智能高效

璇玑采用 L0-L2 三层提示词架构：

- **L0 基础层**：Agent 身份、安全规则、基础工作流
- **L1 场景层**：10+ 专业场景（write_code/debug/review 等）
- **L2 协调层**：多智能体协作和复杂任务协调

根据意图分析结果动态加载，在保持高质量响应的同时优化 Token 使用效率。

**更多详情**：[分层提示词系统文档](./docs/layered-prompt-system.md)

---

### 🔌 MCP 生态 - 无限扩展

璇玑深度集成 MCP (Model Context Protocol) 生态：

- **Playwright 浏览器自动化**：完整的网页交互能力
- **天工坊市场**：一键搜索安装 MCP 服务器
- **40+ 内置工具** + 无限 MCP 扩展
- **Skills 协同**：MCP 与自定义技能配合使用

**更多详情**：[MCP 生态系统文档](./docs/mcp-ecosystem.md)

---

### 🎨 Electron 桌面应用 - 可视化协作

- **React Flow 协作流程图**：实时看到 Agent 团队的协作过程
- **Cytoscape 知识图谱**：直观展示记忆和关系
- **React + TailwindCSS + shadcn/ui**：现代化界面
- **90+ IPC 通道**：UI 和核心引擎高效通信

---

## 快速开始

### 环境要求

- **Node.js** >= 20.0.0
- **npm** >= 9.0.0
- **Git** (可选，用于工作区隔离)

### 安装

```bash
git clone https://github.com/shibit/xuanji.git
cd xuanji
npm install
```

### 配置

```bash
# 设置 LLM API Key（至少一个）
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."

# 或使用自定义端点
export XUANJI_BASE_URL="https://your-api-endpoint.com"
export XUANJI_MODEL="claude-sonnet-4-6"
```

### 运行

```bash
# 桌面应用（推荐）
npm run dev:gui

# 构建桌面应用
npm run build:gui:mac    # macOS
npm run build:gui:win    # Windows

# 命令行开发模式
npm run dev
```

---

## 内置智能体

| 智能体 | 角色 | 说明 |
|--------|------|------|
| **xuanji** | 主智能体 | 唯一面向用户的智能体，40+ 工具 |
| **scene-classifier** | 分类器 | 意图分析，将用户输入分类为场景+复杂度 |
| **memory-manager** | 记忆管理 | 分析对话，提取并维护长期记忆 |
| **context-compressor** | 压缩器 | 将长对话历史压缩为结构化摘要 |
| **software-engineer** | 工程师 | 代码编写与调试 |
| **product-manager** | 产品经理 | 需求分析与产品规划 |
| **ui-designer** | 设计师 | UI/UX 设计 |

---

## 40+ 内置工具

### 📁 文件系统

| 工具 | 说明 |
|------|------|
| `read_file` | 读取文件内容 |
| `write_file` | 写入新文件 |
| `edit_file` | 编辑现有文件（搜索替换） |
| `multi_edit` | 批量编辑 |
| `glob` | Glob 模式查找文件 |
| `grep` | 正则搜索文件内容 |
| `bash` | 执行 Shell 命令 |

### 🤖 智能体编排

| 工具 | 说明 |
|------|------|
| `task` | 创建子智能体执行任务（同步/异步，最多 5 层） |
| `agent_team` | 创建多智能体团队（5 种策略，最多 10 成员） |
| `match_agent` | 语义向量匹配最佳智能体 |
| `task_control` | 管理后台任务（状态/取消/列表） |

### 🌐 网络 & 搜索

| 工具 | 说明 |
|------|------|
| `web_search` | 统一搜索+抓取（Bing/百度/Google） |
| `install` | 搜索安装 MCP/Skills |

### 🧠 记忆 & 学习

| 工具 | 说明 |
|------|------|
| `memory_search` | 搜索持久记忆 |
| `memory_store` | 存储记忆 |
| `memory_graph` | 知识图谱查询 |
| `learn` | 学习新能力（搜索/生成 MCP/Skill） |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **语言** | TypeScript 5.7+ (ESM, ES2022) |
| **运行时** | Node.js 20+ |
| **LLM SDK** | @anthropic-ai/sdk, openai, node-llama-cpp |
| **数据库** | better-sqlite3 (权限决策/记忆) |
| **桌面** | Electron 40+, React 18, TailwindCSS, shadcn/ui |
| **可视化** | React Flow, Cytoscape |
| **代码分析** | tree-sitter (TS/Python/Java) |

---

## 相关文档

- **应用场景**：[docs/use-cases.md](./docs/use-cases.md) — 查看璇玑在不同场景下的应用
- **同类品对比分析**：[docs/xuanji-vs-openclaw-vs-hermes-agent.md](./docs/xuanji-vs-openclaw-vs-hermes-agent.md)
- **多智能体协作系统**：[docs/multi-agent-system.md](./docs/multi-agent-system.md)
- **记忆驱动学习系统**：[docs/memory-system.md](./docs/memory-system.md)
- **分层提示词系统**：[docs/layered-prompt-system.md](./docs/layered-prompt-system.md)
- **MCP 生态系统**：[docs/mcp-ecosystem.md](./docs/mcp-ecosystem.md)

---

## 许可证

MIT License — 详见 [LICENSE](LICENSE)
