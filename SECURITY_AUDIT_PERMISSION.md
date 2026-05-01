# 权限控制安全评估报告

**评估范围**: `src/permission/` 权限控制系统  
**评估日期**: 2025-01-21  
**项目**: Shibit Xuanji (璇玑) - AI 编程助手  
**评估人**: 安全审查专家  

---

## 一、架构总览

### 1.1 双层防护设计

```
┌─────────────────────────────────────────┐
│  第一层: LLM 主动审查 (plan_review)       │
│  safe/warn → 信任模型判断，自动放行        │
├─────────────────────────────────────────┤
│  第二层: 硬编码安全兜底 (强制确认)         │
│  danger → 不可绕过，防止 prompt injection  │
└─────────────────────────────────────────┘
```

### 1.2 决策流程

```
工具调用 → evaluateGuard() → 风险分级 → 缓存检查 → UI确认/自动放行
              │                  │
    ┌─────────┴────────┐  ┌─────┴──────┐
    │ FileGuard        │  │ safe (自动) │
    │ CommandGuard     │  │ warn (可选) │
    └──────────────────┘  │ danger(强制)│
                          └────────────┘
```

### 1.3 模块清单

| 模块 | 文件 | 职责 |
|------|------|------|
| 守卫层 | `guards/FileGuard.ts` | 文件路径风险分析 |
| 守卫层 | `guards/CommandGuard.ts` | Bash 命令风险分析 |
| 策略层 | `policies/PolicyEngine.ts` | 权限配置管理 |
| 策略层 | `policies/PathMatcher.ts` | Glob 路径匹配 |
| 策略层 | `policies/IgnoreFilter.ts` | `.xuanji/ignore` 规则 |
| 缓存层 | `cache/PermissionCache.ts` | 运行时决策缓存 |
| 存储层 | `DecisionStore.ts` | SQLite 持久化存储 |
| 审计层 | `audit/PermissionAudit.ts` | 操作审计日志 |
| 确认层 | `confirmation/ConfirmationService.ts` | 串行化确认服务 |
| 控制器 | `PermissionController.ts` | 决策核心编排 |
| UI 层 | `ui/PermissionPrompt.tsx` | Ink 确认对话框 |
| UI 层 | `ui/PlanReview.tsx` | 计划审查对话框 |

---

## 二、安全机制逐项分析

### 2.1 路径遍历防护

**实现**: `FileGuard.normalizePath()` + `isOutsideProject()`

```typescript
// FileGuard.ts:309-314
private normalizePath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return path.resolve(filePath);
}

// FileGuard.ts:395-398
private isOutsideProject(normalizedPath: string): boolean {
  const projectRoot = process.cwd();
  return !normalizedPath.startsWith(projectRoot + '/') && normalizedPath !== projectRoot;
}
```

**✅ 优点**:
- 使用 `path.resolve()` 规范化路径，可解析 `..`、`.` 等相对路径
- `~` 展开为用户主目录
- 基于规范化后的路径进行所有后续检查

**⚠️ 风险**:

| 风险 | 严重级别 | 说明 |
|------|----------|------|
| 符号链接绕过 | **中** | `isOutsideProject()` 使用 `startsWith(process.cwd())` 进行字符串前缀匹配，若项目内存在指向项目外的符号链接，可绕过检查。建议使用 `fs.realpathSync()` 解析真实路径后再比较。 |
| 无显式 `../` 检测 | **低** | `path.resolve()` 隐式处理了 `../`，但如果在 `resolve` 之前使用了未规范化的路径进行其他检查，可能产生 TOCTOU 问题。当前实现在 `check()` 中规范顺序正确，风险可控。 |
| CWD 依赖 | **低** | `process.cwd()` 可能在运行时变化（通过 `process.chdir()`），但实际场景中极少发生。 |

**安全评级**: 🟡 **良好**（存在符号链接绕过风险，建议增强）

### 2.2 命令注入防护

**实现**: `CommandGuard.check()` + 正则模式匹配

