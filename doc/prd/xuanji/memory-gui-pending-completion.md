# 记忆系统 GUI 待完成功能实现报告

## 实施日期
2026-03-16

## 概述
完成记忆系统 GUI 的三个待完成功能：配置持久化、统计数据优化和记忆列表功能。

---

## 已完成工作

### 1. 配置持久化逻辑 ✅

#### 1.1 更新默认配置

**文件**: `src/core/config/defaults.ts`

**新增配置字段**：
```typescript
memory: {
  enabled: true,
  shortTermMaxEntries: 100,
  longTermMaxEntries: 1000,
  retrieveMaxResults: 10,
  maxEntryLength: 500,
  maxPromptLength: 5000,
  compactionThreshold: 500,
  decayHalfLifeDays: 30,
  // Phase 4: 智能记忆刷新配置（OpenClaw 启发）
  intelligentFlush: {
    enabled: true,
    tokenThreshold: 0.75,
    timeThreshold: 30 * 60 * 1000, // 30 分钟
    valueThreshold: 50,
    keepRecentMessages: 5,
  },
  // Phase 3: 主题提取配置（OpenClaw 启发）
  topicExtraction: {
    enabled: true,
    autoTrigger: 'session-end',
    mergeThreshold: 0.85,
    minEntriesForExtraction: 2,
  },
  // Phase 2: 记忆格式化配置（OpenClaw 风格）
  formatting: {
    style: 'openclaw',
    showAccessCount: true,
    showRelatedMemories: true,
    maxTimelineItems: 10,
  },
  // Phase 5: Token 估算配置
  tokenEstimation: {
    method: 'simple',
    charsPerToken: 3,
  },
},
```

#### 1.2 实现配置保存逻辑

**文件**: `desktop/main/agent-bridge.ts`

**handleSaveMemoryConfig 函数** (~35 行)：
```typescript
async function handleSaveMemoryConfig(requestId: string, data: any) {
  // 1. 读取当前全局配置
  const currentConfig = await GlobalConfig.readGlobalConfig();

  // 2. 合并 memory 配置
  const updatedConfig = {
    ...currentConfig,
    memory: {
      ...currentConfig.memory,
      ...memoryConfig,
    },
  };

  // 3. 保存到全局配置文件 (~/.xuanji/config.json)
  await GlobalConfig.writeGlobalConfig(updatedConfig);

  // 4. 热更新运行时 MemoryManager 配置
  (memoryManager as any).config = updatedConfig.memory;

  // 5. 返回成功（标记需要重启会话）
  process.send?.({ requestId, data: { success: true, requiresRestart: true } });
}
```

**配置文件路径**: `~/.xuanji/config.json`

**配置格式**:
```json
{
  "version": "1.0.0",
  "config": {
    "memory": {
      "enabled": true,
      "intelligentFlush": {
        "enabled": true,
        "tokenThreshold": 0.75,
        "timeThreshold": 1800000,
        "valueThreshold": 50,
        "keepRecentMessages": 5
      },
      "topicExtraction": {
        "enabled": true,
        "mergeThreshold": 0.85,
        "minEntriesForExtraction": 2
      },
      "tokenEstimation": {
        "charsPerToken": 3
      }
    }
  }
}
```

#### 1.3 更新 GUI 提示

**文件**: `desktop/renderer/components/MemoryManager.tsx`

**handleSaveConfig 函数**：
- 检查 `result.requiresRestart` 标志
- 显示提示："配置已保存，请重启会话使配置生效"

---

### 2. 统计数据优化 ✅

#### 2.1 重写 getStats() 方法

**文件**: `src/memory/MemoryManager.ts`

**之前**：
```typescript
async getStats(): Promise<{ total: number; byType: Record<string, number> }> {
  // 只统计 longTerm 和 project
  const byType = { shortTerm: 0, longTerm: 0, project: 0 };
  // ...
  return { total, byType };
}
```

