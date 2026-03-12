# Ink Static 滚动问题分析

## 问题描述

用户反馈："每次输出完内容后，总是会多滚动半个屏幕"

## 根本原因

这是 Ink 的 `<Static>` 组件的已知行为：

1. **Static 渲染机制**：
   - `<Static>` 会将所有内容一次性写入 stdout
   - Node.js 的 stdout 写入会触发终端滚动
   - 终端会自动滚动到显示新内容

2. **动态内容预留**：
   ```tsx
   <Static>...</Static>  ← 历史消息
   <SubAgentProgress />  ← 动态内容 1
   <TodoPanel />         ← 动态内容 2
   <Spinner />           ← 动态内容 3
   <StreamText />        ← 动态内容 4
   <InputHandler />      ← 动态内容 5
   <StatusBar />         ← 动态内容 6
   ```
   
   Ink 会为所有动态内容预留空间，导致 Static 结束后光标位置不在预期位置。

3. **滚动行为**：
   - Static 内容渲染完成
   - Ink 计算动态内容需要的行数（约 5-10 行）
   - 终端滚动时会多滚动这些动态内容的高度
   - 结果：多滚动半屏

## 解决方案探索

### 方案 1: 减少动态内容高度 ❌

**尝试**：移除不必要的空行、减少 marginBottom

**效果**：有限，因为动态内容本身需要占据空间

**问题**：会影响 UI 可读性

### 方案 2: 使用 measureElement ❌

**尝试**：使用 Ink 的 `measureElement` 测量高度，手动控制滚动

**问题**：
- Ink 5.x 中 `measureElement` 已废弃
- 无法直接控制终端滚动行为
- stdout.write 是单向的，无法回滚

### 方案 3: 延迟渲染动态内容 ⚠️

**思路**：Static 渲染完成后，延迟 100ms 再渲染动态内容

**代码**：
```tsx
const [showDynamic, setShowDynamic] = useState(false);

useEffect(() => {
  if (status === 'idle') {
    const timer = setTimeout(() => setShowDynamic(true), 100);
    return () => clearTimeout(timer);
  }
}, [status]);

// 渲染时
{showDynamic && <SubAgentProgress />}
{showDynamic && <TodoPanel />}
```

**问题**：
- 会导致动态内容闪烁
- 用户体验不好

### 方案 4: 合并到 Static（当前最佳） ✅

**思路**：将尽可能多的内容放入 Static，减少动态区域

**已实现**：
- TodoPanel 已在 onEnd 时归档到 Static
- 工具结果在 onToolEnd 时立即归档
- StreamText 在下一轮开始时归档

**优点**：
- 减少了动态内容的数量
- 滚动行为更可预测

**限制**：
- InputHandler、StatusBar、Spinner 必须是动态的
- 仍然会有轻微的多滚动（约 3-5 行）

### 方案 5: 使用 Alternate Screen Buffer ⚠️

**思路**：使用终端的 Alternate Screen Buffer（全屏模式）

**实现**：
```typescript
process.stdout.write('\x1b[?1049h'); // 进入
process.stdout.write('\x1b[?1049l'); // 退出
```

**优点**：
- 完全控制屏幕内容
- 无滚动问题

**问题**：
- 退出后历史消息丢失
- 不符合 CLI 工具的预期行为
- 用户无法向上滚动查看历史

### 方案 6: 手动控制光标位置 ❌

**思路**：Static 渲染后，使用 ANSI escape codes 移动光标

**代码**：
```typescript
useEffect(() => {
  if (status === 'idle') {
    process.stdout.write('\x1b[3A'); // 向上移动 3 行
  }
}, [status]);
```

**问题**：
- 不同终端行为不一致
- 可能导致内容覆盖
- 无法准确计算需要移动的行数

## 当前状态

**已采用方案 4**（合并到 Static），额外优化：

1. ✅ 移除了 assistant 消息之间的空行（原本的 marginBottom=1）
2. ✅ 工具结果立即归档到 Static
3. ✅ TODO 进度在 onEnd 时归档
4. ✅ StreamText 在下一轮开始时归档

**实际滚动行为**：
- 非缓冲模式：多滚动约 5-8 行（InputHandler + StatusBar + StreamText）
- 缓冲模式：多滚动约 3-5 行（InputHandler + StatusBar）

## 建议

### 短期（接受现状）

**多滚动 3-5 行是 Ink Static 组件的固有行为**，无法完全消除。

这是可接受的，因为：
1. 用户可以向上滚动查看历史
2. 大多数 CLI 工具都有类似行为
3. 不影响实际功能

### 中期（持续优化）

1. **监控动态内容高度**：
   - 尽量减少动态区域的行数
   - 交互对话框时隐藏 Spinner 和 StatusBar

2. **优化归档时机**：
   - StreamText 立即归档（而不是等下一轮）
   - 工具结果批量归档时减少间隔

### 长期（架构调整）

如果多滚动问题严重影响用户体验，可以考虑：

1. **完全自定义渲染**：
   - 不使用 Ink 的 Static 组件
   - 手动管理 stdout.write 和光标位置
   - 类似 `blessed` 或 `terminal-kit` 的方式

2. **使用 TUI 框架**：
   - 切换到 `blessed-react` 或 `ink-ui`
   - 完全控制屏幕布局
   - 但会牺牲滚动历史查看

## 结论

**"多滚动半屏"是 Ink Static 的设计特性，不是 bug。**

当前的优化（合并内容到 Static）已经将多滚动控制在 3-5 行，这是在以下之间的最佳平衡：
- 历史消息可查看（向上滚动）
- 动态内容实时更新（Spinner、Progress）
- 滚动行为可预测（不会跳跃或覆盖）

**建议用户接受这个行为**，或者如果严重影响使用，可以尝试方案 5（Alternate Screen），但会失去历史查看能力。

## 参考

- Ink Issue: https://github.com/vadimdemedes/ink/issues/
- Related: Static component scrolling behavior
- Alternative: blessed, terminal-kit (full TUI frameworks)
