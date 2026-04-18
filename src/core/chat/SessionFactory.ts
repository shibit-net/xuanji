// ============================================================
// SessionFactory - 会话工厂
// ============================================================
// 负责创建和初始化 ChatSession 及其所有依赖
//
// 职责:
// 1. 加载配置
// 2. 初始化基础设施（Logger、Storage）
// 3. 初始化领域服务（Memory、Permission、Agent）
// 4. 初始化应用服务（SkillRouter、TurnManager）
// 5. 组装 SessionOrchestrator 和 ChatSession
//
// 使用 DependencyContainer 管理所有依赖
// ============================================================

import type { AppConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { IPermissionController } from '@/permission/types';
import type { SkillRegistry } from '@/core/skills';
import { DependencyContainer } from '@/core/di';
import { ConfigLoader } from '@/core/config/ConfigLoader';
import { ProviderManager } from '@/core/providers/ProviderManager';
import { ToolRegistry, createDefaultRegistry } from '@/core/tools/ToolRegistry';
import { MemoryManager } from '@/memory/MemoryManager';
import { PermissionController } from '@/permission/PermissionController';
import { SessionManager } from '@/session/SessionManager';
import { HookRegistry } from '@/hooks/HookRegistry';
import { AgentLoop } from '@/core/agent/AgentLoop';
import { SkillRouter } from './SkillRouter';
import { PromptOrchestrator } from './PromptOrchestrator';
import { TurnLifecycleManager } from './TurnLifecycleManager';
import { SessionOrchestrator, type SessionCallbacks } from './SessionOrchestrator';
import { ChatSession } from './ChatSession';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SessionFactory' });

/**
 * 会话创建选项
 */
export interface SessionOptions {
  /** 模型覆盖 */
  model?: string;
  /** 已有的配置（跳过加载） */
  config?: AppConfig;
  /** 已有的 Provider（跳过创建） */
  provider?: ILLMProvider;
  /** 已有的 ToolRegistry（跳过创建） */
  registry?: IToolRegistry;
  /** 会话回调 */
  callbacks?: SessionCallbacks;
  /** 项目根目录 */
  projectRoot?: string;
}

/**
 * SessionFactory - 会话工厂
 */
export class SessionFactory {
  private container: DependencyContainer;

  constructor() {
    this.container = new DependencyContainer();
  }

  /**
   * 创建会话
   */
  async create(options: SessionOptions = {}): Promise<ChatSession> {
    log.info('Creating session...');

    // 1. 加载配置
    const config = await this.loadConfig(options);
    this.container.registerSingleton('config', config);

    // 2. 初始化基础设施
    await this.initInfrastructure(config, options);

    // 3. 初始化领域服务
    await this.initDomainServices(config, options);

    // 4. 初始化应用服务
    await this.initApplicationServices(config, options);

    // 5. 创建编排器
    const orchestrator = await this.createOrchestrator(options.callbacks);

    // 6. 创建会话
    const session = new ChatSession(orchestrator, this.container);

    log.info('Session created successfully');
    return session;
  }

  /**
   * 加载配置
   */
  private async loadConfig(options: SessionOptions): Promise<AppConfig> {
    if (options.config) {
      log.debug('Using provided config');
      return options.config;
    }

    log.debug('Loading config...');
    const loader = new ConfigLoader();
    const config = await loader.load();

    // 模型覆盖
    if (options.model) {
      config.provider.model = options.model;
    }

    return config;
  }

  /**
   * 初始化基础设施层
   */
  private async initInfrastructure(config: AppConfig, options: SessionOptions): Promise<void> {
    log.debug('Initializing infrastructure...');

    // SessionManager
    this.container.register('sessionManager', () => {
      return new SessionManager({
        sessionConfig: config.session
      });
    });

    // HookRegistry
    this.container.register('hookRegistry', () => {
      return new HookRegistry(config.hooks || {});
    });

    // AgentRegistry
    this.container.register('agentRegistry', () => {
      const { AgentRegistry } = require('@/core/agent/AgentRegistry');
      return new AgentRegistry();
    });

    // 初始化 AgentRegistry
    try {
      const agentRegistry = await this.container.resolve('agentRegistry');
      await agentRegistry.init();
      log.info('🤖 Agent Registry initialized');
    } catch (err) {
      log.warn('Agent Registry init failed:', err);
    }

    // SkillRegistry
    this.container.register('skillRegistry', () => {
      const { SkillRegistry } = require('@/core/skills');
      return new SkillRegistry();
    });

    // 初始化 SkillRegistry
    try {
      const { initializeBuiltinSkills, SkillLoader } = require('@/core/skills');
      const skillRegistry = await this.container.resolve('skillRegistry');

      // 加载内置技能
      initializeBuiltinSkills(skillRegistry);

      // 加载自定义技能（如果配置了）
      const skillsConfig = config.skills;
      if (skillsConfig?.loadCustom && skillsConfig.customPath) {
        const loader = new SkillLoader(skillRegistry);
        await loader.load({
          loadBuiltin: false,
          loadCustom: true,
          customPath: skillsConfig.customPath,
        });
      }

      log.info('🎯 Skill Registry initialized');
    } catch (err) {
      log.warn('Skill Registry init failed:', err);
    }
  }

  /**
   * 初始化领域服务层
   */
  private async initDomainServices(config: AppConfig, options: SessionOptions): Promise<void> {
    log.debug('Initializing domain services...');

    // Provider
    this.container.register('provider', () => {
      if (options.provider) {
        return options.provider;
      }
      const manager = new ProviderManager(config);
      return manager.getProvider();
    });

    // ToolRegistry
    this.container.register('toolRegistry', () => {
      if (options.registry) {
        return options.registry;
      }
      return createDefaultRegistry();
    });

    // MemoryManager
    this.container.register('memoryManager', () => {
      return new MemoryManager(config.memory, options.projectRoot);
    });

    // PermissionController
    this.container.register('permissionController', () => {
      return new PermissionController(config.permission);
    });

    // 初始化 MemoryManager
    const memoryManager = await this.container.resolve<IMemoryStore>('memoryManager');
    await memoryManager.init?.();
  }

  /**
   * 初始化应用服务层
   */
  private async initApplicationServices(config: AppConfig, options: SessionOptions): Promise<void> {
    log.debug('Initializing application services...');

    const provider = await this.container.resolve<ILLMProvider>('provider');
    const registry = await this.container.resolve<IToolRegistry>('toolRegistry');
    const memoryManager = await this.container.resolve<IMemoryStore>('memoryManager');
    const permissionController = await this.container.resolve<IPermissionController>('permissionController');
    const hookRegistry = await this.container.resolve<HookRegistry>('hookRegistry');

    // 注入权限控制器到 ToolRegistry
    registry.setPermissionController?.(permissionController);

    // AgentLoop
    this.container.register('agentLoop', () => {
      // 将 AgentTuningConfig 转换为 AgentConfig
      const agentConfig: import('@/core/types').AgentConfig = {
        model: config.provider.model,
        apiKey: config.provider.apiKey,
        baseURL: config.provider.baseURL,
        maxTokens: config.provider.maxTokens,
        temperature: config.provider.temperature,
        maxIterations: config.agent?.maxIterations,
        compressor: config.agent?.compressor ? {
          enabled: config.agent.compressor.enabled ?? false,
          keepRecentRounds: 2,
          compressionThreshold: 0.8,
          minMessagesToCompress: 10,
          summaryMaxLength: 500,
        } : undefined,
        thinking: config.provider.thinking,
      };

      return new AgentLoop(
        provider,
        registry,
        agentConfig,
        memoryManager
      );
    });

    // SkillRouter
    this.container.register('skillRouter', () => {
      const agentLoop = this.container.resolveSync<AgentLoop>('agentLoop');
      // TODO: 实现完整的 SkillRouter 初始化
      // 目前暂时返回一个简单的实现
      return {
        tryRouteToSkill: async (input: string) => {
          // 暂时不路由到 Skill，直接返回 false 让 AgentLoop 处理
          return false;
        }
      } as any;
    });

    // PromptOrchestrator
    this.container.register('promptOrchestrator', () => {
      const agentLoop = this.container.resolveSync<AgentLoop>('agentLoop');
      const registry = this.container.resolveSync<IToolRegistry>('toolRegistry');
      const promptOrchestrator = new PromptOrchestrator(
        config,
        agentLoop,
        registry,
        () => null
      );

      // 注入 MemoryManager（启用 DecisionContext 注入）
      const memoryManager = this.container.resolveSync<IMemoryStore>('memoryManager');
      if (memoryManager && typeof (memoryManager as any).formatDecisionContext === 'function') {
        promptOrchestrator.setMemoryManager(memoryManager as any);
      }

      return promptOrchestrator;
    });

    // TurnLifecycleManager
    this.container.register('turnManager', () => {
      const sessionManager = this.container.resolveSync<SessionManager>('sessionManager');
      const agentLoop = this.container.resolveSync<AgentLoop>('agentLoop');

      return new TurnLifecycleManager(
        agentLoop,
        sessionManager,
        config,
        () => undefined
      );
    });
  }

  /**
   * 创建编排器
   */
  private async createOrchestrator(callbacks?: SessionCallbacks): Promise<SessionOrchestrator> {
    const agentLoop = await this.container.resolve<AgentLoop>('agentLoop');
    const skillRouter = await this.container.resolve<SkillRouter>('skillRouter');
    const promptOrchestrator = await this.container.resolve<PromptOrchestrator>('promptOrchestrator');

    // 先解析 sessionManager，确保它被缓存，因为 turnManager 需要它
    await this.container.resolve('sessionManager');

    const turnManager = await this.container.resolve<TurnLifecycleManager>('turnManager');

    return new SessionOrchestrator(
      agentLoop,
      skillRouter,
      turnManager,
      promptOrchestrator,
      callbacks
    );
  }

  /**
   * 获取依赖容器（用于测试）
   */
  getContainer(): DependencyContainer {
    return this.container;
  }
}
