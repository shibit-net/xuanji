// ============================================================
// Xuanji GUI - 消息意图分析器
// ============================================================

import { Message } from '../stores/chatStore';

export type UserIntent = 
  | 'interrupt_replace'
  | 'supplement'
  | 'new_task'
  | 'unknown';

export interface IntentAnalysis {
  type: UserIntent;
  confidence: number;
  reasoning: string;
  method: 'keyword' | 'llm';
  suggestedAction?: string;
}

export interface IntentAnalyzerOptions {
  useLLM?: boolean;
  llmThreshold?: number;
  contextWindow?: number;
}

class MessageIntentAnalyzer {
  private options: Required<IntentAnalyzerOptions> = {
    useLLM: true,
    llmThreshold: 0.7,
    contextWindow: 10
  };

  constructor(options?: IntentAnalyzerOptions) {
    if (options) {
      this.options = { ...this.options, ...options };
    }
  }

  // ============================================================
  // 公开 API：分析用户意图
  // ============================================================
  async analyze(
    newMessage: string,
    conversationHistory: Message[],
    options?: { forceUseLLM?: boolean }
  ): Promise<IntentAnalysis> {
    const keywordResult = this.analyzeWithKeywords(newMessage, conversationHistory);
    
    if (keywordResult.confidence >= this.options.llmThreshold && !options?.forceUseLLM) {
      return keywordResult;
    }
    
    if (this.options.useLLM) {
      try {
        return await this.analyzeWithLLM(newMessage, conversationHistory);
      } catch (error) {
        console.warn('LLM 分析失败，回退到关键词分析:', error);
        return keywordResult;
      }
    }
    
    return keywordResult;
  }

  // ============================================================
  // 方法 1: 关键词快速匹配（0 延迟）
  // ============================================================
  private analyzeWithKeywords(
    newMessage: string,
    conversationHistory: Message[]
  ): IntentAnalysis {
    const trimmedMsg = newMessage.trim().toLowerCase();
    const lastUserMsg = conversationHistory.filter(m => m.role === 'user').slice(-1)[0];

    const interruptPatterns = [
      /^(不|不对|不是|等一下|等等|停|不要|别)/i,
      /^(重新|换|改|修正|调整|重来)/i,
      /^不对.{0,15}应该/i,
      /^(别|不要).{0,10}(了|啦)$/i,
      /^(取消|停止|终止|放弃)/i,
    ];

    if (interruptPatterns.some(p => p.test(trimmedMsg))) {
      return {
        type: 'interrupt_replace',
        confidence: 0.95,
        reasoning: '包含明确的中断或修正关键词',
        method: 'keyword',
        suggestedAction: '中断当前任务，重新开始'
      };
    }

    const supplementPatterns = [
      /^(它|这个|那个|刚才|刚刚|上面|还有|对了|哦|忘了说)/i,
      /^(等等|还有|另外).{0,10}(我|你)/i,
    ];

    const hasReference = supplementPatterns.some(p => p.test(trimmedMsg));
    const hasContentOverlap = lastUserMsg ? this.checkContentOverlap(trimmedMsg, lastUserMsg.content) : false;

    if (hasReference || hasContentOverlap) {
      const confidence = hasReference && hasContentOverlap ? 0.85 : 0.7;
      return {
        type: 'supplement',
        confidence,
        reasoning: hasReference ? '包含指代性词汇，看起来是补充说明' : '内容与上一条消息有重叠',
        method: 'keyword',
        suggestedAction: '作为补充输入，不中断'
      };
    }

    const newTaskPatterns = [
      /^(另外|还有|对了|顺便说|问一下|问个问题|另外说)/i,
      /^(好的?|ok|okay|可以|谢谢|知道了).{0,5}(,|，|然后).{0,10}(我|我们)/i,
    ];

    if (newTaskPatterns.some(p => p.test(trimmedMsg))) {
      return {
        type: 'new_task',
        confidence: 0.75,
        reasoning: '看起来是开启新的话题或任务',
        method: 'keyword',
        suggestedAction: '加入队列，等待当前任务完成'
      };
    }

    return {
      type: 'unknown',
      confidence: 0.3,
      reasoning: '关键词匹配无法确定意图',
      method: 'keyword',
      suggestedAction: '请用户选择'
    };
  }

  // ============================================================
  // 方法 2: LLM 深度分析（更智能但有延迟）
  // ============================================================
  private async analyzeWithLLM(
    newMessage: string,
    conversationHistory: Message[]
  ): Promise<IntentAnalysis> {
    const prompt = this.buildLLMPrompt(newMessage, conversationHistory);

    try {
      const result = await window.electron.analyzeIntent?.(prompt);
      return {
        type: result?.intent || 'unknown',
        confidence: result?.confidence || 0.5,
        reasoning: result?.reasoning || 'LLM 分析完成',
        method: 'llm',
        suggestedAction: this.getSuggestedAction(result?.intent || 'unknown')
      };
    } catch {
      return this.analyzeWithKeywords(newMessage, conversationHistory);
    }
  }

  private buildLLMPrompt(newMessage: string, conversationHistory: Message[]): string {
    const recentHistory = conversationHistory.slice(-this.options.contextWindow);
    const historyText = recentHistory.map(msg => {
      const role = msg.role === 'user' ? '用户' : '助手';
      return `${role}: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`;
    }).join('\n');

    return `你是一个对话意图分析助手。请分析在对话进行中，用户发送的新消息的意图。

对话历史：
${historyText}

用户最新发送的消息："${newMessage}"

请判断用户的意图属于以下哪一种：
1. interrupt_replace - 中断当前任务，重新开始。用户意图是修正、替换或取消当前任务。
2. supplement - 补充说明，不中断当前任务。用户意图是补充说明当前任务，或者是追问、澄清。
3. new_task - 新任务，等待当前任务完成后执行。用户意图是开启新的话题或新任务。

请以 JSON 格式返回，格式如下：
{
  "intent": "interrupt_replace | supplement | new_task",
  "confidence": 0.0-1.0,
  "reasoning": "简短的分析理由"
}

只返回 JSON，不要其他内容。`;
  }

  // ============================================================
  // 辅助方法
  // ============================================================
  private checkContentOverlap(textA: string, textB: string): boolean {
    const tokensA = new Set(textA.toLowerCase().split(/\s+|\W+/));
    const tokensB = new Set(textB.toLowerCase().split(/\s+|\W+/));
    
    let overlapCount = 0;
    for (const token of tokensA) {
      if (token.length >= 2 && tokensB.has(token)) {
        overlapCount++;
      }
    }
    
    return overlapCount >= 2;
  }

  private getSuggestedAction(intent: UserIntent): string {
    switch (intent) {
      case 'interrupt_replace': return '中断当前任务，重新开始';
      case 'supplement': return '作为补充输入，不中断';
      case 'new_task': return '加入队列，等待当前任务完成';
      default: return '请用户选择';
    }
  }
}

export const intentAnalyzer = new MessageIntentAnalyzer();
