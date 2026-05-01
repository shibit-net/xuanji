# Prompt 层级调整建议

## 问题

`l2-planning.yaml` 的内容（任务规划与确认）放在 L2 层不太合适。

## 原因

### 当前层级定位

- **L0 层**：基础规则，适用于所有 agent（任务执行原则、安全规则）
- **L1 层**：场景化指导，针对特定场景（explore、plan、debug 等）
- **L2 层**：高级协调规则，针对特定领域或复杂场景

### l2-planning 的内容

- 何时需要规划（简单/中等/复杂任务）
- 规划工作流（分析、分解、创建 todo、确认、执行）
- 何时使用 plan_review
- 何时使用 ask_user
- 最佳实践

这些内容是**基础的任务协调规则**，应该适用于所有复杂任务，而不是特定场景。

## 调整方案

### 方案 1：整合到 MainAgent System Prompt（推荐）

将 `l2-planning` 的核心内容整合到 `MainAgent System Prompt` 中，作为主 agent 的基础协调规则。

**优点**：
- 主 agent 始终能看到这些规则
- 减少 prompt 层级的复杂度
- 更符合主 agent 的职责定位

**缺点**：
- MainAgent System Prompt 会稍微变长

### 方案 2：移到 L0 层

将 `l2-planning.yaml` 重命名为 `l0-task-planning.yaml`，作为 L0 层的基础规则。

**优点**：
- 保持 prompt 层级的清晰
- 所有 agent 都能看到这些规则
- 与 `l0-base-task-execution.yaml` 并列

**缺点**：
- L0 层文件增多
- 可能与 MainAgent System Prompt 有重复

### 方案 3：删除 l2-planning

将 `l2-planning` 的内容精简后，分散到：
- MainAgent System Prompt（核心规划流程）
- l0-base-task-execution.yaml（执行原则）
- 工具 description（plan_review、ask_user 的使用说明）

**优点**：
- 最大程度精简
- 信息放在最合适的位置
- 减少重复

**缺点**：
- 需要修改多个文件
- 可能导致信息分散

## 推荐方案

**方案 1：整合到 MainAgent System Prompt**

理由：
1. 任务规划是主 agent 的核心职责
2. 这些规则应该始终对主 agent 可见
3. 精简后的内容不会让 MainAgent Prompt 过长
4. 减少 prompt 层级的复杂度

## 实施步骤

1. 将 `l2-planning` 的核心内容（已精简到 48 行）整合到 MainAgent System Prompt
2. 删除 `l2-planning.yaml` 文件
3. 更新相关文档

## 整合后的 MainAgent System Prompt 结构

```
你是 Xuanji，智能协作系统，协调多个专业 agent 完成任务。

## 工作流程
- 意图分析结果
- 简单专业任务
- 简单通用任务
- 复杂任务

## 任务规划（新增）
- 何时需要规划
- 规划工作流
- 何时使用 plan_review
- 何时使用 ask_user
- 最佳实践

## 发现可用资源
## 匹配 Agent
## 创建临时 agent
## 分配 Scene
## 子 agent 输出处理
## 原则
## 工具层次
```

预计整合后的 MainAgent System Prompt：约 110-120 行（仍然比原来的 191 行少很多）

## 其他需要检查的文件

建议也检查一下其他 L2 文件的定位是否合适：
- `l2-agent-rules.yaml` - agent 协调规则
- `l2-coding-coordination.yaml` - 编程协调规则
- `l2-team-coordination.yaml` - 团队协调规则
- `l2-financial-analysis.yaml` - 金融分析规则
- `l2-safety.yaml` - 扩展安全规则

这些文件的定位可能也需要重新评估。
