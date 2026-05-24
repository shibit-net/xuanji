// ============================================================
// Toast - 通知组件（shadcn 包装层）
// 保持与旧代码兼容的 API：toast.success() / toast.error() 等
// 底层使用 Radix Toast + shadcn/ui
// ============================================================

import React, { createContext, useContext } from 'react';
import { toast as shadcnToast } from '../hooks/use-toast';
import { getDesktopLabel } from '../i18n';
import { useConfigStore } from '../stores/configStore';

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

const typeLabelKeys: Record<ToastType, string> = {
  success: 'toast.success',
  error: 'toast.error',
  warning: 'toast.warning',
  info: 'toast.info',
};

function getCurrentLang(): 'zh' | 'en' {
  try {
    const store = useConfigStore.getState();
    return (store.settings?.language as 'zh' | 'en') || 'zh';
  } catch {
    return 'zh';
  }
}

function show(type: ToastType, message: string, duration = 3000) {
  const lang = getCurrentLang();
  shadcnToast({
    variant: variantMap[type],
    title: getDesktopLabel(typeLabelKeys[type], lang),
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