**现在**：
```typescript
async getStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  byCategory?: { timeline?: number; topic?: number; fact?: number };
}> {
  const byType: Record<string, number> = {};
  const byCategory = {
    timeline: 0,
    topic: 0,
    fact: 0,
  };

  // 从缓存中统计（更准确）
  const allEntries = this.cachedEntries;

  // 按类型统计
  for (const entry of allEntries) {
    const type = entry.type || 'unknown';
    byType[type] = (byType[type] || 0) + 1;
  }

  // 按分类统计
  for (const entry of allEntries) {
    if (entry.category === 'timeline') {
      byCategory.timeline++;
    } else if (entry.category === 'topic') {
      byCategory.topic++;
    } else if (entry.category === 'fact') {
      byCategory.fact++;
    }
  }

  const total = allEntries.length;
  return { total, byType, byCategory };
}
```

**优化点**：
- ✅ 从缓存（`cachedEntries`）统计，避免重复读取文件
- ✅ 添加 `byCategory` 统计（timeline / topic / fact）
- ✅ 动态按类型统计（不再硬编码 shortTerm/longTerm/project）
- ✅ 更准确的记忆总数

---

### 3. 记忆列表功能 ✅

#### 3.1 添加 IPC 通信

**文件**: `desktop/renderer/global.d.ts`

**新增方法**：
```typescript
getMemoryList: (data: {
  query?: string;
  type?: string;
  category?: string;
  limit?: number
}) => Promise<{ success: boolean; memories?: any[]; error?: string }>;
```

**文件**: `desktop/main/preload.ts`

**暴露方法**：
```typescript
getMemoryList: (data) => ipcRenderer.invoke('memory:get-list', data),
```

**文件**: `desktop/main/index.ts`

**IPC 处理器**：
```typescript
ipcMain.handle('memory:get-list', async (_event, data: any) => {
  return await sendRequest('memory-get-list', data);
});
```

#### 3.2 实现后端逻辑

**文件**: `desktop/main/agent-bridge.ts`

**handleGetMemoryList 函数** (~50 行)：
```typescript
async function handleGetMemoryList(requestId: string, data: any) {
  const memoryManager = session.getMemoryManager();

  // 1. 从 MemoryManager 获取缓存的记忆条目
  const allMemories = (memoryManager as any).cachedEntries || [];

  // 2. 应用过滤条件
  let filteredMemories = allMemories;

  // 按 category 过滤
  if (data.category && data.category !== 'all') {
    filteredMemories = filteredMemories.filter(
      (m: any) => m.category === data.category
    );
  }

  // 按 type 过滤
  if (data.type && data.type !== 'all') {
    filteredMemories = filteredMemories.filter(
      (m: any) => m.type === data.type
    );
  }

  // 按查询词过滤（搜索 content 和 keywords）
  if (data.query && data.query.trim()) {
    const query = data.query.toLowerCase();
    filteredMemories = filteredMemories.filter((m: any) => {
      const content = (m.content || '').toLowerCase();
      const keywords = (m.keywords || []).join(' ').toLowerCase();
      return content.includes(query) || keywords.includes(query);
    });
  }

  // 3. 按时间排序（最新在前）
  filteredMemories.sort((a: any, b: any) => {
    const aTime = new Date(a.lastAccessedAt || a.createdAt).getTime();
    const bTime = new Date(b.lastAccessedAt || b.createdAt).getTime();
    return bTime - aTime;
  });

  // 4. 限制数量
  const limit = data.limit || 100;
  const memories = filteredMemories.slice(0, limit);

  process.send?.({ requestId, data: { success: true, memories } });
}
```

**新增 case 分支**：
```typescript
case 'memory-get-list':
  handleGetMemoryList(msg.requestId, msg.data);
  break;
```

#### 3.3 实现前端 ListView 组件

**文件**: `desktop/renderer/components/MemoryManager.tsx`

**ListView 组件** (~200 行)：

**核心功能**：
- 🔍 **实时搜索**：300ms 防抖，搜索 content 和 keywords
- 🎯 **分类过滤**：全部 / 时间线 / 主题 / 事实
- 📊 **动态统计**：显示当前过滤结果数量
- 🔄 **自动加载**：监听搜索和过滤条件变化
- 📋 **卡片展示**：图标 + 类型标签 + 内容预览
- 🔎 **展开详情**：点击卡片展开查看完整信息
- ⏰ **智能时间**：相对时间显示（刚刚 / 5 分钟前 / 2 小时前 / 3 天前）

