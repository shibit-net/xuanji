// ============================================================
// 用户认证 — 类型定义
// ============================================================

/** 登录请求 */
export interface LoginRequest {
  email: string;
  password: string;
}

/** 用户信息（从 /api/users/me 返回） */
export interface UserInfo {
  id: number;
  username: string;
  email: string;
  role: string;
  balance: number;
  apiKey?: string;
  createdAt?: string;
}

/** 持久化的用户凭证（加密存储到 auth.json） */
export interface UserCredentials {
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number; // Unix timestamp (seconds)
  userId: number;
  username: string;
  email: string;
}

/** 认证状态 */
export type AuthStatus = 'authenticated' | 'unauthenticated' | 'expired';

/** AuthManager 事件 */
export interface AuthEvents {
  login: (user: UserInfo) => void;
  logout: () => void;
  tokenRefreshed: () => void;
  authError: (error: Error) => void;
}
