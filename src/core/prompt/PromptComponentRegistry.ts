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
 * 文件格式: YAML
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
import { createHash } from 'node:crypto';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';
import { promisify } from 'node:util';
import globCb from 'glob';
import type { PromptComponent, PromptBuildContext, SceneMatchConfig } from './types';
import { logger } from '@/core/logger';
import { getUserPromptsDir, getProjectPromptsDir, getTemplatePromptsDir } from '@/core/config/PathManager';

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
  collaborationHint?: string;  // 复杂任务的协作建议（仅L1场景组件）
  suitableFor?: string[];  // 适用任务类型（仅L1场景组件）
  requiredCapabilities?: string[];  // 需要的能力（仅L1场景组件）
  content: string;  // Markdown 格式的 prompt 内容
  enabled?: boolean;  // 是否启用（默认 true）
}

/**
 * 组件变化事件类型
 */
export type ComponentChangeEvent = {
  type: 'added' | 'updated' | 'removed';
  componentId: string;
  component?: PromptComponent;
};

export type ComponentChangeListener = (event: ComponentChangeEvent) => void;

/**
 * PromptComponentRegistry — Prompt 组件注册表
 * 支持从用户目录和项目目录双源加载
 */
export class PromptComponentRegistry {
  private components = new Map<string, PromptComponent>();
  private watchers: FSWatcher[] = [];
  private changeListeners: ComponentChangeListener[] = [];
  private userId: string;
  private projectRoot?: string;
  private userPromptsDir: string;
  private projectPromptsDir?: string;
  private templatePromptsDir: string;

  constructor(userId: string, projectRoot?: string) {
    this.userId = userId;
    this.projectRoot = projectRoot;
    this.userPromptsDir = getUserPromptsDir(userId);
    if (projectRoot) {
      this.projectPromptsDir = getProjectPromptsDir(projectRoot);
    }
    this.templatePromptsDir = getTemplatePromptsDir();
  }

  getProjectRoot(): string | undefined {
    return this.projectRoot;
  }

  getUserId(): string {
    return this.userId;
  }

  /**
   * 添加组件变化监听器
   */
  addChangeListener(listener: ComponentChangeListener): void {
    this.changeListeners.push(listener);
  }

  /**
   * 移除组件变化监听器
   */
  removeChangeListener(listener: ComponentChangeListener): void {
    const index = this.changeListeners.indexOf(listener);
    if (index > -1) {
      this.changeListeners.splice(index, 1);
    }
  }

  /**
   * 触发组件变化事件
   */
  private emitChange(event: ComponentChangeEvent): void {
    for (const listener of this.changeListeners) {
      try {
        listener(event);
      } catch (error: any) {
        log.error('组件变化监听器执行失败:', error.message);
      }
    }
  }

  /**
   * 初始化：加载内置 + 用户自定义组件 + 项目组件
   */
  async init(): Promise<void> {
    log.debug(`初始化 PromptComponentRegistry (user: ${this.userId}, project: ${this.projectRoot || 'none'})...`);

    // 确保用户目录存在
    await this.initializeUserPromptsDir();

    // 加载用户自定义组件
    await this.loadUserComponents();

    // 如果有项目路径，加载项目组件
    if (this.projectPromptsDir) {
      await this.loadProjectComponents();
    }

    // 监听文件变化
    this.watchDirectory(this.userPromptsDir);
    if (this.projectPromptsDir) {
      this.watchDirectory(this.projectPromptsDir);
    }

    log.debug(`PromptComponentRegistry 初始化完成，已加载 ${this.components.size} 个自定义组件`);
  }

  /**
   * 初始化用户 prompts 目录
   */
  private async initializeUserPromptsDir(): Promise<void> {
    await fs.mkdir(this.userPromptsDir, { recursive: true });

    // 检查是否有配置文件
    const userFiles = await fs.readdir(this.userPromptsDir).catch(() => []);
    const hasConfigFiles = userFiles.some(file =>
      file.endsWith('.yaml') || file.endsWith('.yml')
    );

    // 如果用户目录为空，复制所有模板文件
    if (!hasConfigFiles) {
      log.info('用户 prompts 目录为空，正在创建示例文件...');
      await this.createExampleFiles();
      return;
    }

    // 同步模板目录中新增的文件到用户目录（不覆盖已有文件）
    await this.syncNewTemplates(userFiles);
  }

  private get syncStatePath(): string {
    return path.join(this.userPromptsDir, '.sync-state.json');
  }

