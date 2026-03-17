# Agent 独立模型配置 - 阶段 1 完成总结

## 实现内容

### ✅ 已完成（阶段 1：GUI 配置保存）

#### 1. 类型定义扩展（`types/models.ts`）

```typescript
export interface AgentProfile {
  // ... 其他字段
  model: {
    primary: string;              // 主模型（必填）
    fallback?: string;             // 备用模型（可选）
    maxTokens?: number;            // 最大 Tokens（可选）
    temperature?: number;          // 温度参数（可选）
    thinking?: {                   // Extended Thinking 配置（可选）
      type?: 'enabled' | 'disabled' | 'adaptive';
      effort?: 'low' | 'medium' | 'high';
    };
  };
}
```

#### 2. AgentEditor 增强（`components/AgentEditor.tsx`）

**新增模型选项**：
- 添加最新 Claude 模型：`claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`
- 添加 OpenAI 模型：`gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`

**新增表单字段**：
- ✅ 主模型 *（必填下拉框）
- ✅ 备用模型（可选下拉框）
- ✅ 温度 (0-1)（数字输入，支持 step=0.1）
- ✅ 最大 Tokens（数字输入，范围 1000-200000）
- ✅ Extended Thinking 思考模式（启用/禁用/自适应）
- ✅ Extended Thinking 思考力度（低/中/高）

**表单增强**：
- 支持 `{value, label}` 格式的选项（用于显示中文标签）
- 支持 `extraProps` 参数（用于传递 HTML 属性如 min, max, step）

#### 3. AgentDetail 增强（`components/AgentDetail.tsx`）

新增**模型配置展示区域**：
- 显示主模型和备用模型
- 显示温度和最大 Tokens
- 显示 Extended Thinking 配置（带 emoji 图标）
- 位置：在"标签"和"完整配置"之间

#### 4. 默认配置更新

```typescript
DEFAULT_CONFIG = {
  // ...
  model: {
    primary: 'claude-3-5-sonnet-20241022',
    fallback: 'claude-3-5-haiku-20241022',
    temperature: 0.7,
    maxTokens: 8000,
    thinking: {
      type: 'adaptive',
      effort: 'medium',
    },
  },
};
```

---

## 功能演示

### 创建/编辑 Agent

1. **打开 Agent 库** → 点击"新建 Agent"或"编辑"
2. **展开"模型配置"** 区块
3. **配置模型参数**：
   ```
   主模型: claude-sonnet-4-5-20250929
   备用模型: claude-haiku-4-5-20251001
   温度: 0.7
   最大 Tokens: 64000
   思考模式: 自适应
   思考力度: 中
   ```
4. **保存** → 配置写入 JSON5/YAML 文件

### 查看 Agent 详情

1. **打开 Agent 库** → 点击某个 Agent
2. **查看"模型配置"** 区域，显示所有配置参数
3. **点击"完整配置"** → 查看 JSON 格式的所有配置

---

## 数据流

```
用户在 GUI 编辑
    ↓
AgentEditor.tsx (表单)
    ↓
configStore.updateAgent() / createAgent()
    ↓
IPC 调用 (window.electron.agentUpdate / agentCreate)
    ↓
agent-bridge.ts (handleAgentUpdate / handleAgentCreate)
    ↓
AgentRegistry.saveToFile()
    ↓
写入 JSON5/YAML 文件
```

---

## 运行时行为（当前）

### ⚠️ 重要说明

**配置已保存，但运行时暂不使用**：

- ✅ **能做**：在 GUI 中配置和保存完整的 model 配置
- ✅ **保存到**：`~/.xuanji/agents/*.json5` 或 `.xuanji/agents/*.json5`
- ❌ **不做**：运行时不会读取这些配置创建专属 provider

**实际运行时逻辑**：
- 所有 Agent（包括子代理）只能在两个全局 provider 之间选择：
  - `mainProvider` - 由 ChatSession 初始化（读取全局配置）
  - `lightProvider` - 由 ChatSession 初始化（读取全局配置）
- 选择逻辑：根据 `useLightModel` 标志（不读取 `agent.model.primary`）

**代码位置**：`src/core/agent/SubAgentLoop.ts:132`
```typescript
const provider = context.useLightModel ? lightProvider : mainProvider;
```

---

## 未来扩展（阶段 2）

如果需要实现运行时动态模型选择，需要：

1. **修改 SubAgentLoop.ts**：
   ```typescript
   // 读取 agent 配置
   const agentConfig = await agentRegistry.get(context.role);

   // 动态创建 provider
   if (agentConfig?.model?.primary) {
     const provider = await createProviderForAgent(agentConfig.model);
   }
   ```

2. **实现 Provider 工厂**：
   ```typescript
   async function createProviderForAgent(modelConfig: ModelConfig): Promise<ILLMProvider> {
     // 根据 primary 字段判断 adapter（anthropic/openai/ollama）
     // 创建对应的 Provider 实例
     // 应用 temperature, maxTokens, thinking 等参数
   }
   ```

3. **集成 AgentRegistry**：
   - SubAgentLoop 需要访问 AgentRegistry
   - 根据 `role` 参数查找对应的 agent 配置

---

## 测试建议

### 测试 1：创建自定义 Agent

1. 打开 Agent 库 → 新建 Agent
2. 填写基本信息（ID, 名称, 描述）
3. 配置模型：
   - 主模型：`claude-sonnet-4-5-20250929`
   - 备用模型：`claude-haiku-4-5-20251001`
   - 温度：`0.8`
   - 最大 Tokens：`100000`
   - 思考模式：`adaptive`
   - 思考力度：`high`
4. 保存
5. **验证**：
   - 在 Agent 详情中看到正确的模型配置
   - 查看配置文件（`~/.xuanji/agents/xxx.json5`）包含完整配置

### 测试 2：编辑内置 Agent（通过复制）

1. 打开 Agent 库 → 选择内置 Agent（如 `xuanji`）
2. 点击"复制"
3. 修改 ID 和名称
4. 修改模型配置
5. 保存
6. **验证**：新 Agent 使用了自定义的模型配置

### 测试 3：查看内置 Agent 配置

1. 打开 Agent 库 → 选择任意内置 Agent
2. 查看"模型配置"区域
3. **验证**：显示了内置 Agent 的模型配置（如 `xuanji.json5` 中的配置）

---

## 配置文件示例

创建的 Agent 配置文件（`~/.xuanji/agents/my-coder.json5`）：

```json5
{
  id: 'my-coder',
  name: '我的编程助手',
  description: '专注于代码编写的助手',

  model: {
    primary: 'claude-sonnet-4-5-20250929',
    fallback: 'claude-haiku-4-5-20251001',
    temperature: 0.8,
    maxTokens: 100000,
    thinking: {
      type: 'adaptive',
      effort: 'high',
    }
  },

  // ... 其他配置
}
```

---

## 总结

✅ **阶段 1 完成**：GUI 完整支持 Agent 独立模型配置的编辑和保存

📋 **配置持久化**：所有配置保存到 JSON5/YAML 文件

⏸️ **运行时暂不使用**：Agent 运行时仍使用全局 provider（符合你的需求）

🚀 **为未来做好准备**：类型定义和 GUI 已完善，未来实现阶段 2 时只需修改后端逻辑
