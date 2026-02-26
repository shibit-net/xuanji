// ============================================================
// M4 记忆系统 — 短期记忆（当前会话内存缓存）
// ============================================================

import type { SessionMemory, ToolCallRecord, MemoryConfig } from './types';
import { DEFAULT_MEMORY_CONFIG } from './types';

/** 中文停用词 */
const STOP_WORDS_ZH = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '他', '她', '它', '们', '那', '些', '什么', '怎么', '为什么',
  '可以', '已经', '这个', '那个', '还是', '但是', '所以', '如果', '因为',
]);

/** 英文停用词 */
const STOP_WORDS_EN = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'this', 'that', 'these', 'those', 'i', 'you',
  'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'what', 'which', 'who',
]);

/** 文件路径正则 */
const FILE_PATH_RE = /(?:\/|\.\/|\.\.\/)?[\w\-./]+\.\w{1,10}/g;

/** 技术术语正则（驼峰命名、带连字符的标识符、大写缩写） */
const TECH_TERM_RE = /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b|\b[a-z]+(?:-[a-z]+)+\b|\b[A-Z]{2,}\b/g;

/**
 * 短期记忆 — 当前会话内存缓存
 *
 * 生命周期与 ChatSession 一致，不涉及 I/O。
 * 记录用户消息、助手高亮、工具调用，最终生成 SessionMemory 对象。
 */
export class ShortTermMemory {
  private sessionId: string;
  private model: string;
  private startTime: string;
  private userMessages: string[] = [];
  private assistantHighlights: string[] = [];
  private toolCalls: ToolCallRecord[] = [];
  private config: MemoryConfig;

  constructor(sessionId: string, model: string, config?: Partial<MemoryConfig>) {
    this.sessionId = sessionId;
    this.model = model;
    this.startTime = new Date().toISOString();
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
  }

  /** 记录用户消息 */
  addUserMessage(content: string): void {
    if (this.userMessages.length < this.config.shortTermMaxEntries) {
      this.userMessages.push(content);
    }
  }

  /** 记录助手关键回复（最多 5 条） */
  addAssistantHighlight(content: string): void {
    if (this.assistantHighlights.length < 5) {
      this.assistantHighlights.push(
        content.length > this.config.maxEntryLength
          ? content.slice(0, this.config.maxEntryLength) + '...'
          : content,
      );
    }
  }

  /** 记录工具调用 */
  addToolCall(record: ToolCallRecord): void {
    if (this.toolCalls.length < this.config.shortTermMaxEntries) {
      this.toolCalls.push(record);
    }
  }

  /** 返回 SessionMemory 对象 */
  getSessionMemory(): SessionMemory {
    return {
      sessionId: this.sessionId,
      startTime: this.startTime,
      endTime: new Date().toISOString(),
      userMessages: [...this.userMessages],
      assistantHighlights: [...this.assistantHighlights],
      toolCalls: [...this.toolCalls],
      durationMs: Date.now() - new Date(this.startTime).getTime(),
      model: this.model,
    };
  }

  /** 从消息中提取关键词 */
  extractKeywords(): string[] {
    const allText = [...this.userMessages, ...this.assistantHighlights].join(' ');
    const keywords = new Set<string>();

    // 提取文件路径
    const filePaths = allText.match(FILE_PATH_RE);
    if (filePaths) {
      for (const fp of filePaths) {
        keywords.add(fp);
      }
    }

    // 提取技术术语
    const techTerms = allText.match(TECH_TERM_RE);
    if (techTerms) {
      for (const term of techTerms) {
        keywords.add(term.toLowerCase());
      }
    }

    // 分词，过滤停用词
    const words = allText
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\-./]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !STOP_WORDS_EN.has(w) && !STOP_WORDS_ZH.has(w));

    for (const word of words) {
      keywords.add(word);
    }

    // 添加工具名
    for (const tc of this.toolCalls) {
      keywords.add(tc.name.toLowerCase());
    }

    return Array.from(keywords);
  }

  /** 获取用户消息数量 */
  getUserMessageCount(): number {
    return this.userMessages.length;
  }

  /** 获取工具调用数量 */
  getToolCallCount(): number {
    return this.toolCalls.length;
  }
}
