// ============================================================
// Xuanji Desktop - Services Index
// ============================================================
// 统一管理和导出所有服务

import ApiClient from './api-client';
import AuthService from './auth';
import ModelsService from './models';

// 配置
const API_BASE_URL = process.env.STARSHIP_API_URL || 'https://shibit.net';

// 创建 API 客户端单例
const apiClient = new ApiClient({
  baseUrl: API_BASE_URL,
  timeout: 15000,
});

// 创建服务实例
export const authService = new AuthService(apiClient);
export const modelsService = new ModelsService(apiClient);

// 导出 API 客户端以便直接使用
export { apiClient };
export type { ApiResponse, ApiConfig } from './api-client';
export type { User, LoginCredentials } from './auth';
export type { 
  AgentLlm, 
  AgentLlmImportDTO, 
  PageResponse 
} from './models';

export default {
  auth: authService,
  models: modelsService,
};
