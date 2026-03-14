// ============================================================
// M6 工具系统 — KnowledgeQueryTool 查询 Agent 专属知识库
// ============================================================

import type { JSONSchema, ToolResult } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import { BaseTool } from './BaseTool';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'knowledge-query-tool' });

/**
 * KnowledgeQueryTool — 查询当前 Agent 的专属知识库
 *
 * 允许 LLM 在执行任务时查询 Agent 专属知识库。
 * 适用场景：
 * - 查找客户信息（姓名、职位、偏好）
 * - 检索历史记录（会议记录、决策）
 * - 查询领域知识（餐厅列表、技术规范）
 *
 * 注意：此工具只能访问当前 Agent 的知识库，不能跨 Agent 查询。
 */
export class KnowledgeQueryTool extends BaseTool {
  readonly name = 'knowledge_query';
  readonly description = [
    'Query the current Agent\'s dedicated knowledge base (contacts, documents, history, etc.).',
    '',
    'Use cases:',
    '- Find customer information (name, title, preferences)',
    '- Retrieve historical records (meeting notes, decisions)',
    '- Query domain knowledge (restaurant lists, technical specs)',
    '',
    'Important: This tool only accesses the current Agent\'s knowledge base, not other Agents\' data.',
    '',
    'Example queries:',
    '- "王总" → find info about 王总 (title, preferences, allergies)',
    '- "粤菜餐厅" → find Cantonese restaurants in knowledge base',
    '- "authentication bug fix" → find past solutions for auth bugs',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: [
          'Search query (keywords or natural language).',
          'Examples:',
          '- "王总"',
          '- "顺德人家 餐厅"',
          '- "TypeScript 编码规范"',
          '- "authentication error"',
        ].join('\n'),
      },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: [
          'Filter by data source (optional).',
          'Specify which knowledge sources to search.',
          'Examples:',
          '- ["contacts.csv"]',
          '- ["restaurants.json", "reviews.json"]',
        ].join('\n'),
      },
      maxResults: {
        type: 'number',
        description: 'Maximum results to return (default 3, max 10)',
      },
    },
    required: ['query'],
  };

  /** 只读工具：不修改状态 */
  readonly readonly = true;

  private memoryManager: IMemoryStore | null = null;

  /**
   * 注入记忆管理器（由 ConfigurableWorkerAgent 调用）
   */
  setMemoryManager(manager: IMemoryStore): void {
    this.memoryManager = manager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const sources = input.sources as string[] | undefined;
    const maxResults = (input.maxResults as number | undefined) ?? 3;

    // 参数验证
    if (!query?.trim()) {
      return this.error('Parameter "query" is required and cannot be empty');
    }

    if (maxResults < 1 || maxResults > 10) {
      return this.error('Parameter "maxResults" must be between 1 and 10');
    }

    if (!this.memoryManager) {
      return this.error('Knowledge base is not available for this Agent');
    }

    try {
      // 查询专属知识库
      const results = await this.memoryManager.retrieve(query, {
        maxResults,
        minConfidence: 0.5,
        types: ['agent_knowledge'], // 仅查询 Agent 知识
        // 如果指定了数据源，添加元数据过滤
        ...(sources && sources.length > 0
          ? {
              metadata: {
                source: { $in: sources },
              },
            }
          : {}),
      });

      if (results.length === 0) {
        log.debug(`No knowledge found for query: "${query}"`);
        return this.success('❌ No relevant information found in knowledge base.', {
          query,
          count: 0,
          sources,
        });
      }

      // 格式化输出
      const formatted = results
        .map((r, i) => {
          const source = r.metadata?.source ?? 'unknown';
          const sourceType = r.metadata?.sourceType ?? 'unknown';
          const confidenceStr = (r.confidence * 100).toFixed(1);

          return [
            `## Result ${i + 1} (${confidenceStr}% confidence)`,
            `**Source**: ${source} (${sourceType})`,
            '',
            r.content,
          ].join('\n');
        })
        .join('\n\n---\n\n');

      log.debug(`Found ${results.length} knowledge entries for query: "${query}"`);

      return this.success(
        `✅ Found ${results.length} relevant information:\n\n${formatted}`,
        {
          query,
          count: results.length,
          sources: [...new Set(results.map((r) => r.metadata?.source ?? 'unknown'))],
          avgConfidence: results.reduce((sum, r) => sum + r.confidence, 0) / results.length,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Failed to query knowledge base:', err);
      return this.error(`Failed to query knowledge base: ${message}`);
    }
  }
}
