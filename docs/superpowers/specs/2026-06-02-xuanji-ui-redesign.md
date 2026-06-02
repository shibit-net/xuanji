# Xuanji 交互视觉重构设计

> 日期: 2026-06-02
> 状态: 设计确认，待实现

## 目标

从交互和视觉设计视角全面优化 Xuanji 桌面端，解决信息密度过高、导航混乱、视觉细节粗糙等问题。

## 方案：布局重构 (方案 B)

从最多 5 列（侧栏 + 聊天 + 监控 + 文件树 + 输入）压缩到 2 列核心区 + 侧栏。

### 布局变更

```
当前布局 (5列 max)                    目标布局 (2列)
┌──────────────────────────┐         ┌──────────────────────────┐
│      TitleBar            │         │      TitleBar            │
├────┬────┬────┬────┬──────┤         ├────┬──────────┬──────────┤
│侧栏│聊天│监控│文件│      │         │侧栏│ 聊天区    │ 监控面板  │
│    │    │面板│树  │      │   →     │(含 │ (50%)    │ (50%)    │
│    │    │    │    │      │         │文件│          │          │
│    │    │    │    │      │         │树) │          │          │
├────┴────┴────┴────┴──────┤         ├────┴──────────┴──────────┤
│     InputArea + StatusBar│         │    InputArea + StatusBar  │
└──────────────────────────┘         └──────────────────────────┘
```

- 文件树面板合并到侧栏（可折叠）
- 监控面板从右侧第三列 → 右侧等分列（与聊天区 1:1）
- 聊天区和监控面板始终可见，无需 toggle
- 输入区横跨底部全宽

---

## 一、侧栏重新设计

### 结构：4 个功能域分组 + 集成文件树

```
┌─────────────────────┐
│  用户头像 + 信息     │
├─────────────────────┤
│ 会话                │  ← 分组标题
│ ▸ Xuanji (本地)     │
│ ▸ 远端会话 1        │
│   + Remote          │
├─────────────────────┤
│ 智能体              │  ← 分组标题
│   Agent 管理        │
│   工具管理          │
│   Skills / MCP     │
├─────────────────────┤
│ 配置                │  ← 分组标题
│   System Prompt    │
│   记忆管理          │
├─────────────────────┤
│ 运维                │  ← 分组标题
│   调度              │
│   权限              │
├─────────────────────┤
│ 系统                │  ← 分组标题
│   设置              │
│   帮助              │
├─────────────────────┤
│ ▾ 项目文件          │  ← 可折叠文件树
│   src/              │
│   desktop/          │
└─────────────────────┘
```

### 实现要点

- 分组标题样式：`text-[10px] uppercase text-muted-foreground/60 tracking-wider font-medium`
- 分组间用 `border-t border-border` 分隔（8px padding）
- 导航项 icon 尺寸统一 `size={14}`，间距 `gap-1.5`
- 侧栏宽度：`w-52`（从 w-56 略窄）
- 文件树组件 `ProjectFilesPanel` 逻辑迁移至侧栏底部
- 移除 Sidebar 的 `onOpen*` 回调 props，改用路由导航

---

## 二、核心区左右等分

### MainPage 布局

```
┌────┬─────────────────┬───────────────────┐
│侧栏│                  │                   │
│    │   ChatArea       │   MonitorPanel    │
│    │   (flex-1)       │   (flex-1)        │
│    │                  │                   │
├────┴──────────────────┴───────────────────┤
│   InputArea (工具栏 + 输入框 + 提示)       │
└──────────────────────────────────────────┘
```

### 实现要点

- `MainPage.tsx` 移除 `RightPanel` 和 `ProjectFilesPanel` 的独立 toggle/resize 逻辑
- 监控面板改为等分列内联组件（不再用 `RightPanel` 的独立宽度状态）
- 移除 `rightPanelWidth`、`projectFilesWidth` 相关的 localStorage 逻辑
- `InputArea` 提升到 MainPage 层级，横跨全宽
- 移除 `toggle-right-panel` 和 `toggle-project-files` 事件监听

---

## 三、监控面板内容重设计

### 标签页

| 原名称 | 新名称 | 图标 |
|--------|--------|------|
| 工作区 | 运行监控 | Activity |
| 日志 | 日志 | FileText |
| 远端 | 远端会话 | Radio |

