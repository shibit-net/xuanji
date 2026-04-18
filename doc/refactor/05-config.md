# 统一配置管理方案

## 一、现状分析

### 当前配置管理（分散）

```typescript
// 1. ConfigLoader - 加载配置
class ConfigLoader {
  async load(): Promise<AppConfig> {
    // 合并多个来源
  }
}

// 2. EnvConfig - 环境变量
function getEnvProviderConfig(): ProviderConfig;
function getEnvUIConfig(): UIConfig;
function getEnvMemoryConfig(): MemoryConfig;

// 3. GlobalConfig - 全局配置
function loadGlobalConfig(): Promise<ConfigFile>;
function saveGlobalConfig(config: ConfigFile): Promise<void>;

// 4. ProjectConfig - 项目配置
function loadProjectConfig(): Promise<ConfigFile>;

// 5. RuntimeConfig - 运行时配置
function getToolTimeouts(): Record<string, number>;

// 6. defaults.ts - 默认值
export const DEFAULT_CONFIG: AppConfig;
```

### 问题
1. **配置分散**：5+ 个文件，职责不清
2. **优先级复杂**：合并逻辑分散在各处
3. **难以访问**：没有统一的配置访问接口
4. **难以测试**：Mock 配置困难
5. **缺乏验证**：配置验证分散

---

## 二、重构目标

### 统一配置服务

```typescript
// 1. 配置源接口
interface IConfigSource {
  name: string;
  priority: number;  // 数字越大优先级越高
  load(): Promise<Record<string, any>>;
  save?(config: Record<string, any>): Promise<void>;
}

// 2. 配置服务接口
interface IConfigService {
  get<T>(key: string, defaultValue?: T): T;
  set(key: string, value: any): void;
  has(key: string): boolean;
  watch(key: string, callback: (value: any) => void): () => void;
  reload(): Promise<void>;
}

// 3. 配置服务实现
class ConfigService implements IConfigService {
  private sources: IConfigSource[] = [];
  private merged: Record<string, any> = {};
  private watchers = new Map<string, Set<(value: any) => void>>();
  
  constructor(sources: IConfigSource[]) {
    // 按优先级排序（低到高）
    this.sources = sources.sort((a, b) => a.priority - b.priority);
  }
  
  async load(): Promise<void> {
    // 按优先级合并配置
    this.merged = {};
    for (const source of this.sources) {
      const config = await source.load();
      this.merged = deepMerge(this.merged, config);
    }
  }
  
  get<T>(key: string, defaultValue?: T): T {
    const value = getByPath(this.merged, key);
    return value !== undefined ? value : defaultValue;
  }
  
  set(key: string, value: any): void {
    setByPath(this.merged, key, value);
    this.notifyWatchers(key, value);
  }
  
  has(key: string): boolean {
    return getByPath(this.merged, key) !== undefined;
  }
  
  watch(key: string, callback: (value: any) => void): () => void {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, new Set());
    }
    this.watchers.get(key)!.add(callback);
    
    // 返回取消监听函数
    return () => {
      this.watchers.get(key)?.delete(callback);
    };
  }
  
  async reload(): Promise<void> {
    await this.load();
    // 通知所有监听器
    for (const [key, callbacks] of this.watchers) {
      const value = this.get(key);
      for (const callback of callbacks) {
        callback(value);
      }
    }
  }
  
  private notifyWatchers(key: string, value: any): void {
    const callbacks = this.watchers.get(key);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(value);
      }
    }
  }
}
```

### 配置源实现

```typescript
// 1. 默认配置源
class DefaultConfigSource implements IConfigSource {
  name = 'default';
  priority = 0;
  
  async load(): Promise<Record<string, any>> {
    return DEFAULT_CONFIG;
  }
}

// 2. 全局配置源
class GlobalConfigSource implements IConfigSource {
  name = 'global';
  priority = 10;
  
  async load(): Promise<Record<string, any>> {
    return await loadGlobalConfig();
  }
  
  async save(config: Record<string, any>): Promise<void> {
    await saveGlobalConfig(config);
  }
}

// 3. 项目配置源
class ProjectConfigSource implements IConfigSource {
  name = 'project';
  priority = 20;
  
  async load(): Promise<Record<string, any>> {
    return await loadProjectConfig();
  }
}

// 4. 环境变量配置源
class EnvConfigSource implements IConfigSource {
  name = 'env';
  priority = 30;
  
  async load(): Promise<Record<string, any>> {
    return {
      provider: getEnvProviderConfig(),
      ui: getEnvUIConfig(),
      memory: getEnvMemoryConfig()
    };
  }
}

// 5. 运行时配置源
class RuntimeConfigSource implements IConfigSource {
  name = 'runtime';
  priority = 40;
  private config: Record<string, any> = {};
  
  async load(): Promise<Record<string, any>> {
    return this.config;
  }
  
  set(key: string, value: any): void {
    setByPath(this.config, key, value);
  }
}
```

---

## 三、实施步骤

### Step 1: 实现配置服务（Day 1）

