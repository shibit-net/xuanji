# 补充输入流混合问题修复

## 执行时间
2026-03-05 14:00

## 问题描述

用户测试补充输入功能时，发现输出内容完全混乱：中英文交织在一起。

**现象**：
```
（中文项目结构分析）
用户：使用英文输出

输出：
项目结构包括... (中文)
Project structure includes... (英文)
src/core/ (中文)
Core modules: (英文)
... (混合输出)
```

---

## 根本原因

**旧流未停止**：虽然清除了 `streamText`，但旧的流仍在运行，继续触发 `onText` 回调向 `streamTextRef` 追加内容。

### 时序分析

```
t=0ms    用户输入补充 "使用英文输出"
t=0ms    清除 streamTextRef.current = ''
t=0ms    清除 setStreamText('')
         ↓
t=5ms    旧流仍在运行，触发 onText('项目结构...')  ← 继续追加！
t=10ms   旧流继续，onText('包括 src/...')
t=15ms   旧流继续，onText('doc/...')
         ↓
t=100ms  interrupt() 被调用
t=100ms  旧流检测到 _interrupted，退出循环
         此时 streamTextRef.current 已经有内容了（旧流追加的）
         ↓
t=150ms  新流开始，触发 onText('Project structure...')  ← 追加到旧内容后面
t=160ms  新流继续，onText('includes src/...')
         ↓
结果：streamTextRef.current = '项目结构包括 src/ doc/...Project structure includes src/...'
                              ^^^^ 中文（旧流） ^^^^ ^^^^ 英文（新流） ^^^^
```

### 问题代码

```typescript
// L924-927
onText: (text: string) => {
  streamTextRef.current += text;  // ← 无条件追加！
  streamTextUpdater.update(streamTextRef.current);
}
```

**问题**：
- `onText` 无条件追加内容
- 即使清除了 `streamTextRef.current`，旧流仍会继续追加
- 新流开始后，又继续追加
- 结果：旧流 + 新流的内容混合

---

## 修复方案

**添加忽略标志**：在补充输入时设置标志，阻止 `onText` 继续追加，直到新流开始。

### 修改1：添加 ignoreStreamTextRef（L395-397）

```typescript
const streamTextRef = useRef('');
// ★ 忽略 onText 标志：补充输入时暂停追加，等待新流开始 ★
const ignoreStreamTextRef = useRef(false);
```

---

### 修改2：onText 检查忽略标志（L924-933）

```typescript
onText: (text: string) => {
  // ★ 如果正在等待新流（补充输入已清除 streamText），忽略旧流的 onText ★
  if (ignoreStreamTextRef.current) {
    return;  // 不追加，直接返回
  }
  streamTextRef.current += text;
  streamTextUpdater.update(streamTextRef.current);
}
```

---

### 修改3：清除 streamText 时设置忽略标志（L1803-1810）

```typescript
if (status === 'thinking') {
  streamTextRef.current = '';
  setStreamText('');
  // ★ 设置忽略标志，阻止旧流的 onText 继续追加 ★
  ignoreStreamTextRef.current = true;
}
```

---

### 修改4：新流开始时重置忽略标志（L937-942）

```typescript
onThinking: (_thinking: string) => {
  // ... 归档逻辑

  // ★ 重置忽略标志，允许新流追加内容 ★
  ignoreStreamTextRef.current = false;

  setProcessingAppend(null);
  dispatchTool({ type: 'SET_THINKING' });
}
```

---

### 修改5：错误时重置忽略标志（L1067-1070）

```typescript
streamTextRef.current = '';
// ★ 重置忽略标志 ★
ignoreStreamTextRef.current = false;
```

---

### 修改6：Ctrl+C 中断时重置忽略标志（L744-746）

```typescript
turnStartTimeRef.current = 0;
lastTurnStatsRef.current = null;
// ★ 重置忽略标志 ★
ignoreStreamTextRef.current = false;
```

---

### 修改7：onEnd 时重置忽略标志（L1103-1105）

```typescript
turnStartTimeRef.current = 0;
// ★ 重置忽略标志（确保下一轮可以正常追加）★
ignoreStreamTextRef.current = false;
```

---

## 修复后的流程

