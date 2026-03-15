// ============================================================
// LessonDetector — 经验教训检测器
// ============================================================
// 职责：
// - 从工具执行结果、用户反馈中自动检测经验教训
// - 创建 LessonEvent 对象
// - 支持成功经验和失败教训的双向学习
// ============================================================

import type {
  LessonEvent,
  LessonType,
  LessonDomain,
  ImpactLevel,
  DiscoveryMethod,
} from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'LessonDetector' });

// ============================================================
// 工具调用上下文
// ============================================================

export interface ToolCallContext {
  toolName: string;
  input: Record<string, unknown>;
  output?: string;
  error?: string;
  success: boolean;
  duration?: number;
}

// ============================================================
// Agent 执行上下文
// ============================================================

export interface AgentContext {
  task: string;                    // 当前任务描述
  userInput: string;               // 用户输入
  assistantAction?: string;        // AI 的行为描述
  files: string[];                 // 涉及的文件
  toolsUsed: string[];             // 使用的工具
  cwd: string;                     // 工作目录
  projectType?: string;            // 项目类型（如 'typescript', 'python'）
}

// ============================================================
// 用户反馈
// ============================================================

export interface UserFeedback {
  type: 'rating' | 'correction' | 'complaint' | 'praise';
  content: string;                 // 反馈内容
  rating?: number;                 // 评分（1-5）
  timestamp: number;
}

// ============================================================
// LessonDetector 类
// ============================================================

export class LessonDetector {
  /**
   * 从工具执行失败中创建失败教训
   */
  async createLessonFromToolFailure(
    toolCall: ToolCallContext,
    context: AgentContext
  ): Promise<Omit<LessonEvent, 'id' | 'timestamp'>> {
    const now = Date.now();

    // 推断影响程度
    const impact = this.inferImpactFromToolFailure(toolCall);

    // 推断领域
    const domain = this.inferDomain(toolCall.toolName, context);

    return {
      type: 'failure',
      domain,

      experience: {
        title: `${toolCall.toolName} 工具执行失败`,
        description: toolCall.error || '工具执行返回错误状态',
        impact,
        discoveredBy: 'tool_result',
      },

      context: {
        task: context.task,
        userInput: context.userInput,
        myAction: context.assistantAction || `调用 ${toolCall.toolName} 工具`,
        files: context.files,
        toolsUsed: context.toolsUsed,
        cwd: context.cwd,
        projectType: context.projectType,
      },

      // 初始验证状态
      verification: {
        applied: false,
        verified: false,
        applicationCount: 0,
        successCount: 0,
      },
    };
  }

  /**
   * 从用户负面反馈中创建失败教训
   */
  async createLessonFromNegativeFeedback(
    feedback: UserFeedback,
    context: AgentContext
  ): Promise<Omit<LessonEvent, 'id' | 'timestamp'>> {
    // 分析反馈内容，推断问题类型
    const { category, description } = this.analyzeFeedback(feedback);

    // 推断影响程度
    const impact = this.inferImpactFromFeedback(feedback);

    // 推断领域
    const domain = this.inferDomainFromFeedback(feedback, context);

    return {
      type: 'failure',
      domain,

      experience: {
        title: category === 'misunderstanding' ? '误解用户意图' : '用户不满意',
        description,
        impact,
        discoveredBy: 'user_feedback',
      },

      context: {
        task: context.task,
        userInput: context.userInput,
        myAction: context.assistantAction || '执行任务',
        files: context.files,
        toolsUsed: context.toolsUsed,
        cwd: context.cwd,
        projectType: context.projectType,
      },

      verification: {
        applied: false,
        verified: false,
        applicationCount: 0,
        successCount: 0,
      },
    };
  }

  /**
   * 从用户纠正中创建失败教训（误解）
   */
  async createLessonFromUserCorrection(
    originalAction: string,
    correction: string,
    context: AgentContext
  ): Promise<Omit<LessonEvent, 'id' | 'timestamp'>> {
    return {
      type: 'failure',
      domain: 'communication',

      experience: {
        title: '误解用户意图',
        description: `我以为用户想要：${originalAction}\n但实际上用户想要：${correction}`,
        impact: 'minor',
        discoveredBy: 'user_feedback',
      },

      context: {
        task: context.task,
        userInput: context.userInput,
        myAction: originalAction,
        files: context.files,
        toolsUsed: context.toolsUsed,
        cwd: context.cwd,
        projectType: context.projectType,
      },

      verification: {
        applied: false,
        verified: false,
        applicationCount: 0,
        successCount: 0,
      },
    };
  }

