// ============================================================
// M6 工具系统 — SleepTool 等待指定时间
// ============================================================

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { sleep } from '@/core/utils/sleep';

/** 最大等待秒数 */
const MAX_SECONDS = 300;

/**
 * Sleep 工具 — 等待指定的秒数
 *
 * 用于等待后台任务完成、外部进程就绪等场景。
 */
export class SleepTool extends BaseTool {
  readonly name = 'sleep';
  readonly description = [
    '等待指定的秒数。',
    '用于等待后台任务、外部进程、轮询场景等。',
    `最大 ${MAX_SECONDS} 秒。`,
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      seconds: {
        type: 'number',
        description: `等待秒数（1-${MAX_SECONDS}）`,
      },
    },
    required: ['seconds'],
  };

  /** 只读工具，可并行 */
  readonly readonly = true;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const raw = input.seconds as number;

    if (typeof raw !== 'number' || isNaN(raw) || raw <= 0) {
      return this.error('seconds 必须为正数');
    }

    const seconds = Math.min(raw, MAX_SECONDS);
    await sleep(seconds * 1000);

    return this.success(`已等待 ${seconds} 秒`);
  }
}