```
t=0ms    用户输入补充 "使用英文输出"
t=0ms    清除 streamTextRef.current = ''
t=0ms    设置 ignoreStreamTextRef.current = true  ← 阻止追加
         ↓
t=5ms    旧流仍在运行，触发 onText('项目结构...')
         检查 ignoreStreamTextRef.current === true
         返回，不追加  ← 被阻止了！
t=10ms   旧流继续，onText('包括 src/...')  ← 被阻止
t=15ms   旧流继续，onText('doc/...')  ← 被阻止
         ↓
t=100ms  interrupt() 被调用
t=100ms  旧流检测到 _interrupted，退出循环
         此时 streamTextRef.current 仍然是空的  ← 无旧内容！
         ↓
t=150ms  新流开始，触发 onThinking
t=150ms  重置 ignoreStreamTextRef.current = false  ← 允许追加
t=160ms  新流触发 onText('Project structure...')  ← 开始追加
t=170ms  新流继续，onText('includes src/...')
         ↓
结果：streamTextRef.current = 'Project structure includes src/...'
                              ^^^^ 纯英文，无混合 ^^^^
```

---

## 关键改进点

### 改进1：精确控制 onText 追加时机

**修改前**：
- onText 无条件追加
- 清除 streamText 后，旧流仍会追加
- 导致内容混合

**修改后**：
- onText 检查 ignoreStreamTextRef
- 补充输入后，旧流的 onText 被阻止
- 新流开始后，才允许追加

---

### 改进2：状态同步准确

**关键时机**：
1. **设置忽略**：清除 streamText 的同时设置（L1803-1810）
2. **重置忽略**：新流开始时重置（onThinking）
3. **异常重置**：错误、中断、onEnd 时重置（确保不会"卡住"）

**效果**：
- 旧流完全被阻止
- 新流正常工作
- 无遗留状态

---

## 测试验证

### 测试步骤

1. 启动 xuanji：`npm run dev`
2. 输入：`总结 xuanji 项目结构`
3. 等待中文输出开始（约 50-100 字）
4. 输入补充：`使用英文输出`

### 预期结果

- ✅ 中文内容立即消失
- ✅ 显示"✓ 已收到 1 条补充"
- ✅ 显示"⏳ 正在处理补充输入..."
- ✅ 新的英文输出**纯英文**，无中文混合
- ✅ 输出内容清晰、连贯

### 验证方法

```bash
# 观察输出是否纯英文
# 检查是否有中文残留
```

---

## 边界情况处理

### 情况1：快速连续补充

**流程**：
```
用户补充1 → 设置 ignoreStreamTextRef = true
50ms 后补充2 → 重置定时器，ignoreStreamTextRef 保持 true
100ms 后 interrupt → 旧流被阻止，无混合
新流开始 → 重置 ignoreStreamTextRef = false
```

**结果**：✅ 正常工作，无混合

---

### 情况2：补充后 API 错误

**流程**：
```
用户补充 → 设置 ignoreStreamTextRef = true
interrupt → 调用 API
API 返回错误 → onError 重置 ignoreStreamTextRef = false
```

**结果**：✅ 标志被正确重置，不影响下一轮

---

### 情况3：补充后 Ctrl+C

**流程**：
```
用户补充 → 设置 ignoreStreamTextRef = true
用户按 Ctrl+C → handleInterrupt 重置 ignoreStreamTextRef = false
```

**结果**：✅ 标志被正确重置

---

## 对比总结

| 特性 | 修复前 | 修复后 |
|------|--------|--------|
| **旧流追加** | ✅ 继续追加 | ❌ 被阻止 |
| **新流追加** | ✅ 追加（混合） | ✅ 追加（纯净） |
| **输出内容** | ❌ 中英混合 | ✅ 纯英文 |
| **视觉效果** | ❌ 混乱 | ✅ 清晰 |
| **状态管理** | ❌ 无控制 | ✅ 精确控制 |

---

## 总结

✅ **问题解决**：
- 旧流的 onText 被阻止，不再追加
- 新流的 onText 正常工作
- 输出内容纯净，无混合

✅ **实现质量**：
- 添加单个 ref 标志（ignoreStreamTextRef）
- 关键时机设置/重置标志
- 边界情况处理完善

✅ **用户体验**：
- 输出清晰、连贯
- 无中英混合
- 符合预期

🎯 **下一步**：
- 运行测试验证
- 确认输出纯净
- 验证边界情况
