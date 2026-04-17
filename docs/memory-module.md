# Xuanji Memory 模块技术文档

## 架构概述

M5 分层记忆系统，模拟人类记忆机制：

- **CoreRuleStore** — 核心规则层（永久存储，始终注入）
- **profile 层** — 用户画像（极慢衰减，半衰期 180-365 天）
- **knowledge 层** — 经验教训/领域知识（慢衰减，半衰期 90-180 天）
- **episode 层** — 近期事件/会话摘要（正常衰减，半衰期 14-60 天）
- **DecisionContext** — 动态组装决策上下文，辅助 LLM 判断

## 核心组件

### MemoryManager
协调器，实现 `IMemoryStore` 接口，统一管理所有记忆操作。

### MemoryService
记忆服务层，负责记忆检索、注入和刷新。

### MemoryRetriever
分层混合检索引擎，支持向量检索 + 关键词匹配 + 时间衰减。

### MemoryWeightEngine
动态权重计算引擎，基于访问频率、时间衰减、相关性评分。

## 代码示例

### 示例 1：初始化记忆管理器

```typescript
import { MemoryManager } from '@/memory';

const memoryManager = new MemoryManager({
  dbPath: '~/.xuanji/memory.db',
  enableMaintenance: true,
  enableDream: true
});

await memoryManager.init();
```

### 示例 2：存储和检索记忆

```typescript
// 存储用户偏好
await memoryManager.save({
  type: 'user_preference',
  content: '用户喜欢使用 TypeScript 严格模式',
  keywords: ['TypeScript', '严格模式', '代码风格'],
  confidence: 0.9,
  scope: 'profile',
  volatility: 'stable'
});

// 检索相关记忆
const memories = await memoryManager.retrieve('TypeScript 配置', {
  limit: 5,
  minConfidence: 0.7
});
```

### 示例 3：记忆服务注入

```typescript
import { MemoryService } from '@/memory';

const memoryService = new MemoryService({ memoryManager });

// 在 Agent 循环中注入相关记忆
await memoryService.injectMemories(
  '帮我优化这段代码',
  agentLoop
);

// 退出时刷新记忆
await memoryService.flushOnExit(messages, sessionId);
```

## 关键特性

- **自动衰减** — 基于时间和访问频率的遗忘曲线
- **分层检索** — 优先检索高层级（profile/knowledge）记忆
- **决策辅助** — 动态组装 DecisionContext，辅助 LLM 决策
- **后台维护** — 自动压缩、提炼和清理过期记忆
- **Dream 机制** — 离线整合记忆，提炼领域知识

## 配置选项

```typescript
interface MemoryConfig {
  dbPath: string;
  enableMaintenance: boolean;  // 启用后台维护
  enableDream: boolean;         // 启用 Dream 机制
  maxMemories: number;          // 最大记忆数量
  compactionThreshold: number;  // 压缩阈值
}
```

---
**字数统计**: 约 580 字
