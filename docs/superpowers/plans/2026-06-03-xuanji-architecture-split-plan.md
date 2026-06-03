# xuanji 架构拆分实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 `src/core/`（59K 行，30+ 子目录）拆分为 1 个薄引擎 + 9 个独立插件域 + 3 个横切层，Core 从 59K 行瘦身到 ~3K 行。

**架构：** 插件引擎模式。`src/engine/` 提供 PluginRegistry / MessageRouter / LifecycleManager，9 个域（agent/memory/mcp/skills/tools/provider/permission/platform/session）各自成为独立目录，通过 `Plugin<T>` 接口注册，域间通过 MessageRouter 通信。

**技术栈：** Node.js 20+, TypeScript 5.7, tsup (ESM), Electron 40

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/engine/PluginRegistry.ts` | 泛型插件注册表，`ToolRegistry` 模式泛化 |
| `src/engine/MessageRouter.ts` | 消息分发器，`{domain}:{action}` 路由 |
| `src/engine/LifecycleManager.ts` | 拓扑排序 + 按序 init/start/stop |
| `src/engine/PluginManifest.ts` | 插件清单：ID、版本、依赖关系 |
| `src/engine/index.ts` | engine 公共导出 |
| `src/engine/types.ts` | Plugin / PluginContext / MessageHandler 类型 |
| `src/shared/plugin.ts` | `IPlugin<T>` 接口（共享层，engine 和 plugin 都引用） |
| `src/agent/index.ts` | agent 域公共接口 |
| `src/memory/index.ts` | memory 域公共接口 |
| `src/mcp/index.ts` | mcp 域公共接口（已存在，补充导出） |
| `src/skills/index.ts` | skills 域公共接口 |
| `src/tools/index.ts` | tools 域公共接口（已存在，重整导出） |
| `src/provider/index.ts` | provider 域公共接口（已存在，重整导出） |
| `src/permission/index.ts` | permission 域公共接口（已存在，重整导出） |
| `src/platform/index.ts` | platform 域公共接口（已存在，重整导出） |
| `src/session/index.ts` | session 域公共接口（已存在，重整导出） |
| `src/i18n/index.ts` | i18n 域公共接口 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/index.ts` | `./core/` → `./engine/` + `./agent/` + ... |
| `desktop/main/agent-bridge.ts` | 手动初始化 → `LifecycleManager.start()` |
| `src/core/chat/SessionFactory.ts` | 移除手动初始化，改为依赖注入 |
| `src/core/tools/ToolRegistry.ts` | 泛型部分提取到 `engine/PluginRegistry.ts` |

### 删除文件（Phase 3 收尾）

- `src/core/` 整个目录（已经全部迁移到新结构）

---

## Phase 1：奠基（Engine 层提取）

### 任务 1：创建共享层 `IPlugin` 接口

**文件：**
- 创建：`src/shared/plugin.ts`
- 修改：`src/shared/index.ts`

- [ ] **步骤 1：定义 Plugin 接口**

```typescript
// src/shared/plugin.ts

export interface PluginContext {
  router: IMessageRouter;
  eventBus: IEventBus;
  config: IConfigStore;
}

export interface IPlugin<T = unknown> {
  readonly id: string;
  readonly version: string;
  readonly dependencies: string[];

  init(ctx: PluginContext): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;

  getCapabilities(): T;
}

export interface IMessageRouter {
  registerHandler(pattern: string, handler: MessageHandler): void;
  dispatch<T>(pattern: string, payload?: unknown): Promise<T>;
}

export type MessageHandler = (payload?: unknown) => Promise<unknown> | unknown;

export interface IEventBus {
  emit(event: string, payload?: unknown): Promise<void>;
  on(event: string, handler: (payload: unknown) => void): () => void;
}

export interface IConfigStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}
```

- [ ] **步骤 2：在 shared/index.ts 中导出**

```typescript
export * from './plugin';
```

- [ ] **步骤 3：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：PASS（新文件无引用，不破坏现有）

