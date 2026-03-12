# 权限系统优化方案

## 问题总结

当前权限系统过于激进，主要问题：

1. **过度信任 LLM 自主性**：假设 LLM 会主动调用 `plan_review`，实际上经常直接执行代码修改
2. **代码修改缺少确认**：`write_file`/`edit_file` 标记为 `safe`，自动放行
3. **配置不够灵活**：无法针对代码修改、warn 级别操作分别配置

## 优化方案：分层确认机制

### 核心理念

**从"依赖 LLM 主动性"转为"系统主动保护 + 用户可配置"**

### 新的风险评估流程

```
工具调用
    ↓
守卫评估 → 风险分级（safe/warn/danger）
    ↓
配置决策层（新增）
    ↓
┌─────────────────────────────────────┐
│ safe 级别:                          │
│  - 读取项目内文件: 自动放行         │
│  - 搜索(glob/grep): 自动放行        │
│                                     │
│ write 操作（项目内）:               │
│  - confirmWrite=ask → 确认          │
│  - confirmWrite=auto → 自动放行     │
│  - confirmWrite=plan-only → LLM决定 │
│                                     │
│ warn 级别:                          │
│  - warnLevel=ask → 强制确认         │
│  - warnLevel=auto → 自动放行        │
│                                     │
│ danger 级别:                        │
│  - 始终强制确认（不可绕过）         │
└─────────────────────────────────────┘
```

### 配置选项（新增）

```typescript
interface PermissionConfig {
  // 现有配置
  level: PermissionLevel;
  warnLevel?: 'auto' | 'ask';  // warn 级别操作的处理方式
  
  // 新增配置
  confirmWrite?: 'ask' | 'auto' | 'plan-only';
  // - ask: 每次写入操作都需要确认（保守）
  // - auto: 项目内写入自动放行（激进，当前行为）
  // - plan-only: 依赖 LLM 通过 plan_review 主动确认（默认，平衡）
  
  confirmBatchWrite?: boolean;
  // 是否在批量写入时（单次执行多个 write/edit）弹出合并确认
  // 默认 false（逐个确认）
  
  // 现有配置
  allowedPaths?: string[];
  deniedPaths?: string[];
  allowedCommands?: string[];
  deniedCommands?: string[];
  persistDecisions?: boolean;
  decisionsFile?: string;
}
```

### 默认配置（向后兼容 + 更保守）

```typescript
const DEFAULT_CONFIG = {
  level: 'moderate',
  warnLevel: 'ask',           // 改为 ask（之前是 auto）
  confirmWrite: 'plan-only',  // 新增：依赖 LLM plan_review
  confirmBatchWrite: false,
  persistDecisions: true,
};
```

### 三种使用模式

#### 模式 1: 保守模式（安全优先）
```typescript
{
  confirmWrite: 'ask',        // 所有写入都需要确认
  warnLevel: 'ask',           // warn 级别需要确认
}
```
**适用**：生产环境、重要项目

#### 模式 2: 平衡模式（默认）
```typescript
{
  confirmWrite: 'plan-only',  // 依赖 LLM plan_review
  warnLevel: 'ask',           // warn 级别需要确认
}
```
**适用**：日常开发

#### 模式 3: 激进模式（效率优先）
```typescript
{
  confirmWrite: 'auto',       // 项目内写入自动放行
  warnLevel: 'auto',          // warn 级别自动放行
}
```
**适用**：个人实验项目、原型开发

### 实现细节

#### 1. FileGuard 调整

不改变风险分级逻辑，但增加上下文信息：

```typescript
interface GuardCheckResult {
  category: 'fileRead' | 'fileWrite' | 'bashExec';
  riskLevel: 'safe' | 'warn' | 'danger';
  description: string;
  cacheKey: string;
  
  // 新增字段
  context?: {
    isProjectPath?: boolean;    // 是否在项目目录内
    isSensitiveFile?: boolean;  // 是否是敏感文件
    affectedFiles?: string[];   // 受影响的文件列表（批量操作）
  };
}
```

#### 2. PermissionController 决策逻辑

