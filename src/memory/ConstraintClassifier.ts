// ============================================================
// ConstraintClassifier — 约束分类器
// ============================================================
// 判断用户输入是"永久约束"还是"普通记忆"
// ============================================================

import type { ILLMProvider } from '@/core/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ConstraintClassifier' });

/**
 * 分类结果
 */
export interface ClassificationResult {
  isConstraint: boolean;  // 是否为永久约束
  confidence: number;     // 置信度 [0-1]
  type?: 'behavior' | 'privacy' | 'identity' | 'communication' | 'ethics' | 'task' | 'custom';
  reason?: string;        // 判断理由
}

/**
 * 约束分类器
 *
 * 使用 LLM 判断用户输入是永久约束还是普通记忆
 */
export class ConstraintClassifier {
  constructor(private provider: ILLMProvider) {}

  /**
   * 分类用户输入
   */
  async classify(userInput: string): Promise<ClassificationResult> {
    const prompt = this.buildClassificationPrompt(userInput);

    try {
      // 使用 stream 方法并收集完整响应
      let fullContent = '';
      const stream = this.provider.stream(
        [
          {
            role: 'user',
            content: prompt,
          },
        ],
        [],
        {
          model: 'default',
          temperature: 0.1,  // 低温度，确保稳定输出
        }
      );

      for await (const event of stream) {
        if (event.type === 'text_delta' && event.text) {
          fullContent += event.text;
        }
      }

      const result = this.parseResponse(fullContent);
      log.debug('Classification result:', result);

      return result;
    } catch (err) {
      log.error('Classification failed:', err);
      // 降级：默认为普通记忆
      return {
        isConstraint: false,
        confidence: 0.5,
        reason: 'Classification failed, defaulting to memory',
      };
    }
  }

  /**
   * 构建分类 prompt
   */
  private buildClassificationPrompt(userInput: string): string {
    return `你是一个记忆分类专家。请判断用户的输入是"永久约束"还是"普通记忆"。

## 永久约束（Permanent Constraint）

**定义**：用户明确要求必须遵守的规则，永久有效，不会改变

**特征**：
1. 使用强制性语气："必须"、"不要"、"一定"、"永远"、"总是"
2. 涉及身份信息：称呼、名字、角色
3. 涉及行为规范：隐私、伦理、沟通方式
4. 涉及偏好设置：代码风格、工作流程
5. 用户明确说"这是规则"、"记住这个规则"

**例子**：
- "我希望被称呼为 Boss"
- "你的名字是贾维斯"
- "不要泄露我的隐私信息"
- "代码必须使用 2 空格缩进"
- "永远不要使用 var 关键字"

## 普通记忆（Regular Memory）

**定义**：事实性信息、经验、上下文，可能会过时或改变

**特征**：
1. 描述性语气："我用了"、"项目是"、"上次"
2. 时效性信息：版本号、日期、临时状态
3. 经验教训：错误、解决方案
4. 上下文信息：项目背景、技术栈

**例子**：
- "项目使用 TypeScript"
- "我上次用的是 React 18"
- "这个 bug 是因为异步问题"
- "我在做一个电商项目"

## 任务

分析以下用户输入，判断是"永久约束"还是"普通记忆"。

**用户输入**：
\`\`\`
${userInput}
\`\`\`

**输出格式**（JSON）：
\`\`\`json
{
  "isConstraint": true/false,
  "confidence": 0.0-1.0,
  "type": "behavior|privacy|identity|communication|ethics|task|custom",
  "reason": "判断理由"
}
\`\`\`

只输出 JSON，不要其他内容。`;
  }

  /**
   * 解析 LLM 响应
   */
  private parseResponse(content: string): ClassificationResult {
    try {
      // 提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const result = JSON.parse(jsonMatch[0]);

      return {
        isConstraint: result.isConstraint || false,
        confidence: result.confidence || 0.5,
        type: result.type,
        reason: result.reason,
      };
    } catch (err) {
      log.error('Failed to parse classification response:', err);
      return {
        isConstraint: false,
        confidence: 0.5,
        reason: 'Parse failed',
      };
    }
  }

  /**
   * 快速规则判断（不调用 LLM）
   *
   * 用于明确的关键词匹配
   */
  quickClassify(userInput: string): ClassificationResult | null {
    const input = userInput.toLowerCase();

    // 明确的约束关键词
    const constraintKeywords = [
      '必须', '不要', '不能', '禁止', '一定', '永远', '总是', '从不',
      '我希望被称呼', '你的名字是', '叫我', '称呼我',
      'must', 'never', 'always', 'call me', 'my name is',
    ];

    // 明确的记忆关键词
    const memoryKeywords = [
      '我用了', '项目是', '上次', '这次', '目前', '现在',
      '版本', '最近', '刚才',
      'i used', 'the project is', 'last time', 'currently',
    ];

    // 检查约束关键词
    for (const keyword of constraintKeywords) {
      if (input.includes(keyword)) {
        return {
          isConstraint: true,
          confidence: 0.9,
          reason: `Matched constraint keyword: ${keyword}`,
        };
      }
    }

    // 检查记忆关键词
    for (const keyword of memoryKeywords) {
      if (input.includes(keyword)) {
        return {
          isConstraint: false,
          confidence: 0.9,
          reason: `Matched memory keyword: ${keyword}`,
        };
      }
    }

    // 无法快速判断
    return null;
  }
}
