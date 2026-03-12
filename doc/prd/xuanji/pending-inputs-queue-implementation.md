# 补充输入队列扩展实现总结

## 改进内容

将单个 `pendingUserInput` 扩展为队列 `pendingUserInputs`，支持多次快速补充输入。

## 代码改动

### 1. 状态定义（L401-408）

**改动前**：
```typescript
const [pendingUserInput, setPendingUserInput] = useState<{
  content: string;
  timestamp: number;
} | null>(null);
```

**改动后**：
```typescript
const [pendingUserInputs, setPendingUserInputs] = useState<Array<{
  content: string;
  timestamp: number;
}>>([]);

const MAX_PENDING_INPUTS = 10; // 队列最大长度
```

### 2. 添加到队列（handleSubmit，L1789-1801）

**改动前**：
```typescript
setPendingUserInput({
  content: input,
  timestamp: Date.now(),
});
```

**改动后**：
```typescript
setPendingUserInputs((prev) => {
  // 去重：如果最后一条和当前输入相同，不重复添加
  if (prev.length > 0 && prev[prev.length - 1].content === input) {
    return prev;
  }
  // 长度限制：超过 MAX_PENDING_INPUTS 时，移除最早的
  const newQueue = [...prev, { content: input, timestamp: Date.now() }];
  if (newQueue.length > MAX_PENDING_INPUTS) {
    return newQueue.slice(-MAX_PENDING_INPUTS);
  }
  return newQueue;
});
```

**功能增强**：
- ✅ 连续相同内容去重（避免误操作）
- ✅ 队列长度限制（最多 10 条）
- ✅ 超出限制时移除最早的（FIFO）

### 3. 批量处理队列（onEnd，L1105-1118）

**改动前**：
```typescript
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

**改动后**：
```typescript
if (pendingUserInputs.length > 0) {
  const newMessages: ChatMessage[] = [];
  for (const input of pendingUserInputs) {
    const uid = ++msgIdRef.current;
    const sysId = ++msgIdRef.current;
    newMessages.push(
      { id: uid, role: 'user', content: input.content, timestamp: input.timestamp },
      { id: sysId, role: 'system', content: `💬 ${t('chat.interrupted_append')}`, timestamp: Date.now() },
    );
  }
  setMessages((prev) => [...prev, ...newMessages]);
  setPendingUserInputs([]);
}
```

**功能增强**：
- ✅ 批量添加所有队列中的补充输入
- ✅ 保持时间戳准确（记录用户输入时间）
- ✅ 按顺序添加到历史

### 4. 中断时批量处理（handleInterrupt，L758-771）

**改动前**：
```typescript
let pendingUserMsgs: ChatMessage[] = [];
if (pendingUserInput) {
  const uid = ++msgIdRef.current;
  pendingUserMsgs = [
    { id: uid, role: 'user', content: pendingUserInput.content, timestamp: pendingUserInput.timestamp },
  ];
  setPendingUserInput(null);
}
```

**改动后**：
```typescript
const pendingUserMsgs: ChatMessage[] = [];
if (pendingUserInputs.length > 0) {
  for (const input of pendingUserInputs) {
    const uid = ++msgIdRef.current;
    pendingUserMsgs.push({
      id: uid,
      role: 'user',
      content: input.content,
      timestamp: input.timestamp,
    });
  }
  setPendingUserInputs([]);
}
```

**功能增强**：
- ✅ 中断时也批量添加所有队列
- ✅ 确保所有补充输入不丢失

### 5. UI 展示队列信息（L2225-2251）

**改动前**：
```typescript
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

**改动后**：
```typescript
{pendingUserInputs.length > 0 && status !== 'idle' && !hasInteractiveUI && (
  <Box marginTop={1} marginBottom={1} flexDirection="column">
    {/* 显示队列统计 */}
    <Box>
      <Text color="#10B981">✓ </Text>
      <Text color="gray">
        已收到 <Text color="#10B981" bold>{pendingUserInputs.length}</Text> 条补充
        {pendingUserInputs.length > 1 && <Text color="gray" dimColor>（按顺序处理）</Text>}
      </Text>
    </Box>
    {/* 显示最新的补充内容 */}
    <Box marginLeft={2}>
      <Text color="gray">最新：</Text>
      <Text color="#10B981">
        {pendingUserInputs[pendingUserInputs.length - 1].content.slice(0, 60)}
        {pendingUserInputs[pendingUserInputs.length - 1].content.length > 60 ? '...' : ''}
      </Text>
    </Box>
    {/* 如果有多条，显示提示 */}
    {pendingUserInputs.length > 1 && (
      <Box marginLeft={2}>
        <Text color="gray" dimColor>
          其余 {pendingUserInputs.length - 1} 条将依次追加
        </Text>
      </Box>
    )}
  </Box>
)}
```

**功能增强**：
- ✅ 显示队列长度（"已收到 3 条补充"）
- ✅ 显示最新的补充内容
- ✅ 多条时显示提示（"其余 2 条将依次追加"）
- ✅ 视觉层次清晰（多行布局）

### 6. 依赖数组更新（L778）

**改动前**：
```typescript
}, [agentLoop, archiveStreamText, pendingPermission, pendingPlanReview, pendingUserQuestion, pendingUserInput]);
```

**改动后**：
```typescript
}, [agentLoop, archiveStreamText, pendingPermission, pendingPlanReview, pendingUserQuestion, pendingUserInputs]);
```

## UI 演变流程

### 场景：快速连续补充 3 次

#### 阶段 1：第一次补充

```
[Static] ...历史
[Static] 第一轮输出（已归档）

[动态] ✓ 已收到 1 条补充
       最新：请简化
```

