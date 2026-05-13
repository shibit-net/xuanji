# Session 初始化：新版状态机架构设计

## 1. 问题背景

`feature/refactor-state-machine` 分支的状态机驱动架构改造中，旧版 `EventBridge.ts` 的 `initEventBridge()` 被替换为 `EventAdapter.ts` 的 `registerEventAdapter()`，但 **`agentInit()` 调用被遗漏**，导致 ChatSession 子进程从未启动。

### 影响链路

```
MainPage 挂载 → registerEventAdapter() → 只注册了事件监听，未初始化 session
                                              ↓
用户输入消息 → agent:user-action IPC → isSessionReady() 返回 false
                                              ↓
                            返回 { success: false, error: "会话未初始化" }
                                              ↓
                            Agent 从未执行，用户看不到任何反馈
```

### 受影响的 IPC 处理器

所有依赖 `isSessionReady()` 的 handler 全部失效：
- `agent:user-action` — 发送消息（用户直接感知）
- `settings:get-config` / `settings:get-full-config` — 配置加载
- `agent:list` / `agent:get` — Agent 管理
- `session:*` / `checkpoint:*` — 会话持久化

## 2. 设计目标

1. **不恢复旧方案**：不使用 `initEventBridge()` 的 fire-and-forget 模式
2. **融入新架构**：遵循 Zustand Store + `transition(event)` + EventAdapter 桥接的设计模式
3. **可观测**：Session 初始化状态被追踪，UI 能响应式展示进度和失败
4. **可恢复**：初始化失败后可自动重试（主进程 exponential backoff）和手动重试（UI）
5. **防御性 UX**：Session 未就绪时发送按钮禁用，点击发送有 toast 反馈

## 3. IPC 路由机制确认

在讨论架构之前，先确认主进程到 renderer 的事件路由是可行的。

### 3.1 现有路由机制

```
子进程 channel.send('agent:text', data)
  → MessageChannel.handleMessage() → emit('message', msg)
  → EnhancedMessageChannel 构造函数 'message' 监听器                (EnhancedMessageBus.ts:42-54)
  → mainWindow.webContents.send('agent:text', data)
  → Electron IPC
  → renderer ipcRenderer.on('agent:text', handler)
  → messageBus.on() → registerIpcListener() → window.electron.on()  (MessageBus.ts:66-77)
  → EventAdapter handler
```

### 3.2 主进程直接发送

```typescript
// 主进程 (agent/index.ts)
mainWindow.webContents.send('session:init-start');
// → Electron IPC
// → renderer ipcRenderer.on('session:init-start', handler)
// → messageBus.dispatch('session:init-start', data)
// → 所有 messageBus.on('session:init-start', fn) 回调
```

**结论**：主进程通过 `mainWindow.webContents.send()` 发出的任意事件，只要 renderer 侧有对应的 `messageBus.on()` 监听，就能被捕获。`session:init-*` 事件不需要走子进程 channel.send 路径。

### 3.3 现有主进程直接发送事件的案例

| 事件 | 发出位置 | renderer 接收方式 |
|------|---------|-----------------|
| `auth:session-expired` | `main/index.ts:84-89` | preload.ts 专用 API `onAuthSessionExpired` |
| `agent:crash` | `agent/index.ts:222-226` | **当前无 renderer 监听**（本次补上） |
| `download:event` | `agent/index.ts:248` | DownloadQueue.tsx `window.electron.on()` |

## 4. 架构概览

三层设计，遵循现有 EventAdapter → Store → Component 模式：

```
MainPage mount
  → registerEventAdapter() → 注册全部事件监听器（包括 session 生命周期）
                            → 调用 SessionInitStore.triggerInit()
                                 → window.electron.agentInit()
                                      → [main] initChatSession()
                                          ├─ webContents.send('session:init-start')
                                          ├─ spawn 子进程 → send 'init'
                                          ├─ [child] handleInit() → SessionFactory.create()
                                          ├─ [child] send 'init-complete'
                                          ├─ [main] sessionReady = true
                                          └─ webContents.send('session:init-complete')
                                          ── 或失败 ──
                                          └─ webContents.send('session:init-failed', { error })
                                          ── 子进程意外退出 ──
                                          ├─ 主进程 auto-restart (exponential backoff)
                                          ├─ webContents.send('session:init-restarting')
                                          └─ 超过上限 → webContents.send('agent:crash')

EventAdapter:
  messageBus.on('session:init-start')     → SessionInitStore.transition({ INIT_START })
  messageBus.on('session:init-complete')  → SessionInitStore.transition({ INIT_COMPLETE })
  messageBus.on('session:init-failed')    → SessionInitStore.transition({ INIT_FAILED })
  messageBus.on('session:init-restarting') → SessionInitStore.transition({ INIT_RESTARTING })
  messageBus.on('agent:crash')            → SessionInitStore.transition({ CHILD_CRASH })
                                             + 清理 ConversationStore/AgentStateMachine/messageStore

UI:
  uninitialized/initializing → 禁用发送，状态栏蓝色 spinner "正在初始化会话..."
  ready                      → 正常交互
  failed                     → 禁用发送，状态栏红色 "初始化失败" + 重试按钮
```

