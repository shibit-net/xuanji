// ============================================================
// 统一配置管理 - 导出
// ============================================================

export { DEFAULT_CONFIG } from './defaults';
export { ConfigLoader } from './ConfigLoader';
export {
  UserConfigInitializer,
  getUserConfigRoot,
  getUserConfigPath,
  getUserAgentsDir,
  getUserAgentOverridesDir,
  getBuiltinAgentsDir
} from './UserConfigInitializer';
export { UserConfig, getUserConfigDir, listUsers } from './UserConfig';
export { ProjectConfigWriter } from './ProjectConfigWriter';
export { ConfigService, type IConfigSource, type ConfigWatcher } from '../../infrastructure/config/ConfigService';
export { ConfigFactory } from '../../infrastructure/config/ConfigFactory';
export {
  DefaultConfigSource,
  UserConfigSource,
  RuntimeConfigSource,
  MemoryConfigSource
} from '../../infrastructure/config/ConfigSources';
