// ============================================================
// 统一存储接口
// ============================================================
// 为所有存储模块提供统一的抽象层
//
// 设计目标:
// 1. 统一的 CRUD 接口
// 2. 支持批量操作
// 3. 支持事务
// 4. 支持查询和搜索
// 5. 可切换存储后端（SQLite、PostgreSQL、内存等）
// ============================================================

/**
 * 查询过滤器
 */
export interface QueryFilter {
  where?: Record<string, any>;
  orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  limit?: number;
  offset?: number;
}

/**
 * 搜索查询
 */
export interface SearchQuery {
  query: string;
  fields?: string[];
  limit?: number;
}

/**
 * 搜索结果
 */
export interface SearchResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

/**
 * 事务接口
 */
export interface ITransaction<T> {
  save(id: string, data: T): Promise<void>;
  load(id: string): Promise<T | null>;
  delete(id: string): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * 基础存储接口
 */
export interface IStorage<T> {
  /**
   * 保存数据
   */
  save(id: string, data: T): Promise<void>;

  /**
   * 加载数据
   */
  load(id: string): Promise<T | null>;

  /**
   * 查询数据
   */
  query(filter: QueryFilter): Promise<T[]>;

  /**
   * 删除数据
   */
  delete(id: string): Promise<void>;

  /**
   * 检查是否存在
   */
  exists(id: string): Promise<boolean>;

  /**
   * 关闭存储
   */
  close?(): Promise<void>;
}

/**
 * 批量操作接口
 */
export interface IBatchStorage<T> extends IStorage<T> {
  /**
   * 批量保存
   */
  saveBatch(items: Array<{ id: string; data: T }>): Promise<void>;

  /**
   * 批量加载
   */
  loadBatch(ids: string[]): Promise<Map<string, T>>;

  /**
   * 批量删除
   */
  deleteBatch(ids: string[]): Promise<void>;
}

/**
 * 事务支持接口
 */
export interface ITransactionalStorage<T> extends IStorage<T> {
  /**
   * 执行事务
   */
  transaction<R>(fn: (tx: ITransaction<T>) => Promise<R>): Promise<R>;
}

/**
 * 查询支持接口
 */
export interface IQueryableStorage<T> extends IStorage<T> {
  /**
   * 查询数据
   */
  query(filter: QueryFilter): Promise<T[]>;

  /**
   * 统计数量
   */
  count(filter: QueryFilter): Promise<number>;

  /**
   * 搜索数据
   */
  search(query: SearchQuery): Promise<SearchResult<T>>;
}

/**
 * 完整存储接口（包含所有功能）
 */
export interface IFullStorage<T> extends
  IBatchStorage<T>,
  ITransactionalStorage<T>,
  IQueryableStorage<T> {}

/**
 * 序列化器接口
 */
export interface ISerializer<T> {
  /**
   * 序列化为字符串
   */
  serialize(data: T): string;

  /**
   * 从字符串反序列化
   */
  deserialize(str: string): T;
}

/**
 * JSON 序列化器
 */
export class JSONSerializer<T> implements ISerializer<T> {
  serialize(data: T): string {
    return JSON.stringify(data);
  }

  deserialize(str: string): T {
    return JSON.parse(str);
  }
}