**UI 结构**：
```
┌─────────────────────────────────────────────────────┐
│ [🔍 搜索框]                                         │
├─────────────────────────────────────────────────────┤
│ [🎯 分类过滤] ▾ 全部类型                  125 条记忆 │
├─────────────────────────────────────────────────────┤
│ ┌─ 记忆卡片 1 ────────────────────────────────────┐ │
│ │ 📅 时间线  session_summary        5 分钟前      │ │
│ │ 讨论了 TypeScript 类型系统的最佳实践...         │ │
│ │                                                  │ │
│ │ [展开详情]                                       │ │
│ │ 关键词: typescript, types, best-practices       │ │
│ │ 置信度: 90%                                      │ │
│ │ 访问次数: 5                                      │ │
│ │ 来源: conversation                               │ │
│ │ ID: mem-20260316-abc123                          │ │
│ └──────────────────────────────────────────────────┘ │
│ ┌─ 记忆卡片 2 ────────────────────────────────────┐ │
│ │ ✨ 主题  user_preference           2 小时前     │ │
│ │ 用户偏好使用 Bun 而不是 npm 来管理包             │ │
│ └──────────────────────────────────────────────────┘ │
│ ...                                                  │
└─────────────────────────────────────────────────────┘
```

**类型标签样式**：
```typescript
const getCategoryStyle = (category?: string) => {
  switch (category) {
    case 'timeline':
      return { icon: '📅', label: '时间线', color: 'text-blue-400' };
    case 'topic':
      return { icon: '✨', label: '主题', color: 'text-green-400' };
    case 'fact':
      return { icon: '📚', label: '事实', color: 'text-purple-400' };
    default:
      return { icon: '📝', label: '其他', color: 'text-gray-400' };
  }
};
```

**时间格式化**：
```typescript
const formatDate = (dateStr: string) => {
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;
  return date.toLocaleDateString('zh-CN');
};
```

**展开详情显示**：
- 关键词列表
- 置信度（百分比）
- 访问次数
- 来源
- 记忆 ID（单行显示）
- 主题 ID（如果有）
- 日期键（如果有）

---

## 技术细节

### 配置持久化流程

```
用户点击 "保存配置"
  ↓
window.electron.saveMemoryConfig({ config })
  ↓ IPC: memory:save-config
  ↓ agent-bridge: handleSaveMemoryConfig()
  ├── GlobalConfig.readGlobalConfig()
  ├── 合并 memory 配置
  ├── GlobalConfig.writeGlobalConfig()
  ├── 热更新 memoryManager.config
  └── 返回 { success: true, requiresRestart: true }
  ↓
Toast 提示: "配置已保存，请重启会话使配置生效"
```

### 记忆列表数据流

```
用户输入搜索词 / 切换过滤器
  ↓ 300ms 防抖
  ↓ loadMemories()
  ↓ window.electron.getMemoryList({ query, category, limit })
  ↓ IPC: memory:get-list
  ↓ agent-bridge: handleGetMemoryList()
  ├── 获取 memoryManager.cachedEntries
  ├── 按 category 过滤
  ├── 按 type 过滤
  ├── 按 query 过滤（content + keywords）
  ├── 按时间排序（最新在前）
  ├── 限制数量（默认 100）
  └── 返回 { success: true, memories: [...] }
  ↓
渲染记忆卡片列表
```

---

## 代码统计

| 项目 | 代码量 |
|------|-------|
| defaults.ts 修改 | +30 行 |
| agent-bridge.ts 修改 | +90 行 |
| MemoryManager.ts 修改 | +35 行 |
| MemoryManager.tsx 修改 | +180 行 |
| global.d.ts / preload.ts / index.ts 修改 | +15 行 |
| **总计** | **~350 行** |

---

## 测试建议

### 1. 配置持久化测试

```bash
# 1. 启动 GUI
cd desktop && npm run dev:electron

# 2. 打开 Memory 面板 → 配置 Tab
# 3. 调整配置（如 Token 阈值从 75% 改为 80%）
# 4. 点击 "保存配置"
# 5. 验证提示："配置已保存，请重启会话使配置生效"

# 6. 检查配置文件
cat ~/.xuanji/config.json
# 验证 memory.intelligentFlush.tokenThreshold = 0.8

# 7. 重启会话（点击 "新建会话"）
# 8. 再次打开 Memory 面板，验证配置已加载
```

