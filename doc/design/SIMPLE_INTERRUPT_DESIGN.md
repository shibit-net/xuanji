# 简化中断设计：移除"补充输入"概念

## 设计理念

**移除人为的"补充输入"判断，让 LLM 基于完整对话历史自己理解用户意图**

这是 Claude Code 的设计哲学：
- ✅ 用户随时可以打断
- ✅ 基于完整上下文重新生成
- ✅ LLM 自己判断是补充还是新任务

---

## 之前的复杂设计（已移除）

### 问题 1：复杂的状态管理

```typescript
// ❌ 已移除
const lastEndTimeRef = useRef<number>(0);  // 记录结束时间
const recentlyFinished = Date.now() - lastEndTimeRef.current < 5000;  // 5秒窗口
const isAgentBusy = status !== 'idle' || hasStreamContent || recentlyFinished;
```

**问题**：
- 需要在 `onEnd` 中更新 `lastEndTimeRef`
- 需要复杂的 `useMemo` 计算时间窗口
- 容易出 bug（刚修了一个窗口重置的 bug）

### 问题 2：Pending 队列机制

```typescript
// ❌ 已移除
const [pendingUserInputs, setPendingUserInputs] = useState<PendingUserInput[]>([]);

setPendingUserInputs((prev) => {
  const shouldMerge = lastInput && (Date.now() - lastInput.timestamp) < QUEUE_MERGE_WINDOW_MS;
  if (shouldMerge) {
    return [...prev.slice(0, -1), { content: merged, merged: true }];
  }
  // ...
});
```

**问题**：
- 队列管理复杂（合并、去重、长度限制）
- 需要在多处处理队列（handleInterrupt、onEnd、UI显示）
- 增加代码复杂度

### 问题 3：Debounce 延迟

```typescript
// ❌ 已移除
interruptDebounceTimerRef.current = setTimeout(() => {
  agentLoop.interrupt(finalInput);
}, 100);
```

**问题**：
- 增加 100ms 延迟，响应不够快
- 需要管理定时器清理
- 边界情况复杂

### 问题 4：绿色提示 UI

```typescript
// ❌ 已移除
{pendingUserInputs.length > 0 && isAgentBusy && (
  <Box>
    <Text color="gray">好的，让我重新整理一下</Text>
    {pendingUserInputs.length > 1 && (
      <Text>（收到 {pendingUserInputs.length} 条补充）</Text>
    )}
  </Box>
)}
```

**问题**：
- 依赖 pending 队列状态
- 增加 UI 复杂度
- 用户不一定理解"补充"是什么意思

---

## 新的简化设计

### 核心逻辑（20 行代码）

```typescript
if (isAgentBusy) {
  // ★ 检查 AgentLoop 是否真的在运行 ★
  if (agentLoop.getState().status === 'idle') {
    // UI 状态未更新但 AgentLoop 已停止 → 作为正常提交处理
  } else {
    // ★ 添加用户新输入到历史（显示在 UI 中）★
    const uid = ++msgIdRef.current;
    setMessages((prev) => [...prev, {
      id: uid,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    }]);

    // ★ 根据当前状态选择中断方式 ★
    if (status === 'tool') {
      // 工具执行中 → 不中断，等待工具完成后自动将新输入传给 LLM
      agentLoop.appendMessage(input);
    } else {
      // thinking 状态（流式输出中）→ 立即中断
      // 归档当前已输出的内容，基于完整上下文重新生成
      archiveStreamText();
      agentLoop.interrupt(input);
    }
    return;
  }
}
```

### 工作流程

```
1. 用户输入 "描述xuanji的目录结构"
   → Agent 执行（流式输出 + 工具调用）

2. 用户又输入 "用英文"
   ├─ 如果在流式输出中（status = 'thinking'）
   │  → 归档已输出内容
   │  → 调用 interrupt("用英文")
   │  → 立即停止流式输出并重新生成
   │
   └─ 如果在工具执行中（status = 'tool'）
      → 调用 appendMessage("用英文")
      → 等待工具完成后自动将新输入传给 LLM

3. LLM 看到完整历史：
   User: "描述xuanji的目录结构"
   Assistant: (已输出的内容 + 工具调用结果)
   User: "用英文"  ← LLM 基于上下文自己理解

4. LLM 判断意图：
   - 如果是补充 → 重新回答问题（"描述xuanji的目录结构，用英文"）
   - 如果是新任务 → 执行新任务
```

---

## 删除的代码（约 200 行）

### 1. 状态管理

```diff
- const lastEndTimeRef = useRef<number>(0);
- const [pendingUserInputs, setPendingUserInputs] = useState<PendingUserInput[]>([]);
- const [processingAppend, setProcessingAppend] = useState<string | null>(null);
- const interruptDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
- const latestPendingInputRef = useRef<string>('');
- const MAX_PENDING_INPUTS = 10;
- const QUEUE_MERGE_WINDOW_MS = 5000;
```

