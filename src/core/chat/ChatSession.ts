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
import { StateTracker } from '@/core/state/StateTracker';
import { TaskOrchestrator } from '@/core/task/TaskOrchestrator';
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
  private stateTracker: StateTracker;
  private _pendingQueue: string[] = [];
  private userId: string;
  private workingDir: string;
  private _drainRunning = false;
  private _currentAgentId = 'xuanji';

  constructor(
    agentLoop: AgentLoop,
    container: DependencyContainer,
    stateTracker: StateTracker,
    callbacks?: SessionCallbacks,
  ) {
    this.agentLoop = agentLoop;
    this.container = container;
    this.stateTracker = stateTracker;
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

    if (callbacks) {
      this.agentLoop.on(callbacks);
    }

    // 将待处理队列引用注入 AgentLoop，用于迭代边界检查
    agentLoop.setPendingQueue(this._pendingQueue);

    log.info('ChatSession initialized with StateTracker + TaskOrchestrator');
  }

  async run(input: string): Promise<void> {
    // 防止 re-entrancy：如果 AgentLoop 仍在运行，入队而非启动新轮次
    // StateTracker 可能与 AgentLoop.running 短暂不一致（如 outputting→executing 转换间隙），
    // AgentLoop.getState().status 才是权威来源
    if (this.agentLoop.getState().status !== 'idle') {
      // [ChatSession] run() REENTRANCY GUARD: agentLoop.running=${this.agentLoop.getState().status}, stateTracker=${this.stateTracker.getState()}, queuing. input="${input.substring(0, 60)}"`);
      log.warn('run() called while AgentLoop is still running, queuing instead');
      this._pendingQueue.push(input);
      return;
    }

    // [ChatSession] run() START: input="${input.substring(0, 60)}", stateTracker=${this.stateTracker.getState()}, pendingQueue=${this._pendingQueue.length}`);
    const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setLogContext({ execId, depth: 0 });
    log.info(`Session run started: input="${input.substring(0, 80)}"`);

    try {
      await this.callbacks?.onBeforeExecution?.(input);

      this.stateTracker.transitionTo('executing');
      const sessionCallbacks = this.callbacks as any;
      this.agentLoop.on({
        onText: (text: string) => {
          if (text.trim()) {
            this.stateTracker.transitionTo('outputting');
          }
          sessionCallbacks?.onText?.(text);
        },
        onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
          this.stateTracker.transitionTo('executing');
          sessionCallbacks?.onToolStart?.(id, name, input);
        },
      } as any);
      await this.agentLoop.run(input);
      // [ChatSession] run() agentLoop.run COMPLETED. stateTracker=${this.stateTracker.getState()}, pendingQueue=${this._pendingQueue.length}`);
      this.stateTracker.transitionTo('idle');
      // 清理后台任务 completion hint，防止残留到下次用户对话
      this.agentLoop.getContextManager().setSystemPromptSuffix('', 'async-task-completion');
      // [ChatSession] run() stateTracker -> idle. draining pendingQueue=${this._pendingQueue.length}`);
      await this.checkPendingCompletions();
      await this.drainPendingQueue();
      // [ChatSession] run() drain complete. pendingQueue=${this._pendingQueue.length}`);

      await this.callbacks?.onAfterExecution?.();
      log.info('Session run completed');
    } catch (error) {
      console.warn(`[ChatSession] run() CATCH BLOCK: ${(error as Error).message}. stateTracker=${this.stateTracker.getState()}, pendingQueue=${this._pendingQueue.length}`);
      log.error('Session run failed', error as Error);
      this.stateTracker.transitionTo('idle');
      this.drainPendingQueue();
      throw error;
    }
  }

  /** 由 IntentRouter 调用，设置当前执行的 agentId */
  setCurrentAgent(agentId: string): void {
    this._currentAgentId = agentId;
    log.info(`Current agent set to: ${agentId}`);
  }

  get currentAgentId(): string {
    return this._currentAgentId;
  }

  /**
   * 统一处理用户输入 — 根据 StateTracker 状态自动决策
   *
   * - idle / waiting_async → 直接 run
   * - executing / outputting → append 到队列，等当前工具调用或流式输出结束后自动处理
   *
   * 不再强制中断当前工具执行。用户新消息会被注入到 AgentLoop 的迭代边界检查点。
   * 终止请使用 stop() 或 requestAbort()。
   */
  handleUserInput(input: string): 'running' | 'queued' | 'interrupted' {
    const state = this.stateTracker.getState();
    log.info(`[handleUserInput] state=${state} input="${input.substring(0, 60)}"`);

    switch (state) {
      case 'idle':
      case 'waiting_async':
        // 二次确认 AgentLoop 确实空闲 — StateTracker 可能因竞态短暂不一致
        if (this.agentLoop.getState().status !== 'idle') {
          log.warn(`[handleUserInput] StateTracker=${state} but AgentLoop is still running, queuing`);
          this.appendMessage(input);
          return 'queued';
        }
        if (state === 'waiting_async') {
          this.agentLoop.getContextManager().setSystemPromptSuffix('', 'delegation-complete');
          this.agentLoop.getContextManager().setSystemPromptSuffix('', 'async-task-completion');
          this.agentLoop.getContextManager().setSystemPromptSuffix(
            '\\n用户发了新消息。后台任务完成后会自动通知你，不用主动查询或等待。直接处理用户的最新请求。',
            'new-message-during-async',
          );
        }
        this.run(input).catch((err) => {
          log.error('handleUserInput run failed:', err);
        });
        return 'running';

      case 'executing':
      case 'outputting':
        // 执行工具中或流式输出中 → 入队，等待当前迭代边界（工具结束/流式输出结束）自动处理
        this.appendMessage(input);
        return 'queued';

      default:
        this.run(input).catch((err) => {
          log.error('handleUserInput run failed:', err);
        });
        return 'running';
    }
  }

  /** 消费 pendingQueue 中的消息 */
  private async drainPendingQueue(): Promise<void> {
    if (this._pendingQueue.length === 0) return;
    if (this._drainRunning) return;

    this._drainRunning = true;
    log.info(`[drainPendingQueue] start draining, queue size=${this._pendingQueue.length}`);

    try {
      while (this._pendingQueue.length > 0) {
        const next = this._pendingQueue.shift()!;
        log.info(`[drainPendingQueue] processing: "${next.substring(0, 80)}"`);
        try {
          // 把队列里剩余的消息也合并进来，一次性处理
          const combined = [next];
          while (this._pendingQueue.length > 0) {
            combined.push(this._pendingQueue.shift()!);
          }
          await this.run(combined.join('\n'));
        } catch (err) {
          log.error('Drain pending message failed:', err);
        }
      }
    } finally {
      this._drainRunning = false;
      log.info('[drainPendingQueue] draining complete');
    }
  }

  private async checkPendingCompletions(): Promise<void> {
    try {
      const handler = TaskOrchestrator.getInstance().getCompletionHandler();
      if (!handler) return;

      if (handler.hasPending()) {
        handler.checkAndAutoSummarize();
      }
    } catch (err) {
      log.warn('Failed to check pending completions:', err);
    }
  }

  stop(): void {
    this.agentLoop.requestAbort();
  }

  /**
   * 硬中断（立即停止当前流式请求和工具执行）
   * 仅在极端情况下使用，正常终止请使用 stop()
   */
  hardStop(): void {
    this.agentLoop.stop();
  }

  interrupt(input: string): void {
    log.info(`[interrupt] stopping agent, state=${this.stateTracker.getState()}, input="${input.substring(0, 60)}"`);

    // 纯停止（无新输入）：硬中断，立即中止 LLM 流 + 工具执行
    if (!input.trim()) {
      this.hardStop();
      return;
    }

    // 中断 + 新消息：软中断，排队新输入，等当前迭代结束后消费
    this._pendingQueue.unshift(input);
    this.agentLoop.requestAbort();
    // 等 AgentLoop 停稳后统一消费整个队列
    const waitAndDrain = () => {
      if (this.agentLoop.getState().status !== 'idle') {
        setTimeout(waitAndDrain, 50);
        return;
      }
      this.drainPendingQueue();
    };
    setTimeout(waitAndDrain, 50);
  }

  appendMessage(message: string): void {
    this._pendingQueue.push(message);
    log.info(`[appendMessage] queued, pendingQueue size=${this._pendingQueue.length}, state=${this.stateTracker.getState()}`);
  }

  /**
   * 检查并消费 pendingQueue
   * 每次 run 结束后自动调用，也允许外部手动触发
   */
  checkPendingQueue(): void {
    if (this._pendingQueue.length > 0 && this.stateTracker.getState() !== 'executing') {
      this.drainPendingQueue();
    }
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

  getStateTracker(): StateTracker {
    return this.stateTracker;
  }

  getTaskOrchestrator(): TaskOrchestrator {
    return TaskOrchestrator.getInstance();
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
