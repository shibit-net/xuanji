/**
 * ============================================================
 * PromptComponentRegistry — 用户级 Prompt 组件注册表
 * ============================================================
 * 类似 AgentRegistry，支持用户自定义 prompt 组件。
 *
 * 目录结构:
 * - src/core/templates/prompts/  — 内置模板（git 追踪）
 * - .xuanji/users/{userId}/prompts/  — 用户自定义组件
 *
 * 文件格式: JSON5 / YAML
 * {
 *   id: 'my-custom-coding',
 *   name: 'My Custom Coding Guide',
 *   layer: 'L1',
 *   scenes: ['coding'],
 *   priority: 75,
 *   estimatedTokens: 500,
 *   match: {
 *     keywords: '编程|代码|开发',
 *     description: '自定义编程场景指南'
 *   },
 *   content: '# My Custom Coding Guide\n\n...'
 * }
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import JSON5 from 'json5';
import { parse as parseYAML } from 'yaml';
import { promisify } from 'node:util';
import globCb from 'glob';
import type { PromptComponent, PromptBuildContext, SceneMatchConfig } from './types';
import { logger } from '@/core/logger';
import { getUserPromptsDir, getTemplatePromptsDir } from '@/core/config/PathManager';

const glob = promisify(globCb);
const log = logger.child({ module: 'PromptComponentRegistry' });

/**
 * 用户自定义 Prompt 组件配置（文件格式）
 */
export interface PromptComponentConfig {
  id: string;
  name: string;
  layer: 'L0' | 'L1' | 'L2' | 'L3';
  scenes?: string[];
  priority: number;
  estimatedTokens: number;
  requiredTools?: string[];
  thinking?: {
    type: 'enabled' | 'adaptive';
    effort?: 'low' | 'medium' | 'high';
    budgetTokens?: number;
  };
  match?: {
    keywords: string;  // 正则表达式字符串
    description: string;
  };
  content: string;  // Markdown 格式的 prompt 内容
  enabled?: boolean;  // 是否启用（默认 true）
}

/**
 * PromptComponentRegistry — 用户级 Prompt 组件注册表
 */
export class PromptComponentRegistry {
  private components = new Map<string, PromptComponent>();
  private watchers: FSWatcher[] = [];
  private userId: string;
  private userPromptsDir: string;
  private templatePromptsDir: string;

  constructor(userId: string) {
    this.userId = userId;
    this.userPromptsDir = getUserPromptsDir(userId);
    this.templatePromptsDir = getTemplatePromptsDir();
  }

  /**
   * 初始化：加载内置 + 用户自定义组件
   */
  async init(): Promise<void> {
    log.info(`初始化 PromptComponentRegistry (user: ${this.userId})...`);

    // 确保用户目录存在
    await this.initializeUserPromptsDir();

    // 加载用户自定义组件
    await this.loadUserComponents();

    // 监听文件变化
    this.watchDirectory(this.userPromptsDir);

    log.info(`PromptComponentRegistry 初始化完成，已加载 ${this.components.size} 个自定义组件`);
  }

  /**
   * 初始化用户 prompts 目录
   */
  private async initializeUserPromptsDir(): Promise<void> {
    await fs.mkdir(this.userPromptsDir, { recursive: true });

    // 检查是否有配置文件
    const userFiles = await fs.readdir(this.userPromptsDir).catch(() => []);
    const hasConfigFiles = userFiles.some(file =>
      file.endsWith('.json5') || file.endsWith('.yaml') ||
      file.endsWith('.yml') || file.endsWith('.json')
    );

    // 如果用户目录为空，复制示例文件
    if (!hasConfigFiles) {
      log.info('用户 prompts 目录为空，正在创建示例文件...');
      await this.createExampleFiles();
    }
  }

  /**
   * 创建示例文件
   */
  private async createExampleFiles(): Promise<void> {
    // 从模板目录复制所有内置组件
    try {
      const templateFiles = await glob(this.templatePromptsDir + '/**/*.{json5,yaml,yml,json}');

      if (templateFiles.length === 0) {
        log.warn(`未找到模板 prompt 配置文件: ${this.templatePromptsDir}`);
        return;
      }

      log.info(`从模板复制 ${templateFiles.length} 个 Prompt 组件...`);

      for (const srcPath of templateFiles) {
        try {
          // 跳过 README.md
          if (srcPath.endsWith('README.md')) continue;

          const content = await fs.readFile(srcPath, 'utf-8');
          const fileName = path.basename(srcPath);
          const destPath = path.join(this.userPromptsDir, fileName);

          // 直接复制文件内容
          await fs.writeFile(destPath, content, 'utf-8');
          log.info(`复制: ${fileName}`);
        } catch (error: any) {
          log.error(`复制文件失败: ${srcPath}`, error.message);
        }
      }

      log.info('内置 Prompt 组件复制完成');
    } catch (error: any) {
      log.error('复制模板文件失败:', error.message);
    }
  }

