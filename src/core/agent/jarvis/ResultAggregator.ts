/**
 * ResultAggregator - 结果汇总器（贾维斯架构）
 *
 * 职责：
 * 1. 整合多个子Agent的执行结果
 * 2. 统一口吻包装
 * 3. 格式化输出（代码高亮、结构化列表）
 * 4. 提炼关键信息
 */

import type { ILLMProvider } from '@/core/types';
import type { TeamExecutionResult } from '../team/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ResultAggregator' });

/**
 * ResultAggregator - 结果汇总器
 */
export class ResultAggregator {
  private provider: ILLMProvider;

  constructor(provider: ILLMProvider) {
    this.provider = provider;
  }

  /**
   * 汇总结果
   *
   * 策略：
   * - 单任务：直接返回
   * - 多任务：调用LLM统一口吻包装
   */
  async aggregate(result: TeamExecutionResult, userInput: string): Promise<string> {
    // 单任务：直接返回
    if (result.memberResults.length === 1) {
      return result.output;
    }

    // 多任务：LLM汇总
    return this.aggregateMultipleResults(result, userInput);
  }

  /**
   * 汇总多个结果（调用LLM）
   */
  private async aggregateMultipleResults(
    result: TeamExecutionResult,
    userInput: string
  ): Promise<string> {
    const prompt = `将以下多个子任务的结果，用连贯、温和、专业的口吻串联，格式清晰，避免重复。

用户原始需求：${userInput}

执行策略：${result.goal}

子任务结果：
${result.memberResults.map((r, i) => `
[子任务${i + 1} - ${r.memberId}]
${r.result}
`).join('\n')}

输出要求：
1. 统一口吻：温和、专业、连贯
2. 格式清晰：代码高亮、结构化列表
3. 避免冗余：不重复详细输出
4. 突出重点：提炼关键信息和建议
5. 保持完整：不遗漏重要内容

输出格式示例：
已为你完成以下任务：

1. **架构设计**
   - 设计了用户系统的整体架构
   - 采用三层架构：Controller → Service → Repository
   - 关键模块：认证、授权、用户管理

2. **代码实现**
   \`\`\`typescript
   // 核心代码
   \`\`\`

3. **测试覆盖**
   - 编写了10个单元测试
   - 覆盖率达到85%

总结：所有任务已完成，代码可直接运行。建议：...`;

    try {
      const response = await this.provider.complete({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        maxTokens: 3000,
      });

      const content = typeof response === 'string' ? response : response.content;
      log.info(`Aggregated ${result.memberResults.length} results`);
      return content;
    } catch (error) {
      log.error(`LLM aggregate failed:`, error);
      // 降级：简单拼接
      return this.simpleAggregate(result);
    }
  }

  /**
   * 简单汇总（降级方案）
   */
  private simpleAggregate(result: TeamExecutionResult): string {
    const parts = result.memberResults.map((r, i) => {
      return `## 子任务${i + 1}: ${r.memberId}\n\n${r.result}`;
    });

    return `已完成所有任务：\n\n${parts.join('\n\n---\n\n')}`;
  }
}
