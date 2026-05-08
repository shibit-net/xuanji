/**
 * StuckDetector — Agent ReAct 循环卡住检测
 *
 * 三种检测策略：
 * 1. 同一个工具连续失败多次
 * 2. 连续读取同一个文件多次
 * 3. 同一轮输出文本重复
 */

import { logger } from '@/core/logger';

const log = logger.child({ module: 'StuckDetector' });

export type StuckDetectorResult =
  | { stuck: false }
  | { stuck: true; reason: string; hint: string };

export class StuckDetector {
  private lastToolNames: string[] = [];
  private lastFileReads: string[] = [];
  private lastOutputText = '';
  private sameToolFailCount = 0;
  private consecutiveSameFileCount = 0;
  private consecutiveSameOutputCount = 0;

  reset(): void {
    this.lastToolNames = [];
    this.lastFileReads = [];
    this.lastOutputText = '';
    this.sameToolFailCount = 0;
    this.consecutiveSameFileCount = 0;
    this.consecutiveSameOutputCount = 0;
  }

  /**
   * 检测工具重复失败
   */
  checkToolFailures(toolName: string, isError: boolean): StuckDetectorResult | null {
    if (!isError) return null;

    if (this.lastToolNames.length > 0 && this.lastToolNames[this.lastToolNames.length - 1] === toolName) {
      this.sameToolFailCount++;
    } else {
      this.sameToolFailCount = 1;
    }
    this.lastToolNames.push(toolName);

    if (this.sameToolFailCount >= 2) {
      log.warn(`[StuckDetect] Same tool "${toolName}" failed ${this.sameToolFailCount} times`);
      this.sameToolFailCount = 0;
      return {
        stuck: true,
        reason: `工具 "${toolName}" 已连续失败多次`,
        hint: `\\n[警告] 工具 "${toolName}" 已连续失败多次。请切换实现方案，不要继续重试同一工具。`,
      };
    }
    return null;
  }

  /**
   * 检测重复读取同一文件
   */
  checkFileReads(readTargets: string[]): StuckDetectorResult | null {
    if (readTargets.length === 0) return null;

    for (const target of readTargets) {
      if (this.lastFileReads.length > 0 && this.lastFileReads[this.lastFileReads.length - 1] === target) {
        this.consecutiveSameFileCount++;
      } else {
        this.consecutiveSameFileCount = 1;
      }
      this.lastFileReads.push(target);
    }

    if (this.consecutiveSameFileCount >= 3) {
      log.warn(`[StuckDetect] Same file read ${this.consecutiveSameFileCount} consecutive times`);
      this.consecutiveSameFileCount = 0;
      return {
        stuck: true,
        reason: '连续读取同一文件多次',
        hint: `\\n[警告] 你已连续读取同一文件多次。你已经理解了内容，请继续推进工作。`,
      };
    }
    return null;
  }

  /**
   * 检测重复输出文本
   */
  checkOutputRepeat(outputText: string): StuckDetectorResult | null {
    if (!outputText) return null;

    if (outputText === this.lastOutputText) {
      this.consecutiveSameOutputCount++;
    } else {
      this.consecutiveSameOutputCount = 0;
      this.lastOutputText = outputText;
    }

    if (this.consecutiveSameOutputCount >= 2) {
      log.warn('[StuckDetect] Same output text 2+ consecutive iterations');
      this.consecutiveSameOutputCount = 0;
      return {
        stuck: true,
        reason: '输出文本重复',
        hint: '⚠️ Agent 检测到循环重复，已自动终止。请重新描述需求。',
      };
    }
    return null;
  }
}
