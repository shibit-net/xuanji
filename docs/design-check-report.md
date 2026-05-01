# complete-workflow-design.md 设计要求检查

## 你的设计要求

### 1. 用户输入 → 意图分析 → 主 Agent
✅ **满足**
- 第 2.1 节：意图分析阶段（IntentClassifier 三层降级）
- 输出包含：intent, domain, complexity, suggestedAgent, confidence
- 传递给主 Agent 作为参考

### 2. 主 Agent 动态查询和组合
✅ **满足**
- 第 2.2 节：主 Agent 决策阶段
- Step 1: 动态查询（list_agents, list_scenes）
- Step 2: 分析任务需求
- Step 3: 匹配 Agent 和 Scene（match_agent）
- Step 4: 执行计划（单一 Agent / Agent Team）

### 3. 示例：设计用户登录功能
✅ **满足**
- 第 2.3 节：完整示例
- 意图分析 → 主 Agent 决策 → 任务分解 → 匹配 Agent → 创建临时 Agent → 执行
- 包含 4 个阶段：需求分析（PM）→ 代码实现（Engineer）→ 测试（Engineer）→ 文档（临时 Agent）

### 4. 临时 Agent 创建
✅ **满足**
- 第 4 节：临时 Agent 创建机制
- 何时创建（score < 0.5）
- 临时 Agent 的组成
- System Prompt 生成
- 临时 Scene 创建
- 生命周期管理

### 5. Prompt 拆分和复用
✅ **满足**
- 第 3 节：Prompt 组合机制
- 各层职责划分（Agent, L0, L1, L2, L3）
- 组合示例（3个示例）
- 可复用性分析

## 检查结果

### ✅ 完全满足的部分

1. **整体架构清晰**
   - 用户输入 → 意图分析 → 主 Agent → 动态查询 → 执行 → 汇总
   - 流程完整，逻辑清晰

2. **动态发现机制**
   - 使用 list_agents 查询可用 Agent
   - 使用 list_scenes 查询可用 Scene
   - 使用 match_agent 动态匹配
   - 无硬编码

3. **临时 Agent 创建**
   - 详细的创建机制
   - System Prompt 生成函数
   - 临时 Scene 创建
   - 生命周期管理

4. **Prompt 层级划分**
   - Agent: 角色身份
   - L0: 系统规则
   - L1: 场景指导
   - L2: 协作规则
   - L3: 项目上下文
   - 每层职责清晰，可复用

5. **完整示例**
   - 用户登录功能的完整流程
   - 4 个阶段的详细说明
   - Prompt 组合详情

### ⚠️ 可以改进的部分

#### 1. 意图分析的输出格式

**当前**：
```typescript
{
  intent: "code_implementation",
  domain: "software_development",
  complexity: "complex",
  suggestedAgent: "software-engineer",  // ❌ 硬编码
  confidence: 0.85
}
```

**问题**：`suggestedAgent` 字段硬编码了 Agent 名称

**建议改进**：
```typescript
{
  intent: "code_implementation",
  domain: "software_development",
  complexity: "complex",
  suggestedCapabilities: ["代码编写", "API设计"],  // ✅ 改为能力列表
  confidence: 0.85
}
```

#### 2. 示例代码中的硬编码

**问题位置**：
- 第 160 行：`// 返回：software-engineer, product-manager, ui-designer`
- 第 200 行：`// 匹配到：product-manager (score: 0.85)`
- 第 207 行：`// 匹配到：software-engineer (score: 0.92)`
- 第 254 行：`{ agent: "product-manager", scene: "l1-requirement" }`

**建议改进**：
```typescript
// ✅ 改为通用描述
const agents = await list_agents();
// 返回：[{ id: "agent-1", capabilities: [...] }, ...]

const pm = await match_agent({
  requiredCapabilities: ["需求分析", "用户研究"]
});
// 匹配到：{ agent_id: "agent-1", score: 0.85 }

const result = await agent_team({
  mode: "sequential",
  agents: [
    { agent: pm.agent_id, scene: "l1-requirement" },  // ✅ 使用匹配结果
    { agent: engineer.agent_id, scene: "l1-write-code" },
    ...
  ]
});
```

#### 3. L2 Prompt 示例中的硬编码

**问题位置**：
- 第 432 行：`PM (需求分析) → Engineer (代码实现) → Tester (测试) → Writer (文档)`

