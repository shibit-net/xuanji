// ============================================================
// IM 适配器 — 通用接口
// ============================================================

import type { ChatSession } from '@/core/chat/ChatSession';

/**
 * IM 适配器接口
 * 所有 IM 机器人（钉钉、飞书、企业微信）统一实现此接口
 */
export interface IMAdapter {
  /** 适配器名称 */
  readonly name: string;

  /**
   * 启动机器人
   * 建立连接，开始接收消息
   */
  start(session: ChatSession): Promise<void>;

  /**
   * 停止机器人
   * 断开连接，清理资源
   */
  stop(): Promise<void>;

  /**
   * 设置日志回调（可选）
   * 用于将日志转发到 GUI 界面
   */
  setLogger?(callback: (message: string) => void): void;
}
