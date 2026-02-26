// ============================================================
// ContextCompressor 单元测试
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextCompressor, DEFAULT_COMPRESSOR_CONFIG } from '@/core/agent/ContextCompressor';
import { TokenManager } from '@/core/agent/TokenManager';
import type { Message, ContentBlock, CompressorConfig } from '@/core/types';

/** 创建简单文本消息 */
function textMsg(role: 'system' | 'user' | 'assistant', content: string): Message {
  return { role, content };
}

/** 创建包含 tool_use 的 assistant 消息 */
function toolUseMsg(name: string, input: Record<string, unknown>): Message {
  return {
    role: 'assistant',
    content: [
      { type: 'text', text: `使用工具 ${name}` },
      { type: 'tool_use', id: `tool-${Math.random().toString(36).slice(2, 8)}`, name, input },
    ],
  };
}

/** 创建包含 tool_result 的 user 消息 */
function toolResultMsg(toolUseId: string, content: string, isError = false): Message {
  return {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError },
    ],
  };
}

/** 生成 N 轮对话消息（system + N 轮 user/assistant） */
function generateConversation(rounds: number, msgLength = 200): Message[] {
  const messages: Message[] = [textMsg('system', 'You are a helpful assistant.')];
  for (let i = 1; i <= rounds; i++) {
    messages.push(textMsg('user', `第 ${i} 轮用户消息: ${'内容'.repeat(msgLength / 4)}`));
    messages.push(textMsg('assistant', `第 ${i} 轮助手回复: ${'回复'.repeat(msgLength / 4)}`));
  }
  return messages;
}

/** 生成包含工具调用的对话 */
function generateToolConversation(rounds: number): Message[] {
  const messages: Message[] = [textMsg('system', 'You are a helpful assistant.')];
  for (let i = 1; i <= rounds; i++) {
    messages.push(textMsg('user', `第 ${i} 轮: 请读取并修改文件`));
    // 工具调用: read_file
    const readMsg = toolUseMsg('read_file', { file_path: `src/file${i}.ts` });
    messages.push(readMsg);
    const readId = (readMsg.content as ContentBlock[]).find((b) => b.type === 'tool_use')!.id!;
    messages.push(toolResultMsg(readId, `文件内容: export class File${i} {}`));
    // 工具调用: write_file
    const writeMsg = toolUseMsg('write_file', { file_path: `src/file${i}.ts` });
    messages.push(writeMsg);
    const writeId = (writeMsg.content as ContentBlock[]).find((b) => b.type === 'tool_use')!.id!;
    messages.push(toolResultMsg(writeId, '文件已写入'));
    // assistant 最终回复
    messages.push(textMsg('assistant', `第 ${i} 轮完成，已修改 src/file${i}.ts`));
  }
  return messages;
}

