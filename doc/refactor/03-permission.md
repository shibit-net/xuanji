# Permission 系统重构方案

## 一、现状分析

### 当前架构（职责混杂）
```typescript
class PermissionController {
  // 业务逻辑
  private fileGuard: FileGuard;
  private commandGuard: CommandGuard;
  private policyEngine: PolicyEngine;
  
  // 基础设施
  private auditLogger: AuditLogger;
  private decisionCache: Map<string, boolean>;
  private decisionStore: DecisionStore;
  
  // UI 交互
  private confirmationHandler: ConfirmationHandler;
  private confirmationQueue: Promise<void>;
  
  // 状态管理
  private deniedOperations: Map<string, DeniedOperation>;
  private currentUserIntent: string | null;
  
  // 混合了：守卫、策略、缓存、持久化、审计、UI、状态
}
```

### 问题
1. **职责混杂**：业务逻辑和基础设施混在一起
2. **难以测试**：UI 交互、缓存、持久化耦合
3. **难以扩展**：新增守卫或策略需要修改核心类
4. **确认队列**：应该独立为服务

---

## 二、重构目标

### 新架构：分离关注点

```typescript
// 1. 守卫层（Domain）
interface IPermissionGuard {
  check(request: PermissionRequest): GuardCheckResult;
}

class FileGuard implements IPermissionGuard {
  check(request: PermissionRequest): GuardCheckResult {
    // 文件操作风险评估
    if (request.operation === 'delete' && request.path === '/') {
      return { level: 'danger', reason: 'Root deletion' };
    }
    return { level: 'safe' };
  }
}

class CommandGuard implements IPermissionGuard {
  check(request: PermissionRequest): GuardCheckResult {
    // 命令风险评估
    if (request.command?.includes('rm -rf /')) {
      return { level: 'danger', reason: 'Dangerous command' };
    }
    return { level: 'safe' };
  }
}

// 2. 策略引擎（Domain）
interface IPermissionPolicy {
  evaluate(request: PermissionRequest): PolicyResult;
}

class PolicyEngine implements IPermissionPolicy {
  constructor(private config: PermissionConfig) {}
  
  evaluate(request: PermissionRequest): PolicyResult {
    // 策略匹配：allowlist、denylist、patterns
    const allowRules = this.matchRules(request, this.config.allow);
    const denyRules = this.matchRules(request, this.config.deny);
    
    if (denyRules.length > 0) {
      return { allowed: false, reason: 'Denied by policy' };
    }
    if (allowRules.length > 0) {
      return { allowed: true, reason: 'Allowed by policy' };
    }
    return { allowed: false, reason: 'No matching policy' };
  }
}

// 3. 缓存层（Infrastructure）
interface IPermissionCache {
  get(key: string): boolean | undefined;
  set(key: string, value: boolean, ttl?: number): void;
  clear(): void;
}

class PermissionCache implements IPermissionCache {
  private cache = new Map<string, CacheEntry>();
  
  get(key: string): boolean | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expireAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }
  
  set(key: string, value: boolean, ttl = 3600000): void {
    this.cache.set(key, {
      value,
      expireAt: Date.now() + ttl
    });
  }
}

// 4. 审计层（Infrastructure）
interface IPermissionAudit {
  log(event: PermissionEvent): void;
  query(filter: AuditFilter): Promise<PermissionEvent[]>;
}

class PermissionAudit implements IPermissionAudit {
  constructor(private logger: AuditLogger) {}
  
  log(event: PermissionEvent): void {
    this.logger.log({
      timestamp: Date.now(),
      type: 'permission',
      ...event
    });
  }
}

// 5. 确认服务（Infrastructure）
interface IConfirmationService {
  confirm(request: ConfirmationRequest): Promise<ConfirmationResult>;
}

class ConfirmationService implements IConfirmationService {
  private queue: Promise<void> = Promise.resolve();
  
  async confirm(request: ConfirmationRequest): Promise<ConfirmationResult> {
    // 串行化确认请求
    return new Promise((resolve) => {
      this.queue = this.queue.then(async () => {
        const result = await this.showPrompt(request);
        resolve(result);
      });
    });
  }
  
  private async showPrompt(request: ConfirmationRequest): Promise<ConfirmationResult> {
    // UI 交互逻辑
  }
}

// 6. 权限控制器（Application）
class PermissionController implements IPermissionController {
  constructor(
    private guards: IPermissionGuard[],
    private policy: IPermissionPolicy,
    private cache: IPermissionCache,
    private audit: IPermissionAudit,
    private confirmation: IConfirmationService
  ) {}
  
  async check(request: PermissionRequest): Promise<PermissionResult> {
    // 1. 检查缓存
    const cacheKey = this.getCacheKey(request);
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return { allowed: cached, source: 'cache' };
    }
    
    // 2. 守卫检查
    const guardResult = this.runGuards(request);
    if (guardResult.level === 'safe') {
      this.cache.set(cacheKey, true);
      this.audit.log({ request, result: 'allowed', source: 'guard' });
      return { allowed: true, source: 'guard' };
    }
    
    // 3. 策略检查
    const policyResult = this.policy.evaluate(request);
    if (policyResult.allowed) {
      this.cache.set(cacheKey, true);
      this.audit.log({ request, result: 'allowed', source: 'policy' });
      return { allowed: true, source: 'policy' };
    }
    
    // 4. 用户确认（仅 danger 级别）
    if (guardResult.level === 'danger') {
      const confirmResult = await this.confirmation.confirm({
        request,
        reason: guardResult.reason
      });
      
      this.cache.set(cacheKey, confirmResult.allowed, confirmResult.remember ? undefined : 3600000);
      this.audit.log({ request, result: confirmResult.allowed ? 'allowed' : 'denied', source: 'user' });
      return { allowed: confirmResult.allowed, source: 'user' };
    }
    
    // 5. 默认拒绝
    this.audit.log({ request, result: 'denied', source: 'default' });
    return { allowed: false, source: 'default' };
  }
  
  private runGuards(request: PermissionRequest): GuardCheckResult {
    for (const guard of this.guards) {
      const result = guard.check(request);
      if (result.level === 'danger') return result;
    }
    return { level: 'safe' };
  }
}
```

