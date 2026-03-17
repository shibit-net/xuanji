# Agent 分组显示优化报告

## 实施日期
2026-03-16

## 概述
将 GUI Agents 面板中的 Agent 列表从按来源分组（builtin/global/project）改为按类型分组（公开/内部系统）。

---

## 修改内容

### 文件：`desktop/renderer/components/AgentManager.tsx`

#### 1. 修改分组逻辑

**位置**: 第 78-88 行

**修改前**（按来源分组）:
```typescript
// 分组
const groupedAgents = useMemo(() => {
  return filteredAndSortedAgents.reduce((groups, agent) => {
    const source = agent.metadata?.source || 'unknown';
    if (!groups[source]) {
      groups[source] = [];
    }
    groups[source].push(agent);
    return groups;
  }, {} as Record<string, typeof agents>);
}, [filteredAndSortedAgents]);
```

**修改后**（按类型分组）:
```typescript
// 分组（按公开/内部分组）
const groupedAgents = useMemo(() => {
  const publicAgents: typeof agents = [];
  const internalAgents: typeof agents = [];

  filteredAndSortedAgents.forEach((agent) => {
    if (agent.metadata?.internal === true) {
      internalAgents.push(agent);
    } else {
      publicAgents.push(agent);
    }
  });

  const groups: Record<string, typeof agents> = {};
  if (publicAgents.length > 0) {
    groups['public'] = publicAgents;
  }
  if (internalAgents.length > 0) {
    groups['internal'] = internalAgents;
  }

  return groups;
}, [filteredAndSortedAgents]);
```

**分组规则**:
- **公开 Agent** (`metadata.internal !== true`): 用户可直接调用的 Agent
- **内部系统 Agent** (`metadata.internal === true`): 系统自动调用的 Agent

#### 2. 修改分组标签

**位置**: 第 183-194 行

**修改前**:
```typescript
const getSourceLabel = (source: string) => {
  switch (source) {
    case 'builtin':
      return '📦 内置';
    case 'global':
      return '🌐 全局';
    case 'project':
      return '📁 项目';
    default:
      return '未知';
  }
};
```

**修改后**:
```typescript
const getGroupLabel = (group: string) => {
  switch (group) {
    case 'public':
      return '🌟 公开 Agent';
    case 'internal':
      return '🔧 内部系统 Agent';
    default:
      return '未知';
  }
};
```

#### 3. 更新列表渲染

**位置**: 第 383-447 行

**关键修改**:
```typescript
// 修改前
{Object.entries(groupedAgents).map(([source, groupAgents]) => {
  // ...
  <span>{getSourceLabel(source)}</span>
  // ...
  {getSourceIcon(source)}
})}

// 修改后
{Object.entries(groupedAgents).map(([group, groupAgents]) => {
  // ...
  <span>{getGroupLabel(group)}</span>
  // ...
  const source = agent.metadata?.source || 'unknown';
  {getSourceIcon(source)}
})}
```

**说明**:
- 分组标签改为使用 `getGroupLabel(group)`
- 来源图标仍然从 `agent.metadata.source` 读取（保留 builtin/global/project 图标）

---

## UI 效果

### 分组显示

```
┌─────────────────────────────────────┐
│  Agent 管理                  7 / 7  │
├─────────────────────────────────────┤
│  [搜索框...]                        │
│  [筛选 ▼]                           │
│  [创建 Agent]                       │
│                                     │
│  🌟 公开 Agent                   5  │
│    📦 编程助手             ⭐       │
│    📦 探索助手             🤖       │
│    📦 通用助手             🤖       │
│    📦 架构师               🤖       │
│    📦 璇玑                 ⭐       │
│                                     │
│  🔧 内部系统 Agent            2     │
│    📦 上下文压缩器         🤖       │
│    📦 意图分析器           🤖       │
└─────────────────────────────────────┘
```

### 分组说明

#### 🌟 公开 Agent（5 个）

用户可以直接调用的 Agent：

| Agent | 说明 | 工具数 |
|-------|------|--------|
| coder | 编程助手 | 9 |
| explore | 探索助手 | 6 |
| general-purpose | 通用助手 | 10 |
| plan | 架构师 | 6 |
| xuanji | 璇玑 | 29 |

#### 🔧 内部系统 Agent（2 个）

系统自动调用的 Agent：

