# 智能记忆系统 V2 — 使用指南

## 概述

**智能记忆 V2** 是 Xuanji 的 LLM 主动决策记忆系统，实现了从"规则驱动提取"到"智能决策存储"的升级。

### 核心能力

- 🤖 **主动决策**：LLM 自主判断哪些值得记忆，而非被动执行规则
- 🔍 **上下文感知**：检索已有记忆，避免重复存储
- 🎯 **智能去重**：自动检测重复/冲突，决定新增/更新/合并
- 📊 **优先级管理**：critical/high/normal/low，容量接近上限时自动筛选
- 🔗 **自动关联**：important_date 自动触发提醒创建

##  V1 vs V2 对比

| 维度 | V1 (规则驱动) | V2 (LLM 决策) |
|------|---------------|--------------|
| 决策方式 | 固定规则（Prompt 中写死） | LLM 主动判断 |
| 去重能力 | ❌ 无（可能重复存储） | ✅ 自动检测并合并 |
| 优先级 | ❌ 无（所有同等重要） | ✅ critical/high/normal/low |
| 容量管理 | ❌ 无（超限后FIFO） | ✅ 优先保留高价值记忆 |
| 上下文感知 | ❌ 不知道已有记忆 | ✅ 检索相关记忆再决策 |
| 更新/合并 | ❌ 只能新增 | ✅ 支持 update/merge |

**示例对比**：

```
用户说："Alice 特别喜欢寿司和刺身"
已有记忆："Alice loves Japanese cuisine"

V1 行为：
  → 创建新记忆："Alice 特别喜欢寿司和刺身"
  → 结果：重复存储，占用空间

V2 行为：
  → 检测到已有记忆
  → 决策：merge（相似度 > 80%）
  → 结果："Alice loves Japanese cuisine, especially sushi and sashimi"
```

## 使用方法

### 1. 启用智能记忆 V2

在配置文件 `.xuanji.yaml` 中启用：

```yaml
features:
  smartMemoryV2: true  # 启用 LLM 主动决策记忆

memory:
  enabled: true
  longTermMaxEntries: 1000  # 记忆上限
  
  # 提取器配置（V2 使用轻量模型）
  extractorModel: null  # 使用默认轻量模型（推荐）
  extractorTemperature: 0.3  # 决策保守度
  extractorTimeout: 60000
  extractorMinConfidence: 0.6
```

### 2. V2 工作流程

```
会话结束 → 触发记忆提取
             ↓
        1. 获取已有相关记忆（向量检索）
             ↓
        2. LLM 决策（create/update/merge/skip）
             ↓
        3. 执行决策（去重/合并/优先级过滤）
             ↓
        4. 保存到长期记忆
```

### 3. 决策示例

#### 示例 1: 新增记忆

**会话**：
```
User: 我不吃辣，但微辣可以接受
Assistant: 好的，记住了
```

**V2 决策**：
```json
{
  "action": "create",
  "type": "user_preference",
  "content": "Cannot eat spicy food, but can accept mildly spicy dishes",
  "keywords": ["food", "spicy", "preference", "tolerance"],
  "confidence": 0.95,
  "priority": "high",
  "reason": "用户明确表达饮食偏好，对餐厅推荐有长期价值"
}
```

#### 示例 2: 更新记忆

**会话**：
```
User: 之前说我不吃辣，但其实现在可以吃微辣了
Assistant: 好的，更新了你的偏好
```

**已有记忆**：
```
[mem_001] Cannot eat spicy food
```

**V2 决策**：
```json
{
  "action": "update",
  "type": "user_preference",
  "content": "Can now eat mildly spicy food",
  "confidence": 0.98,
  "priority": "high",
  "reason": "用户主动纠正偏好，必须更新已有记忆",
  "relatedMemoryId": "mem_001"
}
```

#### 示例 3: 合并记忆

**会话**：
```
User: Alice 特别喜欢寿司和刺身
Assistant: 记住了
```

**已有记忆**：
```
[mem_002] Alice loves Japanese cuisine
```

**V2 决策**：
```json
{
  "action": "merge",
  "type": "relationship",
  "confidence": 0.95,
  "priority": "critical",
  "reason": "新信息是已有记忆的细化，合并更准确",
  "relatedMemoryId": "mem_002",
  "mergedContent": "Alice loves Japanese cuisine, especially sushi and sashimi"
}
```

#### 示例 4: 跳过无价值

**会话**：
```
User: 帮我格式化这段代码
Assistant: (使用 edit_file 格式化)
User: 谢谢
Assistant: 不客气
```

**V2 决策**：
```json
{
  "action": "skip",
  "type": null,
  "priority": "low",
  "reason": "纯工具操作，无长期价值信息，问候语无需记忆"
}
```

## 优先级策略

### 优先级分类

| 优先级 | 说明 | 示例 |
|--------|------|------|
| `critical` | 重要日期、关系维护、核心偏好 | "Alice 的生日是 3 月 8 号" |
| `high` | 用户决策、新偏好、工具模式 | "决定用 TypeScript 重构项目" |
| `normal` | 项目事实、会话摘要 | "使用 MySQL 数据库" |
| `low` | 临时信息（可能跳过） | 一次性请求、格式化操作 |

### 容量管理

当记忆使用率 > 80%：

```yaml
使用率 81-90%:
  → 只存储 critical/high
  → 跳过 normal/low

使用率 91-100%:
  → 只存储 critical
  → 跳过 high/normal/low

超过上限:
  → 淘汰最旧的 low/normal 记忆
  → 保留 critical/high
```

## 自动关联功能

### Important Date → 提醒

