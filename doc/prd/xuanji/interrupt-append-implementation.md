# 补充输入响应行为优化实现总结

## 问题描述

用户发现的 UX 问题：

```
Agent 正在流式输出中文内容...
  • 3. **提醒功能** - 设置和查询正常 ✅
  • ✅  reminder_set  - 成功设置明天的清理提醒
  • ✅  reminder_check  - 显示：
    ◦ ⚠️ 2 个过期提醒（工具导航

❯ 用户输入："使用英文总结"

... Agent 继续输出中文一段时间 ❌
    测试、周报）
    ◦ 📅 1 个今日提醒（Alice 生日）
    ◦ 📋 3 个明日提醒（清理文件、功能测试）
    • 4. **命令执行** - 项目分析正常 ✅

... 然后才开始用英文输出 ✅
```

**问题根因**：用户补充输入"使用英文总结"后，Agent 继续输出中文，过了一段时间才切换到英文。交互体验割裂，不符合用户预期。

## Claude Code 的行为（观察）

当用户在流式输出期间补充输入时，Claude Code 的行为：

1. **立即停止**当前流式输出（不再继续输出旧内容）
2. 显示提示："收到补充输入，重新思考..."
3. 基于补充内容**重新生成**响应
4. 不会出现"先继续输出旧内容，再输出新内容"的情况

## 根本原因

### 当前实现（有问题）

```typescript
// src/adapters/cli/App.tsx L1800
agentLoop.appendMessage(input);  // ❌ 温和追加
```

**`appendMessage()` 的行为**：
- 不中断当前流式输出
- 不中断正在执行的工具
- 消息排队等待自然消费（在下一个"边界点"）
- LLM 的流式响应有缓冲，已生成的 token 会继续输出

**结果**：
```
用户补充："使用英文总结"
  ↓
agentLoop.appendMessage("使用英文总结")  // 消息排队
  ↓
LLM 继续输出已生成的 token（中文）      ❌ 用户困惑
  ↓
边界点到达（end_turn）
  ↓
消费补充消息，重新调用 LLM
  ↓
开始输出英文                           ✅ 但已经太晚
```

### AgentLoop 提供的两个 API

#### 1. `appendMessage()` - 温和追加（Boundary-Aware Queuing）

```typescript
/**
 * 温和追加用户消息（不中断当前执行）
 *
 * 消息排队后，在下一个"自然边界点"被消费：
 * - 工具执行完毕后 → 注入到 tool_result 同一条 user 消息中（首选）
 * - LLM end_turn 后 → 作为新的 user 消息注入
 *
 * 不 abort 当前 stream，不 abort 正在执行的工具。
 */
appendMessage(message: string): void
```

**适用场景**：
- 用户输入的是"补充细节"（如"继续"、"更详细"）
- 不希望中断当前工作流

#### 2. `interrupt()` - 硬中断 + 追加（Interrupt & Append）

```typescript
/**
 * 中断当前执行并追加用户消息
 *
 * 与 stop() 的区别：
 * - stop() 终止 run()，触发 onEnd
 * - interrupt() 中止当前 stream/工具，但 run() 继续循环，
 *   在下一次迭代开始时注入用户追加消息并重新调用 LLM
 */
interrupt(appendMessage: string): void
```

**行为**：
1. 设置 `_interrupted = true`
2. 保存待追加的消息到 `_pendingAppendMessage`
3. 中止所有正在执行的工具（`toolDispatcher.abortAll()`）
4. 中止当前活跃的 stream（`stream.abort()` / `iterator.return()`）
5. run() 循环继续，在下一次迭代开始时注入追加消息并重新调用 LLM

**适用场景**：
- 用户输入的是"改变方向"（如"用英文"、"停止"、"换个思路"）
- 希望立即响应用户指令

## 解决方案

### 改动

**文件**：`src/adapters/cli/App.tsx` L1800

**改动前**：
```typescript
// [3] 触发新响应（Agent 会基于追加的消息继续输出）
agentLoop.appendMessage(input);
```

