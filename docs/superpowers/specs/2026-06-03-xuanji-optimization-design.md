# xuanji 1.0 架构优化设计

## 元信息

- **日期**: 2026-06-03
- **状态**: 已批准
- **范围**: xuanji desktop + src/core，不影响业务逻辑
- **目标**: 降低代码复杂度、提升运行时性能、统一交互展示

## 优化策略：热点驱动（Hybrid）

分五个阶段执行，每个阶段有明确的成功指标。

---

## 阶段一：诊断与度量体系

在动手前建立度量基线。

### 1.1 代码复杂度扫描

- 工具: ESLint complexity rule + 文件行数统计
- 输出: 复杂度热力图（标记 >500 行且 >20 圈复杂度的文件）
- 目标: 识别 Top 10 热点文件及内部最复杂函数

### 1.2 运行时性能采集

- 工具: React DevTools Profiler + Electron devtools Performance tab
- 场景: 页面切换 / 大列表滚动 / Agent 响应后 UI 更新 / 对话框打开关闭
- 输出: 火焰图 + 组件渲染耗时排名
- 目标: 找出单次渲染 >16ms 的组件

### 1.3 Bundle 分析

- 工具: rollup-plugin-visualizer
- 输出: 模块大小树状图
- 目标: 识别可拆分的大 chunk（mermaid / codemirror / cytoscape）

### 1.4 Store 依赖图

- 手动分析 19 个 store 的 import 关系 + subscriber 数量
- 输出: store 依赖图 + 高频订阅路径
- 目标: 识别应合并的 store 对

诊断结果汇总为 `OPTIMIZATION_DIAGNOSIS.md`，作为后续阶段的输入。

---

## 阶段二：组件拆分

将 8 个超 900 行的巨型组件拆分为小而专注的子组件。

### 拆分原则

- 每个子组件 ≤300 行，单一职责
- Props 接口显式定义，不用 spread
- 子组件内 hooks 自包含，不向上传递
- 拆分过程中不修改任何业务逻辑

### 2.1 AgentEditor.tsx (1865 行 → ≤300 行/文件)

```
AgentEditor.tsx                    ← 主容器: tabs 路由 + 全局状态 (~150行)
├── AgentBasicInfo.tsx             ← 基本信息: 名称/描述/头像 (~100行)
├── AgentModelConfig.tsx           ← 模型配置: provider/model/参数 (~120行)
├── AgentSystemPrompt.tsx          ← systemPrompt 编辑器 + 模板选择 (~180行)
├── AgentToolSelector.tsx          ← 工具选择: checkbox 列表 + 搜索 (~150行)
├── AgentSkillList.tsx             ← 技能管理: 启用/禁用/排序 (~130行)
├── AgentMcpConfig.tsx             ← MCP 服务器配置 (~130行)
├── AgentSubAgentList.tsx          ← 子 Agent 编排 (~150行)
├── AgentScheduleConfig.tsx        ← 调度配置 (~120行)
└── shared/
    ├── ConfigSection.tsx           ← 通用配置区块 wrapper (~40行)
    └── ConfigToggle.tsx            ← 开关 + 描述行 (~30行)
```

### 2.2 MemoryPage.tsx (1909 行 → ≤250 行/文件)

```
MemoryPage.tsx                     ← 主容器: 类型 tabs + 搜索 (~100行)
├── MemoryList.tsx                 ← 记忆列表 + 虚拟滚动 (~150行)
├── MemoryCard.tsx                 ← 单条记忆卡片 (~80行)
├── MemoryDetailPanel.tsx          ← 记忆详情侧面板 (~150行)
├── MemoryImportDialog.tsx         ← 导入对话框 (~130行)
├── MemoryExportDialog.tsx         ← 导出对话框 (~100行)
├── MemorySearchBar.tsx            ← 搜索 + 过滤 (~120行)
├── MemoryStatsPanel.tsx           ← 统计面板 (~130行)
└── MemoryTypeConfig.tsx           ← 各类型记忆的配置 (~120行)
```

### 2.3 其余巨型组件拆分

| 组件 | 行数 | 拆分数 | 拆分维度 |
|------|------|--------|---------|
| SystemPromptManager | 1208 | 6 | 模板列表 / 编辑器 / 变量面板 / 预览 / 导入导出 / 历史版本 |
| SettingsPage | 1152 | 7 | 通用 / 外观 / 快捷键 / 网络 / 存储 / 隐私 / 关于 |
| SkillsMCPPage | 1059 | 5 | Skills 列表 / MCP 服务器列表 / 市场浏览 / 详情面板 / 安装向导 |
| InputArea | 1049 | 5 | 输入框 / 工具栏 / @mention / 文件附件 / 发送按钮 + 状态 |
| MessageBubble | 959 | 6 | 文本 / 代码块 / 工具调用 / 图片 / 文件 / 操作按钮 |
| ExecutionFlow | 960 | 5 | 画布 / 节点卡片 / 连线 / 详情面板 / 工具栏 |