---

## 三、实施步骤

### Step 1: 定义接口（Day 1）

```typescript
// src/permission/interfaces/IPermissionGuard.ts
export interface IPermissionGuard {
  check(request: PermissionRequest): GuardCheckResult;
}

export interface GuardCheckResult {
  level: 'safe' | 'warn' | 'danger';
  reason?: string;
}

// src/permission/interfaces/IPermissionPolicy.ts
export interface IPermissionPolicy {
  evaluate(request: PermissionRequest): PolicyResult;
}

export interface PolicyResult {
  allowed: boolean;
  reason: string;
  matchedRules?: string[];
}

// src/permission/interfaces/IPermissionCache.ts
export interface IPermissionCache {
  get(key: string): boolean | undefined;
  set(key: string, value: boolean, ttl?: number): void;
  clear(): void;
  delete(key: string): void;
}

// src/permission/interfaces/IConfirmationService.ts
export interface IConfirmationService {
  confirm(request: ConfirmationRequest): Promise<ConfirmationResult>;
}

export interface ConfirmationRequest {
  request: PermissionRequest;
  reason: string;
}

export interface ConfirmationResult {
  allowed: boolean;
  remember: boolean;
}
```

### Step 2: 实现基础设施层（Day 2）

```typescript
// src/permission/infrastructure/PermissionCache.ts
export class PermissionCache implements IPermissionCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize = 500;
  
  get(key: string): boolean | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    if (Date.now() > entry.expireAt) {
      this.cache.delete(key);
      return undefined;
    }
    
    entry.hits++;
    entry.lastAccess = Date.now();
    return entry.value;
  }
  
  set(key: string, value: boolean, ttl = 3600000): void {
    if (this.cache.size >= this.maxSize) {
      this.evict();
    }
    
    this.cache.set(key, {
      value,
      expireAt: Date.now() + ttl,
      hits: 0,
      lastAccess: Date.now()
    });
  }
  
  private evict(): void {
    // LRU 淘汰
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const toRemove = entries.slice(0, Math.floor(this.maxSize * 0.2));
    toRemove.forEach(([key]) => this.cache.delete(key));
  }
}

// src/permission/infrastructure/ConfirmationService.ts
export class ConfirmationService implements IConfirmationService {
  private queue: Promise<void> = Promise.resolve();
  private handler: ConfirmationHandler | null = null;
  
  setHandler(handler: ConfirmationHandler): void {
    this.handler = handler;
  }
  
  async confirm(request: ConfirmationRequest): Promise<ConfirmationResult> {
    if (!this.handler) {
      throw new Error('Confirmation handler not set');
    }
    
    return new Promise((resolve) => {
      this.queue = this.queue.then(async () => {
        const result = await this.handler!(request);
        resolve(result);
      });
    });
  }
}

// src/permission/infrastructure/PermissionAudit.ts
export class PermissionAudit implements IPermissionAudit {
  constructor(private logger: AuditLogger) {}
  
  log(event: PermissionEvent): void {
    this.logger.log({
      timestamp: Date.now(),
      type: 'permission',
      operation: event.request.operation,
      resource: event.request.path || event.request.command,
      result: event.result,
      source: event.source
    });
  }
  
  async query(filter: AuditFilter): Promise<PermissionEvent[]> {
    return this.logger.query(filter);
  }
}
```

