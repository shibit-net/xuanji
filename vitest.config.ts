import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude: [
      // 集成测试耗时过长（含 sleep 10 等真实命令执行），单独运行
      'test/integration/**',
      // Electron 集成测试依赖未实现的 @/platform 模块
      'test/integration/electron-integration.test.ts',
      // learning 模块已删除（src/learning/ 在生产代码中无引用）
      'test/integration/lesson-system-e2e.test.ts',
      // 手动测试脚本，不使用 vitest API（require.main === module 模式）
      'test/jarvis-architecture.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'test/',
        '**/*.d.ts',
        '**/index.ts',
        // 向后兼容转发文件 (shim)
        'src/agent/*.ts',
        'src/tools/*.ts',
        'src/provider/*.ts',
        'src/config/*.ts',
        'src/types/*.ts',
        'src/cli/*.ts',
        'src/cli/*.tsx',
        // Provider SDK 实现，需要 SDK mock (集成测试范畴)
        'src/provider/AnthropicProvider.ts',
        'src/provider/OpenAIProvider.ts',
        // 平台适配器（需要 Electron 运行时，属于集成测试范畴）
        'src/platform/**',
        // 占位模块
        'src/context/**',
        'src/memory/**',
        'src/permission/**',
        'src/mcp/**',
        'src/infrastructure/telemetry/**',
      ],
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
  },
});
