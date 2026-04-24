// ============================================================
// Infrastructure - 基础设施层
// ============================================================
// 提供通用的基础设施服务
//
// 模块:
// - storage: 统一存储接口
// - config: 统一配置管理
// - messaging: 事件和消息总线
// - middleware: 中间件管道
// ============================================================

// 存储
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
} from './storage';

export {
  JSONSerializer,
  SQLiteStorage,
  FileStorage,
  StorageFactory
} from './storage';

// 配置
export type {
  IConfigSource,
  ConfigWatcher
} from './config';

export {
  ConfigService,
  TemplateConfigSource,
  UserConfigSource,
  RuntimeConfigSource,
  MemoryConfigSource,
  ConfigFactory
} from './config';

// 消息传递
export type {
  EventHandler,
  SubscribeOptions
} from './messaging';

export {
  EventBus,
  MessageBus
} from './messaging';

// 中间件
export type {
  IMiddleware,
  MiddlewareFunction,
  NextFunction
} from './middleware';

export {
  MiddlewarePipeline,
  PermissionMiddleware,
  LoggingMiddleware,
  ErrorHandlingMiddleware,
  TimeoutMiddleware,
  RetryMiddleware,
  CacheMiddleware
} from './middleware';
