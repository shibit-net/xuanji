/**
 * ContextSignalCollector — 上下文信号统计器
 *
 * 职责：纯统计（无 LLM，<1ms），采集对话密度/消息长度/工具调用密度等信号
 * 这些信号注入 system prompt 后，LLM 自行决定介入程度
 * 对应设计文档 §5.6
 */

export interface ContextSignals {
  dialogFrequency: 'low' | 'medium' | 'high';
  messageLength: 'short' | 'normal' | 'long';
  toolDensity: 'low' | 'medium' | 'high';
  idleHours: number;
  currentScene: string;
}

export class ContextSignalCollector {
  /**
   * 从最近消息中采集上下文信号
   * @param messages 最近的消息列表（最多 20 条即可）
   * @param lastActiveAt 上次活跃时间戳（ms），没有则为 0
   * @param currentScene 当前场景标签
   */
  collect(messages: any[], lastActiveAt: number, currentScene: string = ''): ContextSignals {
    const now = Date.now();

    // dialogFrequency: 最近 5 分钟的消息数
    const fiveMinAgo = now - 5 * 60000;
    const recentMsgs = messages.filter((m: any) => {
      const ts = m.timestamp || m.created_at || 0;
      return ts > fiveMinAgo;
    });
    const count = recentMsgs.length;
    const dialogFrequency = count < 3 ? 'low' : count <= 10 ? 'medium' : 'high';

    // messageLength: 用户最近消息的平均字符数
    const userMsgs = messages.filter((m: any) => m.role === 'user' || m.type === 'user');
    const recentUserMsgs = userMsgs.slice(-5);
    const avgLen = recentUserMsgs.length > 0
      ? recentUserMsgs.reduce((sum: number, m: any) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0) / recentUserMsgs.length
      : 0;
    const messageLength = avgLen < 50 ? 'short' : avgLen <= 500 ? 'normal' : 'long';

    // toolDensity: 最近 5 条消息中工具调用占比
    const last5 = messages.slice(-5);
    const toolCount = last5.filter((m: any) => m.role === 'tool' || m.type === 'tool' || m.tool_use_id).length;
    const density = last5.length > 0 ? toolCount / last5.length : 0;
    const toolDensity = density < 0.2 ? 'low' : density <= 0.6 ? 'medium' : 'high';

    // idleHours: 距上次活跃的小时数
    const idleHours = lastActiveAt > 0 ? Math.max(0, (now - lastActiveAt) / 3600000) : 0;

    return {
      dialogFrequency,
      messageLength,
      toolDensity,
      idleHours: Math.round(idleHours * 10) / 10,
      currentScene,
    };
  }
}
