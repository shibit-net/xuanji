# 补充输入竞态条件修复

## 执行时间
2026-03-05 14:30

## 问题描述

用户测试"方式1"（立即中断，清除重来）时发现两个问题：

### 问题1：输入后按回车，但是没有收到补充提示

**现象**：
- 用户看到流式输出仍在显示（例如中文内容）
- 输入补充内容（如"使用英文描述"）
- 补充输入没有进入处理逻辑
- 被当作新对话处理

**根本原因**：
竞态条件（Race Condition）

```typescript
// onEnd 时立即设置 status = 'idle'
onEnd: () => {
  setStatus('idle');  // ← status 立即变 idle
  // ...
}

// 但 streamText 还在显示（throttled updater 还没清空）
// 用户看到：状态显示正在输出，所以输入补充

// handleSubmit 判断
if (status !== 'idle') {  // ← status 已经是 'idle'，条件失败！
  // 补充输入逻辑
}
```

**时序图**：
```
t=0     Agent 输出完成
t=1     onEnd 触发 → setStatus('idle')
t=2     streamText 仍显示内容（React 还没重新渲染）
t=3     用户看到内容，输入补充："使用英文"
t=4     handleSubmit 检查 status === 'idle' → 失败
t=5     补充输入被当作新对话
```

---

## 修复方案

### 修复1：增加 streamText 判断

**位置**：`src/adapters/cli/App.tsx` L1812-1813（handleSubmit）

```typescript
// 修复前
if (status !== 'idle') {
  // 补充输入逻辑
}

// 修复后
const hasStreamContent = streamText.length > 0 || streamTextRef.current.length > 0;
const isAgentBusy = status !== 'idle' || hasStreamContent;

if (isAgentBusy) {
  // 补充输入逻辑
}
```

**改进点**：
- ✅ 不仅检查 `status`，还检查是否有流式内容显示
- ✅ 即使 `status === 'idle'`，只要有内容显示，就认为 Agent 仍在繁忙
- ✅ 符合用户直觉：只要看到内容，就应该能补充输入

---

### 修复2：提示显示条件优化

**问题**：
- 用户的测试显示："补充内容的提示也消失了"
- 原因：提示条件只检查 `status !== 'idle'`
- 当 status 变 'idle' 但内容还在显示时，提示立即消失

**位置**：`src/adapters/cli/App.tsx` L2015-2027（useMemo）

```typescript
// 新增 useMemo：计算 Agent 繁忙状态
const hasStreamContent = useMemo(() => {
  return streamText.length > 0 || streamTextRef.current.length > 0;
}, [streamText]);

const isAgentBusy = useMemo(() => {
  return status !== 'idle' || hasStreamContent;
}, [status, hasStreamContent]);
```

**位置**：`src/adapters/cli/App.tsx` L2379, L2410（提示显示条件）

```typescript
// 修复前
{pendingUserInputs.length > 0 && status !== 'idle' && !hasInteractiveUI && (
  // 补充输入队列提示
)}

{processingAppend && status !== 'idle' && !hasInteractiveUI && (
  // 处理中提示
)}

// 修复后
{pendingUserInputs.length > 0 && isAgentBusy && !hasInteractiveUI && (
  // 补充输入队列提示
)}

{processingAppend && isAgentBusy && !hasInteractiveUI && (
  // 处理中提示
)}
```

**改进点**：
- ✅ 提示不会因为 status 变 'idle' 而立即消失
- ✅ 只要有内容显示，提示就保持显示
- ✅ 用户体验更好，不会看到提示"闪现"

---

### 问题2：清除后内容仍然显示

**现象**：
用户的 DEBUG 输出显示：
```
[DEBUG] 清除前 - streamTextRef: 根据项目文档...（有内容）
[DEBUG] 清除前 - streamText state: （空的！）
```

**根本原因**：
- `streamTextRef.current` 有内容（新 token 追加到 ref）
- `streamText` state 是空的（throttled updater 还没 flush）
- 清除时只清除了 ref 和 state
- 但 state 本来就是空的，清除它没有视觉效果

**问题分析**：
```typescript
// throttled updater 每 100ms flush 一次
streamTextRef.current += text;  // ← 新 token 追加到 ref
streamTextUpdater.update(streamTextRef.current);  // ← 节流更新

// 用户在 100ms 内输入补充
// 此时：ref 有内容，state 还是空的

// 清除
streamTextRef.current = '';  // ← 清除 ref
setStreamText('');           // ← 清除 state（本来就是空的！）

// 结果：用户看不到清除效果，因为 state 本来就没显示内容
```

---

### 修复3：先 flush 再清除

**位置**：`src/adapters/cli/App.tsx` L1820-1840

