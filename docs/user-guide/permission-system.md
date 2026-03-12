# 权限系统

> 最后更新：2026-03-10

## 设计理念

Xuanji 的权限系统基于**最小权限原则**和**用户确认机制**，在安全性和便利性之间找到平衡。

**核心原则**：
- 默认拒绝危险操作
- 允许用户覆盖决策
- 审计所有敏感操作
- 项目级和全局级配置分离

---

## 权限模式

### 1. Manual（手动确认）

每次操作都需要用户确认。

```json
{
  "tools": {
    "permissions": {
      "confirmWrite": "manual",
      "confirmRead": "manual",
      "confirmBash": "manual"
    }
  }
}
```

**适用场景**：生产环境、关键项目

---

### 2. Auto（自动允许）

在安全范围内自动允许操作。

```json
{
  "tools": {
    "permissions": {
      "confirmWrite": "auto",      // 项目内写入自动允许
      "confirmRead": "auto",       // 所有读取自动允许
      "confirmBash": "manual"      // Bash 仍需确认
    }
  }
}
```

**安全边界**：
- 写入：仅允许项目目录内
- 读取：仅允许项目目录内（外部需确认）
- Bash：危险命令仍需确认

**适用场景**：个人项目、开发环境

---

### 3. Disabled（完全禁用）

禁用特定工具或操作。

```json
{
  "tools": {
    "disabled": ["bash", "write"]
  }
}
```

**适用场景**：只读模式、安全审计

---

## 文件操作权限

### 读取权限（Read）

**默认行为**：
- 项目内文件：自动允许
- 项目外文件：需要确认
- 敏感文件：始终拒绝（如 `.env`, `id_rsa`）

**配置**：

```json
{
  "tools": {
    "permissions": {
      "confirmRead": "auto",
      "readBlacklist": [
        "**/.env",
        "**/.env.*",
        "**/*_rsa",
        "**/credentials.json"
      ]
    }
  }
}
```

---

### 写入权限（Write/Edit）

**默认行为**：
- 项目内文件：需要确认（首次）
- 项目外文件：需要确认（每次）
- 系统目录：始终拒绝

**配置**：

```json
{
  "tools": {
    "permissions": {
      "confirmWrite": "auto",
      "writeWhitelist": [
        "src/**",
        "docs/**",
        "README.md"
      ],
      "writeBlacklist": [
        "/etc/**",
        "/usr/**",
        "/System/**"
      ]
    }
  }
}
```

**策略**：
- `manual`：每次确认
- `auto`：项目内自动允许，外部确认
- `whitelist`：仅允许白名单路径
- `blacklist`：拒绝黑名单路径

---

## 命令执行权限（Bash）

### 危险命令黑名单

默认拒绝以下命令（不可覆盖）：

```json
{
  "tools": {
    "permissions": {
      "bashBlacklist": [
        "rm -rf /",
        "mkfs",
        "dd if=/dev/zero",
        ":(){ :|:& };:",
        "sudo rm",
        "chmod 777"
      ]
    }
  }
}
```

---

### 命令白名单模式

仅允许特定命令：

```json
{
  "tools": {
    "permissions": {
      "bashExecMode": "whitelist",
      "bashWhitelist": [
        "npm",
        "git",
        "ls",
        "cat",
        "grep",
        "node",
        "python"
      ]
    }
  }
}
```

**适用场景**：生产环境、CI/CD

---

### 命令黑名单模式（默认）

拒绝特定命令，允许其他：

```json
{
  "tools": {
    "permissions": {
      "bashExecMode": "blacklist",
      "bashBlacklist": [
        "rm -rf",
        "sudo",
        "curl | bash"
      ]
    }
  }
}
```

**适用场景**：开发环境

---

## Ignore 过滤器

### 配置文件

**项目级**：`.xuanji/ignore`
**全局级**：`~/.xuanji/ignore`

### 语法

与 `.gitignore` 相同：

```gitignore
# 忽略敏感文件
.env
.env.*
*.key
*.pem
credentials.json

# 忽略依赖
node_modules/
.venv/
vendor/

# 忽略构建产物
dist/
build/
*.pyc

# 忽略日志
*.log
logs/

# 忽略大文件
*.zip
*.tar.gz
*.mp4
```

### 行为

- **Read**：Ignore 文件会被静默跳过（不提示）
- **Glob**：搜索结果自动过滤 Ignore 文件
- **Grep**：搜索结果自动过滤 Ignore 文件

---

## 审计日志

所有敏感操作会记录到审计日志：

```bash
cat ~/.xuanji/logs/audit.log
```

**日志格式**：

```json
{"timestamp":"2026-03-10T14:30:00Z","tool":"write","action":"allow","path":"/path/to/file","user":"manual"}
{"timestamp":"2026-03-10T14:31:00Z","tool":"bash","action":"deny","command":"rm -rf /","reason":"blacklist"}
```

**字段说明**：
- `timestamp`：操作时间
- `tool`：工具名称
- `action`：`allow` / `deny`
- `path` / `command`：操作目标
- `user`：`auto` / `manual` / `policy`
- `reason`：拒绝原因（如有）

---

## 权限确认 UI

### 文件写入确认

```
⚠️  Agent 请求写入文件

路径: /Users/kevin/project/src/index.ts
工具: Edit
描述: 修复 bug

[Y] 允许  [N] 拒绝  [A] 总是允许  [D] 总是拒绝
```

**选项**：
- `Y`：允许此次操作
- `N`：拒绝此次操作
- `A`：总是允许（添加到白名单）
- `D`：总是拒绝（添加到黑名单）

---

### Bash 命令确认

```
⚠️  Agent 请求执行命令

命令: npm install axios
工作目录: /Users/kevin/project

[Y] 允许  [N] 拒绝  [A] 总是允许  [D] 总是拒绝
```

---

## 项目级配置

在项目中创建 `.xuanji/permissions.json`：

```json
{
  "confirmWrite": "auto",
  "confirmRead": "auto",
  "confirmBash": "manual",
  "writeWhitelist": [
    "src/**",
    "test/**",
    "docs/**"
  ],
  "bashWhitelist": [
    "npm",
    "git",
    "node"
  ]
}
```

**优先级**：
```
项目级配置 > 全局配置 > 默认配置
```

---

## 最佳实践

### 1. 分层策略

- **生产环境**：使用 `manual` 模式 + 白名单
- **开发环境**：使用 `auto` 模式 + 黑名单
- **学习环境**：使用 `auto` 模式 + 审计日志

---

### 2. 敏感文件保护

在 `.xuanji/ignore` 中添加所有敏感文件：

```gitignore
.env
.env.*
*.key
*.pem
credentials.json
secrets.yaml
```

---

### 3. 定期审计

查看审计日志，检查异常操作：

```bash
# 查看所有拒绝操作
cat ~/.xuanji/logs/audit.log | jq 'select(.action == "deny")'

# 查看所有 Bash 执行
cat ~/.xuanji/logs/audit.log | jq 'select(.tool == "bash")'
```

---

### 4. 最小权限原则

只启用需要的工具：

```json
{
  "tools": {
    "disabled": ["bash", "web_search"]
  }
}
```

---

## 相关文档

- [配置参考](./configuration.md#权限配置)
- [常见问题](./faq.md#权限问题)
- [故障排查](./troubleshooting.md#权限问题)
