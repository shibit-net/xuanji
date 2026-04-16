# 记忆系统增强设计方案

## 背景

用户要求记忆系统具备以下能力：
1. **成功案例提取为经验** — 可复用的解决方案模式
2. **未完成任务跟踪** — 会话中断后提醒用户是否继续
3. **经验自动转化为 Skill** — 高频经验升级为系统能力
4. **扩展功能** — 错误模式识别、工作流记忆、知识图谱等

---

## 方案 1：未完成任务跟踪

### 数据模型

**新增记忆类型** `src/memory/types.ts`：

```typescript
export type MemoryEntryType =
  | ...
  | 'unfinished_task';  // 新增

export interface MemoryMetadata {
  ...
  /** 对于 unfinished_task：关联的 sessionId */
  sessionId?: string;
  /** 对于 unfinished_task：用户是否已标记"不再提醒" */
  dismissed?: boolean;
  /** 对于 unfinished_task：任务上下文（输入/已完成步骤） */
  taskContext?: {
    userInput: string;
    completedSteps: string[];
    remainingSteps: string[];
  };
}
```

### 实现位置

#### 1. **会话结束时保存未完成任务**

**文件**：`src/memory/MemoryFlushAgent.ts`

**新增方法**：`saveUnfinishedTasks(executionStore, sessionId)`

```typescript
/**
 * 保存未完成的任务到记忆
 */
private async saveUnfinishedTasks(
  todos: Array<{ id: string; subject: string; status: string; description?: string }>,
  sessionId: string
): Promise<void> {
  const unfinished = todos.filter(t => t.status === 'pending' || t.status === 'in_progress');

  for (const task of unfinished) {
    await this.memoryManager.add({
      type: 'unfinished_task',
      category: 'timeline',
      content: `未完成任务：${task.subject}${task.description ? `\n${task.description}` : ''}`,
      keywords: [task.subject.slice(0, 20)],
      source: 'memory-flush-agent',
      confidence: 0.9,
      dayKey: new Date().toISOString().split('T')[0],
      sessionId,
      taskContext: {
        userInput: '',  // 需从会话历史获取
        completedSteps: [],
        remainingSteps: [task.subject],
      },
    });
  }
}
```

**调用时机**：`flushOnExit()` 方法末尾

#### 2. **启动时检测未完成任务**

**文件**：`src/memory/MemoryFlushAgent.ts`

**扩展方法**：`generateBootGuide()`

```typescript
async generateBootGuide(): Promise<BootGuideResult> {
  ...

  // 检测未完成任务（7 天内，未 dismissed）
  const unfinishedTasks = cached.filter(m =>
    m.type === 'unfinished_task' &&
    !m.metadata?.dismissed &&
    new Date(m.createdAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000
  );

  if (unfinishedTasks.length > 0) {
    // 生成引导消息，带任务提醒
    const guideMessage = await this.runGuideAgent(displayMemories, unfinishedTasks);
    return {
      hasGuide: true,
      guideMessage,
      memories: displayMemories,
      unfinishedTasks,  // 新增字段
    };
  }
  ...
}
```

#### 3. **UI 交互：继续 or 不再提醒**

**文件**：`desktop/renderer/stores/chatStore.ts`

**新增方法**：

```typescript
dismissUnfinishedTask: async (memoryId: string) => {
  // 调用 IPC 标记任务为 dismissed
  await window.electron.dismissUnfinishedTask(memoryId);
}
```

**UI 组件**（新增）：`desktop/renderer/components/UnfinishedTaskPrompt.tsx`

展示"上次有未完成的任务：XXX，是否继续？[继续] [不再提醒]"

---

## 方案 2：成功案例提取为经验

### 识别成功案例

**文件**：`src/memory/MemoryFlushAgent.ts`

**扩展方法**：`buildExtractionTask()`

在 prompt 中新增要求：

```
## 任务 3：提取成功经验（新增）
分析对话中成功完成的任务：
- 识别明确的问题 → 解决步骤 → 成功结果模式
- 提取为 reusable_pattern 类型记忆
- 记录适用场景和关键点

输出格式新增字段：
{
  "successfulPatterns": [
    {
      "problem": "问题描述",
      "solution": "解决步骤（详细）",
      "keyPoints": ["关键点1", "关键点2"],
      "applicableScenarios": ["适用场景"],
      "confidence": 0.9
    }
  ]
}
```

### 复用经验

**文件**：`src/memory/MemoryRetriever.ts` 或 `HybridRetriever.ts`