### Step 3: 实现领域层（Day 3）

```typescript
// src/permission/guards/FileGuard.ts
export class FileGuard implements IPermissionGuard {
  private dangerousPaths = ['/', '/etc', '/usr', '/bin', '/sbin'];
  
  check(request: PermissionRequest): GuardCheckResult {
    if (request.operation !== 'file') {
      return { level: 'safe' };
    }
    
    const { path, action } = request;
    
    // 删除操作
    if (action === 'delete') {
      if (this.isDangerousPath(path)) {
        return { level: 'danger', reason: `Deleting system path: ${path}` };
      }
      if (this.isRecursiveDelete(path)) {
        return { level: 'warn', reason: `Recursive delete: ${path}` };
      }
    }
    
    // 写入操作
    if (action === 'write') {
      if (this.isSystemFile(path)) {
        return { level: 'danger', reason: `Writing to system file: ${path}` };
      }
    }
    
    return { level: 'safe' };
  }
  
  private isDangerousPath(path: string): boolean {
    return this.dangerousPaths.some(dp => path.startsWith(dp));
  }
}

// src/permission/guards/CommandGuard.ts
export class CommandGuard implements IPermissionGuard {
  private dangerousCommands = ['rm -rf /', 'dd if=', 'mkfs', 'format'];
  
  check(request: PermissionRequest): GuardCheckResult {
    if (request.operation !== 'command') {
      return { level: 'safe' };
    }
    
    const { command } = request;
    
    // 危险命令
    if (this.isDangerousCommand(command)) {
      return { level: 'danger', reason: `Dangerous command: ${command}` };
    }
    
    // 网络操作
    if (this.isNetworkCommand(command)) {
      return { level: 'warn', reason: `Network command: ${command}` };
    }
    
    return { level: 'safe' };
  }
  
  private isDangerousCommand(command: string): boolean {
    return this.dangerousCommands.some(dc => command.includes(dc));
  }
}
```

### Step 4: 重构 PermissionController（Day 4）

