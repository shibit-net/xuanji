// ============================================================
// Toast - 通知组件（shadcn 包装层）
// 保持与旧代码兼容的 API：toast.success() / toast.error() 等
// 底层使用 Radix Toast + shadcn/ui
// ============================================================

import React, { createContext, useContext } from 'react';
import { toast as shadcnToast } from '../hooks/use-toast';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastContextValue {
  show: (type: ToastType, message: string, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

const variantMap: Record<ToastType, 'success' | 'error' | 'warning' | 'info'> = {
  success: 'success',
  error: 'error',
  warning: 'warning',
  info: 'info',
};

const typeLabelMap: Record<ToastType, string> = {
  success: '成功',
  error: '错误',
  warning: '警告',
  info: '信息',
};

function show(type: ToastType, message: string, duration = 3000) {
  shadcnToast({
    variant: variantMap[type],
    title: typeLabelMap[type],
    description: message,
    duration,
  });
}

const success = (message: string, duration?: number) => show('success', message, duration);
const error = (message: string, duration?: number) => show('error', message, duration);
const warning = (message: string, duration?: number) => show('warning', message, duration);
const info = (message: string, duration?: number) => show('info', message, duration);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <ToastContext.Provider value={{ show, success, error, warning, info }}>
      {children}
    </ToastContext.Provider>
  );
}
