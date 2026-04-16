import type { AgentLoop } from '@/core/agent/AgentLoop';
import type { SkillRegistry } from '@/core/skills';
import type { SessionCallbacks } from './ChatSession';
import type { MemoryManager } from '@/memory/MemoryManager';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SkillRouter' });

// ────────── 显式记忆意图关键词 ──────────

/** 核心规则意图：用户在设定不可违反的底线 */
const CORE_RULE_PATTERNS = [
  /你?永远(不|别|不要|不能)/,
  /你?绝对(不|别|不要|不能)/,
  /这是我的底线/,
  /这是(一条)?规则/,
  /必须(始终|一直|永远)/,
  /任何情况下都(不|别|不要|不能)/,
];

/** 普通记忆意图：用户希望记住某件事 */
const MEMORY_SAVE_PATTERNS = [
  /^记住[，,：:]/,
  /^帮我记住/,
  /^请记住/,
  /以后(都|每次)?(要|请|需要)/,
  /下次(记得|要|请)/,
  /记一下/,
];

export class SkillRouter {
  constructor(
    private readonly agentLoop: AgentLoop,
    private readonly skillRegistry: SkillRegistry,
    private readonly intentRouter: import('@/core/intent').IntentRouter,
    private readonly sessionCallbacks: SessionCallbacks | undefined,
    private readonly onTurnComplete: () => void,
    private readonly memoryManager?: MemoryManager,
  ) {}

  async tryRouteToSkill(userMessage: string): Promise<boolean> {
    // 1. 优先检测显式记忆意图（不走 IntentRouter，直接处理）
    const memoryRouted = await this.tryRouteToMemory(userMessage);
    if (memoryRouted) return true;

    // 2. 常规 Skill 路由
    try {
      const intents = await this.intentRouter.route(userMessage, [], {
        threshold: 0.6,
        topK: 1,
        enableLLM: false,
      });

      if (intents.length === 0) return false;

      const topIntent = intents[0];
      const { CapabilityAssembler } = await import('@/core/intent');
      const assembler = new CapabilityAssembler((this.intentRouter as any).registry);
      const topModule = assembler.getTopModule(intents);

      if (!topModule || topModule.moduleType !== 'skill') return false;

      const skill = this.skillRegistry.get(topModule.moduleId);
      if (!skill?.execute) return false;

      const confidence = topIntent.confidence;
      log.info(`IntentRouter: skill="${skill.id}" confidence=${confidence.toFixed(2)}`);

      if (confidence >= 0.9) {
        log.info(`Direct skill execution: ${skill.id}`);
        await this.executeSkill(skill, userMessage);
        return true;
      }

      if (this.sessionCallbacks?.onSkillConfirm) {
        const confirmed = await this.sessionCallbacks.onSkillConfirm(
          { id: skill.id, name: skill.name, description: skill.description, slashCommand: skill.slashCommand },
          confidence,
        );
        if (confirmed) {
          await this.executeSkill(skill, userMessage);
          return true;
        }
      }
    } catch (err) {
      log.debug('tryRouteToSkill failed, fallback to AgentLoop:', err);
    }
    return false;
  }

  /**
   * 检测显式记忆意图，直接写入 CoreRuleStore 或 MemoryManager
   * 返回 true 表示已处理，跳过 AgentLoop
   */
  private async tryRouteToMemory(userMessage: string): Promise<boolean> {
    if (!this.memoryManager) return false;

    const trimmed = userMessage.trim();

    // 检测核心规则意图
    const isCoreRule = CORE_RULE_PATTERNS.some((re) => re.test(trimmed));
    if (isCoreRule) {
      const coreRuleStore = this.memoryManager.getCoreRuleStore();
      const rule = coreRuleStore.add({
        rule: trimmed,
        category: 'behavior',
        source: 'user_explicit',
      });
      log.info(`Core rule added via SkillRouter: ${rule.id}`);

      const confirmText = `✅ 已记住这条规则：「${trimmed}」\n我会始终遵守，不会违反。`;
      this.agentLoop.getMessageManager().addAssistantMessage([{ type: 'text', text: confirmText }]);
      this.onTurnComplete();
      return true;
    }

    // 检测普通记忆意图
    const isMemorySave = MEMORY_SAVE_PATTERNS.some((re) => re.test(trimmed));
    if (isMemorySave) {
      // 提取记忆内容（去掉触发词前缀）
      const content = trimmed
        .replace(/^(记住[，,：:]|帮我记住|请记住)\s*/, '')
        .trim();

      if (content.length > 0) {
        await this.memoryManager.add({
          type: 'user_fact',
          content,
          source: 'user_explicit',
          confidence: 1.0,
          scope: 'profile',
          volatility: 'stable',
          significance: 0.8,
          keywords: content.split(/\s+/).slice(0, 5),
        });
        log.info(`Memory saved via SkillRouter: "${content.slice(0, 50)}"`);

        const confirmText = `✅ 已记住：「${content}」`;
        this.agentLoop.getMessageManager().addAssistantMessage([{ type: 'text', text: confirmText }]);
        this.onTurnComplete();
        return true;
      }
    }

    return false;
  }

  private async executeSkill(skill: import('@/core/skills/types').Skill, userMessage: string): Promise<void> {
    log.info(`Executing skill: ${skill.id}`);
    try {
      const result = await skill.execute!({ userMessage });
      const output = result?.output ?? result?.error ?? '执行完成';
      this.agentLoop.getMessageManager().addAssistantMessage([{ type: 'text', text: output }]);
      this.onTurnComplete();
    } catch (err) {
      log.error(`Skill execution failed (${skill.id}):`, err);
      throw err;
    }
  }
}
