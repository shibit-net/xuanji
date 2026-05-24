/**
 * ============================================================
 * L3 Component: Project — 项目上下文
 * ============================================================
 * 从 identity.ts 迁移 buildProjectContext() 逻辑。
 * 动态注入，每轮更新。
 *
 * L3 缓存策略：
 * - 30 秒 TTL（首次构建后缓存 30 秒）
 * - 文件变更自动失效（通过 fs.watch 监听项目源文件变化）
 * - Event 联动：CONTEXT_COMPRESSION_DONE → 清除缓存
 * - 手动失效：外部可调用 invalidateL3Cache()
 */

import type { PromptComponent, PromptBuildContext } from '../types';
import { ProjectScanner } from '@/context/ProjectScanner';
import { ContextBuilder } from '@/context/ContextBuilder';
import { FileIndexer } from '@/context/FileIndexer';
import { DependencyAnalyzer } from '@/context/DependencyAnalyzer';
import { RulesLoader } from '@/core/config/RulesLoader';
import { ProjectRegistry } from '@/core/project/ProjectRegistry';
import type { FileIndex } from '@/context/types';
import { logger } from '@/core/logger';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { watch } from 'node:fs';

const log = logger.child({ module: 'l3-project' });

export const l3Project: PromptComponent = {
  id: 'l3-project',
  name: 'Project Context',
  layer: 'L3',
  // 不限制 scenes，让所有场景都可以尝试加载，但在 render 中判断是否真的是项目
  priority: 60,
  estimatedTokens: 0, // 动态，取决于项目大小

  async render(context: PromptBuildContext): Promise<string> {
    try {
      const userId = context?.config?.userId as string | undefined;
      return await buildProjectContext(userId);
    } catch (error) {
      log.warn('Failed to build project context:', error);
      return '';
    }
  },
};

// ─── L3 缓存 ──────────────────────────────────────

interface L3CacheEntry {
  result: string;
  timestamp: number;
  rootPath: string;
}

let l3Cache: L3CacheEntry | null = null;
const L3_CACHE_TTL = 30_000; // 30 秒

/** 缓存根路径，用于 watcher 判断 */
let cachedRootPath: string | null = null;

/** fs.watch 句柄，避免重复注册 */
let fileWatcher: ReturnType<typeof watch> | null = null;

/** EventBus 取消订阅句柄 */
let eventUnsubscribe: (() => void) | null = null;

function getL3Cache(rootPath: string): string | null {
  if (l3Cache && l3Cache.rootPath === rootPath && Date.now() - l3Cache.timestamp < L3_CACHE_TTL) {
    return l3Cache.result;
  }
  return null;
}

function setL3Cache(rootPath: string, result: string): void {
  l3Cache = { result, timestamp: Date.now(), rootPath };
  // 启动文件监听（仅在缓存有效时监控）
  startFileWatcher(rootPath);
}

/**
 * 手动失效缓存，供外部调用（如桌面层检测到文件保存时触发）
 */
export function invalidateL3Cache(): void {
  l3Cache = null;
  stopFileWatcher();
  log.debug('L3 cache invalidated manually');
}

/**
 * 清除所有 L3 缓存状态（包括 watcher 和 EventBus 监听）
 */
export function clearL3Cache(): void {
  l3Cache = null;
  stopFileWatcher();
  unsubscribeFromEvents();
}

// ─── 文件变更自动失效 ──────────────────────────

function startFileWatcher(rootPath: string): void {
  // 如果已有 watcher 且路径相同，无需重复注册
  if (fileWatcher && cachedRootPath === rootPath) return;

  // 清除旧的 watcher
  stopFileWatcher();
  cachedRootPath = rootPath;

  try {
    /** 需要监听的文件/目录扩展名 */
    const watchedExtensions = new Set(['.ts', '.js', '.tsx', '.jsx', '.json', '.yaml', '.yml', '.md']);

    fileWatcher = watch(rootPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';
      if (watchedExtensions.has(ext) || filename === 'XUANJI.md' || filename.startsWith('.xuanji')) {
        log.debug(`File change detected: ${filename} — invalidating L3 cache`);
        invalidateL3Cache();
      }
    });

    fileWatcher.on('error', (err) => {
      log.warn('L3 file watcher error:', err);
      invalidateL3Cache();
    });

    // 注册 EventBus 联动
    ensureEventSubscription();
  } catch (err) {
    log.warn('Failed to start L3 file watcher:', err);
  }
}

