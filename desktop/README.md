# Xuanji Desktop

> AI Agent Desktop Application - Electron + React + Vite

## 快速开始

```bash
# 安装依赖
cd desktop
npm install

# 开发模式
npm run electron:dev

# 构建打包
npm run electron:build
```

## 项目结构

```
desktop/
├── main/                 # Electron 主进程
│   ├── index.ts         # 主进程入口
│   └── preload.ts       # Preload 脚本
├── renderer/             # React 渲染进程
│   ├── components/      # React 组件
│   ├── stores/          # Zustand 状态管理
│   ├── App.tsx          # 根组件
│   └── main.tsx         # 渲染进程入口
├── shared/               # 共享模块
└── package.json
```

## 技术栈

- **Electron 28** - 桌面框架
- **React 18** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **TailwindCSS** - 样式框架
- **Zustand** - 状态管理
- **React-Markdown** - Markdown 渲染
- **Prism** - 代码高亮

## 功能特性

### MVP 版本 (v0.1.0)
- ✅ 三栏布局（会话列表 + 对话区 + 右侧面板）
- ✅ 气泡式对话界面
- ✅ Markdown 渲染 + 代码高亮
- ✅ 工具调用可视化
- ✅ 状态栏统计

### 计划中
- [ ] 集成真实 AgentLoop
- [ ] 流式输出
- [ ] 会话持久化
- [ ] Checkpoint 时光倒流
- [ ] 记忆系统
- [ ] 子代理可视化

## 快捷键

| 功能 | 快捷键 |
|------|-------|
| 发送消息 | Enter |
| 换行 | Shift+Enter |
| 新建会话 | Cmd+N |
| 打开设置 | Cmd+, |

## 开发指南

### 主进程 (main/)
- 窗口管理
- IPC 通信
- Agent 调用（待集成）

### 渲染进程 (renderer/)
- React 组件
- UI 交互
- 状态管理

### IPC 通信
- `agent:send-message` - 发送消息到 Agent
- `agent:interrupt` - 中断执行
- `agent:get-state` - 获取状态

## 相关链接

- [GUI 设计文档](../doc/prd/xuanji/gui-design-v1.md)
- [原型图](../doc/prd/xuanji/gui-mockups.md)
- [CLI 源码](../src/)