```typescript
// 修复前
// 直接清除
streamTextRef.current = '';
setStreamText('');
ignoreStreamTextRef.current = true;
streamBufferedRef.current = false;
setStreamProgress(0);

// 然后 flush（但已经清空了，flush 无效）
if (streamTextUpdaterRef.current) {
  streamTextUpdaterRef.current.flush();
}

// 修复后
// 先 flush 确保 ref 和 state 同步
if (streamTextUpdaterRef.current) {
  streamTextUpdaterRef.current.flush();
}

// 再清除（此时 state 已经有内容，清除有视觉效果）
streamTextRef.current = '';
setStreamText('');
ignoreStreamTextRef.current = true;
streamBufferedRef.current = false;
setStreamProgress(0);

// 删除后续的重复 flush 调用
```

**改进点**：
- ✅ 先 flush 让 ref 同步到 state
- ✅ 用户看到内容瞬间显示（如果之前没显示）
- ✅ 然后立即清除，用户看到"清除"的视觉效果
- ✅ 符合直觉：内容出现 → 立即消失 → 重新生成

---

## 修复后的完整流程

```
用户：总结项目结构
助手：项目结构包括...（中文流式输出）
  ↓
Agent 输出完成 → onEnd 触发
  ↓
setStatus('idle')  ← status 变 idle
  ↓
streamText 仍显示中文内容（React 还没重新渲染/throttled updater 还没清空）
  ↓
用户输入补充："使用英文描述"
  ↓
handleSubmit 判断：
  hasStreamContent = true（streamText 或 streamTextRef 有内容）
  isAgentBusy = status !== 'idle' || hasStreamContent
  isAgentBusy = true  ← 通过！
  ↓
进入补充输入逻辑：
  1. flush 流式文本更新器 → streamText 显示所有内容
  2. 清除 streamTextRef 和 streamText → 内容消失
  3. 设置 ignoreStreamTextRef = true → 阻止旧流追加
  4. 清除缓冲模式标志
  ↓
添加到 pending 队列
  ↓
显示 "✓ 已收到 1 条补充"（isAgentBusy = true，提示不消失）
  ↓
100ms debounce
  ↓
检查 AgentLoop 状态
  ↓
调用 interrupt(input)
  ↓
显示 "⏳ 正在处理补充输入..."（isAgentBusy = true，提示不消失）
  ↓
旧流检测到 _interrupted，退出循环
  ↓
新流开始 → onThinking
  ↓
重置 ignoreStreamTextRef = false
  ↓
清除 processingAppend
  ↓
新流输出英文内容
```

---

## 关键改进点

### 改进1：竞态条件修复

**问题**：
- status 变 idle 但内容还在显示
- 用户输入补充被当作新对话

**修复**：
- 增加 `hasStreamContent` 判断
- `isAgentBusy = status !== 'idle' || hasStreamContent`
- 只要有内容显示，就认为 Agent 繁忙

---

### 改进2：提示不消失

**问题**：
- 提示条件只检查 `status !== 'idle'`
- status 变 idle 后提示立即消失

**修复**：
- 新增 useMemo 计算 `isAgentBusy`
- 提示条件改为 `isAgentBusy`
- 只要有内容显示，提示就保持显示

---

### 改进3：清除可见

**问题**：
- ref 有内容但 state 是空的
- 清除 state 没有视觉效果

**修复**：
- 先 flush 让 ref 同步到 state
- 用户看到内容瞬间显示
- 然后立即清除，用户看到清除效果

---

## 测试验证

### 测试步骤

1. 重启 xuanji：`npm run dev`
2. 输入：`总结一下 xuanji 项目结构`
3. 等待流式输出完成（观察中文输出完全结束）
4. 此时 status 已经是 'idle'，但内容仍在显示
5. 输入补充：`使用英文描述`

### 预期结果

- ✅ DEBUG 日志显示：
  ```
  [DEBUG] 判断 - status: idle, hasStreamContent: true, isAgentBusy: true
  [DEBUG] 补充输入 - status: idle, input: 使用英文描述
  ```
- ✅ 显示 "✓ 已收到 1 条补充"（不消失）
- ✅ 中文内容立即消失（flush → clear）
- ✅ 显示 "⏳ 正在处理补充输入..."（不消失）
- ✅ 新的英文输出开始
- ✅ 提示消失，只显示英文内容

### 观察重点

1. **补充输入是否进入逻辑**：DEBUG 日志显示 `isAgentBusy: true`
2. **提示是否保持显示**：不应该闪现后消失
3. **内容是否立即清除**：中文内容应该瞬间消失
4. **新输出是否纯净**：只有英文，无中文残留

---

## 总结

✅ **核心改进**：
- 修复竞态条件：增加 streamText 判断
- 提示不消失：使用 isAgentBusy 状态
- 清除可见：先 flush 再清除

✅ **预期效果**：
- 输出完成后仍可补充输入（即使 status 是 'idle'）
- 提示保持显示，不会闪现
- 内容立即清除，视觉效果明显
- 新输出纯净，无混合

🎯 **下一步**：
- 运行测试验证修复
- 如果正常，删除 DEBUG 日志
- 更新测试文档