### 2. onEnd 中的队列处理

```diff
- // 处理 pending 用户输入队列
- if (pendingUserInputs.length > 0) {
-   const combinedInput = pendingUserInputs.map(p => p.content).join('\n\n');
-   setPendingUserInputs([]);
-   setTimeout(() => handleSubmit(combinedInput), 100);
- }
-
- setProcessingAppend(null);
```

### 3. handleInterrupt 中的队列处理

```diff
- const pendingUserMsgs: ChatMessage[] = [];
- if (pendingUserInputs.length > 0) {
-   for (const input of pendingUserInputs) {
-     pendingUserMsgs.push({ role: 'user', content: input.content });
-   }
-   setPendingUserInputs([]);
- }
- setMessages((prev) => [...prev, ...pendingUserMsgs, ...]);
```

### 4. 复杂的 pending 队列逻辑

```diff
- setPendingUserInputs((prev) => {
-   const lastInput = prev[prev.length - 1];
-   const shouldMerge = lastInput && (Date.now() - lastInput.timestamp) < QUEUE_MERGE_WINDOW_MS;
-   if (shouldMerge) {
-     return [...prev.slice(0, -1), { content: merged, merged: true }];
-   }
-   // ...去重、长度限制等逻辑
- });
-
- // Debounce 延迟
- interruptDebounceTimerRef.current = setTimeout(() => {
-   const finalInput = latestPendingInputRef.current;
-   agentLoop.interrupt(finalInput);
- }, 100);
```

### 5. UI 绿色提示

```diff
- {pendingUserInputs.length > 0 && isAgentBusy && (
-   <Box marginTop={1} marginBottom={1}>
-     <Text color="gray" dimColor>好的，让我重新整理一下</Text>
-     {pendingUserInputs.length > 1 && (
-       <Text color="gray" dimColor>（收到 {pendingUserInputs.length} 条补充）</Text>
-     )}
-   </Box>
- )}
-
- {processingAppend && isAgentBusy && (
-   <Box marginTop={1} marginBottom={1}>
-     <Text color="gray" dimColor>明白了，稍等...</Text>
-   </Box>
- )}
```

---

## 优势对比

| 维度 | 之前的设计 | 新设计 |
|------|-----------|--------|
| 代码行数 | ~200行（状态管理+队列+UI） | ~20行（核心逻辑） |
| 状态变量 | 7个（lastEndTimeRef, pendingUserInputs, processingAppend等） | 0个（无额外状态） |
| 判断逻辑 | 5秒窗口 + 队列合并 + debounce | 简单判断 isAgentBusy |
| 响应速度 | 100ms延迟（debounce） | 立即响应 |
| Bug风险 | 高（时间窗口重置bug等） | 低（逻辑简单） |
| 用户体验 | 需要在5秒内输入才能补充 | 随时可以打断 |
| LLM理解 | 依赖5秒窗口判断 | 基于完整上下文判断 |
| 多语言支持 | 受5秒窗口限制 | 完全支持 |
| 维护成本 | 高（复杂逻辑） | 低（简单清晰） |

---

## 核心原则

### 1. 工具执行中：温和追加（appendMessage）

```typescript
if (status === 'tool') {
  agentLoop.appendMessage(input);  // 不中断工具，等待完成后传给LLM
}
```

**原因**：
- 工具执行结果很重要（如 Read 文件、Bash 命令）
- 中断会丢失工具结果
- 等待工具完成后，LLM 可以基于工具结果理解新输入

**示例**：
```
User: "分析这个文件的性能"
Agent: [Read file] → 正在读取文件...
User: "用简单的语言解释"  ← 不中断Read工具
Agent: [Read完成] → 基于文件内容 + "用简单的语言解释" 重新生成
```

### 2. 流式输出中：立即中断（interrupt）

```typescript
else {
  archiveStreamText();        // 归档已输出的内容
  agentLoop.interrupt(input); // 立即中断并重新生成
}
```

**原因**：
- 用户打断流式输出通常是想改变方向
- 已输出的内容归档到历史，不会丢失
- 立即响应用户的新想法

**示例**：
```
User: "解释一下 React Hooks"
Agent: React Hooks 是 React 16.8 引入的新特性，允许你在函数组件中使用状态...
User: "停，用英文"  ← 立即中断
Agent: [归档中文内容] → React Hooks are a feature introduced in React 16.8...
```

### 3. LLM 自己判断意图

通过 System Prompt 引导（已在 xuanji-assistant.ts 中添加）：

```
- **Follow-up Refinement**: When the user provides follow-up input shortly
  after your response (e.g., "use English", "make it simpler"), treat it
  as a refinement request for the PREVIOUS task.
```

LLM 基于完整历史判断：
- "用英文" → 补充（重新回答上一个问题）
- "测试你的所有功能" → 新任务（开启新话题）

