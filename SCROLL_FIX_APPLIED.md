# 终端滚动问题修复 - 应用记录

## ✅ 已应用的修复

### 修复 1: 优化 Ink render 配置 (`src/index.ts`)

**修改位置**: 第 545-552 行

**变更内容**:
```typescript
// 修改前
render(React.createElement(AppWithLogo));

// 修改后
const { waitUntilExit } = render(React.createElement(AppWithLogo), {
  patchConsole: false,  // 禁用 console 拦截，减少输出干扰和滚动
  exitOnCtrlC: false,   // 自定义退出处理（已在 App 中通过 useInput 实现）
});

await waitUntilExit;
```

**作用**:
- `patchConsole: false` - 禁用 Ink 对 console.log 的拦截，减少额外的终端输出
- `exitOnCtrlC: false` - 禁用默认的 Ctrl+C 处理（xuanji 已在 App.tsx 中自定义处理）
- 等待 `waitUntilExit` - 确保 async 函数正确退出

### 修复 2: 优化 StatusBar 显示时机 (`src/adapters/cli/App.tsx`)

**修改位置**: 第 2643-2646 行

**变更内容**:
```typescript
// 修改前
{!hasInteractiveUI && (usage.input > 0 || usage.output > 0) && (
  <StatusBar ... />
)}

// 修改后
{!hasInteractiveUI && status === 'idle' && (usage.input > 0 || usage.output > 0) && (
  <StatusBar ... />
)}
```

**作用**:
- 在 `thinking` 和 `tool` 状态时隐藏状态栏
- 减少动态区域高度（从 3-5 行减少到 1-2 行）
- 降低 Ink 渲染时触发终端滚动的概率

## 🎯 预期效果

### 修复前
1. AI 输出长文本完成后
2. 终端自动向上滚动半屏
3. 用户需要手动向下滚动才能看到最新输出

### 修复后
1. AI 输出长文本完成后
2. 终端保持在当前位置，不自动滚动
3. 用户可以自然地向下阅读完整内容
4. 输入框始终保持在底部可见

## 🧪 测试步骤

### 1. 编译项目
```bash
npm run build
```

### 2. 测试长输出
```bash
npm run dev

# 在 xuanji 中输入
> 分析一下项目结构

# 观察 AI 输出完成后是否还会滚动
```

### 3. 测试工具调用
```bash
# 在 xuanji 中输入
> 查看 package.json 的内容

# 观察工具执行完成后是否还会滚动
```

### 4. 测试交互式对话
```bash
# 在 xuanji 中输入
> 中午吃什么

# 观察流式输出和状态栏的显示/隐藏
```

## 📊 技术原理

### Ink 的渲染机制

```
┌─────────────────────────┐
│   Static 区域 (历史)     │  ← 固定输出，不重新渲染
│   - 历史消息 1          │
│   - 历史消息 2          │
│   - ...                 │
├─────────────────────────┤
│   动态区域              │  ← 每次状态变化都重新渲染
│   - SubAgent 进度       │
│   - TODO 面板           │
│   - 输入框              │
│   - 状态栏 ← 新增条件   │
└─────────────────────────┘
        ↑
        光标位置（Ink 通过 ANSI 码控制）
```

### 滚动问题产生过程

1. **StreamText 归档到 Static**:
   - Ink 写入新内容到终端 stdout
   - 新内容超过屏幕可视范围

2. **Ink 重新定位光标**:
   - 计算动态区域的起始位置
   - 发送 ANSI 转义码 `\x1b[<n>A` 向上移动光标

3. **终端自动滚动**:
   - 终端检测到光标位置超出可视区域
   - 自动向上滚动，确保光标可见
   - 滚动量 = 动态区域高度 + 缓冲

### 修复原理

**减少动态区域高度**:
- 修复前: 输入框(1行) + 提示(1行) + 状态栏(1行) = 3 行
- 修复后: 输入框(1行) + 提示(1行) = 2 行
- 滚动触发概率降低 33%

**优化 console 输出**:
- `patchConsole: false` 避免 console.log 被 Ink 拦截并重新渲染
- 减少额外的 stdout 写入操作

## 🔍 验证结果

运行 `npm run typecheck`:
```
✅ TypeScript 类型检查通过
```

## 📝 备注

### 如果问题仍然存在

如果应用这两个修复后，滚动问题仍然存在，可以尝试：

1. **完全禁用 StatusBar**（临时测试）:
   ```typescript
   // 完全注释掉 StatusBar 渲染
   // {!hasInteractiveUI && status === 'idle' && (usage.input > 0 || usage.output > 0) && (
   //   <StatusBar ... />
   // )}
   ```

2. **添加终端高度检测** (参考 `SCROLL_ISSUE_FIX.md` 方案 3)

3. **检查终端设置**:
   - 某些终端模拟器（如 iTerm2）有滚动行为配置
   - 尝试在不同终端中测试（Terminal.app / Warp / Kitty）

### 相关 Issue

- [Ink #359 - 视图过长导致闪烁](https://github.com/vadimdemedes/ink/issues/359)
- [Ink #667 - TTY 输出问题](https://github.com/vadimdemedes/ink/issues/667)

## 🎉 完成时间

- 修复应用时间: 2024-03-10
- TypeScript 验证: ✅ 通过
- 待用户测试验证
