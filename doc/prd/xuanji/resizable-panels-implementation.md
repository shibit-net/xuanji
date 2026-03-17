# 可调整大小面板实现

## 需求
用户希望支持手动拖拽调整 GUI 中各个面板的宽度，提升使用体验。

## 实现方案

### 1. 创建 ResizeHandle 组件

**文件**：`desktop/renderer/components/ResizeHandle.tsx`

**功能**：
- 垂直分隔条，支持鼠标拖拽
- 提供视觉反馈（hover/dragging 状态）
- 限制最小/最大宽度
- 实时更新面板宽度

**核心特性**：
- **双向拖拽**：支持 `direction: 'left' | 'right'`
  - `left`：拖拽改变左侧面板宽度（向右拖 = 变宽）
  - `right`：拖拽改变右侧面板宽度（向右拖 = 变窄）
- **宽度限制**：
  - Sidebar：200px ~ 400px（默认 256px）
  - InspectorPanel：280px ~ 600px（默认 320px）
- **交互范围扩大**：分隔条宽度 4px，但交互范围扩大到左右各 4px
- **视觉反馈**：
  - 默认：浅色细线（bg-bg-tertiary）
  - Hover：蓝色半透明（bg-primary/60）+ 抓手图标
  - Dragging：高亮蓝色（bg-primary）+ 全局 cursor: col-resize

### 2. 修改 App.tsx

**文件**：`desktop/renderer/App.tsx`

**变更内容**：

#### 2.1 添加宽度状态管理

```typescript
// 面板宽度状态
const [sidebarWidth, setSidebarWidth] = useState(() => {
  const saved = localStorage.getItem('xuanji-sidebar-width');
  return saved ? parseInt(saved, 10) : 256; // 默认 256px (w-64)
});

const [inspectorWidth, setInspectorWidth] = useState(() => {
  const saved = localStorage.getItem('xuanji-inspector-width');
  return saved ? parseInt(saved, 10) : 320; // 默认 320px (w-80)
});
```

#### 2.2 持久化宽度到 localStorage

```typescript
// 保存面板宽度到 localStorage
useEffect(() => {
  localStorage.setItem('xuanji-sidebar-width', sidebarWidth.toString());
}, [sidebarWidth]);

useEffect(() => {
  localStorage.setItem('xuanji-inspector-width', inspectorWidth.toString());
}, [inspectorWidth]);
```

#### 2.3 重构布局结构

**原布局**（固定宽度）：
```tsx
<div className="flex flex-1 overflow-hidden">
  <Sidebar />                      {/* w-64 固定 */}
  <Workspace />                    {/* flex-1 自适应 */}
  {inspectorVisible && <InspectorPanel />}  {/* w-80 固定 */}
</div>
```

**新布局**（可调整宽度）：
```tsx
<div className="flex flex-1 overflow-hidden">
  {/* 左侧导航栏 */}
  <div style={{ width: `${sidebarWidth}px` }} className="flex-shrink-0">
    <Sidebar />
  </div>

  {/* 左侧分隔条 */}
  <ResizeHandle
    direction="left"
    width={sidebarWidth}
    onResize={setSidebarWidth}
    minWidth={200}
    maxWidth={400}
  />

  {/* 中间工作区 */}
  <div className="flex-1 min-w-0">
    <Workspace />
  </div>

  {/* 右侧分隔条 */}
  {inspectorVisible && (
    <ResizeHandle
      direction="right"
      width={inspectorWidth}
      onResize={setInspectorWidth}
      minWidth={280}
      maxWidth={600}
    />
  )}

  {/* 右侧监控面板 */}
  {inspectorVisible && (
    <div style={{ width: `${inspectorWidth}px` }} className="flex-shrink-0">
      <InspectorPanel />
    </div>
  )}
</div>
```

### 3. 修改子组件

#### 3.1 Sidebar.tsx

**变更**：移除固定宽度类
```diff
- <div className="w-56 bg-bg-secondary flex flex-col border-r border-bg-tertiary">
+ <div className="h-full bg-bg-secondary flex flex-col border-r border-bg-tertiary">
```

**原因**：宽度现在由父组件（App.tsx）通过内联样式控制

#### 3.2 InspectorPanel.tsx

**变更**：移除固定宽度类
```diff
- <div className="w-80 bg-bg-secondary flex flex-col border-l border-bg-tertiary">
+ <div className="h-full bg-bg-secondary flex flex-col border-l border-bg-tertiary">
```

**原因**：同上

#### 3.3 ExecutionWorkspace.tsx

**无需修改**：
- 根元素已经使用 `h-full`，会自动占满父容器
- Canvas 使用 `absolute inset-0 w-full h-full`，自适应父容器

## 技术细节

### 拖拽实现原理

