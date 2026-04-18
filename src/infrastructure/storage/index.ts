// ============================================================
// 统一存储 - 模块导出
// ============================================================

export type {
  IStorage,
  IBatchStorage,
  ITransactionalStorage,
  IQueryableStorage,
  IFullStorage,
  ITransaction,
  ISerializer,
  QueryFilter,
  SearchQuery,
  SearchResult
} from './interfaces';

export { JSONSerializer } from './interfaces';
export { SQLiteStorage } from './SQLiteStorage';
export { MemoryStorage } from './MemoryStorage';
export { FileStorage } from './FileStorage';

/**
 * 存储工厂
 */
export class StorageFactory {
  /**
   * 创建 SQLite 存储
   */
  static createSQLite<T>(dbPath: string, tableName: string) {
    return new (require('./SQLiteStorage').SQLiteStorage)<T>(dbPath, tableName);
  }

  /**
   * 创建内存存储
   */
  static createMemory<T>() {
    return new (require('./MemoryStorage').MemoryStorage)<T>();
  }

  /**
   * 创建文件存储
   */
  static createFile<T>(baseDir: string) {
    return new (require('./FileStorage').FileStorage)<T>(baseDir);
  }
}
