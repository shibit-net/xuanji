// ============================================================
// DecisionPointDetector — 决策点检测器
// ============================================================
// 检测 Agent 需要做出选择的时刻，触发记忆检索
// 支持三种检测方式：
// 1. 工具调用检测（确定性高）
// 2. thinking 内容检测（语义理解）
// 3. 用户消息检测（隐式需求）
// ============================================================

import type { DecisionPoint } from './types';
import type { ToolCall } from '@/core/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'DecisionPointDetector' });

/**
 * 决策点检测器
 */
export class DecisionPointDetector {
  /**
   * 综合检测决策点
   */
  async detect(context: {
    toolCall?: ToolCall;
    thinking?: string;
    userMessage: string;
    conversationHistory?: any[];
  }): Promise<DecisionPoint[]> {
    const points: DecisionPoint[] = [];

    // 1. 工具调用决策点（确定性高）
    if (context.toolCall) {
      const toolPoint = this.detectFromTool(context.toolCall);
      if (toolPoint) {
        points.push(toolPoint);
        log.debug('检测到工具调用决策点', { type: toolPoint.type, tool: toolPoint.tool });
      }
    }

    // 2. Thinking 决策点（语义理解）
    if (context.thinking) {
      const thinkingPoints = this.detectFromThinking(context.thinking);
      points.push(...thinkingPoints);
      if (thinkingPoints.length > 0) {
        log.debug('检测到 thinking 决策点', { count: thinkingPoints.length });
      }
    }

    // 3. 用户消息决策点（隐式需求）
    const userPoints = this.detectFromUserMessage(context.userMessage);
    points.push(...userPoints);
    if (userPoints.length > 0) {
      log.debug('检测到用户消息决策点', { count: userPoints.length });
    }

    return points;
  }

  /**
   * 从工具调用检测决策点
   */
  private detectFromTool(toolCall: ToolCall): DecisionPoint | null {
    // 决策点映射表
    const decisionMap: Record<string, { type: string; keywords: string[] }> = {
      'bash': {
        type: 'command-execution',
        keywords: ['npm', 'pnpm', 'yarn', 'install', 'build', 'test', 'run', 'start']
      },
      'write': {
        type: 'file-creation',
        keywords: ['config', 'package.json', 'tsconfig', 'vite.config', '.env']
      },
      'edit': {
        type: 'code-modification',
        keywords: ['function', 'class', 'import', 'export', 'const', 'let']
      },
      'read': {
        type: 'file-reading',
        keywords: ['config', 'package', 'readme', 'doc']
      },
      'grep': {
        type: 'code-search',
        keywords: ['function', 'class', 'import', 'TODO', 'FIXME']
      },
      'glob': {
        type: 'file-search',
        keywords: ['*.ts', '*.js', '*.json', '*.md']
      }
    };

    const config = decisionMap[toolCall.name];
    if (!config) return null;

    // 提取输入中的关键词
    const inputStr = JSON.stringify(toolCall.input).toLowerCase();
    const matchedKeywords = config.keywords.filter(kw => inputStr.includes(kw.toLowerCase()));

    if (matchedKeywords.length === 0) return null;

    return {
      type: config.type,
      tool: toolCall.name,
      input: toolCall.input,
      keywords: matchedKeywords,
      timestamp: Date.now()
    };
  }

  /**
   * 从 thinking 检测决策点
   */
  private detectFromThinking(thinking: string): DecisionPoint[] {
    const points: DecisionPoint[] = [];

    // 决策关键词模式（中英文）
    const patterns = [
      { regex: /应该用\s*(\S+)/g, type: 'tool-choice' },
      { regex: /选择\s*(\S+)/g, type: 'option-choice' },
      { regex: /考虑\s*(\S+)/g, type: 'consideration' },
      { regex: /决定\s*(\S+)/g, type: 'decision' },
      { regex: /使用\s*(\S+)/g, type: 'usage-decision' },
      { regex: /采用\s*(\S+)/g, type: 'adoption-decision' },
      { regex: /should use\s+(\w+)/gi, type: 'tool-choice' },
      { regex: /choose\s+(\w+)/gi, type: 'option-choice' },
      { regex: /consider\s+(\w+)/gi, type: 'consideration' },
      { regex: /decide\s+(\w+)/gi, type: 'decision' }
    ];

    for (const pattern of patterns) {
      const matches = thinking.matchAll(pattern.regex);
      for (const match of matches) {
        points.push({
          type: pattern.type,
          thinking: match[0],
          keywords: [match[1]],
          timestamp: Date.now()
        });
      }
    }

    return points;
  }

  /**
   * 从用户消息检测决策点（隐式需求）
   */
  private detectFromUserMessage(message: string): DecisionPoint[] {
    const points: DecisionPoint[] = [];

    // 识别隐式决策需求（中英文）
    const implicitPatterns = [
      { regex: /帮我.*创建|新建|生成/i, type: 'creation-request' },
      { regex: /修改|改成|更新/i, type: 'modification-request' },
      { regex: /用什么|选择什么|推荐/i, type: 'recommendation-request' },
      { regex: /如何|怎么|怎样/i, type: 'how-to-request' },
      { regex: /help me.*create|generate|make/i, type: 'creation-request' },
      { regex: /modify|change|update/i, type: 'modification-request' },
      { regex: /what.*use|which.*choose|recommend/i, type: 'recommendation-request' },
      { regex: /how to|how do|how can/i, type: 'how-to-request' }
    ];

    for (const pattern of implicitPatterns) {
      if (pattern.regex.test(message)) {
        points.push({
          type: pattern.type,
          keywords: this.extractKeywords(message),
          timestamp: Date.now()
        });
      }
    }

    return points;
  }

  /**
   * 提取关键词
   */
  private extractKeywords(text: string): string[] {
    // 中文停用词
    const stopWords = new Set([
      '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
      '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be'
    ]);

    // 分词（简单实现，支持中英文）
    const words = text
      .split(/[\s，。！？、；：""''（）【】《》\[\]<>,.!?;:()\-_]+/)
      .filter(w => w.length > 1 && !stopWords.has(w.toLowerCase()));

    // 去重并限制数量
    return [...new Set(words)].slice(0, 5);
  }
}