## 5. 状态机设计

### 5.1 状态定义

| 状态 | 含义 |
|------|------|
| `uninitialized` | 尚未触发初始化 |
| `initializing` | 子进程正在启动/重启中，等待 init-complete |
| `ready` | 子进程就绪，可正常通信 |
| `failed` | 初始化失败或崩溃超过主进程重试上限 |

### 5.2 事件定义

```typescript
type InitEvent =
  | { type: 'INIT_START' }       // triggerInit() 调用时本地发出
  | { type: 'INIT_COMPLETE' }    // IPC: session:init-complete
  | { type: 'INIT_FAILED'; error: string }  // IPC: session:init-failed
  | { type: 'INIT_RESTARTING' }  // IPC: session:init-restarting（主进程 auto-restart）
  | { type: 'CHILD_CRASH'; message: string } // IPC: agent:crash（重试耗尽）
  | { type: 'RETRY' };           // 用户点击重试按钮
```

### 5.3 状态转换表

| 当前状态 | 事件 | 下一状态 | 说明 |
|---------|------|---------|------|
| uninitialized | INIT_START | initializing | 首次触发初始化 |
| failed | INIT_START | initializing | 重试触发初始化 |
| initializing | INIT_COMPLETE | ready | 子进程就绪 |
| initializing | INIT_FAILED | failed | initChatSession 异常 |
| initializing | INIT_RESTARTING | initializing | 子进程意外退出，主进程正在 auto-restart |
| ready | INIT_RESTARTING | initializing | 运行中子进程崩溃，进入重启等待 |
| initializing | CHILD_CRASH | failed | 主进程重试耗尽 |
| ready | CHILD_CRASH | failed | 运行时崩溃且重试耗尽 |
| failed | RETRY | initializing | 用户手动重试，调用 triggerInit() |

**关键设计决策**：前端不维护 retryCount。主进程负责 exponential backoff 重试（`agent/index.ts:209-217`），前端只根据 IPC 事件被动切换状态：
- 收到 `session:init-restarting` → 保持/进入 `initializing`，UI 显示"重新连接中..."
- 收到 `agent:crash` → 进入 `failed`，UI 显示"服务不可用" + 重试按钮

## 6. 详细实现

### 6.1 新建 `desktop/renderer/stores/SessionInitStore.ts`