**改动后**：
```typescript
// [3] 中断当前执行并追加新消息（硬中断，立即响应）
// 使用 interrupt() 而不是 appendMessage()：
// - appendMessage() 是温和追加，不中断当前流式输出，LLM 会继续输出已生成的 token
// - interrupt() 是硬中断，立即停止流式输出和工具执行，基于追加消息重新生成
// 用户补充输入通常意味着"改变想法"（如"用英文"、"停止"），应立即响应
agentLoop.interrupt(input);
```

### 新流程

```
用户补充："使用英文总结"
  ↓
[1] 立即 flush 并归档当前流式文本到 Static  ✅ 保留已输出内容
  ↓
[2] 保存补充输入到 pending 队列            ✅ UI 显示绿色提示
  ↓
[3] 调用 agentLoop.interrupt(input)        ✅ 硬中断
  ↓
中止当前 stream 和工具                      ✅ 立即停止输出中文
  ↓
在下一次迭代注入追加消息并重新调用 LLM      ✅ 基于"使用英文总结"生成
  ↓
开始输出英文                               ✅ 立即响应
```

## 效果对比

### 改动前 ❌

```
[Static] ...历史
[动态] Agent 正在输出中文...
       • 提醒功能正常 ✅
       • reminder_set 成功 ✅

用户补充："使用英文总结"

[动态] ✓ 已收到 1 条补充
       最新：使用英文总结

       ... 继续输出中文一段时间 ❌
       • reminder_check 显示...
       • 命令执行正常 ✅

       ... 然后才开始输出英文
       • Reminder feature working ✅
```

### 改动后 ✅

```
[Static] ...历史
[动态] Agent 正在输出中文...
       • 提醒功能正常 ✅
       • reminder_set 成功 ✅

用户补充："使用英文总结"

[Static] ...历史
[Static] • 提醒功能正常 ✅          ✅ 已输出内容立即归档
       • reminder_set 成功 ✅

[动态] ✓ 已收到 1 条补充           ✅ 绿色提示
       最新：使用英文总结

       🤔 正在思考...                ✅ 立即停止中文输出

       • Reminder feature working ✅  ✅ 立即开始输出英文
       • reminder_set succeeded ✅
```

## 设计决策

### 为什么选择 `interrupt()` 而不是 `appendMessage()`？

#### 决策理由

1. **符合用户直觉**
   - 用户补充输入 = "我改变想法了"
   - 期望 Agent 立即响应新指令
   - 而不是"等你说完再听我的"

2. **与 Claude Code 行为一致**
   - Claude Code 使用硬中断
   - 用户已习惯这种交互模式

3. **大多数场景适用**
   - 用户补充输入通常是改变方向（"用英文"、"停止"、"简化"）
   - 而不是补充细节（"继续"在流式输出完成后输入）

4. **避免混乱**
   - 如果继续输出旧内容，用户会困惑："它听到我的指令了吗？"
   - 立即中断，明确告知"收到了"

#### 潜在场景：需要 `appendMessage()`？

如果用户输入的是"补充细节"而不是"改变方向"，`appendMessage()` 可能更合适。

例如：
```
Agent: "分析完成，发现 3 个问题..."
用户: "请继续分析性能问题"  ← 补充细节，不需要中断
```

但实际上，大多数情况下用户会在 Agent **完成输出后**（status = 'idle'）再输入补充内容，此时走的是正常提交流程，而不是补充输入流程。

只有在 Agent **执行期间**（status !== 'idle'）输入，才走补充输入流程。而在执行期间输入，通常意味着用户想"改变方向"。

### 可能的未来优化：智能判断

如果未来发现用户确实有"补充细节"的需求，可以考虑智能判断：

```typescript
function shouldInterrupt(input: string): boolean {
  const interruptKeywords = [
    '停止', 'stop', '换', 'change',
    '用英文', 'in english', '用中文', 'in chinese',
    '简化', 'simplify', '详细', 'detailed',
    '重新', 'restart', 'redo',
  ];

  const appendKeywords = [
    '继续', 'continue', '更多', 'more',
    '还有', 'also', '另外', 'additionally',
  ];

  const lowerInput = input.toLowerCase();

  if (interruptKeywords.some(kw => lowerInput.includes(kw))) {
    return true; // 硬中断
  }

  if (appendKeywords.some(kw => lowerInput.includes(kw))) {
    return false; // 温和追加
  }

  // 默认：硬中断（保守策略）
  return true;
}
```

