# Xuanji 安全机制与错误处理分析报告

> **分析范围**: `PermissionController.ts`, `DecisionStore.ts`, `guards/`, `sandbox/`, `PersistentShell.ts`, `BashTool.ts`
>
> **分析者**: Security Analyzer
> **日期**: 2025-01

---

## 目录

1. [权限模型完整性评估](#1-权限模型完整性评估)
2. [安全风险分析](#2-安全风险分析)
3. [沙箱执行器有效性](#3-沙箱执行器有效性)
4. [错误处理评估](#4-错误处理评估)
5. [安全改进建议](#5-安全改进建议)

---

## 1. 权限模型完整性评估

### 1.1 架构概述

权限系统采用 **双层防护设计**：

```
第一层: LLM 主动审查 → safe/warn 级别操作信任模型判断
第二层: 硬编码安全兜底 → danger 级别操作强制用户确认
```

决策流程：
```
请求 → 守卫评估(FileGuard/CommandGuard) → 策略引擎 → 缓存检查 → 确认流程
```

### 1.2 风险分级模型

| 级别 | 含义 | 处理方式 | 示例 |
|------|------|----------|------|
| `safe` | 安全 | 自动放行（文件读取始终放行；写入取决于 `confirmWrite` 配置） | `cat file`、`ls` |
| `warn` | 潜在危险 | 根据 `warnLevel` 配置（默认 `ask`，需用户确认） | `sudo`、`rm -rf` |
| `danger` | 极度危险 | 强制用户确认（不可绕过） | `rm -rf /`、`mkfs` |

### 1.3 守卫分析

**FileGuard**（文件路径守卫）：
- ✅ 识别系统关键路径（`/etc/`, `/bin/`, `/usr/` 等）→ danger
- ✅ 识别关键系统文件（`/etc/passwd`, `~/.ssh/authorized_keys` 等）→ danger
- ✅ 识别敏感用户目录（`~/.ssh/`, `~/.aws/` 等）→ danger
- ✅ 识别敏感文件模式（`.env`, `*.pem`, `*.key` 等）→ 写 danger / 读 warn
- ✅ 识别混淆敏感配置（`~/.npmrc`, `~/.gitconfig` 等）→ warn
- ✅ 支持 `.xuanji/ignore` 忽略列表 → danger
- ✅ 支持用户自定义黑白名单
- ⚠️ 项目外文件写入标记为 `warn` 而非 `danger`

**CommandGuard**（命令守卫）：
- ✅ 极度危险命令模式（rm -rf /, fork bomb, dd of=/dev/... 等）→ danger
- ✅ 潜在危险命令模式（sudo, chmod -R 777, curl | sh, git push --force 等）→ warn
- ✅ 管道/链式命令拆分检查，取最高风险级别
- ✅ 引号、反引号、`$()` 命令替换上下文感知拆分
- ⚠️ 黑名单检测包含子串匹配（`fullCommand.includes(pattern)`），可能产生误报

### 1.4 决策缓存

| 缓存层级 | 生命周期 | 存储方式 |
|----------|----------|----------|
| 会话级缓存 (`decisionCache`) | 会话期间 | 内存 `Map`（上限 500） |
| 持久化缓存 (`DecisionStore`) | 跨会话 | SQLite（支持 TTL 过期） |
| 拒绝操作记录 | 持久化 | SQLite + 内存 Map |
| 意图上下文拒绝 | 单次用户意图 | 内存 `Set` |

### 1.5 评价

**优势**：
- 模型完整，涵盖了文件操作和命令执行两大类风险
- 缓存机制完善（会话级 + 持久化 + TTL）
- 用户意图跟踪能有效阻止同一意图下的同类绕过尝试
- "计划审查"机制允许 LLM 主动提交计划给用户审查

**不足**：
- 只覆盖 `fileRead` / `fileWrite` / `bashExec` 三类操作，未覆盖网络、进程等操作
- `safe` 级别完全信任 LLM，如果 LLM 被 prompt injection 诱导做看似 `safe` 的危险操作（如多步组合攻击），无法拦截
- 没有操作频率限制（rate limiting），可能被用于暴力尝试

---

## 2. 安全风险分析

### 2.1 高风险：命令绕过风险

**位置**: `CommandGuard.ts` 正则匹配

**风险描述**: 命令风险检测依赖正则匹配，攻击者可通过以下方式绕过：

| 绕过方式 | 示例 | 当前保护 |
|----------|------|----------|
| 编码绕过 | `\x72m` (十六进制) | ❌ 无检测 |
| 变量替换 | `$CMD -rf /` (CMD=rm) | ⚠️ `DANGEROUS_PATTERNS` 部分覆盖 |
| Base64 解码执行 | `echo 'cm0gLXJmIC8=' \| base64 -d \| bash` | ❌ 无检测 |
| 链接文件 | `ln -s /usr/bin/rm ./myrm; ./myrm -rf /` | ❌ 无检测 |
| 环境变量路径 | `PATH=/tmp:$PATH; myrm -rf /` | ❌ 无检测 |
| 使用其他删除工具 | `find / -delete`、`shred`、`unlink` | ❌ 无检测 |

**严重性**: 🔴 高

### 2.2 高风险：沙箱默认禁用

**位置**: `BashTool.ts` `initSandbox()` 和 `execute()`

```typescript
// BashTool.ts 第 118-136 行
// 前台同步执行：优先使用沙箱，降级到持久化 Shell
if (this.sandboxExecutor) {
    try {
        // ...沙箱执行...
    } catch (sandboxErr) {
        // 沙箱执行失败，降级到直接执行 ← 安全降级！
    }
}
// 降级：使用持久化 Shell（无沙箱）
const shell = getSharedShell();
const result = await shell.execute(command, timeout, cwd);
```

**风险**: 
- 沙箱**默认不启用**（需要配置 `tools.bash.sandbox.enabled: true`）
- 沙箱执行失败**自动降级到无沙箱执行**，无警告通知用户
- 降级后直接使用 `PersistentShell`（裸 bash 子进程），没有任何隔离

**严重性**: 🔴 高

### 2.3 中风险：路径遍历与符号链接绕过

**位置**: `FileGuard.ts` `isOutsideProject()`

```typescript
private isOutsideProject(normalizedPath: string): boolean {
    const projectRoot = process.cwd();
    return !normalizedPath.startsWith(projectRoot + '/') && normalizedPath !== projectRoot;
}
```

**风险**:
- 使用 `startsWith` 而非解析真实路径
- 符号链接可绕过检查：如果 `/project/link` → `/etc/passwd`，`startsWith` 无法检测
- 未调用 `fs.realpathSync()` 解析真实路径

**严重性**: 🟡 中

### 2.4 中风险：环境变量静态过滤列表

**位置**: `PersistentShell.ts` 和 `BashTool.ts`

```typescript
const SENSITIVE_ENV_VARS = [
  'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN', 'GH_TOKEN',
  // ... 静态列表
];
```

**风险**:
- 静态枚举列表必然不完备（如 `GITLAB_TOKEN` 有但 `GITLAB_ACCESS_TOKEN` 可能没有）
- `printenv` 被标记为 warn，但 `env`、`declare -p`、`set` 等都能泄漏环境变量
- 用户自定义的密钥（如 `MY_SECRET=xxx`）不会被过滤

**严重性**: 🟡 中

### 2.5 中风险：Seatbelt Profile 注入

**位置**: `SeatbeltExecutor.ts` `generateProfile()`

```typescript
private escapeSbplString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
```

**虽然** `escapeSbplString` 实现了基本的转义，但 Sandbox Profile 通过命令行参数 `-p` 传递，如果配置的 `allowedPaths` 包含恶意值（如包含 SBPL 特殊字符的路径名），理论上存在 profile 注入风险。

此外，Seatbelt Profile 使用**命令行参数传递**完整的 SBPL 策略，而不是写入临时文件。较长的 profile 可能被 shell 缓冲区限制截断。

**严重性**: 🟡 中

### 2.6 低风险：持久化决策 SQLite 注入

**位置**: `DecisionStore.ts`

使用参数化查询（`?` 占位符），基本安全。但 `queryAuditLogs()` 方法虽用的是参数化查询，但动态拼接 SQL 片段：

```typescript
let sql = 'SELECT * FROM permission_audit WHERE 1=1';
if (options.toolName) {
    sql += ' AND tool_name = ?';  // 参数化，安全
    params.push(options.toolName);
}
```

参数是参数化的，✅ 基本安全。

**严重性**: 🟢 低

---

## 3. 沙箱执行器有效性

### 3.1 Bubblewrap (Linux)

| 特性 | 状态 | 说明 |
|------|------|------|
| 文件系统隔离 | ✅ | `--ro-bind` 只读绑定系统目录，`--bind` 可写项目目录 |
| 临时文件隔离 | ✅ | `--tmpfs /tmp` 独立 tmpfs，不共享宿主机 /tmp |
| PID 命名空间 | ✅ | `--unshare-pid` + `--die-with-parent` |
| 网络隔离 | ✅ | 可配置 `--unshare-net` |
| 进程隔离 | ✅ | 独立 namespace |
| /proc 挂载 | ✅ | `--proc /proc` |
| /dev 挂载 | ✅ | `--dev /dev` |
| stdout/stderr 限制 | ✅ | 5MB 上限防止 OOM |

**评价**: Bubblewrap 实现相对完善，正确使用了 namespace 隔离。

**问题**:
- 允许 `allowedPaths` 外的路径通过 `--bind cwd, cwd` 后备绑定可写，可能与用户预期不符
- 未绑定 `/opt`、`/var` 等目录，某些命令（如 `apt`）可能无法运行
- 未隔离 hostname、UTS namespace

### 3.2 Seatbelt (macOS)

| 特性 | 状态 | 说明 |
|------|------|------|
| 写入限制 | ✅ | 只允许写入白名单路径 + `/tmp/` |
| 读取限制 | ✅ | 默认 `(deny default)` + `(allow file-read*)` |
| 进程执行 | ⚠️ | `(allow process-exec)` 允许所有执行 |
| 网络隔离 | ✅ | 可配置 `(deny network*)` |
| 系统路径保护 | ✅ | 可配置禁止写入系统目录 |
| Profile 注入保护 | ⚠️ | 有基本转义但不够完善 |

**评价**: macOS Seatbelt 实现基本可用，但 SBPL profile 通过命令行传递是一个安全隐患。

### 3.3 综合评价

| 标准 | 评价 |
|------|------|
| 沙箱可用性检测 | ✅ 自动检测 `which bwrap` / `which sandbox-exec` |
| 跨平台支持 | ✅ Linux(bwrap) + macOS(seatbelt) |
| 输出限制 | ✅ 5MB 缓冲区上限 |
| 超时保护 | ⚠️ 依赖于 `spawn` 的 `timeout` 参数（`child_process` 的 `timeout` 在 `close` 事件上触发 SIGTERM） |
| **默认启用** | ❌ **默认禁用，需要用户显式配置** |
| **降级策略** | ❌ **沙箱失败后静默降级到无沙箱** |

---

## 4. 错误处理评估

### 4.1 确认超时

| 场景 | 超时时间 | 默认行为 |
|------|----------|----------|
| 用户确认 | 60s (`CONFIRMATION_TIMEOUT_MS`) | 超时自动**拒绝** |
| 计划审查 | 300s (`PLAN_REVIEW_TIMEOUT_MS`) | 超时自动**拒绝** |

✅ 超时自动拒绝是安全的默认行为。

### 4.2 DecisionStore 初始化失败

```typescript
// PermissionController.ts 第 125-128 行
this.initDecisionStore().catch((err) => {
    this.log.warn('Failed to init decision store:', err);
});
// 内部 catch 处理（第 160-163 行）
} catch (err) {
    this.log.warn('Decision store init failed:', err);
    this.decisionStore = null;
}
```

✅ 初始化失败优雅降级（无持久化功能，会话级缓存仍然工作）。

### 4.3 沙箱执行失败

```typescript
// BashTool.ts 第 118-136 行
if (this.sandboxExecutor) {
    try {
        const result = await this.sandboxExecutor.execute(command, cwd, timeout);
        // ...
    } catch (sandboxErr) {
        log.warn('Sandbox execution failed, falling back to direct execution.');
        // 降级到直接执行 ← 安全风险！
    }
}
```

❌ **安全降级问题**：沙箱失败后自动降级到无沙箱的 `PersistentShell`，且不通知用户。攻击者可以通过使沙箱进程崩溃来绕过沙箱。

### 4.4 PersistentShell 错误处理

| 场景 | 处理方式 |
|------|----------|
| 命令超时 | 发送 SIGINT，标记 `_needsReset=true`，下一次命令执行前重建 shell |
| 进程意外退出 | 捕获 `exit` 事件，`_ready=false`，下次执行自动调用 `ensureRunning()` 重建 |
| 并发执行 | 内置队列保护，同一时刻只有一个命令执行 |
| 关闭时排队命令 | 拒绝所有排队中的 Promise，防止内存泄漏 |
| stdout 残留 | 超时后标记 `_needsReset`，重建 shell 防止污染 |

✅ PersistentShell 的错误处理较为完善。

### 4.5 审计错误处理

- ✅ 审计日志持久化使用 `catch` 静默处理（不中断主流程）
- ✅ 环形缓冲区 O(1) 写入，内存安全
- ❌ `extractRiskLevel()` 实现过于简单，依赖中文字符串匹配推断风险级别

### 4.6 综合评价

| 维度 | 评价 |
|------|------|
| 超时保护 | ✅ 完善（确认、计划审查、命令执行） |
| 降级策略 | ❌ 沙箱降级不安全（无通知） |
| 队列并发 | ✅ PersistentShell、确认队列 |
| 资源泄漏 | ✅ close() 清理所有排队 + 子进程 |
| 审计健壮性 | ⚠️ 内存审计安全，风险级别提取简化 |

---

## 5. 安全改进建议

### 5.1 🔴 高优先级

#### S1: 沙箱默认启用 + 降级拒绝

**问题**: 沙箱默认禁用，且失败后静默降级

**建议**:
```typescript
// BashTool.ts
async execute(input: Record<string, unknown>): Promise<ToolResult> {
    // 沙箱不可用时，默认拒绝执行（非降级）
    if (!this.sandboxExecutor) {
        // 在第一次执行前尝试初始化
        if (!this.sandboxInitAttempted) {
            await this.initSandbox();
        }
        if (!this.sandboxExecutor) {
            return this.error('沙箱不可用，命令执行已被安全策略阻止。请配置沙箱或联系管理员。');
        }
    }
    // ... 执行命令 ...
}
```

同时修改配置默认值：

```typescript
// 默认配置建议
const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
    enabled: true,  // 改为 true
    mode: 'auto',
    allowedPaths: [process.cwd()],
    denyNetwork: true,
    denySystemPaths: true,
};
```

#### S2: 命令混淆/编码检测增强

**问题**: 正则匹配可被编码绕过

**建议**: 在 `CommandGuard` 中增加命令预处理器：

```typescript
class CommandGuard {
    private preprocessCommand(command: string): { original: string; decoded: string[] } {
        const variants: string[] = [command];
        
        // 1. 展开 \x 十六进制编码
        variants.push(command.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => 
            String.fromCharCode(parseInt(hex, 16))
        ));
        
        // 2. 检测 base64 解码执行模式
        if (/base64\s*-d/.test(command)) {
            const b64Matches = command.match(/['"]([A-Za-z0-9+/=]+)['"]\s*\|/g);
            // 尝试解码并检查
        }
        
        // 3. 检测变量间接引用
        if (/\$\{?\w+\}?/.test(command)) {
            // 标记为可疑
        }
        
        return { original: command, decoded: variants };
    }
}
```

#### S3: 真实路径解析

**问题**: 符号链接可绕过 `isOutsideProject`

**建议**:
```typescript
private isOutsideProject(normalizedPath: string): boolean {
    const projectRoot = process.cwd();
    try {
        // 解析符号链接获取真实路径
        const realPath = fs.realpathSync(normalizedPath);
        const realRoot = fs.realpathSync(projectRoot);
        return !realPath.startsWith(realRoot + path.sep) && realPath !== realRoot;
    } catch {
        // 如果无法解析（文件不存在），使用原始路径
        return !normalizedPath.startsWith(projectRoot + path.sep) && normalizedPath !== projectRoot;
    }
}
```

### 5.2 🟡 中优先级

#### S4: 环境变量保护增强

**建议**：使用正则匹配替代静态列表

```typescript
const SENSITIVE_VAR_PATTERNS = [
    /(?:SECRET|PASSWORD|TOKEN|KEY|CREDENTIAL|CRED|AUTH)/i,
    /(?:API_KEY|ACCESS_KEY|SESSION_TOKEN|PRIVATE_KEY)/i,
];

function isSensitiveEnvVar(name: string): boolean {
    return SENSITIVE_VAR_PATTERNS.some(p => p.test(name));
}
```

#### S5: Seatbelt Profile 写入临时文件

**建议**：将 SBPL 策略写入临时文件而非命令行参数传递：

```typescript
private async generateProfileFile(profile: string): Promise<string> {
    const tmpFile = join(os.tmpdir(), `xuanji-sandbox-${randomBytes(8).toString('hex')}.sbpl`);
    await fs.promises.writeFile(tmpFile, profile, { mode: 0o600 });
    return tmpFile;
}

// 使用: sandbox-exec -f /path/to/profile.sbpl bash -c command
```

#### S6: 频率限制和暴力尝试防护

**建议**：添加操作频率计数，同一工具短时间内失败次数过多时自动拒绝：

```typescript
// PermissionController 增加
private rateLimitMap: Map<string, { count: number; resetAt: number }> = new Map();

private checkRateLimit(key: string): boolean {
    const now = Date.now();
    const entry = this.rateLimitMap.get(key);
    if (!entry || entry.resetAt < now) {
        this.rateLimitMap.set(key, { count: 1, resetAt: now + 60_000 });
        return true;
    }
    if (entry.count > 5) { // 每分钟最多 5 次
        return false;
    }
    entry.count++;
    return true;
}
```

### 5.3 🟢 低优先级

#### S7: 审计风险级别提取优化

```typescript
private extractRiskLevel(event: PermissionEvent): string | undefined {
    if (event.source?.includes('extreme') || event.checkedBy?.includes('danger')) {
        return 'danger';
    }
    if (event.checkedBy === 'user-confirmation') {
        return 'danger'; // 需要用户确认的视为危险
    }
    // 从 guardResult 获取实际风险级别
    // ...
}
```

#### S8: 添加更多操作类别

考虑扩展 `GuardCheckResult.category` 以支持：
- `networkAccess` — 网络访问操作
- `processMgmt` — 进程管理操作
- `packageMgmt` — 包管理操作

#### S9: 持久化决策加密存储

**建议**: SQLite 数据库文件包含用户对所有操作的 Always/Never 决策，建议对敏感字段加密：

```typescript
// 使用环境变量派生密钥加密敏感字段
import { createCipheriv, createHash } from 'node:crypto';

private encrypt(text: string): string {
    const key = createHash('sha256').update(process.env.XUANJI_CONFIG_KEY || '').digest();
    // ... AES-256-GCM 加密
}
```

---

## 总结

| 维度 | 评分 | 关键问题 |
|------|------|----------|
| 权限模型完整性 | ⚠️ **7/10** | 覆盖文件/命令两大类，但缺少网络/进程类别；safe 级完全信任 LLM |
| 安全防护有效性 | ⚠️ **6/10** | 正则匹配可绕过；沙箱默认禁用；路径符号链接可绕过 |
| 沙箱执行器 | ⚠️ **6/10** | bwrap 实现完善；但默认禁用且失败后静默降级 |
| 错误处理 | ✅ **8/10** | 超时自动拒绝、队列保护、资源清理完善；沙箱降级是唯一缺陷 |
| **总体安全评级** | ⚠️ **6.5/10** | 基础扎实，但存在多个高风险项需要修复 |

### 最关键的三项改进

1. **🔴 沙箱默认启用 + 降级拒绝** — 当前用户无感知地绕过沙箱
2. **🔴 命令编码/混淆检测** — 防止 prompt injection 导致命令绕过
3. **🔴 真实路径解析** — 防止符号链接路径遍历

---

*报告完毕*