```typescript
// CommandGuard.ts:22-31 - 极度危险命令模式
const EXTREME_DANGER_PATTERNS = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+...)\/(\s|$|\*)/, ... },
  { pattern: /:\(\)\{.*\|.*&\s*\}\s*;/, ... },  // Fork bomb
  { pattern: /\bdd\s+.*\bof\s*=\s*\/dev\/[a-z]/, ... },
  ...
];
```

**✅ 优点**:
- 30+ 种危险命令模式覆盖（rm -rf /、fork bomb、dd、mkfs、kubectl delete、terraform destroy、DROP TABLE 等）
- 管道分隔符智能拆分（`|`、`&&`、`||`、`;`），正确跳过引号内分隔符
- 处理 `$()` 命令替换和反引号内命令
- 环境变量泄露检测（`printenv`、`env > file`、敏感变量 export）
- 黑名单/白名单双模式

**⚠️ 风险**:

| 风险 | 严重级别 | 说明 |
|------|----------|------|
| Bash 变量展开绕过 | **高** | `$'\x72\x6d'` 在 bash 中展开为 `rm`，可绕过命令名检测。`${IFS}`、`$@` 等特殊变量也可干扰模式匹配。 |
| 编码绕过 | **高** | Base64 编码命令 `echo cm0gLXJmIC8K | base64 -d | bash` 可完全绕过所有模式检测。 |
| 别名绕过 | **中** | 若用户 shell 定义了别名（如 `alias safe-rm=rm`），别名不会被检测。 |
| ReDoS 风险 | **中** | `matchesDeniedList()` 方法中存在可能导致正则回溯爆炸的代码（见 2.2.1）。 |
| 命令名提取局限 | **低** | `extractCommandName()` 去除 `sudo` 和环境变量，但无法处理 `nice`、`nohup`、`time` 等前缀命令。 |
| 管道内命令覆盖不全 | **低** | `splitSubCommands()` 仅提取 `$()` 和反引号内的内容，未处理 `<()` 进程替换。 |

**🔴 重点风险 — Base64 绕过示例**:
```bash
# 以下命令会完全绕过 CommandGuard 的 pattern 检测：
echo "cm0gLXJmIC8K" | base64 -d | bash
```

**建议**: 在沙箱环境中执行 Bash 命令（如 Docker 容器），而非依赖纯模式匹配。

**安全评级**: 🟠 **需改进**（正则匹配在对抗性场景下不可靠，建议增加沙箱隔离）

### 2.2.1 ReDoS 风险分析

```typescript
// CommandGuard.ts:291-308
private matchesDeniedList(
  fullCommand: string,
  commandName: string,
  deniedCommands: string[],
): boolean {
  return deniedCommands.some((pattern) => {
    if (commandName === pattern) return true;
    if (pattern.includes('*')) {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                             .replace(/\\\*/g, '.*');
      const regex = new RegExp('^' + escaped + '$');
      return regex.test(commandName) || regex.test(fullCommand);
    }
    return fullCommand.includes(pattern);  // ← 子串匹配，非正则
  });
}
```

**分析**: 
- 子串匹配使用 `String.includes()`（`O(n)` 线性时间），无 ReDoS 风险
- Glob→正则转换路径：模式长度通常 < 50 字符，且用户配置的黑名单条目有限（一般 < 100 条）
- 即使构造恶意模式 `*******************************`，转换后的正则为 `^[^/]*[^/]*...[^/]*$`，其中 `*` 被转为 `[^/]*`（不含 `/`），不含嵌套量词，不会造成灾难性回溯
- **结论**: 实际 ReDoS 风险为 **低**，因为模式来源是用户配置文件而非不可信输入

### 2.3 敏感文件保护

**实现**: `FileGuard` 硬编码敏感路径列表

