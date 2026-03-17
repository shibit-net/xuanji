# Multi-Agent 工具测试总结

## 📊 测试时间
2026-01-XX

## 🎯 测试目的
验证 xuanji 的三种 Multi-Agent 协作功能：
1. **delegate** — 委托专业 Agent 执行独立任务
2. **orchestrate** — 创建自定义 Agent 团队
3. **quick_team** — 使用预定义模板快速组队

---

## ❌ 初始测试结果

所有三个工具**均失败**，错误信息一致：
```
"not initialized. Internal error: dependencies not injected."
```

---

## 🔍 Bug 调查过程

### 步骤 1: 检查工具定义
✅ 工具类正确实现，有完整的 `setDependencies` 方法：
- `src/core/tools/DelegateTool.ts`
- `src/core/tools/OrchestrateTool.ts`
- `src/core/tools/QuickTeamTool.ts`

### 步骤 2: 检查工具注册
✅ 工具在 `ChatSession.initTaskTool()` 中正确注册：
```typescript
const delegateTool = new DelegateTool();
this.baseRegistry.register(delegateTool);
this._taskTool = delegateTool;
```

### 步骤 3: 检查依赖注入
✅ 依赖注入方法存在且被调用：
```typescript
// ChatSession.ts:238
initializer.injectMultiAgentToolDeps(
  this._taskTool,
  this._teamTool,
  this._quickTeamTool,
  ...
);
```

### 步骤 4: 检查工具过滤
✅ Multi-Agent 工具被定义在 `META` 类别（`ToolCategories.ts:39-50`），始终可用：
```typescript
META: [
  'delegate',
  'orchestrate',
  'quick_team',
  ...
] as const,
```

### 步骤 5: 发现根因 🎯

**问题定位**：`ChatSession.ts:244`

```typescript
// ❌ 错误代码
initializer.injectMultiAgentToolDeps(
  ...
  this.registry!,  // 传递的是 DynamicToolFilter 实例
);
```

**问题分析**：
- 当 `config.features.dynamicToolLoading = true`（默认值）时
- `this.registry` 是 `DynamicToolFilter` 的实例，会根据当前 Skill 过滤工具
- Sub-Agent 需要**完整的工具注册表**才能执行任务（例如 `explore` agent 需要 `grep`, `read_file` 等）
- 传入过滤后的 registry 导致 Sub-Agent 无法获取必要工具

---

## ✅ 修复方案

**文件**：`src/core/chat/ChatSession.ts`  
**修改行**：244

**修复前**：
```typescript
initializer.injectMultiAgentToolDeps(
  ...
  this.registry!,  // ❌ DynamicToolFilter
);
```

**修复后**：
```typescript
// ⚠️ 重要：这里必须传递 baseRegistry（完整工具集），而不是 DynamicToolFilter
// 因为 Sub-Agent 需要完整的工具来执行任务
initializer.injectMultiAgentToolDeps(
  ...
  this.baseRegistry!,  // ✅ 完整工具注册表
);
```

**修复原理**：
- **主 Agent** 使用 `this.registry`（可能是 `DynamicToolFilter`），根据 Skill 动态加载工具
- **Sub-Agent** 使用 `this.baseRegistry`（完整工具集），保证可以访问所有工具
- 符合设计意图：Sub-Agent 是独立的专业 Agent，不应受主 Agent 的 Skill 过滤影响

---

## 📁 相关文件

### 核心代码
- `src/core/tools/DelegateTool.ts` — 任务委托工具
- `src/core/tools/OrchestrateTool.ts` — 团队编排工具
- `src/core/tools/QuickTeamTool.ts` — 快速团队工具
- `src/core/chat/ChatSession.ts` — 会话管理（Bug 所在）
- `src/core/chat/SessionInitializer.ts` — 依赖注入逻辑
- `src/core/tools/ToolCategories.ts` — 工具分类定义
- `src/core/tools/DynamicToolFilter.ts` — 动态工具过滤器

### 配置
- `src/core/config/defaults.ts:102` — `dynamicToolLoading: true`（默认值）

---

## 🧪 验证方法

### 构建项目
```bash
npm run build
```

### 测试命令（待执行）

1. **测试 delegate**
   ```
   用 explore agent 分析 src/memory/ 目录的结构
   ```

2. **测试 quick_team**
   ```
   用 code-review team 审查 src/memory/UnifiedMemoryStore.ts
   ```

3. **测试 orchestrate**
   ```
   创建研究团队调研 AI 编程助手的最佳实践
   ```

### 预期结果
✅ 工具不再报错 "not initialized"  
✅ Sub-Agent 成功执行并返回结果  
✅ 输出包含执行统计（duration, tokens, iterations）

---

## 📝 经验教训

### 1. 依赖注入的精确性很重要
- 区分 `baseRegistry`（完整工具集）和 `registry`（可能被包装）
- Sub-Agent 需要独立的完整工具集

### 2. 默认配置的影响范围
- `dynamicToolLoading: true` 是默认值
- 必须在默认配置下充分测试所有功能

### 3. 调试方法论
1. 从错误信息出发
2. 逐步定位代码路径
3. 检查依赖关系
4. 验证假设
5. 使用 grep/read_file 快速定位关键逻辑

### 4. 工具设计的层次性
- **核心工具（CORE）**：所有场景都需要
- **元能力工具（META）**：任务管理、Agent 编排，始终可用
- **场景工具（SCENE）**：按 Skill 分组，动态加载

---

## ✅ 修复状态

- [x] Bug 定位完成
- [x] 代码修复完成
- [x] 注释添加完成
- [x] 项目构建成功
- [ ] **待验证**：实际运行测试
- [ ] **待完成**：添加单元测试（防止回归）
- [ ] **待完成**：更新 CHANGELOG.md

---

## 🚀 后续优化建议

### 1. 添加单元测试
测试 Multi-Agent 工具在不同 registry 配置下的行为：
- 使用 `baseRegistry` 时
- 使用 `DynamicToolFilter` 时

### 2. 改进错误提示
如果依赖未注入，明确指出哪个依赖缺失：
```typescript
if (!this.providerManager) {
  return this.error('providerManager not injected');
}
```

### 3. 自动化检查
在 `ChatSession.initialize()` 完成后验证关键工具的状态：
```typescript
if (this._taskTool && !this._taskTool.isInitialized()) {
  log.error('DelegateTool dependencies not injected!');
}
```

### 4. 文档补充
在开发文档中说明：
- `baseRegistry` vs `registry` 的使用场景
- Sub-Agent 的依赖注入原则
- 工具分类（CORE/META/SCENE）的设计意图

---

## 📖 参考资料

### 工具分类系统
详见 `src/core/tools/ToolCategories.ts`：
- CORE: 基础工具（read_file, bash, grep, glob, ask_user）
- META: 元能力工具（delegate, orchestrate, quick_team, todo_*, plan_review）
- SCENE: 场景工具（按 Skill 分组，动态加载）

### Multi-Agent 架构
- SubAgent Context: `src/core/agent/SubAgentContext.ts`
- SubAgent Loop: `src/core/agent/SubAgentLoop.ts`
- Team Manager: `src/core/agent/team/TeamManager.ts`
- Team Templates: `src/core/agent/team/templates.ts`

---

**总结**：通过系统化的调试流程，定位并修复了 Multi-Agent 工具的依赖注入问题。修复后，Sub-Agent 将能够访问完整的工具集，正常执行各种专业任务。
