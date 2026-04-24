# Prompt 配置问题和解决方案

## 问题

GUI 显示 17 个 prompt，但实际有 22 个 prompt 文件。

## 原因分析

1. **缺少 enabled 字段**：大部分 prompt 文件缺少 `enabled` 字段
   - L0 层：3/4 缺少（只有 l0-safety.yaml 有）
   - L1 层：15/15 全部缺少
   - L2 层：0/3 缺少（全部有）

2. **重复的 safety 配置**：
   - `l0-safety.yaml` - 基础安全规则（L0 层）
   - `l2-safety.yaml` - 扩展安全规则（L2 层）- 已删除

## 已完成的修复

1. ✅ 启用 `l0-safety.yaml`（改为 `enabled: true`）
2. ✅ 删除 `l2-safety.yaml`（重复的安全规则）

## 当前状态

### Prompt 文件统计
- **L0 层**：4 个
  - l0-base-identity.yaml（缺少 enabled）
  - l0-base-memory-guide.yaml（缺少 enabled）
  - l0-base-task-execution.yaml（缺少 enabled）
  - l0-safety.yaml（enabled: true）

- **L1 层**：15 个（全部缺少 enabled 字段）
  - l1-debug.yaml
  - l1-deploy.yaml
  - l1-design-system.yaml
  - l1-explore.yaml
  - l1-interaction.yaml
  - l1-monitor.yaml
  - l1-plan.yaml
  - l1-product-plan.yaml
  - l1-refactor.yaml
  - l1-requirement.yaml
  - l1-review.yaml
  - l1-test.yaml
  - l1-ui-design.yaml
  - l1-user-research.yaml
  - l1-write-code.yaml

- **L2 层**：3 个（全部有 enabled: true）
  - l2-agent-rules.yaml
  - l2-planning.yaml
  - l2-team-coordination.yaml

- **总计**：22 个 prompt

### GUI 显示问题

GUI 可能的过滤逻辑：
1. 过滤掉 L3 层（动态生成）
2. 过滤掉没有 `enabled` 字段的 prompt
3. 过滤掉 `enabled: false` 的 prompt

如果 GUI 将"缺少 enabled 字段"视为"禁用"，那么：
- 显示的 prompt = 有 enabled 字段的 = 1 (L0) + 0 (L1) + 3 (L2) = 4 个

但用户说看到 17 个，这意味着 GUI 可能：
- 将"缺少 enabled 字段"视为"启用"
- 但有其他过滤条件

## 建议的解决方案

### 方案 1：为所有 prompt 添加 enabled 字段

为所有缺少 `enabled` 字段的 prompt 添加 `enabled: true`：

```bash
# L0 层
for file in l0-base-identity.yaml l0-base-memory-guide.yaml l0-base-task-execution.yaml; do
  # 在 layer 行后添加 enabled: true
done

# L1 层
for file in l1-*.yaml; do
  # 在 layer 行后添加 enabled: true
done
```

### 方案 2：修改 GUI 的默认行为

修改 SystemPromptManager，将"缺少 enabled 字段"默认视为"启用"：

```typescript
const isEnabled = component.enabled !== false; // undefined 视为 true
```

### 方案 3：统一配置格式

在模板文件中统一添加 `enabled: true`，确保所有新创建的 prompt 都有这个字段。

## 推荐方案

**方案 1 + 方案 3**：
1. 为现有的所有 prompt 添加 `enabled: true`
2. 更新模板文件，确保新创建的 prompt 都有 `enabled` 字段
3. 这样可以保持配置的一致性和可预测性

---

**分析日期**：2026-04-23  
**状态**：待修复
