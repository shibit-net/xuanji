# Xuanji ↔ 天工坊 集成方案 v1.0

> 设计日期: 2026-05-18 | 状态: 待审查

---

## 1. 架构总览

新增 `src/market/` 模块，作为天工坊集成的统一入口，在 MCPManager 和 SkillRegistry 之间起到桥梁作用。

```
                    ┌──────────────────────────────────┐
                    │        src/market/                │
                    │  ┌────────────┐ ┌──────────────┐ │
                    │  │TiangongClient│ │TiangongAuth │ │
                    │  │ (REST API)  │ │ (Token Mgmt) │ │
                    │  └─────┬──────┘ └──────┬───────┘ │
                    │  ┌─────┴──────────────┴───────┐  │
                    │  │     PackageManager          │  │
                    │  │  (download/verify/install)  │  │
                    │  └─────┬──────────────┬───────┘  │
                    │  ┌─────┴─────┐ ┌──────┴──────┐  │
                    │  │MCPInstaller│ │SkillInstaller│  │
                    │  └─────┬─────┘ └──────┬──────┘  │
                    └────────┼──────────────┼──────────┘
                             │              │
              ┌──────────────┴──┐   ┌───────┴──────────────┐
              │   MCPManager    │   │   SkillRegistry      │
              │ (已有, 扩展)     │   │ (已有, 扩展)          │
              └─────────────────┘   └──────────────────────┘
```

**关键设计原则**:
- `src/market/` 是独立模块，**不修改 MCP/Skills 核心逻辑**
- 对 MCPManager 和 SkillRegistry 只做**最小扩展**（新增方法，不改变现有接口）
- 安装后的 MCP Server 和 Skill 与手动安装的**行为完全一致**

---

## 2. 天工坊 API 映射

天工坊 API 根路径: `https://www.tiangong.cn/api/mcp-market/`

| 天工坊 API | 方法 | 对应 Xuanji 功能 | 调用者 |
|---|---|---|---|
| `/search` | GET | 搜索 MCP/Skills | `TiangongClient.search()` |
| `/detail/:id` | GET | 获取包详情（含下载地址、SHA256） | `TiangongClient.getDetail()` |
| `/download/:id` | GET | 下载包体（tarball） | `PackageFetcher.download()` |
| `/review` | POST | 提交评分/评论 | `TiangongClient.submitReview()` |
| `/categories` | GET | 获取分类列表 | `TiangongClient.getCategories()` |

**天工坊侧建议补充**（非阻塞，后续迭代）:
1. `GET /updates` — 批量检查更新（传入 `[{id, version}]`）
2. `POST /auth/token` — API Key 换 Token（如已有，跳过）

---

## 3. 新增模块设计

### 3.1 `src/market/types.ts` — 类型定义

```typescript
/** 天工坊搜索/列表项 */
interface TiangongSearchResult {
  id: string; name: string; description: string;
  type: 'mcp' | 'skill'; version: string;
  author: string; downloads: number; rating: number;
  tags: string[]; category: string;
}

/** 天工坊包详情 */
interface TiangongPackageDetail extends TiangongSearchResult {
  readme?: string; changelog?: string;
  dependencies?: Record<string, string>;   // id → version constraint
  xuanjiVersionRange?: string;             // 兼容的 Xuanji 版本范围 (semver)
  downloadUrl: string; sha256: string; size: number;
}

/** 安装源追踪 — 记录每个包的来源信息 */
interface PackageSource {
  type: 'tiangong' | 'local' | 'git' | 'npm';
  packageId: string; installedVersion: string;
  installedAt: Date; lastCheckedAt?: Date;
  autoUpdate?: boolean;
}

/** 安装结果 */
interface InstallResult {
  success: boolean;
  packageId: string; version: string;
  type: 'mcp' | 'skill';
  warnings: string[];          // 兼容性警告等
  rollback?: () => Promise<void>;
}
```

### 3.2 `src/market/TiangongClient.ts` — API 客户端

```
TiangongClient
├── constructor(baseUrl: string, authProvider: TiangongAuth)
├── search(query: string, filters?: SearchFilters) → TiangongSearchResult[]
│   参数: query, category, type, sort(下载量/评分/时间), page, pageSize
├── getDetail(packageId: string) → TiangongPackageDetail
├── getCategories() → Category[]
├── submitReview(packageId: string, rating: number, comment?: string) → void
└── checkUpdates(packages: {id:string, version:string}[]) → UpdateInfo[]
```

