/**
 * TeamManager 测试辅助工具
 */

import { vi } from 'vitest';
import type { ILLMProvider, IToolRegistry, AgentConfig } from '@/core/types';
import type { AgentRegistry } from '@/agent/AgentRegistry';
import type { ProviderManager } from '@/provider/ProviderManager';

/**
 * 创建 mock 的 AgentRegistry
 */
export function createMockAgentRegistry(): AgentRegistry {
  return {
    getAgent: vi.fn().mockReturnValue({
      id: 'general-purpose',
      name: 'General Purpose',
      systemPrompt: 'Test prompt',
      tools: ['read_file', 'write_file'],
      model: 'claude-3-5-sonnet-20241022',
    }),
    listAgents: vi.fn().mockReturnValue([]),
    hasAgent: vi.fn().mockReturnValue(true),
  } as any;
}

/**
 * 创建 mock 的 ProviderManager
 */
export function createMockProviderManager(mockProvider: ILLMProvider): ProviderManager {
  return {
    getProvider: vi.fn().mockReturnValue(mockProvider),
    getDefaultProvider: vi.fn().mockReturnValue(mockProvider),
  } as any;
}

/**
 * 创建 mock 的 LLM Provider
 */
export function createMockProvider(): ILLMProvider {
  return {
    chat: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Mock response' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
    streamChat: vi.fn(),
  } as any;
}

/**
 * 创建 mock 的 ToolRegistry
 */
export function createMockToolRegistry(): IToolRegistry {
  return {
    getTool: vi.fn(),
    listTools: vi.fn().mockReturnValue([]),
    hasTool: vi.fn().mockReturnValue(false),
  } as any;
}

/**
 * 创建 mock 的 AgentConfig
 */
export function createMockAgentConfig(): AgentConfig {
  return {
    model: 'test-model',
    maxIterations: 50,
    temperature: 0.7,
    timeout: 300000,
  } as any;
}
