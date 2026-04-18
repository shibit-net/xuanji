// ============================================================
// M2 Agent — 消息管理器
// ============================================================

import type { Message, ContentBlock, ToolResult } from '@/core/types';
import { middleTruncate, getMaxToolResultLength } from '@/shared/utils/truncation';
import { stripAnsi } from '@/shared/utils/ansi';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MessageManager' });

/**
 * 消息管理器接口
 */
export interface IMessageManager {
  build(userMessage: string): Message[];
  addAssistantMessage(content: ContentBlock[]): void;
  addUserMessage(content: string): void;
  addToolResult(toolUseId: string, result: ToolResult): void;
  addToolResults(results: Map<string, ToolResult>): void;
  appendTextToLastMessage(text: string): boolean;
  getHistory(): Message[];
  getMessages(): Message[];
  clear(): void;
  saveSnapshot(): Message[];
  restoreSnapshot(snapshot: Message[]): void;
}

/**
 * 消息管理器
 * 负责管理对话历史、构建消息数组
 */
export class MessageManager implements IMessageManager {
  private systemPrompt: string;
  /** 多来源 system prompt 后缀（支持 hook、memory 等同时注入，互不覆盖） */
  private systemPromptSuffixes: Map<string, string> = new Map();
  private messages: Message[] = [];

  constructor(systemPrompt?: string) {
    this.systemPrompt = systemPrompt ?? this.getDefaultSystemPrompt();
  }

  /**
   * 构建完整消息数组 (system + history + user)
   *
   * 若历史末尾已是 user 消息（如 session restore 后 sanitizeToolPairs
   * 补入的占位 tool_result），则将新消息追加为 text block 而非 push
   * 新的 user 消息，避免产生连续 user 消息导致 Anthropic API 400。
   */
  build(userMessage: string): Message[] {
    if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === 'user') {
      // 末尾已是 user —— 追加 text block（Anthropic 支持混合 tool_result + text）
      this.appendTextToLastMessage(userMessage);
    } else {
      this.messages.push({
        role: 'user',
        content: userMessage,
      });
    }

