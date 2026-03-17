# 概念命名优化方案

**日期**: 2026-03-15
**背景**: 工具已重命名为 delegate/orchestrate/pipeline，相关概念也需要对应调整

---

## 现有概念问题

### 1. SubAgent

**现状**：
- 类名：`SubAgentContext`, `SubAgentLoop`
- 函数名：`runSubAgent()`
- 文档描述："子代理"、"Sub-agent"

**问题**：
- "Sub"（子）暗示层级关系，但实际是"委托关系"
- 与工具名 `delegate` 不匹配
- 容易与 "SubProcess"、"SubTask" 混淆

**核心本质**：
- 由 `delegate` 工具创建
- 从 AgentRegistry 读取配置的执行实例
- 在隔离环境中执行（独立上下文）
- 不是"子"而是"被委托者"

---

### 2. Agent Team

**现状**：
- 类名：`TeamManager`, `TeamConfig`, `TeamMember`
- 文档描述："团队"、"Team"

**问题**：
- "Team"（团队）只暗示"一群人"
- 核心是"编排协作策略"，而非简单的团队
- 与工具名 `orchestrate` 不匹配

**核心本质**：
- 由 `orchestrate` 工具创建
- 多个 Agent 按策略协作（sequential/parallel/pipeline/debate）
- 强调"编排"而非"团队"

---

## 重命名方案

### 方案1：基于工具名（推荐）

| 旧概念 | 新概念 | 理由 |
|-------|--------|------|
| SubAgent | **DelegatedAgent** | 与 delegate 工具对应，"被委托的Agent" |
| SubAgentContext | **DelegationContext** | 委托上下文 |
| SubAgentLoop | **DelegationExecutor** | 委托执行器 |
| runSubAgent() | **runDelegatedAgent()** | 执行被委托的Agent |
| | | |
| Team | **Orchestration** | 与 orchestrate 工具对应，"编排" |
| TeamManager | **OrchestrationManager** | 编排管理器 |
| TeamConfig | **OrchestrationConfig** | 编排配置 |
| TeamMember | **OrchestrationAgent** | 被编排的Agent |

**优点**：
- ✅ 与工具名完美对应（delegate → DelegatedAgent, orchestrate → Orchestration）
- ✅ 语义准确（委托关系，而非层级关系）
- ✅ 专业术语（软件架构中的委托模式、编排模式）

**缺点**：
- ⚠️ 名称较长（DelegatedAgent vs SubAgent）
- ⚠️ 重构成本高（大量文件需要修改）

---

### 方案2：基于执行模式

| 旧概念 | 新概念 | 理由 |
|-------|--------|------|
| SubAgent | **IsolatedAgent** | 强调隔离执行 |
| SubAgentContext | **IsolatedContext** | 隔离上下文 |
| SubAgentLoop | **IsolatedExecutor** | 隔离执行器 |
| runSubAgent() | **runIsolatedAgent()** | 执行隔离Agent |
| | | |
| Team | **Collaboration** | 强调协作 |
| TeamManager | **CollaborationManager** | 协作管理器 |
| TeamConfig | **CollaborationConfig** | 协作配置 |
| TeamMember | **CollaborativeAgent** | 协作Agent |

**优点**：
- ✅ 强调核心特性（隔离、协作）
- ✅ 较为简洁

**缺点**：
- ❌ 与工具名不匹配（delegate vs Isolated）
- ❌ Collaboration 比 Orchestration 弱（协作 vs 编排）

---

### 方案3：保留部分命名

| 旧概念 | 新概念 | 理由 |
|-------|--------|------|
| SubAgent | **Agent** | 简化，都是Agent |
| SubAgentContext | **AgentExecutionContext** | Agent执行上下文 |
| SubAgentLoop | **AgentExecutor** | Agent执行器 |
| runSubAgent() | **executeAgent()** | 执行Agent |
| | | |
| Team | **Orchestration** | 与工具名对应 |
| TeamManager | **OrchestrationManager** | 编排管理器 |
| TeamConfig | **OrchestrationConfig** | 编排配置 |
| TeamMember | **OrchestrationAgent** | 被编排的Agent |

**优点**：
- ✅ 最简洁（Agent vs SubAgent）
- ✅ 概念统一（都是Agent，只是执行方式不同）

**缺点**：
- ❌ Agent 太通用，与 AgentRegistry 的 Agent Profile 混淆
- ❌ 失去了"委托"的语义

---

### 方案4：仅优化 Team（折中方案）

| 旧概念 | 新概念 | 理由 |
|-------|--------|------|
| SubAgent | **SubAgent** | 保留（已广泛使用） |
| SubAgentContext | **SubAgentContext** | 保留 |
| SubAgentLoop | **SubAgentLoop** | 保留 |
| runSubAgent() | **runSubAgent()** | 保留 |
| | | |
| Team | **Orchestration** | 与 orchestrate 对应 |
| TeamManager | **OrchestrationManager** | 编排管理器 |
| TeamConfig | **OrchestrationConfig** | 编排配置 |
| TeamMember | **OrchestrationAgent** | 被编排的Agent |