当提取到 `important_date` 类型记忆时，自动创建提醒：

```typescript
记忆："Alice's birthday is March 8th"
↓
自动触发：reminder_set({
  content: "Alice 的生日 — 准备礼物",
  triggerDate: "2026-03-06",  // 提前 2 天
  recurring: "yearly"
})
```

### Relationship → 关系维护

当更新 `relationship` 类型记忆时，检查是否需要关系维护提醒（60天+未联系）。

## 配置参考

### 最小配置

```yaml
features:
  smartMemoryV2: true
```

### 完整配置

```yaml
features:
  smartMemoryV2: true  # 启用 V2

memory:
  enabled: true
  
  # 容量配置
  shortTermMaxEntries: 100  # 短期记忆上限
  longTermMaxEntries: 1000  # 长期记忆上限
  
  # 检索配置
  retrieveMaxResults: 10  # 检索时返回最多 N 条
  
  # 提取器配置（V2 专用）
  extractorModel: null  # 使用默认轻量模型
  extractorTemperature: 0.3  # 决策保守度（0-1）
  extractorTimeout: 60000  # 超时时间（ms）
  extractorMinConfidence: 0.6  # 最小置信度阈值
  
  # 压缩配置
  compactionThreshold: 500  # 超过 N 条触发压缩
  decayHalfLifeDays: 30  # 记忆衰减半衰期（天）
```

## 性能和成本

### Token 消耗

| 阶段 | Token 消耗 | 说明 |
|------|-----------|------|
| 上下文检索 | 0 | 本地向量检索，无 API 调用 |
| LLM 决策 | 500-800 tokens/次 | 会话内容 + 已有记忆 + 决策 |
| 平均成本 | < $0.001/会话 | 使用轻量模型（Claude Haiku） |

### 与 V1 对比

- **V1**: ~300 tokens/会话
- **V2**: ~700 tokens/会话（+133%）
- **但**: 避免重复存储，长期更省空间和检索成本

## 故障排查

### 问题 1: V2 未生效

检查配置：
```bash
cat .xuanji.yaml | grep smartMemoryV2
# 应输出：smartMemoryV2: true
```

查看日志：
```bash
tail -f ~/.xuanji/logs/$(date +%Y-%m-%d).log | grep -i "smart"
# 应看到：SmartMemoryExtractorV2 initialized (LLM autonomous decision mode)
```

### 问题 2: 记忆重复

V2 应该自动去重。如果仍然重复，可能是：
1. 向量检索未启用（降级到关键词检索，精度较低）
2. 相似度阈值过低（调整 LLM 决策 Prompt）

解决：
```yaml
memory:
  # 确保向量检索就绪
  enabled: true
```

### 问题 3: 重要信息被跳过

查看决策理由：
```bash
# 查看最近的决策日志
grep "Skipped:" ~/.xuanji/logs/$(date +%Y-%m-%d).log
```

可能原因：
1. 容量接近上限，优先级为 low/normal 被过滤
2. LLM 误判为无价值信息

解决：
- 扩大容量上限：`longTermMaxEntries: 2000`
- 调整温度：`extractorTemperature: 0.4`（更激进）

## 最佳实践

### 1. 首次启用

建议逐步迁移：
```yaml
# 第 1 周：V1 模式，观察效果
features:
  smartMemoryV2: false

# 第 2 周：启用 V2，对比差异
features:
  smartMemoryV2: true

# 对比指标：
# - 记忆数量变化
# - 重复记忆数量
# - 检索精度
```

### 2. 容量规划

根据使用频率设置：
```yaml
# 轻度使用（每天 < 10 会话）
longTermMaxEntries: 500

# 中度使用（每天 10-50 会话）
longTermMaxEntries: 1000

# 重度使用（每天 > 50 会话）
longTermMaxEntries: 2000
```

### 3. 成本控制

V2 使用轻量模型，但仍有成本：
```yaml
# 成本估算：
# - 每会话：~700 tokens
# - 每天 30 会话：21,000 tokens
# - 每月成本（Claude Haiku）：< $0.5
```

如果成本敏感：
- 降低提取频率（不是每次会话都提取）
- 使用更便宜的模型
- 回退到 V1

## 未来规划

- [ ] Update/Merge 操作完整实现（当前仅 create）
- [ ] 记忆版本管理（追踪更新历史）
- [ ] 用户反馈学习（根据使用情况调整策略）
- [ ] 记忆重要性动态调整（根据访问频率）
- [ ] 自动压缩低价值记忆

## 常见问题

**Q: V2 会比 V1 慢吗？**

A: 是的，V2 需要额外的 LLM 调用（~2-3秒），但提取质量更高，长期节省存储和检索成本。

**Q: V2 可以和 V1 共存吗？**

A: 可以。配置 `smartMemoryV2: false` 使用 V1，`true` 使用 V2。两者数据格式兼容。

**Q: 如何查看 V2 的决策理由？**

A: 查看日志：
```bash
grep "Decision summary" ~/.xuanji/logs/$(date +%Y-%m-%d).log
```

**Q: V2 支持哪些记忆类型？**

A: 与 V1 相同：
- user_preference, user_fact, relationship
- important_date, decision, tool_pattern
- error_resolution, project_fact, session_summary

**Q: V2 如何处理冲突记忆？**

A: LLM 自主决策：
- 用户明确纠正 → update（置信度提升）
- 相似内容 → merge（合并为更完整的描述）
- 完全矛盾 → update（新的覆盖旧的）

**Q: 容量上限是硬限制吗？**

A: 软限制。超过上限后，V2 会淘汰低优先级记忆，保留高价值记忆。
