# ConfigManager 迁移分析

## 当前架构

### ConfigManager (CLI 适配器层)
**文件**: `src/adapters/cli/utils/ConfigManager.ts` (111 行)

**职责**:
- CLI 模式的配置管理器
- 包装 ConfigLoader，提供读写配置的便利接口
- 管理内存中的当前配置

**依赖**:
- ConfigLoader（核心配置加载器）
- GlobalConfig（全局配置读写）

**接口**:
```typescript
class ConfigManager {
  async load(): Promise<AppConfig>
  getConfig(): AppConfig
  set(key: string, value: unknown): void
  get<T>(key: string): T | undefined
  async save(partialConfig?: Partial<AppConfig>): Promise<void>
  validate(): boolean
  getConfigDir(): string
  async reset(): Promise<void>
}
```

### ConfigService (基础设施层)
**文件**: `src/infrastructure/config/ConfigService.ts` (200 行)

**职责**:
- 统一配置管理服务
- 支持多层配置源和优先级
- 支持配置监听和热更新

**配置优先级**:
1. 默认配置 (priority: 0)
2. 全局配置 (priority: 10)
3. 项目配置 (priority: 20)
4. 环境变量 (priority: 30)
5. 运行时配置 (priority: 40)

**接口**:
```typescript
class ConfigService {
  async load(): Promise<void>
  get<T>(key: string, defaultValue?: T): T
  set(key: string, value: any): void
  watch(key: string, callback: ConfigWatcher): () => void
  async reload(): Promise<void>
  async save(key: string, value: any): Promise<void>
}
```

---

## 差异分析

### 相似点
1. 都提供 `load()` / `get()` / `set()` 方法
2. 都支持点号路径访问（如 `provider.model`）
3. 都支持配置持久化

### 差异点

| 特性 | ConfigManager | ConfigService |
|------|---------------|---------------|
| 定位 | CLI 适配器层 | 基础设施层 |
| 配置源 | 单一（全局配置） | 多层（5 个优先级） |
| 返回类型 | `AppConfig` 对象 | 通用 `Record<string, any>` |
| 配置监听 | ❌ 不支持 | ✅ 支持 watch |
| 热更新 | ❌ 不支持 | ✅ 支持 reload |
| 验证 | ✅ validate() | ❌ 无 |
| 重置 | ✅ reset() | ❌ 无 |
| 依赖 | ConfigLoader + GlobalConfig | IConfigSource[] |

---

## 迁移评估

### 结论：不建议直接替换

**原因**:

1. **层次定位不同**
   - ConfigManager 是 CLI 适配器层的工具类
   - ConfigService 是基础设施层的通用服务
   - 两者服务于不同的抽象层次

2. **接口契约不同**
   - ConfigManager 返回强类型 `AppConfig`
   - ConfigService 返回通用 `Record<string, any>`
   - 直接替换会破坏类型安全

3. **功能侧重不同**
   - ConfigManager 侧重 CLI 场景（validate、reset、getConfigDir）
   - ConfigService 侧重通用场景（多源、监听、热更新）

4. **使用场景单一**
   - ConfigManager 仅在 `src/index.ts` 中使用
   - 影响范围小，迁移收益有限

---

## 推荐方案

### 方案 1: 保持现状（推荐）

**理由**:
- ConfigManager 是适配器层的工具类，职责清晰
- 使用场景单一，代码量小（111 行）
- 不存在重复代码问题
- 迁移成本 > 收益

**建议**:
- 保留 ConfigManager 作为 CLI 适配器层的配置管理器
- 内部可以使用 ConfigService 作为底层实现（重构内部实现，保持接口不变）

### 方案 2: 内部重构（可选）

如果要优化，可以让 ConfigManager 内部使用 ConfigService：

```typescript
export class ConfigManager {
  private configService: ConfigService;
  private currentConfig: AppConfig | null = null;

  constructor() {
    // 使用 ConfigService 作为底层实现
    this.configService = ConfigFactory.create();
  }

  async load(): Promise<AppConfig> {
    await this.configService.load();
    // 将通用配置转换为 AppConfig
    this.currentConfig = this.configService.get('') as AppConfig;
    return this.currentConfig;
  }

  get<T>(key: string): T | undefined {
    return this.configService.get<T>(key);
  }

  set(key: string, value: unknown): void {
    this.configService.set(key, value);
  }

  // ... 其他方法保持不变
}
```

**收益**:
- 统一底层配置管理逻辑
- 保持 CLI 适配器层接口不变
- 获得 ConfigService 的多源支持和监听能力

**成本**:
- 需要适配类型转换
- 需要测试验证

---

## 决策

**选择方案 1: 保持现状**

**理由**:
1. ConfigManager 职责清晰，代码简洁
2. 不存在重复代码或架构问题
3. 迁移成本 > 收益
4. 符合"不要为了迁移而迁移"的原则

**后续优化**:
- 如果未来需要多源配置或配置监听，可以考虑方案 2
- 当前阶段保持现状即可

---

**分析日期**: 2026-04-18  
**结论**: 不迁移  
**原因**: 层次定位不同，迁移收益有限
