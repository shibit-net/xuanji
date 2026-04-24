# 主 Agent 状态展示 - 简洁版

## 设计

类似"正在回忆中"的简洁状态提示，只在主 agent 执行时显示。

## 效果

```
┌─────────────────────────────────────┐
│ Work Space                          │
├─────────────────────────────────────┤
│ ◐ 正在分析意图...                   │  ← 简洁状态提示
├─────────────────────────────────────┤
│        Canvas (Agent 树)            │
│         Xuanji                      │
│           ↓                         │
│         coder                       │
└─────────────────────────────────────┘
```

## 显示内容

根据当前阶段显示不同文字：
- **意图分析**: "正在分析意图..."
- **任务规划**: "正在规划任务..."
- **任务执行**: "正在执行任务..."
- **结果汇总**: "正在汇总结果..."

## 特点

1. **极简设计** - 只有一个旋转图标 + 文字
2. **自动隐藏** - 没有执行时不显示
3. **实时更新** - 根据当前阶段自动切换文字
4. **视觉一致** - 与"正在回忆中"样式一致

## 样式

- 背景：半透明蓝色 `rgba(74, 158, 255, 0.05)`
- 边框：淡蓝色 `rgba(74, 158, 255, 0.1)`
- 图标：旋转的圆环，蓝色
- 文字：12px，灰色

## 代码

### 组件
```tsx
export function MainFlowVisualization() {
  const [currentPhase, setCurrentPhase] = useState<WorkspacePhase | null>(null);

  // 订阅状态变化
  useEffect(() => {
    const unsubscribe = workspaceStore.subscribe(() => {
      setCurrentPhase(workspaceStore.getCurrentPhase());
    });
    return unsubscribe;
  }, []);

  // 没有执行时不显示
  if (!currentPhase) {
    return null;
  }

  return (
    <div className="main-flow-status">
      <div className="status-indicator">
        <div className="spinner" />
        <span className="status-text">{getPhaseText(currentPhase.name)}</span>
      </div>
    </div>
  );
}
```

### 样式
```css
.main-flow-status {
  padding: 8px 16px;
  background: rgba(74, 158, 255, 0.05);
  border-bottom: 1px solid rgba(74, 158, 255, 0.1);
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(74, 158, 255, 0.2);
  border-top-color: #4a9eff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
```

## 用户体验

### 执行前
- 不显示任何内容

### 执行中
```
◐ 正在分析意图...
```
↓
```
◐ 正在规划任务...
```
↓
```
◐ 正在执行任务...
```

### 执行完成
- 自动隐藏

## 优势

1. **不占空间** - 只有一行，极简
2. **清晰反馈** - 用户知道系统在做什么
3. **视觉统一** - 与现有 UI 风格一致
4. **性能友好** - 只在需要时显示

完美！现在是一个简洁优雅的状态提示了。
