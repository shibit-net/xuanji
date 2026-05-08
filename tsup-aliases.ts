import path from 'path';

/** 与 vite.config.ts 保持一致 */
export function buildAliases(rootDir: string) {
  const rootSrc = path.resolve(rootDir, 'src');
  return {
    '@/adapters': path.join(rootSrc, 'adapters'),
    '@/auth': path.join(rootSrc, 'auth'),
    '@/butler': path.join(rootSrc, 'butler'),
    '@/context': path.join(rootSrc, 'context'),
    '@/core': path.join(rootSrc, 'core'),
    '@/embedding': path.join(rootSrc, 'embedding'),
    '@/hooks': path.join(rootSrc, 'hooks'),
    '@/infrastructure': path.join(rootSrc, 'infrastructure'),
    '@/mcp': path.join(rootSrc, 'mcp'),
    '@/memory': path.join(rootSrc, 'memory'),
    '@/permission': path.join(rootSrc, 'permission'),
    '@/reminder': path.join(rootSrc, 'reminder'),
    '@/session': path.join(rootSrc, 'session'),
    '@/shared/utils': path.join(rootSrc, 'shared/utils'),
    '@/shared': path.join(rootSrc, 'shared'),
    '@/tiangong': path.join(rootSrc, 'tiangong'),
    '@/types': path.join(rootSrc, 'types'),
  };
}