```typescript
import { create } from 'zustand';

export type InitStatus = 'uninitialized' | 'initializing' | 'ready' | 'failed';

export type InitEvent =
  | { type: 'INIT_START' }
  | { type: 'INIT_COMPLETE' }
  | { type: 'INIT_FAILED'; error: string }
  | { type: 'INIT_RESTARTING' }
  | { type: 'CHILD_CRASH'; message: string }
  | { type: 'RETRY' };

interface SessionInitState {
  status: InitStatus;
  error: string | null;

  transition: (event: InitEvent) => void;
  triggerInit: () => Promise<void>;
  retry: () => void;
  isReady: () => boolean;
  resetAllStores: () => void;
}

export const useSessionInitStore = create<SessionInitState>((set, get) => ({
  status: 'uninitialized',
  error: null,

  transition: (event) => {
    const { status } = get();
    switch (event.type) {
      case 'INIT_START':
        // triggerInit() 入口层已拒绝 initializing/ready 态，这里直接设置
        set({ status: 'initializing', error: null });
        break;

      case 'INIT_COMPLETE':
        set({ status: 'ready', error: null });
        break;

      case 'INIT_FAILED':
        set({ status: 'failed', error: event.error });
        break;

      case 'INIT_RESTARTING':
        // 子进程意外退出，主进程正在 auto-restart
        // 保持 initializing 状态，UI 显示重连提示
        set({ status: 'initializing' });
        break;

      case 'CHILD_CRASH':
        // 主进程重试耗尽，进入不可恢复的失败状态
        set({ status: 'failed', error: event.message });
        // 子进程已死，清理所有运行时状态
        get().resetAllStores();
        break;

      case 'RETRY':
        if (status === 'failed') {
          set({ status: 'initializing', error: null });
          get().triggerInit();
        }
        break;
    }
  },

  triggerInit: async () => {
    // 入口层 guard：已初始化或正在初始化时直接返回
    if (get().status === 'initializing' || get().status === 'ready') return;

    get().transition({ type: 'INIT_START' });
    try {
      const result = await window.electron.agentInit();
      if (result.success) {
        get().transition({ type: 'INIT_COMPLETE' });
        // 同步 model 名称到 messageStore
        if (result.config?.model) {
          const { useMessageStore } = await import('./messageStore');
          useMessageStore.setState((s) => ({
            stats: { ...s.stats, model: result.config.model },
          }));
        }
      } else {
        get().transition({ type: 'INIT_FAILED', error: result.error || '初始化失败' });
      }
    } catch (err) {
      get().transition({
        type: 'INIT_FAILED',
        error: err instanceof Error ? err.message : '初始化异常',
      });
    }
  },

  retry: () => {
    get().transition({ type: 'RETRY' });
  },

  isReady: () => get().status === 'ready',

  /** 子进程崩溃后清理所有依赖 session 的 store 状态 */
  resetAllStores: async () => {
    const { useConversationStore } = await import('./ConversationStore');
    const { useAgentStateMachine } = await import('./AgentStateMachine');
    const { useMessageStore } = await import('./messageStore');
    const { useAsyncTaskStore } = await import('./AsyncTaskStore');

    useConversationStore.getState().onAgentCompleted();
    // 直接清空所有 agent（含 thinking/executing/writing 等非终态）
    useAgentStateMachine.getState().clearAll();
    // messageStore 重置流式气泡和 toolCalls
    useMessageStore.getState().finishStreaming();
    // AsyncTaskStore 清理所有任务
    const taskStore = useAsyncTaskStore.getState();
    for (const taskId of Object.keys(taskStore.tasks)) {
      taskStore.transition({ type: 'TASK_CLEARED', taskId });
    }
  },
}));
```

**与旧方案的对比**：

| 方面 | 旧 initEventBridge | 新 SessionInitStore |
|------|-------------------|-------------------|
| 状态可观测 | fire-and-forget，无状态追踪 | `status` 字段，UI 响应式订阅 |
| 失败处理 | 静默 `.catch(() => {})` | `failed` 状态 + 重试按钮 |
| 崩溃处理 | 无 | 监听 `agent:crash`，清理所有 store |
| 架构一致性 | 游离在 store 体系外 | transition(event) 模式，与 AgentStateMachine 一致 |

### 6.2 修改 `desktop/main/agent/index.ts` — 发出生命周期 IPC 事件

在 `initChatSession()` 中增加事件发出：

```typescript
// 函数开头：通知 renderer 初始化开始
const mainWindow = getMainWindow();
mainWindow?.webContents.send('session:init-start');

// agentChannel.on('init-complete', ...) 回调中（第 258 行附近）：
sessionReady = true;
mainWindow?.webContents.send('session:init-complete');

// catch 块中（第 299 行附近），重新抛出前：
mainWindow?.webContents.send('session:init-failed', {
  error: err instanceof Error ? err.message : String(err)
});

// agentProcess.on('exit', ...) 中（第 199 行附近），非清理退出时：
if (!isCleaningUp && restartAttempts < MAX_RESTART_ATTEMPTS) {
  // 主进程即将 auto-restart，通知 renderer
  mainWindow?.webContents.send('session:init-restarting', {
    attempt: restartAttempts + 1,
    maxAttempts: MAX_RESTART_ATTEMPTS,
  });
}
// agent:crash 事件已经存在（第 222 行），不需要新增
```

**事件发出位置总结**：

| 事件 | 发出时机 | 发出位置 |
|------|---------|---------|
| `session:init-start` | 首次初始化开始 | initChatSession() 开头 |
| `session:init-complete` | 子进程就绪 | agentChannel.on('init-complete') 回调 |
| `session:init-failed` | initChatSession 异常 | catch 块 |
| `session:init-restarting` | 子进程意外退出，即将 auto-restart | agentProcess.on('exit') |
| `agent:crash` | 重试耗尽 | **已有**，agent/index.ts:222 |

### 6.3 修改 `desktop/renderer/services/EventAdapter.ts` — 桥接 session 事件

在 `registerEventAdapter()` 中新增 section：