- [ ] **步骤 4：Commit**

```bash
git add src/shared/plugin.ts src/shared/index.ts
git commit -m "feat(engine): add IPlugin and PluginContext shared types"
```

---

### 任务 2：创建 PluginRegistry

**文件：**
- 创建：`src/engine/PluginRegistry.ts`
- 修改：`src/engine/types.ts`

- [ ] **步骤 1：创建类型文件**

```typescript
// src/engine/types.ts
import type { IPlugin, PluginContext } from '@/shared/plugin';

export type { IPlugin, PluginContext };

export interface PluginEntry<T = unknown> {
  plugin: IPlugin<T>;
  status: 'registered' | 'initialized' | 'started' | 'stopped';
  ctx: PluginContext;
}
```

- [ ] **步骤 2：实现 PluginRegistry**

```typescript
// src/engine/PluginRegistry.ts
import type { IPlugin, PluginContext } from '@/shared/plugin';
import type { PluginEntry } from './types';

export class PluginRegistry<TMap extends Record<string, unknown> = Record<string, unknown>> {
  private plugins = new Map<string, PluginEntry>();

  register<K extends keyof TMap & string>(plugin: IPlugin<TMap[K]>): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" already registered`);
    }
    this.plugins.set(plugin.id, {
      plugin: plugin as IPlugin<unknown>,
      status: 'registered',
      ctx: null!,
    });
  }

  get<K extends keyof TMap & string>(id: K): IPlugin<TMap[K]> | undefined {
    return this.plugins.get(id)?.plugin as IPlugin<TMap[K]> | undefined;
  }

  getCapabilities<K extends keyof TMap & string>(id: K): TMap[K] | undefined {
    const entry = this.plugins.get(id);
    if (!entry || entry.status !== 'started') return undefined;
    return entry.plugin.getCapabilities() as TMap[K];
  }

  list(): string[] {
    return Array.from(this.plugins.keys());
  }

  setContext(id: string, ctx: PluginContext): void {
    const entry = this.plugins.get(id);
    if (entry) entry.ctx = ctx;
  }

  updateStatus(id: string, status: PluginEntry['status']): void {
    const entry = this.plugins.get(id);
    if (entry) entry.status = status;
  }
}
```

- [ ] **步骤 3：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add src/engine/
git commit -m "feat(engine): add PluginRegistry with typed capabilities"
```

---

### 任务 3：创建 MessageRouter

**文件：**
- 创建：`src/engine/MessageRouter.ts`

- [ ] **步骤 1：实现 MessageRouter**

```typescript
// src/engine/MessageRouter.ts
import type { IMessageRouter, MessageHandler } from '@/shared/plugin';

interface RouteEntry {
  pattern: RegExp;
  handler: MessageHandler;
}

export class MessageRouter implements IMessageRouter {
  private routes: RouteEntry[] = [];

  registerHandler(pattern: string, handler: MessageHandler): void {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/:/g, '([^:]+)') + '$'
    );
    this.routes.push({ pattern: regex, handler });
  }

  async dispatch<T>(pattern: string, payload?: unknown): Promise<T> {
    for (const route of this.routes) {
      const match = route.pattern.exec(pattern);
      if (match) {
        return (await route.handler(payload)) as T;
      }
    }
    throw new Error(`No handler registered for message: "${pattern}"`);
  }

  clear(): void {
    this.routes = [];
  }
}
```

- [ ] **步骤 2：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add src/engine/MessageRouter.ts
git commit -m "feat(engine): add MessageRouter for inter-plugin communication"
```

---

### 任务 4：创建 LifecycleManager

**文件：**
- 创建：`src/engine/LifecycleManager.ts`
- 创建：`src/engine/PluginManifest.ts`

- [ ] **步骤 1：实现 PluginManifest**

```typescript
// src/engine/PluginManifest.ts
export interface PluginManifestEntry {
  id: string;
  version: string;
  dependencies: string[];
}

