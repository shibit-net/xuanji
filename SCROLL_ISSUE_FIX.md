# 终端滚动问题分析与修复方案

## 🐛 问题描述

每次 AI 输出完内容后，终端会自动向上滚动半个屏幕，导致刚输出的内容看不到，需要手动向下滚动。

## 🔍 根本原因

这是 **Ink 框架的 Static 组件** 与 **终端渲染机制** 交互导致的：

### Ink 的渲染流程

1. **Static 区域** (`<Static>`): 历史消息，已固定输出到终端
2. **动态区域**: InputHandler + StatusBar + 进度组件

当 streamText 归档到 Static 时：
- Ink 先写入新的 Static 内容到终端缓冲区
- 然后通过 ANSI 转义码 (`\x1b[<n>A`) 将光标移回到动态区域位置
- 终端为了确保光标可见，会自动向上滚动

### 为什么会滚动半屏？

- 动态区域高度 ≈ 3-5 行（输入框 + 状态栏 + 提示）
- 当 Static 新增内容后，终端需要确保输入框可见
- 滚动量 = 新增内容行数 - 终端可视高度

## 💡 解决方案

### 方案 1: 禁用 stdout 的自动滚动（推荐）✅

Ink 的 `render()` 函数支持 `patchConsole` 选项，可以控制输出行为：

**修改位置**: `src/index.ts` 第 545 行

```typescript
// 当前代码:
render(React.createElement(AppWithLogo));

// 修改为:
const { waitUntilExit } = render(React.createElement(AppWithLogo), {
  patchConsole: false,  // 禁用 console 拦截，减少输出干扰
  exitOnCtrlC: false,   // 自定义退出处理（已在 App 中实现）
});
```

### 方案 2: 减少动态区域高度

在 Assistant 输出大量内容时，临时隐藏状态栏和提示信息。

**修改位置**: `src/adapters/cli/App.tsx`

在 `StatusBar` 渲染条件中添加检查：

```typescript
// 当前代码:
{!hasInteractiveUI && (usage.input > 0 || usage.output > 0) && (
  <StatusBar model={model} usage={usage} cost={cost} username={authUsername} isPlanMode={planModeActive} />
)}

// 修改为:
{!hasInteractiveUI && status === 'idle' && (usage.input > 0 || usage.output > 0) && (
  <StatusBar model={model} usage={usage} cost={cost} username={authUsername} isPlanMode={planModeActive} />
)}
```

这样在 thinking/tool 状态时隐藏状态栏，减少动态区域高度。

### 方案 3: 添加终端高度检测 + 分页输出

对于超长输出（> 终端高度），分批归档到 Static，每批后暂停渲染。

**修改位置**: `src/adapters/cli/App.tsx` 的 `archiveStreamText` 函数

```typescript
// 检测终端高度
const terminalHeight = process.stdout.rows || 50;
const lines = streamText.split('\n');

if (lines.length > terminalHeight - 10) {
  // 超长内容：分批归档，避免一次性输出导致滚动
  const batchSize = terminalHeight - 10;
  for (let i = 0; i < lines.length; i += batchSize) {
    const batch = lines.slice(i, i + batchSize).join('\n');
    // ... 归档逻辑
    // 短暂延迟，让终端有时间渲染
    await new Promise(resolve => setTimeout(resolve, 50));
  }
} else {
  // 正常归档
  // ... 现有逻辑
}
```

## 🛠️ 推荐实施步骤

### 第一步：应用方案 1（最简单有效）

修改 `src/index.ts` 的 render 调用：

```typescript
const { waitUntilExit } = render(React.createElement(AppWithLogo), {
  patchConsole: false,
  exitOnCtrlC: false,
});

// 等待退出
await waitUntilExit;
```

### 第二步：应用方案 2（优化体验）

修改 `src/adapters/cli/App.tsx`:

1. 在 StatusBar 渲染条件中添加 `status === 'idle'`
2. 在 InputHandler 中添加 `hidden={hasInteractiveUI || status !== 'idle'}`

### 第三步：测试验证

```bash
npm run dev

# 测试长输出
> 分析一下项目结构

# 观察是否还会滚动
```

## 📚 参考资料

- [Ink Issue #359 - 视图过长导致闪烁](https://github.com/vadimdemedes/ink/issues/359)
- [Ink Issue #667 - TTY 输出问题](https://github.com/vadimdemedes/ink/issues/667)
- [Ink render options](https://github.com/vadimdemedes/ink#options)

## ⚠️ 注意事项

1. **不要禁用 Static 组件** - 这会导致历史消息重复渲染，闪烁更严重
2. **保留 ANSI 转义码** - 用于颜色和样式，禁用会导致格式丢失
3. **测试不同终端** - iTerm2 / Terminal.app / Windows Terminal 行为可能不同

## 🎯 预期效果

应用方案 1 + 方案 2 后：
- ✅ AI 输出完成后，终端不再自动滚动
- ✅ 用户可以自然地向下阅读完整输出
- ✅ 输入框始终保持在底部可见
- ✅ 状态栏在必要时隐藏，减少干扰