```typescript
import { useSessionInitStore } from '../stores/SessionInitStore';

// ============================================================
// SessionInitStore — session 生命周期
// ============================================================

messageBus.on('session:init-start', () => {
  useSessionInitStore.getState().transition({ type: 'INIT_START' });
});

messageBus.on('session:init-complete', () => {
  useSessionInitStore.getState().transition({ type: 'INIT_COMPLETE' });
});

messageBus.on('session:init-failed', (data: { error: string }) => {
  useSessionInitStore.getState().transition({ type: 'INIT_FAILED', error: data.error });
});

messageBus.on('session:init-restarting', () => {
  useSessionInitStore.getState().transition({ type: 'INIT_RESTARTING' });
});

messageBus.on('agent:crash', (data: { message: string }) => {
  // resetAllStores() 在 transition() 内部自动调用
  useSessionInitStore.getState().transition({ type: 'CHILD_CRASH', message: data.message });
});
```

**时序保障**：`registerEventAdapter()` 在注册完所有 `messageBus.on()` 监听器后，立即调用 `triggerInit()`：

```typescript
export function registerEventAdapter(): void {
  if (registered) return;
  registered = true;

  // ... 所有 messageBus.on() 注册（包括上面的 session 事件）...

  // 所有监听器就绪后，触发初始化
  // 此时即使 init 极快完成，IPC 事件也能被已注册的 handler 捕获
  useSessionInitStore.getState().triggerInit();
}
```

### 6.4 修改 `desktop/renderer/pages/MainPage.tsx` — 状态栏指示器

移除独立的 `triggerInit()` useEffect，因为已在 `registerEventAdapter()` 内部调用。只新增状态栏指示器：

```typescript
import { useSessionInitStore } from '../stores/SessionInitStore';

export default function MainPage() {
  // 现有：注册事件桥接 + 触发 session 初始化
  React.useEffect(() => {
    registerEventAdapter();  // 内部调用 triggerInit()
  }, []);

  const sessionStatus = useSessionInitStore((s) => s.status);

  // ... 现有代码 ...

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-[2] min-w-0 min-h-0 flex flex-col overflow-hidden">
        {/* 全局状态栏 */}
        <div className="flex-shrink-0 flex items-center gap-4 px-4 py-1.5 border-b border-border bg-white/[0.02]">
          {/* 新增：Session 初始化状态指示器 */}
          {sessionStatus !== 'ready' && (
            <div className="flex items-center gap-1.5 text-[11px]">
              {sessionStatus === 'initializing' ? (
                <>
                  <Loader2 size={12} className="animate-spin text-blue-400" />
                  <span className="text-blue-400">正在初始化会话...</span>
                </>
              ) : sessionStatus === 'failed' ? (
                <>
                  <span className="text-red-400">会话不可用</span>
                  <button
                    onClick={() => useSessionInitStore.getState().retry()}
                    className="text-blue-400 hover:underline"
                  >
                    重试
                  </button>
                </>
              ) : null}
            </div>
          )}
          {/* 现有：iteration + token 统计 */}
          ...
        </div>
        <ChatArea />
        <TodoPanel />
        <InputArea />
      </div>
    </div>
  );
}
```

### 6.5 修改 `desktop/renderer/components/InputArea.tsx` — 会话感知 UX

```typescript
import { useSessionInitStore } from '../stores/SessionInitStore';

export default function InputArea() {
  // 新增：读取 session 状态
  const sessionStatus = useSessionInitStore((s) => s.status);
  const sessionError = useSessionInitStore((s) => s.error);
  const isSessionReady = useSessionInitStore((s) => s.isReady());

  const toast = useToast();

  // ... 现有状态读取 ...

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isSending) return;

    // 新增：session 未就绪时的 UX 反馈
    if (!isSessionReady) {
      const store = useSessionInitStore.getState();
      if (store.status === 'uninitialized' || store.status === 'failed') {
        store.triggerInit();
        toast.info('正在连接服务，请稍后重试...');
      } else if (store.status === 'initializing') {
        toast.info('服务正在初始化中，请稍候...');
      }
      return;
    }

    // ... 现有发送逻辑保持不变 ...
  }, [input, isSending, isSessionReady, toast]);

  // 新增：session 未就绪时按钮禁用
  const isSendDisabled = !input.trim() || isSending || !isSessionReady;

  // 新增：根据 session 状态调整 placeholder
  const placeholder = !isSessionReady
    ? sessionStatus === 'initializing' ? '会话初始化中...'
      : sessionStatus === 'failed' ? `服务不可用: ${sessionError || '请点击重试'}`
      : '正在连接服务...'
    : isAutoSummarizing ? '说点什么... (后台汇总中)'
    : isRunning ? '说点什么... (工作执行中，消息将自动排队)'
    : runningTaskCount > 0 ? '说点什么... (后台任务运行中)'
    : '说点什么...';

  // ... 其余不变 ...
}
```

