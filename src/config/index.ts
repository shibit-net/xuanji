// ============================================================
// 向后兼容 — 转发到 core/config
// ============================================================

export { ConfigLoader } from '../core/config/ConfigLoader';
export { DEFAULT_CONFIG } from '../core/config/defaults';
export { getEnvProviderConfig, getApiKey, ENV_KEYS } from '../core/config/EnvConfig';
export { loadGlobalConfig, saveGlobalConfig, GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH } from '../core/config/GlobalConfig';
export { loadProjectConfig, getProjectRulesPath, PROJECT_CONFIG_DIR_NAME } from '../core/config/ProjectConfig';
