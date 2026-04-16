# 右侧 Workspace 多 Agent 场景设计方案

## 1. 问题分析

### 当前实现的问题

1. **Workspace 结构简单**：当前的 Workspace 组件只是一个简单的容器，没有专门的多 agent 展示区域。

2. **Agent 展示不足**：
   - ChatView 只包含 ChatArea 和 InputArea，没有 agent 管理界面
   - MessageBubble 只显示用户和助手的消息，没有区分不同的 agent
   - 缺少 agent 之间关系和协作的可视化展示

3. **Agent 状态管理**：
   - activeAgentStore 已经实现了主 agent 和 subAgent 的层级结构管理
   - 但是这些状态没有在 UI 中得到充分展示

4. **多 agent 场景支持**：
   - 缺少专门的多 agent 工作模式
   - 没有 agent 团队的概念和展示

## 2. 设计目标

1. **增强右侧 Workspace**：设计一个增强版的右侧 workspace，专门用于展示多 agent 场景。

2. **Agent 可视化**：
   - 以图形化方式展示 agent 之间的层级关系
   - 实时显示每个 agent 的状态和执行进度
   - 展示 agent 之间的消息传递和协作

3. **集成现有功能**：
   - 与现有的 ChatArea 和 InputArea 集成
   - 利用现有的 activeAgentStore 状态管理
   - 保持与现有 UI 风格的一致性

4. **响应式设计**：
   - 支持不同屏幕尺寸
   - 在小屏幕上自动调整布局

## 3. 架构设计

### 3.1 组件结构

```
EnhancedWorkspace
├── AgentExecutionPanel      # Agent 执行面板（上方）
│   ├── ExecutionFlow        # 执行流程图
│   └── AgentStatusList      # Agent 状态列表
├── ChatArea                 # 对话区域（下方）
│   └── MessageBubble        # 消息气泡（支持显示 agent 信息）
└── InputArea                # 输入区域（底部）
```

### 3.2 状态管理

1. **利用现有 activeAgentStore**：
   - 使用现有的 agent 状态管理功能
   - 扩展以支持多 agent 场景的展示需求

### 3.3 数据流

1. **Agent 执行流程**：
   - 用户触发多 agent 任务
   - activeAgentStore 记录每个 agent 的状态
   - AgentExecutionPanel 实时展示执行状态
   - MessageBubble 显示 agent 的消息和执行结果

2. **Agent 协作**：
   - Agent 之间的消息传递通过 activeAgentStore 记录
   - ExecutionFlow 组件可视化展示协作流程

## 4. 详细设计

### 4.1 EnhancedWorkspace 组件

**职责**：
- 作为增强版工作区的主容器
- 管理不同面板的布局和交互
- 协调不同组件之间的数据流

**设计**：
- 使用 Flex 布局，垂直排列组件
- 上方 AgentExecutionPanel，占据 40% 高度
- 下方 ChatArea，占据 60% 高度
- 底部 InputArea，固定高度

### 4.2 AgentExecutionPanel 组件

**职责**：
- 展示多 agent 场景的执行状态
- 可视化 agent 之间的执行流程
- 显示 agent 的状态和执行进度

**设计**：
- 顶部：执行控制按钮（开始、暂停、停止）
- 中部：ExecutionFlow 组件，以流程图方式展示 agent 执行
- 底部：AgentStatusList，显示 agent 状态列表

### 4.3 ExecutionFlow 组件

**职责**：
- 以图形化方式展示 agent 之间的执行流程
- 实时更新 agent 的状态和执行进度
- 支持点击 agent 节点查看详情

**设计**：
- 使用 React Flow 库实现流程图
- 节点表示 agent，边表示 agent 之间的关系
- 节点颜色表示 agent 状态（思考中、执行中、完成、错误）
- 支持拖拽和缩放功能
- 悬停时显示 agent 详细信息

### 4.4 AgentStatusList 组件

**职责**：
- 以列表形式展示 agent 的状态
- 显示 agent 的基本信息和执行进度
- 支持点击查看 agent 详情

**设计**：
- 表格形式展示 agent 列表
- 包含 agent 名称、状态、执行进度、工具使用情况等信息
- 使用颜色编码表示 agent 状态
- 支持排序和筛选功能

### 4.5 MessageBubble 组件扩展

**职责**：
- 扩展现有 MessageBubble 组件，支持显示 agent 信息
- 区分不同 agent 的消息
- 显示 agent 之间的消息传递

**设计**：
- 在消息头部显示 agent 名称和图标
- 使用不同的颜色区分不同的 agent
- 支持显示 agent 之间的消息传递路径
- 保留现有的消息样式和功能

## 5. 实现计划

### 5.1 阶段一：基础架构

1. 创建 EnhancedWorkspace 组件
2. 实现 AgentExecutionPanel 组件
3. 集成现有的 ChatArea 和 InputArea

### 5.2 阶段二：核心组件

1. 实现 ExecutionFlow 组件
2. 实现 AgentStatusList 组件
3. 扩展 MessageBubble 组件，支持 agent 信息显示

### 5.3 阶段三：集成和优化

1. 与 activeAgentStore 集成，实时获取 agent 状态
2. 优化 UI/UX，确保与现有界面风格一致
3. 实现响应式设计，支持不同屏幕尺寸

### 5.4 阶段四：测试和完善

1. 测试多 agent 场景的展示
2. 优化性能和用户体验
3. 完善文档和使用指南

## 6. 技术选型

1. **前端框架**：React + TypeScript
2. **状态管理**：Zustand（与现有代码保持一致）
3. **UI 库**：Tailwind CSS（与现有代码保持一致）
4. **流程图库**：React Flow（轻量级且功能强大）
5. **动画效果**：Framer Motion（与现有代码保持一致）

## 7. 预期效果

1. **实时的 agent 执行状态**：用户可以实时查看多 agent 场景的执行状态和进度

2. **清晰的 agent 协作流程**：用户可以通过流程图直观了解 agent 之间的协作关系

3. **区分不同 agent 的消息**：用户可以通过消息气泡区分不同 agent 的消息和执行结果

4. **无缝的用户体验**：增强版工作区与现有功能集成，提供一致的用户体验

5. **响应式设计**：在不同屏幕尺寸上都能良好展示

## 8. 总结

本设计方案通过增强右侧 workspace，解决了当前 xuanji 无法正确展示多 agent 场景的问题。方案利用现有的架构和组件，通过扩展和集成，实现了 agent 执行状态的实时展示和协作流程的可视化。

该设计不仅满足了当前的需求，还为未来的功能扩展和优化奠定了基础。通过本方案的实现，用户将能够更加直观、高效地监控多 agent 场景，提高 xuanji 在复杂任务处理中的表现。