### 3.3 `src/market/TiangongAuth.ts` — 认证管理

```
AuthStore (接口)
├── saveToken(token: AuthToken): void
├── loadToken(): AuthToken | null
└── deleteToken(): void

TiangongAuth
├── constructor(store: AuthStore)
├── authenticate(apiKey: string) → Promise<void>
│   用 API Key 换短期 Token，存入 AuthStore
├── getToken() → string | null
│   自动检查过期并刷新
├── isAuthenticated() → boolean
└── logout() → void

// 实现: FileAuthStore
// 存储路径: ~/.xuanji/auth/tiangong.json
// 权限: 600 (仅 owner 读写)
```

### 3.4 `src/market/PackageFetcher.ts` — 包下载与校验

```
PackageFetcher
├── download(downloadUrl: string, destPath: string, sha256: string,
│            onProgress?: (pct: number) => void) → Promise<string>
│   1. HTTP GET 下载 (支持断点续传)
│   2. SHA-256 完整性校验
│   3. 解压 .tar.gz/.zip 到目标目录
│   4. 返回最终安装路径
├── 错误处理: 网络超时 (30s)、磁盘满、SHA256 不匹配、解压失败
└── 清理: 安装失败时删除已下载文件
```

### 3.5 `src/market/PackageManager.ts` — 统一包管理器（门面）

```
PackageManager
├── constructor(client, fetcher, mcpInstaller, skillInstaller, compatChecker)
├── searchAndInstall(query: string) → InstallResult
│   1. client.search(query) → 列表
│   2. client.getDetail(id) → 详情
│   3. compatChecker.check(xuanjiVersionRange) → 兼容性
│   4. fetcher.download(url, path, sha256) → 下载+校验
│   5. dispatch → MCPInstaller.install() | SkillInstaller.install()
│   6. 记录到 packages.json
├── checkUpdates() → UpdateInfo[]
├── updatePackage(packageId: string) → InstallResult
├── uninstallPackage(packageId: string): void
│   1. 停止 MCP 服务器(如适用)
│   2. 从 Registry 注销 Skill(如适用)
│   3. 删除安装目录
│   4. 从 packages.json 移除
└── listInstalled() → PackageInfo[]
```

### 3.6 `src/market/MCPInstaller.ts` — MCP 服务器安装器

```
MCPInstaller
├── constructor(mcpManager: MCPManager)
├── install(installPath: string, detail: TiangongPackageDetail) → InstallResult
│   1. 读取包内的 manifest.json (包含 command, args, env 等)
│   2. 构造 MCPServerConfig (含 source 标记)
│   3. 调用 mcpManager.registerServer(config) 注册
│   4. 启动服务器
│   5. 验证连接 (调用 listTools 确认可用)
└── update(serverName: string, newInstallPath: string, newDetail) → InstallResult
   1. 停止旧服务器
   2. 替换安装目录
   3. 更新配置 source
   4. 重新启动
```

### 3.7 `src/market/SkillInstaller.ts` — Skills 安装器

```
SkillInstaller
├── constructor(skillLoader: SkillLoader, skillRegistry: SkillRegistry)
├── install(installPath: string, detail: TiangongPackageDetail) → InstallResult
│   1. 从 installed/ 目录加载 Skill 文件（复用 SkillLoader.loadFromDirectory）
│   2. 注册到 SkillRegistry
│   3. 验证依赖（调用 registry.validate）
│   4. 标记来源（registry.markSource）
└── update(skillId: string, newInstallPath: string, newDetail) → InstallResult
   1. 从 Registry 注销旧版本
   2. 安装新版本
   3. 重新验证依赖
```

### 3.8 `src/market/CompatibilityChecker.ts` — 兼容性检查

```
CompatibilityChecker
├── constructor(xuanjiVersion: string)
├── checkXuanjiVersion(range: string) → { ok:boolean; current:string; required:string }
│   使用 semver.satisfies(xuanjiVersion, range)
├── checkDependencies(deps: Record<string,string>) → { ok:boolean; missing:string[]; mismatch:string[] }
│   检查依赖包是否已安装且版本匹配
└── checkConflicts(packageId: string) → { ok:boolean; conflicts:string[] }
   检查是否与已安装包冲突
```

---

## 4. 现有模块改造

### 4.1 `MCPServerConfig` 扩展 (`src/mcp/types.ts`)

