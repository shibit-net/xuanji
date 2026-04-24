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
export { FileStorage } from './FileStorage';

import { SQLiteStorage } from './SQLiteStorage';
import { FileStorage } from './FileStorage';

/**
 * 存储工厂
 */
export class StorageFactory {
  /**
   * 创建 SQLite 存储
   */
  static createSQLite<T>(dbPath: string, tableName: string) {
    return new SQLiteStorage<T>(dbPath, tableName);
  }

  /**
   * 创建文件存储
   */
  static createFile<T>(baseDir: string) {
    return new FileStorage<T>(baseDir);
  }
}
