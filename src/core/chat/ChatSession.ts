// ============================================================
// ChatSession - 新架构会话管理器
// ============================================================
// 轻量级会话包装器，委托给 SessionOrchestrator 处理核心逻辑
//
// 职责:
// 1. 提供统一的会话接口
// 2. 管理依赖容器
// 3. 委托执行给 SessionOrchestrator
// ============================================================

import type { SessionOrchestrator } from './SessionOrchestrator';
import type { DependencyContainer } from '@/core/di';
import type { AgentLoop } from '@/core/agent/AgentLoop';
import type { IToolRegistry, AppConfig, ILLMProvider } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { IPermissionController } from '@/permission/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ChatSession' });

/**
 * 会话回调
 */
export interface SessionCallbacks {
  /** 执行前回调 */
  onBeforeExecution?: (input: string) => void | Promise<void>;
  /** 执行后回调 */
  onAfterExecution?: () => void | Promise<void>;
  /** 错误回调 */
  onError?: (error: Error) => void | Promise<void>;
  /** Skill 路由确认（confidence 0.6-0.9 时触发） */
  onSkillConfirm?: (skill: { id: string; name: string; description: string; slashCommand?: string }, confidence: number) => Promise<boolean>;
  /** 自动归档通知 */
  onArchiveNotification?: (result: {
    archivedCount: number;
    memoriesExtracted: number;
    summary?: string;
  }) => void;
  /** 启动引导回调（传递 LLM 生成的引导语） */
  onBootGuide?: (message: string) => void;
}

/**
 * ChatSession 初始化选项
 */
export interface ChatSessionOptions {
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
 * ChatSession - 新架构会话管理器
 */
export class ChatSession {
  constructor(
    private orchestrator: SessionOrchestrator,
    private container: DependencyContainer
  ) {}

  /**
   * 执行用户输入
   */
  async run(input: string): Promise<void> {
    log.debug('Running session with input');
    await this.orchestrator.execute(input);
  }

  /**
   * 停止执行
   */
  async stop(): Promise<void> {
    log.info('Stopping session');
    await this.orchestrator.stop();
  }

  /**
   * 中断并追加新输入
   */
  async interrupt(input: string): Promise<void> {
    log.info('Interrupting session');
    await this.orchestrator.interrupt(input);
  }

  /**
   * 获取 AgentLoop 实例
   */
  getAgentLoop(): AgentLoop {
    return this.container.resolveSync<AgentLoop>('agentLoop');
  }

  /**
   * 获取 ToolRegistry 实例
   */
  getToolRegistry(): IToolRegistry {
    return this.container.resolveSync<IToolRegistry>('toolRegistry');
  }

  /**
   * 获取 MemoryManager 实例
   */
  getMemoryManager(): IMemoryStore {
    return this.container.resolveSync<IMemoryStore>('memoryManager');
  }

  /**
   * 获取 PermissionController 实例
   */
  getPermissionController(): IPermissionController {
    return this.container.resolveSync<IPermissionController>('permissionController');
  }

  /**
   * 获取 AgentRegistry 实例
   */
  getAgentRegistry(): any {
    try {
      return this.container.resolveSync('agentRegistry');
    } catch {
      return null;
    }
  }

  /**
   * 获取依赖容器（用于高级用法）
   */
  getContainer(): DependencyContainer {
    return this.container;
  }

  /**
   * 重置会话状态
   */
  reset(): void {
    const agentLoop = this.getAgentLoop();
    agentLoop.reset();
  }

  /**
   * 获取当前状态
   */
  getState() {
    const agentLoop = this.getAgentLoop();
    return agentLoop.getState();
  }

  /**
   * 获取配置
   */
  getConfig() {
    return this.container.resolveSync('config');
  }

  // ============================================================
  // 会话管理方法（委托给 SessionManager）
  // ============================================================

  /**
   * 保存会话
   */
  async saveSession(name?: string, options?: any): Promise<string> {
    const sessionManager = this.container.resolveSync('sessionManager');
    return (sessionManager as any).saveSession(name, options);
  }

  /**
   * 恢复会话
   */
  async resumeSession(sessionId: string): Promise<any> {
    const sessionManager = this.container.resolveSync('sessionManager');
    return (sessionManager as any).resumeSession(sessionId);
  }

  /**
   * 列出所有会话
   */
  async listSessions(): Promise<any[]> {
    const sessionManager = this.container.resolveSync('sessionManager');
    return (sessionManager as any).listSessions();
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    const sessionManager = this.container.resolveSync('sessionManager');
    return (sessionManager as any).deleteSession(sessionId);
  }

  /**
   * 创建检查点
   */
  async createCheckpoint(label?: string): Promise<string> {
    const sessionManager = this.container.resolveSync('sessionManager');
    return (sessionManager as any).createCheckpoint(label);
  }

