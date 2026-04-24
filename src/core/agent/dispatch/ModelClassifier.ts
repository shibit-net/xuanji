// ============================================================
// Model Classifier - 基于本地小模型的场景分类器
// ============================================================

import { LocalModelLoader } from './LocalModelLoader';
import { logger } from '@/core/logger';
import type { AgentRegistry } from '../AgentRegistry';

const log = logger.child({ module: 'ModelClassifier' });

export interface ClassificationResult {
  scene: string;
  agent: string;
  complexity: 'simple' | 'complex';
}

export type ClassifierModelType = 'qwen2.5-0.5b-q4' | 'qwen2.5-1.5b-q4' | 'chatglm3-6b-q4' | 'chatglm3-6b-q3' | 'glm4-9b-q4';

export interface ModelClassifierConfig {
  modelType?: ClassifierModelType;
  systemPrompt?: string;
}

const MODEL_IDS: Record<ClassifierModelType, string> = {
  'qwen2.5-0.5b-q4': 'hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:qwen2.5-0.5b-instruct-q4_k_m.gguf',
  'qwen2.5-1.5b-q4': 'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:qwen2.5-1.5b-instruct-q4_k_m.gguf',
  'chatglm3-6b-q4': 'hf:mradermacher/chatglm3-6b-GGUF:chatglm3-6b.Q4_K_M.gguf',
  'chatglm3-6b-q3': 'hf:mradermacher/chatglm3-6b-GGUF:chatglm3-6b.Q3_K_M.gguf',
  'glm4-9b-q4': 'hf:mradermacher/glm-4-9b-chat-GGUF:glm-4-9b-chat.Q4_K_M.gguf',
};

export class ModelClassifier {
  private modelLoader: LocalModelLoader | null = null;
  private initPromise: Promise<void> | null = null;
  private config: Required<ModelClassifierConfig>;
  private agentRegistry: AgentRegistry | null;

  constructor(agentRegistry?: AgentRegistry, config?: ModelClassifierConfig) {
    this.agentRegistry = agentRegistry ?? null;

    // 从 AgentRegistry 加载 scene-classifier 配置
    let systemPrompt: string | undefined;
    let modelType: ClassifierModelType = 'qwen2.5-0.5b-q4';

    if (this.agentRegistry) {
      const classifierAgent = this.agentRegistry.get('scene-classifier');
      if (classifierAgent) {
        systemPrompt = classifierAgent.systemPrompt;
        modelType = classifierAgent.model.primary as ClassifierModelType;
        log.info('从 AgentRegistry 加载 scene-classifier 配置');
      } else {
        log.warn('未找到 scene-classifier 配置，使用默认配置');
      }
    }

    this.config = {
      modelType: config?.modelType ?? modelType,
      systemPrompt: config?.systemPrompt ?? systemPrompt ?? this.getDefaultSystemPrompt(),
    };
  }

  private getDefaultSystemPrompt(): string {
    // 动态生成可用的 agent 和 scene 列表
    const agentList = this.buildAgentList();
    const sceneList = this.buildSceneList();

    return `你是一个智能任务分类器。根据用户输入，识别最合适的 scene、agent 和任务复杂度。

可用的 scene（编程场景）:
${sceneList}

可用的 agent:
${agentList}

任务复杂度判断：
- simple: 单一明确的任务，一个agent可以直接完成（如"修复这个bug"、"解释这段代码"）
- complex: 需要多步骤或多agent协作的任务（如"重构整个模块"、"实现新功能并测试"）

请严格按照以下 JSON 格式输出（不要有任何其他文字）:
{"scene": "scene_id", "agent": "agent_id", "complexity": "simple"|"complex"}`;
  }

  private buildAgentList(): string {
    if (!this.agentRegistry) {
      return '- general: 通用任务处理';
    }

    const enabledAgents = this.agentRegistry.getEnabled();
    return enabledAgents
      .map(agent => `- ${agent.id}: ${agent.description}`)
      .join('\n');
  }

  private buildSceneList(): string {
    if (!this.agentRegistry) {
      return '- general: 通用场景';
    }

    const enabledAgents = this.agentRegistry.getEnabled();
    const allScenes = new Set<string>();

    // 从所有 agent 的 tags 中收集场景
    enabledAgents.forEach(agent => {
      agent.tags.forEach(tag => allScenes.add(tag));
    });

    // 如果没有场景，返回默认
    if (allScenes.size === 0) {
      return '- general: 通用场景';
    }

    return Array.from(allScenes)
      .map(scene => `- ${scene}`)
      .join('\n');
  }

