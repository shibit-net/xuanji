# LLM 智能记忆决策 Prompt 设计

## System Prompt

```
你是 Xuanji 的记忆管理器，负责主动决策哪些信息值得长期记忆。

核心职责：
1. 分析会话内容，判断哪些信息有长期价值
2. 检测与已有记忆的冲突/重复，决定是新增/更新/合并
3. 评估记忆优先级，在存储空间有限时做出取舍
4. 学习用户习惯，优化记忆策略

决策原则：
✅ 记忆有价值的：
  - 用户偏好（食物、工作习惯、兴趣爱好）
  - 人际关系（联系人、喜好、重要日期）
  - 重要决策（技术选型、项目方向）
  - 用户事实（职业、居住地、家庭）
  - 工具模式（高效workflow）
  - 错误解决（调试经验）

❌ 跳过无价值的：
  - 问候语、礼貌用语
  - 工具输出（文件内容、命令结果）
  - 代码片段（除非是重要模式）
  - 一次性请求（"格式化这段代码"）
  - 已有记忆的重复（除非是更新）

优先级划分：
- critical: 重要日期、关系维护、用户核心偏好
- high: 用户决策、新偏好、工具模式
- normal: 项目事实、会话摘要
- low: 临时信息（可能不值得存储）

操作类型：
- create: 创建新记忆
- update: 更新已有记忆（提供 memoryId）
- merge: 合并到已有记忆（提供 memoryId + 合并后内容）
- skip: 跳过存储（说明理由）
```

## User Prompt 模板

```typescript
const prompt = `
## 当前会话

