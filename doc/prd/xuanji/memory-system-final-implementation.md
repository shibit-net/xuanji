# 最终方案：记忆系统完整实施报告

## 实施日期
2026-03-16

## 概述
实现了记忆系统与 Agent 的深度集成，采用**混合策略**：
- **主 Agent (xuanji)**: 自动注入记忆
- **子 Agent (delegated)**: LLM 通过工具主动检索

---

## 设计原则

### 主 Agent
```
✅ 自动注入记忆到 System Prompt
理由: 需要理解用户完整上下文、历史偏好、项目知识
实现: Phase 1 已完成
```

### 子 Agent
```
❌ 默认不注入记忆（保持原子性）
✅ 提供 retrieve_memory 工具
🤖 LLM 根据任务判断是否调用
理由: 子任务应该独立执行，减少无关上下文干扰
```

---

## 修改文件

### 1. `src/core/tools/RetrieveMemoryTool.ts` (NEW)

**功能**: 记忆检索工具，让 LLM 主动查询历史记忆

**核心方法**:
```typescript
async execute(input: {
  query: string;           // 搜索查询
  maxResults?: number;     // 最多返回条目数（默认3）
  minConfidence?: number;  // 最低相关度（默认0.65）
}): Promise<string>
```

**输出格式** (OpenClaw 风格):
```markdown
## 📚 Relevant Memories (2)
Query: "user's coding preferences"

### 📅 Historical Conversations
1. [1d ago] User prefers TypeScript over JavaScript...

### 🏷️ User Preferences & Project Knowledge
1. Code style: Follow ESLint rules...

> Avg relevance: 78.5%
```

**工具描述**（告诉 LLM 何时使用）:
```
When to use:
- User mentions previous work: "like last time", "as before"
- Need context about user preferences or project setup
- Solving similar problems to previous ones

When NOT to use:
- Task is completely new and self-contained
- User explicitly wants a fresh approach
```

---

### 2. `src/core/chat/SessionInitializer.ts` (MODIFIED)

**修改位置**: 第 25 行 + 第 310-313 行

**新增导入**:
```typescript
import { RetrieveMemoryTool } from '@/core/tools/RetrieveMemoryTool';
```

**注册工具**:
```typescript
const retrieveMemoryTool = new RetrieveMemoryTool();
retrieveMemoryTool.setMemoryStore(memoryManager);
baseRegistry.register(retrieveMemoryTool);
```

**说明**: 在记忆系统初始化时注册，所有 Agent 都可访问

---

### 3. `src/core/agent/SubAgentLoop.ts` (MODIFIED)

**修改位置**: 第 135-140 行

**修改内容**:
```typescript
// 4. 创建子代理 AgentLoop
// 🆕 子 Agent 不自动注入记忆（memoryStore 传 undefined）
// retrieve_memory 工具仍然可用（工具有自己的 memoryStore 引用）
const agentLoop = new AgentLoop(
  provider,
  filteredRegistry,
  agentConfig,
  undefined,  // ← 不传递 memoryStore，禁用自动注入
);
```

**效果**:
- 子 Agent 的 `AgentLoop.injectMemoryContext()` 不会执行（因为 memoryStore 为 null）
- 但 `retrieve_memory` 工具仍然可用（工具有自己的 memoryStore 引用）

---

### 4. `src/core/agent/SubAgentContext.ts` (MODIFIED)

**修改位置**: 第 163-174 行（getRolePromptSuffix 方法）

**新增内容**: 在所有角色的 System Prompt 中添加记忆使用指南

**通用指南**:
```typescript
const memoryGuideline = `

**Memory System**: You have access to \`retrieve_memory\` tool.
- Use it when task references "previous work", "like last time", or "my usual style"
- Use it when you need user preferences or project context
- Do NOT use it for self-contained atomic tasks
- Query example: "user's coding preferences", "previous similar implementations"`;
```

**Coder 角色特殊指南**:
```typescript
case 'coder':
  return `You are a coding agent...
${memoryGuideline}
- IMPORTANT: Use \`retrieve_memory\` when task says "continue", "modify previous", or "follow my style"`;
```

**效果**: LLM 知道何时应该调用 retrieve_memory 工具

---

## 决策流程图

```
用户输入
  ↓
判断 Agent 类型
  │
  ├─ 主 Agent (xuanji)
  │   ├─ AgentLoop.run()
  │   ├─ injectMemoryContext()  ← 自动执行
  │   │   ├─ MemoryManager.retrieve()
  │   │   ├─ formatMemoryContext()
  │   │   └─ MessageManager.setSystemPromptSuffix(..., 'memory')
  │   └─ 构建消息（包含记忆上下文）
  │
  └─ 子 Agent (delegated)
      ├─ SubAgentLoop.runSubAgent()
      ├─ AgentLoop(..., undefined)  ← memoryStore = null
      ├─ injectMemoryContext() 跳过  ← 因为 memoryStore 为 null
      ├─ System Prompt 包含工具使用指南
      └─ LLM 决定是否调用 retrieve_memory 工具
          ├─ 任务引用历史 → 调用工具
          │   └─ RetrieveMemoryTool.execute()
          │       └─ 返回相关记忆
          └─ 原子任务 → 不调用工具
