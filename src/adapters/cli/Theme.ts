// ============================================================
// M1 终端 UI — 主题定义
// ============================================================

/**
 * 终端颜色主题
 */
export interface Theme {
  /** 主色调 */
  primary: string;
  /** 次要色 */
  secondary: string;
  /** 成功色 */
  success: string;
  /** 警告色 */
  warning: string;
  /** 错误色 */
  error: string;
  /** 暗淡色 */
  dim: string;
  /** 思考色 */
  thinking: string;
  /** 工具色 */
  tool: string;
}

/** 暗色主题 */
export const darkTheme: Theme = {
  primary: '#7C8CF5',
  secondary: '#A78BFA',
  success: '#34D399',
  warning: '#FBBF24',
  error: '#F87171',
  dim: '#6B7280',
  thinking: '#9CA3AF',
  tool: '#60A5FA',
};

/** 亮色主题 */
export const lightTheme: Theme = {
  primary: '#4F46E5',
  secondary: '#7C3AED',
  success: '#059669',
  warning: '#D97706',
  error: '#DC2626',
  dim: '#9CA3AF',
  thinking: '#6B7280',
  tool: '#2563EB',
};

/**
 * 获取当前主题
 */
export function getTheme(mode: 'light' | 'dark' | 'auto' = 'auto'): Theme {
  if (mode === 'light') return lightTheme;
  if (mode === 'dark') return darkTheme;
  // auto: 默认使用暗色主题 (终端通常是深色背景)
  return darkTheme;
}
