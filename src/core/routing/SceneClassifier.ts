/**
 * SceneClassifier — LLM 驱动的意图分类器。
 *
 * 读取 scene-classifier agent 配置，注入 scene 列表，调用非流式 LLM completion，
 * 解析 JSON 输出得到 { scene, complexity }。
 *
 * 失败（LLM 不可用、超时、解析错误）时返回 null，由 IntentRouter 降级到 L2。
 */

import type { ILLMProvider, ProviderConfig } from '@/shared/types/provider';
import type { AgentRegistry } from '@/core/agent/AgentRegistry';
import type { ConfigurableAgentConfig } from '@/core/agent/types';
import { ProviderManager } from '@/core/providers/ProviderManager';
import type { AppConfig } from '@/core/types';
import type { ClassifyResult } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SceneClassifier' });

const SCENE_CLASSIFIER_ID = 'scene-classifier';
const TIMEOUT_MS = 60000;

// 静态兜底 — SceneClassifier 初始化后会被动态场景列表覆盖
const FALLBACK_SCENES = new Set([
  'write_code', 'debug', 'refactor', 'review', 'test',
  'explore', 'plan', 'ui_design', 'design_system', 'interaction',
  'requirement', 'product_plan', 'user_research', 'discuss', 'stock_analysis',
]);

const FALLBACK_SCENE_DESCRIPTIONS: Record<string, string> = {
  write_code: '编写代码、实现功能',
  debug: '调试代码、修复bug',
  refactor: '重构代码、优化结构',
  review: '代码审查、质量评估',
  test: '编写测试',
  explore: '探索代码库、分析项目',
  plan: '架构设计、方案规划',
  ui_design: 'UI界面设计',
  design_system: '设计系统、组件库',
  interaction: '交互流程、原型设计',
  requirement: '用户需求分析',
  product_plan: '产品规划、路线图',
  user_research: '用户研究、访谈',
  discuss: '讨论、辩论、聊天话题',
  stock_analysis: '股票技术分析、基本面分析',
};

export interface SceneInfo {
  scene: string;
  description?: string;
  keywords?: string;
}

export class SceneClassifier {
  private agentRegistry: AgentRegistry;
  private globalConfig: AppConfig;
  private classifierConfig: ConfigurableAgentConfig | null = null;
  private systemPrompt: string | null = null;
  private provider: ILLMProvider | null = null;
  private initialized = false;
  private validScenes: Set<string> = FALLBACK_SCENES;
  private sceneDescriptions: Map<string, string> = new Map(
    Object.entries(FALLBACK_SCENE_DESCRIPTIONS),
  );
  private sceneKeywords: Map<string, string> = new Map();

  constructor(deps: {
    agentRegistry: AgentRegistry;
    globalConfig: AppConfig;
  }) {
    this.agentRegistry = deps.agentRegistry;
    this.globalConfig = deps.globalConfig;
  }

  /** 初始化：读取 scene-classifier 配置，注入模板变量，创建 provider */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const classifierConfig = this.agentRegistry.get(SCENE_CLASSIFIER_ID);
    if (!classifierConfig || classifierConfig.enabled === false) {
      log.warn(`SceneClassifier: "${SCENE_CLASSIFIER_ID}" agent ${classifierConfig ? 'disabled' : 'not found'}, L1 disabled`);
      return;
    }

    this.classifierConfig = classifierConfig;

    // 注入模板变量（只需要 SCENE_LIST，不再需要 AGENT_LIST）
    const sceneList = this.buildSceneList();

    this.systemPrompt = (classifierConfig.systemPrompt || '')
      .replace(/\{\{SCENE_LIST\}\}/g, sceneList);

    // 创建 provider
    const providerManager = new ProviderManager(this.globalConfig);
    this.provider = providerManager.getProvider(classifierConfig);

