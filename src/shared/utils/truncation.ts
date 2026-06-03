// ============================================================
// 通用截断工具函数
// ============================================================
//
// 提供中间截断 (middle truncation) 策略：保留头部和尾部，
// 删除中间部分。因为命令输出的开头（标题/首行数据）和结尾
// （总结/错误信息/最终状态）通常最有价值。
//
// 使用场景:
// - BashTool: 命令输出截断
// - ReadTool: 大文件读取截断
// - MessageManager: 发给 LLM 的 tool_result 截断

import { getOutputLimits } from '@/infrastructure/config/RuntimeConfig';

/** 工具输出最大长度 (字符)，BashTool / ReadTool 共用 */
export const MAX_TOOL_OUTPUT_LENGTH = 30_000;

/** 获取工具输出最大长度（运行时配置 > 默认值） */
export function getMaxToolOutputLength(): number {
  return getOutputLimits()?.toolOutput ?? MAX_TOOL_OUTPUT_LENGTH;
}

/**
 * 高效计算文本行数（不创建临时数组）
 */
function countLines(text: string): number {
  let count = 1;
  let pos = 0;
  while ((pos = text.indexOf('\n', pos)) !== -1) {
    count++;
    pos++;
  }
  return count;
}

/**
 * 向前查找最近的换行符位置，实现行边界对齐
 * 如果在 pos 之前找到 \n，返回 \n 后一个位置的索引（即下一行的起始）
 * 如果找不到，返回 0（即从头开始）
 */
function findLineStart(text: string, pos: number): number {
  const idx = text.lastIndexOf('\n', pos - 1);
  return idx === -1 ? 0 : idx + 1;
}

/**
 * 向后查找最近的换行符位置，实现行边界对齐
 * 如果在 pos 之后找到 \n，返回 \n 后一个位置的索引（即下一行的起始）
 * 如果找不到，返回 text.length
 */
function findNextLineStart(text: string, pos: number): number {
  const idx = text.indexOf('\n', pos);
  return idx === -1 ? text.length : idx + 1;
}

/**
 * 中间截断：保留头部和尾部，删除中间部分
 *
 * 策略:
 * - 在行边界处截断（不会切断代码行/行号前缀）
 * - 头部保留约 60%，尾部保留约 40%
 * - 中间插入截断提示信息（含原始总长度和行数）
 *
 * @param text 原始文本
 * @param maxLength 最大允许长度
 * @returns 截断后的文本（如果未超限则原样返回）
 */
export function middleTruncate(text: string, maxLength: number = MAX_TOOL_OUTPUT_LENGTH): string {
  if (text.length <= maxLength) return text;

  const totalLines = countLines(text);
  const truncatedChars = text.length - maxLength;

  // 头部 60%，尾部 40%（头部通常包含标题/结构信息，更有价值）
  const headRatio = 0.6;

  // 先用粗略长度估算分隔符（行数/字符数需要先计算）
  const separatorTemplate = `\n\n... [已截断中间约 ${truncatedChars} 字符，原始共 ${text.length} 字符 / ${totalLines} 行] ...\n\n`;
  const separatorLength = separatorTemplate.length + 20; // 预留余量

  // 计算可用空间
  const availableLength = maxLength - separatorLength;
  if (availableLength <= 0) {
    // 极端情况：maxLength 太小，直接头部截断
    return text.slice(0, maxLength);
  }

  const rawHeadEnd = Math.floor(availableLength * headRatio);
  const rawTailStart = text.length - (availableLength - rawHeadEnd);

  // 对齐到行边界：head 在最近的行尾截断，tail 从最近的行首开始
  // head: 从 rawHeadEnd 向前找到完整行的结束位置
  const headEnd = findLineStart(text, rawHeadEnd);
  // tail: 从 rawTailStart 向后找到完整行的开始位置
  const tailStart = findNextLineStart(text, rawTailStart);

  const head = text.slice(0, headEnd > 0 ? headEnd : rawHeadEnd);
  const tail = text.slice(tailStart < text.length ? tailStart : rawTailStart);

  // 计算实际截断的行数
  const headLines = countLines(head);
  const tailLines = countLines(tail);
  const truncatedLines = totalLines - headLines - tailLines;

  const separator = `\n... [已截断中间 ${truncatedLines} 行 / ${truncatedChars} 字符，原始共 ${totalLines} 行 / ${text.length} 字符] ...\n`;

  return head + separator + tail;
}
