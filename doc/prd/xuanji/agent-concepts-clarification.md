# Agent概念澄清与重构

**日期**: 2026-03-15
**问题**: 用户无法理解Agent、SubAgent、Team的触发时机和关系

---

## 现状：层次混乱

### 当前架构

```
用户对话
  ↓
主Agent（xuanji）
  ↓ [LLM决定调用工具]
  ├─ TaskTool → SubAgent（单个）→ 使用AgentRegistry配置（explore/plan/coder）
  ├─ TeamTool → Team（多个SubAgent）→ 每个使用AgentRegistry配置
  └─ ChainTool → Chain（顺序SubAgent）→ 每个使用AgentRegistry配置
```

### 概念混淆

| 术语 | 实际含义 | 用户理解 | 问题 |
|------|---------|---------|------|
| **Agent** | AgentRegistry中的配置（explore.json5） | 可执行的实体 | ❌ 配置≠实例 |
| **SubAgent** | TaskTool创建的Agent执行实例 | Agent的子类？ | ❌ 只是执行模式 |
| **Team** | TeamTool创建的多Agent协作 | 独立概念？ | ❌ 只是工具 |

### 用户困惑

**Q1: "什么情况下会执行subagent？"**
- A: 当xuanji（主Agent）的LLM决定调用`task`工具时
- 问题：用户不知道LLM什么时候会调用，感觉是黑盒

**Q2: "什么情况下会执行agent team？"**
- A: 当xuanji的LLM决定调用`agent_team`工具时
- 问题：同上，黑盒决策

**Q3: "什么情况下会执行agents？"**
- A: agents是配置，不是执行单元，被SubAgent和Team使用
- 问题：**命名误导**，Agent听起来像可执行的

---

## 问题根源

### 1. 概念层次不清

```
❌ 错误理解（用户视角）：
Agent = 可执行的实体
SubAgent = Agent的一种
Team = 另一种Agent

✅ 实际架构（系统视角）：
AgentProfile = 静态配置（explore/plan/coder）
SubAgent = 使用AgentProfile的执行实例
Team = 多个SubAgent的协作模式
```

### 2. 命名误导

**AgentRegistry**
- 名称暗示：注册"可执行的Agent"
- 实际内容：Agent配置文件（explore.json5, plan.json5...）
- 应该叫：**ProfileRegistry** 或 **AgentConfigRegistry**

**SubAgent**
- 名称暗示：Agent的子类
- 实际含义：在受限环境中执行的Agent实例
- 应该叫：**DelegatedTask** 或 **IsolatedExecution**

**TeamTool**
- 名称暗示：创建一个"Team"实体
- 实际含义：协调多个SubAgent执行
- 应该叫：**CollaborativeExecution** 或 **MultiAgentTool**

### 3. 用户不可预测性

**问题**：用户无法控制何时触发SubAgent/Team
- 完全由xuanji的LLM黑盒决策
- 工具description是唯一提示，但LLM不总是准确

**对比Claude Code**：
- Claude Code也有类似机制（Agent tool）
- 但他们通过明确的Skill匹配减少不确定性
- 用户可以通过关键词触发特定行为

---

## 重构方案

### 方案1：重新命名（最小改动）

**核心思想**：用清晰的命名消除歧义

| 旧名称 | 新名称 | 说明 |
|-------|-------|------|
| AgentRegistry | **ProfileRegistry** | 明确是配置，不是实例 |
| AgentProfile | **TaskProfile** | 配置的是任务执行者的特征 |
| SubAgent | **DelegatedTask** | 明确是委托的任务，不是Agent类型 |
| SubAgentContext | **TaskExecutionContext** | 任务执行上下文 |
| TaskTool | **DelegateTaskTool** | 明确是委托任务 |
| TeamTool | **CollaborateTool** | 明确是协作执行 |

**代码示例**：
```typescript
// 旧代码
const agentProfile = agentRegistry.get('explore');
const subAgent = new SubAgentContext({ role: 'explore' });

// 新代码
const taskProfile = profileRegistry.get('explore');
const taskExecution = new TaskExecutionContext({ profile: 'explore' });
```

---

### 方案2：统一到AgentProfile（推荐）

**核心思想**：Agent = 配置 + 执行实例的统一抽象

#### 2.1 概念重定义

