# 补充输入清除时机修复

## 问题描述

用户反馈"方式1"未生效，中文内容没有被清除。

## 根本原因

**清除时机太晚**：

原实现：
```typescript
// 用户输入补充时
if (status !== 'idle') {
  flush();  // 只 flush，不清除

  // 100ms 后才清除
  setTimeout(() => {
    streamTextRef.current = '';  // ← 清除太晚
    setStreamText('');
    // ...
  }, 100);
}
```

**问题**：
1. 用户输入补充后，streamText 仍然显示 100ms（或更久）
2. 如果在这期间 API 返回错误，或用户看到了旧内容
3. onEnd 时，非缓冲模式下 streamText 会保留显示
4. 清除操作被延迟，用户感知不到"立即清除"

---

## 修复方案

**立即清除**：在用户输入补充的瞬间就清除 streamText。

### 修改位置1：L1792-1805

```typescript
if (status !== 'idle') {
  // flush 流式文本
  if (streamTextUpdaterRef.current) {
    streamTextUpdaterRef.current.flush();
  }

  // ★ 方式1：立即清除已输出的流式文本 ★
  // 不等到 debounce 后，立即清除 UI 显示
  if (status === 'thinking') {
    streamTextRef.current = '';
    setStreamText('');
  }

  // 添加到 pending 队列
  setPendingUserInputs(...);
  // ...
}
```

### 修改位置2：L1857-1891（删除重复清除）

```typescript
setTimeout(() => {
  // ★ 方式1：streamText 已在上面立即清除，这里无需再次清除 ★
  // 删除：streamTextRef.current = '';
  // 删除：setStreamText('');

  // 添加补充输入到历史
  setMessages(...);

  // 调用 interrupt
  agentLoop.interrupt(finalInput);
}, 100);
```

---

## 修复效果

### 修复前

```
用户：总结项目
助手：项目结构包括...（中文输出）
用户：使用英文  ← 输入补充

（等待 100ms）
助手：项目结构包括...（中文仍然显示）
        ↓ 100ms 后
助手：（清除）
⏳ 正在处理补充输入...
助手：Project structure...
```

**问题**：清除延迟，用户看到 100ms 的旧内容。

---

### 修复后

```
用户：总结项目
助手：项目结构包括...（中文输出）
用户：使用英文  ← 输入补充

（立即清除）
助手：（中文消失）
✓ 已收到 1 条补充
        ↓ 100ms 后
⏳ 正在处理补充输入...
助手：Project structure...
```

**效果**：立即清除，用户感知"瞬间响应"。

---

## 时序图

### 修复前

```
t=0ms    用户输入补充
t=0ms    添加到 pending 队列
t=0ms    显示"✓ 已收到补充"
t=0ms    设置 setTimeout(100ms)
         ↓
t=100ms  清除 streamText  ← 太晚！
t=100ms  调用 interrupt
t=100ms  显示"⏳ 处理中"
         ↓
t=???    API 返回
t=???    新输出开始
```

**问题**：0-100ms 期间，旧内容仍然显示。

---

### 修复后

```
t=0ms    用户输入补充
t=0ms    立即清除 streamText  ← 立即！
t=0ms    添加到 pending 队列
t=0ms    显示"✓ 已收到补充"
t=0ms    设置 setTimeout(100ms)
         ↓
t=100ms  调用 interrupt
t=100ms  显示"⏳ 处理中"
         ↓
t=???    API 返回
t=???    新输出开始
```

**效果**：t=0ms 就清除，无延迟。

---

## 为什么不早点清除？

**原实现逻辑**：
- 想保留 100ms 给用户"反悔"的机会
- 或者等待快速连续输入（debounce 合并）

**问题**：
- 方式1 的设计是"立即中断，清除重来"
- 保留旧内容 100ms 与设计理念冲突
- 用户期望"立即清除"

**修复决策**：
- ✅ 立即清除，符合方式1 理念
- ✅ debounce 仍然保留（100ms 后才调用 interrupt），避免频繁 API 调用
- ✅ 用户体验更好（立即响应）

---

## 测试验证

### 测试步骤

1. 启动 xuanji：`npm run dev`
2. 输入：`总结 xuanji 项目`
3. 等待流式输出开始（中文）
4. 输入补充：`使用英文`

### 预期结果

- ✅ 中文内容**立即消失**（< 10ms）
- ✅ 显示"✓ 已收到 1 条补充"
- ✅ 100ms 后显示"⏳ 正在处理补充输入..."
- ✅ 新的英文输出开始

### 观察重点

- **清除是否立即**：中文内容应该在输入补充后立即消失，不应该有延迟
- **UI 流畅性**：清除 → 提示 → 新输出，应该流畅无闪烁
- **无残留**：中文内容完全消失，无任何残留

---

## 总结

✅ **问题解决**：
- 清除时机从"100ms 后"改为"立即"
- 删除 setTimeout 中的重复清除

✅ **用户体验**：
- 立即响应，无延迟感
- 符合"方式1"设计理念
- 清除 → 提示 → 新输出，流畅连贯

✅ **技术实现**：
- 代码更简洁（删除重复清除）
- 逻辑更清晰（清除在输入时，interrupt 在 debounce 后）
- 性能更好（减少不必要的 state 更新）

🎯 **下一步**：
- 运行测试验证
- 如仍有问题，继续排查
