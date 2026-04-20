# Xuanji GUI 启动流程详解

## 一、应用启动阶段

### 1. Electron 主进程启动 (`desktop/main/index.ts`)

```
app.whenReady()
  ↓
1. loadAuthState() - 加载本地保存的认证状态
   - 从 ~/.xuanji/auth/current-auth.enc 读取加密的 token
   - 恢复 authState (accessToken, refreshToken, user)
   - 同步 token 到 Electron Session Cookies
  ↓
2. setAuthState(authState) - 设置到内存
  ↓
3. registerAllIpcHandlers() - 注册所有 IPC 处理器
   - auth IPC handlers (登录、登出、检查认证)
   - agent IPC handlers (发送消息、中断、重置)
   - advanced IPC handlers (会话管理、记忆管理等)
  ↓
4. createWindow() - 创建主窗口
   - 加载 renderer 进程 (React 应用)
  ↓
5. 注意：此时 ChatSession 尚未初始化
   - 会话初始化延迟到用户登录后
```

---

## 二、渲染进程启动阶段

### 1. React 应用启动 (`desktop/renderer/App.tsx`)

```
App 组件渲染
  ↓
HashRouter + Suspense
  ↓
AuthCheck 组件
  ↓
useEffect(() => checkAuth())
  ↓
调用 authStore.checkAuth()
```

### 2. 认证检查 (`desktop/renderer/stores/authStore.ts`)

```typescript
checkAuth: async () => {
  set({ isLoading: true });
  
  // 调用主进程检查认证状态
  const result = await window.electron.authCheck();
  
  if (result.success && result.data) {
    // 已登录
    set({
      isAuthenticated: true,
      user: result.data,
      isLoading: false
    });
  } else {
    // 未登录
    set({
      isAuthenticated: false,
      user: null,
      isLoading: false
    });
  }
}
```

### 3. 根据认证状态渲染

```
isLoading = true
  → 显示 LoadingScreen (加载中...)

isAuthenticated = false
  → 显示 LoginPage (登录页面)

isAuthenticated = true
  → 显示 MainLayout + MainPage (主应用界面)
```

---

## 三、用户登录流程

### 1. 用户输入账号密码，点击登录

```
LoginPage
  ↓
authStore.login(email, password)
  ↓
window.electron.authLogin(email, password)
  ↓
IPC 调用主进程 'auth:login'
```

### 2. 主进程处理登录 (`desktop/main/ipc/auth.ts`)

```typescript
ipcMain.handle('auth:login', async (_event, email, password) => {
  // 1. 清除旧的认证信息
  await clearAuthState();
  await session.defaultSession.clearStorageData({ storages: ['cookies'] });
  
  // 2. 调用后端登录 API
  const result = await authService.login({ email, password });
  
  if (result.success) {
    // 3. 同步 Cookie (从 apiClient 同步到 authState)
    await syncCookiesFromClient();
    
    // 4. 设置用户信息
    setAuthState({ user: result.data });
    
    // 5. 保存认证状态到本地
    await saveAuthState();
    // 保存到 ~/.xuanji/auth/current-auth.enc (加密)
    
    // 6. 初始化用户配置
    await initializeUserConfig(result.data.userId);
    // 从模板复制配置到 .xuanji/users/{userId}/
    
    // 7. 触发启动流程
    triggerStartup();
    
    return { success: true, data: user };
  }
});
```

---

## 四、ChatSession 初始化流程

### 1. triggerStartup() (`desktop/main/agent/index.ts`)

```typescript
function triggerStartup() {
  if (!agentProcess || !sessionReady) {
    console.warn('⚠️ ChatSession 未就绪，无法触发启动消息');
    return;
  }
  
  console.log('🚀 触发启动消息...');
  agentProcess.send({ type: 'trigger-startup' });
}
```

**问题：此时 agentProcess 还未创建！**

### 2. initChatSession() - 创建 Agent 子进程