export const DEFAULT_MANIFEST: PluginManifestEntry[] = [
  { id: 'memory',    version: '1.0.0', dependencies: [] },
  { id: 'provider',  version: '1.0.0', dependencies: [] },
  { id: 'permission',version: '1.0.0', dependencies: [] },
  { id: 'tools',     version: '1.0.0', dependencies: ['permission'] },
  { id: 'session',   version: '1.0.0', dependencies: ['memory'] },
  { id: 'agent',     version: '1.0.0', dependencies: ['memory', 'tools', 'provider', 'session'] },
  { id: 'mcp',       version: '1.0.0', dependencies: ['tools', 'permission'] },
  { id: 'skills',    version: '1.0.0', dependencies: ['tools'] },
  { id: 'platform',  version: '1.0.0', dependencies: ['provider'] },
];
```

- [ ] **步骤 2：实现 LifecycleManager**

```typescript
// src/engine/LifecycleManager.ts
import type { IPlugin, PluginContext } from '@/shared/plugin';
import { PluginRegistry } from './PluginRegistry';
import { MessageRouter } from './MessageRouter';
import { eventBus } from '@/core/events/EventBus';
import { getConfigManager } from '@/core/config/ConfigManager';
import { DEFAULT_MANIFEST, type PluginManifestEntry } from './PluginManifest';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'LifecycleManager' });

export class LifecycleManager {
  private registry = new PluginRegistry();
  private router = new MessageRouter();
  private plugins: IPlugin[] = [];
  private manifest: PluginManifestEntry[];

  constructor(manifest?: PluginManifestEntry[]) {
    this.manifest = manifest ?? DEFAULT_MANIFEST;
  }

  register(plugin: IPlugin): void {
    this.plugins.push(plugin);
    this.registry.register(plugin);
  }

  async start(): Promise<void> {
    const order = this.topologicalSort();

    for (const id of order) {
      const plugin = this.plugins.find(p => p.id === id);
      if (!plugin) continue;

      const ctx: PluginContext = {
        router: this.router,
        eventBus: { emit: (e, p) => eventBus.emit(e as any, p as any), on: (e, h) => eventBus.on(e as any, h as any) },
        config: { get: (k) => getConfigManager().get(k), set: (k, v) => getConfigManager().set(k, v) },
      };

      this.registry.setContext(id, ctx);

      await plugin.init(ctx);
      this.registry.updateStatus(id, 'initialized');
      log.info(`Plugin "${id}" initialized`);

      await plugin.start();
      this.registry.updateStatus(id, 'started');
      log.info(`Plugin "${id}" started`);
    }
  }

  async stop(): Promise<void> {
    const order = this.topologicalSort().reverse();
    for (const id of order) {
      const plugin = this.plugins.find(p => p.id === id);
      if (plugin) {
        await plugin.stop();
        this.registry.updateStatus(id, 'stopped');
      }
    }
  }

  getRegistry(): PluginRegistry {
    return this.registry;
  }

  getRouter(): MessageRouter {
    return this.router;
  }

  private topologicalSort(): string[] {
    const entryMap = new Map<string, PluginManifestEntry>();
    for (const e of this.manifest) entryMap.set(e.id, e);

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: string[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`Circular dependency detected at: ${id}`);
      visiting.add(id);
      const entry = entryMap.get(id);
      if (entry) {
        for (const dep of entry.dependencies) visit(dep);
      }
      visiting.delete(id);
      visited.add(id);
      result.push(id);
    };

    for (const entry of this.manifest) visit(entry.id);
    return result;
  }
}
```

- [ ] **步骤 3：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add src/engine/LifecycleManager.ts src/engine/PluginManifest.ts
git commit -m "feat(engine): add LifecycleManager with topological sort"
```

---

### 任务 5：创建 Engine 统一导出

**文件：**
- 创建：`src/engine/index.ts`

- [ ] **步骤 1：创建 index.ts**

