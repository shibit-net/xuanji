# 补充输入流式输出交互重新设计方案

## 当前问题分析

### 问题现象

1. **内容被清除**：用户补充输入后，已流式输出的内容消失
2. **缓冲模式失效**：之前触发的缓冲模式（超过 50 行）被重置，继续输出后面内容
3. **多处截断**：整体展示不完整，有多处内容缺失

### 问题根因

```typescript
// 当前流程（有问题）
用户补充输入 → setPendingUserInput() → agentLoop.appendMessage()
                                              ↓
                                     触发新一轮 LLM 响应
                                              ↓
                                          onThinking()
                                              ↓
                                    检查 streamTextRef.current
                                              ↓
                                      archiveStreamText()
                                              ↓
                          清除 streamTextRef + 清除缓冲模式状态
                                              ↓
                                    新输出从空白开始
```

**核心问题**：
- `onThinking` 在新响应开始时被调用，此时调用 `archiveStreamText()` 清除了之前的流式文本
- 缓冲模式状态（`streamBufferedRef.current`）被重置为 `false`
- 用户看不到之前输出的内容，体验割裂

## 设计目标

1. ✅ **内容完整**：保留所有已输出内容，不丢失
2. ✅ **视觉连续**：流式输出不中断，过渡自然
3. ✅ **状态正确**：缓冲模式在新输出时重新计算
4. ✅ **分段清晰**：区分第一轮响应、补充提示、第二轮响应
5. ✅ **性能友好**：避免频繁渲染和闪烁

## 优化方案

### 方案 A：立即归档 + 分段显示（推荐）

#### 核心思路

用户补充输入时，**立即归档当前流式文本**，避免 `onThinking` 时清除。

#### 执行流程

```typescript
用户补充输入
  ↓
[1] 立即 flush throttled updater，获取最新流式文本
  ↓
[2] 归档当前流式文本到 Static（archiveStreamText）
  ↓
[3] 清空 streamTextRef，重置缓冲模式状态
  ↓
[4] 保存补充内容到 pendingUserInput（动态区域显示绿色提示）
  ↓
[5] 调用 agentLoop.appendMessage() 触发新响应
  ↓
[6] 新流式输出在动态区域显示（重新计算行数，重新触发缓冲）
  ↓
[7] onThinking 被调用时，streamTextRef 已经是空的，不会重复归档
  ↓
[8] onEnd 时：
    - 归档新的流式文本到 Static
    - 在合适位置插入补充输入消息（第一轮和第二轮之间）
    - 清空 pendingUserInput
```

#### 用户视角的 UI 演变

**阶段 1：初始响应**
```
[Static] ...之前的对话历史
[动态] 正在生成第一轮内容...(流式输出)
       Hello, I'm Claude...
       [继续输出 100 行]
       [触发缓冲模式]
       🔄 生成中... (150 行)
```

**阶段 2：用户补充输入**
```
[Static] ...之前的对话历史
[Static] Hello, I'm Claude...(第一轮完整内容，已归档)
[动态] ✓ 已收到补充：请用更简洁的语言(绿色提示)
```

**阶段 3：新响应开始**
```
[Static] ...之前的对话历史
[Static] Hello, I'm Claude...(第一轮完整内容)
[动态] ✓ 已收到补充：请用更简洁的语言(绿色提示)
[动态] 正在生成新内容...(第二轮流式输出)
       Sure, let me simplify...
```

**阶段 4：完成**
```
[Static] ...之前的对话历史
[Static] Hello, I'm Claude...(第一轮完整内容)
[Static] 👤 请用更简洁的语言(补充输入)
[Static] 💬 追加消息
[Static] Sure, let me simplify...(第二轮完整内容)
```

#### 实现要点

1. **立即归档**：在 `handleSubmit` 的执行期间分支中调用 `archiveStreamText()`
2. **Pending 位置**：保存补充输入在 `onEnd` 时插入到历史的正确位置
3. **缓冲重置**：归档时重置缓冲模式，新输出重新计算
4. **onThinking 防御**：检查 `streamTextRef.current` 是否为空，避免重复归档

### 方案 B：延迟触发 + 等待完成

#### 核心思路

用户补充输入时，不立即调用 `appendMessage()`，等待当前响应完成。

#### 执行流程

```typescript
用户补充输入
  ↓
[1] 保存到 pendingUserInput（显示绿色提示）
  ↓
[2] **不调用** agentLoop.appendMessage()
  ↓
[3] 当前流式输出继续（不受影响）
  ↓
[4] onEnd 时：
    - 归档流式文本
    - 添加补充输入到历史
    - 调用 agentLoop.appendMessage() 触发新响应
  ↓
[5] 新响应开始，继续流式输出
```

#### 优缺点

优点：
- ✅ 当前响应不被打断，完整输出
- ✅ 逻辑简单，不需要提前归档

缺点：
- ❌ 响应延迟：用户需要等待当前响应完成才能看到补充效果
- ❌ 如果当前响应很长（如缓冲模式 500+ 行），等待时间可能数十秒

