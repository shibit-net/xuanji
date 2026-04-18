// ============================================================
// 依赖注入容器 - DependencyContainer
// ============================================================
// 统一管理所有依赖注入，解决 ChatSession 依赖混乱问题
//
// 特性:
// - 支持单例和瞬态生命周期
// - 支持工厂函数和实例注册
// - 支持依赖解析和循环依赖检测
// - 类型安全
// ============================================================

export type ServiceLifecycle = 'singleton' | 'transient';

export interface ServiceRegistration<T = any> {
  factory: () => T | Promise<T>;
  lifecycle: ServiceLifecycle;
}

export class DependencyContainer {
  private services = new Map<string, ServiceRegistration>();
  private singletons = new Map<string, any>();
  private resolving = new Set<string>();

  /**
   * 注册服务
   * @param key 服务标识
   * @param factory 工厂函数
   * @param lifecycle 生命周期（默认 singleton）
   */
  register<T>(
    key: string,
    factory: () => T | Promise<T>,
    lifecycle: ServiceLifecycle = 'singleton'
  ): void {
    if (this.services.has(key)) {
      throw new Error(`Service already registered: ${key}`);
    }
    this.services.set(key, { factory, lifecycle });
  }

  /**
   * 注册单例实例
   * @param key 服务标识
   * @param instance 实例
   */
  registerSingleton<T>(key: string, instance: T): void {
    if (this.singletons.has(key)) {
      throw new Error(`Singleton already registered: ${key}`);
    }
    this.singletons.set(key, instance);
  }

  /**
   * 解析服务
   * @param key 服务标识
   * @returns 服务实例
   */
  async resolve<T>(key: string): Promise<T> {
    // 1. 检查单例缓存
    if (this.singletons.has(key)) {
      return this.singletons.get(key) as T;
    }

    // 2. 检查循环依赖
    if (this.resolving.has(key)) {
      throw new Error(`Circular dependency detected: ${key}`);
    }

    // 3. 查找注册
    const registration = this.services.get(key);
    if (!registration) {
      throw new Error(`Service not registered: ${key}`);
    }

    // 4. 创建实例
    this.resolving.add(key);
    try {
      const instance = await registration.factory();

      // 5. 单例模式缓存
      if (registration.lifecycle === 'singleton') {
        this.singletons.set(key, instance);
      }

      return instance as T;
    } finally {
      this.resolving.delete(key);
    }
  }

  /**
   * 同步解析服务（仅用于已缓存的单例）
   * @param key 服务标识
   * @returns 服务实例
   */
  resolveSync<T>(key: string): T {
    if (this.singletons.has(key)) {
      return this.singletons.get(key) as T;
    }
    throw new Error(`Service not available synchronously: ${key}`);
  }

  /**
   * 检查服务是否已注册
   * @param key 服务标识
   */
  has(key: string): boolean {
    return this.services.has(key) || this.singletons.has(key);
  }

  /**
   * 注销服务
   * @param key 服务标识
   */
  unregister(key: string): void {
    this.services.delete(key);
    this.singletons.delete(key);
  }

  /**
   * 清空所有服务
   */
  clear(): void {
    this.services.clear();
    this.singletons.clear();
    this.resolving.clear();
  }

  /**
   * 获取所有已注册的服务键
   */
  getRegisteredKeys(): string[] {
    return [
      ...Array.from(this.services.keys()),
      ...Array.from(this.singletons.keys())
    ];
  }
}
