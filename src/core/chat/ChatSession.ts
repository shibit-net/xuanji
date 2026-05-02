// ============================================================
// ChatSession - 会话管理器
// ============================================================

import type { AgentLoop, AgentCallbacks } from '@/core/agent/AgentLoop';
import type { DependencyContainer } from '@/core/di';
import type { IPermissionController, ConfirmationHandler, PlanReviewHandler } from '@/permission/types';
import type { IToolRegistry, AppConfig, AgentState } from '@/core/types';
import type { AskUserHandler } from '@/core/tools/AskUserTool';
import type { PlanModeEnterHandler } from '@/core/tools/EnterPlanModeTool';
import type { PlanModeExitHandler } from '@/core/tools/ExitPlanModeTool';
import type { SessionManager } from '@/session/SessionManager';
import type { AgentRegistry } from '@/core/agent/AgentRegistry';
import type { SkillRegistry } from '@/core/skills';
import type { MCPManager } from '@/mcp/MCPManager';
import { ConversationManager } from '@/core/conversation/ConversationManager';
import { TaskOrchestrator } from '@/core/task/TaskOrchestrator';
import type { TaskStep, Task, TaskStepResult } from '@/core/task/types';
import { logger } from '@/core/logger';
import { setLogContext } from '@/core/logger/implementations/PinoLogger';

const log = logger.child({ module: 'ChatSession' });

export interface SessionCallbacks extends AgentCallbacks {
  onBeforeExecution?: (input: string) => void | Promise<void>;
  onAfterExecution?: () => void | Promise<void>;
  onArchiveNotification?: (result: any) => void;
}

export class ChatSession {
  private agentLoop: AgentLoop;
  private container: DependencyContainer;
  private callbacks?: SessionCallbacks;
  private conversationManager: ConversationManager;
  private taskOrchestrator: TaskOrchestrator;
  private userId: string;
  private workingDir: string;