  /**
   * 从成功执行中创建成功经验
   */
  async createLessonFromSuccess(
    toolCall: ToolCallContext,
    context: AgentContext,
    userSatisfaction?: number
  ): Promise<Omit<LessonEvent, 'id' | 'timestamp'> | null> {
    // 只记录用户明确满意的成功经验（评分 >= 4）
    if (userSatisfaction !== undefined && userSatisfaction < 4) {
      return null;
    }

    // 推断领域
    const domain = this.inferDomain(toolCall.toolName, context);

    return {
      type: 'success',
      domain,

      experience: {
        title: `成功使用 ${toolCall.toolName} 完成任务`,
        description: `用户对结果满意${userSatisfaction ? `（评分 ${userSatisfaction}/5）` : ''}`,
        impact: 'minor',
        discoveredBy: userSatisfaction ? 'user_feedback' : 'tool_result',
      },

      context: {
        task: context.task,
        userInput: context.userInput,
        myAction: context.assistantAction || `使用 ${toolCall.toolName} 工具`,
        files: context.files,
        toolsUsed: context.toolsUsed,
        cwd: context.cwd,
        projectType: context.projectType,
      },

      verification: {
        applied: false,
        verified: false,
        applicationCount: 0,
        successCount: 0,
      },
    };
  }

  /**
   * 检测用户输入中的纠正模式
   * 返回：{isCorrection, originalAction, correction}
   */
  detectCorrectionPattern(userInput: string): {
    isCorrection: boolean;
    originalAction?: string;
    correction?: string;
  } {
    // 匹配 "不是...应该是..." 模式
    const pattern1 = /不是(.+?)(?:，|,|。|应该|而是)(.+)/;
    const match1 = userInput.match(pattern1);
    if (match1) {
      return {
        isCorrection: true,
        originalAction: match1[1].trim(),
        correction: match1[2].trim(),
      };
    }

    // 匹配 "错了，应该..." 模式
    const pattern2 = /(错了|不对|不是这样).*?(?:应该|要|需要)(.+)/;
    const match2 = userInput.match(pattern2);
    if (match2) {
      return {
        isCorrection: true,
        correction: match2[2].trim(),
      };
    }

    return { isCorrection: false };
  }

  // ============================================================
  // 私有辅助方法
  // ============================================================

  /**
   * 从工具失败推断影响程度
   */
  private inferImpactFromToolFailure(toolCall: ToolCallContext): ImpactLevel {
    // 关键工具失败 = major
    const criticalTools = ['bash', 'write', 'edit', 'delete'];
    if (criticalTools.includes(toolCall.toolName)) {
      return 'major';
    }

    // 只读工具失败 = minor
    const readonlyTools = ['read', 'grep', 'glob'];
    if (readonlyTools.includes(toolCall.toolName)) {
      return 'minor';
    }

    return 'minor';
  }

  /**
   * 从用户反馈推断影响程度
   */
  private inferImpactFromFeedback(feedback: UserFeedback): ImpactLevel {
    if (feedback.rating !== undefined) {
      if (feedback.rating <= 2) return 'major';
      if (feedback.rating === 3) return 'minor';
    }

    // 检查反馈内容中的关键词
    const content = feedback.content.toLowerCase();
    if (content.includes('完全错误') || content.includes('严重') || content.includes('不能用')) {
      return 'critical';
    }
    if (content.includes('错了') || content.includes('不对')) {
      return 'major';
    }

    return 'minor';
  }

  /**
   * 推断领域
   */
  private inferDomain(toolName: string, context: AgentContext): LessonDomain {
    // 根据工具名称推断
    if (['bash', 'read', 'write', 'edit'].includes(toolName)) {
      return 'coding';
    }
    if (['grep', 'glob', 'ls'].includes(toolName)) {
      return 'tool_usage';
    }

    // 根据任务描述推断
    const task = context.task.toLowerCase();
    if (task.includes('调试') || task.includes('debug') || task.includes('修复')) {
      return 'debugging';
    }
    if (task.includes('代码') || task.includes('编写') || task.includes('实现')) {
      return 'coding';
    }
    if (task.includes('工具') || task.includes('命令')) {
      return 'tool_usage';
    }

    return 'workflow';
  }

  /**
   * 从反馈推断领域
   */
  private inferDomainFromFeedback(feedback: UserFeedback, context: AgentContext): LessonDomain {
    const content = feedback.content.toLowerCase();

    if (content.includes('误解') || content.includes('理解错') || content.includes('不是')) {
      return 'communication';
    }
    if (content.includes('代码') || content.includes('bug')) {
      return 'coding';
    }
    if (content.includes('工具') || content.includes('命令')) {
      return 'tool_usage';
    }

    return 'decision_making';
  }

  /**
   * 分析反馈内容
   */
  private analyzeFeedback(feedback: UserFeedback): {
    category: 'misunderstanding' | 'logic_error' | 'knowledge_gap' | 'context_missing';
    description: string;
  } {
    const content = feedback.content;

    // 检测误解模式
    if (
      content.includes('误解') ||
      content.includes('理解错') ||
      content.includes('不是') ||
      content.includes('应该是')
    ) {
      return {
        category: 'misunderstanding',
        description: content,
      };
    }

    // 检测逻辑错误
    if (content.includes('错误') || content.includes('bug') || content.includes('不对')) {
      return {
        category: 'logic_error',
        description: content,
      };
    }

    // 检测知识缺失
    if (content.includes('不知道') || content.includes('不了解') || content.includes('不清楚')) {
      return {
        category: 'knowledge_gap',
        description: content,
      };
    }

    return {
      category: 'context_missing',
      description: content,
    };
  }
}
