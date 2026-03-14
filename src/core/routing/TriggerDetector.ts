/**
 * 触发词检测器
 *
 * 检测用户输入中的显式触发词，决定是否强制启用 Multi-Agent 模式
 */

import type { TriggerMatch } from './types';

export class TriggerDetector {
  /**
   * 命令触发词（以 / 开头）
   */
  private readonly COMMAND_TRIGGERS = [
    '/orchestrate',   // 明确启用 Orchestrator
    '/plan',          // 任务规划模式
    '/multi-agent',   // Multi-Agent 模式
    '/agents',        // Agent 系统
  ];

  /**
   * 自然语言触发模式
   */
  private readonly NLP_TRIGGERS = [
    // 规划类
    /帮我?规划/,
    /制定.*计划/,
    /安排.*任务/,
    /设计.*方案/,

    // 多任务类
    /分别.*完成/,
    /同时.*处理/,
    /并行.*执行/,
    /多个.*任务/,

    // 专家类
    /代码审查专家/,
    /数据分析助手/,
    /需要.*专家/,
    /请.*专业人员/,
    /找.*专家/,

    // 复杂操作类
    /完整.*流程/,
    /端到端/,
    /从.*到.*/,
    /全面.*分析/,
  ];

  /**
   * 检测用户输入中是否包含触发词
   *
   * @param userInput 用户输入
   * @returns 触发匹配结果，如果未触发则返回 null
   */
  detect(userInput: string): TriggerMatch | null {
    // 1. 检测命令触发
    for (const cmd of this.COMMAND_TRIGGERS) {
      if (userInput.trim().startsWith(cmd)) {
        return {
          type: 'command',
          trigger: cmd,
        };
      }
    }

    // 2. 检测自然语言触发
    for (const pattern of this.NLP_TRIGGERS) {
      if (pattern.test(userInput)) {
        return {
          type: 'nlp',
          trigger: pattern.source,
        };
      }
    }

    // 未触发
    return null;
  }

  /**
   * 检测是否包含特定 Agent 的提及
   *
   * @param userInput 用户输入
   * @param agentNames Agent 名称列表
   * @returns 提及的 Agent 名称列表
   */
  detectAgentMentions(userInput: string, agentNames: string[]): string[] {
    const mentions: string[] = [];

    for (const name of agentNames) {
      // 匹配完整词（避免部分匹配）
      const pattern = new RegExp(`\\b${name}\\b`, 'i');
      if (pattern.test(userInput)) {
        mentions.push(name);
      }
    }

    return mentions;
  }

  /**
   * 检测是否包含并行执行的意图
   *
   * @param userInput 用户输入
   * @returns 是否需要并行执行
   */
  detectParallelIntent(userInput: string): boolean {
    const parallelPatterns = [
      /同时/,
      /并行/,
      /一起/,
      /分别.*同时/,
      /parallel/i,
      /concurrent/i,
    ];

    return parallelPatterns.some(pattern => pattern.test(userInput));
  }
}
