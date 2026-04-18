// ============================================================
// Xuanji Desktop - Models Service
// ============================================================
// 统一管理 Starship 模型相关 API

import ApiClient from './api-client';

export interface AgentLlm {
  id?: number;
  name?: string;
  avatar?: string;
  tags?: string;
  model?: string;
  adapter?: string;
  routeIds?: string;
  modelPriceId?: number;
  desc?: string;
  createTime?: string;
  modifyTime?: string;
}

export interface AgentLlmImportDTO {
  name?: string;
  model?: string;
  adapter?: string;
  vendor?: string;
  price?: number;
  desc?: string;
}

export interface PageResponse<T> {
  list: T[];
  total: number;
  page: number;
  size: number;
}

export class ModelsService {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  // 获取模型基本信息（公开接口，无需管理员权限）
  async getAgentLLMBasicInfoById(id: number, routeId?: number) {
    const params = routeId ? { routeId } : undefined;
    return this.client.get(`/api/llm/agent/info/${id}`, { params });
  }

  // 获取模型详细信息（需管理员权限）
  async getAgentLLMById(id: number) {
    return this.client.get(`/api/llm/agent/detail/${id}`);
  }

  // 获取模型广场列表
  async listMarketplaceModels(options?: {
    vendor?: string;
    name?: string;
    routeId?: number;
    page?: number;
    size?: number;
  }) {
    const params = {
      vendor: options?.vendor,
      name: options?.name,
      routeId: options?.routeId,
      page: options?.page,
      size: options?.size
    };
    return this.client.get('/api/llm/agent/marketplace', { params });
  }

  // 使用 POST 方式获取模型广场列表
  async listMarketplaceModelsPost(options?: {
    vendor?: string;
    name?: string;
    routeId?: number;
    page?: number;
    size?: number;
  }) {
    const params = {
      vendor: options?.vendor,
      name: options?.name,
      routeId: options?.routeId,
      page: options?.page,
      size: options?.size
    };
    return this.client.post('/api/llm/agent/marketplace', null, { params });
  }

  // 搜索模型列表
  async searchAgentLLMList(options?: {
    page?: number;
    size?: number;
    model?: string;
    name?: string;
    vendor?: string;
  }) {
    const params = {
      page: options?.page,
      size: options?.size,
      model: options?.model,
      name: options?.name,
      vendor: options?.vendor
    };
    return this.client.post('/api/llm/agent/list', null, { params });
  }

  // 获取所有模型列表
  async listAllModels() {
    return this.client.get('/api/llm/agent/models');
  }

  // 获取供应商列表
  async listAgentLlmVendors() {
    return this.client.get('/api/llm/agent/vendors');
  }

  // 获取线路摘要
  async listRouteSummary() {
    return this.client.get('/api/llm/agent/routes/summary');
  }

  // 获取动态分组模型
  async listDynamicGroupModels() {
    return this.client.get('/api/llm/agent/dynamic-group-models');
  }

  // 创建模型（管理员）
  async createAgentLLM(data: AgentLlm) {
    return this.client.post('/api/llm/agent/create', data);
  }

  // 更新模型（管理员）
  async updateAgentLLM(data: AgentLlm) {
    return this.client.put('/api/llm/agent/update', data);
  }

  // 删除模型（管理员）
  async deleteAgentLLM(id: number) {
    return this.client.delete(`/api/llm/agent/delete/${id}`);
  }

  // 批量导入模型（管理员）
  async batchImportAgentLLM(data: AgentLlmImportDTO[]) {
    return this.client.post('/api/llm/agent/import', data);
  }

  // 清除模型广场缓存（管理员）
  async clearMarketplaceCache() {
    return this.client.post('/api/llm/agent/marketplace/cache/clear');
  }
}

export default ModelsService;
