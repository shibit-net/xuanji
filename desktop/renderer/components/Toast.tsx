// ============================================================
// Toast - 通知组件
// ============================================================

import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

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

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((type: ToastType, message: string, duration = 3000) => {
    const id = `${Date.now()}-${Math.random()}`;
    const toast: Toast = { id, type, message, duration };

    setToasts((prev) => [...prev, toast]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = useCallback((message: string, duration?: number) => {
    show('success', message, duration);
  }, [show]);

  const error = useCallback((message: string, duration?: number) => {
    show('error', message, duration);
  }, [show]);

  const warning = useCallback((message: string, duration?: number) => {
    show('warning', message, duration);
  }, [show]);

  const info = useCallback((message: string, duration?: number) => {
    show('info', message, duration);
  }, [show]);

  return (
    <ToastContext.Provider value={{ show, success, error, warning, info }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={() => remove(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const config = {
    success: {
      icon: CheckCircle,
      className: 'bg-green-500/20 border-green-500/50 text-green-400',
    },
    error: {
      icon: XCircle,
      className: 'bg-red-500/20 border-red-500/50 text-red-400',
    },
    warning: {
      icon: AlertCircle,
      className: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400',
    },
    info: {
      icon: Info,
      className: 'bg-blue-500/20 border-blue-500/50 text-blue-400',
    },
  };

  const { icon: Icon, className } = config[toast.type];

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 rounded-lg border
        shadow-lg backdrop-blur-sm
        animate-slide-in-right
        ${className}
      `}
    >
      <Icon size={20} className="flex-shrink-0" />
      <p className="text-sm flex-1">{toast.message}</p>
      <button
        onClick={onClose}
        className="flex-shrink-0 p-0.5 hover:bg-white/10 rounded transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}
