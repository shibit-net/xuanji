// ============================================================
// ChatSession - 会话管理器
// ============================================================

import type { MainAgent } from '@/core/agent/dispatch/MainAgent';
import type { AgentCallbacks } from '@/core/agent/AgentLoop';
import { ModelClassifier } from '@/core/agent/dispatch/ModelClassifier';
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
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ChatSession' });

export interface SessionCallbacks extends AgentCallbacks {
  onBeforeExecution?: (input: string) => void | Promise<void>;
  onAfterExecution?: () => void | Promise<void>;
  onArchiveNotification?: (result: any) => void;
}

export class ChatSession {
  private mainAgent: MainAgent;
  private container: DependencyContainer;
  private callbacks?: SessionCallbacks;
  private modelClassifier: ModelClassifier | null = null;

  constructor(
    mainAgent: MainAgent,
    container: DependencyContainer,
    callbacks?: SessionCallbacks,
  ) {
    this.mainAgent = mainAgent;
    this.container = container;
    this.callbacks = callbacks;

    if (callbacks) {
      this.mainAgent.on(callbacks);
    }
  }

  async run(input: string): Promise<void> {
    log.debug('Running session');
    try {
      await this.callbacks?.onBeforeExecution?.(input);
      await this.mainAgent.run(input);
      await this.callbacks?.onAfterExecution?.();
    } catch (error) {
      await this.callbacks?.onError?.(error as Error);
      throw error;
    }
  }

  stop(): void {
    this.mainAgent.stop();
  }

  interrupt(input: string): void {
    this.mainAgent.interrupt(input);
  }

  reset(): void {
    this.mainAgent.reset();
  }

  getAgentLoop() {
    return this.mainAgent.getAgentLoop();
  }

  getContainer(): DependencyContainer {
    return this.container;
  }

  getMainAgent(): MainAgent {
    return this.mainAgent;
  }

  getState(): AgentState {
    return this.mainAgent.getState();
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

  getModelClassifier(): ModelClassifier {
    if (!this.modelClassifier) {
      const agentRegistry = this.getAgentRegistry();
      const classifierAgent = agentRegistry?.get('scene-classifier');
      const modelType = classifierAgent?.model?.primary as any;
      const systemPrompt = classifierAgent?.systemPrompt;
      this.modelClassifier = new ModelClassifier({
        ...(modelType && { modelType }),
        ...(systemPrompt && { systemPrompt }),
      });
      this.modelClassifier.init().catch((err) => {
        log.warn('ModelClassifier init failed:', err);
      });
    }
    return this.modelClassifier;
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
    const messages = this.mainAgent.getAgentLoop().getMessageManager().getMessages();
    return sessionManager.save(messages, name, options);
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

  async cleanup(): Promise<void> {}
}
