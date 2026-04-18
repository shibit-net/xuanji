// ============================================================
// Xuanji Desktop - Auth Service
// ============================================================
import ApiClient, { ApiResponse } from './api-client';

export interface User {
  userId: string;
  email: string;
  nickname?: string;
  avatar?: string;
  roles?: string[];
  permissions?: string[];
}

export interface LoginCredentials {
  email: string;
  password: string;
}

class AuthService {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  // 登录
  async login(credentials: LoginCredentials): Promise<ApiResponse<User>> {
    return this.client.post<User>('/api/auth/login', credentials);
  }

  // 登出
  async logout(): Promise<ApiResponse<void>> {
    return this.client.post<void>('/api/auth/logout');
  }

  // 刷新 Token
  async refreshToken(): Promise<ApiResponse<void>> {
    return this.client.post<void>('/api/auth/refresh');
  }

  // 获取当前用户信息
  async getCurrentUser(): Promise<ApiResponse<User>> {
    return this.client.get<User>('/api/users/me');
  }
}

export default AuthService;