### 运行监控标签

```
意图分析                                     已完成
┌──────────────────────────────────────────┐
│ Agent: code-reviewer   路由: LLM         │
│ 场景: 代码审查   复杂度: 高              │
│ 模型: claude-opus-4-7   置信度: 92%     │
│ ▸ Prompt 组件 (7 层, ~3200t)            │
└──────────────────────────────────────────┘

执行流
┌──────────────────────────────────────────┐
│ ✓ 读取文件 (0.3s)                       │
│ ✓ 分析代码 (1.2s)                       │
│ ◉ 生成审查报告...                        │
│ ○ 等待确认                              │
└──────────────────────────────────────────┘

Agent: code-reviewer · 运行中 · 3.2s
```

### 执行流节点状态

- `✓` 已完成（绿色）
- `◉` 进行中（蓝色 + 动画）
- `○` 待执行（灰色）
- `✗` 失败（红色）

### 日志标签

保持现有日志 + 工具调用合并时间线结构，优化：
- 过滤按钮改为 segmented control 样式
- 时间戳格式统一 `HH:mm:ss`
- 工具调用条目折叠/展开保持

---

## 四、全局文案标准化

| 当前文案 | 优化后 |
|---------|--------|
| 正在初始化会话... | 会话初始化中 |
| 入 1.5k / 出 800 | 输入 1.5k · 输出 800 |
| 压缩 45% | 上下文压缩 45% |
| 提取记忆 | 记忆提取 |
| 新消息 | 新消息 ↓ |
| 查看最新 | 回到底部 |
| 释放以添加文件 | 释放文件以上传 |
| 暂无可用 Agent | 无可用 Agent |
| 开始对话吧 | 输入消息开始 / 使用 /help 查看更多 |
| 发送 | 发送 |
| 停止 | 停止 |
| 选择 Agent | 选择 Agent |

---

## 五、全局视觉一致性

### 图标统一

所有 emoji 替换为 Lucide 图标：

| 位置 | 当前 | 替换为 |
|------|------|--------|
| 空状态装饰 | ⚡🧠🔧🤖 | Zap / Brain / Wrench / Bot |
| 后台任务 | 🛑 / ⏳ | AlertTriangle / Clock |
| 状态指示 | 内联 emoji | 统一使用 Lucide + 颜色 |

工具调用图标保持 `TOOL_ICONS` 映射不变（已有完整映射）。

### 间距体系

- 页面级 padding: `p-6`
- 卡片内 padding: `p-4`
- 列表项间距: `gap-2`
- 分段间距: `gap-4`
- 统一 Tailwind spacing scale

### 空状态

聊天空状态：
- 去掉底部 emoji 装饰
- 增加淡入动画引导卡片
- 3 条快捷操作提示替代口语提示

### 消息气泡微交互

- 气泡出现统一使用 `animate-fadeIn`
- 工具调用摘要 hover 微上浮
- 代码块统一 `rounded-xl`，hover 边框颜色过渡

### 输入区

- 工具栏按钮图标统一 `size={14}`
- Agent chip 颜色从紫色 → primary 色系

---

## 六、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `desktop/renderer/layouts/MainLayout.tsx` | 修改 | 移除 toggle 相关回调 |
| `desktop/renderer/components/Sidebar.tsx` | 重写 | 分组导航 + 集成文件树 |
| `desktop/renderer/components/TitleBar.tsx` | 修改 | 移除面板 toggle 按钮 |
| `desktop/renderer/pages/MainPage.tsx` | 重写 | 两列等分布局，InputArea 提升 |
| `desktop/renderer/components/RightPanel.tsx` | 重写 | 监控面板内容重设计，文案标准化 |
| `desktop/renderer/components/ChatArea.tsx` | 修改 | 空状态精装修，emoji → Lucide |
| `desktop/renderer/components/InputArea.tsx` | 修改 | 文案标准化，Agent chip 颜色 |
| `desktop/renderer/components/MessageBubble.tsx` | 修改 | 微交互细节 |
| `desktop/renderer/components/ProjectFilesPanel.tsx` | 移除引用 | 逻辑迁移至侧栏 |
| `desktop/renderer/index.css` | 修改 | 新增动画/样式 |
| `src/core/i18n/messages.ts` | 修改 | 文案标准化 |
