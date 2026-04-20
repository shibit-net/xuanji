// ============================================================
// App - 应用入口（路由管理 + 懒加载）
// ============================================================

import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import { useAuthStore } from './stores/authStore';

// 懒加载页面组件
const LoginPage = lazy(() => import('./pages/LoginPage'));
const MainLayout = lazy(() => import('./layouts/MainLayout'));
const MainPage = lazy(() => import('./pages/MainPage'));
const AgentsPage = lazy(() => import('./pages/AgentsPage'));
const MemoryPage = lazy(() => import('./pages/MemoryPage'));

// 加载中组件
function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-screen w-screen bg-bg-primary text-text-primary">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
      <p className="text-gray-400">加载中...</p>
    </div>
  );
}

// 认证检查组件
function AuthCheck({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            {/* 登录页面 */}
            <Route path="/login" element={<LoginPage />} />

            {/* 主应用路由（需要认证） */}
            <Route
              path="/*"
              element={
                <AuthCheck>
                  <MainLayout>
                    <Routes>
                      <Route path="/" element={<MainPage />} />
                      <Route path="/chat" element={<MainPage />} />
                      <Route path="/agents" element={<AgentsPage onClose={() => window.history.back()} />} />
                      <Route path="/memory" element={<MemoryPage onClose={() => window.history.back()} />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </MainLayout>
                </AuthCheck>
              }
            />
          </Routes>
        </Suspense>
      </HashRouter>
    </ToastProvider>
  );
}
