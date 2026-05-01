# Prompt 精简优化总结

## 已完成的优化

### 1. 工具 Description

#### TaskTool
- **精简前**：~120 行
- **精简后**：~15 行
- **减少**：88%
- **文件**：`src/core/tools/TaskTool.ts`

#### MatchAgentTool
- **精简前**：~100 行
- **精简后**：~7 行
- **减少**：93%
- **文件**：`src/core/tools/MatchAgentTool.ts`

### 2. MainAgent System Prompt

- **精简前**：191 行
- **精简后**：70 行
- **减少**：63%
- **文件**：`src/core/agent/dispatch/MainAgent.ts`

**保留的关键信息**：
- 意图分析结果的三个字段（scene、agent、complexity）
- 三种情况的决策规则
- 0.5 分数线
- 临时 agent 创建要求
- description vs system_prompt 区别
- stream_to_user 使用场景
- 引用标记格式
- 协作策略类型
- 错误处理原则

### 3. Xuanji Agent Prompt

- **精简前**：121 行
- **精简后**：27 行
- **减少**：78%
- **文件**：`src/core/templates/agents/xuanji.yaml`

### 4. Software Engineer Agent Prompt

- **精简前**：21 行
- **精简后**：13 行
- **减少**：38%
- **文件**：`src/core/templates/agents/software-engineer.yaml`

## 精简原则总结

### 核心原则
1. **少而精**：不让过多信息误导 LLM
2. **足够精确**：核心信息清晰明确
3. **通用示例**：使用占位符而不是具体内容
4. **保留关键**：所有决策点、流程步骤、重要规则必须保留

### 精简技巧
1. 合并重复信息
2. 删除过多的示例说明
3. 精简章节标题
4. 删除详细的步骤说明
5. 合并相似内容
6. 删除冗余的背景说明

### 不能删除的内容
- 决策点（如 0.5 分数线）
- 关键流程步骤
- 重要规则和原则
- 核心概念的定义
- 必要的示例（通用化后保留）

## 待优化的文件

### Agent 配置
- [ ] stock-analyst.yaml
- [ ] product-manager.yaml
- [ ] ui-designer.yaml
- [ ] scene-classifier.yaml

### 场景 Prompt（L0 层）
- [ ] l0-base-task-execution.yaml
- [ ] l0-safety.yaml

### 场景 Prompt（L1 层）
- [ ] l1-explore.yaml
- [ ] l1-plan.yaml
- [ ] l1-debug.yaml
- [ ] l1-test.yaml
- [ ] l1-review.yaml
- [ ] l1-monitor.yaml
- [ ] l1-interaction.yaml
- [ ] l1-product-plan.yaml
- [ ] l1-stock-analysis.yaml

### 场景 Prompt（L2 层）
- [ ] l2-planning.yaml
- [ ] l2-safety.yaml
- [ ] l2-financial-analysis.yaml

## 优化效果预估

### 当前进度
- 已优化：4 个文件
- 已减少：约 400 行
- 待优化：约 2300 行

### 预期效果
按照平均 60% 的精简率：
- 优化后总行数：约 1100 行
- 减少行数：约 1600 行
- 减少比例：约 59%

## 优化策略

### 批量优化
对于结构相似的文件（如 L1 场景 prompt），可以：
1. 先优化一个作为模板
2. 应用相同的精简规则到其他文件
3. 保持一致的结构和风格

### 质量保证
每个文件优化后需要确认：
1. 所有关键信息都保留
2. 决策点清晰
3. 流程完整
4. 示例通用
5. 语言精炼

## 下一步计划

1. 优化剩余的 agent 配置文件（4 个）
2. 优化 L0 层场景 prompt（2 个）
3. 优化 L1 层场景 prompt（9 个）
4. 优化 L2 层场景 prompt（3 个）
5. 验证所有优化后的文件
6. 更新相关文档

## 参考文档

- `tool-description-simplification.md` - 工具 description 精简原则
- `prompt-simplification-guide.md` - Prompt 精简指南