  constructor(
    agentLoop: AgentLoop,
    container: DependencyContainer,
    conversationManager: ConversationManager,
    taskOrchestrator: TaskOrchestrator,
    callbacks?: SessionCallbacks,
  ) {
    this.agentLoop = agentLoop;
    this.container = container;
    this.conversationManager = conversationManager;
    this.taskOrchestrator = taskOrchestrator;
    this.callbacks = callbacks;
    this.userId = 'default';
    this.workingDir = process.cwd();

    try {
      const config = container.resolveSync<AppConfig>('config');
      const cfg = config as Record<string, any>;
      if (cfg.user?.id) this.userId = cfg.user.id;
      if (cfg.projectRoot) this.workingDir = cfg.projectRoot;
      else if (cfg.workspacePath) this.workingDir = cfg.workspacePath;
    } catch { /* 使用默认值 */ }

    this.taskOrchestrator.setExecutor(async (step: TaskStep, _task: Task): Promise<TaskStepResult> => {
      const start = Date.now();
      try {
        await this.agentLoop.run(step.input);
        return { success: true, output: `Agent completed step: ${step.description}`, duration: Date.now() - start };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err), duration: Date.now() - start };
      }
    });

    if (callbacks) {
      this.agentLoop.on(callbacks);
    }

    log.info('ChatSession initialized with ConversationManager + TaskOrchestrator');
  }

  async run(input: string): Promise<void> {
    // 生成 executionId 用于日志追踪
    const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setLogContext({ execId, depth: 0 });
    log.info(`Session run started: input="${input.substring(0, 80)}"`);

    try {
      await this.callbacks?.onBeforeExecution?.(input);

      // 主 agent 模式：不做意图分析，不路由 scene
      // scene 知识通过 list_scenes 工具按需获取
      // 所有任务执行通过 task 和 agent_team 工具委托给子 agent

      this.conversationManager.transitionTo('executing');
      await this.agentLoop.run(input);
      this.conversationManager.transitionTo('idle');

      // 检查是否有后台任务完成待处理
      await this.checkPendingCompletions();

      await this.callbacks?.onAfterExecution?.();
      log.info('Session run completed');
    } catch (error) {
      log.error('Session run failed', error as Error);
      this.conversationManager.transitionTo('idle');
      throw error;
    }
  }

  /**
   * 检查后台任务完成队列，如有待处理结果则触发主 agent 汇总
   */
  private async checkPendingCompletions(): Promise<void> {
    try {
      const handler = (this.taskOrchestrator as any).taskCompletionHandler;
      if (!handler) return;

      if (handler.hasPending()) {
        handler.injectPendingCompletions();
        handler.checkAndAutoSummarize();
      }
    } catch (err) {
      log.warn('Failed to check pending completions:', err);
    }
  }

  stop(): void {
    this.agentLoop.stop();
    const ctrl = this.conversationManager.activeAbortController;
    if (ctrl) ctrl.abort();
  }

  interrupt(input: string): void {
    this.conversationManager.interrupt(input);
    this.agentLoop.stop();
  }

  appendMessage(message: string): void {
    this.conversationManager.enqueue(message);
  }

  reset(): void {
    this.agentLoop.reset();
  }

  getAgentLoop(): AgentLoop {
    return this.agentLoop;
  }

  getContainer(): DependencyContainer {
    return this.container;
  }

  getState(): AgentState {
    return this.agentLoop.getState();
  }

  getConfig(): AppConfig {
    return this.container.resolveSync<AppConfig>('config');
  }

  setConfirmationHandler(handler: ConfirmationHandler): void {
    try {
      const permissionController = this.container.resolveSync<IPermissionController>('permissionController');
      permissionController.setConfirmationHandler(handler);
    } catch (error) {
      log.warn('Failed to set confirmation handler:', error);
    }
  }

  setPlanReviewHandler(handler: PlanReviewHandler): void {
    try {
      const permissionController = this.container.resolveSync<IPermissionController>('permissionController');
      permissionController.setPlanReviewHandler(handler);
    } catch (error) {
      log.warn('Failed to set plan review handler:', error);
    }
  }

  setAskUserHandler(handler: AskUserHandler): void {
    try {
      const toolRegistry = this.container.resolveSync<IToolRegistry>('toolRegistry');
      const askUserTool = toolRegistry.get('ask_user');
      if (askUserTool && 'setHandler' in askUserTool) {
        (askUserTool as any).setHandler(handler);
      }
    } catch (error) {
      log.warn('Failed to set ask user handler:', error);
    }
  }

  setPlanModeEnterHandler(handler: PlanModeEnterHandler): void {
    try {
      const toolRegistry = this.container.resolveSync<IToolRegistry>('toolRegistry');
      const tool = toolRegistry.get('enter_plan_mode');
      if (tool && 'setHandler' in tool) {
        (tool as any).setHandler(handler);
      }
    } catch (error) {
      log.warn('Failed to set plan mode enter handler:', error);
    }
  }

  setPlanModeExitHandler(handler: PlanModeExitHandler): void {
    try {
      const toolRegistry = this.container.resolveSync<IToolRegistry>('toolRegistry');
      const tool = toolRegistry.get('exit_plan_mode');
      if (tool && 'setHandler' in tool) {
        (tool as any).setHandler(handler);
      }
    } catch (error) {
      log.warn('Failed to set plan mode exit handler:', error);
    }
  }

  getPermissionController(): IPermissionController {
    return this.container.resolveSync<IPermissionController>('permissionController');
  }

  getSessionManager(): SessionManager {
    return this.container.resolveSync<SessionManager>('sessionManager');
  }

  getAgentRegistry(): AgentRegistry {
    return this.container.resolveSync<AgentRegistry>('agentRegistry');
  }

  getSkillRegistry(): SkillRegistry | null {
    try {
      return this.container.resolveSync<SkillRegistry>('skillRegistry');
    } catch {
      return null;
    }
  }

  getBaseRegistry(): IToolRegistry {
    return this.container.resolveSync<IToolRegistry>('toolRegistry');
  }

  getMCPManager(): MCPManager | null {
    try {
      return this.container.resolveSync<MCPManager>('mcpManager');
    } catch {
      return null;
    }
  }

  getConversationManager(): ConversationManager {
    return this.conversationManager;
  }

  getTaskOrchestrator(): TaskOrchestrator {
    return this.taskOrchestrator;
  }

  getUserId(): string {
    return this.userId;
  }

  getWorkingDir(): string {
    return this.workingDir;
  }

  getLayeredPromptBuilder(): import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder | null {
    try {
      return this.container.resolveSync('layeredPromptBuilder') as import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder;
    } catch {
      return null;
    }
  }

  async saveSession(name?: string, options?: any): Promise<string> {
    const sessionManager = this.getSessionManager();
    const messages = this.agentLoop.getContextManager().getMessages();
    return sessionManager.save(messages as any, name, options);
  }

  async resumeSession(sessionId: string): Promise<any> {
    return this.getSessionManager().resume(sessionId);
  }

  async listSessions(): Promise<any[]> {
    return this.getSessionManager().list();
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this.getSessionManager().delete(sessionId);
  }

  async createCheckpoint(label?: string): Promise<string> {
    log.warn('createCheckpoint not implemented');
    return '';
  }

  async listCheckpoints(): Promise<any[]> {
    return [];
  }

  async rewindToCheckpoint(checkpointId: string): Promise<number> {
    return 0;
  }

  async getDiagnostics(): Promise<any> {
    return { state: this.getState(), config: this.getConfig() };
  }

  async cleanup(): Promise<void> {
    log.debug('Cleaning up session');
    if (this.agentLoop) {
      this.agentLoop.stop();
    }
  }
}