```typescript
// src/engine/index.ts
export { PluginRegistry } from './PluginRegistry';
export { MessageRouter } from './MessageRouter';
export { LifecycleManager } from './LifecycleManager';
export { DEFAULT_MANIFEST } from './PluginManifest';
export type { PluginManifestEntry } from './PluginManifest';
export type { PluginEntry } from './types';
```

- [ ] **步骤 2：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add src/engine/index.ts
git commit -m "feat(engine): add unified engine exports"
```

---

## Phase 2：拆域

### 任务 6：拆分 shared 域（零依赖，最先搬迁）

**文件：**
- 修改：`src/shared/index.ts` — 重整导出，确保 `plugin.ts` 在首位
- 验证各域的 import 路径不变

- [ ] **步骤 1：检查 shared 目录结构**

运行：
```bash
find src/shared -name "*.ts" | sort
```

- [ ] **步骤 2：确认 shared 零业务依赖**

运行：
```bash
grep -r "from '@/core/" src/shared/ || echo "NO CORE IMPORTS — CLEAN"
```
预期：NO CORE IMPORTS — CLEAN

- [ ] **步骤 3：验证 shared index 导出完整**

运行：`npx tsc --noEmit --skipLibCheck`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add src/shared/
git commit -m "refactor: verify shared domain has zero core imports"
```

---

### 任务 7：拆分 i18n 域

**文件：**
- 移动：`src/core/i18n/` → `src/i18n/`
- 修改：所有 `@/core/i18n` → `@/i18n` 的 import（约 30 处）

- [ ] **步骤 1：查找所有 i18n 引用**

运行：
```bash
grep -rn "from '@/core/i18n'" src/ desktop/ | head -50
```

- [ ] **步骤 2：移动 i18n 目录**

```bash
mv src/core/i18n src/i18n
```

- [ ] **步骤 3：批量更新 import 路径**

使用以下命令查找并替换全部 i18n 引用：
```bash
grep -rl "from '@/core/i18n'" src/ desktop/ | xargs sed -i '' "s|from '@/core/i18n'|from '@/i18n'|g"
grep -rl "from '@/core/i18n/" src/ desktop/ | xargs sed -i '' "s|from '@/core/i18n/|from '@/i18n/|g"
```

- [ ] **步骤 4：更新 i18n/index.ts 导出路径**

检查并修正 i18n/index.ts 中的内部 import。

- [ ] **步骤 5：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：PASS

- [ ] **步骤 6：Commit**

```bash
git add src/i18n/ $(grep -rl "@/i18n" src/ desktop/)
git commit -m "refactor: extract i18n domain from core to src/i18n"
```

---

### 任务 8：拆分 tools 域（泛化 ToolRegistry → PluginRegistry 验证）

**文件：**
- 修改：`src/core/tools/ToolRegistry.ts` — `createDefaultRegistry()` 签名不变，内部继承 `PluginRegistry`
- 移动：`src/core/tools/` → `src/tools/`（整个目录搬迁）

- [ ] **步骤 1：调整 ToolRegistry 基类**

修改 `src/core/tools/ToolRegistry.ts`，让 `IToolRegistry` 实现层使用新的 `PluginRegistry` 模式，但对外接口保持兼容：

```typescript
// 在现有 ToolRegistry 类的构造函数中，不破坏原有 createDefaultRegistry()
// 仅添加 implements 标记，为后续 Phase 3 完整迁移做准备
```

在此任务中不改变 ToolRegistry 行为，只确保目录迁移后 import 路径正确。

- [ ] **步骤 2：查找所有 tools 引用**

运行：
```bash
grep -rn "from '@/core/tools'" src/ desktop/ | wc -l
```

- [ ] **步骤 3：移动 tools 目录**

```bash
mv src/core/tools src/tools
```

- [ ] **步骤 4：批量更新 import 路径**

```bash
grep -rl "from '@/core/tools'" src/ desktop/ | xargs sed -i '' "s|from '@/core/tools'|from '@/tools'|g"
grep -rl "from '@/core/tools/" src/ desktop/ | xargs sed -i '' "s|from '@/core/tools/|from '@/tools/|g"
```

