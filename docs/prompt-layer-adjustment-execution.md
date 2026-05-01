# Prompt 层级调整 - 执行记录

## 调整内容

将 `l2-planning.yaml` 移动到 L0 层，重命名为 `l0-task-planning.yaml`。

## 调整原因

### 问题
`l2-planning.yaml` 的内容（任务规划与确认）放在 L2 层不合适，因为：
1. 任务规划是**基础能力**，不是特定场景或高级协调
2. 不仅主 agent 需要规划能力，**所有 agent** 都需要
3. L2 层应该是高级协调规则，而不是基础规划能力

### 解决方案
将其移到 **L0 层**，作为所有 agent 的基础能力。

## 层级定位

### L0 层（基础规则层）
- **适用范围**：所有 agent（主 agent、子 agent、专业 agent）
- **内容**：基础能力、通用规则、安全规范
- **文件**：
  - `l0-base-identity.yaml` - 基础身份定义
  - `l0-base-task-execution.yaml` - 任务执行原则
  - `l0-task-planning.yaml` - 任务规划与执行（新增）
  - `l0-safety.yaml` - 基础安全规则

### L1 层（场景指导层）
- **适用范围**：特定场景（explore、plan、debug 等）
- **内容**：场景化的思维方式、工作流程、输出格式
- **文件**：
  - `l1-explore.yaml` - 代码探索场景
  - `l1-plan.yaml` - 方案规划场景
  - `l1-debug.yaml` - 调试场景
  - `l1-test.yaml` - 测试场景
  - 等等...

### L2 层（高级协调层）
- **适用范围**：特定领域或复杂协调场景
- **内容**：高级协调规则、领域特定规则
- **文件**：
  - `l2-agent-rules.yaml` - agent 协调规则
  - `l2-coding-coordination.yaml` - 编程协调规则
  - `l2-team-coordination.yaml` - 团队协调规则
  - `l2-financial-analysis.yaml` - 金融分析规则
  - `l2-safety.yaml` - 扩展安全规则

## 调整细节

### 文件变更
- **旧文件**：`src/core/templates/prompts/l2-planning.yaml`
- **新文件**：`src/core/templates/prompts/l0-task-planning.yaml`

### 元数据变更
```yaml
# 旧
id: "l2-planning"
name: "Task Planning & Confirmation"
layer: "L2"
priority: 80
estimatedTokens: 500

# 新
id: "l0-task-planning"
name: "Task Planning & Execution"
layer: "L0"
priority: 85
estimatedTokens: 400
```

### 内容变更
- 标题：`任务规划与确认` → `任务规划与执行`
- 开头：`作为协调者，复杂任务需要先规划、再执行` → `处理复杂任务时，先规划、再执行`
- 去掉了"协调者"的角色限定，因为所有 agent 都可能需要规划

## 优势

### 1. 通用能力
所有 agent 都具备任务规划能力，不仅是主 agent：
- 主 agent 协调多个子 agent 时需要规划
- 子 agent 处理复杂子任务时也需要规划
- 专业 agent（如 software-engineer）处理复杂开发任务时需要规划

### 2. 一致性
所有 agent 使用相同的规划方法：
- 相同的复杂度判断标准（简单/中等/复杂）
- 相同的规划工作流（分析、分解、创建 todo、确认、执行）
- 相同的确认机制（plan_review、ask_user）

### 3. 可复用
避免在每个 agent 的 prompt 中重复相同的规划逻辑：
- L0 层统一定义，所有 agent 自动继承
- 修改规划逻辑时只需修改一个文件
- 保持所有 agent 的行为一致

### 4. 分层清晰
明确的层级职责：
- **L0**：基础能力（任务执行、任务规划、安全规则）
- **L1**：场景指导（探索、规划、调试、测试等）
- **L2**：高级协调（多 agent 协调、领域特定规则）

## 影响范围

### 受益的 agent
所有 agent 都会加载 L0 层的 prompt，因此都会获得任务规划能力：

1. **主 agent（xuanji）**
   - 协调多个子 agent 时使用规划能力
   - 处理复杂用户请求时使用规划能力

2. **专业 agent（software-engineer、product-manager 等）**
   - 处理复杂开发任务时使用规划能力
   - 多步骤任务时创建 todo 跟踪进度

3. **子 agent（通过 task 创建的临时 agent）**
   - 处理复杂子任务时使用规划能力
   - 需要用户确认时使用 plan_review

### 加载顺序
```
L0 层（基础规则）
  ↓
L1 层（场景指导，如果匹配）
  ↓
L2 层（高级协调，如果匹配）
  ↓
Agent 自身的 systemPrompt
```

所有 agent 都会先加载 L0 层，因此都具备基础的任务规划能力。

## 后续优化建议

### 1. 检查其他 L2 文件
建议检查其他 L2 文件的定位是否合适：
- `l2-agent-rules.yaml` - 是否应该移到 L0？
- `l2-safety.yaml` - 是否应该移到 L0？
- `l2-coding-coordination.yaml` - 是否真的是高级协调？

### 2. 统一 L0 层的风格
确保所有 L0 层的 prompt 风格一致：
- 都是基础能力的定义
- 都适用于所有 agent
- 都是通用规则，不涉及特定场景

### 3. 文档更新
更新相关文档，说明新的层级定位：
- Prompt 层级说明文档
- Agent 开发指南
- 场景 Prompt 编写指南

## 总结

将任务规划能力从 L2 移到 L0 是一个正确的决策，因为：
1. **任务规划是基础能力**，不是高级协调
2. **所有 agent 都需要**，不仅是主 agent
3. **保持行为一致**，避免重复定义
4. **分层更清晰**，职责更明确

这个调整让 prompt 层级的设计更加合理和清晰。
