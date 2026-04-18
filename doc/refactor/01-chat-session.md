# ChatSession 重构方案

## 一、现状分析

### 当前职责（过重）
```typescript
class ChatSession {
  // 1. 依赖初始化
  private provider: ILLMProvider;
  private registry: IToolRegistry;
  private memoryManager: IMemoryStore;
  private permissionController: IPermissionController;
  private sessionManager: SessionManager;
  private hookRegistry: HookRegistry;
  // ... 10+ 个依赖

  // 2. 生命周期管理
  async init(): Promise<void>
  async run(input: string): Promise<void>
  async stop(): Promise<void>

  // 3. Skill 路由
  private skillRouter: SkillRouter;

  // 4. Prompt 编排
  private promptOrchestrator: PromptOrchestrator;

  // 5. 轮次管理
  private turnManager: TurnLifecycleManager;

  // 6. 系统诊断
  private diagnostics: SystemDiagnostics;
}
```

### 问题
1. **职责过多**：初始化、编排、路由、生命周期全在一个类
2. **依赖混乱**：10+ 个依赖，构造函数参数过多
3. **难以测试**：Mock 依赖困难
4. **难以扩展**：新增功能需要修改核心类

---

## 二、重构目标

### 新架构设计

```typescript
// 1. 依赖容器（统一管理依赖注入）
class DependencyContainer {
  private services = new Map<string, any>();
  
  register<T>(key: string, factory: () => T): void;
  resolve<T>(key: string): T;
  registerSingleton<T>(key: string, instance: T): void;
}

// 2. 会话编排器（核心流程控制）
class SessionOrchestrator {
  constructor(
    private agentLoop: AgentLoop,
    private skillRouter: SkillRouter,
    private turnManager: TurnLifecycleManager
  ) {}
  
  async execute(input: string): Promise<void> {
    // 1. Skill 路由判断
    const skillMatch = await this.skillRouter.match(input);
    if (skillMatch) {
      await this.skillRouter.execute(skillMatch);
      return;
    }
    
    // 2. AgentLoop 执行
    await this.agentLoop.run(input);
    
    // 3. 轮次后处理
    await this.turnManager.afterTurn();
  }
}

// 3. 会话工厂（简化创建）
class SessionFactory {
  constructor(private container: DependencyContainer) {}
  
  async create(options: SessionOptions): Promise<ChatSession> {
    // 初始化所有依赖
    await this.initializeDependencies(options);
    
    // 创建编排器
    const orchestrator = this.container.resolve<SessionOrchestrator>('orchestrator');
    
    // 创建会话
    return new ChatSession(orchestrator, this.container);
  }
}

// 4. 简化后的 ChatSession（只负责对外接口）
class ChatSession {
  constructor(
    private orchestrator: SessionOrchestrator,
    private container: DependencyContainer
  ) {}
  
  async run(input: string): Promise<void> {
    return this.orchestrator.execute(input);
  }
  
  async stop(): Promise<void> {
    const agentLoop = this.container.resolve<AgentLoop>('agentLoop');
    await agentLoop.stop();
  }
  
  // 提供访问器，保持向后兼容
  get agentLoop(): AgentLoop {
    return this.container.resolve('agentLoop');
  }
  
  get memoryManager(): IMemoryStore {
    return this.container.resolve('memoryManager');
  }
}
```

---

## 三、实施步骤

### Step 1: 实现 DependencyContainer（Day 1）

```typescript
// src/core/di/DependencyContainer.ts
export class DependencyContainer {
  private services = new Map<string, ServiceRegistration>();
  private singletons = new Map<string, any>();
  
  register<T>(key: string, factory: () => T, lifecycle: 'transient' | 'singleton' = 'transient'): void {
    this.services.set(key, { factory, lifecycle });
  }
  
  registerSingleton<T>(key: string, instance: T): void {
    this.singletons.set(key, instance);
  }
  
  resolve<T>(key: string): T {
    // 1. 检查单例缓存
    if (this.singletons.has(key)) {
      return this.singletons.get(key);
    }
    
    // 2. 查找注册
    const registration = this.services.get(key);
    if (!registration) {
      throw new Error(`Service not registered: ${key}`);
    }
    
    // 3. 创建实例
    const instance = registration.factory();
    
    // 4. 单例模式缓存
    if (registration.lifecycle === 'singleton') {
      this.singletons.set(key, instance);
    }
    
    return instance;
  }
  
  has(key: string): boolean {
    return this.services.has(key) || this.singletons.has(key);
  }
}
```

### Step 2: 实现 SessionOrchestrator（Day 2-3）

```typescript
// src/core/chat/SessionOrchestrator.ts
export class SessionOrchestrator {
  constructor(
    private agentLoop: AgentLoop,
    private skillRouter: SkillRouter,
    private turnManager: TurnLifecycleManager,
    private callbacks?: SessionCallbacks
  ) {}
  
  async execute(input: string): Promise<void> {
    try {
      // 1. 前置处理
      await this.beforeExecution(input);
      
      // 2. Skill 路由
      const skillMatch = await this.skillRouter.match(input);
      if (skillMatch && await this.confirmSkill(skillMatch)) {
        await this.skillRouter.execute(skillMatch);
        return;
      }
      
      // 3. AgentLoop 执行
      await this.agentLoop.run(input);
      
      // 4. 后置处理
      await this.afterExecution();
      
    } catch (error) {
      await this.handleError(error);
      throw error;
    }
  }
  
  private async beforeExecution(input: string): Promise<void> {
    // Hook: before-turn
  }
  
  private async afterExecution(): Promise<void> {
    await this.turnManager.afterTurn();
  }
  
  private async confirmSkill(match: SkillMatch): Promise<boolean> {
    if (match.confidence < 0.9 && this.callbacks?.onSkillConfirm) {
      return await this.callbacks.onSkillConfirm(match.skill, match.confidence);
    }
    return true;
  }
  
  private async handleError(error: unknown): Promise<void> {
    // 错误处理逻辑
  }
}
```

