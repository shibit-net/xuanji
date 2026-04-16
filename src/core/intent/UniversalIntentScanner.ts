/**
 * 通用意图扫描器
 *
 * 自动发现所有实现了 IntentRegistrable 接口的模块：
 * - Skills
 * - System Prompt Components
 * - MCP Tools
 * - Agents
 * - Custom Modules
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { IntentRegistrable, IntentMetadata, ModuleType } from './types.js';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'UniversalIntentScanner' });

// ESM 模式下获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 扫描结果
 */
export interface ScanResult {
  /** 意图元数据 */
  intentMeta: IntentMetadata;

  /** 模块实例 */
  module: IntentRegistrable;

  /** 模块类型 */
  moduleType: ModuleType;

  /** 模块 ID */
  moduleId: string;

  /** 文件路径 */
  filePath: string;
}

/**
 * 扫描统计
 */
export interface ScanStats {
  /** 总模块数 */
  total: number;

  /** 按模块类型分组 */
  byType: Map<ModuleType, number>;

  /** 按领域分组 */
  byDomain: Map<string, number>;

  /** 扫描耗时（毫秒） */
  duration: number;
}

/**
 * 通用意图扫描器
 */
export class UniversalIntentScanner {
  private scanPaths: Array<{ path: string; type: string }> = [];

  constructor() {
    this.initScanPaths();
  }

  /**
   * 初始化扫描路径
   */
  private initScanPaths(): void {
    const cwd = process.cwd();
    const homeDir = os.homedir();

    this.scanPaths = [
      // 1. Skills
      { path: path.join(__dirname, '../skills/builtin'), type: 'builtin-skills' },
      { path: path.join(homeDir, '.xuanji/skills'), type: 'user-skills' },
      { path: path.join(cwd, '.xuanji/skills'), type: 'project-skills' },

      // 2. System Prompt Components（暂时假设它们也在 skills 或单独目录）
      // TODO: 等 System Prompt Components 独立后添加路径

      // 3. MCP Tools
      { path: path.join(__dirname, '../../mcp/tools'), type: 'builtin-mcp' },
      { path: path.join(homeDir, '.xuanji/mcp/tools'), type: 'user-mcp' },

      // 4. Agents
      { path: path.join(__dirname, '../agents'), type: 'builtin-agents' },
      { path: path.join(homeDir, '.xuanji/agents'), type: 'user-agents' },

      // 5. Custom Modules
      { path: path.join(homeDir, '.xuanji/modules'), type: 'user-modules' },
      { path: path.join(cwd, '.xuanji/modules'), type: 'project-modules' },
    ];
  }

  /**
   * 扫描所有模块
   */
  async scanAll(): Promise<{ results: ScanResult[]; stats: ScanStats }> {
    const startTime = Date.now();
    const allResults: ScanResult[] = [];

    log.debug('扫描意图注册模块...');

    for (const { path: scanPath, type } of this.scanPaths) {
      try {
        const results = await this.scanDirectory(scanPath, type);
        allResults.push(...results);
      } catch (err) {
        // 目录不存在或无法访问，静默跳过
      }
    }

    const duration = Date.now() - startTime;
    const stats = this.computeStats(allResults, duration);

    log.debug(`扫描完成，发现 ${allResults.length} 个可注册模块`);
    this.logStats(stats);

    return { results: allResults, stats };
  }

  /**
   * 扫描单个目录
   */
  private async scanDirectory(dirPath: string, sourceType: string): Promise<ScanResult[]> {
    try {
      await fs.access(dirPath);
    } catch {
      return []; // 目录不存在
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results: ScanResult[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isFile()) {
        // TypeScript/JavaScript 模块
        if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
          const moduleResults = await this.loadTypeScriptModule(fullPath);
          results.push(...moduleResults);
        }

        // Markdown 模块（OpenClaw 格式）
        if (entry.name === 'skill.md') {
          const result = await this.loadMarkdownModule(fullPath);
          if (result) results.push(result);
        }
      } else if (entry.isDirectory()) {
        // 递归扫描子目录
        const subResults = await this.scanDirectory(fullPath, sourceType);
        results.push(...subResults);
      }
    }