```typescript
async function initChatSession(): Promise<boolean> {
  // 1. 检查用户是否登录
  const authState = getAuthState();
  if (!authState?.user?.userId) {
    console.warn('⚠️ 用户未登录，无法初始化会话');
    return false;
  }
  
  const userId = authState.user.userId;
  
  // 2. 启动 Node.js 子进程运行 agent-bridge.ts
  const nodePath = findNodePath();
  const scriptPath = 'desktop/main/agent-bridge.ts';
  
  agentProcess = spawn(nodePath, [tsxPath, scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });
  
  // 3. 创建消息通道
  const agentChannel = messageBus.createChannel('agent');
  agentChannel.attach(agentProcess);
  
  // 4. 监听子进程就绪
  agentChannel.once('child-ready', () => {
    console.log('[Agent] 子进程已就绪');
  });
  
  // 5. 监听初始化完成
  agentChannel.on('init-complete', (data) => {
    if (data.success) {
      sessionReady = true;
      console.log('[Agent] Session 初始化完成');
    }
  });
  
  // 6. 发送 init 消息触发子进程初始化
  agentChannel.send('init', { userId });
  
  // 7. 等待初始化完成
  await waitForSessionReady();
  
  return true;
}
```

---

## 五、Agent 子进程初始化 (`desktop/main/agent-bridge.ts`)

### 1. 子进程启动

```typescript
// 创建子进程消息通道
const channel = new ChildMessageChannel({ name: 'agent-child' });

// 通知主进程子进程已启动
channel.send('child-ready', { pid: process.pid });

// 注册消息处理器
channel.handle('init', async (data) => {
  return await handleInit(data?.userId);
});
```

### 2. handleInit(userId) - 初始化 ChatSession

```typescript
async function handleInit(userId?: string) {
  // 1. 验证用户登录
  if (!userId) {
    return { success: false, error: '用户未登录' };
  }
  
  console.log(`[agent-bridge] 初始化会话，用户: ${userId}`);
  
  // 2. 创建 SessionFactory
  const agentId = 'xuanji'; // 默认使用 xuanji agent
  const factory = new SessionFactory(userId, agentId);
  
  // 3. 创建 ChatSession
  session = await factory.create({
    userId,
    agentId,
    callbacks: {
      onBootThinking: () => { /* 启动引导：思考状态 */ },
      onBootGuide: (message) => { /* 启动引导消息 */ },
      onMessagesRestored: (messages) => { /* 恢复消息历史 */ },
    }
  });
  
  // 4. 注册流式事件回调
  registerSessionCallbacks(session);
  
  // 5. 注入权限交互 Handler
  injectInteractionHandlers();
  
  // 6. 注册 Hook 事件监听
  const hookRegistry = session.getContainer().resolveSync('hookRegistry');
  registerHookListeners(hookRegistry);
  
  // 7. 发送初始化完成事件
  safeSend({ type: 'init-complete', data: { success: true } });
  
  return { success: true };
}
```

### 3. SessionFactory.create() - 创建会话

```typescript
async create(options: SessionOptions): Promise<ChatSession> {
  const userId = options.userId;
  const agentId = options.agentId || 'xuanji';
  
  // 1. 加载配置
  const config = await this.loadConfig({ userId, agentId });
  // ConfigLoader(userId, agentId).load()
  //   → 加载默认配置
  //   → 加载用户配置 (.xuanji/users/{userId}/config.json)
  //   → 加载 Agent 配置 (.xuanji/users/{userId}/agents/{agentId}.json5)
  //   → 加载 MCP 配置
  
  this.container.registerSingleton('config', config);
  
  // 2. 初始化基础设施
  await this.initInfrastructure(config, options, userId);
  //   → SessionManager
  //   → HookRegistry
  //   → AgentRegistry (加载所有 agent 配置)
  //   → SkillRegistry (加载所有 skill)
  
  // 3. 初始化领域服务
  await this.initDomainServices(config, options);
  //   → Provider (根据 config.provider 创建 AnthropicProvider/OpenAIProvider)
  //   → ToolRegistry (注册所有基础工具)
  //   → MemoryManager (初始化记忆系统)
  //   → PermissionController (权限控制)
  
  // 4. 初始化应用服务
  await this.initApplicationServices(config, options);
  //   → AgentLoop (Agent 循环引擎)
  //   → SkillRouter (技能路由)
  //   → PromptOrchestrator (提示词编排)
  //   → TurnLifecycleManager (回合生命周期管理)
  
  // 5. 注册高级工具
  await this.registerAdvancedTools(config);
  //   → TaskTool (子任务工具)
  //   → TeamTool (团队协作工具)
  //   → ListAgentsTool (列出 agents)
  //   → MatchAgentTool (匹配 agent)
  
  // 6. 创建编排器
  const orchestrator = await this.createOrchestrator(options.callbacks);
  
  // 7. 创建会话
  const session = new ChatSession(orchestrator, this.container);
  
  return session;
}
```