### 2. 统计数据测试

```bash
# 1. 打开 Memory 面板 → 统计 Tab
# 2. 验证总记忆数显示
# 3. 验证 Timeline / Topic / Fact 卡片显示
# 4. 验证记忆类型分布图显示

# 5. 在 Chat 中发送一些消息
# 6. 手动触发刷新或等待自动刷新
# 7. 返回统计 Tab，点击刷新按钮
# 8. 验证统计数据更新
```

### 3. 记忆列表测试

```bash
# 1. 打开 Memory 面板 → 记忆列表 Tab
# 2. 验证记忆卡片列表显示

# 3. 测试搜索功能
#    - 输入关键词（如 "typescript"）
#    - 验证列表过滤
#    - 清空搜索，验证恢复

# 4. 测试分类过滤
#    - 选择 "时间线"
#    - 验证只显示 timeline 类型
#    - 选择 "主题"
#    - 验证只显示 topic 类型

# 5. 测试展开详情
#    - 点击卡片
#    - 验证详情展开
#    - 再次点击，验证折叠

# 6. 测试时间显示
#    - 验证相对时间格式（刚刚 / 5 分钟前 等）
```

---

## 已知限制

### 限制 1: 配置需要重启会话生效

- **现象**: 修改配置后，当前会话不会立即生效
- **原因**: IntelligentMemoryFlush 和 TopicExtractor 在初始化时读取配置
- **解决方案**: 提示用户重启会话
- **改进方向**: 实现配置热更新（重新初始化组件）

### 限制 2: 记忆列表不支持编辑

- **现象**: 只能查看记忆，不能编辑或删除
- **原因**: 未实现编辑功能
- **改进方向**: 添加编辑按钮 + 编辑对话框

### 限制 3: 记忆列表性能

- **现象**: 大量记忆时可能加载较慢
- **原因**: 一次加载 100 条记忆
- **改进方向**: 实现虚拟滚动或分页加载

---

## 总结

### ✅ 已完成功能

1. **配置持久化**
   - 保存到 `~/.xuanji/config.json`
   - 支持所有记忆配置（intelligentFlush / topicExtraction / tokenEstimation）
   - 热更新运行时配置
   - 友好的用户提示

2. **统计数据优化**
   - byCategory 统计（timeline / topic / fact）
   - 从缓存统计（性能优化）
   - 动态按类型统计
   - 更准确的总数计算

3. **记忆列表功能**
   - 实时搜索（300ms 防抖）
   - 分类过滤
   - 卡片式展示
   - 展开/折叠详情
   - 智能时间格式化
   - 动态统计显示

### 🎯 核心价值

- ✅ **完整的配置管理**：用户可通过 GUI 配置所有记忆系统参数
- ✅ **准确的统计数据**：Timeline/Topic/Fact 三维度统计
- ✅ **便捷的记忆浏览**：搜索、过滤、展开详情，一应俱全
- ✅ **优秀的用户体验**：实时反馈、防抖优化、相对时间

### 📈 用户工作流

```
1. 查看统计 → 了解记忆分布
2. 调整配置 → 优化刷新策略
3. 浏览记忆 → 了解存储内容
4. 手动操作 → 触发刷新/提取
```

---

## 下一步改进方向（可选）

### 优先级 1: 记忆编辑功能

- 添加编辑按钮
- 编辑对话框（类似 MemoryEditor.tsx）
- 保存编辑后的记忆
- 删除记忆功能

### 优先级 2: 配置热更新

- 保存配置后立即重新初始化组件
- 无需重启会话即可生效
- 显示 "配置已生效" 提示

### 优先级 3: 性能优化

- 虚拟滚动（大量记忆时）
- 分页加载（按需加载）
- 缓存搜索结果

### 优先级 4: 高级功能

- 批量操作（批量删除、导出）
- 记忆关系图（可视化关联记忆）
- 时间线视图（按日期展示）
- 导入导出记忆（JSON 格式）