| 概念 | 定义 | 示例 |
|------|-----|------|
| **AgentProfile** | Agent配置（systemPrompt, tools, model） | explore.json5 |
| **AgentInstance** | 使用Profile创建的执行实例 | AgentLoop实例 |
| **AgentExecution** | 执行参数（depth, timeout, isolation） | SubAgentContext参数 |

#### 2.2 架构调整

**旧架构**：
```typescript
// 用户不可见
AgentRegistry.get('explore')  // 获取配置
SubAgentContext({ role: 'explore' })  // 创建上下文
runSubAgent(...)  // 执行
```

**新架构**：
```typescript
// 用户可见和可控
const agent = agentRegistry.spawn('explore', {
  task: '分析代码',
  depth: 1,
  timeout: 120000,
});

const result = await agent.execute();
```

#### 2.3 工具重构

**TaskTool → agent_execute**
```typescript
{
  name: 'agent_execute',
  description: 'Execute a task using a specialized agent (explore/plan/coder)',
  input_schema: {
    profile: 'explore' | 'plan' | 'coder' | 'general-purpose',
    task: string,
    timeout?: number,
    isolation?: 'none' | 'worktree',
  }
}
```

**TeamTool → agent_collaborate**
```typescript
{
  name: 'agent_collaborate',
  description: 'Multiple agents collaborate on a complex task',
  input_schema: {
    template?: 'code-review' | 'research' | ...,
    profiles: Array<{ profile: string, task?: string }>,
    strategy: 'sequential' | 'parallel' | 'pipeline' | 'debate',
    goal: string,
  }
}
```

---

### 方案3：显式Agent选择（最大改动）

**核心思想**：让用户直接选择Agent，而非LLM黑盒决策

#### 3.1 CLI命令

```bash
# 启动特定Agent
xuanji --agent explore "分析这个项目"
xuanji --agent coder "修复这个bug"

# 启动Team
xuanji --team code-review "审查auth.ts"
```

#### 3.2 对话内快速切换

```
用户: 分析一下这个项目结构
璇玑: [使用explore agent分析...]

用户: /agent coder
璇玑: 已切换到coder agent

用户: 修复auth.ts的bug
璇玑: [使用coder agent修复...]

用户: /agent xuanji
璇玑: 已切换回主agent
```

#### 3.3 AgentRegistry变为AgentSelector

```typescript
class AgentSelector {
  // 用户主动选择
  select(profileId: string): Agent;

  // 系统推荐（LLM辅助）
  recommend(userInput: string): AgentProfile[];

  // 自动选择（降级到现有行为）
  auto(task: string): Agent;
}
```

---

## 对比分析

| 维度 | 方案1：重新命名 | 方案2：统一抽象 | 方案3：显式选择 |
|------|---------------|----------------|----------------|
| **改动量** | 小 | 中 | 大 |
| **概念清晰度** | 中 | 高 | 高 |
| **用户可控性** | 低 | 中 | 高 |
| **向后兼容** | 高 | 中 | 低 |
| **开发成本** | 低 | 中 | 高 |

---

## 推荐方案：方案2 + 方案1部分命名

### Phase 1: 重新命名（立即执行）

**重命名清单**：
- ✅ `AgentProfile` 保持不变（已经清晰）
- ✅ `AgentRegistry` 保持不变（Registry是标准术语）
- ❌ `SubAgent` → 不改（已广泛使用）
- ✅ `SubAgentContext` → 保持（Context是执行参数）
- ✅ TaskTool/TeamTool 保持不变（工具名称）

**原因**：大部分命名已经合理，主要问题是**概念理解**而非命名

---

### Phase 2: 文档澄清（立即执行）

**创建用户指南**：`doc/guide/agent-concepts.md`

内容：
1. **概念层次图**
   ```
   AgentProfile（配置）→ 存储在AgentRegistry
   AgentInstance（实例）→ TaskTool/TeamTool创建
   AgentExecution（执行）→ SubAgentContext参数
   ```

2. **触发时机说明**
   - TaskTool何时被调用：LLM看到复杂子任务
   - TeamTool何时被调用：LLM看到需要多专家协作
   - 如何影响LLM决策：通过工具description

3. **用户控制方式**
   - 明确请求："使用coder agent修复这个bug"
   - 模板请求："使用code-review team审查代码"

---

### Phase 3: 工具Description优化（立即执行）