```typescript
// FileGuard.ts:23-36 系统关键路径
const SYSTEM_PATHS = [
  '/etc/', '/bin/', '/sbin/', '/usr/bin/', '/usr/sbin/',
  '/usr/lib/', '/System/', '/Library/', '/boot/', '/proc/', '/sys/', '/dev/',
];

// FileGuard.ts:41-50 关键系统文件（写操作 danger）
const CRITICAL_WRITE_PATHS = [
  '/etc/passwd', '/etc/shadow', '/etc/sudoers', '/etc/hosts',
  '/etc/hostname', '/etc/resolv.conf', '~/.ssh/authorized_keys', '~/.ssh/config',
];

// FileGuard.ts:78-91 敏感文件模式（glob 匹配）
const SENSITIVE_FILE_PATTERNS = [
  '**/.env', '**/.env.*', '**/id_rsa', '**/id_ed25519',
  '**/*.pem', '**/*.key', '**/credentials.json', '**/secrets.yaml', ...
];
```

**✅ 优点**:
- 系统路径、关键文件、敏感目录三层覆盖
- 写操作强制 `danger` 级别，不可绕过
- 敏感文件读取标记为 `warn`，写入标记为 `danger`
- 扩展敏感文件列表覆盖 `.env.local`、`.env.production`、证书/密钥库等

**⚠️ 风险**:

| 风险 | 严重级别 | 说明 |
|------|----------|------|
| 列表不完整 | **中** | 敏感文件列表是硬编码的，未覆盖所有可能的凭证文件（如 `*.tfvars`、`*.auto.tfvars`、`.terraform/`、`Chart.yaml` 中的 `values` 等）。 |
| Windows 路径 | **低** | 系统路径硬编码为 Unix 风格（`/etc/`、`/bin/`），Windows 路径（`C:\Windows\System32\`）未被覆盖。项目目前可能仅支持 Unix，但随着跨平台扩展需要关注。 |
| 自定义 `.env` 变体 | **低** | `.env` 模式通过 glob `**/.env*` 已做通配，覆盖较好。 |

**安全评级**: 🟢 **良好**（覆盖面广，但建议允许用户自定义敏感文件模式）

### 2.4 API Key / 敏感信息泄露

**✅ 硬编码检查结果**: **未发现硬编码的 API Key 或密钥**

全局搜索模式：
- `(api_key|apikey|API_KEY|secret|password|token)\s*[=:]\s*['"][^'"]{8,}` — 无匹配
- `(sk-[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z\-_]{35}|ghp_[a-zA-Z0-9]{36})` — 无匹配

**✅ 环境变量清理**: `BashTool.ts` 和 `PersistentShell.ts` 在生成子进程前清理敏感环境变量：

```typescript
// BashTool.ts:24-32
const SENSITIVE_ENV_VARS = [
  'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN', 'GH_TOKEN', 'GITLAB_TOKEN',
  'NPM_TOKEN', 'PYPI_TOKEN',
  'DATABASE_URL', 'DATABASE_PASSWORD',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'XUANJI_API_KEY',
  'JASYPT_ENCRYPTOR_PASSWORD',
];
```

**✅ API Key 处理**:
- API Key 通过环境变量 `XUANJI_API_KEY` 或配置文件 `.xuanji/config.json` 传入
- 日志中 API Key 做脱敏处理（`SessionDiagnostics.ts` 中的 `maskApiKey()`）
- 提案的配置模板使用注释 `// apiKey` 而非硬编码值

**⚠️ 风险**:

| 风险 | 严重级别 | 说明 |
|------|----------|------|
| 敏感变量列表不完整 | **中** | `SENSITIVE_ENV_VARS` 仅覆盖 12 个变量，未包含 `DOCKER_PASSWORD`、`KUBECONFIG`、`AZURE_*`、`GOOGLE_APPLICATION_CREDENTIALS`、各种 `*_SECRET`、`*_TOKEN` 等。 |
| 配置文件明文存储 | **低** | `config.json` 中的 `apiKey` 以明文存储，但这是工具链的普遍做法。建议标记为 `secret` 或支持加密存储。 |

**安全评级**: 🟢 **良好**（无硬编码密钥，但敏感环境变量列表可扩展）

### 2.5 权限决策安全

**实现**: `PermissionController.check()` — 多层决策链

**✅ 优点**:
- **默认拒绝原则**: 无确认处理器时，默认拒绝（而非默认允许）
- **分级控制**: `safe`/`warn`/`danger` 三级风险，`danger` 不可绕过
- **拒绝传播**: 用户拒绝的操作会阻止同一意图下的同类操作
- **双缓存**: 会话级内存缓存 + SQLite 持久化缓存
- **串行确认**: 确认队列保证同一时刻只有一个对话框，防止 UI 堆叠攻击
- **审计日志**: 每个决策都记录到审计日志

**决策树**:
```
1. 黑名单检查 (deniedOperations)          → 拒绝
2. 意图级拒绝检查 (deniedIntentOperations)  → 拒绝
3. 守卫评估 (FileGuard/CommandGuard)
4. 策略检查 (always/never/ask)
5. 风险分流:
   - safe + fileRead   → 自动放行
   - safe + fileWrite  → 根据 confirmWrite 配置
   - safe + bashExec   → 自动放行
   - warn              → 根据 warnLevel 配置
   - danger            → 强制确认（不可绕过）
6. 缓存检查（会话 > 持久化）
7. UI 确认
```

**⚠️ 风险**:

| 风险 | 严重级别 | 说明 |
|------|----------|------|
| 工具名硬编码 | **中** | `evaluateGuard()` 使用硬编码的工具名列表 `['read_file', 'write_file', 'edit_file', 'glob', 'grep', 'notebook_edit']`。新增文件操作工具时如果忘记添加，将完全绕过守卫检查（返回 `null` → 自动放行）。建议使用语义标记或类别属性。 |
| no-guard 放行 | **中** | 未识别工具直接放行（`checkedBy: 'no-guard'`），如果攻击者能注册自定义工具，则可绕过所有检查。建议对未知工具采用 `warn` 级别默认策略。 |
| 缓存无 TTL | **低** | 会话级缓存（`decisionCache`）无过期时间，仅在达到容量上限（500）时清空重建。持久化缓存支持 TTL。 |

**安全评级**: 🟡 **良好**（决策链完整，但工具名硬编码和 no-guard 放行是隐患）

### 2.6 Ignore 过滤器安全

**实现**: `IgnoreFilter` 基于 `ignore` 库（`.gitignore` 格式）

**✅ 优点**:
- 使用成熟的 `ignore` npm 包
- **安全优先**: 路径解析失败时返回 `true`（拒绝访问），而非放行
- 项目外路径不检查（避免误判系统路径）

**⚠️ 风险**:

| 风险 | 严重级别 | 说明 |
|------|----------|------|
| 未加载时放行 | **中** | `isLoaded()` 为 `false` 时返回 `false`（不阻止）。若 `.xuanji/ignore` 文件损坏或加载失败，敏感文件规则不生效。当前实现静默吞掉 `ENOENT` 以外的错误，可能导致规则部分加载不生效。 |
| 无默认规则 | **低** | 不存在内置的默认 ignore 规则，完全依赖用户配置 `.xuanji/ignore`。 |

**安全评级**: 🟡 **良好**（安全优先的错误处理正确，但建议添加默认规则）

---

## 三、严重性分级总结

| 风险 | 严重级别 | 类别 | 建议 |
|------|----------|------|------|
| Bash 编码绕过（Base64 / 变量展开） | 🔴 **高** | 命令注入 | 增加沙箱隔离层 |
| 工具名硬编码导致新工具绕过守卫 | 🟠 **中** | 权限绕过 | 使用语义类别标记 |
| no-guard 放行未知工具 | 🟠 **中** | 权限绕过 | 对未知工具默认 warn |
| 符号链接绕过项目边界检查 | 🟠 **中** | 路径遍历 | 使用 `fs.realpathSync()` |
| 敏感环境变量列表不完整 | 🟠 **中** | 信息泄露 | 扩展 `SENSITIVE_ENV_VARS` |
| Ignore 加载失败静默放行 | 🟠 **中** | 信息泄露 | 加载失败时添加内置默认规则 |
| Windows 路径未覆盖 | 🟡 **低** | 路径遍历 | 添加 Windows 系统路径 |
| 会话缓存无 TTL | 🟡 **低** | 配置风险 | 添加默认 TTL |
| 配置文件明文 API Key | 🟡 **低** | 信息泄露 | 支持密钥环集成 |

---

## 四、硬编码敏感信息检查结果

| 检查项 | 结果 |
|--------|------|
| API Key 硬编码 | ✅ 未发现 |
| 密码/Token 硬编码 | ✅ 未发现 |
| 私钥/PEM 硬编码 | ✅ 未发现 |
| 数据库连接字符串 | ✅ 未发现 |
| 内网地址/IP 泄露 | ✅ 未发现 |
| 安全 token/salt 硬编码 | ✅ 未发现 |

> **结论**: 项目在代码层面没有硬编码敏感信息。所有凭据通过环境变量或配置文件传入，API Key 在日志中脱敏处理。

---

## 五、改进建议（按优先级排序）

### 🔴 P0 - 高优先级

1. **增加沙箱执行层**  
   纯正则匹配无法防御对抗性命令注入。建议：
   - 对 Bash 命令执行引入 Docker/ Firecracker 沙箱（可选，配置项）
   - 至少增加 `base64 -d | bash` / `xxd -r -p | bash` 等解码-执行模式的检测

2. **修复工具名硬编码**  
   `evaluateGuard()` 中的工具名列表应改为基于类别属性：
   ```typescript
   // 建议: 在 BaseTool 中增加 category 属性
   abstract class BaseTool {
     abstract category: 'file' | 'command' | 'plan' | 'other';
   }
   ```

### 🟠 P1 - 中优先级

3. **符号链接解析**  
   `isOutsideProject()` 使用 `fs.realpathSync()` 解析真实路径

4. **扩展敏感环境变量**  
   增加 `DOCKER_*`、`AZURE_*`、`GCP_*`、`KUBECONFIG`、`*_SECRET`、`*_PASSWORD` 等模式匹配

5. **Ignore 默认规则**  
   添加内置默认 ignore 规则（如 `.git/`、`.xuanji/` 自身），防止用户未配置时敏感路径被访问

6. **未知工具默认策略**  
   对未识别工具使用 `warn` 级别（可配置），而非直接放行

### 🟡 P2 - 低优先级

7. **Windows 路径支持**  
   添加 Windows 系统路径（`C:\Windows\System32\`、`C:\Program Files\` 等）

8. **会话缓存 TTL**  
   为 `decisionCache` 添加默认 TTL（如 24 小时）

9. **API Key 加密存储**  
   支持 macOS Keychain / Linux Secret Service 存储 API Key

---

## 六、总体安全评级

| 维度 | 评级 | 说明 |
|------|------|------|
| 路径遍历防护 | 🟡 良好 | 基本覆盖，符号链接绕过需修复 |
| 命令注入防护 | 🟠 需改进 | 正则匹配不可靠，需沙箱 |
| 敏感文件保护 | 🟢 良好 | 覆盖全面，可自定义扩展 |
| API Key 管理 | 🟢 良好 | 无硬编码，环境变量清理 |
| 权限决策逻辑 | 🟡 良好 | 多层决策，工具名硬编码是隐患 |
| Ignore 过滤 | 🟡 良好 | 安全优先，缺少默认规则 |
| 审计日志 | 🟢 良好 | 完整的审计追踪 |
| 代码质量 | 🟢 优秀 | TypeScript 严格模式，清晰的接口抽象 |

**综合评级**: 🟡 **良好 (7.0/10)**

该权限系统设计思路清晰，双层防护架构合理，敏感信息保护到位。主要短板在于 Bash 命令依赖正则匹配在对抗性场景下的不可靠性，以及工具注册机制存在绕过风险。建议在下一个迭代中引入沙箱执行层，并修复工具名硬编码问题。