**优点**：
- ✅ 最小重构（只改 Team 相关）
- ✅ 核心问题已解决（Team → Orchestration）
- ✅ SubAgent 虽不完美但可接受

**缺点**：
- ⚠️ SubAgent 与 delegate 仍不完全对应

---

## 推荐：方案4（折中方案）

### 理由

**保留 SubAgent**：
1. **广泛使用**：代码库中大量使用（SubAgentContext, SubAgentLoop, runSubAgent）
2. **可接受性**：虽然 "Sub" 不完美，但已经被理解为"委托的Agent"
3. **重构成本**：改为 DelegatedAgent 需要修改大量文件，风险高

**优化 Team → Orchestration**：
1. **必要性高**："Team" 与 "orchestrate" 完全不匹配
2. **语义准确**："Orchestration" 完美体现编排协作的本质
3. **重构成本可控**：主要在 `src/core/agent/team/` 目录

---

## 实施方案（方案4）

### Phase 1: 重命名 Team 概念

**文件重命名**：
```bash
src/core/agent/team/TeamManager.ts       → OrchestrationManager.ts
src/core/agent/team/types.ts            → 内部类型更新
src/core/agent/team/templates.ts        → 内部类型更新
```

**类型更新**：
```typescript
// types.ts
export interface OrchestrationConfig {  // 原 TeamConfig
  name: string;
  strategy: OrchestrationStrategy;      // 原 TeamStrategy
  members: OrchestrationAgent[];        // 原 TeamMember[]
  // ...
}

export interface OrchestrationAgent {   // 原 TeamMember
  id: string;
  role: string;
  task?: string;
}

export type OrchestrationStrategy =     // 原 TeamStrategy
  | 'sequential'
  | 'parallel'
  | 'pipeline'
  | 'debate';
```

**类更新**：
```typescript
// OrchestrationManager.ts
export class OrchestrationManager implements IOrchestrationManager {
  // 原 TeamManager
}
```

---

### Phase 2: 更新导入和引用

**更新 OrchestrateTool**：
```typescript
import { OrchestrationManager } from '@/core/agent/orchestration/OrchestrationManager';
import type { OrchestrationConfig, OrchestrationAgent, OrchestrationStrategy } from '@/core/agent/orchestration/types';

export class OrchestrateTool extends BaseTool {
  async execute(input) {
    const manager = new OrchestrationManager(...);
    const config: OrchestrationConfig = { ... };
    // ...
  }
}
```

---

### Phase 3: 更新文档

- `doc/guide/agent-concepts.md`
- `doc/guide/custom-subagent-guide.md`
- 所有 PRD 文档

**术语统一**：
- "Team" → "Orchestration"
- "Team members" → "Orchestrated agents"
- "Team strategy" → "Orchestration strategy"

---

## 可选：SubAgent 文档优化

**虽然不改名，但优化文档描述**：

### 优化前

```
SubAgent（子代理）：
- 执行独立任务的 Agent
- 不与用户交互
- 隔离上下文
```

### 优化后

```
SubAgent（委托执行Agent）：
- 由 delegate 工具委托执行任务
- 在隔离环境中运行（独立上下文）
- 不与用户交互
- 本质：从 AgentRegistry 读取配置的执行实例
```

---

## 术语对照表

| 工具 | 创建的实体 | 文件/类 | 描述 |
|------|-----------|---------|------|
| **delegate** | SubAgent | SubAgentLoop, SubAgentContext | 被委托执行的单个Agent |
| **orchestrate** | Orchestration | OrchestrationManager, OrchestrationConfig | 被编排协作的多个Agent |
| **pipeline** | Pipeline | PipelineTool | 流水线（底层使用SubAgent） |

---

## 用户视角

### 优化前

```
用户："用 task 工具创建一个 sub-agent"
用户："用 agent_team 工具创建一个 team"
```

**问题**：task/team 太通用，sub-agent/team 不体现本质

### 优化后

```
用户："用 delegate 工具委托给专业 Agent"
用户："用 orchestrate 工具编排 Agent 协作"
```

**优势**：delegate/orchestrate 清晰，术语统一

---

## 重构成本评估

| 方案 | 文件修改数 | 风险 | 工作量 |
|------|-----------|------|--------|
| 方案1（全部重命名） | 50+ | 高 | 3-5天 |
| 方案2（执行模式） | 50+ | 高 | 3-5天 |
| 方案3（简化命名） | 50+ | 高 | 3-5天 |
| **方案4（仅Team）** | **10-15** | **低** | **0.5-1天** |

---

## 总结

### 推荐方案：方案4

**优化内容**：
- ✅ Team → Orchestration（必须）
- ✅ 保留 SubAgent（成本考虑）
- ✅ 文档优化（补充"委托"语义）

**优势**：
1. 最小成本（10-15文件）
2. 核心问题解决（Team → Orchestration）
3. 风险可控

**下一步**：
1. 重命名 TeamManager → OrchestrationManager
2. 更新类型定义（TeamConfig → OrchestrationConfig）
3. 更新 OrchestrateTool 引用
4. 更新文档

---

**完成日期**: 待定
**负责人**: Kevin Shi
