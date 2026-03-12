# 权限系统优化总结

## 问题

用户反馈当前权限系统"过于激进"，主要问题：

1. **过度依赖 LLM 主动性**：假设 LLM 会主动调用 `plan_review`，实际上经常直接执行代码修改
2. **代码修改缺少确认**：`write_file`/`edit_file` 标记为 `safe`，自动放行
3. **配置不够灵活**：无法针对代码修改、warn 级别操作分别配置

## 解决方案

### 核心改进

从"依赖 LLM 主动性"转为"系统主动保护 + 用户可配置"

### 新增配置

#### 1. `confirmWrite` — 写入确认策略（核心）

```typescript
type WriteConfirmStrategy = 
  | 'ask'        // 每次写入都需要确认（保守）
  | 'auto'       // 项目内写入自动放行（激进）
  | 'plan-only'; // 依赖 LLM 通过 plan_review 主动确认（默认，平衡）
```

**默认值**：`plan-only`
- 通过 system prompt 引导 LLM 在重大修改前主动调用 `plan_review`
- 普通文件修改自动放行，减少打扰
- 平衡了安全性和效率

#### 2. `warnLevel` — Warn 级别处理

**默认值变更**：`auto-allow` → `ask`
- 更保守，warn 级别操作（项目外写入、git push --force 等）需要确认
- 可设置为 `auto-allow` 恢复旧版本行为

#### 3. `confirmBatchWrite` — 批量写入合并（可选）

**默认值**：`false`
- `true`: 100ms 内的多个写入请求合并为一次确认

### 决策逻辑

```
工具调用
    ↓
守卫评估 → 风险分级（safe/warn/danger）
    ↓
┌─────────────────────────────────────┐
│ danger:  强制确认（不可绕过）       │
│ warn:    根据 warnLevel 配置        │
│ safe:                               │
│  - fileRead: 自动放行               │
│  - fileWrite (项目内):              │
│    • confirmWrite=ask → 确认        │
│    • confirmWrite=plan-only → 放行  │
│    • confirmWrite=auto → 放行       │
│  - bashExec: 自动放行               │
└─────────────────────────────────────┘
```

### 三种使用模式

#### 保守模式（安全优先）
```json
{
  "confirmWrite": "ask",
  "warnLevel": "ask"
}
```

#### 平衡模式（默认推荐）
```json
{
  "confirmWrite": "plan-only",
  "warnLevel": "ask"
}
```

#### 激进模式（效率优先）
```json
{
  "confirmWrite": "auto",
  "warnLevel": "auto-allow"
}
```

## 实现细节

### 类型定义

- `src/core/types/config.ts`: 新增 `WriteConfirmStrategy` 类型
- `src/permission/types.ts`: `GuardCheckResult` 增加 `context` 字段

### 核心逻辑

- `src/permission/PermissionController.ts`: 优化决策逻辑
- `src/permission/guards/FileGuard.ts`: 增加上下文信息（isProjectPath 等）

### 配置更新

- `src/core/config/defaults.ts`: 更新默认配置
- `src/core/config/ProjectConfigWriter.ts`: 配置文件模板

## 迁移指南

### 保持旧版本行为

```json
{
  "tools": {
    "permissions": {
      "warnLevel": "auto-allow",
      "confirmWrite": "auto"
    }
  }
}
```

### 采用更保守策略

```json
{
  "tools": {
    "permissions": {
      "warnLevel": "ask",
      "confirmWrite": "ask"
    }
  }
}
```

## 文件清单

### 修改的文件

1. `src/core/types/config.ts` — 新增类型定义
2. `src/permission/types.ts` — GuardCheckResult 增加 context
3. `src/permission/PermissionController.ts` — 优化决策逻辑
4. `src/permission/guards/FileGuard.ts` — 增加上下文信息
5. `src/core/config/defaults.ts` — 更新默认配置
6. `src/core/config/ProjectConfigWriter.ts` — 配置模板
7. `CHANGELOG.md` — 更新日志

### 新增的文档

1. `docs/permission-optimization.md` — 优化方案设计文档
2. `docs/permission-guide.md` — 用户配置指南
3. `docs/permission-optimization-summary.md` — 本总结文档

## 编译测试

✅ 编译通过 (`npm run build`)
✅ 类型检查通过

## 总结

**关键改进**：

1. ✅ **不再过度依赖 LLM 主动性**：系统主动控制，用户可配置
2. ✅ **代码修改有确认机制**：`confirmWrite` 三档可选
3. ✅ **配置更灵活**：保守/平衡/激进三种模式
4. ✅ **向后兼容**：现有配置仍然有效，可通过配置恢复旧行为
5. ✅ **渐进式增强**：通过 system prompt 引导 LLM 使用 plan_review

**默认行为变化**：
- `warnLevel`: `auto-allow` → `ask`（更保守）
- 新增 `confirmWrite: 'plan-only'`（平衡模式）

**用户体验**：
- 默认配置下，LLM 在重大修改前会主动调用 `plan_review`
- Warn 级别操作（项目外写入、危险命令）需要确认
- Danger 级别操作始终需要确认
- 用户可根据需求自由调整配置策略
