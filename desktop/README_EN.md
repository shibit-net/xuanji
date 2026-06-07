# Xuanji Desktop

> Visual desktop application for Agentic OS

<p align="center">
  <a href="./README.md">中文版本</a> | <strong>English Version</strong>
</p>

---

## Download

You can download the latest Xuanji desktop application from:

🌐 **https://shibit.net/download**

---

## Quick Start

```bash
# Start from project root
cd ..
npm run dev:gui

# Or start from desktop directory
npm run dev
```

## Feature Highlights

### 🎨 Multi-Agent Collaboration Visualization

- **React Flow Collaboration Diagrams**: Real-time view of agent team collaboration
  - Serial execution: Nodes connected one after another
  - Parallel execution: Multiple nodes running simultaneously
  - Hierarchical collaboration: Leader → sub-agent tree structure
  - Debate collaboration: Multiple agents connected back and forth
  - Pipeline collaboration: Chain connection, step-by-step processing

- **Cytoscape Knowledge Graph**: Intuitive display of memory and relationships
  - Entity-relation-event model
  - Interactive exploration
  - Relationship strength visualization

### 💬 Modern Chat Interface

- **Bubble Conversation**: Beautiful chat experience
- **Markdown Rendering**: Full code highlighting support
- **Tool Call Visualization**: Real-time tool execution visibility
- **Streaming Output**: Smooth LLM response experience

### 🔌 MCP Ecosystem Integration

- **Market Integration**: One-click installation of Playwright, use computer, and other MCPs
- **Skills Management**: Install, enable, disable MCP/skills
- **Configuration Management**: Intuitive MCP configuration interface

### 📊 Monitoring and Debugging

- **Real-time Monitoring Panel**: Tool calls, memory access, event logs
- **Permission Auditing**: Security logs for all operations
- **Token Statistics**: Real-time cost tracking

---

## Technology Stack

| Technology | Purpose |
|------------|---------|
| **Electron 40+** | Desktop application framework |
| **React 18** | UI framework |
| **TypeScript** | Type safety |
| **Vite** | Build tool |
| **TailwindCSS** | Styling framework |
| **shadcn/ui** | UI component library |
| **Zustand** | State management |
| **React Flow** | Collaboration flow diagrams |
| **Cytoscape** | Knowledge graph |
| **React Markdown** | Markdown rendering |
| **Prism** | Code highlighting |

---

## Project Structure

```
desktop/
├── main/                     # Electron main process
│   ├── index.ts             # Main entry
│   ├── agent-bridge.ts      # Core engine bridge
│   ├── ipc/                 # 90+ IPC channels
│   └── services/            # Business services
├── renderer/                 # React renderer process
│   ├── components/          # React components
│   ├── pages/               # Pages
│   ├── stores/              # Zustand state
│   ├── App.tsx
│   └── main.tsx
├── shared/                   # Shared modules
│   └── ipc-channels.ts      # IPC type definitions
├── package.json
└── README.md
```

---

## Keyboard Shortcuts

| Feature | Shortcut |
|---------|----------|
| Send message | Enter |
| New line | Shift+Enter |
| New session | Cmd+N (macOS) / Ctrl+N (Windows) |
| Open settings | Cmd+, (macOS) / Ctrl+, (Windows) |

---

## Development Guide

### Prerequisites

- Node.js >= 20.0.0
- npm >= 9.0.0

### Install Dependencies

```bash
# From project root
npm install

# Or from desktop directory
cd desktop
npm install
```

### Development Mode

```bash
# Start desktop application (recommended from root)
cd ..
npm run dev:gui

# Or from desktop directory
npm run dev
```

### Build for Release

```bash
# macOS
npm run build:gui:mac

# Windows
npm run build:gui:win

# All platforms
npm run build:gui:all
```

---

## Documentation

- **Main Project README**: [../README.md](../README.md)
- **Use Cases**: [../docs/use-cases.md](../docs/use-cases.md) — See Xuanji in different scenarios
- **Multi-Agent Collaboration System**: [../docs/multi-agent-system.md](../docs/multi-agent-system.md)
- **Memory-Driven Learning System**: [../docs/memory-system.md](../docs/memory-system.md)
- **Layered Prompt System**: [../docs/layered-prompt-system.md](../docs/layered-prompt-system.md)
- **MCP Ecosystem**: [../docs/mcp-ecosystem.md](../docs/mcp-ecosystem.md)
- **Comparison Analysis**: [../docs/xuanji-vs-openclaw-vs-hermes-agent.md](../docs/xuanji-vs-openclaw-vs-hermes-agent.md)

---

## License

MIT License — See [LICENSE](../LICENSE) for details