---

## 六、触发启动消息

### 1. 主进程收到 init-complete 事件

```typescript
agentChannel.on('init-complete', (data) => {
  if (data.success) {
    sessionReady = true;
    console.log('[Agent] Session 初始化完成');
  }
});
```

### 2. triggerStartup() 再次被调用

```typescript
function triggerStartup() {
  if (!agentProcess || !sessionReady) {
    return; // 此时已就绪
  }
  
  // 发送 trigger-startup 消息到子进程
  agentProcess.send({ type: 'trigger-startup' });
}
```

### 3. 子进程处理 trigger-startup

```typescript
channel.handle('trigger-startup', async () => {
  return await handleTriggerStartup();
});

async function handleTriggerStartup() {
  if (!session) {
    return;
  }
  
  // 1. 检查是否是新用户
  const config = session.getConfig();
  const isNewUser = !config.onboardingDone;
  
  // 2. 检查是否有记忆
  let hasMemories = false;
  if (!isNewUser) {
    const memoryManager = session.getContainer().resolveSync('memoryManager');
    const stats = await memoryManager.getStats();
    hasMemories = stats ? stats.total > 0 : false;
  }
  
  // 3. 如果是新用户或有记忆，发送启动消息
  if (isNewUser || hasMemories) {
    await handleSendMessage('__startup__');
    // 调用 session.run('__startup__')
    // → AgentLoop 开始执行
    // → 调用 LLM API (使用 Agent 配置的 provider)
    // → 生成欢迎消息或恢复上下文
  }
}
```

---

## 七、配置加载详解

### ConfigLoader.load() 流程

```typescript
async load(): Promise<AppConfig> {
  // 1. 初始化用户配置目录（如果不存在，从模板复制目录结构）
  await new UserConfigInitializer(userId).initialize();
  // 注意：模板只提供目录结构，不提供配置值
  
  // 2. 加载用户配置（必须存在，来自后端）
  const userConfig = await this.loadUserConfig();
  // 读取 .xuanji/users/{userId}/config.json
  // 这个文件是用户登录后从后端获取并保存的
  let config = userConfig as AppConfig;
  
  // 3. 加载 Agent 配置 ⭐ 关键
  const agentConfig = await this.loadAgentConfig(agentId);
  // 读取 .xuanji/users/{userId}/agents/{agentId}.json5
  // 提取 agent.provider 和 agent.model 配置
  // 转换为 AppConfig.provider 格式
  config = deepMerge(config, agentConfig);
  
  // 4. 加载 MCP 配置
  const mcpConfig = await this.loadMCPConfig();
  // 读取 .xuanji/users/{userId}/mcp.json
  config.mcp = mcpConfig;
  
  return config;
}
```

### Agent 配置转换

```typescript
// Agent 配置格式 (.xuanji/users/{userId}/agents/xuanji.json5)
{
  id: 'xuanji',
  name: 'Xuanji',
  
  model: {
    primary: 'claude-sonnet-4-6',
    maxTokens: 64000,
    temperature: 0.7,
    thinking: { type: 'adaptive', effort: 'medium' }
  },
  
  provider: {
    adapter: 'anthropic',
    apiKey: 'sk-xxx',
    baseURL: 'https://aicoding.2233.ai'
  }
}

// 转换为 AppConfig.provider 格式
{
  provider: {
    model: 'claude-sonnet-4-6',        // 从 agent.model.primary
    maxTokens: 64000,                  // 从 agent.model.maxTokens
    temperature: 0.7,                  // 从 agent.model.temperature
    thinking: { ... },                 // 从 agent.model.thinking
    adapter: 'anthropic',              // 从 agent.provider.adapter
    apiKey: 'sk-xxx',                  // 从 agent.provider.apiKey
    baseURL: 'https://aicoding.2233.ai' // 从 agent.provider.baseURL
  }
}
```

---

## 八、Provider 创建流程

### ProviderManager.getProvider()