- [ ] **步骤 5：更新 tools 内部相对 import**

检查 tools 目录内各文件之间的 import（如 `ToolRegistry.ts` 中 import 的 `./ReadTool` 等），确保相对路径正确。

- [ ] **步骤 6：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：PASS

- [ ] **步骤 7：Commit**

```bash
git add src/tools/ $(grep -rl "@/tools" src/ desktop/)
git commit -m "refactor: extract tools domain from core to src/tools"
```

---

### 任务 9：拆分 provider 域

**文件：**
- 移动：`src/core/providers/` → `src/provider/`
- 移动：`src/core/stream/` → `src/provider/stream/`（Stream 逻辑属于 Provider）

- [ ] **步骤 1：移动目录**

```bash
mv src/core/providers src/provider
mv src/core/stream src/provider/stream
```

- [ ] **步骤 2：批量更新 import 路径**

```bash
grep -rl "from '@/core/providers'" src/ desktop/ | xargs sed -i '' "s|from '@/core/providers'|from '@/provider'|g"
grep -rl "from '@/core/providers/" src/ desktop/ | xargs sed -i '' "s|from '@/core/providers/|from '@/provider/|g"
grep -rl "from '@/core/stream'" src/ desktop/ | xargs sed -i '' "s|from '@/core/stream'|from '@/provider/stream'|g"
grep -rl "from '@/core/stream/" src/ desktop/ | xargs sed -i '' "s|from '@/core/stream/|from '@/provider/stream/|g"
```

- [ ] **步骤 3：修正 provider 内部引用**

检查 StreamEvent、OpenAIProvider、AnthropicProvider 等文件内部对 stream 的 import 路径。

- [ ] **步骤 4：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/provider/ $(grep -rl "@/provider" src/ desktop/)
git commit -m "refactor: extract provider+stream domain from core to src/provider"
```

---

### 任务 10：拆分 permission 域

**文件：**
- 移动：`src/permission/` → 已在 `src/permission/` 中，无需移动目录，但需重整 `index.ts`

- [ ] **步骤 1：验证 permission 无 core import（或仅依赖 shared）**

运行：
```bash
grep -rn "from '@/core/" src/permission/ | grep -v "types" | grep -v "shared"
```
预期：仅有 types/shared 引用，无业务域引用。

- [ ] **步骤 2：创建 permission 域 Plugin 骨架**

```typescript
// src/permission/index.ts 末尾追加
import type { IPlugin, PluginContext } from '@/shared/plugin';
import { PermissionController } from './PermissionController';

export class PermissionPlugin implements IPlugin<{ controller: PermissionController }> {
  id = 'permission';
  version = '1.0.0';
  dependencies: string[] = [];

  private controller!: PermissionController;

