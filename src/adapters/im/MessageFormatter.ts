// ============================================================
// IM 适配器 — Agent 输出格式化器
// ============================================================

/**
 * MessageFormatter — 将 Agent 回调输出格式化为 Markdown
 *
 * 用于 IM 机器人（钉钉、飞书、企业微信），将 AgentLoop 的
 * 流式输出、工具调用等收集并格式化为一段完整的 Markdown 消息。
 */
export class MessageFormatter {
  private textParts: string[] = [];
  private toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    result?: string;
    isError?: boolean;
    duration?: number;
    startTime: number;
  }> = [];

  /**
   * 追加文本
   */
  appendText(text: string): void {
    this.textParts.push(text);
  }

  /** 需要在 IM 消息中显示的工具 */
  private static readonly DISPLAYABLE_TOOLS = new Set([
    'write_file',
    'edit_file',
    'multi_edit',
    'bash',
    'task',
    'team',
    'todo_create',
    'todo_update',
    'enter_plan_mode',
    'exit_plan_mode',
  ]);

  /**
   * 记录工具开始
   */
  toolStart(name: string, input: Record<string, unknown>): void {
    // 只记录需要显示的工具
    if (MessageFormatter.DISPLAYABLE_TOOLS.has(name)) {
      this.toolCalls.push({
        name,
        input,
        startTime: Date.now(),
      });
    }
  }

  /**
   * 记录工具结束
   */
  toolEnd(name: string, result: string, isError: boolean): void {
    // 只处理已记录的工具（即需要显示的工具）
    const call = this.toolCalls.find(
      (c) => c.name === name && c.result === undefined
    );
    if (call) {
      call.result = result;
      call.isError = isError;
      call.duration = Date.now() - call.startTime;
    }
  }

  /**
   * 格式化为 Markdown 消息
   */
  format(): string {
    const parts: string[] = [];

    // 工具调用摘要
    if (this.toolCalls.length > 0) {
      parts.push('**工具调用:**');
      for (const call of this.toolCalls) {
        const icon = call.isError ? '❌' : '✅';
        const dur = call.duration ? ` (${(call.duration / 1000).toFixed(1)}s)` : '';
        const inputStr = this.formatToolInput(call.input);
        parts.push(`${icon} \`${call.name}\`${dur}: ${inputStr}`);
      }
      parts.push('');
    }

    // 主体文本
    const text = this.textParts.join('').trim();
    if (text) {
      parts.push(text);
    }

    return parts.join('\n') || '（无回复内容）';
  }

  /**
   * 重置（用于下一轮对话）
   */
  reset(): void {
    this.textParts = [];
    this.toolCalls = [];
  }

  /**
   * 是否有内容
   */
  hasContent(): boolean {
    return this.textParts.length > 0 || this.toolCalls.length > 0;
  }

  /**
   * 格式化工具输入参数
   */
  private formatToolInput(input: Record<string, unknown>): string {
    const entries = Object.entries(input);
    if (entries.length === 0) return '';

    return entries
      .map(([k, v]) => {
        const val = typeof v === 'string'
          ? (v.length > 80 ? v.slice(0, 80) + '...' : v)
          : JSON.stringify(v);
        return `${k}=${val}`;
      })
      .join(', ');
  }
}
