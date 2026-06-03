# xuanji 架构拆分设计

## 背景

xuanji 客户端项目现状：554 个 TS 文件、~124K 行代码。核心模块 `src/core/` 占 59K 行（72%），包含 30+ 个子目录，Memory/Agent/Team/Session/MCP/Tools 互相缠绕。最大文件 MemoryManager.ts 3255 行、TeamManager.ts 2612 行。

核心问题：Core 承载了太多东西，边界模糊，依赖方向靠约定而非机制保证。

## 目标架构

### Core 引擎（~3K 行）

只保留 5 个基础设施：

| 组件 | 职责 |
|------|------|
| `PluginRegistry<T>` | 通用插件注册表，现有 `ToolRegistry` 泛化而来 |
| `MessageRouter` | 统一消息路由，插件间通过 Router 通信 |
| `LifecycleManager` | 插件生命周期管理 |
| `EventBus` | 事件总线 |
| `ConfigStore` | 统一配置读取 |

### 9 个插件域

```
src/
├─ engine/           # 薄引擎
│   ├─ PluginRegistry.ts
│   ├─ MessageRouter.ts
│   ├─ LifecycleManager.ts
│   ├─ EventBus.ts
│   └─ ConfigStore.ts
│
├─ agent/            # Agent 生命周期、Loop、Team、Factory
├─ memory/           # Memory 存储与管理
├─ mcp/              # MCP 客户端、传输、配置、市场
├─ skills/           # Skills 系统
├─ tools/            # 工具注册 + 所有内置工具
├─ provider/         # LLM Provider 适配器
├─ permission/       # 权限系统
├─ platform/         # 平台适配器
├─ session/          # 会话管理
├─ i18n/             # 国际化
├─ shared/           # 跨域共享类型和工具函数
└─ infrastructure/   # 中间件、日志、遥测
```

### 核心规则

1. 依赖方向：`Plugin → Engine`，禁止 `Engine → Plugin` 直接引用
2. 域间通信：只能通过 `MessageRouter` 或 `EventBus`
3. 每个域一个 `index.ts` 导出公共接口

## Plugin 接口

```typescript
interface Plugin<T = unknown> {
  id: string;
  version: string;
  dependencies: string[];

  init(ctx: PluginContext): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;

  getCapabilities(): T;
}
```

## MessageRouter 通信

```typescript
router.registerHandler('memory:query', MemoryQueryHandler);
const result = await ctx.router.dispatch('memory:query', { key: 'user_role' });
```

消息名约定：`{domain}:{action}`。

## 依赖蓝图

```
agent     → memory, tools, provider, session
memory    → (none)
mcp       → tools, permission
skills    → tools
tools     → permission
provider  → (none)
permission → (none)
platform  → provider
session   → memory
```

启动时 `LifecycleManager` 按拓扑排序依次初始化，自动检测循环依赖。

## 迁移计划

### Phase 1 — 奠基（2-3 天）

抽取 Engine 层：`PluginRegistry`、`MessageRouter`、`LifecycleManager`。

### Phase 2 — 拆域（5-7 天）

按依赖拓扑顺序搬迁，每搬一个域验证一次：

| 顺序 | 域 | 理由 |
|------|-----|------|
| 1 | `shared` | 零依赖 |
| 2 | `i18n` | 零业务依赖 |
| 3 | `tools` | `ToolRegistry` 泛化后立即验证 |
| 4 | `provider` | 被 Agent 依赖，无其他域依赖 |
| 5 | `permission` | 被 tools/mcp 依赖 |
| 6 | `session` | 依赖 memory |
| 7 | `memory` | 3255 行的 MemoryManager 切接口 |
| 8 | `agent` | TeamManager + AgentFactory |
| 9 | `mcp` | MCPClient + Market + Search |
| 10 | `skills` / `platform` | 最后叶子域 |

### Phase 3 — 收割（2-3 天）

- `agent-bridge.ts` 换用 `LifecycleManager` 启动
- 删除 `src/core/` 旧目录
- 全量 typecheck + 测试
- Electron 打包验证

## 验收标准

- `npx tsc --noEmit` 通过
- `npm test` 全量通过
- Electron 打包可正常启动
- 每个域 `index.ts` 只导出公共接口，内部实现不暴露
- `src/core/` 目录不再存在