---

## 测试用例

### 用例 1：流式输出中打断

```
❯ 解释一下 Agent 的工作原理
  Agent 是一种自主代理，可以...（正在输出中）

❯ [立即输入] 停，用英文
  [归档中文内容]
  [立即中断流式输出]
  [基于完整历史重新生成]
  → An agent is an autonomous system that...
```

**预期**：
- ✅ 中文内容保留在历史中
- ✅ 立即停止输出
- ✅ 重新生成英文版本

### 用例 2：工具执行中追加输入

```
❯ 读取所有 .ts 文件的前 10 行
  [Read tool 正在执行...]

❯ [立即输入] 只读 src/ 目录
  [等待 Read 完成]
  [基于 Read 结果 + "只读 src/ 目录" 重新生成]
  → [过滤后只显示 src/ 目录的文件]
```

**预期**：
- ✅ Read 工具不被中断，继续执行
- ✅ 工具完成后，LLM 基于结果理解"只读 src/"
- ✅ 输出过滤后的结果

### 用例 3：idle 状态下的新输入

```
❯ 描述xuanji的目录结构
  [Agent 完成输出]
  [status = 'idle', streamText = '']

❯ 测试你的所有功能  ← 新任务
  [正常提交，不触发 interrupt]
  → [开始测试功能...]
```

**预期**：
- ✅ 不触发 interrupt（因为 isAgentBusy = false）
- ✅ 作为正常提交处理
- ✅ 开启新话题

### 用例 4：快速连续打断

```
❯ 写一个排序算法
  [Agent 正在思考...]

❯ 用冒泡排序
  [interrupt 1: 归档 + 重新生成]

❯ 不，用快速排序
  [interrupt 2: 归档 + 重新生成]

❯ 添加详细注释
  [interrupt 3: 归档 + 重新生成]
```

**预期**：
- ✅ 每次打断都立即响应
- ✅ 不需要 debounce 延迟
- ✅ 用户看到实时反馈

---

## 性能考虑

### API 调用频率

**问题**：用户快速连续输入会导致多次 API 调用，可能触发 rate limit

**解决方案**：
1. **依赖 LLM 的中断机制**：Anthropic/OpenAI 的 stream abort 会立即停止生成，不会继续消耗 tokens
2. **用户教育**：在文档中说明"频繁打断可能影响响应速度"
3. **可选的 debounce**：如果确实需要，可以添加配置项启用 debounce（默认关闭）

### UI 渲染性能

**优化**：
- 移除 pending 队列和绿色提示，减少动态区域渲染
- 用户输入直接添加到 Static 区域，无需额外状态管理
- 减少 React state 更新，提升性能

---

## 未来优化方向

### 1. 可选的 Rate Limit 保护

```typescript
// 可选配置
const INTERRUPT_COOLDOWN_MS = 500; // 最小间隔500ms

if (Date.now() - lastInterruptTime < INTERRUPT_COOLDOWN_MS) {
  // 提示用户：请稍等，上一次请求还在处理中
  return;
}
```

### 2. 智能队列合并（仅在必要时）

如果发现用户频繁打断导致 rate limit，可以添加：
- 检测快速连续输入（<500ms）
- 自动合并为一次请求
- 显示 toast 提示："已合并多次输入"

### 3. 用户偏好配置

```json
{
  "interrupt": {
    "mode": "immediate",     // immediate | debounced
    "debounce_ms": 100,      // 仅在 debounced 模式下生效
    "show_hint": false        // 是否显示绿色提示
  }
}
```

---

## 总结

### 删除的复杂逻辑

- ❌ 5秒时间窗口判断
- ❌ Pending 队列管理（合并、去重、长度限制）
- ❌ Debounce 延迟
- ❌ 绿色提示 UI
- ❌ 7个状态变量和 ref
- ❌ ~200行代码

### 新增的简化逻辑

- ✅ 简单的 isAgentBusy 判断（status !== 'idle' || hasStreamContent）
- ✅ 区分工具执行（appendMessage）和流式输出（interrupt）
- ✅ 用户输入直接添加到历史
- ✅ LLM 基于完整上下文自己判断意图
- ✅ ~20行核心代码

### 核心收益

1. **代码更简洁**：200行 → 20行（减少90%）
2. **逻辑更清晰**：无复杂状态管理，易于理解和维护
3. **响应更快**：无 debounce 延迟，立即响应用户
4. **体验更自然**：随时可以打断，类似 Claude.ai 的对话体验
5. **Bug 更少**：简单逻辑，减少边界情况
6. **多语言支持**：完全依赖 LLM 理解，支持所有语言

### 设计哲学

**让 LLM 自己思考，而不是用规则限制它。**

这符合 AI 助手的核心理念：
- 减少硬编码规则
- 依赖模型能力
- 通过 Prompt 引导行为
- 保持代码简洁优雅