1. **mousedown**：
   - 记录起始 X 坐标（`startXRef.current = e.clientX`）
   - 记录当前宽度（`startWidthRef.current = width`）
   - 设置拖拽状态（`setIsDragging(true)`）
   - 设置全局 cursor 和禁用文本选择

2. **mousemove**（全局监听）：
   - 计算位移：`deltaX = e.clientX - startXRef.current`
   - 计算新宽度：
     - `direction='left'`：`newWidth = startWidth + deltaX`（向右拖 = 变宽）
     - `direction='right'`：`newWidth = startWidth - deltaX`（向右拖 = 变窄）
   - 限制范围：`clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))`
   - 回调更新：`onResize(clampedWidth)`

3. **mouseup**（全局监听）：
   - 清除拖拽状态
   - 恢复默认 cursor 和文本选择

### 为什么使用全局监听

```typescript
useEffect(() => {
  if (!isDragging) return;

  // 必须在 document 上监听，而不是在 handle 元素上
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);

  return () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };
}, [isDragging]);
```

**原因**：
- 如果只在 handle 元素上监听，当鼠标移动过快时会脱离 handle，导致拖拽中断
- 在 document 上监听可以确保无论鼠标移动到哪里都能继续拖拽
- mouseup 也必须在 document 上监听，因为用户可能在任意位置释放鼠标

### 宽度限制说明

| 面板 | 默认宽度 | 最小宽度 | 最大宽度 | 说明 |
|------|----------|----------|----------|------|
| Sidebar | 256px | 200px | 400px | 保证导航项文字可读 |
| InspectorPanel | 320px | 280px | 600px | ExecutionWorkspace 最小需要 280px |
| Workspace | 自适应 | - | - | flex-1，占满剩余空间 |

## 用户体验优化

### 1. 视觉反馈

- **静态**：细灰线（1px，bg-bg-tertiary）
- **Hover**：蓝色半透明 + 抓手图标（双竖线）
- **Dragging**：高亮蓝色 + 全局 cursor

### 2. 交互范围扩大

```tsx
{/* 可点击区域（扩大交互范围） */}
<div
  className="absolute inset-0 cursor-col-resize"
  style={{ marginLeft: '-4px', marginRight: '-4px' }}
/>
```

分隔条视觉宽度 4px，但交互范围扩大到 12px（左右各 4px），更易点击。

### 3. 状态持久化

用户调整的宽度会自动保存到 localStorage，下次打开 GUI 时恢复：
- `xuanji-sidebar-width`
- `xuanji-inspector-width`

### 4. 平滑动画

虽然拖拽时是实时更新（无动画），但分隔线颜色变化使用 `transition-colors` 提供平滑过渡。

## 测试验证

### 功能测试

1. **拖拽 Sidebar 分隔条**：
   - 向右拖 → Sidebar 变宽，Workspace 变窄
   - 向左拖 → Sidebar 变窄，Workspace 变宽
   - 达到最小宽度（200px）或最大宽度（400px）时停止

2. **拖拽 InspectorPanel 分隔条**：
   - 向左拖 → InspectorPanel 变宽，Workspace 变窄
   - 向右拖 → InspectorPanel 变窄，Workspace 变宽
   - 达到最小宽度（280px）或最大宽度（600px）时停止

3. **宽度持久化**：
   - 调整宽度后关闭 GUI
   - 重新打开 GUI，宽度应保持之前的设置

4. **InspectorPanel 关闭/打开**：
   - 关闭 InspectorPanel 后，Workspace 占满剩余空间
   - 重新打开 InspectorPanel，宽度应恢复之前的设置

### 边界测试

1. **快速拖拽**：鼠标快速移动时拖拽不中断
2. **拖拽到屏幕外**：鼠标移出窗口仍可继续拖拽
3. **最小/最大宽度限制**：无法拖拽到限制范围外

## 未来扩展

### 1. 双击重置宽度

```typescript
const handleDoubleClick = () => {
  onResize(direction === 'left' ? 256 : 320); // 重置为默认宽度
};
```

### 2. 垂直分隔条

如果需要上下拖拽调整高度，可以创建 `ResizeHandleHorizontal` 组件，原理相同。

### 3. 拖拽预览

在拖拽过程中显示半透明的预览线，松开鼠标后再真正调整宽度。

### 4. 吸附效果

当拖拽到默认宽度附近时（如 256px ± 5px），自动吸附到默认宽度。

## 总结

通过创建可重用的 ResizeHandle 组件并重构布局结构，成功实现了：
- ✅ Sidebar 和 Workspace 之间可拖拽调整
- ✅ Workspace 和 InspectorPanel 之间可拖拽调整
- ✅ 宽度限制和边界保护
- ✅ 宽度持久化（localStorage）
- ✅ 良好的视觉反馈和交互体验

所有面板都能根据用户需求自由调整大小，同时保持布局的整体协调性。