---

## 阶段三：性能优化专项

### 3.1 路由级代码分割

- 使用 React.lazy + Suspense 按路由拆分 chunk
- MainPage 首屏加载，其余 lazy import
- 高频页面预加载（AgentPage / MemoryPage / SettingsPage）
- 预期: 首屏 JS 体积减少 40-50%

### 3.2 虚拟滚动

- 接入 @tanstack/react-virtual（已安装）
- 覆盖: MemoryPage 记忆列表 / AgentManager 卡片列表 / ChatArea 消息列表 / SkillsMCPPage 市场列表
- 使用 useVirtualizer hook，固定行高预估 + 动态测量后备

### 3.3 Memo 策略

- 页面级: React.memo + 浅比较 props
- 列表项: React.memo + key 优化
- 回调: useCallback 包裹传给子组件的函数
- 计算: useMemo 包裹 filter/sort/map 链
- Store: zustand selector 精确订阅

### 3.4 CSS 优化

- Tailwind content 路径精确配置
- 570 行自定义 CSS 分类处理: 设计 token 保留 :root，组件级移入 CSS module，未使用删除
- 第三方 CSS 按需加载

### 3.5 重型依赖按需加载

| 依赖 | 策略 |
|------|------|
| mermaid (~2MB) | 仅在 Markdown 含 mermaid 代码块时动态 import |
| cytoscape (~500KB) | 仅在 ExecutionFlow 页面动态 import |
| @milkdown/kit (~800KB) | 仅在打开 MilkdownEditor 时动态 import |
| katex (~300KB) | 渲染数学公式时动态 import |

---

## 阶段四：状态管理精简

### 4.1 Store 合并 (19 → 10)

| 合并前 | 合并后 | 理由 |
|--------|--------|------|
| chatStore + messageStore + conversationStore | chatStore | 消息收发与会话管理强耦合 |
| executionStore + unifiedLogStore | executionStore | 执行状态与日志流绑定 |
| sessionStore + sessionInitStore | sessionStore | 会话生命周期统一管理 |
| conversationHub | 删除 | 功能并入 chatStore |
| agentManagerStore | 移除 | AgentStateMachine 已覆盖 |
| 其余 9 个 store | 保持独立 | 职责独立，无强耦合 |

### 4.2 Selector 模式推广

- 每个 store 导出推荐 selector hooks
- 组件通过 selector 精确订阅，避免全量渲染

### 4.3 数据流标准化

```
User Action → Page Component
    ↓ 调用 store action
Store Action → 业务逻辑 → set()
    ↓ 触发 selector
Leaf Component → 仅受影响组件重渲染
```

- 禁止跨 store 直接读取 state
- 统一通过 Page 层协调或 IPC 服务层传递

---

## 阶段五：交互展示优化

### 5.1 加载态与过渡动画

- Suspense fallback 统一骨架屏（复用 framer-motion）
- 路由切换 AnimatePresence 淡入淡出
- 操作按钮 loading 态 + disabled 防重复点击

### 5.2 空状态统一

- 通用 EmptyState 组件: 图标 + 标题 + 描述 + 可选 CTA
- 覆盖所有页面的空状态场景

### 5.3 响应反馈

- Agent 思考中: 流式文本平滑显示
- 工具调用: 卡片收缩/展开动效
- Toast: 统一右下角，3s 自动消失
- 权限请求: 对话框焦点锁定

### 5.4 键盘导航

- Ctrl+K / Cmd+K: 全局命令面板
- Ctrl+N: 新建会话
- Ctrl+Enter: 发送消息
- Esc: 关闭对话框/侧面板

### 5.5 设计 Token 统一

- 全局搜索硬编码色值，替换为 CSS 变量
- 建立 4 档间距 scale（xs / sm / md / lg）

---

## 执行顺序

| 阶段 | 内容 | 预计文件改动 |
|------|------|-------------|
| 诊断 | 复杂度扫描 + 性能 Profile + Bundle 分析 + Store 依赖图 | 0（仅诊断报告） |
| 组件拆分 | 8 个巨型组件 → 40-50 个子组件 | 50+ 文件 |
| 性能专项 | lazy loading + 虚拟滚动 + memo + CSS 清理 | 20+ 文件 |
| 状态精简 | 19 → 10 store + selector 模式 | 10+ 文件 |
| 交互优化 | 骨架屏 + 过渡动画 + 空状态 + 键盘导航 + token 统一 | 15+ 文件 |