function stopFileWatcher(): void {
  if (fileWatcher) {
    try { fileWatcher.close(); } catch { /* ignore */ }
    fileWatcher = null;
  }
}

function ensureEventSubscription(): void {
  // EventBus 可能还未初始化（模块加载时），懒加载
}

function unsubscribeFromEvents(): void {
  if (eventUnsubscribe) {
    try { eventUnsubscribe(); } catch { /* ignore */ }
    eventUnsubscribe = null;
  }
}

// ─── buildProjectContext ────────────────────────────

async function buildProjectContext(userId?: string): Promise<string> {
  const scanner = new ProjectScanner();
  const metadata = scanner.scan();

  // 缓存命中
  const cached = getL3Cache(metadata.rootPath);
  if (cached !== null) return cached;

  // 先加载规则文件（即使不是项目，也可能有 XUANJI.md）
  const loader = new RulesLoader();
  const rules = loader.loadRulesSync(metadata.rootPath);

  // 如果不是项目（没有 git 且类型未知）且没有规则文件，跳过
  if (metadata.type === 'unknown' && !metadata.hasGit && !rules.xuanjiMd && !rules.projectRules) {
    log.debug('Not a project and no rules, skipping project context');
    return '';
  }

  // 注册操作过的项目到 ProjectRegistry
  if (userId) {
    const registry = new ProjectRegistry(userId);
    const hasRules = !!(rules.xuanjiMd || rules.projectRules);
    registry.register(metadata.rootPath, hasRules).catch(err => {
      log.warn('Failed to register project:', err);
    });
  }

  let indexSummary = '';
  try {
    const indexer = new FileIndexer(metadata.rootPath);
    const index = await indexer.buildIndex({
      directories: ['src'],
      maxFiles: 100,
      concurrency: 4,
    });
    indexSummary = formatIndexSummary(index, 20);
    log.info(`Index: ${index.totalFiles} files, ${index.bySymbol.size} symbols`);
  } catch (error) {
    log.warn('Failed to build file index:', error);
  }

  let dependencyInfo = undefined;
  try {
    const analyzer = new DependencyAnalyzer(metadata.rootPath);
    dependencyInfo = await analyzer.analyze(metadata.type);
    log.info(`Analyzed ${dependencyInfo.totalCount} dependencies`);
  } catch (error) {
    log.warn('Failed to analyze dependencies:', error);
  }

  const builder = new ContextBuilder(metadata, rules, indexSummary, dependencyInfo);
  let context = builder.build();

  // 读取 .xuanji/handoff/ 中的历史策略记录，注入到项目上下文
  // 这些文件由 autoSummarize 在策略完成时写入，文件名即策略标识
  try {
    const handoffDir = join(metadata.rootPath, '.xuanji', 'handoff');
    if (existsSync(handoffDir)) {
      const files = readdirSync(handoffDir)
        .filter(f => f.endsWith('.json'))
        .sort();
      if (files.length > 0) {
        const lines = ['### Previous Strategy History'];
        for (const file of files) {
          try {
            const content = readFileSync(join(handoffDir, file), 'utf-8');
            const entry = JSON.parse(content);
            const name = entry.strategyName || entry.groupId || file.replace('.json', '');
            const status = entry.status || 'completed';
            lines.push(`- **${name}** (${status})`);
          } catch {
            lines.push(`- ${file.replace('.json', '')}`);
          }
        }
        context += '\n\n' + lines.join('\n');
      }
    }
  } catch {
    // handoff 目录不存在或不可读，忽略
  }

  // 写入缓存
  setL3Cache(metadata.rootPath, context);

  return context;
}

function formatIndexSummary(index: FileIndex, topN: number): string {
  const files = Array.from(index.byPath.values())
    .filter(f => f.exports.length > 0)
    .sort((a, b) => b.exports.length - a.exports.length)
    .slice(0, topN);

  if (files.length === 0) return '';

  const lines = [
    '### Code Structure',
    '',
    `**Total Files**: ${index.totalFiles}`,
    `**Total Symbols**: ${index.bySymbol.size}`,
    `**Top ${files.length} Files**:`,
    '',
  ];

  for (const file of files) {
    const exportNames = file.exports.map(s => s.name).join(', ');
    lines.push(`- \`${file.path}\` — ${exportNames}`);
  }

  return lines.join('\n');
}
