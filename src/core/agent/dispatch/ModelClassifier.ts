// ============================================================
// Model Classifier - 基于本地小模型的场景分类器
// ============================================================

import { logger } from '@/core/logger';
import type { AgentRegistry } from '../AgentRegistry';
import { LLMFactory } from '@/core/model/LLMFactory';
import type { LLMProvider } from '@/core/model/LLMProvider';

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
  useRemoteAPI?: boolean; // 是否使用远程 API
  provider?: {
    adapter: string;
    baseURL?: string;
    apiKey?: string;
  };
  model?: {
    primary: string;
    maxTokens?: number;
    temperature?: number;
  };
}

const MODEL_IDS: Record<ClassifierModelType, string> = {
  'qwen2.5-0.5b-q4': 'hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:qwen2.5-0.5b-instruct-q4_k_m.gguf',
  'qwen2.5-1.5b-q4': 'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:qwen2.5-1.5b-instruct-q4_k_m.gguf',
  'chatglm3-6b-q4': 'hf:mradermacher/chatglm3-6b-GGUF:chatglm3-6b.Q4_K_M.gguf',
  'chatglm3-6b-q3': 'hf:mradermacher/chatglm3-6b-GGUF:chatglm3-6b.Q3_K_M.gguf',
  'glm4-9b-q4': 'hf:mradermacher/glm-4-9b-chat-GGUF:glm-4-9b-chat.Q4_K_M.gguf',
};

export class ModelClassifier {
  private llmProvider: LLMProvider | null = null;
  private initPromise: Promise<void> | null = null;
  private agentRegistry: AgentRegistry | null;
  private agentConfig: any = null; // 存储 scene-classifier 的完整配置

  constructor(agentRegistry?: AgentRegistry, config?: ModelClassifierConfig) {
    this.agentRegistry = agentRegistry ?? null;

    // 从 AgentRegistry 加载 scene-classifier 配置
    if (this.agentRegistry) {
      const classifierAgent = this.agentRegistry.get('scene-classifier');
      if (classifierAgent) {
        this.agentConfig = classifierAgent;
        log.info('[ModelClassifier] 从 AgentRegistry 加载 scene-classifier 配置');
        log.info(`[ModelClassifier] Provider: ${classifierAgent.provider?.adapter}`);
        log.info(`[ModelClassifier] Model: ${classifierAgent.model?.primary}`);
      } else {
        log.warn('[ModelClassifier] 未找到 scene-classifier 配置');
      }
    }
  }

