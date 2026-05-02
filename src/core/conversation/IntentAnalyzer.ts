import { logger } from '@/core/logger';
import type { IntentResult, IntentAnalyzerFn } from './types';

const log = logger.child({ module: 'IntentAnalyzer' });

export class IntentAnalyzer {
  private analyzerFn: IntentAnalyzerFn | null = null;

  setAnalyzer(fn: IntentAnalyzerFn): void {
    this.analyzerFn = fn;
  }

  async analyze(input: string): Promise<IntentResult> {
    if (this.analyzerFn) {
      try {
        return await this.analyzerFn(input);
      } catch (err) {
        log.warn('Intent analysis failed, using default', err);
      }
    }

    return {
      scene: 'coding',
      agent: 'main',
      complexity: 'standard',
      confidence: 0.5,
      matchMethod: 'default',
    };
  }
}