### Step 3: 实现 SessionFactory（Day 4）

```typescript
// src/core/chat/SessionFactory.ts
export class SessionFactory {
  constructor(private container: DependencyContainer) {}
  
  async create(options: SessionOptions): Promise<ChatSession> {
    // 1. 加载配置
    const config = await this.loadConfig(options);
    this.container.registerSingleton('config', config);
    
    // 2. 初始化基础设施
    await this.initInfrastructure(config);
    
    // 3. 初始化领域服务
    await this.initDomainServices(config);
    
    // 4. 初始化应用服务
    await this.initApplicationServices(config);
    
    // 5. 创建编排器
    const orchestrator = this.createOrchestrator();
    
    // 6. 创建会话
    return new ChatSession(orchestrator, this.container);
  }
  
  private async initInfrastructure(config: AppConfig): Promise<void> {
    // Logger
    this.container.registerSingleton('logger', logger);
    
    // Storage
    const storage = new SessionStorage();
    this.container.registerSingleton('storage', storage);
  }
  
  private async initDomainServices(config: AppConfig): Promise<void> {
    // Provider
    const provider = await this.createProvider(config);
    this.container.registerSingleton('provider', provider);
    
    // MemoryManager
    const memoryManager = new MemoryManager(config.memory);
    await memoryManager.init();
    this.container.registerSingleton('memoryManager', memoryManager);
    
    // PermissionController
    const permissionController = new PermissionController(config.permission);
    this.container.registerSingleton('permissionController', permissionController);
  }
  
  private async initApplicationServices(config: AppConfig): Promise<void> {
    // ToolRegistry
    const registry = createDefaultRegistry();
    registry.setPermissionController(
      this.container.resolve('permissionController')
    );
    this.container.registerSingleton('registry', registry);
    
    // AgentLoop
    const agentLoop = new AgentLoop(
      this.container.resolve('provider'),
      this.container.resolve('registry'),
      config.agent
    );
    this.container.registerSingleton('agentLoop', agentLoop);
  }
  
  private createOrchestrator(): SessionOrchestrator {
    return new SessionOrchestrator(
      this.container.resolve('agentLoop'),
      this.container.resolve('skillRouter'),
      this.container.resolve('turnManager')
    );
  }
}
```

### Step 4: 重构 ChatSession（Day 5）

```typescript
// src/core/chat/ChatSession.ts
export class ChatSession {
  constructor(
    private orchestrator: SessionOrchestrator,
    private container: DependencyContainer
  ) {}
  
  async run(input: string): Promise<void> {
    return this.orchestrator.execute(input);
  }
  
  async stop(): Promise<void> {
    const agentLoop = this.container.resolve<AgentLoop>('agentLoop');
    await agentLoop.stop();
  }
  
  async interrupt(message: string): Promise<void> {
    const agentLoop = this.container.resolve<AgentLoop>('agentLoop');
    await agentLoop.interrupt(message);
  }
  
  // 访问器（向后兼容）
  get agentLoop(): AgentLoop {
    return this.container.resolve('agentLoop');
  }
  
  get memoryManager(): IMemoryStore {
    return this.container.resolve('memoryManager');
  }
  
  get sessionManager(): SessionManager {
    return this.container.resolve('sessionManager');
  }
}
```

### Step 5: 迁移现有代码（Day 6-7）

```typescript
// 旧代码
const session = new ChatSession(options);
await session.init();
await session.run(input);

// 新代码
const factory = new SessionFactory(new DependencyContainer());
const session = await factory.create(options);
await session.run(input);
```

---

## 四、测试策略

### 单元测试

```typescript
describe('SessionOrchestrator', () => {
  it('should route to skill when confidence > 0.9', async () => {
    const mockSkillRouter = {
      match: jest.fn().mockResolvedValue({ confidence: 0.95, skill: mockSkill }),
      execute: jest.fn()
    };
    
    const orchestrator = new SessionOrchestrator(
      mockAgentLoop,
      mockSkillRouter,
      mockTurnManager
    );
    
    await orchestrator.execute('test input');
    
    expect(mockSkillRouter.execute).toHaveBeenCalled();
    expect(mockAgentLoop.run).not.toHaveBeenCalled();
  });
});
```

### 集成测试

```typescript
describe('ChatSession Integration', () => {
  it('should execute full workflow', async () => {
    const container = new DependencyContainer();
    const factory = new SessionFactory(container);
    const session = await factory.create(testOptions);
    
    await session.run('test input');
    
    // 验证结果
  });
});
```

---

## 五、迁移检查清单

- [ ] DependencyContainer 实现完成
- [ ] SessionOrchestrator 实现完成
- [ ] SessionFactory 实现完成
- [ ] ChatSession 重构完成
- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试通过
- [ ] 性能测试无回归
- [ ] 文档更新完成
- [ ] Code Review 通过
- [ ] 旧代码标记为 @deprecated

---

## 六、回滚方案

### Feature Flag 控制

```typescript
const USE_NEW_SESSION = process.env.XUANJI_USE_NEW_SESSION === 'true';

if (USE_NEW_SESSION) {
  // 新实现
  const factory = new SessionFactory(new DependencyContainer());
  session = await factory.create(options);
} else {
  // 旧实现
  session = new ChatSession(options);
  await session.init();
}
```

### 保留旧代码

- 旧代码移至 `src/core/chat/legacy/`
- 保留 2 个版本周期（约 2 个月）
- 在 v0.5.0 完全移除