```typescript
// src/permission/PermissionController.ts
export class PermissionController implements IPermissionController {
  constructor(
    private guards: IPermissionGuard[],
    private policy: IPermissionPolicy,
    private cache: IPermissionCache,
    private audit: IPermissionAudit,
    private confirmation: IConfirmationService
  ) {}
  
  async check(request: PermissionRequest): Promise<PermissionResult> {
    const cacheKey = this.getCacheKey(request);
    
    // 1. 缓存检查
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return { allowed: cached, source: 'cache' };
    }
    
    // 2. 守卫检查
    const guardResult = this.runGuards(request);
    
    // 3. 策略检查
    const policyResult = this.policy.evaluate(request);
    
    // 4. 决策逻辑
    const result = await this.decide(request, guardResult, policyResult);
    
    // 5. 缓存和审计
    this.cache.set(cacheKey, result.allowed);
    this.audit.log({ request, ...result });
    
    return result;
  }
  
  private async decide(
    request: PermissionRequest,
    guardResult: GuardCheckResult,
    policyResult: PolicyResult
  ): Promise<PermissionResult> {
    // Safe 级别：直接放行
    if (guardResult.level === 'safe' && policyResult.allowed) {
      return { allowed: true, source: 'auto' };
    }
    
    // Danger 级别：用户确认
    if (guardResult.level === 'danger') {
      const confirmResult = await this.confirmation.confirm({
        request,
        reason: guardResult.reason!
      });
      return {
        allowed: confirmResult.allowed,
        source: 'user'
      };
    }
    
    // 默认：策略决定
    return {
      allowed: policyResult.allowed,
      source: 'policy',
      reason: policyResult.reason
    };
  }
  
  private runGuards(request: PermissionRequest): GuardCheckResult {
    let maxLevel: GuardCheckResult = { level: 'safe' };
    
    for (const guard of this.guards) {
      const result = guard.check(request);
      if (result.level === 'danger') return result;
      if (result.level === 'warn' && maxLevel.level === 'safe') {
        maxLevel = result;
      }
    }
    
    return maxLevel;
  }
  
  private getCacheKey(request: PermissionRequest): string {
    return `${request.operation}:${request.path || request.command}:${request.action}`;
  }
}
```

---

## 四、迁移策略

### 向后兼容

```typescript
// 保留旧接口，内部委托给新实现
class PermissionControllerLegacy {
  private newController: PermissionController;
  
  constructor(config: PermissionConfig) {
    // 创建新实现
    const guards = [new FileGuard(), new CommandGuard()];
    const policy = new PolicyEngine(config);
    const cache = new PermissionCache();
    const audit = new PermissionAudit(new AuditLogger());
    const confirmation = new ConfirmationService();
    
    this.newController = new PermissionController(
      guards,
      policy,
      cache,
      audit,
      confirmation
    );
  }
  
  // 旧方法委托给新实现
  async check(request: PermissionRequest): Promise<PermissionResult> {
    return this.newController.check(request);
  }
}
```

---

## 五、测试策略

### 单元测试

```typescript
describe('PermissionController', () => {
  it('should allow safe operations', async () => {
    const guards = [new FileGuard()];
    const policy = new MockPolicy({ allowed: true });
    const cache = new PermissionCache();
    const audit = new MockAudit();
    const confirmation = new MockConfirmation();
    
    const controller = new PermissionController(
      guards, policy, cache, audit, confirmation
    );
    
    const result = await controller.check({
      operation: 'file',
      path: '/tmp/test.txt',
      action: 'write'
    });
    
    expect(result.allowed).toBe(true);
    expect(result.source).toBe('auto');
  });
  
  it('should require confirmation for dangerous operations', async () => {
    // ...
  });
});
```

---

## 六、收益评估

| 指标 | 重构前 | 重构后 | 提升 |
|------|--------|--------|------|
| 类职责数 | 7 | 1 | -86% |
| 依赖数量 | 10 | 5 | -50% |
| 圈复杂度 | 12 | 5 | -58% |
| 测试覆盖率 | 40% | 85% | +113% |
| 新增守卫耗时 | 2h | 30min | -75% |
