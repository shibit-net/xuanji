import { describe, it, expect, beforeEach } from 'vitest';
import { AgentLoop } from '@/core/agent/AgentLoop';
import type { AgentConfig, Message } from '@/core/types';
import { ToolRegistry } from '@/core/tools/ToolRegistry';

// Mock Provider
class MockProvider {
  async stream() {
    return (async function* () {
      yield { type: 'text_delta', text: 'test' };
      yield { type: 'end', stopReason: 'end_turn', usage: { input: 10, output: 5 } };
    })();
  }
}

describe('AgentLoop - Content Append API', () => {
  let agentLoop: AgentLoop;
  let provider: MockProvider;
  let registry: ToolRegistry;

  beforeEach(() => {
    provider = new MockProvider();
    registry = new ToolRegistry();
    
    const config: AgentConfig = {
      model: 'test-model',
      apiKey: 'test-key',
      maxIterations: 10,
      systemPrompt: 'Test system prompt',
      maxTokens: 1000,
      temperature: 0.7,
    };

    agentLoop = new AgentLoop(provider as any, registry, config);
  });

  describe('getLastBoundary()', () => {
    it('空历史应返回 null', () => {
      const boundary = agentLoop.getLastBoundary();
      expect(boundary).toBe(null);
    });

    it('最后一条是 user 消息应返回 "user"', async () => {
      // 模拟添加一条 user 消息
      const messageManager = agentLoop.getMessageManager();
      messageManager.addUserMessage('Hello');
      
      const boundary = agentLoop.getLastBoundary();
      expect(boundary).toBe('user');
    });

    it('最后一条是 assistant 消息应返回 "assistant"', async () => {
      const messageManager = agentLoop.getMessageManager();
      messageManager.addUserMessage('Hello');
      messageManager.addAssistantMessage([{ type: 'text', text: 'Hi' }]);
      
      const boundary = agentLoop.getLastBoundary();
      expect(boundary).toBe('assistant');
    });

    it('最后一条 user 消息包含 tool_result 应返回 "tool_result"', async () => {
      const messageManager = agentLoop.getMessageManager();
      messageManager.addUserMessage('Hello');
      messageManager.addAssistantMessage([
        { type: 'tool_use', id: 'tc-1', name: 'read_file', input: { path: '/test' } }
      ]);
      // 直接构造包含 tool_result 的 user 消息
      messageManager.addUserMessage([
        { type: 'tool_result', tool_use_id: 'tc-1', content: 'file content' }
      ] as any);
      
      const boundary = agentLoop.getLastBoundary();
      expect(boundary).toBe('tool_result');
    });
  });

  describe('hasPendingAppend()', () => {
    it('初始状态应返回 false', () => {
      expect(agentLoop.hasPendingAppend()).toBe(false);
    });

    it('在非运行状态调用 appendMessage 不会设置 pending（被忽略）', () => {
      // AgentLoop 未运行时，appendMessage 会被忽略（参见 AgentLoop.ts 第 729 行）
      agentLoop.appendMessage('追加消息');
      expect(agentLoop.hasPendingAppend()).toBe(false);
    });

    it('在非运行状态调用 interrupt 不会设置 pending（被忽略）', () => {
      // AgentLoop 未运行时，interrupt 会被忽略（参见 AgentLoop.ts 第 750 行）
      agentLoop.interrupt('中断并追加');
      expect(agentLoop.hasPendingAppend()).toBe(false);
    });

    it('stop 后应清空 pending 状态', () => {
      // 模拟运行状态下的追加（实际场景中需要 run() 正在执行）
      // 这里只测试 stop() 的清空逻辑
      agentLoop.stop();
      expect(agentLoop.hasPendingAppend()).toBe(false);
    });
  });

  describe('appendMessage() vs interrupt() 行为', () => {
    it('appendMessage 在非运行状态下被忽略', () => {
      agentLoop.appendMessage('温和追加');
      expect(agentLoop.hasPendingAppend()).toBe(false);
    });

    it('interrupt 在非运行状态下被忽略', () => {
      agentLoop.interrupt('硬中断');
      expect(agentLoop.hasPendingAppend()).toBe(false);
    });

    // 注意：实际的 append 和 interrupt 行为需要在 run() 过程中测试
    // 这需要 mock Provider 和完整的流处理，超出单元测试范围
    // 应在集成测试中验证
  });

  describe('消息历史管理', () => {
    it('restoreMessages 应替换消息历史', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Test message' },
        { role: 'assistant', content: [{ type: 'text', text: 'Response' }] },
      ];

      agentLoop.restoreMessages(messages);
      const history = agentLoop.getMessageHistory();
      
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[1].role).toBe('assistant');
    });

    it('getMessageHistory 应返回不含 system prompt 的历史', () => {
      const messageManager = agentLoop.getMessageManager();
      messageManager.addUserMessage('Hello');
      
      const history = agentLoop.getMessageHistory();
      
      // 验证不包含 system prompt（第一条消息应该是 user）
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('user');
    });
  });

  describe('状态管理', () => {
    it('getState 应返回正确的初始状态', () => {
      const state = agentLoop.getState();
      
      expect(state.status).toBe('idle');
      expect(state.messages).toEqual([]);
      expect(state.tokenUsage).toEqual({ input: 0, output: 0 });
      expect(state.cost).toBe(0);
      expect(state.currentIteration).toBe(0);
    });

    it('reset 应清空会话状态', () => {
      // 添加一些消息
      const messageManager = agentLoop.getMessageManager();
      messageManager.addUserMessage('Hello');
      
      // 重置
      agentLoop.reset();
      
      const state = agentLoop.getState();
      expect(state.messages).toEqual([]);
      expect(state.currentIteration).toBe(0);
    });
  });
});
