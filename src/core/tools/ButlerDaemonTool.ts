// ============================================================
// Butler 工具 — 启动/停止智能管家服务
// ============================================================

import type { Tool, ToolResult } from '@/core/types';
import type { IProactiveButler } from '@/butler';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'butler-daemon-tool' });

/**
 * ButlerDaemonTool — 控制智能管家后台服务
 */
export class ButlerDaemonTool implements Tool {
  name = 'butler_daemon';
  description = `Control the proactive butler daemon (AI-driven notification service).

Actions:
- "start": Start the butler daemon (automatically checks and pushes notifications)
- "stop": Stop the butler daemon
- "status": Check daemon status
- "check": Manually trigger a decision check (without starting daemon)`;

  parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string' as const,
        enum: ['start', 'stop', 'status', 'check'],
        description: 'Action to perform',
      },
    },
    required: ['action'],
  };

  input_schema = this.parameters;

  private butler: IProactiveButler | null = null;

  setButler(butler: IProactiveButler): void {
    this.butler = butler;
  }

  async execute(params: { action: string }): Promise<ToolResult> {
    if (!this.butler) {
      return {
        content: 'ProactiveButler not initialized. Enable it in config first (features.proactiveButler: true)',
        isError: true,
      };
    }

    const { action } = params;

    try {
      switch (action) {
        case 'start': {
          await this.butler.startDaemon();
          return {
            content:
              '✅ 智能管家后台服务已启动\n\n管家将在以下时间主动检查并推送：\n- 每天 09:00 和 20:00\n- 每小时兜底检查一次\n\n当有重要事项时，会通过系统通知提醒你。',
            isError: false,
          };
        }

        case 'stop': {
          this.butler.stopDaemon();
          return {
            content: '✅ 智能管家后台服务已停止',
            isError: false,
          };
        }

        case 'status': {
          // TODO: 添加状态查询接口
          return {
            content: '智能管家服务已初始化（状态查询功能开发中）',
            isError: false,
          };
        }

        case 'check': {
          const decision = await this.butler.check();
          if (!decision) {
            return {
              content: '🤖 管家检查完成：暂无需要推送的事项',
              isError: false,
            };
          }

          let output = `🤖 管家决策：\n\n`;
          output += `推送？${decision.shouldPush ? '是' : '否'}\n`;
          output += `理由：${decision.reason}\n`;

          if (decision.notification) {
            output += `\n推送内容：\n`;
            output += `标题：${decision.notification.title}\n`;
            output += `内容：${decision.notification.body}\n`;
            output += `优先级：${decision.notification.priority}\n`;
          }

          return { content: output, isError: false };
        }

        default:
          return {
            content: `Unknown action: ${action}`,
            isError: true,
          };
      }
    } catch (error) {
      log.error('ButlerDaemonTool execution failed:', error);
      return {
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }
}
