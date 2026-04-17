# 璇玑记忆系统 3.0 - 使用指南

## 📚 目录

1. [快速开始](#快速开始)
2. [决策点记忆系统](#决策点记忆系统)
3. [身份记忆系统](#身份记忆系统)
4. [做梦机制](#做梦机制)
5. [高级用法](#高级用法)
6. [最佳实践](#最佳实践)

---

## 快速开始

### 初始化

```typescript
import { MemoryStore } from '@/memory/MemoryStore';
import { DecisionPointDetector } from '@/memory/DecisionPointDetector';
import { DecisionPointMemoryRetriever } from '@/memory/DecisionPointMemoryRetriever';
import { IdentityManager } from '@/memory/IdentityManager';
import { DreamAgent } from '@/memory/DreamAgent';
import { DreamScheduler } from '@/memory/DreamScheduler';

// 初始化存储
const store = new MemoryStore();
await store.init();

// 初始化组件
const detector = new DecisionPointDetector();
const retriever = new DecisionPointMemoryRetriever(store, subAgentFactory);
const identityManager = new IdentityManager(store);
const dreamAgent = new DreamAgent(store, subAgentFactory);
const dreamScheduler = new DreamScheduler(dreamAgent, store);

// 启动做梦调度器
dreamScheduler.startSchedule();
```

---

## 决策点记忆系统

### 基本概念

决策点记忆系统会在 Agent 需要做出选择的时刻，自动检索和注入相关记忆。

### 使用场景

#### 场景1：工具调用决策

```typescript
// 用户消息
const userMessage = "帮我安装 axios";

// Agent 准备调用工具
const toolCall = {
  name: 'bash',
  input: { command: 'npm install axios' }
};

// 检测决策点
const points = await detector.detect({
  toolCall,
  userMessage
});

// 检索相关记忆
const memories = await retriever.retrieve({
  decisionPoints: points,
  userMessage,
  currentScene: 'package-management'
});

// 结果：检索到 "项目统一使用 pnpm" 的 must 级别记忆
// Agent 会自动调整命令为 "pnpm install axios"
```

#### 场景2：代码风格决策

```typescript
// 用户消息
const userMessage = "创建一个配置文件";

// Agent thinking
const thinking = "我应该用 JSON 还是 YAML 格式？";

// 检测决策点
const points = await detector.detect({
  thinking,
  userMessage
});

// 检索相关记忆
const memories = await retriever.retrieve({
  decisionPoints: points,
  userMessage,
  currentScene: 'file-creation'
});

// 结果：检索到 "项目配置文件统一用 JSON5" 的 should 级别记忆
```

### 约束级别

记忆系统支持三种约束级别：

- **must** (必须遵守)：硬约束，Agent 必须遵守
- **should** (强烈建议)：软约束，Agent 应该遵守
- **may** (可参考)：参考信息，Agent 可以选择性采纳

### 存储记忆

```typescript
// 用户明确告知偏好
const memory: MemoryEntry = {
  id: generateId(),
  type: 'user_preference',
  content: '项目统一使用 pnpm 管理依赖，不要用 npm 或 yarn',
  keywords: ['pnpm', '依赖', '包管理'],
  source: 'user',
  confidence: 1.0,
  
  // 决策点记忆系统字段
  constraint: 'must',  // 硬约束
  usageScenarios: ['package-management', 'command-execution'],
  memoryOriginV2: 'user',
  
  // 其他字段...
};

store.saveEntry(memory);
```

---

## 身份记忆系统

### 设置用户称呼

```bash
# 命令行
/identity set-title 先生

# 或通过代码
await identityManager.setUserTitle('先生');
```

### 设置助手名字

```bash
# 命令行
/identity set-name 贾维斯

# 或通过代码
await identityManager.setAssistantName('贾维斯');
```

### 查看当前设定

```bash
/identity
```

输出：
```
## 🎭 当前身份设定

**助手名字**: 贾维斯
**用户称呼**: 先生

---
💡 使用 `/identity set-title <称呼>` 设置用户称呼
💡 使用 `/identity set-name <名字>` 设置助手名字
```

### 自动注入 System Prompt

```typescript
// 在 PromptOrchestrator 中
const identity = await identityManager.getIdentity();
const identityPrompt = identityManager.formatForSystemPrompt(identity);

// 注入到 System Prompt
const systemPrompt = `
${baseSystemPrompt}

${identityPrompt}
`;
```

生成的 System Prompt：
```
# 身份设定
你的名字是 贾维斯。

# 用户称呼
请称呼用户为"先生"。
```

### 名字呼叫检测

```typescript
const userMessage = "贾维斯，帮我写个函数";

const identity = await identityManager.getIdentity();
const mentioned = identityManager.detectNameMention(
  userMessage,
  identity.assistantName
);

if (mentioned) {
  // 用户呼叫了助手名字，可以做特殊响应
  console.log('用户呼叫了我的名字！');
}
```

---

## 做梦机制

### 什么是做梦？

做梦是记忆系统的自动整理机制，会在后台执行以下任务：

1. **提炼相似记忆** - 合并内容相似的多条记忆
2. **压缩冗长记忆** - 精简过长的记忆内容
3. **去重重复记忆** - 删除完全重复的记忆
4. **淘汰低价值记忆** - 删除过时、无效的记忆
5. **更新记忆评分** - 根据使用情况调整评分

### 手动触发

```bash
# 立即执行做梦
/dream

# 试运行（不实际修改）
/dream dry-run

# 查看做梦状态
/dream status
```

### 自动触发

做梦会在以下情况自动触发：

- 24小时未做梦
- 新增记忆超过 50 条
- 用户空闲超过 30 分钟

### 编程方式

```typescript
// 手动执行做梦
const result = await dreamScheduler.executeDream({
  onProgress: (progress) => {
    console.log(`处理进度: ${progress.currentBatch}/${progress.totalBatches}`);
  }
});

console.log('做梦报告:', result);
// {
//   distilled: 3,
//   compressed: 5,
//   deduplicated: 2,
//   pruned: 8,
//   scored: 45,
//   duration: 23456
// }
```

### 配置做梦调度器

```typescript
const dreamScheduler = new DreamScheduler(dreamAgent, store, {
  batchSize: 100,              // 每批处理100条
  scheduleIntervalMs: 3600000, // 1小时检查一次
  minIntervalMs: 21600000,     // 最小间隔6小时
  memoryThreshold: 50,         // 新增50条触发
  idleThresholdMs: 1800000,    // 空闲30分钟触发
});
```

---

## 高级用法

### 自定义决策点检测

```typescript
class CustomDecisionPointDetector extends DecisionPointDetector {
  async detect(context: any): Promise<DecisionPoint[]> {
    const points = await super.detect(context);
    
    // 添加自定义检测逻辑
    if (context.userMessage.includes('部署')) {
      points.push({
        type: 'deployment-decision',
        keywords: ['deploy', 'production'],
        timestamp: Date.now()
      });
    }
    
    return points;
  }
}
```

### 自定义记忆评分

```typescript
// 在 DreamAgent 中自定义评分逻辑
const customScoring = (memory: MemoryEntry): number => {
  let score = memory.significance || 0.5;
  
  // 高频高效记忆加分
  if (memory.usageCount && memory.effectiveCount) {
    const effectiveRate = memory.effectiveCount / memory.usageCount;
    if (effectiveRate > 0.7) {
      score += 0.2;
    }
  }
  
  // 最近使用加分
  if (memory.lastUsed && Date.now() - memory.lastUsed < 30 * 24 * 3600 * 1000) {
    score += 0.1;
  }
  
  return Math.min(score, 1.0);
};
```

### 记忆使用统计

```typescript
// 记录记忆被使用
await store.updateEntry(memoryId, {
  usageCount: (memory.usageCount || 0) + 1,
  lastUsed: Date.now()
});

// 记录记忆有效（被采纳）
await store.updateEntry(memoryId, {
  effectiveCount: (memory.effectiveCount || 0) + 1
});
```

---

## 最佳实践

### 1. 记忆分类

根据重要性和时效性合理设置约束级别：

```typescript
// 用户明确要求 → must
{
  content: "不要使用 console.log，用 logger",
  constraint: 'must'
}

// 项目规范 → should
{
  content: "函数命名使用驼峰命名法",
  constraint: 'should'
}

// 参考信息 → may
{
  content: "上次使用了 axios 库",
  constraint: 'may'
}
```

### 2. 场景标签

为记忆添加准确的场景标签：

```typescript
{
  content: "项目使用 pnpm",
  usageScenarios: [
    'package-management',
    'command-execution',
    'dependency-install'
  ]
}
```

### 3. 定期做梦

建议配置：
- 每天至少做梦一次
- 新增记忆超过 50 条时触发
- 用户空闲时自动执行

### 4. 监控记忆质量

```typescript
// 定期检查记忆统计
const stats = {
  total: await store.count(),
  mustLevel: await store.count({ constraint: 'must' }),
  avgEffectiveRate: await calculateAvgEffectiveRate(),
  lastDreamTime: dreamScheduler.lastDreamTime
};

console.log('记忆质量报告:', stats);
```

### 5. 身份设定

- 用户称呼和助手名字应该在首次对话时设置
- 人格设定应该简洁明确
- 避免频繁修改身份设定

---

## 故障排查

### 问题1：记忆检索不准确

**原因**：场景标签不匹配或关键词不准确

**解决**：
```typescript
// 检查记忆的场景标签
const memory = store.getEntry(memoryId);
console.log('场景标签:', memory.usageScenarios);

// 更新场景标签
await store.updateEntry(memoryId, {
  usageScenarios: ['correct-scenario-1', 'correct-scenario-2']
});
```

### 问题2：做梦耗时过长

**原因**：记忆数量过多，批次大小不合理

**解决**：
```typescript
// 减小批次大小
const dreamScheduler = new DreamScheduler(dreamAgent, store, {
  batchSize: 50  // 从 100 减少到 50
});
```

### 问题3：身份设定不生效

**原因**：缓存未清除或未正确注入

**解决**：
```bash
# 清除缓存
/identity clear

# 检查是否正确注入
const identity = await identityManager.getIdentity();
console.log('当前身份:', identity);
```

---

## API 参考

### DecisionPointDetector

```typescript
class DecisionPointDetector {
  async detect(context: {
    toolCall?: ToolCall;
    thinking?: string;
    userMessage: string;
    conversationHistory?: any[];
  }): Promise<DecisionPoint[]>
}
```

### DecisionPointMemoryRetriever

```typescript
class DecisionPointMemoryRetriever {
  async retrieve(context: {
    decisionPoints: DecisionPoint[];
    userMessage: string;
    conversationHistory?: any[];
    currentScene: string;
  }): Promise<RetrievedMemory[]>
}
```

### IdentityManager

```typescript
class IdentityManager {
  async getIdentity(): Promise<IdentityMemory>
  async setUserTitle(title: string): Promise<void>
  async setAssistantName(name: string): Promise<void>
  formatForSystemPrompt(identity: IdentityMemory): string
  detectNameMention(message: string, assistantName?: string): boolean
  clearCache(): void
}
```

### DreamAgent

```typescript
class DreamAgent {
  async dream(options?: {
    batchSize?: number;
    dryRun?: boolean;
    onProgress?: (progress: DreamProgress) => void;
  }): Promise<DreamResult>
}
```

### DreamScheduler

```typescript
class DreamScheduler {
  async shouldDream(): Promise<{ should: boolean; reason?: string }>
  async executeDream(options?: {
    dryRun?: boolean;
    onProgress?: (progress: DreamProgress) => void;
  }): Promise<DreamResult | null>
  startSchedule(): void
  stopSchedule(): void
  recordActivity(): void
}
```

---

## 更多资源

- [设计文档](./memory-refactor-plan.md)
- [API 文档](./api-reference.md)
- [测试用例](../src/memory/__tests/)
- [示例代码](./examples/)