  /**
   * 加载用户自定义组件
   */
  private async loadUserComponents(): Promise<void> {
    try {
      const stat = await fs.stat(this.userPromptsDir).catch(() => null);
      if (!stat?.isDirectory()) {
        log.warn('用户 prompts 目录不存在，跳过加载');
        return;
      }

      const files = await glob(this.userPromptsDir + '/**/*.{json5,yaml,yml,json}');
      log.info(`扫描用户 prompts 目录: ${this.userPromptsDir}`);

      for (const file of files) {
        await this.loadComponentConfig(file);
      }
    } catch (error: any) {
      log.error('加载用户组件失败:', error.message);
    }
  }

  /**
   * 加载单个组件配置文件
   */
  private async loadComponentConfig(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const ext = path.extname(filePath);

      let config: PromptComponentConfig;
      if (ext === '.json5' || ext === '.json') {
        config = JSON5.parse(content);
      } else if (ext === '.yaml' || ext === '.yml') {
        config = parseYAML(content);
      } else {
        log.warn(`不支持的文件格式: ${filePath}`);
        return;
      }

      // 验证配置
      if (!this.validateConfig(config)) {
        log.warn(`配置验证失败: ${filePath}`);
        return;
      }

      // 检查是否启用
      if (config.enabled === false) {
        log.debug(`组件已禁用: ${config.id}`);
        return;
      }

      // 转换为 PromptComponent
      const component = this.configToComponent(config);
      this.components.set(config.id, component);

      log.info(`加载用户组件: ${config.id} (${config.name})`);
    } catch (error: any) {
      log.error(`加载组件配置失败: ${filePath}`, error.message);
    }
  }

  /**
   * 验证配置
   */
  private validateConfig(config: any): config is PromptComponentConfig {
    if (!config.id || typeof config.id !== 'string') {
      log.warn('配置缺少 id 字段');
      return false;
    }
    if (!config.name || typeof config.name !== 'string') {
      log.warn('配置缺少 name 字段');
      return false;
    }
    if (!config.layer || !['L0', 'L1', 'L2', 'L3'].includes(config.layer)) {
      log.warn('配置 layer 字段无效');
      return false;
    }
    if (typeof config.priority !== 'number') {
      log.warn('配置缺少 priority 字段');
      return false;
    }
    if (!config.content || typeof config.content !== 'string') {
      log.warn('配置缺少 content 字段');
      return false;
    }
    return true;
  }

  /**
   * 将配置转换为 PromptComponent
   */
  private configToComponent(config: PromptComponentConfig): PromptComponent {
    const component: PromptComponent = {
      id: config.id,
      name: config.name,
      layer: config.layer,
      priority: config.priority,
      estimatedTokens: config.estimatedTokens,
      scenes: config.scenes,
      requiredTools: config.requiredTools,
      thinking: config.thinking,
      render: (_context: PromptBuildContext) => config.content,
    };

    // 添加场景匹配配置
    if (config.match) {
      const matchConfig: SceneMatchConfig = {
        keywords: new RegExp(config.match.keywords, 'i'),
        description: config.match.description,
      };
      component.match = matchConfig;
    }

    return component;
  }

  /**
   * 监听目录变化
   */
  private watchDirectory(dir: string): void {
    try {
      const watcher = watch(dir, { recursive: true }, async (eventType, filename) => {
        if (!filename) return;

        const ext = path.extname(filename);
        if (!['.json5', '.json', '.yaml', '.yml'].includes(ext)) return;

        const filePath = path.join(dir, filename);

        if (eventType === 'rename') {
          // 文件删除或重命名
          const exists = await fs.access(filePath).then(() => true).catch(() => false);
          if (!exists) {
            // 文件被删除，从注册表中移除
            for (const [id, component] of this.components.entries()) {
              // 简单匹配：假设文件名包含组件 id
              if (filename.includes(id)) {
                this.components.delete(id);
                log.info(`组件已移除: ${id}`);
              }
            }
          } else {
            // 文件被创建或重命名
            await this.loadComponentConfig(filePath);
          }
        } else if (eventType === 'change') {
          // 文件内容变化
          await this.loadComponentConfig(filePath);
        }
      });

      this.watchers.push(watcher);
      log.debug(`开始监听目录: ${dir}`);
    } catch (error: any) {
      log.warn(`监听目录失败: ${dir}`, error.message);
    }
  }

  /**
   * 获取所有用户自定义组件
   */
  getComponents(): Map<string, PromptComponent> {
    return new Map(this.components);
  }

  /**
   * 获取单个组件
   */
  getComponent(id: string): PromptComponent | undefined {
    return this.components.get(id);
  }

  /**
   * 停止监听
   */
  dispose(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    log.debug('PromptComponentRegistry 已释放');
  }
}