```typescript
// src/core/config/ConfigService.ts
export class ConfigService implements IConfigService {
  // 实现代码见上方
}

// src/core/config/sources/index.ts
export { DefaultConfigSource } from './DefaultConfigSource';
export { GlobalConfigSource } from './GlobalConfigSource';
export { ProjectConfigSource } from './ProjectConfigSource';
export { EnvConfigSource } from './EnvConfigSource';
export { RuntimeConfigSource } from './RuntimeConfigSource';
```

### Step 2: 创建配置工厂（Day 2）

```typescript
// src/core/config/ConfigFactory.ts
export class ConfigFactory {
  static async create(): Promise<ConfigService> {
    const sources: IConfigSource[] = [
      new DefaultConfigSource(),
      new GlobalConfigSource(),
      new ProjectConfigSource(),
      new EnvConfigSource(),
      new RuntimeConfigSource()
    ];
    
    const service = new ConfigService(sources);
    await service.load();
    
    return service;
  }
  
  static async createForTest(overrides: Record<string, any> = {}): Promise<ConfigService> {
    const sources: IConfigSource[] = [
      new DefaultConfigSource(),
      new MemoryConfigSource(overrides)  // 测试用内存配置
    ];
    
    const service = new ConfigService(sources);
    await service.load();
    
    return service;
  }
}
```

### Step 3: 迁移现有代码（Day 3-4）

```typescript
// 旧代码
const config = await new ConfigLoader().load();
const model = config.provider.model;

// 新代码
const configService = await ConfigFactory.create();
const model = configService.get<string>('provider.model');

// 或者通过依赖注入
class ChatSession {
  constructor(private config: IConfigService) {}
  
  async init() {
    const model = this.config.get<string>('provider.model');
    // ...
  }
}
```

### Step 4: 添加配置验证（Day 5）

```typescript
// src/core/config/ConfigValidator.ts
export class ConfigValidator {
  constructor(private schema: JSONSchema) {}
  
  validate(config: Record<string, any>): ValidationResult {
    const errors: ValidationError[] = [];
    
    // 验证必填字段
    if (!config.provider?.model) {
      errors.push({
        path: 'provider.model',
        message: 'Model is required'
      });
    }
    
    if (!config.provider?.apiKey) {
      errors.push({
        path: 'provider.apiKey',
        message: 'API Key is required'
      });
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// 在 ConfigService 中集成
class ConfigService implements IConfigService {
  private validator: ConfigValidator;
  
  async load(): Promise<void> {
    await super.load();
    
    // 验证配置
    const result = this.validator.validate(this.merged);
    if (!result.valid) {
      console.warn('Configuration validation failed:', result.errors);
    }
  }
}
```

---

## 四、使用示例

### 基本使用

```typescript
// 1. 创建配置服务
const config = await ConfigFactory.create();

// 2. 读取配置
const model = config.get<string>('provider.model');
const apiKey = config.get<string>('provider.apiKey');
const maxTokens = config.get<number>('provider.maxTokens', 4096);

// 3. 设置配置（运行时）
config.set('provider.temperature', 0.7);

// 4. 监听配置变化
const unwatch = config.watch('provider.model', (newModel) => {
  console.log('Model changed to:', newModel);
});

// 5. 重新加载配置
await config.reload();

// 6. 取消监听
unwatch();
```

### 依赖注入

```typescript
// src/core/di/DependencyContainer.ts
class DependencyContainer {
  async init() {
    // 注册配置服务
    const config = await ConfigFactory.create();
    this.registerSingleton('config', config);
    
    // 其他服务可以依赖配置
    this.register('provider', () => {
      const config = this.resolve<IConfigService>('config');
      return ProviderFactory.create(config);
    });
  }
}
```

### 测试

```typescript
// 测试中使用内存配置
describe('ChatSession', () => {
  it('should initialize with config', async () => {
    const config = await ConfigFactory.createForTest({
      provider: {
        model: 'claude-sonnet-4-6',
        apiKey: 'test-key'
      }
    });
    
    const session = new ChatSession(config);
    await session.init();
    
    expect(session.provider.model).toBe('claude-sonnet-4-6');
  });
});
```

---

## 五、收益

### 1. 统一访问
- 所有配置通过 ConfigService 访问
- 不再需要记住多个配置加载函数

### 2. 优先级清晰
- 配置源按优先级排序
- 合并逻辑统一

### 3. 易于测试
- 使用 MemoryConfigSource 进行测试
- 无需真实配置文件

### 4. 支持热更新
- watch() 监听配置变化
- reload() 重新加载配置

### 5. 类型安全
- get<T>() 提供类型推断
- 避免类型错误

---

## 六、向后兼容

### 保留旧接口

```typescript
// src/core/config/ConfigLoader.ts（保留）
export class ConfigLoader implements IConfigLoader {
  private service: ConfigService;
  
  async load(): Promise<AppConfig> {
    this.service = await ConfigFactory.create();
    return this.service.get('') as AppConfig;
  }
  
  get<T>(key: string): T | undefined {
    return this.service.get<T>(key);
  }
  
  set(key: string, value: any): void {
    this.service.set(key, value);
  }
}
```

### 渐进式迁移
1. 新代码使用 ConfigService
2. 旧代码保持使用 ConfigLoader
3. ConfigLoader 内部委托给 ConfigService
4. 逐步迁移旧代码
5. 2 个版本后删除 ConfigLoader