    // 返回 system + 完整历史
    // system content 使用 ContentBlock[] 格式，区分稳定部分和动态后缀
    // Provider 可据此决定各自的 Prompt Caching 策略
    return [
      { role: 'system', content: this.getSystemPromptBlocks() },
      ...this.messages,
    ];
  }

  /**
   * 添加 assistant 消息到历史
   */
  addAssistantMessage(content: ContentBlock[]): void {
    this.messages.push({
      role: 'assistant',
      content,
    });
  }

  /**
   * 添加 user 消息到历史（用于注入系统级提示）
   */
  addUserMessage(content: string): void {
    this.messages.push({
      role: 'user',
      content,
    });
  }

  /**
   * 安全添加 user 消息（避免连续 user 消息）
   *
   * 如果最后一条消息是 user，则追加到该消息；否则创建新的 user 消息
   *
   * @param content 用户消息内容
   * @returns true 如果追加到现有消息，false 如果创建新消息
   */
  addUserMessageSafe(content: string): boolean {
    if (this.messages.length === 0) {
      this.addUserMessage(content);
      return false;
    }

    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg.role === 'user') {
      // 最后一条是 user → 追加
      this.appendTextToLastMessage(`\n\n${content}`);
      return true;
    } else {
      // 最后一条不是 user → 新增
      this.addUserMessage(content);
      return false;
    }
  }

  /**
   * 安全添加 assistant 消息（避免连续 assistant 消息）
   *
   * 如果最后一条消息是 assistant，记录警告并跳过
   *
   * @param content assistant 消息内容
   * @returns true 如果成功添加，false 如果跳过
   */
  addAssistantMessageSafe(content: ContentBlock[]): boolean {
    if (this.messages.length === 0) {
      this.addAssistantMessage(content);
      return true;
    }

    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg.role === 'assistant') {
      // 最后一条已经是 assistant → 警告并跳过
      log.warn('Attempted to add consecutive assistant message, skipping to maintain alternating pattern');
      return false;
    } else {
      // 最后一条不是 assistant → 正常添加
      this.addAssistantMessage(content);
      return true;
    }
  }

  /**
   * 批量添加工具结果到历史（合并为单个 user 消息）
   *
   * Anthropic API 推荐格式:
   * {
   *   role: 'user',
   *   content: [
   *     { type: 'tool_result', tool_use_id: '1', content: '...' },
   *     { type: 'tool_result', tool_use_id: '2', content: '...' },
   *   ]
   * }
   */
  addToolResults(results: Map<string, ToolResult>): void {
    if (results.size === 0) return;

    const toolResultBlocks: ContentBlock[] = [];

    for (const [toolUseId, result] of results) {
      // 对每条 tool_result 内容做截断保护，防止超大内容发给 LLM API
      let content = middleTruncate(result.content, getMaxToolResultLength());

      // 清理 ANSI 转义序列（DiffRenderer 生成的颜色代码）
      // LLM 不需要看到 ANSI 代码，只需要纯文本内容
      content = stripAnsi(content);

      // 清理 UI 元数据标记（HTML 注释格式，用于 TodoPanel 渲染）
      // LLM 不需要看到这些标记，避免污染上下文导致 API 错误
      content = content.replace(/<!--TODO_PROGRESS:.*?-->/gs, '');

      // 如果有多模态内容块（如图片），构建 content 数组
      // Anthropic API tool_result 的 content 字段支持 string | ContentBlock[]
      // 但我们的 ContentBlock 类型定义 content 为 string，此处将多模态内容序列化为 JSON
      // Provider 层负责在发送前解析还原
      if (result.contentBlocks && result.contentBlocks.length > 0) {
        const multiContent = [
          { type: 'text', text: content },
          ...result.contentBlocks.map(block => ({ ...block })),
        ];
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: JSON.stringify(multiContent),
          is_error: result.isError,
        });
      } else {
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          is_error: result.isError,
        });
      }
    }

    this.messages.push({
      role: 'user',
      content: toolResultBlocks,
    });
  }

  /**
   * 添加工具执行结果到历史（向后兼容）
   */
  addToolResult(toolUseId: string, result: ToolResult): void {
    const resultsMap = new Map<string, ToolResult>();
    resultsMap.set(toolUseId, result);
    this.addToolResults(resultsMap);
  }

  /**
   * 确保消息历史中 tool_use/tool_result 配对完整
   *
   * 当最后一条 assistant 消息包含 tool_use 但没有对应的 tool_result 时，
   * 自动生成占位 tool_result 消息。
   *
   * 典型场景：
   * - 用户 interrupt 后，assistant 消息（含 tool_use）已记录，但工具未执行
   * - end_turn + pendingAppendMessage 时，assistant 返回了 tool_use 但 stopReason 被
   *   stream 设为 end_turn（或 race condition 导致 tool_use 未被处理）
   *
   * 此方法在 addUserMessage 前调用，防止产生不合法的消息序列。
   *
   * @returns 补全的 tool_result 数量（0 表示无需补全）
   */
  ensureToolResultPairing(): number {
    if (this.messages.length === 0) return 0;
    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg.role !== 'assistant' || !Array.isArray(lastMsg.content)) return 0;

    // 收集 assistant 消息中的 tool_use ids
    const toolUseIds = (lastMsg.content as ContentBlock[])
      .filter(b => b.type === 'tool_use' && b.id)
      .map(b => b.id!);

    if (toolUseIds.length === 0) return 0;

    // 生成占位 tool_result
    log.warn(`ensureToolResultPairing: last assistant has ${toolUseIds.length} orphaned tool_use(s): ${toolUseIds.join(', ')}, injecting placeholder tool_results`);
    const placeholderBlocks: ContentBlock[] = toolUseIds.map(id => ({
      type: 'tool_result' as const,
      tool_use_id: id,
      content: '[Interrupted] Tool was not executed due to user interruption.',
      is_error: true,
    }));

    this.messages.push({
      role: 'user',
      content: placeholderBlocks,
    });

    return toolUseIds.length;
  }

  /**
   * 将文本追加到历史中最后一条 user 消息（边界感知注入）
   *
   * Claude Code 风格：用户在 Agent 执行中发送的消息，
   * 注入到 tool_result 同一条 user 消息中，使 LLM 在下一轮
   * 同时看到工具结果和用户补充消息。
   *
   * Anthropic API 支持 user 消息中混合 tool_result 和 text 块：
   * { role: "user", content: [{ type: "tool_result", ... }, { type: "text", text: "..." }] }
   *
   * @returns true 如果成功追加，false 如果最后一条消息不是 user
   */
  appendTextToLastMessage(text: string): boolean {
    if (this.messages.length === 0) return false;
    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg.role !== 'user') return false;

    if (Array.isArray(lastMsg.content)) {
      // Content 是 ContentBlock[]（如 tool_result 块） — 追加 text 块
      (lastMsg.content as ContentBlock[]).push({ type: 'text', text });
    } else {
      // Content 是 string — 转换为 ContentBlock[] 格式
      lastMsg.content = [
        { type: 'text', text: lastMsg.content as string },
        { type: 'text', text },
      ];
    }
    return true;
  }

  /**
   * 获取完整对话历史（不含 system prompt）
   */
  getHistory(): Message[] {
    return [...this.messages];
  }

  /**
   * 获取完整消息数组（system prompt + 对话历史）
   * 用于 ReAct 循环中重建消息，确保 system prompt 不丢失
   */
  getMessages(): Message[] {
    return [
      { role: 'system', content: this.getSystemPromptBlocks() },
      ...this.messages,
    ];
  }

  /**
   * 替换内部消息历史（用于上下文压缩后更新、session resume）
   * 注意：传入的消息不应包含 system prompt
   * 会自动修复 tool_use/tool_result 配对问题
   */
  replaceMessages(messages: Message[]): void {
    this.messages = MessageManager.sanitizeToolPairs(messages);
  }

  /**
   * 修复消息历史中 tool_use/tool_result 配对问题
   *
   * Anthropic API 要求：每个 assistant 消息中的 tool_use 块，
   * 必须在紧随其后的 user 消息中有对应的 tool_result 块。
   * 反之，每个 user 消息中的 tool_result 块，必须在紧随其前的
   * assistant 消息中有对应的 tool_use 块。
   * 违反此规则会返回 400/429 错误。
   *
   * 常见破损场景：
   * - Session resume 时 JSONL 行损坏导致 tool_result 消息丢失
   * - 流传输中断后会话保存了不完整的消息历史
   * - 上下文压缩 / archive 裁剪了配对的一半
   */
  static sanitizeToolPairs(messages: Message[]): Message[] {
    const result = [...messages];

    // ── Pass 1: 正向 — 为孤立的 tool_use 补入占位 tool_result ──
    for (let i = 0; i < result.length; i++) {
      const msg = result[i];
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;

      // 收集此 assistant 消息中所有 tool_use 的 id
      const toolUseIds = (msg.content as ContentBlock[])
        .filter(b => b.type === 'tool_use' && b.id)
        .map(b => b.id!);

      if (toolUseIds.length === 0) continue;

      // 找紧随其后的 user 消息中已有的 tool_result id
      const nextMsg = result[i + 1];
      const existingResultIds = new Set<string>();
      if (nextMsg?.role === 'user' && Array.isArray(nextMsg.content)) {
        for (const block of nextMsg.content as ContentBlock[]) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            existingResultIds.add(block.tool_use_id);
          }
        }
      }

      // 找出缺失 tool_result 的 tool_use ids
      const missingIds = toolUseIds.filter(id => !existingResultIds.has(id));
      if (missingIds.length === 0) continue;

      log.warn(`sanitizeToolPairs: assistant message[${i}] has ${missingIds.length} orphaned tool_use(s): ${missingIds.join(', ')}`);

      // 生成缺失的 tool_result 块
      const syntheticBlocks: ContentBlock[] = missingIds.map(id => ({
        type: 'tool_result' as const,
        tool_use_id: id,
        content: '[Session restored] Tool was not executed due to session interruption.',
        is_error: true,
      }));

      if (nextMsg?.role === 'user' && Array.isArray(nextMsg.content)) {
        // 追加到已有 user 消息
        result[i + 1] = {
          ...nextMsg,
          content: [...(nextMsg.content as ContentBlock[]), ...syntheticBlocks],
        };
      } else {
        // 插入新的 user 消息
        result.splice(i + 1, 0, {
          role: 'user',
          content: syntheticBlocks,
        });
      }
    }

    // ── Pass 2: 反向 — 移除孤立的 tool_result（无对应 tool_use） ──
    // 场景：archive / context compress 裁剪了窗口前半部分，
    //       导致窗口开头的 user 消息包含引用已被删除 assistant 的 tool_result
    for (let i = 0; i < result.length; i++) {
      const msg = result[i];
      if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;

      // 收集此 user 消息中所有 tool_result 的 tool_use_id
      const toolResultIds = (msg.content as ContentBlock[])
        .filter(b => b.type === 'tool_result' && b.tool_use_id)
        .map(b => (b as { tool_use_id: string }).tool_use_id);

      if (toolResultIds.length === 0) continue;

      // 找前一条 assistant 消息中已有的 tool_use id
      const prevMsg = i > 0 ? result[i - 1] : undefined;
      const existingUseIds = new Set<string>();
      if (prevMsg?.role === 'assistant' && Array.isArray(prevMsg.content)) {
        for (const block of prevMsg.content as ContentBlock[]) {
          if (block.type === 'tool_use' && block.id) {
            existingUseIds.add(block.id);
          }
        }
      }

      // 找出孤立的 tool_result ids
      const orphanedIds = new Set(toolResultIds.filter(id => !existingUseIds.has(id)));
      if (orphanedIds.size === 0) continue;

      log.warn(`sanitizeToolPairs: user message[${i}] has ${orphanedIds.size} orphaned tool_result(s): ${[...orphanedIds].join(', ')}`);

      // 过滤掉孤立的 tool_result 块
      const filteredContent = (msg.content as ContentBlock[]).filter(
        b => b.type !== 'tool_result' || !orphanedIds.has((b as { tool_use_id?: string }).tool_use_id ?? '')
      );

      if (filteredContent.length === 0) {
        // 整条 user 消息为空 → 删除
        result.splice(i, 1);
        i--; // 调整索引
      } else {
        result[i] = { ...msg, content: filteredContent };
      }
    }

    return result;
  }

  /**
   * 清空对话历史
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * 更新系统提示词
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * 设置系统提示词后缀（用于动态注入记忆上下文等）
   */
  /**
   * 设置系统提示词后缀（按来源 key 区分，互不覆盖）
   * @param suffix 后缀内容（空字符串则移除该 key）
   * @param key 来源标识，默认 'default'
   */
  setSystemPromptSuffix(suffix: string, key: string = 'default'): void {
    if (suffix) {
      this.systemPromptSuffixes.set(key, suffix);
    } else {
      this.systemPromptSuffixes.delete(key);
    }
  }

  /**
   * 获取完整系统提示词（基础 + 后缀）— 纯字符串格式
   * 保留为 fallback，供需要纯文本的场景使用
   */
  getFullSystemPromptText(): string {
    const suffixes = Array.from(this.systemPromptSuffixes.values()).filter(Boolean);
    return suffixes.length > 0
      ? `${this.systemPrompt}\n\n${suffixes.join('\n\n')}`
      : this.systemPrompt;
  }

  /**
   * 构建结构化 system prompt blocks
   *
   * 将 system prompt 拆分为独立的 ContentBlock[]，区分稳定基础部分和动态后缀：
   * - Block 0: 基础 system prompt（含 Skill 描述）— 每轮稳定，适合缓存
   * - Block 1+: 动态后缀（memory/reminder/hooks 注入）— 可能每轮变化
   *
   * 各 Provider 根据此结构实现各自的 Prompt Caching 策略：
   * - Anthropic: 在稳定 block 上标记 cache_control
   * - OpenAI: 拼接为字符串，利用自动前缀缓存
   * - 其他: 直接拼接为字符串
   */
  private getSystemPromptBlocks(): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    // Block 0: 基础 system prompt（最稳定的部分）
    if (this.systemPrompt) {
      blocks.push({ type: 'text', text: this.systemPrompt });
    }

    // Block 1+: 动态后缀（memory context, reminder context, hooks 等）
    for (const suffix of this.systemPromptSuffixes.values()) {
      if (suffix) {
        blocks.push({ type: 'text', text: suffix });
      }
    }

    return blocks;
  }

  /**
   * 默认系统提示词（fallback）
   * 仅在 Skill 系统未启用 xuanji-assistant 时使用
   * 正式的系统提示词定义在 src/core/skills/builtin/prompts/xuanji-assistant.ts
   */
  private getDefaultSystemPrompt(): string {
    return 'You are Xuanji, an AI coding assistant. Use your tools to help the user.';
  }

  /**
   * 保存消息历史快照（用于错误回滚）
   *
   * 使用场景：
   * - 在工具执行前保存快照
   * - 如果后续 LLM API 调用失败，恢复到快照状态
   * - 避免消息历史被部分修改导致上下文不一致
   *
   * @returns 当前消息历史的深拷贝
   */
  saveSnapshot(): Message[] {
    // 深拷贝消息数组，避免引用共享
    return this.messages.map(msg => {
      if (Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.map(block => ({ ...block })),
        };
      }
      return { ...msg };
    });
  }

  /**
   * 恢复消息历史快照（用于错误回滚）
   *
   * @param snapshot 之前保存的快照（由 saveSnapshot 返回）
   */
  restoreSnapshot(snapshot: Message[]): void {
    this.messages = snapshot.map(msg => {
      if (Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.map(block => ({ ...block })),
        };
      }
      return { ...msg };
    });
    log.debug(`Message history restored to snapshot (${snapshot.length} messages)`);
  }
}
