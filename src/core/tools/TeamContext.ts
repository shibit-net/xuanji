/**
 * TeamContext — 团队执行上下文（单例）
 *
 * 在 hierarchical 策略下，TeamManager 在执行 leader 前设置此上下文，
 * leader 调用 task 工具创建子成员时，TaskTool 读取此上下文发射 TeamSubMemberStart/End hook。
 *
 * 使用 AsyncLocalStorage 保证异步安全，支持多个 team 并发执行。
 */
import { AsyncLocalStorage } from 'async_hooks';

export interface TeamContextData {
  teamId: string;
  parentMemberId: string;  // leader 的 member ID
  strategy: string;
}

const asyncLocalStorage = new AsyncLocalStorage<TeamContextData>();

export const TeamContext = {
  /**
   * 在回调函数执行期间设置 team 上下文
   */
  run<T>(data: TeamContextData, fn: () => Promise<T>): Promise<T> {
    return asyncLocalStorage.run(data, fn);
  },

  /**
   * 获取当前执行上下文中的 team 上下文
   */
  get(): TeamContextData | null {
    return asyncLocalStorage.getStore() ?? null;
  },
};