| Agent | 说明 | 工具数 | 调用时机 |
|-------|------|--------|----------|
| context-compressor | 上下文压缩器 | 0 | AgentLoop 上下文超阈值时 |
| intent-analyzer | 意图分析器 | 0 | IntentRouter 向量匹配未命中时 |

---

## 设计优势

### 1. 清晰的职责划分

- **公开 Agent**: 用户主动调用，完成具体任务
- **内部 Agent**: 系统自动调用，优化系统性能

### 2. 更好的用户体验

- 用户一眼就能区分哪些 Agent 可以直接使用
- 内部 Agent 分组展示，便于理解系统架构

### 3. 保留来源信息

- 分组改为类型，但仍保留来源图标（📦 内置 / 🌐 全局 / 📁 项目）
- 用户可以同时看到 Agent 类型和来源

### 4. 灵活的筛选

- 仍然可以通过"来源"筛选器过滤 builtin/global/project
- 分组和筛选互补，提供多维度视图

---

## 与之前功能的关系

### 保留的功能

✅ **来源图标**: 每个 Agent 仍显示来源图标（📦/🌐/📁）

✅ **Agent 类型徽章**: 仍显示 ⭐ 主 Agent / 🤖 子 Agent / 📝 自定义

✅ **筛选功能**: 仍可按来源（builtin/global/project）、状态（启用/禁用）筛选

✅ **排序功能**: 仍可按名称、创建时间、来源排序

### 修改的功能

🔄 **分组逻辑**: 从按来源分组改为按类型分组（公开/内部）

🔄 **分组标签**: 从 "📦 内置 / 🌐 全局 / 📁 项目" 改为 "🌟 公开 Agent / 🔧 内部系统 Agent"

---

## 代码统计

| 文件 | 修改类型 | 代码量 |
|------|---------|--------|
| `desktop/renderer/components/AgentManager.tsx` | 修改分组逻辑和标签 | ~30 行（净增约 10 行） |

---

## 测试建议

### 手动测试

```bash
# 1. 启动 GUI
cd desktop && npm run dev:electron

# 2. 打开 Agents 面板

# 3. 验证分组显示
#    - 应显示两个分组："🌟 公开 Agent (5)" 和 "🔧 内部系统 Agent (2)"
#    - 公开 Agent: coder, explore, general-purpose, plan, xuanji
#    - 内部 Agent: context-compressor, intent-analyzer

# 4. 验证图标和标签
#    - 每个 Agent 仍显示来源图标（📦 内置）
#    - 每个 Agent 仍显示类型徽章（⭐ 主 Agent / 🤖 子 Agent）

# 5. 验证筛选功能
#    - 按来源筛选（内置/全局/项目）仍然正常工作
#    - 按状态筛选（启用/禁用）仍然正常工作

# 6. 验证排序功能
#    - 按名称排序：在各分组内排序
#    - 按来源排序：在各分组内排序
```

### 类型检查

```bash
cd desktop && npx tsc --noEmit
```

**结果**: ✅ 无 AgentManager 相关的类型错误

---

## 总结

### ✅ 已完成

1. **分组逻辑修改**: 从按来源分组改为按类型分组（公开/内部）
2. **分组标签更新**: "🌟 公开 Agent" 和 "🔧 内部系统 Agent"
3. **保留来源图标**: Agent 卡片中仍显示来源图标
4. **保留筛选功能**: 仍可按来源、状态、名称筛选和排序

### 🎯 核心价值

- ✅ **清晰的分类**: 用户一眼就能区分公开和内部 Agent
- ✅ **更好的组织**: 7 个 Agent 按职责分为两组，层次清晰
- ✅ **保留灵活性**: 仍可通过筛选器按来源过滤
- ✅ **用户友好**: 图标和标签提供多维度信息

### 📈 预期效果

```
之前：
- 按来源分组（📦 内置、🌐 全局、📁 项目）
- 所有 7 个 Agent 都在 "📦 内置" 分组下

现在：
- 按类型分组（🌟 公开 Agent、🔧 内部系统 Agent）
- 5 个公开 Agent + 2 个内部系统 Agent
- 用户可以快速识别哪些 Agent 可以直接使用
```

---

## 相关文档

- Agent 显示修复: `doc/prd/xuanji/agent-display-fix.md`
- Agent Registry 实现: `src/core/agent/AgentRegistry.ts`
- Agent Manager 组件: `desktop/renderer/components/AgentManager.tsx`