**建议改进**：
```yaml
## 示例：Sequential 模式
```
Agent-1 (需求分析) → Agent-2 (代码实现) → Agent-3 (测试) → Agent-4 (文档)
```

或者：
```
需求分析 Agent → 代码实现 Agent → 测试 Agent → 文档编写 Agent
```

#### 4. 缺少主 Agent 的 System Prompt 示例

**当前**：文档中有 software-engineer, product-manager 的 systemPrompt 示例，但缺少主 Agent (xuanji) 的示例

**建议添加**：
```yaml
# xuanji.yaml (主 Agent)
systemPrompt: |
  你是 Xuanji，一个智能协作系统，负责理解用户需求并协调专业 Agent 完成任务。
  
  ## 核心职责
  1. 任务分析：理解意图、识别场景、评估复杂度
  2. Agent 发现与匹配：使用 list_agents, match_agent 动态查询
  3. 任务执行决策：直接回答 / 委派单个 Agent / 协调多个 Agent
  4. 结果汇总：整合结果，统一回复
  
  ## 工作原则
  1. 动态发现：始终使用工具查询，不硬编码
  2. 效率优先：简单问题直接回答
  3. 精准匹配：使用 match_agent 找最合适的 Agent
  4. 清晰沟通：传递清晰的任务描述和上下文
  5. 结果导向：关注任务完成
  6. 用户友好：用统一口吻回复，隐藏内部协调细节
```

#### 5. 缺少 L2 Prompt 的加载时机说明

**当前**：说明了 L2 是"复杂任务层"，但没有明确说明何时加载

**建议添加**：
```markdown
### L2 Prompt 加载时机

**何时加载**：
- 主 Agent 使用 agent_team 工具时
- 任务需要多个 Agent 协作时
- 任务复杂度为 "complex" 时

**何时不加载**：
- 单一 Agent 执行任务时
- 简单任务（直接回答）时
- 标准任务（单个 Agent 可完成）时
```

## 总体评价

### ✅ 优点

1. **架构完整**：从意图分析到执行汇总，流程完整
2. **动态发现**：核心原则贯彻始终
3. **层次清晰**：Prompt 5 层划分职责明确
4. **示例丰富**：用户登录功能的完整示例
5. **可复用性强**：各层独立，可自由组合

### ⚠️ 需要改进

1. **移除示例中的硬编码**：将所有示例代码中的具体 Agent 名称改为通用描述
2. **添加主 Agent 示例**：补充主 Agent 的 systemPrompt 示例
3. **明确加载时机**：说明 L2 Prompt 的加载条件
4. **意图分析输出**：将 `suggestedAgent` 改为 `suggestedCapabilities`

## 修改建议

### 1. 修改意图分析输出（第 30-39 行）

```typescript
// ❌ 旧版本
{
  intent: "code_implementation",
  domain: "software_development",
  complexity: "complex",
  suggestedAgent: "software-engineer",  // 硬编码
  confidence: 0.85
}

// ✅ 新版本
{
  intent: "code_implementation",
  domain: "software_development",
  complexity: "complex",
  suggestedCapabilities: ["代码编写", "API设计", "测试编写"],  // 能力列表
  confidence: 0.85
}
```

### 2. 修改示例代码（第 160-264 行）

将所有具体的 Agent 名称（software-engineer, product-manager, ui-designer）改为：
- `agent-1`, `agent-2`, `agent-3` 或
- `匹配到的 Agent`, `需求分析 Agent`, `代码实现 Agent`

### 3. 添加主 Agent 示例（第 274-298 行之前）

在 "Agent System Prompt（角色身份层）" 部分添加主 Agent 的示例。

### 4. 添加 L2 加载时机说明（第 397-440 行）

在 "L2 Prompt（复杂任务层）" 部分添加加载时机的说明。

## 结论

**总体评分**：85/100

**满足设计要求**：✅ 是的，基本满足所有设计要求

**主要问题**：示例代码中仍有硬编码的 Agent 名称，需要改为通用描述

**建议**：
1. 立即修复：移除示例中的硬编码
2. 补充内容：添加主 Agent 示例和 L2 加载时机
3. 优化格式：统一使用通用描述而不是具体名称

---

**检查日期**：2026-04-23  
**检查人**：Claude  
**状态**：基本满足，需要小幅改进
