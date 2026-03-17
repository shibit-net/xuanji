# 记忆系统重构：移除项目概念

## 背景

Xuanji 从"面向项目的开发工具"重新定位为"面向用户的通用 AI 助手"，需要移除所有"项目"概念。

## 核心改动

### 1. 类型重命名

| 之前 | 现在 | 说明 |
|------|------|------|
| `project_fact` | `knowledge` | 通用知识（编程、写作、学习等）|

### 2. 移除 Agent 隔离

| 移除项 | 理由 |
|--------|------|
| `agent_knowledge` 类型 | 方案 A：全局共享，不需要 Agent 专属知识库 |
| `MemoryMetadata.source` | agent_knowledge 专用，已废弃 |
| `MemoryMetadata.sourceType` | agent_knowledge 专用，已废弃 |

### 3. 移除项目级记忆

**之前的存储结构**：
```
~/.xuanji/memory/               ← 全局记忆
├── knowledge.jsonl
├── decisions.jsonl
├── sessions.jsonl
└── personal.jsonl

.xuanji/memory/                 ← 项目级记忆（已废弃）
└── knowledge.jsonl
```

**现在的存储结构**：
```
~/.xuanji/memory/               ← 全局记忆（所有会话共享）
├── knowledge.jsonl             ← 用户偏好、工具模式、通用知识
├── decisions.jsonl             ← 决策和错误解决
├── sessions.jsonl              ← 会话摘要
└── personal.jsonl              ← 个人信息（职业、关系、重要日期）
```

### 4. 代码改动

#### types.ts
```typescript
// 移除
| 'project_fact'
| 'agent_knowledge'

// 新增
| 'knowledge'

// 移除 MemoryEntry.projectPath
interface MemoryEntry {
  projectPath?: string;  // ❌ 删除
}

// 移除 MemoryMetadata 的 agent 相关字段
interface MemoryMetadata {
  source?: string;       // ❌ 删除
  sourceType?: string;   // ❌ 删除
}
```

#### LongTermMemory.ts
```typescript
// 移除 projectDir 字段
private projectDir: string | null;  // ❌ 删除

// 简化构造函数
constructor(
  projectRoot?: string,  // ❌ 删除参数
  config?: Partial<MemoryConfig>,
  storage?: StorageBackend,
) {
  this.projectDir = projectRoot ? join(projectRoot, '.xuanji', 'memory') : null;  // ❌ 删除
}

// 移除项目级读取方法
async readProject() { }  // ❌ 删除
async readGlobal() { }   // ❌ 删除

// 简化为单一方法
async readAll() {
  return this.readFromDir(this.globalDir, limit);
}

// 简化文件路径逻辑
private getFilePath(entry: MemoryEntry): string {
  const fileName = TYPE_FILE_MAP[entry.type] ?? 'knowledge.jsonl';
  return join(this.globalDir, fileName);  // 只使用全局目录
}
```

#### MemoryManager.ts
```typescript
// 移除 ProjectKnowledge
private projectKnowledge: ProjectKnowledge | null = null;  // ❌ 删除

// 移除 projectRoot 参数
constructor(config?: Partial<MemoryConfig>, projectRoot?: string) {  // ❌ 删除 projectRoot
  this.longTerm = new LongTermMemory(resolvedRoot, this.config, this.storage);  // ❌ 删除 resolvedRoot
  this.projectKnowledge = new ProjectKnowledge(...);  // ❌ 删除
}
```

#### SessionInitializer.ts
```typescript
// 移除 process.cwd() 传入
const memoryManager = new MemoryManager(memoryConfig, process.cwd());  // ❌ 删除 process.cwd()
const memoryManager = new MemoryManager(memoryConfig);  // ✅ 现在
```

## 迁移指南

### 自动迁移

运行迁移脚本：
```bash
node scripts/migrate-memory.mjs
```

**脚本功能**：
1. 将 `project_fact` 重命名为 `knowledge`
2. 移除所有 `projectPath` 字段
3. 自动备份原文件（.backup 后缀）

### 手动迁移（项目级记忆）

如果你有项目级记忆（`.xuanji/memory/`），需要手动合并到全局：

```bash
# 1. 找到项目级记忆文件
find . -path "*/.xuanji/memory/*.jsonl"

# 2. 手动追加到全局文件
cat .xuanji/memory/knowledge.jsonl >> ~/.xuanji/memory/knowledge.jsonl

# 3. 删除项目级目录（可选）
rm -rf .xuanji/memory
```

## 影响范围

### ✅ 兼容性保证
- 旧的记忆条目可以正常读取
- 迁移脚本自动处理类型重命名
- 保留所有历史数据

### ⚠️ 不兼容的变化
- 不再支持项目级记忆（需手动合并）
- `agent_knowledge` 类型将被忽略
- `projectPath` 字段会被自动忽略

## 设计理念

**Xuanji = 用户的 AI 助手**
- ✅ 不假设用户是开发者
- ✅ 不假设用户在做"项目"
- ✅ 所有记忆全局共享，跨场景可用
- ✅ 服务用户的所有诉求：学习、工作、生活、创作

**全局共享 vs Agent 隔离**
- ✅ 选择方案 A（全局共享）
- ✅ 所有 Agent 访问同一份记忆
- ✅ 确保回答一致性
- ✅ 简单易懂，用户无需管理

## 未来扩展

如果未来需要 Agent 专属知识库（方案 B），可以：
1. 恢复 `agent_knowledge` 类型
2. 在 `~/.xuanji/memory/agents/` 下创建子目录
3. 每个 Agent 有独立的 JSONL 文件

但目前不实施，保持简单。

---

**完成日期**: 2026-03-14
**影响版本**: v0.2.0+
**迁移脚本**: `scripts/migrate-memory.mjs`
