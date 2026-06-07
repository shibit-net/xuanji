# Xuanji — Agentic OS

<p align="center">
  <strong>Not just a single Agent, but an Agentic OS</strong>
</p>

<p align="center">
  <a href="https://github.com/shibit/xuanji"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License"></a>
  <a href="https://github.com/shibit/xuanji"><img src="https://img.shields.io/badge/Node.js-20+-green?style=for-the-badge" alt="Node.js"></a>
</p>

<p align="center">
  <a href="./README.md">中文版本</a> | <strong>English Version</strong>
</p>

---

## What is Xuanji?

Xuanji is an open-source **Agentic OS** designed specifically for **multi-agent collaboration**.

### Product Positioning

- **Not just a single AI assistant**, but a collaboration platform that can organize up to 10 agents
- **Not just simple tool integration**, but a complete desktop application with visual interfaces
- **Not a static system**, but with memory-driven learning capabilities that understand you better over time

### Core Values

1. **1+1>2 Collaboration Effect**: Multiple agents working together are more powerful than a single agent
2. **Visualized Collaboration Process**: Intuitively see how agents work together through React Flow and Cytoscape
3. **Safe and Reliable**: Dual-layer security architecture with code-level protection even when AI makes mistakes
4. **Unlimited Extensibility**: MCP ecosystem integration, Playwright browser automation, and more—capabilities expand as needed

### Who is Xuanji For?

- **Software Developers**: Programmers needing to write code, debug, and refactor
- **Knowledge Workers**: Professionals needing to research, organize information, and make decisions
- **Product Designers**: Product teams needing UI/UX design and requirements analysis
- **Students/Self-Learners**: Learners needing personalized learning paths
- **Anyone Needing Greater Efficiency**: People needing to automate workflows and handle complex tasks

---

Xuanji is also a complete desktop application with visual collaboration flow diagrams, knowledge graph visualization, and memory-driven learning capabilities. Unlike OpenClaw or Hermes which focus on single agents, Xuanji can organize up to 10 agents working together through 5 collaboration strategies to accomplish complex tasks.

---

## Why Choose Xuanji?

| Feature | Xuanji | OpenClaw | Hermes |
|---------|--------|----------|--------|
| Multi-Agent Collaboration | ✅ 5 strategies (serial/parallel/hierarchical/debate/pipeline) | ❌ Single Agent | ⚠️ Simple sub-agents |
| Electron Desktop GUI | ✅ Visual collaboration + knowledge graph | ⚠️ Menu bar tool | ❌ CLI-first |
| Dual-Layer Security | ✅ LLM audit + hardcoded safeguards | ⚠️ Basic sandbox | ✅ User authorization |
| Layered Prompt System | ✅ L0-L2 three-tier architecture | ❌ Simple SOUL.md | ❌ Simple templates |
| Memory-Driven Learning | ✅ Feedback loop + adaptive adjustment | ⚠️ Static memory | ✅ Self-learning skills |
| Deep Code Understanding | ✅ tree-sitter + dependency analysis | ⚠️ Basic file operations | ❌ No deep code analysis |
| MCP Ecosystem Integration | ✅ Market + Playwright, etc. | ✅ ClawHub | ✅ MCP support |

---

## Core Features

### 🚀 Multi-Agent Collaboration — A Team Working For You

Xuanji is not just a single AI assistant, but a collaboration platform that can organize **up to 10 agents**:

- **Serial Collaboration**: One after another, output from the previous becomes input for the next
- **Parallel Collaboration**: Multiple independent tasks executing simultaneously for efficient parallel processing
- **Hierarchical Collaboration**: Leader distributes tasks, sub-agents execute, finally aggregated
- **Debate Collaboration**: Multiple agents express views, reach consensus through debate
- **Pipeline Collaboration**: Like a factory assembly line, processing tasks step by step

**Learn More**: [Multi-Agent Collaboration System](./docs/multi-agent-system.md)

---

### 🧠 Memory-Driven Learning — Understands You Better Over Time

Xuanji's memory system learns from your interactions:

- **Entity-Relation-Event Model**: Stores knowledge graph
- **FTS5 + Semantic Search**: Quickly recalls history
- **Ebbinghaus Forgetting Curve**: Intelligently forgets unimportant information
- **Feedback Loop**: Your affirmations/negations influence future behavior
- **Weekly Automatic Optimization**: Background analysis adjusts prompts

**Learn More**: [Memory-Driven Learning System](./docs/memory-system.md)

---

### 📚 Layered Prompt System — Smart and Efficient

Xuanji uses L0-L2 three-tier prompt architecture:

- **L0 Base Layer**: Agent identity, security rules, basic workflows
- **L1 Scenario Layer**: 10+ professional scenarios (write_code/debug/review, etc.)
- **L2 Coordination Layer**: Multi-agent collaboration and complex task coordination

Dynamically loaded based on intent analysis results, optimizing Token usage while maintaining high-quality responses.

**Learn More**: [Layered Prompt System](./docs/layered-prompt-system.md)

---

### 🔌 MCP Ecosystem — Unlimited Extensibility

Xuanji deeply integrates the MCP (Model Context Protocol) ecosystem:

- **Playwright Browser Automation**: Complete web interaction capabilities
- **Market Integration**: One-click search and install MCP servers
- **40+ Built-in Tools** + Unlimited MCP extensions
- **Skills Synergy**: MCP works together with custom skills

**Learn More**: [MCP Ecosystem](./docs/mcp-ecosystem.md)

---

### 🎨 Electron Desktop Application — Visual Collaboration

- **React Flow Collaboration Diagrams**: Real-time visualization of agent team collaboration
- **Cytoscape Knowledge Graph**: Intuitive display of memory and relationships
- **React + TailwindCSS + shadcn/ui**: Modern interface
- **90+ IPC Channels**: Efficient communication between UI and core engine

---

### 🔒 Privacy & Security — All Data Stored Locally

Xuanji prioritizes privacy and security, with all data processed entirely locally:

- **Local Data Storage**: All conversations, memories, and configurations are stored locally, never uploaded to any server
- **User Isolation**: Multi-user support, with complete data isolation between users
- **API Key Security**: LLM API keys are encrypted and stored locally, only used during API calls
- **Dual-Layer Security Architecture**: LLM active auditing + hardcoded safeguards to prevent accidental execution of dangerous operations
- **Transparent Permission Control**: All file operations and command executions are explicitly communicated to the user, requiring user confirmation before execution
- **No Telemetry**: No usage data is collected by default, users are in full control

---

## Download

You can download the latest Xuanji desktop application from:

🌐 **https://shibit.net/download**

---

## Quick Start

### Prerequisites

- **Node.js** >= 20.0.0
- **npm** >= 9.0.0
- **Git** (optional, for workspace isolation)

### Installation

```bash
git clone https://github.com/shibit/xuanji.git
cd xuanji
npm install
```

### Configuration

```bash
# Set LLM API Key (at least one)
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."

# Or use custom endpoint
export XUANJI_BASE_URL="https://your-api-endpoint.com"
export XUANJI_MODEL="claude-sonnet-4-6"
```

### Running

```bash
# Desktop application (recommended)
npm run dev:gui

# Build desktop application
npm run build:gui:mac    # macOS
npm run build:gui:win    # Windows

# Command-line development mode
npm run dev
```

---

## Built-in Agents

| Agent | Role | Description |
|-------|------|-------------|
| **xuanji** | Main Agent | The only user-facing agent with 40+ tools |
| **scene-classifier** | Classifier | Intent analysis, classifies user input into scenario + complexity |
| **memory-manager** | Memory Manager | Analyzes conversations, extracts and maintains long-term memory |
| **context-compressor** | Compressor | Compresses long conversation history into structured summaries |
| **software-engineer** | Engineer | Code writing and debugging |
| **product-manager** | Product Manager | Requirements analysis and product planning |
| **ui-designer** | Designer | UI/UX design |

---

## 40+ Built-in Tools

### 📁 File System

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Write new files |
| `edit_file` | Edit existing files (search and replace) |
| `multi_edit` | Batch edits |
| `glob` | Glob pattern file search |
| `grep` | Regex search file contents |
| `bash` | Execute Shell commands |

### 🤖 Agent Orchestration

| Tool | Description |
|------|-------------|
| `task` | Create sub-agent to execute tasks (sync/async, up to 5 levels) |
| `agent_team` | Create multi-agent team (5 strategies, up to 10 members) |
| `match_agent` | Semantic vector matching for best agent |
| `task_control` | Manage background tasks (status/cancel/list) |

### 🌐 Network & Search

| Tool | Description |
|------|-------------|
| `web_search` | Unified search + fetch (Bing/Baidu/Google) |
| `install` | Search and install MCP/Skills |

### 🧠 Memory & Learning

| Tool | Description |
|------|-------------|
| `memory_search` | Search persistent memory |
| `memory_store` | Store memory |
| `memory_graph` | Knowledge graph queries |
| `learn` | Learn new capabilities (search/generate MCP/Skill) |

---

## Technology Stack

| Category | Technology |
|----------|------------|
| **Language** | TypeScript 5.7+ (ESM, ES2022) |
| **Runtime** | Node.js 20+ |
| **LLM SDK** | @anthropic-ai/sdk, openai, node-llama-cpp |
| **Database** | better-sqlite3 (permission decisions/memory) |
| **Desktop** | Electron 40+, React 18, TailwindCSS, shadcn/ui |
| **Visualization** | React Flow, Cytoscape |
| **Code Analysis** | tree-sitter (TS/Python/Java) |

---

## Documentation

- **Use Cases**: [docs/use-cases.md](./docs/use-cases.md) — See Xuanji in different scenarios
- **Comparison Analysis**: [docs/xuanji-vs-openclaw-vs-hermes-agent.md](./docs/xuanji-vs-openclaw-vs-hermes-agent.md)
- **Multi-Agent Collaboration System**: [docs/multi-agent-system.md](./docs/multi-agent-system.md)
- **Memory-Driven Learning System**: [docs/memory-system.md](./docs/memory-system.md)
- **Layered Prompt System**: [docs/layered-prompt-system.md](./docs/layered-prompt-system.md)
- **MCP Ecosystem**: [docs/mcp-ecosystem.md](./docs/mcp-ecosystem.md)

---

## License

MIT License — See [LICENSE](LICENSE) for details