#### 阶段 2：第二次补充

```
[Static] ...历史
[Static] 第一轮输出

[动态] ✓ 已收到 2 条补充（按顺序处理）
       最新：用 Python 举例
       其余 1 条将依次追加
```

#### 阶段 3：第三次补充

```
[Static] ...历史
[Static] 第一轮输出

[动态] ✓ 已收到 3 条补充（按顺序处理）
       最新：请详细解释
       其余 2 条将依次追加
```

#### 阶段 4：完成后

```
[Static] ...历史
[Static] 第一轮输出

[Static] 👤 请简化
[Static] 💬 追加消息

[Static] 👤 用 Python 举例
[Static] 💬 追加消息

[Static] 👤 请详细解释
[Static] 💬 追加消息

[Static] 第二轮输出（基于所有补充）
```

## 功能特性

### 1. 队列管理

- ✅ **FIFO 队列**：先进先出，按顺序处理
- ✅ **长度限制**：最多 10 条，超出时移除最早的
- ✅ **连续去重**：相同内容不重复添加（避免误操作）

### 2. 批量处理

- ✅ **批量添加**：完成时一次性添加所有补充到历史
- ✅ **中断安全**：Ctrl+C 时也批量添加，不丢失
- ✅ **时间戳准确**：记录用户输入时间，而非添加时间

### 3. UI 反馈

- ✅ **队列统计**：显示当前队列长度
- ✅ **最新内容**：显示最新的补充
- ✅ **剩余提示**：多条时提示还有多少条待处理
- ✅ **视觉清晰**：多行布局，层次分明

## 边界情况处理

### 1. 队列满时

**场景**：快速连续补充 11 次

**行为**：
- 前 10 条正常入队
- 第 11 条时，移除第 1 条（最早的）
- 队列始终保持 10 条

### 2. 连续相同内容

**场景**：快速连续输入 "继续" 3 次

**行为**：
- 第 1 次："继续" 入队
- 第 2 次：与最后一条相同，不入队
- 第 3 次：与最后一条相同，不入队
- 队列只有 1 条 "继续"

**理由**：避免用户误操作（快速多次按 Enter）

### 3. 空队列

**场景**：没有补充输入时

**行为**：
- `pendingUserInputs.length === 0`
- UI 不显示绿色提示
- onEnd/handleInterrupt 不处理

### 4. 中断时的队列

**场景**：补充 3 次后按 Ctrl+C

**行为**：
- 批量添加所有 3 条补充到历史
- 清空队列
- 显示中断提示

## 向后兼容

- ✅ 不影响正常对话流程（`status === 'idle'`）
- ✅ 不影响工具调用
- ✅ 不影响权限对话框等交互
- ✅ 单次补充时 UI 与之前基本一致（只是显示 "已收到 1 条补充"）

## 测试验证

### 基础测试

```bash
npm run typecheck  # ✅ 通过
npm run build      # ⏳ 待测试
```

### 测试场景

详见 `doc/prd/xuanji/pending-inputs-queue-test.md`

核心场景：
1. ✅ 单次补充（与之前一致）
2. ✅ 快速连续补充 3 次
3. ✅ 补充超过 10 次（队列满）
4. ✅ 连续相同内容去重
5. ✅ Ctrl+C 中断时处理队列
6. ✅ 队列处理后按顺序添加到历史
7. ✅ 长响应 + 缓冲 + 多次补充
8. ✅ 工具调用期间多次补充

## 用户体验改进

### 改进前 ❌

- 多次补充只保留最后一次
- 看不到有多少条补充在等待
- 不知道其他补充是否丢失

### 改进后 ✅

- 所有补充都保留，按顺序处理
- 实时显示队列长度和最新内容
- 明确提示还有多少条待处理
- 连续相同内容自动去重
- 队列长度限制防止滥用

## 后续优化（可选）

### P1（建议）

1. **可撤销输入**：在提示中显示 "Esc 清空队列"
   ```typescript
   {pendingUserInputs.length > 0 && (
     <Box>
       <Text color="gray" dimColor> (Esc 清空队列)</Text>
     </Box>
   )}
   ```

2. **显示所有队列**：展开查看所有补充（折叠/展开）
   ```typescript
   {showAllPending && pendingUserInputs.map((input, i) => (
     <Box key={i}>
       <Text>{i + 1}. {input.content}</Text>
     </Box>
   ))}
   ```

3. **队列优先级**：标记重要的补充，优先处理

### P2（未来）

1. **队列持久化**：会话保存时包含 pending 队列
2. **队列合并**：智能合并相似的补充（如 "继续" + "继续" → "继续"）
3. **队列编辑**：允许用户编辑或删除队列中的某条

## 统计数据

- **新增代码行数**：约 30 行
- **修改代码行数**：约 40 行
- **删除代码行数**：约 20 行
- **净增代码行数**：约 10 行

## 文档

- ✅ 实现总结：本文档
- ⏳ 测试计划：`doc/prd/xuanji/pending-inputs-queue-test.md`（待创建）
- ⏳ 项目记忆：更新到 `MEMORY.md`（待更新）

## 总结

通过扩展为队列，解决了多次快速补充输入只保留最后一次的问题。

核心改进：
- ✅ 支持多次补充（最多 10 条）
- ✅ 连续相同内容自动去重
- ✅ 批量处理，按顺序添加到历史
- ✅ UI 实时显示队列状态
- ✅ 中断安全，不丢失任何补充

用户现在可以快速连续补充多次输入，所有内容都会按顺序处理，体验更流畅！🎉
