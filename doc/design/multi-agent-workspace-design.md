# 多 Agent 工作区设计方案

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

1. **创建专门的多 agent 工作区**：设计一个新的工作区视图，专门用于展示和管理多 agent 场景。

2. **Agent 可视化**：
   - 以图形化方式展示 agent 之间的层级关系
   - 实时显示每个 agent 的状态和执行进度
   - 展示 agent 之间的消息传递和协作

3. **Agent 团队管理**：
   - 支持创建和管理 agent 团队
   - 可视化 agent 团队的组织结构
   - 支持 agent 之间的任务分配和协作

4. **集成现有功能**：
   - 与现有的 ChatArea 和 InputArea 集成
   - 利用现有的 activeAgentStore 状态管理
   - 保持与现有 UI 风格的一致性

## 3. 架构设计

### 3.1 组件结构

```
MultiAgentWorkspace
├── AgentTeamPanel           # Agent 团队面板（左侧）
│   ├── AgentTeamList        # Agent 团队列表
│   ├── AgentTeamEditor      # Agent 团队编辑器
│   └── AgentNode            # Agent 节点组件
├── AgentExecutionPanel      # Agent 执行面板（中央）
│   ├── ExecutionFlow        # 执行流程图
│   ├── AgentStatusList      # Agent 状态列表
│   └── ToolExecutionList    # 工具执行列表
├── ChatArea                 # 对话区域（下方）
│   └── MessageBubble        # 消息气泡（支持显示 agent 信息）
└── InputArea                # 输入区域（底部）
```

### 3.2 状态管理

1. **扩展 activeAgentStore**：
   - 添加 agent 团队管理功能
   - 增加 agent 之间的关系和依赖管理
   - 支持 agent 团队的保存和加载

2. **新增 multiAgentStore**：
   - 管理多 agent 工作区的状态
   - 保存当前活动的 agent 团队
   - 跟踪 agent 团队的执行历史

### 3.3 数据流

1. **Agent 团队创建/编辑**：
   - 用户通过 AgentTeamEditor 创建或编辑 agent 团队
   - 数据保存到 multiAgentStore

2. **Agent 执行流程**：
   - 用户触发 agent 团队执行
   - activeAgentStore 记录每个 agent 的状态
   - AgentExecutionPanel 实时展示执行状态
   - MessageBubble 显示 agent 的消息和执行结果

3. **Agent 协作**：
   - Agent 之间的消息传递通过 activeAgentStore 记录
   - ExecutionFlow 组件可视化展示协作流程

## 4. 详细设计

### 4.1 MultiAgentWorkspace 组件

**职责**：
- 作为多 agent 工作区的主容器
- 管理不同面板的布局和交互
- 协调不同组件之间的数据流

**设计**：
- 使用 Grid 布局，支持响应式设计
- 左侧 AgentTeamPanel，占据 30% 宽度
- 中央 AgentExecutionPanel，占据 70% 宽度
- 下方 ChatArea 和 InputArea，占据整个宽度

### 4.2 AgentTeamPanel 组件

**职责**：
- 展示和管理 agent 团队
- 支持创建、编辑和删除 agent 团队
- 显示 agent 团队的组织结构

**设计**：
- 顶部：Agent 团队列表和创建按钮
- 中部：Agent 团队编辑器
- 底部：Agent 节点列表和关系编辑器

### 4.3 AgentExecutionPanel 组件

**职责**：
- 展示 agent 团队的执行状态
- 可视化 agent 之间的执行流程
- 显示工具执行的详细信息

**设计**：
- 顶部：执行控制按钮（开始、暂停、停止）
- 中部：ExecutionFlow 组件，以流程图方式展示 agent 执行
- 底部：AgentStatusList 和 ToolExecutionList

### 4.4 ExecutionFlow 组件

**职责**：
- 以图形化方式展示 agent 之间的执行流程
- 实时更新 agent 的状态和执行进度
- 支持点击 agent 节点查看详情

**设计**：
- 使用 D3.js 或 React Flow 库实现流程图
- 节点表示 agent，边表示 agent 之间的关系
- 节点颜色表示 agent 状态（思考中、执行中、完成、错误）
- 支持拖拽和缩放功能

### 4.5 AgentNode 组件

**职责**：
- 展示单个 agent 的信息和状态
- 支持 agent 的编辑和配置
- 显示 agent 的执行统计信息

**设计**：
- 卡片式设计，显示 agent 名称、状态和基本信息
- 悬停时显示详细信息
- 点击时打开 agent 编辑器

### 4.6 MessageBubble 组件扩展

**职责**：
- 扩展现有 MessageBubble 组件，支持显示 agent 信息
- 区分不同 agent 的消息
- 显示 agent 之间的消息传递

**设计**：
- 在消息头部显示 agent 名称和图标
- 使用不同的颜色区分不同的 agent
- 支持显示 agent 之间的消息传递路径

## 5. 实现计划

### 5.1 阶段一：基础架构

1. 创建 MultiAgentWorkspace 组件
2. 扩展 activeAgentStore，添加 agent 团队管理功能
3. 创建 multiAgentStore，管理多 agent 工作区状态

### 5.2 阶段二：核心组件

1. 实现 AgentTeamPanel 组件
2. 实现 AgentExecutionPanel 组件
3. 实现 ExecutionFlow 组件
4. 实现 AgentNode 组件

### 5.3 阶段三：集成和优化

1. 扩展 MessageBubble 组件，支持 agent 信息显示
2. 集成现有的 ChatArea 和 InputArea
3. 实现 agent 团队的保存和加载
4. 优化 UI/UX，确保与现有界面风格一致

### 5.4 阶段四：测试和完善

1. 测试多 agent 场景的展示和管理
2. 优化性能和用户体验
3. 完善文档和使用指南

## 6. 技术选型

1. **前端框架**：React + TypeScript
2. **状态管理**：Zustand（与现有代码保持一致）
3. **UI 库**：Tailwind CSS（与现有代码保持一致）
4. **流程图库**：React Flow（轻量级且功能强大）
5. **动画效果**：Framer Motion（与现有代码保持一致）

## 7. 预期效果

1. **直观的 agent 团队管理**：用户可以通过可视化界面创建和管理 agent 团队

2. **实时的执行状态展示**：用户可以实时查看 agent 团队的执行状态和进度

3. **清晰的 agent 协作流程**：用户可以通过流程图直观了解 agent 之间的协作关系

4. **无缝的用户体验**：多 agent 工作区与现有功能集成，提供一致的用户体验

5. **强大的扩展性**：设计支持未来添加更多 agent 管理功能和可视化效果

## 8. 总结

本设计方案通过创建专门的多 agent 工作区，解决了当前 xuanji 无法正确展示多 agent 场景的问题。方案利用现有的架构和组件，通过扩展和集成，实现了 agent 团队的可视化管理和执行状态的实时展示。

该设计不仅满足了当前的需求，还为未来的功能扩展和优化奠定了基础。通过本方案的实现，用户将能够更加直观、高效地管理和监控多 agent 场景，提高 xuanji 在复杂任务处理中的表现。