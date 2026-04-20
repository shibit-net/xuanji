/**
 * SubAgentLoop — 子代理循环类型定义
 *
 * 注意：runSubAgent 函数已被移除，请使用 SubAgentFactory.createAndRun() 代替
 */

/**
 * 子代理执行结果
 */
export interface SubAgentResult {
  /** 子代理最终输出文本 */
  result: string;
  /** 消耗的 token 数 */
  tokensUsed: { input: number; output: number };
  /** 执行耗时（毫秒） */
  duration: number;
  /** 是否超时 */
  timedOut: boolean;
  /** 迭代次数 */
  iterations: number;
  /** 是否发生了错误（非超时） */
  hasError?: boolean;
}
