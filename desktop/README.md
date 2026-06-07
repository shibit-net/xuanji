# 璇玑桌面 (Xuanji Desktop)

> Agentic OS 的可视化桌面应用

<p align="center">
  <strong>中文版本</strong> | <a href="./README_EN.md">English Version</a>
</p>

---

## 下载

你可以从以下地址下载最新的璇玑桌面应用：

🌐 **https://shibit.net/download**

---

## 快速开始

```bash
# 从项目根目录启动
cd ..
npm run dev:gui

# 或从 desktop 目录启动
npm run dev
```

## 功能特色

### 🎨 多智能体协作可视化

- **React Flow 协作流程图**：实时看到 Agent 团队的协作过程
  - 串行执行：节点一个接一个连接
  - 并行执行：多个节点同时运行
  - 层级协作：Leader → 子 Agent 树状结构
  - 辩论协作：多个 Agent 之间来回连接
  - 流水线协作：链式连接，逐步处理

- **Cytoscape 知识图谱**：直观展示记忆和关系
  - 实体-关系-事件模型
  - 交互式探索
  - 关系强度可视化

### 💬 现代化聊天界面

- **气泡式对话**：美观的聊天体验
- **Markdown 渲染**：完整支持代码高亮
- **工具调用可视化**：实时看到工具执行过程
- **流式输出**：流畅的 LLM 响应体验

### 🔌 MCP 生态集成

- **天工坊市场**：一键安装 Playwright、use computer 等 MCP
- **技能管理**：安装、启用、禁用 MCP/技能
- **配置管理**：直观的 MCP 配置界面

### 📊 监控和调试

- **实时监控面板**：工具调用、记忆访问、事件日志
- **权限审计**：所有操作的安全日志
- **Token 统计**：实时成本追踪

---

## 技术栈

| 技术 | 用途 |
|------|------|
| **Electron 40+** | 桌面应用框架 |
| **React 18** | UI 框架 |
| **TypeScript** | 类型安全 |
| **Vite** | 构建工具 |
| **TailwindCSS** | 样式框架 |
| **shadcn/ui** | UI 组件库 |
| **Zustand** | 状态管理 |
| **React Flow** | 协作流程图 |
| **Cytoscape** | 知识图谱 |
| **React Markdown** | Markdown 渲染 |
| **Prism** | 代码高亮 |

---

## 项目结构

```
desktop/
├── main/                     # Electron 主进程
│   ├── index.ts             # 主入口
│   ├── agent-bridge.ts      # 核心引擎桥接
│   ├── ipc/                 # 90+ IPC 通道
│   └── services/            # 业务服务
├── renderer/                 # React 渲染进程
│   ├── components/          # React 组件
│   ├── pages/               # 页面
│   ├── stores/              # Zustand 状态
│   ├── App.tsx
│   └── main.tsx
├── shared/                   # 共享模块
│   └── ipc-channels.ts      # IPC 类型定义
├── package.json
└── README.md
```

---

## 快捷键

| 功能 | 快捷键 |
|------|-------|
| 发送消息 | Enter |
| 换行 | Shift+Enter |
| 新建会话 | Cmd+N (macOS) / Ctrl+N (Windows) |
| 打开设置 | Cmd+, (macOS) / Ctrl+, (Windows) |

---

## 开发指南

### 环境要求

- Node.js >= 20.0.0
- npm >= 9.0.0

### 安装依赖

```bash
# 从项目根目录
npm install

# 或从 desktop 目录
cd desktop
npm install
```

### 开发模式

```bash
# 启动桌面应用（推荐根目录）
cd ..
npm run dev:gui

# 或从 desktop 目录
npm run dev
```

### 构建发布

```bash
# macOS
npm run build:gui:mac

# Windows
npm run build:gui:win

# 全平台
npm run build:gui:all
```

---

## 相关文档

- **主项目 README**：[../README.md](../README.md)
- **应用场景**：[../docs/use-cases.md](../docs/use-cases.md) — 查看璇玑在不同场景下的应用
- **多智能体协作系统**：[../docs/multi-agent-system.md](../docs/multi-agent-system.md)
- **记忆驱动学习系统**：[../docs/memory-system.md](../docs/memory-system.md)
- **分层提示词系统**：[../docs/layered-prompt-system.md](../docs/layered-prompt-system.md)
- **MCP 生态系统**：[../docs/mcp-ecosystem.md](../docs/mcp-ecosystem.md)
- **同类品对比分析**：[../docs/xuanji-vs-openclaw-vs-hermes-agent.md](../docs/xuanji-vs-openclaw-vs-hermes-agent.md)

---

## 许可证

MIT License — 详见 [LICENSE](../LICENSE)
