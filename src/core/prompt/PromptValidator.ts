/**
 * PromptValidator — Prompt 校验器
 *
 * 校验组合后的 prompt 是否符合长度限制、格式要求。
 */
import { logger } from '@/infrastructure/logger';
import type { ComposedPrompt } from './PromptComposer';

const log = logger.child({ module: 'PromptValidator' });

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class PromptValidator {
  private maxTokens: number;
  private maxComponents: number;

  constructor(maxTokens = 1_000_000, maxComponents = 20) {
    this.maxTokens = maxTokens;
    this.maxComponents = maxComponents;
  }

  validate(composed: ComposedPrompt): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (composed.estimatedTokens > this.maxTokens) {
      errors.push(`Prompt exceeds max tokens: ${composed.estimatedTokens} > ${this.maxTokens}`);
    }

    if (composed.components.length > this.maxComponents) {
      warnings.push(`Too many components: ${composed.components.length} > ${this.maxComponents}`);
    }

    if (!composed.systemPrompt || composed.systemPrompt.trim().length === 0) {
      errors.push('Empty system prompt');
    }

    if (composed.estimatedTokens > this.maxTokens * 0.8) {
      warnings.push(`Prompt approaching token limit (${Math.round(composed.estimatedTokens / this.maxTokens * 100)}%)`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  estimateTokenUsage(prompt: string): number {
    let cjk = 0;
    let ascii = 0;
    for (const char of prompt) {
      const code = char.codePointAt(0)!;
      if (
        (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x3000 && code <= 0x303F) ||
        (code >= 0xFF00 && code <= 0xFFEF) ||
        (code >= 0x3040 && code <= 0x309F) ||
        (code >= 0x30A0 && code <= 0x30FF) ||
        (code >= 0xAC00 && code <= 0xD7AF)
      ) {
        cjk++;
      } else {
        ascii++;
      }
    }
    return Math.ceil(cjk * 1.5 + ascii / 4);
  }
}
