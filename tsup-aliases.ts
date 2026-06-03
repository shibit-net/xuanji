import path from 'path';

/** 与 vite.config.ts 保持一致 */
export function buildAliases(rootDir: string) {
  const rootSrc = path.resolve(rootDir, 'src');
  return {
    '@/agent': path.join(rootSrc, 'agent'),
    '@/context': path.join(rootSrc, 'context'),
    '@/engine': path.join(rootSrc, 'engine'),
    '@/hooks': path.join(rootSrc, 'hooks'),
    '@/i18n': path.join(rootSrc, 'i18n'),
    '@/infrastructure': path.join(rootSrc, 'infrastructure'),
    '@/mcp': path.join(rootSrc, 'mcp'),
    '@/memory': path.join(rootSrc, 'memory'),
    '@/permission': path.join(rootSrc, 'permission'),
    '@/platform': path.join(rootSrc, 'platform'),
    '@/provider': path.join(rootSrc, 'provider'),
    '@/session': path.join(rootSrc, 'session'),
    '@/shared/utils': path.join(rootSrc, 'shared/utils'),
    '@/shared': path.join(rootSrc, 'shared'),
    '@/skills': path.join(rootSrc, 'skills'),
    '@/tools': path.join(rootSrc, 'tools'),
    '@/types': path.join(rootSrc, 'types'),
  };
}
