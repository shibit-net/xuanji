// ============================================================
// GlobalMessageBus - 全局消息总线（使用增强通道）
// ============================================================

import { MessageBus, MessageChannel, type ChannelOptions } from './MessageBus';
import { EnhancedMessageChannel, type EnhancedChannelOptions } from './EnhancedMessageBus';
import type { BrowserWindow } from 'electron';

/**
 * 增强的消息总线
 * 支持创建自动转发到renderer的通道
 */
export class EnhancedGlobalMessageBus extends MessageBus {
  private mainWindow: BrowserWindow | null = null;

  /**
   * 设置主窗口引用
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;

    // 更新所有已存在的增强通道
    this.getAllChannels().forEach(channel => {
      if (channel instanceof EnhancedMessageChannel) {
        channel.setMainWindow(window);
      }
    });
  }

  /**
   * 创建增强的消息通道（支持自动转发到renderer）
   */
  override createChannel(name: string, options?: ChannelOptions & { enhanced?: boolean }): MessageChannel {
    if (this.hasChannel(name)) {
      throw new Error(`消息通道已存在: ${name}`);
    }

    // 如果指定了enhanced或者没有指定（默认使用增强通道）
    const useEnhanced = options?.enhanced !== false;

    let channel: MessageChannel;
    if (useEnhanced) {
      const enhancedOptions: EnhancedChannelOptions = {
        ...options,
        autoForwardToRenderer: true,
        mainWindow: this.mainWindow,
      };
      channel = new EnhancedMessageChannel(enhancedOptions);
    } else {
      channel = new MessageChannel({ ...options, name });
    }

    this.addChannel(name, channel);
    return channel;
  }

  /**
   * 获取所有通道（用于更新mainWindow）
   */
  private getAllChannels(): MessageChannel[] {
    return Array.from((this as any).channels.values());
  }

  /**
   * 检查通道是否存在
   */
  private hasChannel(name: string): boolean {
    return (this as any).channels.has(name);
  }

  /**
   * 添加通道
   */
  private addChannel(name: string, channel: MessageChannel): void {
    (this as any).channels.set(name, channel);
  }
}

// 导出全局单例
export const enhancedMessageBus = new EnhancedGlobalMessageBus();
