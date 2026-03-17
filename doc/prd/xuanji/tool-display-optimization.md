# 工具调用展示优化

## 问题

用户反馈：对话区域展示很多工具调用，但右侧已经有专门的工具 Tab 记录了，感觉重复。

## 问题分析

### 当前展示方式

**对话区（MessageBubble）**：
- 显示所有工具调用（pending / success / error）
- 每个工具显示名称、状态、耗时
- 多个工具时会占据大量空间

**右侧面板（工具 Tab）**：
- 显示所有工具调用历史
- 支持查看详细的 input 和 output
- 支持过滤和搜索

### 冗余问题

```
左侧对话区                     右侧工具 Tab
┌─────────────────┐          ┌─────────────────┐
│ Assistant       │          │ 🔧 工具调用     │
│ ✓ Read (120ms)  │  <───┐  │                 │
│ ✓ Edit (200ms)  │      │  │ Read   ✓ 120ms  │
│ ✓ Bash (500ms)  │  ────┴─>│ Edit   ✓ 200ms  │
│ 回复内容...     │          │ Bash   ✓ 500ms  │
└─────────────────┘          └─────────────────┘
     重复展示                    详细历史
```

**问题**：
1. 对话区和工具 Tab 显示相同信息，重复
2. 对话区工具列表占据空间，干扰阅读回复内容
3. 用户需要在两个地方查看工具调用

## 优化方案

### 设计原则

**对话区（左侧）**：
- 专注于对话内容和实时状态
- 只显示**正在执行中**的工具
- 简洁、不干扰阅读

**工具 Tab（右侧）**：
- 专注于工具调用历史和详情
- 显示所有工具（执行中 + 已完成 + 失败）
- 提供详细信息和过滤功能

### 优化后的展示

```
左侧对话区                     右侧工具 Tab
┌─────────────────┐          ┌─────────────────┐
│ Assistant       │          │ 🔧 工具调用     │
│ 🔄 Read         │  <───┐  │                 │
│    执行中...    │      │  │ Read   🔄 执行中│
│                 │      └─>│ Edit   ✓ 200ms  │
│ [等待回复...]   │          │ Bash   ✓ 500ms  │
└─────────────────┘          └─────────────────┘
   只显示执行中                  完整历史
```

**效果**：
- ✅ 对话区清爽，专注于内容
- ✅ 实时状态可见（执行中的工具）
- ✅ 详细历史在工具 Tab 查看
- ✅ 避免重复展示

## 实现细节

### 文件：`desktop/renderer/components/MessageBubble.tsx`

#### Before - 显示所有工具

```tsx
{message.toolCalls && message.toolCalls.length > 0 && (
  <div className="mt-3 space-y-2">
    {message.toolCalls.map((tool, index) => (  // 显示所有工具
      <div key={index} className="bg-bg-primary/50 rounded p-2 text-sm">
        <div className="flex items-center gap-2">
          {tool.status === 'pending' ? (
            <Loader2 size={14} className="animate-spin text-yellow-500" />
          ) : tool.status === 'success' ? (
            <span className="text-green-500">✓</span>
          ) : (
            <span className="text-red-500">✗</span>
          )}
          <span className="font-mono">{tool.name}</span>
          <span className="text-xs text-text-secondary ml-auto">
            {tool.status === 'pending' ? '执行中...' :
             tool.duration ? `${tool.duration}ms` :
             tool.status === 'success' ? '完成' : '失败'}
          </span>
        </div>
      </div>
    ))}
  </div>
)}
```

#### After - 只显示执行中的工具

```tsx
{message.toolCalls && message.toolCalls.length > 0 && (
  <div className="mt-3 space-y-2">
    {message.toolCalls
      .filter((tool) => tool.status === 'pending')  // ✅ 只显示执行中
      .map((tool, index) => (
        <div key={index} className="bg-bg-primary/50 rounded p-2 text-sm">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-yellow-500" />
            <span className="font-mono">{tool.name}</span>
            <span className="text-xs text-text-secondary ml-auto">
              执行中...
            </span>
          </div>
        </div>
      ))}
  </div>
)}
```

### 关键变化

1. **添加过滤器**：`.filter((tool) => tool.status === 'pending')`
   - 只保留 `status === 'pending'` 的工具
   - 已完成（success）和失败（error）的不显示

2. **简化展示**：
   - 移除状态判断逻辑（success / error）
   - 固定显示加载图标和"执行中..."
   - 减少代码复杂度

3. **动态隐藏**：
   - 当所有工具完成后，过滤结果为空
   - 工具调用区域自动隐藏
   - 对话区更清爽

## 用户体验

### 工具执行流程

#### 1. 工具开始执行

**对话区**：
```
┌─────────────────────────┐
│ Assistant               │
│                         │
│ 🔄 Read                 │
│    执行中...            │
│                         │
│ [等待工具执行...]       │
└─────────────────────────┘
```

**工具 Tab**：
```
┌─────────────────────────┐
│ 🔧 工具调用             │
│                         │
│ Read    🔄 执行中       │
└─────────────────────────┘
```

