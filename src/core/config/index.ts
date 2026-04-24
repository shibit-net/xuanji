// ============================================================
// 统一配置管理 - 导出
// ============================================================

// DEFAULT_CONFIG 已删除，所有默认配置都在模板中（src/core/templates/config.json）
export { ConfigLoader } from './ConfigLoader';
export { UserConfigInitializer, initializeUserConfig, ensureUserConfigIntegrity } from './UserConfigInitializer';
export { getUserRoot, getUserConfigPath, getUserAgentsDir } from './PathManager';
export { UserConfig, getUserConfigDir, listUsers } from './UserConfig';
export { ProjectConfigWriter } from './ProjectConfigWriter';
export { ConfigService, type IConfigSource, type ConfigWatcher } from '../../infrastructure/config/ConfigService';
export { ConfigFactory } from '../../infrastructure/config/ConfigFactory';
export {
  TemplateConfigSource,
  UserConfigSource,
  RuntimeConfigSource,
  MemoryConfigSource
} from '../../infrastructure/config/ConfigSources';