    return results;
  }

  /**
   * 加载 TypeScript/JavaScript 模块
   */
  private async loadTypeScriptModule(filePath: string): Promise<ScanResult[]> {
    try {
      const fileUrl = pathToFileURL(filePath).href;
      const module = await import(fileUrl);

      const results: ScanResult[] = [];

      // 检查所有导出
      for (const key of Object.keys(module)) {
        const exported = module[key];

        // 跳过非类导出
        if (typeof exported !== 'function') continue;

        // 尝试实例化
        let instance: any;
        try {
          instance = new exported();
        } catch {
          continue; // 不是构造函数或实例化失败
        }

        // 检查是否实现了 IntentRegistrable
        if (this.isIntentRegistrable(instance)) {
          results.push({
            intentMeta: instance.intentMeta,
            module: instance,
            moduleType: instance.moduleType,
            moduleId: instance.id,
            filePath,
          });
        }
      }

      return results;
    } catch (err) {
      // 加载失败，静默跳过
      return [];
    }
  }

  /**
   * 加载 Markdown 模块（OpenClaw 格式）
   */
  private async loadMarkdownModule(filePath: string): Promise<ScanResult | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { frontmatter } = this.parseMarkdown(content);

      // 提取意图元数据
      if (!frontmatter.intentType || !frontmatter.trainingExamples) {
        return null; // 没有意图配置
      }

      const intentMeta: IntentMetadata = {
        type: frontmatter.intentType,
        domain: frontmatter.domain || 'general',
        name: frontmatter.name,
        description: frontmatter.description,
        trainingExamples: Array.isArray(frontmatter.trainingExamples)
          ? frontmatter.trainingExamples
          : [],
        enabled: frontmatter.enabled !== false,
        priority: frontmatter.priority || 50,
      };

      // 验证元数据
      if (!this.isValidIntentMetadata(intentMeta)) {
        return null;
      }

      // 创建伪实例（只包含元数据）
      const instance: IntentRegistrable = {
        moduleType: frontmatter.moduleType || 'skill',
        id: frontmatter.id || path.basename(path.dirname(filePath)),
        intentMeta,
      };

      return {
        intentMeta,
        module: instance,
        moduleType: instance.moduleType,
        moduleId: instance.id,
        filePath,
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * 判断是否实现了 IntentRegistrable
   */
  private isIntentRegistrable(obj: any): obj is IntentRegistrable {
    return (
      obj &&
      typeof obj === 'object' &&
      'intentMeta' in obj &&
      'moduleType' in obj &&
      'id' in obj &&
      this.isValidIntentMetadata(obj.intentMeta)
    );
  }

  /**
   * 验证意图元数据有效性
   */
  private isValidIntentMetadata(meta: any): meta is IntentMetadata {
    return (
      meta &&
      typeof meta === 'object' &&
      typeof meta.type === 'string' &&
      meta.type.length > 0 &&
      typeof meta.domain === 'string' &&
      Array.isArray(meta.trainingExamples) &&
      meta.trainingExamples.length >= 3 // 至少 3 个训练样本
    );
  }

  /**
   * 计算统计信息
   */
  private computeStats(results: ScanResult[], duration: number): ScanStats {
    const byType = new Map<ModuleType, number>();
    const byDomain = new Map<string, number>();

    for (const result of results) {
      // 按类型统计
      const typeCount = byType.get(result.moduleType) || 0;
      byType.set(result.moduleType, typeCount + 1);

      // 按领域统计
      const domainCount = byDomain.get(result.intentMeta.domain) || 0;
      byDomain.set(result.intentMeta.domain, domainCount + 1);
    }

    return {
      total: results.length,
      byType,
      byDomain,
      duration,
    };
  }

  /**
   * 输出统计日志
   */
  private logStats(stats: ScanStats): void {
    if (stats.total === 0) {
      log.debug('未发现任何可注册模块');
      return;
    }

    const byType = Object.fromEntries(stats.byType);
    const byDomain = Object.fromEntries(stats.byDomain);
    log.debug('扫描统计', { byType, byDomain, duration: stats.duration });
  }

  /**
   * 解析 Markdown（提取 YAML frontmatter）
   */
  private parseMarkdown(content: string): { frontmatter: any; markdown: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      return { frontmatter: {}, markdown: content };
    }

    try {
      // 简单的 YAML 解析（只支持基本格式）
      const yamlContent = match[1];
      const frontmatter: any = {};

      const lines = yamlContent.split('\n');
      let currentKey: string | null = null;
      let currentArray: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();

        // 数组项
        if (trimmed.startsWith('- ') && currentKey) {
          currentArray.push(trimmed.slice(2).trim());
          continue;
        }

        // 键值对
        const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
        if (kvMatch) {
          // 保存之前的数组
          if (currentKey && currentArray.length > 0) {
            frontmatter[currentKey] = currentArray;
            currentArray = [];
          }

          const [, key, value] = kvMatch;
          currentKey = key;

          if (value) {
            // 有值，直接赋值
            frontmatter[key] = value;
            currentKey = null;
          }
        }
      }

      // 保存最后的数组
      if (currentKey && currentArray.length > 0) {
        frontmatter[currentKey] = currentArray;
      }

      return { frontmatter, markdown: match[2] };
    } catch {
      return { frontmatter: {}, markdown: content };
    }
  }
}
