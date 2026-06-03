// ============================================================
// M6 工具系统 — 工具 Schema 优化器
// ============================================================
//
// 动态简化工具 schema，在不损失功能理解的前提下减少 token 消耗
// 支持三种模式：compact（极简）、detailed（详细）、auto（自动）

import type { ToolSchema, JSONSchema } from '@/infrastructure/core-types';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'ToolSchemaOptimizer' });

/**
 * Schema 模式
 * - compact: 极简模式（仅保留核心功能说明，生产环境）
 * - detailed: 详细模式（完整说明，调试/首次使用）
 * - auto: 自动模式（首轮详细，后续简化）
 */
export type SchemaMode = 'compact' | 'detailed' | 'auto';

/**
 * 工具 Schema 优化器
 *
 * 职责：
 * 1. 简化工具描述（提取核心句子）
 * 2. 简化参数说明（去除示例、格式说明）
 * 3. 保留必要信息（功能、参数名、类型、必填）
 * 4. 支持多种模式（compact/detailed/auto）
 */
export class ToolSchemaOptimizer {
  private mode: SchemaMode;
  private useCount = 0; // 使用计数（auto 模式用）

  constructor(mode: SchemaMode = 'compact') {
    this.mode = mode;
    log.debug(`ToolSchemaOptimizer initialized with mode: ${mode}`);
  }

  /**
   * 简化工具 schema
   * @param schema 原始 schema
   * @returns 简化后的 schema（如果模式为 detailed 则返回原样）
   */
  simplify(schema: ToolSchema): ToolSchema {
    // detailed 模式：返回原样
    if (this.mode === 'detailed') {
      return schema;
    }

    // auto 模式：首次使用返回详细版，后续返回简化版
    if (this.mode === 'auto') {
      if (this.useCount === 0) {
        this.useCount++;
        return schema; // 首次使用，返回详细版
      }
    }

    // compact 或 auto（非首次）：简化
    return {
      name: schema.name,
      description: this.simplifyDescription(schema.description),
      input_schema: this.simplifyInputSchema(schema.input_schema),
    };
  }

  /**
   * 批量简化工具 schema 列表
   */
  simplifyBatch(schemas: ToolSchema[]): ToolSchema[] {
    return schemas.map(s => this.simplify(s));
  }

  /**
   * 简化工具描述
   * 策略：
   * 1. 提取第一行或第一句话（到第一个句号/换行）
   * 2. 去除 markdown 标题、emoji、冗余空格
   * 3. 最多保留 120 字符
   */
  private simplifyDescription(desc: string): string {
    // 去除多余空格和换行
    const cleaned = desc.trim().replace(/\n+/g, ' ').replace(/\s+/g, ' ');

    // 提取第一句话（中英文句号）
    const match = cleaned.match(/^([^。.\n]+[。.]?)/);
    const firstSentence = match ? match[1] : cleaned;

    // 去除 markdown 标题标记
    const withoutMarkdown = firstSentence.replace(/^#+\s*/, '');

    // 去除 emoji（可选，保留也可以）
    // const withoutEmoji = withoutMarkdown.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

    // 截断到 120 字符
    const truncated = withoutMarkdown.slice(0, 120);

    return truncated.trim();
  }

  /**
   * 简化输入参数 schema
   * 策略：
   * 1. 保留 type、required、enum（核心结构）
   * 2. 简化每个属性的 description（提取第一句话）
   * 3. 去除 default、examples、format 等冗余字段
   */
  private simplifyInputSchema(schema: JSONSchema): JSONSchema {
    const simplified: JSONSchema = {
      type: schema.type,
      ...(schema.required ? { required: schema.required } : {}),
    };

    if (schema.properties) {
      simplified.properties = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        simplified.properties[key] = this.simplifyProperty(value);
      }
    }

    if (schema.items) {
      simplified.items = this.simplifyProperty(schema.items);
    }

    return simplified;
  }

  /**
   * 简化单个属性定义
   */
  private simplifyProperty(prop: JSONSchema & { description?: string }): JSONSchema & { description?: string } {
    const simplified: JSONSchema & { description?: string } = {
      type: prop.type,
      ...(prop.enum ? { enum: prop.enum } : {}),
    };

    // 简化 description（提取第一句话）
    if (prop.description) {
      const cleaned = prop.description.trim().replace(/\n+/g, ' ').replace(/\s+/g, ' ');
      const match = cleaned.match(/^([^。.\n]+[。.]?)/);
      const firstSentence = match ? match[1] : cleaned;
      simplified.description = firstSentence.slice(0, 80).trim();
    }

    // 递归处理 nested properties（如果存在）
    if (prop.properties) {
      simplified.properties = {};
      for (const [key, value] of Object.entries(prop.properties)) {
        simplified.properties[key] = this.simplifyProperty(value);
      }
    }

    // 递归处理 array items（如果存在）
    if (prop.items) {
      simplified.items = this.simplifyProperty(prop.items);
    }

    return simplified;
  }

  /**
   * 重置使用计数（用于 auto 模式）
   */
  reset(): void {
    this.useCount = 0;
  }

  /**
   * 获取当前模式
   */
  getMode(): SchemaMode {
    return this.mode;
  }

  /**
   * 设置模式（运行时切换）
   */
  setMode(mode: SchemaMode): void {
    this.mode = mode;
    log.debug(`ToolSchemaOptimizer mode changed to: ${mode}`);
  }
}

/**
 * 计算 schema 字符长度（粗略估算 token 数）
 */
export function estimateSchemaTokens(schema: ToolSchema): number {
  const json = JSON.stringify(schema);
  // 粗略估算：1 token ≈ 4 字符（英文）或 1.5 字符（中文）
  // 这里使用 4 字符/token 的保守估计
  return Math.ceil(json.length / 4);
}

/**
 * 对比优化前后的 token 节省
 */
export function compareSchemas(original: ToolSchema, optimized: ToolSchema): {
  originalTokens: number;
  optimizedTokens: number;
  savedTokens: number;
  savedPercentage: number;
} {
  const originalTokens = estimateSchemaTokens(original);
  const optimizedTokens = estimateSchemaTokens(optimized);
  const savedTokens = originalTokens - optimizedTokens;
  const savedPercentage = Math.round((savedTokens / originalTokens) * 100);

  return {
    originalTokens,
    optimizedTokens,
    savedTokens,
    savedPercentage,
  };
}