  async init(): Promise<void> {
    log.info('[ModelClassifier] init() called');

    // 如果 modelLoader 存在，检查模型文件是否仍然存在
    if (this.modelLoader) {
      const isDownloaded = this.modelLoader.isDownloaded();
      log.info(`[ModelClassifier] modelLoader exists, checking if model still downloaded: ${isDownloaded}`);

      if (isDownloaded) {
        // 文件仍然存在，无需重新初始化
        log.info('[ModelClassifier] Model file still exists, skipping init');
        return;
      } else {
        // 文件被删除了，需要重新初始化
        log.info('[ModelClassifier] Model file was deleted, reinitializing...');
        await this.dispose();
        this.modelLoader = null;
      }
    }

    if (this.initPromise) {
      log.info('[ModelClassifier] init already in progress, waiting...');
      await this.initPromise;
      return;
    }
    this.initPromise = this._init();
    await this.initPromise;
    this.initPromise = null;
  }

  private async _init(): Promise<void> {
    try {
      const modelId = MODEL_IDS[this.config.modelType];
      log.info(`[ModelClassifier] Initializing with ${this.config.modelType}...`);
      this.modelLoader = new LocalModelLoader({ modelId, systemPrompt: this.config.systemPrompt });

      // 检查模型是否已下载
      const isDownloaded = this.modelLoader.isDownloaded();
      log.info(`[ModelClassifier] Model downloaded: ${isDownloaded}`);

      if (isDownloaded) {
        // 已下载，直接加载到内存
        await this.modelLoader.load();
        log.info('[ModelClassifier] Model loaded successfully');
      } else {
        // 未下载，启动后台下载（不阻塞）
        log.info('[ModelClassifier] Model not found locally, starting background download...');
        this.modelLoader.predownload().then(() => {
          log.info('[ModelClassifier] Model download completed, loading to memory...');
          return this.modelLoader!.load();
        }).then(() => {
          log.info('[ModelClassifier] ModelClassifier ready after download');
        }).catch((err) => {
          log.warn(`[ModelClassifier] Background download failed: ${err.message}`);
          this.modelLoader = null;
        });
        // 不等待下载完成，直接返回（降级到 fallback）
      }
    } catch (error: any) {
      log.warn(`[ModelClassifier] Failed to initialize (will use fallback): ${error.message}`);
      this.modelLoader = null;
    }
  }

  async classify(userInput: string): Promise<ClassificationResult | null> {
    if (!this.modelLoader) return null;
    try {
      log.info(`[ModelClassifier] 🚀 开始本地模型分类: ${userInput.substring(0, 50)}...`);
      const output = await this.modelLoader.generate(userInput, { maxTokens: 128, temperature: 0.3 });
      log.info(`[ModelClassifier] ✅ 本地模型输出: ${output.substring(0, 100)}`);
      return this.parseClassificationResult(output);
    } catch (error: any) {
      log.error('Classification failed:', error.message);
      return null;
    }
  }

  private parseClassificationResult(content: string): ClassificationResult | null {
    try {
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return null;
      const json = JSON.parse(jsonMatch[0]);
      if (!json.scene || !json.agent || !json.complexity) return null;
      if (json.complexity !== 'simple' && json.complexity !== 'complex') return null;
      return { scene: json.scene, agent: json.agent, complexity: json.complexity };
    } catch {
      return null;
    }
  }

  isAvailable(): boolean {
    return this.modelLoader !== null && this.modelLoader.isLoaded();
  }

  getCurrentModel(): string {
    return this.config.modelType;
  }

  getSystemPrompt(): string {
    return this.config.systemPrompt;
  }

  async switchModel(modelType: ClassifierModelType): Promise<void> {
    if (modelType === this.config.modelType && this.modelLoader) return;
    await this.dispose();
    this.config.modelType = modelType;
    await this.init();
  }

  async dispose(): Promise<void> {
    if (this.modelLoader) {
      await this.modelLoader.unload();
      this.modelLoader = null;
    }
  }
}
