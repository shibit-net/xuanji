# Agent 禁用功能

## 概述

为所有 agent 添加了禁用功能，被禁用的 agent 无法执行任务。主 agent（xuanji）不能被禁用。

## 功能特性

### 1. UI 层面

- **Agent 详情页**：添加了"禁用/启用"按钮
  - 启用状态：显示橙色"禁用"按钮
  - 禁用状态：显示绿色"启用"按钮
  - 主 agent 不显示此按钮（不能被禁用）

- **Agent 列表**：
  - 禁用的 agent 显示红色"禁"标签
  - 筛选器支持按状态过滤（全部/已启用/已禁用）

### 2. 后端逻辑

#### AgentRegistry
- `getEnabled()`: 只返回启用的 agent
- `getAll()`: 返回所有 agent（包括禁用的）
- `get(id)`: 返回指定 agent（无论是否禁用）

#### SubAgentFactory
- 创建子 agent 时检查 `enabled` 状态
- 如果 agent 被禁用，抛出错误：
  ```
  Agent "Agent Name" (agent-id) is disabled.
  Please enable it in Agent Manager or use a different agent.
  ```

#### MatchAgentTool
- 自动过滤禁用的 agent
- 只推荐启用的 agent

#### ListAgentsTool
- 默认只列出启用的 agent
- 可通过 `enabled_only: false` 参数列出所有 agent

### 3. 主 Agent 保护

主 agent（xuanji）有特殊标记 `metadata.isMainAgent: true`，受到以下保护：

1. **UI 层面**：不显示禁用按钮
2. **后端层面**：尝试禁用主 agent 时返回错误："主 Agent 不能被禁用"

## 实现细节

### 数据模型

```typescript
interface ConfigurableAgentConfig {
  // ... 其他字段
  enabled: boolean;  // 是否启用
  metadata?: {
    isMainAgent?: boolean;  // 是否为主 agent
    // ... 其他元数据
  };
}
```

### 关键代码位置

1. **UI 组件**
   - `desktop/renderer/components/AgentDetail.tsx` - 禁用/启用按钮
   - `desktop/renderer/components/AgentManager.tsx` - 处理禁用/启用逻辑

2. **后端逻辑**
   - `src/core/agent/SubAgentFactory.ts` - 创建 agent 时检查禁用状态
   - `src/core/agent/AgentRegistry.ts` - 过滤禁用的 agent
   - `src/core/tools/MatchAgentTool.ts` - 匹配时过滤禁用的 agent
   - `src/core/tools/ListAgentsTool.ts` - 列表时过滤禁用的 agent
   - `desktop/main/agent-bridge.ts` - 更新 agent 时检查主 agent 保护

3. **测试**
   - `test/integration/agent-disabled-check.test.ts` - 禁用功能测试

## 使用示例

### 禁用 Agent

1. 打开 Agent 管理器
2. 选择要禁用的 agent
3. 点击"禁用"按钮
4. Agent 状态变为禁用，无法被调用

### 启用 Agent

1. 打开 Agent 管理器
2. 在筛选器中选择"已禁用"或"全部"
3. 选择要启用的 agent
4. 点击"启用"按钮
5. Agent 状态变为启用，可以正常使用

### 通过工具查询

```typescript
// 只列出启用的 agent
list_agents({ filter: { enabled_only: true } })

// 列出所有 agent（包括禁用的）
list_agents({ filter: { enabled_only: false } })
```

## 注意事项

1. **主 Agent 不能被禁用**：xuanji 作为主 agent，负责所有用户交互，不能被禁用
2. **禁用后立即生效**：禁用 agent 后，所有新的任务分配都会跳过该 agent
3. **配置持久化**：禁用状态会保存到 agent 配置文件中，重启后保持
4. **系统 Agent 降级策略**：
   - **意图分析 Agent (scene-classifier)**：禁用后自动降级到向量分析和关键字匹配
     - 第1层：本地LLM（scene-classifier agent）
     - 第2层：向量分析（IntentAnalyzer with Embedding）
     - 第3层：关键字匹配（IntentAnalyzer with Regex）
     - 第4层：默认配置（scene: general, agent: general）
   - 其他系统 agent 禁用可能影响相关功能

## 系统 Agent 降级详解

### 意图分析降级链路

意图分析是系统的核心功能，用于理解用户意图并选择合适的 agent。当 `scene-classifier` agent 被禁用时，系统会自动使用降级策略：

```typescript
// IntentClassifier 的降级策略
async classify(userInput: string): Promise<ClassificationResult> {
  // 第1层：尝试本地LLM（scene-classifier agent）
  const llmResult = await this.tryLocalModel(userInput);
  if (llmResult) return llmResult;

  // 第2层：降级到向量分析
  const embeddingResult = await this.tryEmbedding(userInput);
  if (embeddingResult) return embeddingResult;

  // 第3层：降级到关键字匹配
  const keywordResult = await this.tryKeyword(userInput);
  if (keywordResult) return keywordResult;

  // 第4层：返回默认配置
  return { scene: 'general', agent: 'general', complexity: 'simple' };
}
```

**降级效果对比**：

| 层级 | 方法 | 准确度 | 速度 | 说明 |
|------|------|--------|------|------|
| 第1层 | 本地LLM | 最高 | 快 | 使用 scene-classifier agent，需要下载模型 |
| 第2层 | 向量分析 | 较高 | 中等 | 基于 embedding 相似度匹配 |
| 第3层 | 关键字匹配 | 基本 | 最快 | 基于正则表达式匹配 |
| 第4层 | 默认配置 | N/A | 即时 | 返回通用配置 |

**何时禁用意图分析 Agent**：

- 不想下载本地模型文件（节省磁盘空间）
- 希望使用更快的关键字匹配（牺牲准确度换取速度）
- 调试降级策略
- 临时禁用以排查问题

## 错误处理

### 尝试使用禁用的 Agent

```
Error: Agent "Software Engineer" (software-engineer) is disabled.
Please enable it in Agent Manager or use a different agent.
```

### 尝试禁用主 Agent

```
Error: 主 Agent 不能被禁用
```