```typescript
getProvider(agentConfig?: ConfigurableAgentConfig): ILLMProvider {
  // 1. 合并配置（Agent 配置 > 全局配置）
  const mergedConfig = this.mergeProviderConfig(agentConfig);
  // 此时 mergedConfig 已包含 Agent 的 provider 配置
  
  // 2. 根据 adapter 或 model 选择 Provider
  let provider: ILLMProvider;
  
  if (mergedConfig.adapter) {
    provider = this.providerFactory.getByAdapter(mergedConfig.adapter);
    // 'anthropic' → AnthropicProvider
    // 'openai' → OpenAIProvider
  } else if (mergedConfig.model) {
    provider = this.providerFactory.getByModel(mergedConfig.model);
    // 'claude-' → AnthropicProvider
    // 'gpt-' → OpenAIProvider
  }
  
  return provider;
}
```

### AnthropicProvider.stream()

```typescript
async *stream(messages, tools, config: ProviderConfig) {
  // 1. 创建 Anthropic 客户端
  const client = new Anthropic({
    apiKey: config.apiKey,      // 从 Agent 配置
    baseURL: config.baseURL,    // 从 Agent 配置
    timeout: config.timeout
  });
  
  // 2. 构建请求参数
  const params = {
    model: config.model,        // 从 Agent 配置
    max_tokens: config.maxTokens,
    messages: messages,
    tools: tools,
    thinking: config.thinking,  // 从 Agent 配置
    temperature: config.temperature
  };
  
  // 3. 调用 LLM API
  const stream = client.messages.stream(params);
  
  // 4. 流式返回结果
  for await (const event of stream) {
    yield event;
  }
}
```

---

## 九、完整流程时序图

```
用户启动应用
  ↓
Electron 主进程启动
  ↓
加载本地认证状态 (如果有)
  ↓
创建窗口，加载 React 应用
  ↓
React 应用检查认证状态
  ↓
┌─────────────────────────────────────┐
│ 未登录                              │ 已登录
│   ↓                                 │   ↓
│ 显示登录页面                        │ 显示主应用界面
│   ↓                                 │   ↓
│ 用户输入账号密码                    │ (跳过登录流程)
│   ↓                                 │
│ 调用后端登录 API                    │
│   ↓                                 │
│ 保存认证状态到本地                  │
│   ↓                                 │
│ 初始化用户配置目录                  │
│   ↓                                 │
└─────────────────────────────────────┘
  ↓
triggerStartup() 被调用
  ↓
initChatSession() - 创建 Agent 子进程
  ↓
子进程启动，发送 'child-ready'
  ↓
主进程发送 'init' 消息 (带 userId)
  ↓
子进程 handleInit(userId)
  ↓
创建 SessionFactory(userId, agentId='xuanji')
  ↓
SessionFactory.create()
  ↓
ConfigLoader.load()
  ├─ 加载默认配置
  ├─ 加载用户配置
  ├─ 加载 Agent 配置 ⭐
  └─ 加载 MCP 配置
  ↓
初始化基础设施
  ├─ SessionManager
  ├─ HookRegistry
  ├─ AgentRegistry
  └─ SkillRegistry
  ↓
初始化领域服务
  ├─ Provider (使用 Agent 配置) ⭐
  ├─ ToolRegistry
  ├─ MemoryManager
  └─ PermissionController
  ↓
初始化应用服务
  ├─ AgentLoop
  ├─ SkillRouter
  ├─ PromptOrchestrator
  └─ TurnLifecycleManager
  ↓
注册高级工具
  ├─ TaskTool
  ├─ TeamTool
  ├─ ListAgentsTool
  └─ MatchAgentTool
  ↓
创建 ChatSession
  ↓
发送 'init-complete' 到主进程
  ↓
主进程设置 sessionReady = true
  ↓
triggerStartup() 再次被调用
  ↓
发送 'trigger-startup' 到子进程
  ↓
子进程 handleTriggerStartup()
  ↓
检查是否是新用户或有记忆
  ↓
如果是，发送 '__startup__' 消息
  ↓
session.run('__startup__')
  ↓
AgentLoop 开始执行
  ↓
调用 Provider.stream() (使用 Agent 配置的 apiKey/baseURL) ⭐
  ↓
调用 LLM API
  ↓
流式返回结果到前端
  ↓
显示欢迎消息或恢复上下文
  ↓
✅ 启动完成，等待用户输入
```