  async init(_ctx: PluginContext): Promise<void> {
    this.controller = new PermissionController();
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  getCapabilities() {
    return { controller: this.controller };
  }
}
```

- [ ] **步骤 3：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add src/permission/index.ts src/permission/
git commit -m "refactor: add PermissionPlugin skeleton for plugin architecture"
```

---

### 任务 11：拆分 session 域

**文件：**
- `src/session/` 已在独立目录中，重整 `index.ts`
- 移动 `src/core/chat/ChatSession.ts` → `src/session/ChatSession.ts`
- 移动 `src/core/chat/SessionFactory.ts` → `src/session/SessionFactory.ts`

- [ ] **步骤 1：移动 ChatSession 和 SessionFactory**

```bash
mv src/core/chat/ChatSession.ts src/session/ChatSession.ts
mv src/core/chat/SessionFactory.ts src/session/SessionFactory.ts
```

- [ ] **步骤 2：更新 import**

```bash
grep -rl "from '@/core/chat/ChatSession'" src/ desktop/ | xargs sed -i '' "s|from '@/core/chat/ChatSession'|from '@/session/ChatSession'|g"
grep -rl "from '@/core/chat/SessionFactory'" src/ desktop/ | xargs sed -i '' "s|from '@/core/chat/SessionFactory'|from '@/session/SessionFactory'|g"
```

- [ ] **步骤 3：修正 SessionFactory 内部 import 路径**

SessionFactory 内部 import 了大量 core 模块。已迁移的域使用新路径，尚未迁移的（config/events/logger/state/task）保留 `@/core/` 路径，等任务 15 统一处理：
```typescript
// 旧 → 新（仅限已迁移的域）
'@/core/providers/ProviderManager' → '@/provider/ProviderManager'
'@/core/tools/ToolRegistry' → '@/tools/ToolRegistry'
'@/core/tools/ToolConfigManager' → '@/tools/ToolConfigManager'
'@/permission/PermissionController' → '@/permission/PermissionController'
'@/session/SessionManager' → './SessionManager'
'@/core/memory/MemoryManager' → '@/memory/MemoryManager'
'@/hooks/HookRegistry' → 保持（hooks 已在 src/hooks/，路径正确）
// 以下路径保留 @/core/，待任务 15 批量处理：
'@/core/config/ConfigLoader'
'@/core/config/ConfigManager'
'@/core/state/StateTracker'
'@/core/task/TaskOrchestrator'
'@/core/events/EventBus'
'@/core/logger'
'@/core/di'
```

- [ ] **步骤 4：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：可能有 residual errors，逐个修复 import 路径。

- [ ] **步骤 5：Commit**

```bash
git add src/session/ $(grep -rl "@/session" src/ desktop/)
git commit -m "refactor: extract ChatSession+SessionFactory to session domain"
```

---

### 任务 12：拆分 memory 域

**文件：**
- 移动：`src/core/memory/` → `src/memory/`

- [ ] **步骤 1：移动 memory 目录**

```bash
mv src/core/memory src/memory
```

- [ ] **步骤 2：批量更新 import**

```bash
grep -rl "from '@/core/memory'" src/ desktop/ | xargs sed -i '' "s|from '@/core/memory'|from '@/memory'|g"
grep -rl "from '@/core/memory/" src/ desktop/ | xargs sed -i '' "s|from '@/core/memory/|from '@/memory/|g"
```

- [ ] **步骤 3：添加 MemoryPlugin 骨架**

在 `src/memory/index.ts` 中添加：
```typescript
import type { IPlugin, PluginContext } from '@/shared/plugin';
import { MemoryManager } from './MemoryManager';

export class MemoryPlugin implements IPlugin<{ manager: MemoryManager }> {
  id = 'memory';
  version = '1.0.0';
  dependencies: string[] = [];

  private manager!: MemoryManager;

  async init(ctx: PluginContext): Promise<void> {
    this.manager = new MemoryManager(/* 从 ctx.config 读取配置 */);
    await this.manager.initialize();
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {
    this.manager.close();
  }

  getCapabilities() {
    return { manager: this.manager };
  }
}
```

- [ ] **步骤 4：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：修正所有 import 后 PASS

- [ ] **步骤 5：Commit**

```bash
git add src/memory/ $(grep -rl "@/memory" src/ desktop/)
git commit -m "refactor: extract memory domain from core to src/memory"
```

---

### 任务 13：拆分 agent 域

**文件：**
- 移动：`src/core/agent/` → `src/agent/`
- 移动：`src/core/task/` → `src/agent/task/`
- 移动：`src/core/state/` → `src/agent/state/`

- [ ] **步骤 1：移动目录**

```bash
mv src/core/agent src/agent
mv src/core/task src/agent/task
mv src/core/state src/agent/state
```

- [ ] **步骤 2：批量更新 import**

```bash
grep -rl "from '@/core/agent'" src/ desktop/ | xargs sed -i '' "s|from '@/core/agent'|from '@/agent'|g"
grep -rl "from '@/core/agent/" src/ desktop/ | xargs sed -i '' "s|from '@/core/agent/|from '@/agent/|g"
grep -rl "from '@/core/task'" src/ desktop/ | xargs sed -i '' "s|from '@/core/task'|from '@/agent/task'|g"
grep -rl "from '@/core/state'" src/ desktop/ | xargs sed -i '' "s|from '@/core/state'|from '@/agent/state'|g"
```

- [ ] **步骤 3：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：修正后 PASS

- [ ] **步骤 4：Commit**

```bash
git add src/agent/ $(grep -rl "@/agent" src/ desktop/)
git commit -m "refactor: extract agent domain from core to src/agent"
```

---

### 任务 14：拆分 mcp / skills / platform 域

**文件：**
- `src/mcp/` 已在独立目录，重整 index.ts
- 移动：`src/core/skills/` → `src/skills/`
- `src/platform/` 已在独立目录，重整 index.ts

- [ ] **步骤 1：移动 skills**

```bash
mv src/core/skills src/skills
```

- [ ] **步骤 2：更新 skills import**

```bash
grep -rl "from '@/core/skills'" src/ desktop/ | xargs sed -i '' "s|from '@/core/skills'|from '@/skills'|g"
grep -rl "from '@/core/skills/" src/ desktop/ | xargs sed -i '' "s|from '@/core/skills/|from '@/skills/|g"
```

- [ ] **步骤 3：更新 mcp 和 platform 的 index.ts**

验证 mcp/index.ts 和 platform/index.ts 没有引用 `@/core/` 路径。

- [ ] **步骤 4：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/skills/ src/mcp/ src/platform/
git commit -m "refactor: extract skills domain, finalize mcp/platform domains"
```

---

### 任务 15：拆分 infrastructure 横切层

**文件：**
- 移动：`src/core/logger/` → `src/infrastructure/logger/`
- 移动：`src/core/logging/` → `src/infrastructure/logging/`
- 移动：`src/core/telemetry/` → `src/infrastructure/telemetry/`
- 移动：`src/core/events/` → `src/infrastructure/events/`
- 移动：`src/core/context/` → `src/infrastructure/context/`
- 移动：`src/core/embedding/` → `src/infrastructure/embedding/`
- 移动：`src/core/template/` → `src/infrastructure/template/`
- 移动：`src/core/config/` → `src/infrastructure/config/`

- [ ] **步骤 1：批量移动 infrastructure 模块**

```bash
mkdir -p src/infrastructure
mv src/core/logger src/infrastructure/logger
mv src/core/logging src/infrastructure/logging
mv src/core/telemetry src/infrastructure/telemetry
mv src/core/events src/infrastructure/events
mv src/core/context src/infrastructure/context
mv src/core/embedding src/infrastructure/embedding
mv src/core/template src/infrastructure/template
mv src/core/config src/infrastructure/config
```

- [ ] **步骤 2：批量更新 import 路径**

```bash
grep -rl "from '@/core/logger'" src/ desktop/ | xargs sed -i '' "s|from '@/core/logger'|from '@/infrastructure/logger'|g"
grep -rl "from '@/core/logging'" src/ desktop/ | xargs sed -i '' "s|from '@/core/logging'|from '@/infrastructure/logging'|g"
grep -rl "from '@/core/events'" src/ desktop/ | xargs sed -i '' "s|from '@/core/events'|from '@/infrastructure/events'|g"
grep -rl "from '@/core/events/" src/ desktop/ | xargs sed -i '' "s|from '@/core/events/|from '@/infrastructure/events/|g"
grep -rl "from '@/core/config'" src/ desktop/ | xargs sed -i '' "s|from '@/core/config'|from '@/infrastructure/config'|g"
grep -rl "from '@/core/config/" src/ desktop/ | xargs sed -i '' "s|from '@/core/config/|from '@/infrastructure/config/|g"
grep -rl "from '@/core/embedding'" src/ desktop/ | xargs sed -i '' "s|from '@/core/embedding'|from '@/infrastructure/embedding'|g"
```

- [ ] **步骤 3：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add src/infrastructure/ $(grep -rl "@/infrastructure" src/ desktop/)
git commit -m "refactor: extract infrastructure cross-cutting layer from core"
```

---

## Phase 3：收割

### 任务 16：重构 agent-bridge.ts 使用 LifecycleManager

**文件：**
- 修改：`desktop/main/agent-bridge.ts`

- [ ] **步骤 1：重写 agent-bridge 入口**

```typescript
// desktop/main/agent-bridge.ts（重写）
import { LifecycleManager } from '../../src/engine/LifecycleManager.js';
import { PermissionPlugin } from '../../src/permission/index.js';
import { MemoryPlugin } from '../../src/memory/index.js';
import { ProviderPlugin } from '../../src/provider/index.js';
// ... 各域 Plugin

const lifecycle = new LifecycleManager();

lifecycle.register(new PermissionPlugin());
lifecycle.register(new MemoryPlugin());
lifecycle.register(new ProviderPlugin());
// ... 注册所有 Plugin

await lifecycle.start();

// Channel 通信保持不变
const channel = new ChildMessageChannel({ name: 'agent-child', enableLogging: true });
channel.send('child-ready', { pid: process.pid });

// 注册 MessageRouter handlers 替代直接调用
const router = lifecycle.getRouter();
router.registerHandler('session:create', async (payload) => { /* ... */ });
router.registerHandler('session:send', async (payload) => { /* ... */ });
```

- [ ] **步骤 2：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add desktop/main/agent-bridge.ts
git commit -m "refactor(agent-bridge): replace manual wiring with LifecycleManager"
```

---

### 任务 17：更新 src/index.ts 入口

**文件：**
- 修改：`src/index.ts`

- [ ] **步骤 1：更新导出**

```typescript
// src/index.ts
export { LifecycleManager, PluginRegistry, MessageRouter, DEFAULT_MANIFEST } from './engine';
export { SessionFactory } from './session/SessionFactory';
export { ChatSession } from './session/ChatSession';
// 各域 Plugin 导出
export { PermissionPlugin } from './permission';
export { MemoryPlugin } from './memory';
// ...
```

- [ ] **步骤 2：TypeCheck**

运行：`npx tsc --noEmit --skipLibCheck`
预期：PASS

---

### 任务 18：删除 src/core/ 旧目录

- [ ] **步骤 1：确认 core 残留内容**

运行：
```bash
find src/core -type f 2>/dev/null | head -30
```

- [ ] **步骤 2：确认无残留 import 引用 core**

运行：
```bash
grep -rn "from '@/core/" src/ desktop/ | grep -v node_modules | grep -v ".git"
```
预期：无输出（所有 core import 已迁移）

- [ ] **步骤 3：删除 core 目录**

```bash
rm -rf src/core
```

- [ ] **步骤 4：TypeCheck（最终验证）**

运行：`npx tsc --noEmit`
预期：PASS

- [ ] **步骤 5：运行测试**

运行：`npm test`
预期：全量通过

- [ ] **步骤 6：Commit**

```bash
git add -A
git commit -m "refactor: remove src/core/ directory, migration complete"
```

---

### 任务 19：Electron 打包验证

- [ ] **步骤 1：构建**

运行：`npm run build`
预期：成功

- [ ] **步骤 2：Electron 打包 macOS**

运行：`npm run build:gui:mac:arm64`
预期：打包成功

- [ ] **步骤 3：启动验证**

运行打包后的应用，验证：Agent 对话、Memory 查询、MCP 工具调用、Skills 激活。

---

## 验收标准总览

- [ ] `npx tsc --noEmit` 通过
- [ ] `npm test` 全量通过
- [ ] `npm run build` 构建成功
- [ ] Electron 打包成功并正常运行
- [ ] `src/core/` 目录不再存在
- [ ] `src/engine/` 目录仅包含 5 个文件 + index.ts
- [ ] 每个域 `index.ts` 仅导出公共接口
- [ ] 域之间无不通过 MessageRouter 的直接 import（保留 shared 类型引用例外）