在现有 `MCPServerConfig` 接口中新增两个可选字段：

```typescript
export interface MCPServerConfig {
  // ... 现有字段保持不变 ...

  /** 🆕 安装源信息（天工坊等远程安装） */
  source?: PackageSource;

  /** 🆕 安装路径（已下载的 MCP Server 目录） */
  installPath?: string;
}
```

**影响面**: 纯增量字段，不影响现有配置文件解析。`PackageSource` 从 `src/market/types.ts` 导入。

### 4.2 `MCPManager` 扩展 (`src/mcp/MCPManager.ts`)

新增三个方法：

```typescript
/** 动态注册并启动一个新的 MCP 服务器 */
async registerServer(config: MCPServerConfig): Promise<void>

/** 从安装源启动服务器 (installFromSource 的别名) */
async installFromSource(source: PackageSource): Promise<void>

/** 热更新服务器: 停止→重新配置→启动 */
async updateServer(serverName: string, newConfig: Partial<MCPServerConfig>): Promise<void>
```

**影响面**: 新增方法，不改变现有 API。`registerServer` 复用 `_doInitialize` 中的逻辑（创建 client → 注册事件 → 加入 clients map）。

### 4.3 `SkillRegistry` 扩展 (`src/core/skills/registry.ts`)

新增三个方法：

```typescript
/** 标记 Skill 的安装源 */
markSource(skillId: string, source: PackageSource): void

/** 获取 Skill 来源 */
getSource(skillId: string): PackageSource | undefined

/** 列出所有外部安装的 Skill */
listExternal(): Skill[]
```

**实现**: 内部新增 `private sources: Map<string, PackageSource>`。

### 4.4 `SkillLoader` 扩展 (`src/core/skills/loader.ts`)

新增方法：

```typescript
/** 从远程源加载单个 Skill（安装到 installed/ 后调用） */
async loadFromSource(source: PackageSource): Promise<void>

/** 热重载单个 Skill */
async reloadSkill(skillId: string): Promise<void>
```

**注意**: `loadFromSource` 不需要修改 `loadSkillsFromDirectory` — 天工坊安装的 Skill 存放于 `~/.xuanji/skills/installed/` 目录，该目录**已被现有 `loadInstalledSkills()` 支持**。只需确保安装路径正确即可。

---

## 5. 数据流与调用链

### 5.1 搜索与安装流程

```
用户: "安装天气查询 MCP"
  → AgentLoop 识别意图 (IntentRouter)
  → 调用 tiangong_search 工具
    → TiangongClient.search("天气查询", { type: "mcp" })
  → 展示结果，用户选择
  → 调用 tiangong_install 工具
    → PackageManager.searchAndInstall("weather-mcp")
      → TiangongClient.getDetail("weather-mcp")
      → CompatibilityChecker.checkXuanjiVersion(detail.xuanjiVersionRange)
      → 用户确认
      → PackageFetcher.download(detail.downloadUrl, destPath, detail.sha256)
      → MCPInstaller.install(installPath, detail)
        → MCPManager.registerServer(config)
          → 创建 MCPClient → 启动 → 验证 tools/list
      → 写入 ~/.xuanji/packages.json
  → 返回安装结果
```

### 5.2 更新检查流程

```
启动时 / 定时任务
  → PackageManager.checkUpdates()
    → 读取 ~/.xuanji/packages.json
    → TiangongClient.checkUpdates(installedPackages)
    → 返回有更新的列表
  → 通知用户（可选暴露为 scheduled task）
```

### 5.3 卸载流程

```
用户: "卸载 weather-mcp"
  → PackageManager.uninstallPackage("weather-mcp")
    → 读取 packages.json 获取配置
    → 如果是 MCP: MCPManager 停止并移除客户端
    → 如果是 Skill: SkillRegistry.unregister(id)
    → 删除安装目录
    → 从 packages.json 删除记录
```

---

## 6. 安全模型