---

## 十、关键点总结

### 1. 配置优先级
```
默认配置 < 用户配置 < Agent 配置 < 运行时配置
```

### 2. Agent 配置的作用
- **定义 Provider 配置**：model, adapter, apiKey, baseURL
- **定义模型参数**：maxTokens, temperature, thinking
- **定义工具列表**：tools (哪些工具可用)
- **定义系统提示词**：systemPrompt (可选)

### 3. 用户隔离
- 每个用户有独立的配置目录：`.xuanji/users/{userId}/`
- 每个用户有独立的 Agent 配置：`.xuanji/users/{userId}/agents/`
- 每个用户有独立的记忆、会话、权限等数据

### 4. 动态切换 Agent
- 通过传入不同的 `agentId` 即可切换 Agent
- 重新创建 SessionFactory 和 ChatSession
- 使用新 Agent 的配置（model, apiKey, baseURL 等）

### 5. 子进程架构
- Agent 运行在独立的 Node.js 子进程中
- 通过 IPC 消息通道与主进程通信
- 避免 Electron ABI 限制，使用系统 Node.js 加载 native 模块

---

## 十一、常见问题

### Q1: 为什么要延迟初始化 ChatSession？
**A:** 因为需要用户登录后才能获取 userId，才能加载用户配置和 Agent 配置。

### Q2: 为什么要使用子进程？
**A:** 
- 避免 Electron 的 Node.js ABI 限制
- better-sqlite3 等 native 模块需要系统 Node.js
- 隔离 Agent 运行环境，提高稳定性

### Q3: Agent 配置如何覆盖用户配置？
**A:** 通过 `deepMergeConfig` 深度合并，后者覆盖前者。

### Q4: 如何切换到不同的 Agent？
**A:** 
```typescript
// 方法 1: 创建新的 SessionFactory
const factory = new SessionFactory(userId, 'coder');
const session = await factory.create();

// 方法 2: 传入 options
const factory = new SessionFactory(userId);
const session = await factory.create({ agentId: 'coder' });
```

### Q5: 启动消息 '__startup__' 的作用？
**A:** 
- 新用户：显示欢迎消息和引导
- 老用户：恢复上下文，显示记忆摘要
- 触发 LLM 生成第一条消息

---

## 十二、文件路径参考

```
xuanji/
├── desktop/
│   ├── main/
│   │   ├── index.ts                    # Electron 主进程入口
│   │   ├── agent/
│   │   │   └── index.ts                # Agent 子进程管理
│   │   ├── agent-bridge.ts             # Agent 子进程桥接
│   │   ├── config/
│   │   │   └── auth.ts                 # 认证状态管理
│   │   └── ipc/
│   │       ├── auth.ts                 # 认证 IPC 处理器
│   │       └── agent.ts                # Agent IPC 处理器
│   └── renderer/
│       ├── App.tsx                     # React 应用入口
│       └── stores/
│           └── authStore.ts            # 认证状态 Store
├── src/
│   ├── core/
│   │   ├── chat/
│   │   │   ├── SessionFactory.ts       # 会话工厂
│   │   │   └── ChatSession.ts          # 聊天会话
│   │   ├── config/
│   │   │   ├── ConfigLoader.ts         # 配置加载器 ⭐
│   │   │   ├── PathManager.ts          # 路径管理
│   │   │   └── UserConfigInitializer.ts # 用户配置初始化
│   │   ├── providers/
│   │   │   ├── ProviderManager.ts      # Provider 管理器
│   │   │   └── AnthropicProvider.ts    # Anthropic Provider
│   │   └── templates/                  # 配置模板
│   │       ├── config.json
│   │       └── agents/
│   │           └── xuanji.json5
│   └── shared/
│       └── types/
│           └── config.ts               # 配置类型定义
└── .xuanji/                            # 用户数据目录
    └── users/
        └── {userId}/
            ├── config.json             # 用户配置
            ├── agents/                 # Agent 配置目录 ⭐
            │   ├── xuanji.json5
            │   ├── coder.json5
            │   └── ...
            ├── memory/                 # 记忆数据
            ├── sessions/               # 会话历史
            └── permissions/            # 权限决策
```
