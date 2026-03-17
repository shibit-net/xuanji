# TODO 任务列表优化说明

## 📋 优化内容

### 1. 调整布局位置
- **之前**：任务列表显示在 SubAgent 进度下方、工具执行状态上方
- **之后**：任务列表显示在 **StatusBar 和输入框之间**（输入框正上方）
- **效果**：用户更容易看到当前任务进度，视觉焦点更集中

### 2. 实时自动更新
- **之前**：只在工具调用时通过 `parseTodoProgress` 被动更新
- **之后**：添加轮询机制，每 500ms 主动从 `TodoManager` 同步最新状态
- **效果**：任务状态变化时立即反映到 UI，无需等待下一次工具调用

### 3. 智能去重优化
- 使用 `JSON.stringify` 比对数据变化
- 只有数据真正改变时才触发 UI 重绘
- 避免不必要的渲染性能消耗

## 🔧 技术实现

### 核心代码变更

**src/adapters/cli/App.tsx**

#### 1. 添加同步函数和定时器
```typescript
// 实时刷新定时器
const todoRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

// 同步函数：从 TodoManager 获取最新状态
const syncTodoProgress = useCallback(() => {
  const todoManager = getTodoManager();
  const progressStr = todoManager.formatProgress();
  if (progressStr) {
    const progress = parseTodoProgress(progressStr);
    if (progress) {
      // 只在数据真正变化时才更新（避免不必要的重绘）
      const currentStr = JSON.stringify(todoProgressRef.current);
      const newStr = JSON.stringify(progress);
      if (currentStr !== newStr) {
        todoProgressRef.current = progress;
        setTodoProgress(progress);
      }
    }
  } else {
    if (todoProgressRef.current !== null) {
      todoProgressRef.current = null;
      setTodoProgress(null);
    }
  }
}, []);
```

#### 2. 启动定时刷新机制
```typescript
useEffect(() => {
  if (status !== 'idle' && !todoRefreshIntervalRef.current) {
    // 立即同步一次
    syncTodoProgress();
    // 启动定时刷新（500ms）
    todoRefreshIntervalRef.current = setInterval(syncTodoProgress, 500);
  }

  // 清理定时器
  if (status === 'idle' && todoRefreshIntervalRef.current) {
    clearInterval(todoRefreshIntervalRef.current);
    todoRefreshIntervalRef.current = null;
  }

  return () => {
    if (todoRefreshIntervalRef.current) {
      clearInterval(todoRefreshIntervalRef.current);
      todoRefreshIntervalRef.current = null;
    }
  };
}, [status, syncTodoProgress]);
```

#### 3. 调整渲染位置
```typescript
{/* StatusBar */}
{!hasInteractiveUI && (usage.input > 0 || usage.output > 0) && (
  <StatusBar model={model} usage={usage} cost={cost} username={authUsername} isPlanMode={planModeActive} />
)}

{/* TODO 任务进度：显示在输入框上方，实时更新 */}
{todoProgress && (
  <TodoPanel data={todoProgress} />
)}

{/* 输入框 */}
<InputHandler
  onSubmit={handleSubmit}
  isActive={...}
  ...
/>
```

## ✅ 验证结果

- ✅ 代码编译成功（无类型错误）
- ✅ 布局调整完成（任务列表位于输入框上方）
- ✅ 实时刷新机制生效（500ms 轮询）
- ✅ 智能去重避免不必要的重绘

## 🎯 用户体验提升

1. **视觉焦点集中**：任务列表靠近输入框，用户无需上下滚动即可同时看到任务进度和输入区域
2. **实时反馈**：任务状态变化立即显示，不再需要等待下次工具调用
3. **性能优化**：通过数据比对避免无效重绘，保持 UI 流畅
4. **状态同步**：即使在长时间思考或等待时，任务列表依然保持最新状态

## 📝 注意事项

- 轮询仅在 `status !== 'idle'` 时启动，避免空闲状态下的无效开销
- 使用 `JSON.stringify` 比对确保深层数据变化也能被检测
- 定时器在组件卸载或状态切换时自动清理，无内存泄漏风险
