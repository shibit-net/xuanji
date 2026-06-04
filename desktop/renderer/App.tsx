// ============================================================
// App - 应用入口（路由管理 + 懒加载）
// ============================================================

import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ToastProvider } from './components/Toast';
import { Toaster } from './components/ui/toaster';
import { useAuthStore } from './stores/authStore';
import { useConfigStore } from './stores/configStore';

// 懒加载页面组件
const LoginPage = lazy(() => import('./pages/LoginPage'));
const MainLayout = lazy(() => import('./layouts/MainLayout'));
const MainPage = lazy(() => import('./pages/MainPage'));
const AgentsPage = lazy(() => import('./pages/AgentsPage'));
const ToolsPage = lazy(() => import('./pages/ToolsPage'));
const SystemPromptPage = lazy(() => import('./pages/SystemPromptPage'));
const PermissionsPage = lazy(() => import('./pages/PermissionsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const MemoryPage = lazy(() => import('./pages/MemoryPage'));
const SchedulerPage = lazy(() => import('./pages/SchedulerPage'));
const SkillsMCPPage = lazy(() => import('./pages/SkillsMCPPage'));
const FallbackProviderSetupPage = lazy(() => import('./pages/FallbackProviderSetupPage'));

import { SkeletonCard, SkeletonList } from './components/shared/Skeleton';

// 加载中骨架屏
function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen w-screen bg-background">
      <div className="w-80 space-y-4">
        <div className="animate-pulse bg-secondary rounded h-6 w-2/3" />
        <SkeletonList count={3} />
      </div>
    </div>
  );
}

// 认证检查组件
function AuthCheck({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isCheckingAuth = useAuthStore((s) => s.isCheckingAuth);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isCheckingAuth) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <>{children}</>;
}

// 兜底 Provider 配置检查组件 — fallbackProvider 未配置则重定向到 /setup
function SetupGuard({ children }: { children: React.ReactNode }) {
  const loaded = useConfigStore((s) => s.loaded);
  const fallbackProvider = useConfigStore((s) => s.fallbackProvider);

  if (!loaded) {
    return <LoadingScreen />;
  }

  if (!fallbackProvider?.adapter) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
}

// /setup 路由守卫 — 已配置 fallbackProvider 则重定向到 /
function SetupRouteGuard({ children }: { children: React.ReactNode }) {
  const loaded = useConfigStore((s) => s.loaded);
  const fallbackProvider = useConfigStore((s) => s.fallbackProvider);

  if (!loaded) {
    return <LoadingScreen />;
  }

  if (fallbackProvider?.adapter) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

// 页面过渡动画包裹器
function PageFade({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="flex flex-col flex-1 min-h-0"
    >
      {children}
    </motion.div>
  );
}

// 带动画的路由组
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<PageFade><MainPage /></PageFade>} />
        <Route path="/chat" element={<PageFade><MainPage /></PageFade>} />
        <Route path="/agents" element={<PageFade><AgentsPage onClose={() => window.history.back()} /></PageFade>} />
        <Route path="/tools" element={<PageFade><ToolsPage onClose={() => window.history.back()} /></PageFade>} />
        <Route path="/system-prompt" element={<PageFade><SystemPromptPage onClose={() => window.history.back()} /></PageFade>} />
        <Route path="/permissions" element={<PageFade><PermissionsPage onClose={() => window.history.back()} /></PageFade>} />
        <Route path="/settings" element={<PageFade><SettingsPage onClose={() => window.history.back()} /></PageFade>} />
        <Route path="/memory" element={<PageFade><MemoryPage onClose={() => window.history.back()} /></PageFade>} />
        <Route path="/scheduler" element={<PageFade><SchedulerPage onClose={() => window.history.back()} /></PageFade>} />
        <Route path="/skills-mcp" element={<PageFade><SkillsMCPPage onClose={() => window.history.back()} /></PageFade>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  const theme = useConfigStore((s) => s.settings.theme);
  const loaded = useConfigStore((s) => s.loaded);
  const loading = useConfigStore((s) => s.loading);
  const loadConfig = useConfigStore((s) => s.loadConfig);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // 唯一的配置加载入口：认证通过后，加载一次配置到 store
  // loading 变化时也检查，防止 loaded=false+loading=true 时错过重新加载
  useEffect(() => {
    if (!loaded && !loading && isAuthenticated) {
      loadConfig();
    }
  }, [loaded, loading, loadConfig, isAuthenticated]);

  // 主题同步到 html 元素（dark 类控制 shadcn CSS 变量）
  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = (t: string) => {
      if (t === 'dark') {
        root.classList.add('dark');
      } else if (t === 'light') {
        root.classList.remove('dark');
      } else {
        // auto: 跟随系统
        root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
      }
    };

    applyTheme(theme);

    if (theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => root.classList.toggle('dark', e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

  return (
    <ToastProvider>
      <Toaster />
      <HashRouter>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            {/* 登录页面 */}
            <Route path="/login" element={<LoginPage />} />

            {/* 兜底 Provider 配置页（独立路由，认证后访问） */}
            <Route
              path="/setup"
              element={
                <AuthCheck>
                  <SetupRouteGuard>
                    <FallbackProviderSetupPage />
                  </SetupRouteGuard>
                </AuthCheck>
              }
            />

            {/* 主应用路由（需要认证） */}
            <Route
              path="/*"
              element={
                <AuthCheck>
                  <SetupGuard>
                    <MainLayout>
                      <AnimatedRoutes />
                    </MainLayout>
                  </SetupGuard>
                </AuthCheck>
              }
            />
          </Routes>
        </Suspense>
      </HashRouter>
    </ToastProvider>
  );
}
