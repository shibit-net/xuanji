/**
 * LLM 意图分类器
 *
 * 当向量匹配未命中时，使用 LLM 分析用户输入并选择最合适的模块
 *
 * **架构变更**（2026-03-15）：
 * - 从使用 lightProvider 迁移到调用 IntentAnalyzer Agent
 * - 符合多 Agent 架构设计理念
 * - IntentAnalyzer 配置独立的模型（Haiku），成本低、速度快
 */

import type { Intent, IntentDomain } from './types.js';
import type { AgentRegistry } from '@/core/agent/AgentRegistry.js';
import type { ProviderConfig } from '@/core/types';
import { AgentExecutor } from '@/core/agent/AgentExecutor.js';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'LLMIntentClassifier' });

/**
 * 可用模块信息
 */
export interface AvailableModule {
  /** 模块 ID */
  id: string;

  /** 模块名称 */
  name: string;

  /** 模块描述 */
  description: string;

  /** 模块类型 */
  type: 'skill' | 'mcp-tool' | 'agent' | 'custom';

  /** 所属领域（可选） */
  domain?: string;
}

/**
 * LLM 分类结果
 */
export interface LLMClassificationResult {
  moduleId: string;
  confidence: number;
  reason: string;
}

/**
 * LLM 意图分类器
 */
export class LLMIntentClassifier {
  private static readonly AGENT_ID = 'intent-analyzer';

  constructor(
    private agentRegistry: AgentRegistry | null,
    private providerConfig: ProviderConfig
  ) {}

  /**
   * 分析用户输入，选择最合适的模块
   */
  async classify(
    userInput: string,
    availableModules: AvailableModule[]
  ): Promise<Intent[]> {
    // 如果没有 AgentRegistry，返回空数组（降级处理）
    if (!this.agentRegistry) {
      log.warn('AgentRegistry 未初始化，意图分类已禁用');
      return [];
    }

    // 获取 IntentAnalyzer Agent 配置
    const agentConfig = this.agentRegistry.get(LLMIntentClassifier.AGENT_ID);

    if (!agentConfig || !agentConfig.enabled) {
      log.warn(`IntentAnalyzer Agent (${LLMIntentClassifier.AGENT_ID}) 未启用`);
      return [];
    }

    log.debug('LLM 意图分析中（使用 IntentAnalyzer Agent）...');

    try {
      // 构建 Prompt
      const prompt = this.buildClassificationPrompt(userInput, availableModules);

      // 执行 Agent
      const result = await AgentExecutor.execute(agentConfig, {
        userMessage: prompt,
        apiKey: this.providerConfig.apiKey,
        baseURL: this.providerConfig.baseURL,
        timeout: 10000, // 10 秒超时
      });

      if (!result.success) {
        log.warn('IntentAnalyzer Agent 执行失败:', result.error);
        return [];
      }

      // 解析 Agent 输出
      const intents = this.parseClassificationResult(result.content, availableModules);

      if (intents.length > 0) {
        log.debug(`IntentAnalyzer 识别: ${intents[0].params?.moduleId} (置信度: ${intents[0].confidence.toFixed(2)})`);
      }

      return intents;
    } catch (err) {
      log.warn('IntentAnalyzer Agent 执行失败:', err);
      return [];
    }
  }

  /**
   * 构建分类 Prompt
   */
  private buildClassificationPrompt(
    userInput: string,
    modules: AvailableModule[]
  ): string {
    return `你是一个智能助手的意图识别系统。根据用户输入，选择最合适的模块来处理。

## 用户输入

"${userInput}"

## 可用模块

${modules
  .map(
    (m, i) => `${i + 1}. **${m.name}** (ID: ${m.id})
   - 类型: ${m.type}
   - 描述: ${m.description}${m.domain ? `\n   - 领域: ${m.domain}` : ''}`
  )
  .join('\n\n')}

## 任务

分析用户输入的意图，选择 1-3 个最合适的模块来处理（按优先级排序）。

## 输出格式

返回 JSON 数组，格式如下：
\`\`\`json
[
  {
    "moduleId": "模块的 ID",
    "confidence": 0.95,
    "reason": "选择原因（简短，一句话）"
  }
]
\`\`\`

## 要求

1. confidence 范围 0-1，表示匹配置信度
2. 只返回真正相关的模块，不确定的不要返回
3. 如果没有合适的模块，返回空数组 []
4. reason 用中文简短说明选择理由
5. 只返回 JSON，不要其他文字`;
  }

  /**
   * 解析 LLM 分类结果
   */
  private parseClassificationResult(
    content: string,
    modules: AvailableModule[]
  ): Intent[] {
    try {
      // 提取 JSON（支持 markdown 代码块）
      let jsonText = content.trim();

      // 移除 markdown 代码块标记
      const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
      }

      // 尝试查找数组
      const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        jsonText = arrayMatch[0];
      }

      const results: LLMClassificationResult[] = JSON.parse(jsonText);

      // 转换为 Intent 对象
      const intents: Intent[] = [];
      for (const r of results) {
        if (r.confidence <= 0.5) continue; // 过滤低置信度

        const module = modules.find((m) => m.id === r.moduleId);
        if (!module) {
          log.warn(`模块 ${r.moduleId} 不存在`);
          continue;
        }

        intents.push({
          id: `intent-llm-${intents.length}`,
          type: `${module.type}.${r.moduleId}`,
          domain: (module.domain || 'general') as IntentDomain,
          confidence: r.confidence,
          text: r.reason,
          source: 'llm',
          params: {
            moduleId: r.moduleId,
            reason: r.reason,
          },
        });
      }

      return intents;
    } catch (err) {
      log.warn('解析 LLM 分类结果失败:', err);
      log.debug('原始内容:', content);
      return [];
    }
  }
}
