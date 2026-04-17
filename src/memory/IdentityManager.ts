// ============================================================
// IdentityManager — 身份记忆管理器
// ============================================================
// 管理用户称呼、助手名字、人格设定等身份信息
// 自动注入到 System Prompt，实现持久化人格
// ============================================================

import type { IdentityMemory, MemoryEntry } from './types';
import type { MemoryStore } from './MemoryStore';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'IdentityManager' });

/**
 * 身份记忆管理器
 */
export class IdentityManager {
  private store: MemoryStore;
  private cachedIdentity: IdentityMemory | null = null;
  private cacheTimestamp = 0;
  private readonly CACHE_TTL = 60000; // 1分钟缓存

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * 获取身份记忆
   */
  async getIdentity(): Promise<IdentityMemory> {
    // 检查缓存
    if (this.cachedIdentity && Date.now() - this.cacheTimestamp < this.CACHE_TTL) {
      return this.cachedIdentity;
    }

    log.debug('加载身份记忆');

    // 从数据库加载
    const identity: IdentityMemory = {};

    try {
      // 查询身份相关记忆
      const sql = `
        SELECT *
        FROM memories
        WHERE type = 'user_fact'
          AND deleted_at IS NULL
          AND (
            content LIKE '%称呼%'
            OR content LIKE '%名字%'
            OR content LIKE '%叫我%'
            OR content LIKE '%call me%'
            OR content LIKE '%name is%'
            OR content LIKE '%助手%'
            OR content LIKE '%assistant%'
          )
        ORDER BY created_at DESC
        LIMIT 10
      `;

      const rows = this.store.db!.prepare(sql).all() as any[];
      const memories = rows.map(row => this.store['rowToEntry'](row));

      // 解析身份信息
      for (const memory of memories) {
        this.parseIdentityFromMemory(memory, identity);
      }

      // 缓存结果
      this.cachedIdentity = identity;
      this.cacheTimestamp = Date.now();

      log.info('身份记忆加载完成', identity);

      return identity;
    } catch (err) {
      log.error('加载身份记忆失败', err);
      return {};
    }
  }

  /**
   * 从记忆中解析身份信息
   */
  private parseIdentityFromMemory(memory: MemoryEntry, identity: IdentityMemory): void {
    const content = memory.content.toLowerCase();

    // 解析用户称呼
    const titlePatterns = [
      /称呼.*?为\s*["']?(\S+?)["']?[，。]/,
      /叫我\s*["']?(\S+?)["']?[，。]/,
      /call me\s+["']?(\w+)["']?[,.\s]/i,
      /address me as\s+["']?(\w+)["']?[,.\s]/i
    ];

    for (const pattern of titlePatterns) {
      const match = memory.content.match(pattern);
      if (match && match[1]) {
        identity.userTitle = match[1];
        log.debug('解析到用户称呼', { title: match[1] });
        break;
      }
    }

    // 解析助手名字
    const namePatterns = [
      /你.*?名字.*?[是叫]\s*["']?(\S+?)["']?[，。]/,
      /助手.*?名字.*?[是叫]\s*["']?(\S+?)["']?[，。]/,
      /your name is\s+["']?(\w+)["']?[,.\s]/i,
      /call you\s+["']?(\w+)["']?[,.\s]/i,
      /name you\s+["']?(\w+)["']?[,.\s]/i
    ];

    for (const pattern of namePatterns) {
      const match = memory.content.match(pattern);
      if (match && match[1]) {
        identity.assistantName = match[1];
        log.debug('解析到助手名字', { name: match[1] });
        break;
      }
    }

    // 解析人格设定
    if (content.includes('人格') || content.includes('性格') || content.includes('persona')) {
      identity.persona = memory.content;
      log.debug('解析到人格设定');
    }

    // 解析语气风格
    if (content.includes('语气') || content.includes('风格') || content.includes('tone')) {
      identity.tone = memory.content;
      log.debug('解析到语气风格');
    }
  }

  /**
   * 设置用户称呼
   */
  async setUserTitle(title: string): Promise<void> {
    log.info('设置用户称呼', { title });

    const memory: Partial<MemoryEntry> = {
      id: `identity-user-title-${Date.now()}`,
      type: 'user_fact',
      content: `用户希望被称呼为"${title}"`,
      keywords: ['称呼', title],
      source: 'user',
      confidence: 1.0,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0,
      scope: 'profile',
      volatility: 'permanent',
      significance: 1.0,
      constraint: 'must',
      memoryOriginV2: 'user',
      usageScenarios: ['greeting', 'conversation'],
      usageCount: 0,
      effectiveCount: 0,
      dreamGeneration: 0,
      evidenceCount: 1,
      dreamCount: 0,
    };

    this.store.saveEntry(memory as MemoryEntry);

    // 清除缓存
    this.clearCache();
  }

  /**
   * 设置助手名字
   */
  async setAssistantName(name: string): Promise<void> {
    log.info('设置助手名字', { name });

    const memory: Partial<MemoryEntry> = {
      id: `identity-assistant-name-${Date.now()}`,
      type: 'user_fact',
      content: `助手的名字是"${name}"`,
      keywords: ['名字', '助手', name],
      source: 'user',
      confidence: 1.0,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0,
      scope: 'profile',
      volatility: 'permanent',
      significance: 1.0,
      constraint: 'must',
      memoryOriginV2: 'user',
      usageScenarios: ['greeting', 'conversation', 'self-reference'],
      usageCount: 0,
      effectiveCount: 0,
      dreamGeneration: 0,
      evidenceCount: 1,
      dreamCount: 0,
    };

    this.store.saveEntry(memory as MemoryEntry);

    // 清除缓存
    this.clearCache();
  }

  /**
   * 格式化为 System Prompt 片段
   */
  formatForSystemPrompt(identity: IdentityMemory): string {
    const parts: string[] = [];

    if (identity.assistantName) {
      parts.push(`# 身份设定\n你的名字是 ${identity.assistantName}。`);
    }

    if (identity.userTitle) {
      parts.push(`\n# 用户称呼\n请称呼用户为"${identity.userTitle}"。`);
    }

    if (identity.persona) {
      parts.push(`\n# 人格设定\n${identity.persona}`);
    }

    if (identity.tone) {
      parts.push(`\n# 语气风格\n${identity.tone}`);
    }

    return parts.join('\n');
  }

  /**
   * 检测用户消息中的名字呼叫
   */
  detectNameMention(message: string, assistantName?: string): boolean {
    if (!assistantName) return false;

    const lowerMessage = message.toLowerCase();
    const lowerName = assistantName.toLowerCase();

    // 检测名字出现
    return lowerMessage.includes(lowerName);
  }

  /**
   * 生成名字响应
   */
  generateNameResponse(assistantName: string): string {
    const responses = [
      `是的，我是${assistantName}。有什么可以帮您的吗？`,
      `${assistantName}在此，请问有什么需要？`,
      `我在，${assistantName}随时为您服务。`,
      `您好，${assistantName}在这里。`
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedIdentity = null;
    this.cacheTimestamp = 0;
    log.debug('身份记忆缓存已清除');
  }
}