```

---

## 使用场景示例

### 场景 1: 主 Agent 自动记忆

**用户输入**:
```
用户: 帮我写个归并排序
```

**系统行为**:
```
[AgentLoop 内部]
1. injectMemoryContext("帮我写个归并排序")
2. HybridRetriever 检索 → 找到 2 条相关记忆
3. formatMemoryContext() → OpenClaw 风格分类
4. System Prompt 注入:
   ## 相关记忆
   ### 📅 历史会话
   1. [1天前] 用户请求 Python 快速排序，使用递归方式

   ### 🏷️ 用户偏好
   1. 代码风格：TypeScript，遵循 ESLint

5. LLM 生成响应（已知用户偏好）
```

**Agent 响应**:
```
好的，我看到你之前让我用 Python 实现了快速排序。
这次我也用 Python 实现归并排序，保持一致的递归风格...
```

---

### 场景 2: 子 Agent 主动检索记忆

**用户输入** (通过 DelegateTool):
```
delegate({
  agentId: "coder",
  task: "继续完善上次的快速排序代码，添加错误处理"
})
```

**子 Agent 的 System Prompt** (自动注入):
```
You are a coding agent. Write, edit, and test code...

**Memory System**: You have access to `retrieve_memory` tool.
- Use it when task references "previous work", "like last time"
- IMPORTANT: Use `retrieve_memory` when task says "continue", "modify previous"
```

**LLM 推理过程**:
```
[LLM 思考]
任务说"继续完善上次的快速排序代码"，我需要先检索之前的代码。

[LLM 调用工具]
retrieve_memory({
  query: "快速排序代码实现",
  maxResults: 2
})

[工具返回]
## 📚 Relevant Memories (1)
### 📅 Historical Conversations
1. [1d ago] 实现了 Python 快速排序函数，使用递归方式...

[LLM 生成代码]
我会在之前的快速排序函数基础上添加错误处理...
```

---

### 场景 3: 子 Agent 不调用工具（原子任务）

**用户输入**:
```
delegate({
  agentId: "coder",
  task: "写一个计算斐波那契数列的函数"
})
```

**LLM 推理过程**:
```
[LLM 思考]
这是一个全新的、自包含的任务，不需要历史上下文。
我可以直接实现，不需要调用 retrieve_memory。

[LLM 直接生成代码]
好的，我来实现斐波那契函数...
```

---

## 关键设计亮点

### 1. 清晰的职责分离
- **主 Agent**: 理解用户完整上下文 → 自动注入记忆
- **子 Agent**: 执行原子任务 → LLM 主动决策

### 2. LLM 自主决策
- 通过 System Prompt 清晰告知工具用途
- LLM 根据任务特征判断是否需要记忆
- 用户可见（工具调用显示在对话中）

### 3. 原子性保证
- 子 Agent 默认不继承父 Agent 记忆
- 避免上下文污染和 Token 浪费
- 特定场景（"续写代码"）LLM 主动检索

### 4. 灵活性
- retrieve_memory 工具支持自定义查询
- 可调整相关度阈值（minConfidence）
- 可限制返回条目数（maxResults）

---

## 测试验证

### 手动测试脚本

`test/manual/test-retrieve-memory-tool.ts`:

```typescript
import { DelegateTool } from '@/core/tools/DelegateTool';

// 场景 1: 子 Agent 主动检索记忆
await delegateTool.execute({
  agentId: 'coder',
  task: '继续完善上次的快速排序代码',
});
// 预期: LLM 调用 retrieve_memory 工具

// 场景 2: 子 Agent 不调用工具
await delegateTool.execute({
  agentId: 'coder',
  task: '写一个斐波那契函数',
});
// 预期: LLM 直接生成代码，不调用工具
```

---

## 总结

### ✅ 已完成

1. **Phase 1**: 主 Agent 自动注入记忆 ✅
2. **RetrieveMemoryTool**: 子 Agent 记忆检索工具 ✅
3. **SubAgent 记忆指南**: System Prompt 告知 LLM 何时使用 ✅
4. **SubAgent 禁用自动注入**: 保持原子性 ✅

### 🎯 核心价值

- ✅ **主 Agent 智能化**: 自动理解用户历史偏好
- ✅ **子 Agent 原子性**: 默认独立执行，减少干扰
- ✅ **LLM 自主决策**: 根据任务特征判断是否需要记忆
- ✅ **用户透明度**: 工具调用可见，知道 Agent 在检索记忆

### 📈 预期效果

**Before**:
```
主 Agent: ❌ 没有记忆，每次对话从零开始
子 Agent: ❌ 继承父 Agent 全部记忆，上下文污染
```

**After**:
```
主 Agent: ✅ 自动加载相关记忆，理解用户偏好
子 Agent: ✅ 默认独立执行，LLM 按需检索记忆
```

---

## 相关文档

- Phase 1 实施报告: `doc/prd/xuanji/phase1-memory-injection-complete.md`
- RetrieveMemoryTool 源码: `src/core/tools/RetrieveMemoryTool.ts`
- 测试脚本: `test/manual/test-memory-injection.ts`
