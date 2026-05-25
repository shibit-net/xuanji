// ============================================================
// App - 应用入口（路由管理 + 懒加载）
// ============================================================

import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
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

// 加载中组件
function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-screen w-screen bg-background text-foreground">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
      <p className="text-gray-400">加载中...</p>
    </div>
  );
}

// 认证检查组件
function AuthCheck({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isCheckingAuth, checkAuth } = useAuthStore();

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
                      <Routes>
                        <Route path="/" element={<MainPage />} />
                        <Route path="/chat" element={<MainPage />} />
                        <Route path="/agents" element={<AgentsPage onClose={() => window.history.back()} />} />
                        <Route path="/tools" element={<ToolsPage onClose={() => window.history.back()} />} />
                        <Route path="/system-prompt" element={<SystemPromptPage onClose={() => window.history.back()} />} />
                        <Route path="/permissions" element={<PermissionsPage onClose={() => window.history.back()} />} />
                        <Route path="/settings" element={<SettingsPage onClose={() => window.history.back()} />} />
                        <Route path="/memory" element={<MemoryPage onClose={() => window.history.back()} />} />
                        <Route path="/scheduler" element={<SchedulerPage onClose={() => window.history.back()} />} />
                        <Route path="/skills-mcp" element={<SkillsMCPPage onClose={() => window.history.back()} />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Routes>
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