### 方案对比

| 维度 | 方案 A（立即归档） | 方案 B（延迟触发） |
|------|-------------------|-------------------|
| 响应速度 | ✅ 快（立即触发） | ❌ 慢（需等待） |
| 内容完整性 | ✅ 完整保留 | ✅ 完整保留 |
| 视觉连续性 | ✅ 分段清晰 | ✅ 不中断 |
| 实现复杂度 | ⚠️ 中等 | ✅ 简单 |
| 用户体验 | ✅ 响应及时 | ⚠️ 可能等待较久 |

## 推荐方案：方案 A（立即归档 + 分段显示）

理由：
1. **响应及时**：用户补充输入后立即看到效果
2. **内容完整**：已输出内容归档到 Static，不丢失
3. **分段清晰**：第一轮、补充、第二轮界限明确
4. **符合直觉**：与 Claude Code 行为接近

## 实现清单

### 代码改动

#### 1. 修改 `handleSubmit` 中的执行期间分支

```typescript
if (status !== 'idle') {
  // [1] 立即 flush 并归档当前流式文本
  if (streamTextUpdaterRef.current) {
    streamTextUpdaterRef.current.flush();
  }
  archiveStreamText();  // 关键：提前归档，避免 onThinking 清除

  // [2] 保存补充输入（动态区域显示提示）
  setPendingUserInput({
    content: input,
    timestamp: Date.now(),
  });

  // [3] 触发新响应
  agentLoop.appendMessage(input);
  return;
}
```

#### 2. 优化 `onThinking` 的归档逻辑

```typescript
onThinking: (_thinking: string) => {
  // 工具调用后重新进入 thinking：将已有的流式文本归档到 Static
  // 防御：只有在 streamTextRef 有内容时才归档
  if (streamTextRef.current) {
    streamTextUpdater.flush();
    archiveStreamText();
  }
  dispatchTool({ type: 'SET_THINKING' });
},
```

#### 3. 优化 `onEnd` 中的补充输入处理

```typescript
onEnd: (state: AgentState) => {
  // ... 现有逻辑

  // 处理 pending 用户输入：添加到历史（位置在第一轮和第二轮之间）
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
},
```

#### 4. 优化 `handleInterrupt` 的补充输入处理

保持不变，已经正确处理。

### 测试场景

1. **短响应 + 补充**：
   - 输入："介绍一下 React"
   - 流式输出 10 行时补充："请简化"
   - 预期：第一轮 10 行归档 → 提示 → 第二轮输出

2. **长响应 + 缓冲 + 补充**：
   - 输入："写一篇长文"
   - 流式输出 100 行，触发缓冲模式时补充："停止输出"
   - 预期：第一轮 100 行归档 → 提示 → 停止

3. **多次补充**（当前限制）：
   - 输入："解释递归"
   - 补充 1："请举例"
   - 补充 2："用 Python"
   - 预期：只保留最后一次补充

4. **Ctrl+C 中断**：
   - 输入："长文"
   - 补充："简化"
   - 立即 Ctrl+C
   - 预期：第一轮归档 → 补充添加到历史 → 中断提示

### UI 优化

#### 补充输入提示（动态区域）

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

#### 可选：添加分隔线

在第一轮和第二轮之间添加视觉分隔（可选）：

```typescript
// onEnd 中，在添加补充输入前
if (pendingUserInput) {
  const separatorId = ++msgIdRef.current;
  setMessages((prev) => [
    ...prev,
    { id: separatorId, role: 'system', content: '─── 追加输入 ───', timestamp: Date.now() },
    // ... 补充输入消息
  ]);
}
```

## 后续优化（可选）

1. **支持多次补充**：将 `pendingUserInput` 改为数组，支持队列
2. **可撤销输入**：在提示中显示 "Esc 撤销"，按 Esc 清空 pending
3. **智能合并**：如果补充内容很短（如"继续"），可以不归档第一轮，直接追加
4. **补充历史**：记录用户的补充习惯，提供快捷补充选项

## 风险与注意事项

1. **性能**：立即归档会触发 `setMessages`，可能有短暂闪烁
   - 缓解：使用 `React.memo` 优化组件
2. **并发**：快速连续补充时，确保状态一致性
   - 防御：在 `appendMessage` 中检查状态
3. **长文本**：第一轮输出很长时，归档到 Static 可能卡顿
   - 缓解：使用虚拟滚动（如 `react-window`），但 Ink 不支持
   - 备选：限制 Static 显示的最大行数

## 实现优先级

### P0（必须）
- ✅ 修改 `handleSubmit` 立即归档逻辑
- ✅ 优化 `onThinking` 防御性检查
- ✅ 确保缓冲模式在新输出时重置

### P1（建议）
- ⚠️ 添加分隔线（可选）
- ⚠️ 优化提示样式（图标、颜色）

### P2（未来）
- 🔮 支持多次补充（数组）
- 🔮 可撤销输入（Esc 键）
- 🔮 智能合并短补充