但这会增加复杂度和不确定性，暂不实现。

## 副作用与注意事项

### 1. 工具执行被中断

**场景**：用户在 Read 工具执行期间补充输入

**行为**：
- `interrupt()` 会调用 `toolDispatcher.abortAll()`
- Read 工具被中断（如果支持 abort）
- 可能浪费已执行的工作

**缓解**：
- Read 工具通常很快（< 1s），中断影响小
- Bash 工具支持 abort（SIGTERM），可以安全中断

### 2. 长工具被中断浪费资源

**场景**：用户在 SubAgent 执行期间（可能运行数十秒）补充输入

**行为**：
- SubAgent 被中断
- 已生成的内容被丢弃

**权衡**：
- 用户体验 > 资源浪费
- 用户既然主动中断，说明愿意接受代价

### 3. 并行工具执行

**场景**：多个工具并行执行时，用户补充输入

**行为**：
- 所有并行工具都被中断
- 这可能不是用户期望的（只想中断某一个？）

**当前实现**：统一中断所有工具（简单清晰）

**未来优化**：可以考虑只中断流式输出，保留工具执行（复杂）

## 测试验证

### 类型检查

```bash
npm run typecheck  # ✅ 通过
```

### 手动测试场景

#### 场景 1：中文 → 英文切换

**步骤**：
1. 启动 xuanji：`npm run dev`
2. 输入："介绍一下 React 的 Hooks 机制"
3. 等待输出中文约 20 行
4. 输入："使用英文总结"
5. 观察行为

**预期结果**：
- ✅ 中文输出立即停止（不再继续输出中文）
- ✅ 已输出的中文内容归档到 Static
- ✅ 显示绿色提示："✓ 已收到 1 条补充"
- ✅ 立即开始输出英文（无延迟）

#### 场景 2：停止长输出

**步骤**：
1. 输入："列举 100 个编程术语并解释"
2. 等待输出进入缓冲模式（> 50 行）
3. 输入："停止，太长了"
4. 观察行为

**预期结果**：
- ✅ 缓冲模式立即停止
- ✅ 已输出内容归档
- ✅ Agent 响应"停止"指令（简短回复或停止）

#### 场景 3：工具执行期间中断

**步骤**：
1. 输入："读取 package.json 并分析所有依赖"
2. 在 Read 工具执行期间，输入："只关注 dependencies"
3. 观察行为

**预期结果**：
- ✅ Read 工具被中断（可能）
- ✅ Agent 基于新指令重新执行（只分析 dependencies）

#### 场景 4：快速连续补充

**步骤**：
1. 输入："介绍 TypeScript"
2. 快速连续输入：
   - "用英文"
   - "简化"
   - "举例"
3. 观察行为

**预期结果**：
- ✅ 队列保留所有 3 条补充
- ✅ 每次补充都立即中断当前输出
- ✅ 最后基于所有补充生成响应

## 向后兼容

- ✅ 不影响正常对话流程（`status === 'idle'`）
- ✅ 不影响 Ctrl+C 中断（`handleInterrupt`）
- ✅ 不影响 /stop 命令
- ✅ 只改变补充输入的响应行为（更快、更符合预期）

## 文档更新

- ✅ 实现总结：本文档
- ⏳ 测试计划：待创建（`doc/prd/xuanji/interrupt-append-test.md`）
- ⏳ 项目记忆：更新到 `MEMORY.md`

## 总结

通过将 `agentLoop.appendMessage()` 改为 `agentLoop.interrupt()`，解决了用户补充输入时 Agent 继续输出旧内容的问题。

核心改进：
- ✅ 立即停止当前流式输出（不再继续输出旧内容）
- ✅ 立即中断工具执行（如果有）
- ✅ 基于补充内容重新生成响应
- ✅ 符合用户直觉和 Claude Code 行为
- ✅ 只改动 1 行代码（`appendMessage` → `interrupt`）

现在用户补充输入时，Agent 会立即响应，不再出现"先继续输出中文，再输出英文"的割裂体验！🎉
