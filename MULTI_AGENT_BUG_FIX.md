# Multi-Agent 工具测试与 Bug 修复报告

## 📋 测试总结

测试了三种 Multi-Agent 协作功能：
1. **delegate** — 委托单个专业 Agent 执行任务
2. **orchestrate** — 自定义 Agent 团队编排
3. **quick_team** — 使用预定义模板快速创建团队

**测试结果**: 全部失败，错误信息为 "not initialized. Internal error: dependencies not injected."

---

## 🐛 Bug 根因分析

### 问题定位流程

1. **初始假设**: 依赖注入代码未调用
   - ❌ 检查后发现依赖注入代码存在且被调用

2. **第二假设**: 工具未正确注册
   - ❌ 检查后发现工具正确注册到 `baseRegistry`

3. **第三假设**: 工具实例被过滤
   - ✅ 部分正确：`DynamicToolFilter` 会过滤工具，但 Multi-Agent 工具在 `META` 类别，始终可用

4. **最终根因**: **依赖注入时传递了错误的 registry 实例**

### 核心问题

**文件**: `src/core/chat/ChatSession.ts`  
**行号**: 244  
**问题代码**:
```typescript
initializer.injectMultiAgentToolDeps(
  this._taskTool,
  this._teamTool,
  this._quickTeamTool,
  this.providerManager!,
  this.agentRegistry,
  this.registry!,  // ❌ 错误：传递的是 DynamicToolFilter 实例
  ...
);
```

**问题描述**:
- `this.registry` 在启用 `dynamicToolLoading`（默认启用）时是 `DynamicToolFilter` 实例
- `DynamicToolFilter` 会根据当前激活的 Skill 过滤工具
- Sub-Agent 执行时需要访问完整的工具集（如 `explore` agent 需要 `grep`, `read_file` 等）
- 如果传入过滤后的 registry，Sub-Agent 可能无法获取所需工具

**影响范围**:
- 所有使用 `delegate`, `orchestrate`, `quick_team` 的场景
- 默认配置下（`dynamicToolLoading: true`）必现

---

## ✅ 修复方案

### 代码更改

**文件**: `src/core/chat/ChatSession.ts`  
**行号**: 237-246

**修复前**:
```typescript
// 注入 Multi-Agent 工具依赖（DelegateTool, OrchestrateTool, QuickTeamTool）
initializer.injectMultiAgentToolDeps(
  this._taskTool,
  this._teamTool,
  this._quickTeamTool,
  this.providerManager!,
  this.agentRegistry,
  this.registry!,  // ❌ DynamicToolFilter 实例
  this.config,
  systemPrompt,
  this.hookRegistry,
  this.memoryManager
);
```

**修复后**:
```typescript
// 注入 Multi-Agent 工具依赖（DelegateTool, OrchestrateTool, QuickTeamTool）
// ⚠️ 重要：这里必须传递 baseRegistry（完整工具集），而不是 DynamicToolFilter
// 因为 Sub-Agent 需要完整的工具来执行任务
initializer.injectMultiAgentToolDeps(
  this._taskTool,
  this._teamTool,
  this._quickTeamTool,
  this.providerManager!,
  this.agentRegistry,
  this.baseRegistry!,  // ✅ 传递完整工具注册表
  this.config,
  systemPrompt,
  this.hookRegistry,
  this.memoryManager
);
```

### 修复原理

- **主 Agent** 使用 `this.registry`（可能是 `DynamicToolFilter`），根据当前 Skill 动态加载工具
- **Sub-Agent** 使用 `this.baseRegistry`（完整工具集），保证可以访问所有必要工具
- 这符合设计意图：Sub-Agent 是独立执行的专业 Agent，不应受主 Agent 的 Skill 过滤影响

---

## 🧪 验证方法

### 手动测试

重新构建并运行 xuanji：
```bash
npm run build
npm start
```

在对话中测试：
```
测试 delegate:
"用 explore agent 分析 src/memory/ 目录的结构"

测试 quick_team:
"用 code-review team 审查 src/memory/UnifiedMemoryStore.ts"

测试 orchestrate:
"创建研究团队调研 AI 编程助手的最佳实践"
```

### 预期结果

✅ 工具不再报错 "not initialized"  
✅ Sub-Agent 成功执行并返回结果  
✅ 可以看到 Sub-Agent 的执行统计（duration, tokens, iterations）

---

## 📚 相关代码

### 工具分类定义
**文件**: `src/core/tools/ToolCategories.ts`  
**说明**: Multi-Agent 工具被定义在 `META` 类别，始终可用

```typescript
META: [
  'todo_create',
  'todo_update',
  'todo_list',
  'todo_get',
  'delegate',      // ← SubAgent 调度
  'orchestrate',   // ← Agent 团队编排
  'quick_team',    // ← 快捷团队
  'plan_review',
  'enter_plan_mode',
  'exit_plan_mode',
] as const,
```

### 工具初始化
**文件**: `src/core/chat/ChatSession.ts:382-425`  
**说明**: 在 `initTaskTool()` 中注册这三个工具

### 依赖注入
**文件**: `src/core/chat/SessionInitializer.ts:585-641`  
**说明**: `injectMultiAgentToolDeps` 方法负责注入运行时依赖

---

## 🎯 经验教训

1. **依赖注入必须传递正确的实例**  
   - 区分 `baseRegistry`（完整工具集）和 `registry`（可能被包装/过滤）
   - Sub-Agent 需要完整工具集，不应受主 Agent 的上下文限制

2. **默认配置的影响范围**  
   - `dynamicToolLoading: true` 是默认值，影响所有用户
   - 必须在默认配置下充分测试

3. **调试思路**  
   - 从错误信息出发 → 定位代码路径 → 检查依赖关系 → 验证假设
   - 使用 grep/读代码快速定位关键逻辑

---

## ✅ 修复状态

- [x] Bug 定位完成
- [x] 代码修复完成
- [x] 注释添加完成
- [ ] 待验证：重新构建并测试
- [ ] 待完成：添加单元测试（防止回归）
- [ ] 待完成：更新 CHANGELOG.md

---

## 📝 后续优化建议

1. **添加单元测试**  
   测试 `injectMultiAgentToolDeps` 使用不同 registry 类型的行为

2. **改进错误提示**  
   如果依赖未注入，错误信息应更明确（哪个依赖缺失）

3. **文档补充**  
   在开发文档中说明 `baseRegistry` vs `registry` 的使用场景

4. **自动化检查**  
   在 ChatSession.initialize() 完成后验证 Multi-Agent 工具的依赖状态
