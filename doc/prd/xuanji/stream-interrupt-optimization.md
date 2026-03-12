# 流式输出期间用户输入优化方案

## 问题描述

当 Agent 正在流式输出内容时，如果用户补充输入新内容，当前的实现会在展示上**阻断流式输出**，造成视觉上的不连贯。

### 当前实现逻辑

1. 用户在 Agent 执行期间（`status !== 'idle'`）输入时，`handleSubmit` 会：
   ```typescript
   setMessages((prev) => [
     ...prev,
     { id: uid, role: 'user', content: input, timestamp: Date.now() },
     { id: sysId, role: 'system', content: '💬 追加消息', timestamp: Date.now() },
   ]);
   ```

2. 这会导致整个组件重新渲染，包括：
   - `<Static>` 区域（虽然内容不变，但组件树整体刷新）
   - 流式文本区域（`renderedStreamLines`）
   - 输入框区域

3. 视觉表现：
   - 用户看到消息历史突然新增两条记录
   - 流式输出的连续性被打断
   - 可能出现闪烁或跳动

### Claude Code 的行为

- 用户在执行期间输入时，**不会立即刷新消息历史**
- 在输入框附近显示一个小提示，告知用户输入已收到
- 流式输出继续在下方正常显示，不受影响
- 等流式输出完成后再将用户的追加消息添加到历史

## 优化方案

### 方案 A：延迟添加消息（推荐）

#### 核心思路
用户在执行期间输入时，不立即添加到消息历史，而是保存到 pending 状态，流式输出完成后再添加。

#### 具体实现

1. **新增状态**
   ```typescript
   const [pendingUserInput, setPendingUserInput] = useState<{
     content: string;
     timestamp: number;
   } | null>(null);
   ```

2. **修改 handleSubmit（执行期间分支）**
   ```typescript
   if (status !== 'idle') {
     // 保存到 pending 状态，不添加到消息历史
     setPendingUserInput({
       content: input,
       timestamp: Date.now(),
     });

     // 温和追加到 Agent
     agentLoop.appendMessage(input);
     return;
   }
   ```

3. **在输入框上方显示提示**
   ```typescript
   {/* 执行期间的用户输入提示 */}
   {pendingUserInput && status !== 'idle' && (
     <Box marginBottom={1}>
       <Text color="#10B981">✓ </Text>
       <Text color="gray">已收到补充：</Text>
       <Text color="#10B981">{pendingUserInput.content.slice(0, 50)}{pendingUserInput.content.length > 50 ? '...' : ''}</Text>
     </Box>
   )}
   ```

4. **在 onEnd 回调中添加到历史**
   ```typescript
   onEnd: (state: AgentState) => {
     // 归档流式文本
     const archived = archiveStreamText();

     // 添加 pending 用户输入到历史
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

     // ... 其余逻辑
   }
   ```

5. **在 handleStop 和 handleInterrupt 中也处理 pending**
   ```typescript
   const handleStop = useCallback(() => {
     // ... 现有逻辑

     // 中断时，也将 pending 输入添加到历史
     if (pendingUserInput) {
       const uid = ++msgIdRef.current;
       setMessages((prev) => [
         ...prev,
         { id: uid, role: 'user', content: pendingUserInput.content, timestamp: pendingUserInput.timestamp },
       ]);
       setPendingUserInput(null);
     }
   }, [/* ... */]);
   ```

#### 优势
- ✅ 流式输出完全不受影响，保持连续性
- ✅ 用户得到明确反馈（绿色提示）
- ✅ 符合 Claude Code 的 UX 设计
- ✅ 实现简单，改动小

#### 劣势
- ⚠️ 用户输入不会立即出现在消息历史中（但有提示，不是问题）

---

### 方案 B：优化渲染性能

#### 核心思路
保持现有逻辑，通过优化 React 渲染减少重新渲染范围。

#### 具体实现

1. **将流式文本区域提取为独立组件**
   ```typescript
   const StreamingOutput = React.memo(({ streamText, streamProgress, status }: {
     streamText: string;
     streamProgress: number;
     status: AgentState['status'];
   }) => {
     const renderedLines = useMemo(() => {
       if (!streamText) return null;
       return renderMarkdownSimple(streamText);
     }, [streamText]);

     // ... 渲染逻辑
   });
   ```

2. **使用 React.memo 优化其他组件**
   - `InputHandler`（已有优化）
   - `StatusBar`
   - `TodoPanel`

3. **使用 useCallback 稳定回调引用**
   - 确保 `handleSubmit` 等回调不会在每次渲染时重新创建

#### 优势
- ✅ 减少不必要的重新渲染
- ✅ 提升整体性能

#### 劣势
- ⚠️ 无法完全解决问题（setMessages 仍会触发 Static 刷新）
- ⚠️ 实现复杂度高
- ⚠️ 可能引入新的性能问题

---

## 推荐方案

**方案 A（延迟添加消息）** 是更优的选择：

1. **用户体验好**：流式输出完全不受影响，符合 Claude Code 的设计
2. **实现简单**：只需新增一个状态 + 修改 3-4 处逻辑
3. **性能友好**：避免执行期间的额外渲染
4. **符合语义**：用户的"补充输入"本就是追加到当前对话轮次的，延迟添加更合理

## 实现清单

- [ ] 新增 `pendingUserInput` 状态
- [ ] 修改 `handleSubmit` 中的执行期间分支
- [ ] 在输入框上方渲染 pending 提示
- [ ] 在 `onEnd` 回调中添加 pending 输入到历史
- [ ] 在 `handleStop` 回调中处理 pending 输入
- [ ] 在 `handleInterrupt` 回调中处理 pending 输入
- [ ] 测试以下场景：
  - [ ] 流式输出期间补充输入 → 提示显示 → 输出完成后添加到历史
  - [ ] 流式输出期间补充输入 → Ctrl+C 中断 → pending 输入被添加
  - [ ] 流式输出期间补充输入 → /stop 停止 → pending 输入被添加
  - [ ] 多次补充输入（仅保留最后一次）

## 附加优化（可选）

1. **支持多次补充输入**
   - 将 `pendingUserInput` 改为数组 `pendingUserInputs: Array<{ content, timestamp }>`
   - 每次输入追加到数组
   - onEnd 时批量添加到历史

2. **提示动画**
   - 添加渐变效果，让提示更醒目
   - 使用 `ink-gradient` 或自定义颜色动画

3. **可撤销输入**
   - 在提示中显示"按 Esc 撤销"
   - 用户按 Esc 时清除 pending 输入

## 参考资料

- Claude Code 行为观察：用户在执行期间输入时，输入框下方显示"+ 补充内容"，不影响流式输出
- Ink 渲染机制：`<Static>` 内容固定，动态区域重新渲染时会触发整体 diff
- React 性能优化：`React.memo`、`useMemo`、`useCallback` 的正确使用