| 层级 | 机制 | 实现方式 |
|------|------|---------|
| **传输加密** | HTTPS | `TiangongClient` 强制使用 HTTPS |
| **身份认证** | Bearer Token | 用户在天工坊获取 API Key → `TiangongAuth.authenticate()` 换短期 Token → 本地加密存储 (`~/.xuanji/auth/`, 权限 600) |
| **完整性校验** | SHA-256 | `PackageFetcher.download()` 下载后立即校验，不匹配则拒绝安装并清理 |
| **运行时权限** | PermissionController | MCP Server 启动后受 Xuanji 现有权限系统管控（文件访问、网络、命令执行） |
| **来源追溯** | PackageSource 记录 | 所有外部安装的包记录来源，可通过 `MCPManager.getServerRuntimes()` 和 `SkillRegistry.getSource()` 查询 |
| **数据库** | 无直接 DB 访问 | 配置存储为 JSON 文件，不涉及数据库 |

---

## 7. 版本兼容性

### 7.1 Xuanji 版本检查

使用 `semver` 库：

```typescript
import { satisfies } from 'semver';

// 天工坊包声明: "xuanjiVersionRange": ">=1.0.0 <2.0.0"
if (!satisfies(xuanjiVersion, detail.xuanjiVersionRange)) {
  return { ok: false, reason: `Xuanji ${xuanjiVersion} 不满足要求 ${detail.xuanjiVersionRange}` };
}
```

### 7.2 依赖版本解析

```typescript
// 天工坊包声明: "dependencies": { "base-skill": "^1.2.0" }
// 本地已安装: base-skill@1.3.0 → ✅ 满足
// 本地未安装: base-skill → ❌ 提示先安装依赖
// 本地已安装: base-skill@0.9.0 → ❌ 版本不匹配
```

### 7.3 回滚机制

安装失败时自动执行回滚：
1. 删除已下载文件
2. 如果 MCP Server 已启动 → 停止并移除
3. 如果 Skill 已注册 → 注销
4. 清理 packages.json 中的部分记录

---

## 8. 工具暴露（给 Agent 使用）

新增以下 Xuanji 工具，让 Agent 可以直接操作天工坊：

| 工具名 | 功能 | 对应方法 |
|---|---|---|
| `tiangong_search` | 搜索天工坊 | `PackageManager.searchAndInstall` 的第一步 |
| `tiangong_install` | 安装天工坊包 | `PackageManager.searchAndInstall` 全流程 |
| `tiangong_uninstall` | 卸载包 | `PackageManager.uninstallPackage` |
| `tiangong_list` | 列出已安装包 | `PackageManager.listInstalled` |
| `tiangong_update` | 更新包 | `PackageManager.updatePackage` |
| `tiangong_check_updates` | 检查更新 | `PackageManager.checkUpdates` |

工具注册位置: `src/core/tools/` 新增 `TiangongSearchTool.ts`、`TiangongInstallTool.ts` 等。

---

## 9. 实施路线图

| 阶段 | 内容 | 新增文件 | 修改文件 | 预估 |
|------|------|---------|---------|------|
| **Phase 1** 核心通路 | `types.ts` + `TiangongClient` + `TiangongAuth` + `PackageFetcher` | 4 | 0 | 2-3天 |
| **Phase 2** MCP集成 | `MCPInstaller` + `MCPManager` 扩展 | 1 | 1 (`MCPManager.ts`, `types.ts`) | 1-2天 |
| **Phase 3** Skills集成 | `SkillInstaller` + `SkillRegistry/Loader` 扩展 | 1 | 2 (`registry.ts`, `loader.ts`) | 1-2天 |
| **Phase 4** 包管理 | `PackageManager` + `CompatibilityChecker` + 工具 | 2 + 6工具 | 0 | 2天 |
| **Phase 5** 测试&文档 | 单元测试 + 集成测试 + 文档 | 若干测试 | 0 | 2天 |

**总计**: ~10天 (单人) 或 ~6天 (双人并行)

---

## 10. 决策记录

| 决策 | 理由 | 替代方案 |
|------|------|---------|
| 新增 `src/market/` 独立模块而非合并到 mcp/skills | 不污染现有模块，集市逻辑独立演进 | 直接在 mcp/ 下加子模块（耦合更紧） |
| 对现有模块只做增量扩展 | 最小侵入，现有测试全部通过 | 重构现有模块（风险大） |
| 配置存储用 JSON 文件而非 SQLite | 简单，可读，与 Xuanji 现有模式一致 | SQLite（过度设计） |
| Token 存储于 `~/.xuanji/auth/` | 与 Xuanji 配置目录一致，权限可控 | 系统 Keychain（更安全但复杂） |
| 复用 SkillLoader 已有的 `installed/` 目录 | 零改动，SkillLoader 天然支持 | 新增专门的 marketplace/ 目录 |