### 6.6 修改 `desktop/renderer/stores/index.ts`

```typescript
export { useSessionInitStore } from './SessionInitStore';
```

## 7. 完整消息发送流程（改造后）

```
MainPage mount
  → registerEventAdapter()
      → 注册所有 messageBus.on() 监听器（含 session 生命周期）
      → SessionInitStore.triggerInit()
           → agentInit() IPC → initChatSession() spawn 子进程
                                  ↓
           session:init-start → INIT_START → status='initializing'
           session:init-complete → INIT_COMPLETE → status='ready'
                                  ↓
                           UI 响应式启用发送按钮

用户点击发送
  ↓
InputArea.handleSubmit()
  ├─ !isSessionReady → triggerInit()/toast + return（按钮本已禁用，双层防御）
  └─ isSessionReady → agentUserAction({ SEND_MESSAGE })
                           ↓
                     [main] isSessionReady()=true → sendRequest('user-action')
                           ↓
                     [child] handleUserAction()
                       → intentRouter.route(message)
                       → session.userAction(data)
                           ↓
                     SessionStateMachine.transition(USER_MESSAGE)
                       → RUN_AGENT → ChatSession.run(message)
                           ↓
                     agent:started → ConversationStore.onAgentStarted()
                     agent:text    → messageStore + AgentStateMachine
                     agent:tool-*  → AgentStateMachine
                     agent:end     → ConversationStore.onAgentCompleted()

── 运行时子进程崩溃 ──
  [main] agentProcess.on('exit') → auto-restart
    → webContents.send('session:init-restarting')
         ↓
    EventAdapter → SessionInitStore.transition({ INIT_RESTARTING })
         ↓
    status='initializing'，UI 显示"重新连接中..."

  重试成功:
    → webContents.send('session:init-complete')
    → status='ready'，正常恢复

  重试耗尽:
    → webContents.send('agent:crash')（已有）
    → SessionInitStore.transition({ CHILD_CRASH })
        → status='failed' + resetAllStores()
        → ConversationStore.onAgentCompleted()
        → AgentStateMachine.clearAll()
        → messageStore.finishStreaming()
        → AsyncTaskStore 全部 TASK_CLEARED
```

## 8. 不改动的文件

| 文件 | 原因 |
|------|------|
| `ConversationStore.ts` | 会话状态（idle/executing/outputting）和初始化状态（uninitialized/ready）是正交关注点 |
| `AgentStateMachine.ts` | Agent 生命周期管理正确，只在 session 就绪后才被驱动 |
| `agent-bridge.ts` | 子进程侧 `handleInit` 逻辑完整，只缺 renderer 侧的触发 |
| `desktop/main/ipc/agent.ts` | IPC handler 逻辑正确，`agent:init` 和 `agent:user-action` 均复用 |

## 9. 改动文件汇总

| 文件 | 改动类型 | 改动量 |
|------|---------|--------|
| `desktop/renderer/stores/SessionInitStore.ts` | **新建** | ~100 行 |
| `desktop/main/agent/index.ts` | 修改 | +4 处 `webContents.send()` 调用 |
| `desktop/renderer/services/EventAdapter.ts` | 修改 | +5 个 `messageBus.on()` + 末尾调用 `triggerInit()` |
| `desktop/renderer/pages/MainPage.tsx` | 修改 | +状态栏指示器 (~12 行)，移除独立 useEffect |
| `desktop/renderer/components/InputArea.tsx` | 修改 | +session 状态读取 + toast + 按钮/placeholder 适配 |
| `desktop/renderer/stores/index.ts` | 修改 | +1 行 export |

## 10. 验证步骤

1. **正常初始化**：启动应用 → 状态栏蓝色 spinner "正在初始化会话..." → 完成后消失，输入框可编辑
2. **发送消息**：输入消息 → Agent 正常执行（thinking → text → tool → end）
3. **初始化中发送**：断点延迟 init → 按钮灰色禁用 → placeholder 显示"会话初始化中..." → 点击发送时 toast 提示"服务正在初始化中"
4. **初始化失败**：模拟 `initChatSession()` 抛错 → 状态栏红色 "会话不可用" + 重试按钮 → 点击重试恢复
5. **运行时崩溃**：`kill -9` 子进程 → UI 显示"重新连接中..." → 主进程 auto-restart → 恢复后正常 / 3 次失败后显示"会话不可用" + 重试按钮
6. **crash 后 store 清理**：运行时崩溃 → ConversationStore 回 idle → AgentStateMachine 清理节点 → messageStore 结束流式 → AsyncTaskStore 清理 tasks