**新增方法**：`searchSuccessPatterns(query: string)`

在 Agent 计划/执行阶段，检索相关成功经验：

```typescript
async searchSuccessPatterns(query: string): Promise<MemoryEntry[]> {
  // 向量检索 + 关键词匹配
  const results = await this.retrieve(query, {
    types: ['reusable_pattern', 'lesson_learned'],
    category: 'lesson',
    limit: 3,
  });
  return results.filter(r => r.confidence > 0.8);
}
```

---

## 方案 3：经验自动转化为 Skill

### 触发条件

- 某个 `reusable_pattern` 记忆被检索 **5 次以上**
- 置信度 >= 0.9
- 有明确的适用场景

### 生成逻辑

**文件**：`src/memory/SkillGenerator.ts`（新增）

```typescript
export class SkillGenerator {
  /**
   * 从经验记忆生成 Skill 定义
   */
  async generateSkillFromPattern(pattern: MemoryEntry): Promise<SkillDefinition> {
    // 使用 LLM 生成 Skill 的 name/description/prompt
    const prompt = `
基于以下成功经验，生成一个可复用的 Skill 定义：

经验内容：${pattern.content}
适用场景：${pattern.applicableScenarios?.join(', ')}
关键点：${pattern.keyPoints?.join(', ')}

生成 JSON 格式：
{
  "name": "skill-name",
  "description": "一句话描述适用场景",
  "prompt": "详细的执行步骤模板"
}
`;

    const result = await this.llm.generate(prompt);
    return JSON.parse(result);
  }
}
```

**存储位置**：`~/.xuanji/learned-skills.json`

**加载时机**：`ChatSession.init()` 自动加载

---

## 方案 4：扩展功能设计

### 4.1 错误模式识别

**原理**：连续 3 次相同错误 → 自动检索 `error_resolution` 记忆 → 主动建议

**文件**：`src/core/agent/ErrorPatternDetector.ts`（新增）

```typescript
export class ErrorPatternDetector {
  private errorHistory: Array<{ error: string; timestamp: number }> = [];

  detectRepetitiveError(error: string): boolean {
    this.errorHistory.push({ error, timestamp: Date.now() });

    // 5 分钟内相同错误出现 3 次
    const recent = this.errorHistory.filter(
      e => e.error === error && Date.now() - e.timestamp < 300_000
    );
    return recent.length >= 3;
  }
}
```

### 4.2 工作流记忆

**类型**：`workflow` (新增)

**示例**：记录多步骤任务的完整流程

```
内容：部署前端应用到生产
步骤：
1. npm run build
2. 上传到 CDN
3. 更新 nginx 配置
4. 重启服务
5. 验证健康检查
```

### 4.3 用户习惯学习

**类型**：扩展 `user_preference`

**维度**：
- 工具使用偏好（如总用 multi_edit 而非 edit）
- 代码风格（如总要求加注释）
- 沟通方式（如喜欢简洁回复 vs 详细解释）

### 4.4 知识图谱

**实现**：`src/memory/MemoryGraph.ts`（新增）

**关系类型**：
- `related_to`：相关记忆
- `depends_on`：依赖关系
- `solved_by`：问题→解决方案
- `applied_in`：经验→应用项目

**查询**：`getRelatedMemories(memoryId)` 返回关联记忆网络

### 4.5 记忆衰减与强化

**策略**：
- 低频记忆（3 个月未检索）：`confidence *= 0.8`
- 高频记忆（每周检索）：`confidence = Math.min(1.0, confidence + 0.05)`

**实现**：`MemoryManager.updateAccessStats()` 中增加衰减/强化逻辑

---

## 实施优先级

| 优先级 | 功能 | 工作量 | 价值 |
|--------|------|--------|------|
| **P0** | 未完成任务跟踪 | 中 | 高 |
| **P0** | 成功案例提取为经验 | 小 | 高 |
| **P1** | 经验自动转化为 Skill | 大 | 中 |
| **P1** | 错误模式识别 | 小 | 中 |
| **P2** | 工作流记忆 | 中 | 中 |
| **P2** | 用户习惯学习 | 中 | 低 |
| **P3** | 知识图谱 | 大 | 低 |
| **P3** | 记忆衰减强化 | 小 | 低 |

---

## 下一步

1. **确认方案**：用户选择要实施的功能（P0/P1/P2/P3）
2. **代码实现**：按优先级依次实现
3. **测试验证**：编写集成测试

建议先实施 **P0 功能**（未完成任务 + 成功经验），快速验证效果后再扩展。
