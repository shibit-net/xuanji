# Xuanji Desktop GUI 重构文档索引

本目录包含 Xuanji Desktop GUI 完整重构的所有文档。

## 📚 文档列表

### 总览文档
- **[GUI_REFACTOR_COMPLETE.md](GUI_REFACTOR_COMPLETE.md)** - 完整重构总结（4050 行代码，Phase 0-4 全记录）

### 分阶段文档
- **[PHASE1_COMPLETE.md](PHASE1_COMPLETE.md)** - 数据模型重构（三层架构：Configuration / Runtime / History）
- **[PHASE2_COMPLETE.md](PHASE2_COMPLETE.md)** - 布局重构（三栏布局：Sidebar / Workspace / InspectorPanel）
- **[PHASE3_COMPLETE.md](PHASE3_COMPLETE.md)** - 视图重构（5 个业务视图：Chat / Settings / AgentLibrary / SkillLibrary / ToolRegistry）
- **[PHASE4_COMPLETE.md](PHASE4_COMPLETE.md)** - 监控重构（5 个监控组件：Agent / Tool / Context / Memory / Logs）

## 🎯 快速导航

### 查找架构设计
→ 阅读 [GUI_REFACTOR_COMPLETE.md](GUI_REFACTOR_COMPLETE.md) 的"最终架构"部分

### 查找数据模型
→ 阅读 [PHASE1_COMPLETE.md](PHASE1_COMPLETE.md) 的"类型定义"部分

### 查找布局结构
→ 阅读 [PHASE2_COMPLETE.md](PHASE2_COMPLETE.md) 的"布局组件"部分

### 查找视图组件
→ 阅读 [PHASE3_COMPLETE.md](PHASE3_COMPLETE.md) 的"创建的视图组件"部分

### 查找监控组件
→ 阅读 [PHASE4_COMPLETE.md](PHASE4_COMPLETE.md) 的"创建的监控组件"部分

## 📊 项目统计

- **总代码量**：~4050 行
- **新增文件**：22 个
- **修复问题**：7 个
- **重构阶段**：5 个（Phase 0-4）
- **完成时间**：2026-03-14

## 🏗️ 核心架构

```
┌─────────────────────────────────────────────────────┐
│                   Renderer Process                   │
│                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   Stores    │  │   Views     │  │  Monitors   │ │
│  │  (Phase 1)  │→ │  (Phase 3)  │  │  (Phase 4)  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│         ↓                 ↓                 ↓        │
│  ┌──────────────────────────────────────────────┐  │
│  │        Layout Components (Phase 2)           │  │
│  │  Sidebar + Workspace + InspectorPanel        │  │
│  └──────────────────────────────────────────────┘  │
│         ↑                                            │
│  ┌──────────────────────────────────────────────┐  │
│  │              App.tsx                         │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
         ↑ IPC
┌─────────────────────────────────────────────────────┐
│              Main Process (Electron)                 │
│  AgentLoop / SkillRegistry / ToolRegistry / MCP     │
└─────────────────────────────────────────────────────┘
```

## 🎨 技术栈

- **框架**：React 18 + TypeScript 5
- **状态管理**：Zustand (4 stores)
- **动画**：Framer Motion
- **样式**：TailwindCSS
- **图标**：Lucide React
- **构建**：Electron + Vite

## 📝 修改记录

| 日期 | 阶段 | 内容 |
|------|------|------|
| 2026-03-14 | Phase 0 | 数据打通（IPC + 类型定义） |
| 2026-03-14 | Phase 1 | 数据模型重构（3 层架构） |
| 2026-03-14 | Phase 2 | 布局重构（3 栏布局） |
| 2026-03-14 | Phase 3 | 视图重构（5 个业务视图） |
| 2026-03-14 | Phase 4 | 监控重构（5 个监控组件） |
| 2026-03-14 | 完成 | 创建总结文档 |

---

**阅读建议**：
1. 新成员：先读总览文档 → 再按需阅读分阶段文档
2. 维护者：根据修改模块直接查阅对应 Phase 文档
3. 扩展者：阅读"后续建议"部分了解扩展方向