**优化TaskTool description**：
```typescript
readonly description = [
  '委托给专业Agent执行独立任务。',
  '',
  '🎯 用户明确请求时使用:',
  '✓ "用explore agent分析代码结构"',
  '✓ "让coder agent修复这个bug"',
  '✓ "用plan agent设计架构"',
  '',
  '🤖 系统自动判断时使用:',
  '✓ 需要隔离执行的复杂子任务',
  '✓ 需要特定专业能力（代码探索、架构设计、编程）',
  '✓ 需要并行处理的独立任务',
  '',
  '❌ 不要使用:',
  '✗ 简单任务自己就能完成',
  '✗ 需要与用户交互的任务',
].join('\n');
```

**优化TeamTool description**：
```typescript
readonly description = [
  '创建Agent团队协作完成复杂任务。',
  '',
  '🎯 用户明确请求时使用:',
  '✓ "用code-review team审查代码"',
  '✓ "创建research team调研最佳实践"',
  '',
  '🤖 系统自动判断时使用:',
  '✓ 需要3+个不同专业角色',
  '✓ 需要辩论/讨论达成共识',
  '✓ 需要流水线处理数据',
  '',
  '💡 简化使用template:',
  '• code-review: 架构→安全→性能审查',
  '• research: 文档+代码+社区并行研究',
  '',
  '❌ 不要使用:',
  '✗ 单个Agent能完成的任务 → 用agent_execute',
  '✗ 简单顺序任务 → 自己协调多次调用agent_execute',
].join('\n');
```

---

### Phase 4: AgentRegistry整合（与现有Phase 2并行）

- ✅ SubAgentLoop使用AgentRegistry配置
- ✅ TeamManager使用AgentRegistry配置
- ✅ 删除硬编码的systemPrompt和工具过滤
- ✅ 统一从AgentRegistry获取配置

---

## 实施清单

### 立即执行（文档优化）

- [ ] 创建 `doc/guide/agent-concepts.md` - 用户概念指南
- [ ] 优化 TaskTool.description - 明确触发条件
- [ ] 优化 TeamTool.description - 明确触发条件
- [ ] 在主Agent systemPrompt中添加Agent使用指南

### Phase 2（架构整合）

- [ ] SubAgentLoop使用AgentRegistry（已在进行）
- [ ] TeamManager使用AgentRegistry
- [ ] 删除SubAgentContext硬编码

### Phase 3（Multi-Agent整合）

- [ ] 合并ChainTool到TeamTool
- [ ] 合并QuickTeamTool到TeamTool
- [ ] 简化Team策略（5→4）

---

## 给用户的简洁答案

### 什么时候执行SubAgent？

**两种情况**：
1. **你明确要求**："用explore agent分析代码"、"让coder agent修复bug"
2. **璇玑自动判断**：任务太复杂需要委托给专业Agent（探索/规划/编程）

**本质**：TaskTool是璇玑的工具，璇玑的LLM决定何时调用

---

### 什么时候执行Team？

**两种情况**：
1. **你明确要求**："用code-review team审查代码"
2. **璇玑自动判断**：需要多个专家协作（如架构师+安全+性能）

**本质**：TeamTool是璇玑的工具，璇玑的LLM决定何时调用

---

### 什么是Agents（AgentRegistry）？

**不是执行单元**，而是**配置库**：
- explore.json5 - 探索型Agent的配置（用什么模型、有哪些工具）
- plan.json5 - 规划型Agent的配置
- coder.json5 - 编程型Agent的配置

**类比**：
- AgentRegistry = 人才库的简历
- SubAgent = 实际派出去工作的人
- Team = 多个人组成的项目组

---

### 如何控制？

**明确指令**：
```
✓ "用explore agent分析这个项目"
✓ "用code-review team审查auth.ts"
✓ "让coder agent修复bug"
```

**让璇玑自动判断**：
```
✓ "分析一下这个项目的结构"  → 璇玑可能调用explore agent
✓ "审查这段代码的质量"      → 璇玑可能调用code-review team
```

---

## 总结

### 核心问题

**概念混淆**：Agent既是配置（AgentRegistry）又是执行（SubAgent/Team）

### 解决方案

1. **文档澄清**：明确概念层次（配置→实例→执行）
2. **工具优化**：改进description，支持用户明确指令
3. **架构整合**：统一使用AgentRegistry，消除硬编码

### 优先级

1. ⚡ **立即**：优化工具description，创建用户指南
2. 📅 **本周**：AgentRegistry整合（SubAgent + Team）
3. 📅 **下周**：Multi-Agent工具简化

---

**完成日期**: 2026-03-15
**负责人**: Kevin Shi