```typescript
async check(request: PermissionRequest): Promise<PermissionResult> {
  const guardResult = this.evaluateGuard(toolName, input);
  if (!guardResult) return { allowed: true };

  const { riskLevel, category, context } = guardResult;

  // Danger: 始终确认
  if (riskLevel === 'danger') {
    return this.requestConfirmation(request, guardResult);
  }

  // Warn: 根据 warnLevel 配置
  if (riskLevel === 'warn') {
    if (this.config.warnLevel === 'ask') {
      return this.requestConfirmation(request, guardResult);
    }
    return { allowed: true, checkedBy: 'auto-warn' };
  }

  // Safe + Write: 根据 confirmWrite 配置
  if (category === 'fileWrite' && context?.isProjectPath) {
    const confirmWrite = this.config.confirmWrite ?? 'plan-only';
    
    if (confirmWrite === 'ask') {
      return this.requestConfirmation(request, guardResult);
    }
    
    if (confirmWrite === 'plan-only') {
      // 在 system prompt 中引导 LLM 主动调用 plan_review
      // 此处自动放行，但期望 LLM 会先调用 plan_review
      return { allowed: true, checkedBy: 'plan-delegated' };
    }
    
    // confirmWrite === 'auto'
    return { allowed: true, checkedBy: 'auto-write' };
  }

  // Safe + Read: 自动放行
  return { allowed: true, checkedBy: 'auto-safe' };
}
```

#### 3. System Prompt 增强

根据配置动态调整 system prompt：

```typescript
// 当 confirmWrite === 'plan-only' 时，在 system prompt 中添加：
`
Before modifying multiple files or making significant code changes:
1. Use the plan_review tool to submit your execution plan
2. Wait for user approval before proceeding
3. If the plan is rejected, ask the user for clarification

Example plan structure:
## Goal
Brief description of what you want to achieve

## Changes
- File 1: What will be modified and why
- File 2: What will be created and why

## Risks
Potential impacts or concerns
`
```

#### 4. 批量写入优化（可选）

检测单次会话中的多个 write/edit 调用：

```typescript
private pendingWrites: PermissionRequest[] = [];
private writeTimer: NodeJS.Timeout | null = null;

async check(request: PermissionRequest): Promise<PermissionResult> {
  // ... existing logic

  if (this.config.confirmBatchWrite && category === 'fileWrite') {
    // 收集 100ms 内的写入请求
    this.pendingWrites.push(request);
    
    if (this.writeTimer) clearTimeout(this.writeTimer);
    
    return new Promise((resolve) => {
      this.writeTimer = setTimeout(() => {
        if (this.pendingWrites.length > 1) {
          // 批量确认
          this.requestBatchConfirmation(this.pendingWrites).then(resolve);
        } else {
          // 单个确认
          this.requestConfirmation(request, guardResult).then(resolve);
        }
        this.pendingWrites = [];
      }, 100);
    });
  }
}
```

### UI 调整

#### 确认对话框增强

```
┌─────────────────────────────────────────────────┐
│ 📝 File Write Confirmation                     │
├─────────────────────────────────────────────────┤
│ The agent wants to modify:                     │
│                                                 │
│ • src/core/agent/AgentLoop.ts                  │
│   Add error handling for stream timeout        │
│                                                 │
│ Risk: Safe (within project)                    │
│                                                 │
│ [Y] Allow   [N] Deny   [A] Always   [V] View   │
│                                                 │
│ Tip: Set confirmWrite=auto to skip these       │
└─────────────────────────────────────────────────┘
```

### 迁移指南

#### 对于现有用户

**默认行为变化**：
- `warnLevel` 默认从 `auto-allow` 改为 `ask`
- 新增 `confirmWrite: 'plan-only'`

**如果希望保持原有激进行为**：
```typescript
// .xuanji/config.json
{
  "permission": {
    "warnLevel": "auto",
    "confirmWrite": "auto"
  }
}
```

**如果希望更保守**：
```typescript
{
  "permission": {
    "warnLevel": "ask",
    "confirmWrite": "ask"
  }
}
```

### 总结

**关键改进**：

1. ✅ **不再过度依赖 LLM 主动性**：系统主动控制，用户可配置
2. ✅ **代码修改有确认机制**：`confirmWrite` 三档可选
3. ✅ **配置更灵活**：保守/平衡/激进三种模式
4. ✅ **向后兼容**：现有配置仍然有效
5. ✅ **渐进式增强**：通过 system prompt 引导 LLM 使用 plan_review

**默认行为**：
- `confirmWrite: 'plan-only'` — 依赖 LLM 主动调用 plan_review（通过 prompt 引导）
- `warnLevel: 'ask'` — warn 级别操作需要确认（更保守）
- Danger 级别：始终确认（不变）
