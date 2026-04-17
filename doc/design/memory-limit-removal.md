# 记忆系统上限移除方案

## 问题背景

用户反馈记忆库在达到 1000 条后不再更新。经排查发现：

1. `DEFAULT_MEMORY_CONFIG.longTermMaxEntries` 硬编码为 1000
2. `MemoryManager.compact()` 会简单粗暴地截断到 1000 条
3. 当记忆总数超过 `compactionThreshold: 500` 时自动触发压缩
4. 结果：新记忆会挤掉旧的低权重记忆，但总数永远不超过 1000

## 根本原因

这是早期设计的遗留问题。当时还没有智能压缩和提炼机制，只能通过硬限制防止记忆库无限增长。

现在已经有了完善的智能维护系统：
- `MemoryCompactor` — LLM 驱动的智能去重和合并
- `MemoryRefiner` — LLM 驱动的记忆升级和提炼
- `MemoryMaintenanceScheduler` — 定期自动维护（24h 压缩 + 12h 提炼）

硬编码的 1000 条上限已经过时，且与智能维护系统功能重复。

## 解决方案

### 1. 移除硬限制

**修改文件：** `src/memory/types.ts`

```typescript
// 修改前
longTermMaxEntries: 1000,
compactionThreshold: 500,

// 修改后
longTermMaxEntries: 100000,  // 移除硬限制，依赖智能压缩维护
compactionThreshold: 10000,  // 提高阈值，减少频繁触发
```

### 2. 废弃简单截断逻辑

**修改文件：** `src/memory/MemoryManager.ts`

**compact() 方法改动：**
- 标记为 `@deprecated`
- 委托给 `MemoryMaintenanceScheduler` 的智能压缩
- 降级方案：仅更新权重，不再硬截断删除记忆

**save() 方法改动：**
- 移除自动触发 `compact()` 的逻辑
- 完全依赖 `MemoryMaintenanceScheduler` 的定期维护

### 3. 智能维护系统接管

记忆维护完全由 `MemoryMaintenanceScheduler` 负责：

- **压缩周期：** 24 小时
- **提炼周期：** 12 小时
- **压缩策略：** LLM 智能去重、合并相似记忆、标记过时记忆
- **提炼策略：** 升级错误解决为经验教训、从多条情节提炼领域知识

## 影响分析

### 正面影响

1. **记忆库可持续增长** — 不再受 1000 条硬限制
2. **更智能的维护** — LLM 驱动的去重和提炼，而非简单截断
3. **更好的记忆质量** — 保留有价值的记忆，淘汰真正过时的
4. **架构更清晰** — 职责分离，维护逻辑集中在 Scheduler

### 潜在风险

1. **数据库体积增长** — 需要监控 `memory.db` 大小
2. **检索性能** — 记忆条目增多可能影响检索速度（已有向量索引缓解）
3. **维护成本** — LLM 驱动的压缩和提炼会消耗 API 调用

### 缓解措施

1. **监控告警** — 当记忆总数超过 50000 时发出警告
2. **手动干预** — 提供 `/memory compact` 和 `/memory refine` 命令
3. **配置化** — 用户可通过配置文件调整 `longTermMaxEntries`
4. **性能优化** — 向量检索 + FTS5 全文索引保证查询性能

## 迁移指南

### 对现有用户的影响

**无需手动迁移**，代码改动向后兼容：

1. 已有的 1000 条记忆会保留
2. 新记忆可以正常添加，不再受限
3. 智能维护系统会逐步优化记忆质量

### 配置调整（可选）

如果需要自定义上限，可在 `~/.xuanji/config.json` 中添加：

```json
{
  "memory": {
    "longTermMaxEntries": 50000,
    "compactionThreshold": 20000,
    "maintenance": {
      "enabled": true,
      "compactionInterval": 86400000,
      "refinementInterval": 43200000,
      "useLLM": true
    }
  }
}
```

## 测试验证

### 单元测试

- [ ] `MemoryManager.compact()` 不再硬截断
- [ ] 记忆总数可以超过 1000
- [ ] 智能维护系统正常工作

### 集成测试

- [ ] 添加 2000 条记忆，验证全部保存
- [ ] 触发自动维护，验证去重和提炼
- [ ] 检索性能测试（10000+ 记忆场景）

### 性能基准

| 记忆总数 | 检索耗时 | 压缩耗时 | 提炼耗时 |
|---------|---------|---------|---------|
| 1,000   | < 50ms  | < 2s    | < 5s    |
| 10,000  | < 100ms | < 10s   | < 30s   |
| 50,000  | < 200ms | < 30s   | < 60s   |

## 后续优化

1. **增量维护** — 只处理新增记忆，避免全量扫描
2. **分层存储** — 冷热分离，归档低访问记忆
3. **用户可见性** — GUI 显示维护进度和统计
4. **智能调度** — 根据系统负载动态调整维护频率

## 参考资料

- [M5 记忆系统设计](./llm-driven-memory-system.md)
- [记忆维护调度器](../../src/memory/MemoryMaintenanceScheduler.ts)
- [记忆压缩器](../../src/memory/MemoryCompactor.ts)
- [记忆提炼器](../../src/memory/MemoryRefiner.ts)

---

**修改日期：** 2026-04-17  
**修改人：** Kevin Shi  
**版本：** v3.1
