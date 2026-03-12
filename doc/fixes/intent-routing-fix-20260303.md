# 修复：意图路由和工具动态加载

## 问题描述

用户反馈"按意图识别需要加载的 Skill 和工具没有生效"。

## 根本原因

在 `ChatSession.init()` 流程中：

1. L145: 创建 `DynamicToolFilter`，此时 `activeSkills = []`（空数组）
2. L165: 调用 `buildSystemPrompt()`，其中调用 `registry.getSchemas()`
3. 因为 `activeSkills` 是空数组，`computeAllowedTools([])` 只返回核心工具 + 元能力工具
4. 导致 system prompt 构建时工具列表不完整

虽然 `run()` 方法中会调用 `setActiveSkills()` 更新工具列表，但 system prompt 已经在 `init()` 时构建完毕，AgentLoop 已经创建，导致首轮对话使用的是不完整的工具列表。

## 修复方案

**文件**：`src/core/chat/ChatSession.ts`

### 修改 1：init() 中设置默认 activeSkills（L142-156）

```typescript
// 3.5. 🆕 如果启用动态工具加载，包装为 DynamicToolFilter
if (this.config!.features?.dynamicToolLoading) {
  const { DynamicToolFilter } = await import('@/core/tools/DynamicToolFilter');
  const filter = new DynamicToolFilter(this.baseRegistry!);

  // 🔧 修复：设置默认的 activeSkills（所有启用的 Skill）
  // 避免 buildSystemPrompt() 时 activeSkills 为空导致工具列表为空
  const enabledIds = this.config!.skills?.enabled ?? [];
  const defaultActiveSkills = enabledIds
    .map(id => skillRegistry.get(id))
    .filter((s): s is import('@/core/skills/types').Skill => s !== undefined);

  filter.setActiveSkills(defaultActiveSkills);
  this.registry = filter;
  log.debug(`DynamicToolFilter enabled with ${defaultActiveSkills.length} default skills`);
}
```

**关键改动**：
- 在创建 `DynamicToolFilter` 后，立即设置默认的 `activeSkills`
- 默认值：所有启用的 Skill（`config.skills.enabled`）
- 这样 `buildSystemPrompt()` 时工具列表就是完整的

### 修改 2：run() 中增强日志（L569-586）

```typescript
// 优先使用向量匹配，降级到正则匹配
let filteredIds: string[];
if (this.vectorSkillMatcher?.isInitialized()) {
  filteredIds = await this.vectorSkillMatcher.matchSkills(enabledIds, userMessage);
  log.debug(`Vector skill matcher: ${filteredIds.length}/${enabledIds.length} skills matched`);
} else {
  filteredIds = this.skillRegistry.filterByIntent(enabledIds, userMessage);
  log.debug(`Regex skill matcher: ${filteredIds.length}/${enabledIds.length} skills matched`);
}

// ...

// 🆕 如果启用动态工具加载，更新工具过滤器
if (this.config.features?.dynamicToolLoading && this.registry) {
  const { DynamicToolFilter } = await import('@/core/tools/DynamicToolFilter');
  if (this.registry instanceof DynamicToolFilter) {
    this.registry.setActiveSkills(activeSkills);
    log.info(`Intent routing: ${activeSkills.length} skills → ${this.registry.getSchemas().length} tools`);
  }
}

// ...

this.agentLoop!.getMessageManager().setSystemPrompt(systemPrompt);
log.info(`System prompt rebuilt: ${promptSkillIds.length} skills, ${this.registry!.getSchemas().length} tools`);
```

**关键改动**：
- 使用 `log.info` 输出意图路由结果（用户可见）
- 显示激活的 Skill 数量和工具数量

## 验证结果

运行验证脚本 `scripts/verify-intent-routing.ts`：

```
✓ 初始化完成
  基础工具总数: 25
  init() 后可用工具: 21

✅ 默认 activeSkills 设置正确

✓ 意图路由完成
  激活 Skill: xuanji-assistant, memory-context, code-assistant, ...
  意图路由后可用工具: 16
  工具列表: read_file, write_file, edit_file, bash, ...

✅ 核心工具完整
✅ 编程工具存在
✅ 生活工具已过滤

💰 Token 节省: 5 个工具 (24%)
```

**结论**：
- ✅ init() 后工具列表完整（21 个，包含所有启用 Skill 的工具）
- ✅ 意图路由后正确过滤（16 个，只包含编程相关工具）
- ✅ 生活工具（memory_store, reminder_set, web_search, web_fetch）被正确过滤
- ✅ 节省 5 个工具（24% tokens）

## 影响范围

**修改文件**：
- `src/core/chat/ChatSession.ts`（2 处修改）

**影响功能**：
- ✅ 意图路由正常工作
- ✅ 工具动态加载正常工作
- ✅ 不影响其他功能

## 后续优化建议

当前设计是"两阶段过滤"：

1. **init() 阶段**：设置所有启用的 Skill → 工具列表包含所有场景工具
2. **run() 阶段**：根据意图过滤 Skill → 工具列表只包含相关场景工具

**潜在问题**：
- init() 时构建的 system prompt 包含所有工具（21 个）
- run() 时虽然更新了工具列表（16 个），但 system prompt 已经构建好了
- 导致 system prompt 中的工具列表和实际传递给 LLM 的工具列表不一致

**解决方案**（可选，Phase 2）：
- run() 中意图路由后，如果工具列表有变化，重新构建 system prompt
- 或者在 system prompt 中不包含工具列表，只在 tools 参数中传递

---

**修复完成时间**：2026-03-03
**测试状态**：✅ 通过
**部署状态**：✅ 已合并
