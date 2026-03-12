# 权限系统配置指南

## 概述

Xuanji 的权限系统采用**分层确认机制**，在安全性和效率之间取得平衡。

## 配置选项

### 1. 文件权限

```typescript
{
  "tools": {
    "permissions": {
      "fileRead": "always",  // 读取文件权限
      "fileWrite": "ask",    // 写入文件权限
      "bashExec": "ask"      // 命令执行权限
    }
  }
}
```

**可选值**：
- `always`: 自动允许
- `ask`: 询问用户
- `never`: 禁止

### 2. Warn 级别处理（新增）

```typescript
{
  "tools": {
    "permissions": {
      "warnLevel": "ask"  // 默认值
    }
  }
}
```

**说明**：
- `ask`: warn 级别操作需要用户确认（更保守）
- `auto-allow`: warn 级别操作自动放行（更激进）

**Warn 级别操作包括**：
- 项目外文件写入
- 敏感文件读取（.env, .ssh/id_rsa 等）
- 潜在危险命令（sudo、rm -rf、git push --force 等）

### 3. 写入确认策略（核心新增）

```typescript
{
  "tools": {
    "permissions": {
      "confirmWrite": "plan-only"  // 默认值
    }
  }
}
```

**可选值**：

#### `ask` — 保守模式
- **行为**：每次写入项目内文件都需要用户确认
- **适用场景**：生产环境、重要项目
- **优点**：最大程度保护代码不被误改
- **缺点**：确认频繁，影响效率

#### `plan-only` — 平衡模式（默认）
- **行为**：依赖 LLM 主动调用 `plan_review` 工具进行确认
- **适用场景**：日常开发
- **优点**：LLM 自主决定何时需要确认，减少不必要的打扰
- **说明**：System prompt 会引导 LLM 在进行多文件修改或重大变更前调用 `plan_review`

#### `auto` — 激进模式
- **行为**：项目内文件写入自动放行，不需要确认
- **适用场景**：个人实验项目、原型开发
- **优点**：效率最高
- **缺点**：没有代码修改前的确认

### 4. 批量写入合并（可选）

```typescript
{
  "tools": {
    "permissions": {
      "confirmBatchWrite": false  // 默认 false
    }
  }
}
```

- `true`: 100ms 内的多个写入请求合并为一次确认
- `false`: 逐个确认（默认）

## 三种使用模式

### 模式 1: 保守模式（安全优先）

```json
{
  "tools": {
    "permissions": {
      "fileRead": "always",
      "fileWrite": "ask",
      "bashExec": "ask",
      "warnLevel": "ask",
      "confirmWrite": "ask"
    }
  }
}
```

**特点**：
- 所有写入操作都需要确认
- Warn 级别操作需要确认
- 适合生产环境、重要项目

### 模式 2: 平衡模式（默认推荐）

```json
{
  "tools": {
    "permissions": {
      "fileRead": "always",
      "fileWrite": "ask",
      "bashExec": "ask",
      "warnLevel": "ask",
      "confirmWrite": "plan-only"
    }
  }
}
```

**特点**：
- 依赖 LLM 主动调用 plan_review
- Warn 级别操作需要确认
- 适合日常开发

### 模式 3: 激进模式（效率优先）

```json
{
  "tools": {
    "permissions": {
      "fileRead": "always",
      "fileWrite": "always",
      "bashExec": "ask",
      "warnLevel": "auto-allow",
      "confirmWrite": "auto"
    }
  }
}
```

**特点**：
- 项目内文件写入自动放行
- Warn 级别操作自动放行
- 仅 Danger 级别强制确认
- 适合个人实验项目、原型开发

## 风险分级

### Safe（安全）
- 项目内文件读取
- 普通命令（git status、ls、cat 等）
- **处理**：自动放行（除非 confirmWrite=ask）

### Warn（警告）
- 项目外文件写入
- 敏感文件读取（.env、.ssh/id_rsa 等）
- 潜在危险命令（sudo、rm -rf、git push --force 等）
- **处理**：根据 warnLevel 配置

### Danger（危险）
- 系统关键路径操作（/etc、/bin 等）
- 用户敏感目录操作（~/.ssh、~/.aws 等）
- 敏感文件写入
- 极度危险命令（rm -rf /、fork bomb 等）
- **处理**：强制用户确认（不可绕过）

## 迁移指南

### 从旧版本升级

**变更点**：

1. **warnLevel 默认值变更**
   - 旧版本：`auto-allow`（自动放行）
   - 新版本：`ask`（需要确认）

2. **新增 confirmWrite 配置**
   - 默认值：`plan-only`（依赖 LLM plan_review）

### 保持旧版本行为

如果你希望保持旧版本的激进行为：

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

### 采用更保守的策略

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

## System Prompt 增强

当 `confirmWrite` 设置为 `plan-only` 时，System Prompt 会自动包含以下指引：

```
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
```

这确保 LLM 在重大修改前主动寻求用户确认。

## 常见问题

### Q: 为什么我现在收到更多确认提示？

A: 新版本默认 `warnLevel: 'ask'`，之前是 `auto-allow`。这是为了更保守地保护你的代码。

**解决方案**：
- 如果你信任 xuanji，可以设置 `warnLevel: 'auto-allow'`
- 或者保持 `ask` 但选择 "Always Allow"（会缓存决策）

### Q: LLM 没有主动调用 plan_review，直接开始改代码怎么办？

A: 这种情况下：
- 选项 1：设置 `confirmWrite: 'ask'` 强制每次确认
- 选项 2：在提示词中明确要求："先用 plan_review 展示计划"
- 选项 3：使用 `/plan` 模式（只读模式，LLM 只能规划不能执行）

### Q: 如何禁用某些工具的权限检查？

A: 使用白名单配置：

```json
{
  "tools": {
    "permissions": {
      "allowedPaths": ["src/**", "docs/**"],
      "allowedCommands": ["^git", "^npm", "^ls"]
    }
  }
}
```

匹配白名单的操作会被标记为 `safe` 级别。

### Q: Danger 级别操作可以绕过吗？

A: **不可以**。Danger 级别是硬编码的安全兜底，无论配置如何都会强制用户确认。这是为了防止 prompt injection 攻击。

### Q: 批量确认（confirmBatchWrite）什么时候有用？

A: 当你让 LLM 同时修改多个文件时（比如重构），启用此选项可以将多个确认合并为一次。但默认禁用，因为逐个确认更清晰。

## 推荐配置

### 日常开发（推荐）

```json
{
  "tools": {
    "permissions": {
      "fileRead": "always",
      "fileWrite": "ask",
      "bashExec": "ask",
      "warnLevel": "ask",
      "confirmWrite": "plan-only"
    }
  }
}
```

### 生产环境操作

```json
{
  "tools": {
    "permissions": {
      "fileRead": "always",
      "fileWrite": "ask",
      "bashExec": "ask",
      "warnLevel": "ask",
      "confirmWrite": "ask"
    }
  }
}
```

### 快速原型

```json
{
  "tools": {
    "permissions": {
      "fileRead": "always",
      "fileWrite": "always",
      "bashExec": "ask",
      "warnLevel": "auto-allow",
      "confirmWrite": "auto"
    }
  }
}
```

## 调试权限问题

启用权限审计日志：

```bash
export XUANJI_LOG_LEVEL=debug
xuanji
```

查看 `~/.xuanji/logs/audit.log` 了解权限决策详情。
