# 输入法 Enter 键冲突修复

## 问题

用户反馈：使用中文输入法时，按 Enter 确认候选词会自动发送消息。

## 问题分析

### 中文输入法的工作流程

1. 用户输入拼音（如 `nihao`）
2. 输入法显示候选词列表（如 "你好"、"泥好" 等）
3. 用户按 **Enter** 确认选择第一个候选词
4. 候选词被插入到文本框中

### 问题所在

```typescript
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {  // ❌ 没有检查输入法状态
    e.preventDefault();
    handleSubmit();  // 导致消息被发送
  }
}
```

**问题流程**：
1. 用户输入拼音 `nihao`
2. 按 Enter 确认 "你好"
3. `handleKeyDown` 捕获到 Enter 事件
4. **立即发送消息 "你好"**
5. 用户无法继续输入后续内容

### 为什么会这样？

浏览器的键盘事件在输入法过程中有两种状态：

| 状态 | isComposing | 说明 |
|------|-------------|------|
| 输入法输入中 | `true` | 正在输入拼音或选择候选词 |
| 正常输入 | `false` | 不使用输入法，或输入法已确认 |

**关键点**：当 `isComposing` 为 `true` 时，按 Enter 是为了确认输入法的候选词，**不应该触发发送**。

## 修复方案

### 检查 isComposing 状态

在 `handleKeyDown` 开始时检查 `e.nativeEvent.isComposing`：

```typescript
const handleKeyDown = (e: React.KeyboardEvent) => {
  // 如果正在使用输入法输入（如中文输入法），忽略 Enter 键
  // isComposing 为 true 表示输入法正在输入中
  if (e.nativeEvent.isComposing) {
    return;  // 提前返回，不处理任何键盘事件
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSubmit();
  }
  if (e.key === 'Escape') {
    setInput('');
    textareaRef.current?.blur();
  }
};
```

### 工作原理

#### 使用中文输入法时

```
1. 用户输入: n i h a o
   → isComposing: true
   → 显示候选词: 你好, 泥好, ...

2. 用户按 Enter 确认 "你好"
   → isComposing: true (仍在输入法状态)
   → handleKeyDown 检测到 isComposing，直接 return
   → ✅ 不发送消息

3. 输入法确认完成
   → isComposing: false
   → 文本框内容: "你好"

4. 用户继续输入或按 Enter 发送
   → isComposing: false
   → ✅ 正常处理 Enter（发送消息）
```

#### 不使用输入法时

```
1. 用户输入: h e l l o
   → isComposing: false
   → 文本框内容: "hello"

2. 用户按 Enter
   → isComposing: false
   → handleKeyDown 正常处理
   → ✅ 发送消息
```

## 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `desktop/renderer/components/InputArea.tsx` | 在 handleKeyDown 开始添加 isComposing 检查 |

## 测试验证

### 中文输入法测试

1. **输入拼音并确认**：
   ```
   操作：输入 "nihao" → 按 Enter 确认 "你好"
   期望：文本框显示 "你好"，不发送消息
   ```

2. **输入多个词**：
   ```
   操作：输入 "nihao" → Enter → 输入 "shijie" → Enter
   期望：文本框显示 "你好世界"，不发送消息
   ```

3. **完成输入后发送**：
   ```
   操作：输入 "你好世界" → 按 Enter
   期望：发送消息 "你好世界"
   ```

4. **Shift+Enter 换行**：
   ```
   操作：输入 "你好" → Shift+Enter → 输入 "世界"
   期望：文本框显示两行：
         你好
         世界
   ```

### 英文输入测试

1. **直接输入并发送**：
   ```
   操作：输入 "hello" → 按 Enter
   期望：发送消息 "hello"
   ```

2. **换行**：
   ```
   操作：输入 "hello" → Shift+Enter → 输入 "world"
   期望：文本框显示两行：
         hello
         world
   ```

### 日文输入法测试

1. **输入假名并确认**：
   ```
   操作：输入 "konnitiha" → 按 Enter 确认 "こんにちは"
   期望：文本框显示 "こんにちは"，不发送消息
   ```

## 相关标准

### Composition Events

浏览器提供三个 composition 事件：

| 事件 | 触发时机 |
|------|---------|
| `compositionstart` | 输入法开始输入 |
| `compositionupdate` | 输入法更新候选词 |
| `compositionend` | 输入法确认完成 |

### isComposing 属性

- **位置**：`KeyboardEvent.isComposing` 或 `e.nativeEvent.isComposing`
- **类型**：`boolean`
- **兼容性**：现代浏览器全部支持（Chrome、Firefox、Safari、Edge）
- **MDN 文档**：https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing

## 常见错误

### ❌ 错误 1：忽略 isComposing

```typescript
// 错误：没有检查输入法状态
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter') {
    handleSubmit();  // 输入法按 Enter 也会触发
  }
}
```

### ❌ 错误 2：使用 onCompositionEnd

```typescript
// 错误：过度复杂，且有时序问题
const [isComposing, setIsComposing] = useState(false);

<textarea
  onCompositionStart={() => setIsComposing(true)}
  onCompositionEnd={() => setIsComposing(false)}
  onKeyDown={(e) => {
    if (e.key === 'Enter' && !isComposing) {  // 可能有延迟
      handleSubmit();
    }
  }}
/>
```

### ✅ 正确：直接检查 isComposing

```typescript
// 正确：简单、可靠
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.nativeEvent.isComposing) {
    return;  // 输入法输入中，忽略所有键盘事件
  }
  if (e.key === 'Enter') {
    handleSubmit();
  }
}
```

## 其他输入法问题

### 问题 1：Backspace 删除整个词

**现象**：输入法确认后，按 Backspace 删除整个词而不是单个字符。

**原因**：浏览器的输入法优化行为。

**解决**：无需处理，这是浏览器的正常行为。

### 问题 2：输入法候选框位置

**现象**：输入法候选框被遮挡或位置不对。

**原因**：CSS 布局问题（如 `transform`、`position: fixed` 等）。

**解决**：避免在输入框父元素使用 `transform`。

## 经验总结

### 输入法处理的黄金法则

1. **始终检查 isComposing**：在处理 Enter、Escape 等特殊键时
2. **不要阻止默认行为**：除非确定不在输入法状态
3. **简单优于复杂**：直接使用 `e.nativeEvent.isComposing`，不要自己维护状态

### 多语言支持

支持中文、日文、韩文等需要输入法的语言时，必须考虑 composition 状态：

| 语言 | 输入法类型 | 是否需要检查 isComposing |
|------|-----------|----------------------|
| 中文 | 拼音/五笔 | ✅ 必须 |
| 日文 | 假名/罗马字 | ✅ 必须 |
| 韩文 | 音节组合 | ✅ 必须 |
| 英文 | 无 | ⚠️ 不影响，但检查也无害 |
| 越南文 | 音调组合 | ✅ 必须 |

## 参考资料

- [MDN - KeyboardEvent.isComposing](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing)
- [MDN - CompositionEvent](https://developer.mozilla.org/en-US/docs/Web/API/CompositionEvent)
- [W3C - UI Events](https://www.w3.org/TR/uievents/)