  private async loadSyncState(): Promise<Record<string, string>> {
    try {
      const raw = await fs.readFile(this.syncStatePath, 'utf-8');
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private async saveSyncState(state: Record<string, string>): Promise<void> {
    await fs.writeFile(this.syncStatePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * 智能同步模板目录中的内置 prompt 组件到用户目录
   *
   * 通过 .sync-state.json 存储每个模板的 hash 值：
   * - 新文件：直接复制 + 记录 hash
   * - 模板未变更：跳过（不覆盖用户可能的自定义）
   * - 模板已变更 + 用户未自定义（用户文件 hash == 旧模板 hash）：覆盖更新
   * - 模板已变更 + 用户已自定义（用户文件 hash != 旧模板 hash）：跳过，保护用户修改
   */
  private async syncNewTemplates(userFiles: string[]): Promise<void> {
    try {
      const templateFiles = await glob(this.templatePromptsDir + '/**/*.{yaml,yml}');
      const syncState = await this.loadSyncState();

      let synced = 0;
      let updated = 0;
      let skipped = 0;

      for (const srcPath of templateFiles) {
        const fileName = path.basename(srcPath);
        if (fileName === 'README.md') continue;

        try {
          const templateContent = await fs.readFile(srcPath, 'utf-8');
          const templateHash = this.computeHash(templateContent);
          const destPath = path.join(this.userPromptsDir, fileName);

          if (!userFiles.includes(fileName)) {
            // 新文件：复制并记录 hash
            await fs.writeFile(destPath, templateContent, 'utf-8');
            syncState[fileName] = templateHash;
            synced++;
            continue;
          }

          // 文件已存在：跳过（用户可能已自定义，不覆盖模板更新）
          skipped++;
        } catch (error: any) {
          log.error(`同步文件失败: ${srcPath}`, error.message);
        }
      }

      await this.saveSyncState(syncState);

      if (synced > 0 || updated > 0 || skipped > 0) {
        log.info(`Prompt 组件同步完成: ${synced} 新增, ${updated} 更新, ${skipped} 跳过（用户自定义）`);
      }
    } catch (error: any) {
      log.warn('同步模板文件失败:', error.message);
    }
  }

  /**
   * 创建示例文件
   */
  private async createExampleFiles(): Promise<void> {
    // 从模板目录复制所有内置组件到用户目录
    try {
      const templateFiles = await glob(this.templatePromptsDir + '/**/*.{yaml,yml}');

      if (templateFiles.length === 0) {
        log.warn(`未找到模板 prompt 配置文件: ${this.templatePromptsDir}`);
        return;
      }

      log.info(`从模板复制 ${templateFiles.length} 个 Prompt 组件到用户目录...`);

      const syncState: Record<string, string> = {};

      for (const srcPath of templateFiles) {
        try {
          // 跳过 README.md
          if (srcPath.endsWith('README.md')) continue;

          const content = await fs.readFile(srcPath, 'utf-8');
          const fileName = path.basename(srcPath);
          const destPath = path.join(this.userPromptsDir, fileName);

          // 直接复制文件内容
          await fs.writeFile(destPath, content, 'utf-8');
          // 记录模板 hash，用于后续智能同步
          syncState[fileName] = this.computeHash(content);
          log.info(`复制: ${fileName}`);
        } catch (error: any) {
          log.error(`复制文件失败: ${srcPath}`, error.message);
        }
      }

      await this.saveSyncState(syncState);

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

      const files = await glob(this.userPromptsDir + '/**/*.{yaml,yml}');
      log.info(`扫描用户 prompts 目录: ${this.userPromptsDir}`);

      for (const file of files) {
        await this.loadComponentConfig(file, 'user', false); // 初始加载不触发事件
      }
    } catch (error: any) {
      log.error('加载用户组件失败:', error.message);
    }
  }

  /**
   * 加载项目组件
   */
  private async loadProjectComponents(): Promise<void> {
    if (!this.projectPromptsDir) return;

    try {
      const stat = await fs.stat(this.projectPromptsDir).catch(() => null);
      if (!stat?.isDirectory()) {
        log.debug('项目 prompts 目录不存在，跳过加载');
        return;
      }

      const files = await glob(this.projectPromptsDir + '/**/*.{yaml,yml}');
      log.info(`扫描项目 prompts 目录: ${this.projectPromptsDir}`);

      for (const file of files) {
        await this.loadComponentConfig(file, 'project', false); // 初始加载不触发事件
      }
    } catch (error: any) {
      log.error('加载项目组件失败:', error.message);
    }
  }

  /**
   * 加载单个组件配置文件
   */
  private async loadComponentConfig(filePath: string, source: 'user' | 'project' = 'user', emitEvent = true): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const config: PromptComponentConfig = parseYAML(content);

      // 验证配置
      if (!this.validateConfig(config)) {
        log.warn(`配置验证失败: ${filePath}`);
        return;
      }

      // 检查是新增还是更新
      const isUpdate = this.components.has(config.id);

      // 转换为 PromptComponent（始终加载，含 enabled 状态）
      const component = this.configToComponent(config, source);
      component.enabled = config.enabled ?? true;
      this.components.set(config.id, component);

      log.info(`加载${source === 'user' ? '用户' : '项目'}组件: ${config.id} (${config.name})`);

      // 触发变化事件
      if (emitEvent) {
        this.emitChange({
          type: isUpdate ? 'updated' : 'added',
          componentId: config.id,
          component,
        });
      }
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
  private configToComponent(config: PromptComponentConfig, source: 'user' | 'project' = 'user'): PromptComponent {
    const component: PromptComponent = {
      id: config.id,
      name: config.name,
      layer: config.layer,
      priority: config.priority,
      estimatedTokens: config.estimatedTokens,
      scenes: config.scenes,
      requiredTools: config.requiredTools,
      thinking: config.thinking,
      source, // 标记来源
      render: (_context: PromptBuildContext) => config.content,
    };

    // 添加场景匹配配置
    if (config.match) {
      const matchConfig: SceneMatchConfig = {
        keywords: new RegExp(config.match.keywords, 'i'),
        description: config.match.description,
        requiredCapabilities: config.requiredCapabilities || [],
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
        if (!['.yaml', '.yml'].includes(ext)) return;

        const filePath = path.join(dir, filename);
        const source = dir === this.userPromptsDir ? 'user' : 'project';

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
                this.emitChange({ type: 'removed', componentId: id });
              }
            }
          } else {
            // 文件被创建或重命名
            await this.loadComponentConfig(filePath, source, true);
          }
        } else if (eventType === 'change') {
          // 文件内容变化
          await this.loadComponentConfig(filePath, source, true);
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
   * 保存组件到文件
   */
  async saveComponent(component: PromptComponent): Promise<void> {
    try {
      const filePath = path.join(this.projectPromptsDir ?? this.userPromptsDir, `${component.id}.yaml`);

      // 将 PromptComponent 转换为配置格式
      const renderedContent = typeof component.render === 'function'
        ? await component.render({} as PromptBuildContext)
        : '';

      const config: PromptComponentConfig = {
        id: component.id,
        name: component.name,
        layer: component.layer,
        scenes: component.scenes,
        priority: component.priority,
        estimatedTokens: component.estimatedTokens,
        requiredTools: component.requiredTools,
        thinking: component.thinking,
        content: renderedContent,
        enabled: (component as any).enabled ?? true,
      };

      // 如果有 match 配置，添加到配置中
      if (component.match) {
        config.match = {
          keywords: component.match.keywords.source,
          description: component.match.description,
        };
      }

      const content = stringifyYAML(config);
      await fs.writeFile(filePath, content, 'utf-8');
      log.info(`组件已保存: ${component.id}`);
    } catch (error: any) {
      log.error(`保存组件失败: ${component.id}`, error.message);
      throw error;
    }
  }

  /**
   * 删除用户自定义组件
   */
  async deleteComponent(id: string): Promise<void> {
    try {
      const filePath = path.join(this.userPromptsDir, `${id}.yaml`);
      await fs.unlink(filePath);
      log.info(`组件已删除: ${id}`);
    } catch (error: any) {
      log.error(`删除组件失败: ${id}`, error.message);
      throw error;
    }
  }

  /**
   * 创建新的 Prompt 组件（写入用户目录）
   */
  async createComponent(config: PromptComponentConfig): Promise<void> {
    try {
      const filePath = path.join(this.userPromptsDir, `${config.id}.yaml`);
      const content = stringifyYAML(config);
      await fs.writeFile(filePath, content, 'utf-8');
      log.info(`组件已创建: ${config.id}`);
    } catch (error: any) {
      log.error(`创建组件失败: ${config.id}`, error.message);
      throw error;
    }
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

  /**
   * 获取组件的原始配置（包含 collaborationHint 等字段）
   */
  async getComponentConfig(componentId: string): Promise<PromptComponentConfig | null> {
    try {
      // 先尝试从用户目录加载
      const userPath = path.join(this.userPromptsDir, `${componentId}.yaml`);
      if (await fs.stat(userPath).then(() => true).catch(() => false)) {
        const content = await fs.readFile(userPath, 'utf-8');
        return parseYAML(content);
      }

      // 再尝试从项目目录加载
      if (this.projectPromptsDir) {
        const projectPath = path.join(this.projectPromptsDir, `${componentId}.yaml`);
        if (await fs.stat(projectPath).then(() => true).catch(() => false)) {
          const content = await fs.readFile(projectPath, 'utf-8');
          return parseYAML(content);
        }
      }

      // 最后尝试从模板目录加载
      const templatePath = path.join(this.templatePromptsDir, `${componentId}.yaml`);
      if (await fs.stat(templatePath).then(() => true).catch(() => false)) {
        const content = await fs.readFile(templatePath, 'utf-8');
        return parseYAML(content);
      }

      return null;
    } catch (error: any) {
      log.error(`获取组件配置失败: ${componentId}`, error.message);
      return null;
    }
  }
}