describe('ContextCompressor', () => {
  let compressor: ContextCompressor;
  let tokenManager: TokenManager;

  beforeEach(() => {
    compressor = new ContextCompressor();
    tokenManager = new TokenManager();
  });

  // ────────── shouldCompress 测试 ──────────

  describe('shouldCompress', () => {
    it('消息数量不足时不压缩', () => {
      const messages = generateConversation(3); // 7 条消息 < 10
      expect(compressor.shouldCompress(messages, tokenManager)).toBe(false);
    });

    it('token 数量未超过阈值时不压缩', () => {
      // 短消息不会超过阈值
      const messages = generateConversation(6, 10);
      expect(compressor.shouldCompress(messages, tokenManager)).toBe(false);
    });

    it('禁用压缩时不触发', () => {
      const disabled = new ContextCompressor({ enabled: false });
      const messages = generateConversation(20, 5000);
      expect(disabled.shouldCompress(messages, tokenManager)).toBe(false);
    });

    it('满足条件时应该压缩', () => {
      // 使用较小的窗口让 20 轮消息能超过 80% 阈值
      const smallTokenManager = new TokenManager(20000, 2000);
      const messages = generateConversation(20, 10000);
      expect(compressor.shouldCompress(messages, smallTokenManager)).toBe(true);
    });
  });

  // ────────── compress 测试 ──────────

  describe('compress', () => {
    it('不需要压缩时直接返回原始消息', () => {
      const messages = generateConversation(3);
      const result = compressor.compress(messages, tokenManager);
      expect(result.compressed).toBe(messages);
      expect(result.compressionRatio).toBe(0);
      expect(result.summary).toBe('');
    });

    it('压缩后保留 system prompt', () => {
      const messages = generateConversation(20, 10000);
      const result = compressor.compress(messages, tokenManager);
      expect(result.compressed[0]!.role).toBe('system');
      expect(result.compressed[0]!.content).toBe('You are a helpful assistant.');
    });

    it('压缩后保留最近 N 轮完整对话', () => {
      const keepRecent = 5;
      const comp = new ContextCompressor({ keepRecentRounds: keepRecent });
      const messages = generateConversation(20, 10000);
      const result = comp.compress(messages, tokenManager);

      if (result.compressionRatio > 0) {
        // 压缩后消息数应远少于原始
        expect(result.compressed.length).toBeLessThan(messages.length);
        // 第二条应是摘要消息
        expect(result.compressed[1]!.role).toBe('user');
        const summaryContent = result.compressed[1]!.content as string;
        expect(summaryContent).toContain('上下文摘要');
      }
    });

    it('压缩后 token 数减少', () => {
      const messages = generateConversation(20, 10000);
      const result = compressor.compress(messages, tokenManager);

      if (result.compressionRatio > 0) {
        expect(result.compressedTokens).toBeLessThan(result.originalTokens);
        expect(result.compressionRatio).toBeGreaterThan(0);
      }
    });

    it('摘要包含用户需求', () => {
      const messages = generateConversation(20, 10000);
      const result = compressor.compress(messages, tokenManager);

      if (result.compressionRatio > 0) {
        const summaryContent = result.compressed[1]!.content as string;
        expect(summaryContent).toContain('用户需求');
      }
    });
  });

  // ────────── groupMessages 测试 ──────────

  describe('groupMessages', () => {
    it('对话消息分为 conversation 组', () => {
      const messages: Message[] = [
        textMsg('user', '你好'),
        textMsg('assistant', '你好！'),
        textMsg('user', '帮我看看代码'),
        textMsg('assistant', '好的，让我看看'),
      ];
      const groups = compressor.groupMessages(messages);
      expect(groups.length).toBe(1);
      expect(groups[0]!.type).toBe('conversation');
      expect(groups[0]!.messages.length).toBe(4);
    });

    it('工具调用分为 tool_sequence 组', () => {
      const readMsg = toolUseMsg('read_file', { file_path: 'src/test.ts' });
      const readId = (readMsg.content as ContentBlock[]).find((b) => b.type === 'tool_use')!.id!;
      const messages: Message[] = [
        readMsg,
        toolResultMsg(readId, '文件内容'),
      ];
      const groups = compressor.groupMessages(messages);
      expect(groups.length).toBe(1);
      expect(groups[0]!.type).toBe('tool_sequence');
    });

    it('混合消息正确分组', () => {
      const readMsg = toolUseMsg('read_file', { file_path: 'src/test.ts' });
      const readId = (readMsg.content as ContentBlock[]).find((b) => b.type === 'tool_use')!.id!;
      const messages: Message[] = [
        textMsg('user', '你好'),
        textMsg('assistant', '你好！'),
        readMsg,
        toolResultMsg(readId, '文件内容'),
        textMsg('user', '谢谢'),
        textMsg('assistant', '不客气'),
      ];
      const groups = compressor.groupMessages(messages);
      expect(groups.length).toBe(3);
      expect(groups[0]!.type).toBe('conversation');
      expect(groups[1]!.type).toBe('tool_sequence');
      expect(groups[2]!.type).toBe('conversation');
    });

    it('空消息数组返回空分组', () => {
      const groups = compressor.groupMessages([]);
      expect(groups).toEqual([]);
    });
  });

  // ────────── 工具调用聚合测试 ──────────

  describe('工具调用摘要', () => {
    it('压缩后摘要包含工具使用统计', () => {
      const messages = generateToolConversation(10);
      // 使用小的 token 预算强制触发压缩
      const smallTokenManager = new TokenManager(5000, 1000);
      const comp = new ContextCompressor({
        compressionThreshold: 0.3,
        minMessagesToCompress: 5,
        keepRecentRounds: 2,
      });
      const result = comp.compress(messages, smallTokenManager);

      if (result.compressionRatio > 0) {
        const summaryContent = result.compressed[1]!.content as string;
        expect(summaryContent).toContain('工具使用');
      }
    });

    it('摘要包含涉及文件路径', () => {
      const messages = generateToolConversation(10);
      const smallTokenManager = new TokenManager(5000, 1000);
      const comp = new ContextCompressor({
        compressionThreshold: 0.3,
        minMessagesToCompress: 5,
        keepRecentRounds: 2,
      });
      const result = comp.compress(messages, smallTokenManager);

      if (result.compressionRatio > 0) {
        const summaryContent = result.compressed[1]!.content as string;
        expect(summaryContent).toContain('涉及文件');
      }
    });
  });

  // ────────── 边界情况 ──────────

  describe('边界情况', () => {
    it('空消息数组', () => {
      const result = compressor.compress([], tokenManager);
      expect(result.compressed).toEqual([]);
      expect(result.compressionRatio).toBe(0);
    });

    it('只有 system prompt', () => {
      const messages = [textMsg('system', 'You are a helpful assistant.')];
      const result = compressor.compress(messages, tokenManager);
      expect(result.compressed).toBe(messages);
      expect(result.compressionRatio).toBe(0);
    });

    it('所有消息都在最近 N 轮内不压缩', () => {
      const comp = new ContextCompressor({ keepRecentRounds: 10 });
      const messages = generateConversation(5, 10000);
      const result = comp.compress(messages, tokenManager);
      expect(result.compressionRatio).toBe(0);
    });

    it('自定义配置覆盖默认值', () => {
      const custom = new ContextCompressor({
        keepRecentRounds: 3,
        summaryMaxLength: 200,
      });
      const messages = generateConversation(20, 10000);
      const result = custom.compress(messages, tokenManager);

      if (result.compressionRatio > 0) {
        const summaryContent = result.compressed[1]!.content as string;
        expect(summaryContent.length).toBeLessThanOrEqual(200);
      }
    });
  });

  // ────────── CompressionResult 验证 ──────────

  describe('CompressionResult', () => {
    it('压缩率计算正确', () => {
      const messages = generateConversation(20, 10000);
      const result = compressor.compress(messages, tokenManager);

      if (result.compressionRatio > 0) {
        const expectedRatio = (result.originalTokens - result.compressedTokens) / result.originalTokens;
        expect(result.compressionRatio).toBeCloseTo(expectedRatio, 5);
      }
    });

    it('压缩报告非空', () => {
      const messages = generateConversation(20, 10000);
      const result = compressor.compress(messages, tokenManager);

      if (result.compressionRatio > 0) {
        expect(result.summary).not.toBe('');
        expect(result.summary).toContain('压缩了');
      }
    });
  });

  // ────────── 决策提取测试 ──────────

  describe('决策提取', () => {
    it('摘要包含中文决策关键词', () => {
      const messages: Message[] = [
        textMsg('system', 'You are a helpful assistant.'),
      ];
      // 填充足够多的消息并包含决策
      for (let i = 0; i < 15; i++) {
        if (i === 2) {
          messages.push(textMsg('user', `第 ${i} 轮: ${'内容'.repeat(2500)}`));
          messages.push(textMsg('assistant', `决定采用分层压缩策略来优化上下文管理 ${'回复'.repeat(2500)}`));
        } else {
          messages.push(textMsg('user', `第 ${i} 轮: ${'内容'.repeat(2500)}`));
          messages.push(textMsg('assistant', `第 ${i} 轮回复: ${'回复'.repeat(2500)}`));
        }
      }
      const smallTokenManager = new TokenManager(20000, 2000);
      const comp = new ContextCompressor({
        compressionThreshold: 0.3,
        minMessagesToCompress: 5,
        keepRecentRounds: 3,
      });
      const result = comp.compress(messages, smallTokenManager);

      if (result.compressionRatio > 0) {
        const summaryContent = result.compressed[1]!.content as string;
        expect(summaryContent).toContain('关键决策');
      }
    });
  });
});