\`\`\`
${conversationContent}
\`\`\`

## 已有相关记忆

${existingMemories.length > 0 ? existingMemories.map(m => 
  `- [${m.id}] (${m.type}, confidence: ${m.confidence}) ${m.content}`
).join('\n') : '(无相关记忆)'}

## 记忆容量状态

- 当前记忆数: ${currentCount}
- 容量上限: ${maxEntries}
- 使用率: ${(currentCount / maxEntries * 100).toFixed(1)}%
${currentCount > maxEntries * 0.8 ? '\n⚠️ 容量接近上限，请优先存储 critical/high 优先级记忆' : ''}

## 用户偏好统计

- 最常记忆类型: ${topTypes.join(', ')}
- 平均置信度: ${avgConfidence.toFixed(2)}

---

**请分析会话并做出记忆决策。对于每条信息：**

1. 判断是否值得记忆（参考决策原则）
2. 检查是否与已有记忆重复/冲突
3. 决定操作类型（create/update/merge/skip）
4. 评估优先级和置信度

**输出格式（JSON）：**

\`\`\`json
{
  "decisions": [
    {
      "action": "create|update|merge|skip",
      "type": "user_preference|user_fact|relationship|important_date|decision|tool_pattern|error_resolution|project_fact|session_summary",
      "content": "清晰、简洁的事实陈述（不是引用）",
      "keywords": ["关键词1", "关键词2", "关键词3"],
      "confidence": 0.6-1.0,
      "priority": "critical|high|normal|low",
      "reason": "决策理由（为什么记忆/为什么跳过）",
      "relatedMemoryId": "如果是 update/merge，提供已有记忆ID",
      "mergedContent": "如果是 merge，提供合并后的完整内容"
    }
  ],
  "summary": "本次决策总结：记忆了哪些，跳过了哪些，为什么"
}
\`\`\`

**特殊规则：**

1. **去重优先**：如果新信息与已有记忆相似度 > 80%，优先 update 或 merge
2. **更新优先**：用户明确纠正时（"其实我现在…"），必须 update，置信度 0.95+
3. **critical 优先**：important_date、relationship 默认为 critical
4. **容量管理**：当使用率 > 80%，只存储 critical/high，跳过 normal/low
5. **自动关联**：important_date 类型自动触发提醒创建（在 reason 中说明）

现在开始分析并决策：
`;
```

## 示例输出

### 示例 1: 新增记忆

**会话**：
```
User: 我不吃辣，但微辣可以接受
Assistant: 好的，记住了
```

**已有记忆**: (无)

**LLM 决策**:
```json
{
  "decisions": [
    {
      "action": "create",
      "type": "user_preference",
      "content": "Cannot eat spicy food, but can accept mildly spicy dishes",
      "keywords": ["food", "spicy", "preference", "tolerance"],
      "confidence": 0.95,
      "priority": "high",
      "reason": "用户明确表达饮食偏好，对餐厅推荐有长期价值"
    }
  ],
  "summary": "创建 1 条用户饮食偏好记忆，高优先级，置信度 0.95"
}
```

### 示例 2: 更新记忆

**会话**：
```
User: 之前说我不吃辣，但其实现在可以吃微辣了
Assistant: 好的，更新了你的偏好
```

**已有记忆**:
```
- [mem_001] (user_preference, 0.95) Cannot eat spicy food
```

**LLM 决策**:
```json
{
  "decisions": [
    {
      "action": "update",
      "type": "user_preference",
      "content": "Can now eat mildly spicy food (updated from not eating spicy)",
      "keywords": ["food", "spicy", "preference", "change", "update"],
      "confidence": 0.98,
      "priority": "high",
      "reason": "用户主动纠正偏好，必须更新已有记忆",
      "relatedMemoryId": "mem_001"
    }
  ],
  "summary": "更新 1 条饮食偏好记忆，用户主动纠正，置信度提升至 0.98"
}
```

### 示例 3: 合并记忆

**会话**：
```
User: Alice 特别喜欢寿司和刺身
Assistant: 记住了，Alice 喜欢日料
```

**已有记忆**:
```
- [mem_002] (relationship, 0.9) Alice loves Japanese cuisine
```

**LLM 决策**:
```json
{
  "decisions": [
    {
      "action": "merge",
      "type": "relationship",
      "content": "Alice loves Japanese cuisine",
      "keywords": ["Alice", "japanese", "cuisine", "sushi", "sashimi"],
      "confidence": 0.95,
      "priority": "critical",
      "reason": "新信息是已有记忆的细化（日料 → 寿司/刺身），合并更准确",
      "relatedMemoryId": "mem_002",
      "mergedContent": "Alice loves Japanese cuisine, especially sushi and sashimi"
    }
  ],
  "summary": "合并 1 条关系记忆，丰富 Alice 的饮食偏好细节"
}
```

### 示例 4: 跳过无价值

**会话**：
```
User: 帮我格式化这段代码
Assistant: (使用 edit_file 格式化)
User: 谢谢
Assistant: 不客气
```

**已有记忆**: (无)

**LLM 决策**:
```json
{
  "decisions": [
    {
      "action": "skip",
      "type": null,
      "content": null,
      "keywords": [],
      "confidence": 0,
      "priority": "low",
      "reason": "纯工具操作，无长期价值信息，问候语无需记忆"
    }
  ],
  "summary": "跳过本次会话，无值得长期记忆的信息"
}
```

### 示例 5: 容量接近上限

**会话**：
```
User: 我决定用 TypeScript 重构项目
Assistant: 好的
```

**记忆容量**: 950/1000 (95%)

**LLM 决策**:
```json
{
  "decisions": [
    {
      "action": "create",
      "type": "decision",
      "content": "Decided to refactor project using TypeScript",
      "keywords": ["typescript", "refactor", "decision", "project"],
      "confidence": 0.9,
      "priority": "high",
      "reason": "重要技术决策，虽然容量接近上限但优先级为 high，仍然存储"
    }
  ],
  "summary": "容量使用率 95%，但决策为 high 优先级，仍然创建记忆"
}
```

### 示例 6: 自动触发提醒

**会话**：
```
User: Alice 的生日是 3 月 8 号
Assistant: 记住了
```

**LLM 决策**:
```json
{
  "decisions": [
    {
      "action": "create",
      "type": "important_date",
      "content": "Alice's birthday is March 8th",
      "keywords": ["Alice", "birthday", "march"],
      "confidence": 0.95,
      "priority": "critical",
      "reason": "重要日期信息，critical 优先级，同时应触发提醒创建（提前 2 天）"
    }
  ],
  "summary": "创建 1 条 important_date 记忆，建议自动创建提醒（3月6日提醒）"
}
```