  async init(): Promise<void> {
    log.info('[ModelClassifier] init() called');
    log.info('[ModelClassifier] Current agentConfig:', {
      adapter: this.agentConfig?.provider?.adapter,
      model: this.agentConfig?.model?.primary,
    });

    // 检查配置是否变化（从 AgentRegistry 重新读取）
    if (this.agentRegistry) {
      const classifierAgent = this.agentRegistry.get('scene-classifier');
      if (classifierAgent) {
        log.info('[ModelClassifier] Latest config from AgentRegistry:', {
          adapter: classifierAgent.provider?.adapter,
          model: classifierAgent.model?.primary,
        });

        // 检测关键配置是否变化
        const oldAdapter = this.agentConfig?.provider?.adapter;
        const oldModel = this.agentConfig?.model?.primary;
        const newAdapter = classifierAgent.provider?.adapter;
        const newModel = classifierAgent.model?.primary;

        const configChanged = oldAdapter !== newAdapter || oldModel !== newModel;

        if (configChanged) {
          log.info('[ModelClassifier] 检测到配置变化:');
          log.info(`  - adapter: ${oldAdapter} -> ${newAdapter}`);
          log.info(`  - model: ${oldModel} -> ${newModel}`);

          // 卸载旧 provider
          if (this.llmProvider) {
            log.info('[ModelClassifier] 卸载旧 provider...');
            await this.dispose();
          }

          this.agentConfig = classifierAgent;
        } else if (!this.agentConfig) {
          // 首次初始化
          log.info('[ModelClassifier] 首次初始化，使用配置');
          this.agentConfig = classifierAgent;
        } else {
          log.info('[ModelClassifier] 配置未变化');
        }
      }
    }

    // 如果已经初始化且配置未变化，直接返回
    if (this.llmProvider && this.llmProvider.isAvailable()) {
      log.info('[ModelClassifier] Provider already initialized and available');
      return;
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
    if (!this.agentConfig) {
      log.warn('[ModelClassifier] No agent config available, cannot initialize');
      return;
    }

    try {
      log.info('[ModelClassifier] Agent config:', {
        adapter: this.agentConfig.provider?.adapter,
        model: this.agentConfig.model?.primary,
        hasApiKey: !!this.agentConfig.provider?.apiKey,
      });

      // 处理 systemPrompt 占位符
      let systemPrompt = this.agentConfig.systemPrompt;
      if (systemPrompt && (systemPrompt.includes('{{SCENE_LIST}}') || systemPrompt.includes('{{AGENT_LIST}}'))) {
        systemPrompt = this.replacePlaceholders(systemPrompt);
        log.info('[ModelClassifier] 已替换 systemPrompt 中的动态占位符');
      }

      // 创建配置对象，包含处理后的 systemPrompt
      const configWithPrompt = {
        ...this.agentConfig,
        systemPrompt,
      };

      log.info(`[ModelClassifier] Creating LLM provider: adapter=${this.agentConfig.provider?.adapter}, model=${this.agentConfig.model?.primary}`);

      // 使用 LLMFactory 创建 provider
      this.llmProvider = LLMFactory.createFromAgentConfig(configWithPrompt);

      // 初始化 provider
      await this.llmProvider.init();

      log.info('[ModelClassifier] LLM provider initialized successfully');
    } catch (error: any) {
      log.warn(`[ModelClassifier] Failed to initialize: ${error.message}`);
      this.llmProvider = null;
    }
  }

  private replacePlaceholders(template: string): string {
    const agentList = this.buildAgentList();
    const sceneList = this.buildSceneList();

    return template
      .replace('{{SCENE_LIST}}', `可用的 scene（编程场景）:\n${sceneList}`)
      .replace('{{AGENT_LIST}}', `可用的 agent:\n${agentList}`);
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
    // 过滤掉系统内部 agent（scene-classifier 等）
    const userAgents = enabledAgents.filter(agent => {
      // 排除 scene-classifier
      if (agent.id === 'scene-classifier') return false;
      // 排除标记为 internal 的 agent
      if (agent.metadata?.internal === true) return false;
      // 排除 category 为 system 的 agent
      if (agent.metadata?.category === 'system') return false;
      return true;
    });

    if (userAgents.length === 0) {
      return '- general: 通用任务处理';
    }

    return userAgents
      .map(agent => {
        // 优先使用 description，如果有 capabilities 则追加
        let desc = agent.description || '通用任务处理';
        if (agent.capabilities && agent.capabilities.length > 0) {
          // 只显示前3个能力作为示例
          const capList = agent.capabilities.slice(0, 3).join('、');
          desc = `${desc}（能力：${capList}${agent.capabilities.length > 3 ? '等' : ''}）`;
        }
        return `- ${agent.id}: ${desc}`;
      })
      .join('\n');
  }

  private buildSceneList(): string {
    if (!this.agentRegistry) {
      return '- general: 通用场景';
    }

    const enabledAgents = this.agentRegistry.getEnabled();
    const allScenes = new Set<string>();

    // 从 agent 的 tags 中收集场景
    enabledAgents.forEach(agent => {
      if (agent.tags && Array.isArray(agent.tags)) {
        agent.tags.forEach(tag => allScenes.add(tag));
      }
    });

    // 从 agent 的 systemPrompt 中提取场景关键词
    const sceneKeywords = [
      { keyword: '探索', scene: 'explore', desc: '探索代码库、搜索文件、分析项目结构' },
      { keyword: '规划', scene: 'plan', desc: '规划设计、架构方案' },
      { keyword: '编码', scene: 'write_code', desc: '编写新代码、实现新功能' },
      { keyword: '编写代码', scene: 'write_code', desc: '编写新代码、实现新功能' },
      { keyword: '调试', scene: 'debug', desc: '调试问题、修复 bug、排查错误' },
      { keyword: '测试', scene: 'test', desc: '编写测试、测试用例' },
      { keyword: '重构', scene: 'refactor', desc: '重构代码、优化结构' },
      { keyword: '审查', scene: 'review', desc: '代码审查、质量检查' },
      { keyword: '解释', scene: 'explain', desc: '解释代码、文档说明' },
    ];

    enabledAgents.forEach(agent => {
      if (agent.systemPrompt) {
        sceneKeywords.forEach(({ keyword, scene }) => {
          if (agent.systemPrompt.includes(keyword)) {
            allScenes.add(scene);
          }
        });
      }
    });

    // 如果没有场景，返回默认
    if (allScenes.size === 0) {
      return '- general: 通用场景';
    }

    // 构建场景列表，包含描述
    const sceneDescMap = new Map(sceneKeywords.map(s => [s.scene, s.desc]));
    sceneDescMap.set('general', '通用场景、问答、其他');

    return Array.from(allScenes)
      .map(scene => {
        const desc = sceneDescMap.get(scene) || scene;
        return `- ${scene}: ${desc}`;
      })
      .join('\n');
  }


  async classify(userInput: string): Promise<ClassificationResult | null> {
    if (!this.llmProvider || !this.llmProvider.isAvailable()) {
      log.warn('[ModelClassifier] LLM provider not available, will fallback to other strategies');
      return null;
    }

    try {
      log.info(`[ModelClassifier] 🚀 开始分类: ${userInput.substring(0, 50)}...`);

      const output = await this.llmProvider.generate(userInput, {
        maxTokens: this.agentConfig?.model?.maxTokens ?? 128,
        temperature: this.agentConfig?.model?.temperature ?? 0.3,
      });

      log.info(`[ModelClassifier] ✅ 模型输出: ${output.substring(0, 200)}`);

      const result = this.parseClassificationResult(output);

      if (!result) {
        log.warn('[ModelClassifier] 解析失败，输出格式异常，will fallback to other strategies');
        return null;
      }

      log.info(`[ModelClassifier] ✅ 分类成功: scene=${result.scene}, agent=${result.agent}, complexity=${result.complexity}`);
      return result;
    } catch (error: any) {
      log.error('[ModelClassifier] Classification failed:', error.message);
      log.warn('[ModelClassifier] Will fallback to other strategies');
      return null;
    }
  }

  isAvailable(): boolean {
    return this.llmProvider?.isAvailable() ?? false;
  }

  getCurrentModel(): string {
    return this.llmProvider?.getModelId() ?? 'unknown';
  }

  async dispose(): Promise<void> {
    if (this.llmProvider) {
      await this.llmProvider.dispose();
      this.llmProvider = null;
    }
  }

  private parseClassificationResult(content: string): ClassificationResult | null {
    try {
      log.info(`[ModelClassifier] 解析模型输出: ${content}`);
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        log.warn('[ModelClassifier] 未找到 JSON 格式');
        return null;
      }

      const json = JSON.parse(jsonMatch[0]);
      log.info(`[ModelClassifier] 解析后的 JSON:`, json);

      if (!json.scene || !json.agent) {
        log.warn(`[ModelClassifier] 缺少必需字段: scene=${json.scene}, agent=${json.agent}, complexity=${json.complexity}`);
        return null;
      }

      // 如果没有 complexity 字段，使用默认值 'simple'
      let complexity: 'simple' | 'complex' = 'simple';
      if (json.complexity) {
        if (json.complexity !== 'simple' && json.complexity !== 'complex') {
          log.warn(`[ModelClassifier] Invalid complexity: ${json.complexity}, using 'simple'`);
        } else {
          complexity = json.complexity;
        }
      } else {
        log.debug(`[ModelClassifier] No complexity field, using default 'simple'`);
      }

      const result = { scene: json.scene, agent: json.agent, complexity };
      log.info(`[ModelClassifier] ✅ 解析成功:`, result);
      return result;
    } catch {
      return null;
    }
  }
}