  /**
   * 列出检查点
   */
  async listCheckpoints(): Promise<any[]> {
    const sessionManager = this.container.resolveSync('sessionManager');
    return (sessionManager as any).listCheckpoints();
  }

  /**
   * 回退到检查点
   */
  async rewindToCheckpoint(checkpointId: string): Promise<number> {
    const sessionManager = this.container.resolveSync('sessionManager');
    return (sessionManager as any).rewindToCheckpoint(checkpointId);
  }

  /**
   * 获取诊断信息
   */
  async getDiagnostics(): Promise<any> {
    // TODO: 实现诊断信息收集
    return {
      session: {
        state: this.getState(),
        config: this.getConfig(),
      },
    };
  }

  // ============================================================
  // 交互 Handler 方法（委托给 PermissionController）
  // ============================================================

  /**
   * 设置权限确认 Handler
   */
  setConfirmationHandler(handler: any): void {
    const permissionController = this.getPermissionController();
    (permissionController as any).setConfirmationHandler?.(handler);
  }

  /**
   * 设置计划审查 Handler
   */
  setPlanReviewHandler(handler: any): void {
    const permissionController = this.getPermissionController();
    (permissionController as any).setPlanReviewHandler?.(handler);
  }

  /**
   * 设置用户提问 Handler
   */
  setAskUserHandler(handler: any): void {
    const permissionController = this.getPermissionController();
    (permissionController as any).setAskUserHandler?.(handler);
  }

  /**
   * 设置 Plan Mode 进入 Handler
   */
  setPlanModeEnterHandler(handler: any): void {
    const permissionController = this.getPermissionController();
    (permissionController as any).setPlanModeEnterHandler?.(handler);
  }

  /**
   * 设置 Plan Mode 退出 Handler
   */
  setPlanModeExitHandler(handler: any): void {
    const permissionController = this.getPermissionController();
    (permissionController as any).setPlanModeExitHandler?.(handler);
  }

  /**
   * 设置计划确认 Handler
   */
  setPlanConfirmHandler(handler: any): void {
    const permissionController = this.getPermissionController();
    (permissionController as any).setPlanConfirmHandler?.(handler);
  }

  // ============================================================
  // 回调和监听器方法
  // ============================================================

  /**
   * 注册 Agent 回调
   */
  on(callbacks: any): void {
    const agentLoop = this.getAgentLoop();
    if (agentLoop && typeof (agentLoop as any).on === 'function') {
      (agentLoop as any).on(callbacks);
    }
  }

  /**
   * 移除监听器
   */
  removeListener(): void {
    const agentLoop = this.getAgentLoop();
    if (agentLoop && typeof (agentLoop as any).removeListener === 'function') {
      (agentLoop as any).removeListener();
    }
  }

  /**
   * 设置会话回调
   */
  setSessionCallbacks(callbacks: SessionCallbacks): void {
    // 新架构中回调通过 SessionOrchestrator 管理
    // 这里保持接口兼容性
    log.debug('setSessionCallbacks called (delegated to orchestrator)');
  }

  // ============================================================
  // 获取其他组件实例
  // ============================================================

  /**
   * 获取 SkillRegistry 实例
   */
  getSkillRegistry(): any {
    try {
      return this.container.resolveSync('skillRegistry');
    } catch {
      return null;
    }
  }

  /**
   * 获取 SessionManager 实例
   */
  getSessionManager(): any {
    try {
      return this.container.resolveSync('sessionManager');
    } catch {
      return null;
    }
  }

  /**
   * 获取 HookRegistry 实例
   */
  getHookRegistry(): any {
    try {
      return this.container.resolveSync('hookRegistry');
    } catch {
      return null;
    }
  }

  /**
   * 获取基础工具注册表
   */
  getBaseRegistry(): any {
    // 新架构中只有一个统一的 ToolRegistry
    return this.getToolRegistry();
  }

  /**
   * 获取 MCP 管理器
   */
  getMCPManager(): any {
    try {
      return this.container.resolveSync('mcpManager');
    } catch {
      return null;
    }
  }

  /**
   * 获取模板仓库
   */
  getTemplateRepo(): any {
    try {
      return this.container.resolveSync('templateRepo');
    } catch {
      return null;
    }
  }

  // ============================================================
  // 状态检查和清理
  // ============================================================

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return true; // 新架构中，ChatSession 创建即初始化完成
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    log.info('Cleaning up session');
    await this.stop();

    // 清理各个组件
    try {
      const memoryManager = this.getMemoryManager();
      if (memoryManager && typeof (memoryManager as any).cleanup === 'function') {
        await (memoryManager as any).cleanup();
      }
    } catch (err) {
      log.warn('Failed to cleanup memory manager:', err);
    }
  }
}