#### 2. 工具执行完成

**对话区**：
```
┌─────────────────────────┐
│ Assistant               │
│                         │
│ [工具执行完成，区域消失]│
│                         │
│ 根据文件内容，我发现... │
└─────────────────────────┘
```

**工具 Tab**：
```
┌─────────────────────────┐
│ 🔧 工具调用             │
│                         │
│ Read    ✓ 120ms         │
└─────────────────────────┘
```

#### 3. 多个工具并行执行

**对话区**：
```
┌─────────────────────────┐
│ Assistant               │
│                         │
│ 🔄 Read                 │
│    执行中...            │
│ 🔄 Grep                 │
│    执行中...            │
│ 🔄 Bash                 │
│    执行中...            │
└─────────────────────────┘
```

**工具 Tab**：
```
┌─────────────────────────┐
│ 🔧 工具调用             │
│                         │
│ Read    🔄 执行中       │
│ Grep    🔄 执行中       │
│ Bash    🔄 执行中       │
└─────────────────────────┘
```

#### 4. 部分工具完成

**对话区**（只显示未完成的）：
```
┌─────────────────────────┐
│ Assistant               │
│                         │
│ 🔄 Bash                 │
│    执行中...            │
│                         │
│ [Read 和 Grep 完成后消失]│
└─────────────────────────┘
```

**工具 Tab**（显示所有）：
```
┌─────────────────────────┐
│ 🔧 工具调用             │
│                         │
│ Read    ✓ 120ms         │
│ Grep    ✓ 80ms          │
│ Bash    🔄 执行中       │
└─────────────────────────┘
```

## 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `desktop/renderer/components/MessageBubble.tsx` | 添加 `.filter((tool) => tool.status === 'pending')`，只显示执行中的工具 |

## 测试验证

### 单个工具执行

1. **开始执行**：
   ```
   期望：对话区显示 "🔄 Read 执行中..."
   ```

2. **执行完成**：
   ```
   期望：对话区工具区域消失，只显示回复内容
   ```

### 多个工具顺序执行

1. **第一个工具执行**：
   ```
   期望：对话区显示 "🔄 Read 执行中..."
   ```

2. **第一个完成，第二个开始**：
   ```
   期望：对话区显示切换为 "🔄 Edit 执行中..."
   ```

3. **第二个完成，第三个开始**：
   ```
   期望：对话区显示切换为 "🔄 Bash 执行中..."
   ```

4. **全部完成**：
   ```
   期望：对话区工具区域消失
   ```

### 多个工具并行执行

1. **三个工具同时开始**：
   ```
   期望：对话区显示三个工具，都是"执行中..."
   ```

2. **第一个完成**：
   ```
   期望：对话区只显示剩余两个工具
   ```

3. **第二个完成**：
   ```
   期望：对话区只显示最后一个工具
   ```

4. **全部完成**：
   ```
   期望：对话区工具区域消失
   ```

### 工具 Tab 验证

无论对话区是否显示，工具 Tab 都应该：
- ✅ 显示所有工具（执行中 + 已完成 + 失败）
- ✅ 正确显示状态和耗时
- ✅ 支持查看 input 和 output

## 设计理念

### 关注点分离

| 区域 | 职责 | 展示内容 |
|------|------|---------|
| 对话区 | 对话内容 + 实时状态 | 用户消息 + AI 回复 + 执行中的工具 |
| 工具 Tab | 工具调用历史 | 所有工具 + 详细信息 + 过滤功能 |
| Agent Tab | Agent 状态监控 | 当前状态 + 思考内容 + 当前工具 |
| 工作区 Tab | 执行流程可视化 | Agent 树 + 工具气泡 + 模式标识 |

### 信息层次

1. **核心信息**（对话区）：
   - 用户问题
   - AI 回复
   - 正在做什么（执行中的工具）

2. **详细信息**（右侧 Tab）：
   - 工具调用历史（工具 Tab）
   - Agent 内部状态（Agent Tab）
   - 执行流程可视化（工作区 Tab）

3. **辅助信息**（状态栏）：
   - Token 使用
   - 成本
   - 执行时间

## 用户反馈收集

如果用户仍然希望在对话区看到已完成的工具，可以考虑：

### 方案 A：折叠显示

```tsx
{message.toolCalls && message.toolCalls.length > 0 && (
  <details className="mt-3">
    <summary className="text-xs text-text-secondary cursor-pointer">
      工具调用 ({message.toolCalls.length})
    </summary>
    <div className="mt-2 space-y-2">
      {/* 显示所有工具 */}
    </div>
  </details>
)}
```

### 方案 B：配置项

在设置中添加选项：
- [ ] 在对话区显示已完成的工具

### 方案 C：悬浮提示

鼠标悬浮在消息上时，显示工具调用摘要：
```
hover: "使用了 3 个工具：Read, Edit, Bash"
```

## 相关文档

- [Inspector Panel Tabs 使用说明](./inspector-panel-tabs-guide.md)
- [Inspector Panel Tabs 修复记录](./inspector-panel-tabs-fix.md)
