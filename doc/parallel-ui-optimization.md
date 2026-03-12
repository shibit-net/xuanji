# 并行工具 UI 优化 — 树状结构展示

## 优化概述

将并行工具的扁平化列表展示优化为树状层级结构，提升视觉清晰度和用户体验。

## 核心改进

### 1. 新增组件
- **ParallelToolGroup**: 动态执行区域的并行工具树状展示
- **ParallelToolGroupCompact**: 静态历史区域的并行工具组（支持折叠/展开）

### 2. 状态管理增强
- 新增 `currentParallelGroup` 状态，用于收集当前批次的并行工具
- 新增 `tool_group` 消息类型，统一展示已完成的并行工具组
- 新增 `ParallelToolGroupItem` 类型定义

### 3. 展示优化

#### 动态区域（执行中）
使用清晰的树状字符构建层级结构：

```
┌─ ⚡ Parallel Execution (2/3 completed)
├─ ✓ Read file  package.json  (0.08s)
├─ ⏳ Grep  pattern="export" in src  (2.5KB)
└─ ⏳ Glob  src/**/*.tsx
```

**特点**:
- `┌─` 顶部边界，标识并行组开始
- `├─` 中间项目，连接符清晰
- `└─` 最后项目，闭合树状结构
- 状态图标：`✓` 已完成，`⏳` 执行中，`✗` 错误
- 实时进度：显示已完成数 / 总数

#### 静态区域（折叠模式）
紧凑单行显示，节省空间：

```
⚡ Parallel (3 tools): Read file, Grep, Glob ✓ 0.23s
```

#### 静态区域（展开模式）
带边框的树状结构，支持 Tab 导航：

```
┌─────────────────────────────────────────────┐
│ ⚡ Parallel Execution (3 tools) · 0.23s ✓   │
│                                             │
│  ├─ ✓ Read file  package.json  (0.08s)     │
│  ├─ ✓ Grep  pattern="export" in src (0.12s)│
│  └─ ✓ Glob  src/**/*.tsx  (0.03s)          │
└─────────────────────────────────────────────┘
```

## 技术实现

### 消息类型扩展
```typescript
// 新增 tool_group 消息类型
export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'tool_group';
  // ...
  toolGroupItems?: ParallelToolGroupItem[];
}

// 并行工具组项
export interface ParallelToolGroupItem {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
  duration: number;
}
```

### 状态管理
```typescript
interface ToolStateShape {
  // 现有状态
  status: 'idle' | 'thinking' | 'tool';
  activeTools: Map<string, {...}>;
  parallelIds: Set<string>;
  activeSubAgents: Map<string, SubAgentState>;
  
  // 🆕 新增状态
  currentParallelGroup: Map<string, ParallelToolGroupItem>;
}
```

### 工具完成逻辑
```typescript
onToolEnd: (id, name, result, isError) => {
  // 检查是否为并行工具
  if (isParallel) {
    // 添加到并行组
    dispatchTool({ type: 'TOOL_GROUP_ADD', id, item: {...} });
    
    // 检查是否所有并行工具都已完成
    setTimeout(() => {
      if (currentGroup.size === parallelIds.size) {
        // 创建 tool_group 消息
        setMessages([...prev, { role: 'tool_group', toolGroupItems: [...] }]);
        // 清空并行组
        dispatchTool({ type: 'TOOL_GROUP_CLEAR' });
      }
    }, 0);
  } else {
    // 串行工具：正常处理
    // ...
  }
}
```

## 用户交互

### 键盘操作
- **Tab**: 在工具结果之间导航（包括并行工具组）
- **Enter**: 展开/折叠选中的工具或工具组
- **q**: 退出导航模式

### 自动行为
- 并行工具组默认折叠（静态区域），节省空间
- 支持 Tab 导航选中并行组，Enter 展开查看详情
- 展开后显示完整的树状结构 + 边框高亮

## 测试场景

### 场景 1: 多个 readonly 工具并行
```bash
# 用户输入
请同时读取 package.json、tsconfig.json、README.md 这三个文件

# 预期效果
动态区域显示树状进度 → 完成后合并为一个 tool_group 消息
```

### 场景 2: 混合并行和串行
```bash
# 用户输入
先读取 package.json，然后同时搜索 src 目录中的 import 语句和 export 语句

# 预期效果
1. Read file (串行) → 单独显示
2. Grep + Grep (并行) → 树状组合显示
```

### 场景 3: 大量并行工具
```bash
# 用户输入
请读取 src 目录下的所有 .ts 文件

# 预期效果
树状结构清晰展示 10+ 个文件的并行读取进度
```

## 性能优化

1. **批量状态更新**: 使用 `useReducer` 确保并行工具状态变化只触发一次渲染
2. **延迟合并**: 使用 `setTimeout(0)` 等待所有并行工具完成后才创建 tool_group 消息
3. **Ref 追踪**: 使用 `toolStateRef` 在异步回调中访问最新状态，避免闭包陷阱

## 向后兼容

- 保留原有 `toolParallel` 标记，供旧版代码识别
- 新旧消息类型共存，不影响现有功能
- 工具导航逻辑兼容 `tool` 和 `tool_group` 两种消息

## 文件变更清单

### 新增文件
- `src/adapters/cli/ParallelToolGroup.tsx` — 并行工具组组件

### 修改文件
- `src/adapters/cli/types.ts` — 新增 `tool_group` 和 `ParallelToolGroupItem` 类型
- `src/adapters/cli/App.tsx` — 状态管理、onToolEnd 逻辑、渲染集成
- `src/adapters/cli/CollapsibleToolResult.tsx` — 导出 format 函数供并行组复用

## 后续优化建议

1. **颜色主题**: 为并行组添加独特的配色方案（如青色边框）
2. **动画效果**: 工具完成时添加过渡动画（Ink 限制较大，可选）
3. **统计信息**: 在并行组标题显示总耗时、平均耗时等统计数据
4. **错误聚合**: 如果并行组中有多个错误，在顶部显示错误汇总
