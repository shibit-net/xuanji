# 流式输出优化实现总结

## 问题

用户在 Agent 流式输出期间补充输入新内容时，当前实现会立即调用 `setMessages` 添加消息到历史记录，导致整个组件重新渲染，**视觉上阻断了流式输出**。

## 解决方案

采用**延迟添加消息**的策略，参考 Claude Code 的行为：

1. 用户在执行期间输入时，不立即添加到消息历史
2. 保存到 `pendingUserInput` 状态
3. 在输入框上方显示绿色提示："✓ 已收到补充：{内容}"
4. 流式输出完成后（`onEnd`）或中断时（`handleInterrupt`）再添加到历史

## 代码改动

### 1. 新增状态（App.tsx L403-406）

```typescript
// 执行期间的用户补充输入：延迟添加到历史，避免阻断流式输出
const [pendingUserInput, setPendingUserInput] = useState<{
  content: string;
  timestamp: number;
} | null>(null);
```

### 2. 修改 handleSubmit（App.tsx L1745-1753）

```typescript
if (status !== 'idle') {
  // 保存到 pending 状态，不立即添加到消息历史（避免阻断流式输出）
  setPendingUserInput({
    content: input,
    timestamp: Date.now(),
  });

  // 温和追加到 Agent
  agentLoop.appendMessage(input);
  return;
}
```

**变化**：
- ❌ 删除：`setMessages` 立即添加用户消息和系统提示
- ✅ 新增：`setPendingUserInput` 保存到 pending 状态

### 3. 在 onEnd 回调中处理（App.tsx L1092-1102）

```typescript
// 处理 pending 用户输入：流式输出完成后添加到历史
if (pendingUserInput) {
  const uid = ++msgIdRef.current;
  const sysId = ++msgIdRef.current;
  setMessages((prev) => [
    ...prev,
    { id: uid, role: 'user', content: pendingUserInput.content, timestamp: pendingUserInput.timestamp },
    { id: sysId, role: 'system', content: `💬 ${t('chat.interrupted_append')}`, timestamp: Date.now() },
  ]);
  setPendingUserInput(null);
}
```

### 4. 在 handleInterrupt 中处理（App.tsx L750-761）

```typescript
// 处理 pending 用户输入：中断时也添加到历史
let pendingUserMsgs: ChatMessage[] = [];
if (pendingUserInput) {
  const uid = ++msgIdRef.current;
  pendingUserMsgs = [
    { id: uid, role: 'user', content: pendingUserInput.content, timestamp: pendingUserInput.timestamp },
  ];
  setPendingUserInput(null);
}

// 显示中断提示（合并 pending 工具消息和用户消息一起 flush）
const id = ++msgIdRef.current;
setMessages((prev) => [...prev, ...pendingMsgs, ...pendingUserMsgs, {
  id,
  role: 'system',
  content: `⏸️  ${t('chat.session_interrupted')}`,
  timestamp: Date.now(),
}]);
```

**变化**：
- 在中断提示之前先添加 pending 用户消息
- 更新 dependency array 包含 `pendingUserInput`

### 5. 渲染 pending 提示（App.tsx L2198-2208）

```typescript
{/* 执行期间的用户补充输入提示 */}
{pendingUserInput && status !== 'idle' && !hasInteractiveUI && (
  <Box marginTop={1} marginBottom={1}>
    <Text color="#10B981">✓ </Text>
    <Text color="gray">已收到补充：</Text>
    <Text color="#10B981">
      {pendingUserInput.content.slice(0, 60)}
      {pendingUserInput.content.length > 60 ? '...' : ''}
    </Text>
  </Box>
)}
```

**位置**：在输入框（`<InputHandler>`）之前

**条件**：
- `pendingUserInput` 存在
- `status !== 'idle'`（执行期间）
- `!hasInteractiveUI`（无交互对话框）

## 效果

### 优化前

```
[用户输入补充内容]
↓
立即 setMessages
↓
整个组件重新渲染
↓
流式输出被"阻断"（视觉跳动）
```

### 优化后

```
[用户输入补充内容]
↓
setPendingUserInput（不触发渲染）
↓
显示绿色提示
↓
流式输出继续（完全不受影响）
↓
流式完成后添加到历史
```

## 用户体验改进

1. **视觉连续性**：流式输出不再被打断，阅读体验更好
2. **明确反馈**：绿色提示告知用户输入已收到
3. **性能优化**：减少不必要的组件渲染
4. **符合直觉**：与 Claude Code 行为一致

## 已知限制

1. **单个 pending 输入**：多次补充会覆盖（未来可扩展为数组）
2. **无撤销机制**：用户无法撤销 pending 输入（可添加 Esc 键）
3. **提示位置固定**：在输入框上方（可考虑添加动画）

## 测试覆盖

详见 `doc/prd/xuanji/stream-interrupt-optimization-test.md`

- ✅ 流式输出期间补充输入
- ✅ 多次补充输入（仅保留最后一次）
- ✅ Ctrl+C 中断
- ✅ 工具调用期间补充
- ✅ 长文本截断显示
- ✅ 正常输入不受影响
- ✅ 交互对话框场景

## 编译验证

```bash
npm run typecheck  # ✅ 通过
npm run build      # ✅ 成功
```

## 相关文档

- 优化方案：`doc/prd/xuanji/stream-interrupt-optimization.md`
- 测试计划：`doc/prd/xuanji/stream-interrupt-optimization-test.md`
- 项目记忆：已更新到 `.claude/projects/*/memory/MEMORY.md`

## 后续优化（可选）

1. 支持多次补充输入（数组存储）
2. 添加撤销功能（Esc 键）
3. 提示动画效果（渐变、闪烁）
4. 长补充内容优化（多行显示）
5. 持久化 pending 输入（会话保存）