    this.initialized = true;
    log.info('SceneClassifier initialized', {
      hasProvider: !!this.provider,
      providerType: this.provider?.name,
      modelName: classifierConfig.model?.primary,
      promptLength: this.systemPrompt.length,
    });
  }

  /** 获取当前分类器使用的模型名称 */
  getModelName(): string | undefined {
    return this.classifierConfig?.model?.primary;
  }

  /** 调用 LLM 分类，失败返回 null */
  async classify(message: string): Promise<ClassifyResult | null> {
    if (!this.initialized || !this.provider || !this.systemPrompt) {
      log.debug('SceneClassifier not initialized, skipping L1');
      return null;
    }

    const providerConfig = this.buildProviderConfig();

    try {
      const raw = await this.callWithTimeout(message, providerConfig);
      if (!raw) return null;

      const result = this.parseJSON(raw);
      if (!result) {
        log.warn('SceneClassifier: failed to parse LLM output:', raw.substring(0, 300));
        return null;
      }

      log.info(`SceneClassifier raw output: ${raw.substring(0, 300)}`);

      return {
        scene: this.validateScene(result.scene),
        complexity: result.complexity === 'complex' ? 'complex' : 'simple',
        confidence: result.confidence ?? 0.8,
        modelName: this.classifierConfig?.model?.primary,
      };
    } catch (err) {
      log.warn('SceneClassifier: LLM call failed:', err);
      return null;
    }
  }

  /** 带超时的 LLM 调用，收集所有 stream chunk */
  private async callWithTimeout(message: string, providerConfig: ProviderConfig): Promise<string | null> {
    const provider = this.provider!;
    const systemPrompt = this.systemPrompt!;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: message },
    ];

    let text = '';
    let completed = false;

    const streamPromise = (async () => {
      try {
        for await (const event of provider.stream(messages, [], providerConfig)) {
          if (event.type === 'text_delta') {
            text += event.text;
          } else if (event.type === 'error') {
            log.warn('SceneClassifier stream error:', event.error);
            return;
          }
        }
        completed = true;
      } catch (err) {
        log.warn('SceneClassifier stream exception:', err);
      }
    })();

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => resolve(), TIMEOUT_MS);
    });

    await Promise.race([streamPromise, timeoutPromise]);

    if (!completed || !text.trim()) {
      log.debug('SceneClassifier: no output (timeout or empty)');
      return null;
    }

    return text.trim();
  }

  /** 注入动态场景列表（从 LayeredPromptBuilder 的 L1 组件获取） */
  setSceneList(scenes: SceneInfo[]): void {
    if (!scenes || scenes.length === 0) return;
    this.validScenes = new Set(scenes.map((s) => s.scene));
    this.sceneDescriptions = new Map(
      scenes.map((s) => [s.scene, s.description || '']),
    );
    this.sceneKeywords = new Map(
      scenes.filter((s) => s.keywords).map((s) => [s.scene, s.keywords!]),
    );
    log.info(`SceneClassifier: dynamic scene list updated (${scenes.length} scenes)`);
  }

  /** 校验 scene 是否合法，支持逗号分隔的多 scene。编造的 scene 会被过滤，全非法时返回空 */
  private validateScene(rawScene: string | undefined): string {
    if (!rawScene) return '';
    const scenes = rawScene.split(',').map((s) => s.trim()).filter(Boolean);
    const valid = scenes.filter((s) => this.validScenes.has(s));
    if (valid.length === 0) {
      log.debug(`SceneClassifier: all scenes invalid [${scenes.join(',')}], discarded`);
      return '';
    }
    if (valid.length < scenes.length) {
      log.debug(`SceneClassifier: filtered invalid scenes [${scenes.filter(s => !this.validScenes.has(s)).join(',')}]`);
    }
    return valid.join(',');
  }

  /** 从 LLM 输出中提取 JSON */
  private parseJSON(raw: string): { scene?: string; complexity?: string; confidence?: number } | null {
    // 1. 直接解析
    try {
      return JSON.parse(raw);
    } catch {}

    // 2. 提取 ```json ... ``` 代码块
    const codeBlock = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlock) {
      try {
        return JSON.parse(codeBlock[1]);
      } catch {}
    }

    // 3. 正则匹配第一个 JSON 对象
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {}
    }

    return null;
  }

  /** 构建 provider 配置（从 agent 配置读取模型参数 + 凭证） */
  private buildProviderConfig(): ProviderConfig {
    const cfg = this.classifierConfig;
    const provider = cfg?.provider ?? {};
    return {
      adapter: provider.adapter,
      model: cfg?.model?.primary || '',
      apiKey: provider.apiKey,
      baseURL: provider.baseURL,
      maxTokens: cfg?.model?.maxTokens ?? 256,
      temperature: cfg?.model?.temperature ?? 0.3,
      contextSize: (cfg?.model as any)?.contextSize,
    } as ProviderConfig;
  }

  /** 从动态场景列表构建 prompt 模板变量 */
  private buildSceneList(): string {
    const scenes: Array<{ scene: string; description: string; keywords: string }> = [];
    this.validScenes.forEach((scene) => {
      scenes.push({
        scene,
        description: this.sceneDescriptions.get(scene) || '',
        keywords: this.sceneKeywords.get(scene) || '',
      });
    });
    return scenes
      .map((s) => {
        let line = `- scene: ${s.scene}\n  description: ${s.description}`;
        if (s.keywords) line += `\n  keywords: ${s.keywords}`;
        return line;
      })
      .join('\n');
  }
}
