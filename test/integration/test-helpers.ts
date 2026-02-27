// ============================================================
// 集成测试辅助工具
// ============================================================

import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';
import type {
  ILLMProvider,
  StreamEvent,
  AppConfig,
  ProviderConfig,
  Message,
  ToolSchema,
} from '@/core/types';
import type { MemoryEntry, MemoryConfig } from '@/memory/types';
import type { Reminder } from '@/reminder/types';

/**
 * 测试环境配置
 */
export interface TestEnvironment {
  /** 临时目录根路径 */
  tempDir: string;
  /** 记忆存储目录 */
  memoryDir: string;
  /** 提醒存储文件 */
  remindersFile: string;
}

/**
 * 创建隔离的临时测试环境
 */
export async function createTestEnvironment(): Promise<TestEnvironment> {
  const tempDir = await mkdtemp(join(tmpdir(), 'xuanji-integration-'));
  const memoryDir = join(tempDir, 'memory');
  const remindersFile = join(tempDir, 'reminders.jsonl');

  await mkdir(memoryDir, { recursive: true });

  return { tempDir, memoryDir, remindersFile };
}

/**
 * 清理测试环境
 */
export async function cleanupTestEnvironment(tempDir: string): Promise<void> {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    // 忽略清理错误
    console.warn(`清理测试环境失败: ${error}`);
  }
}

/**
 * 创建 Mock Provider（支持多轮对话）
 */
export function createMockProvider(responses: StreamEvent[][]): ILLMProvider {
  let callIndex = 0;

  return {
    name: 'mock',
    models: ['mock-model'],
    isSupported: (model: string) => model.includes('mock'),
    stream: vi.fn(async function* (
      _messages: Message[],
      _tools: ToolSchema[],
      _config: ProviderConfig
    ): AsyncIterable<StreamEvent> {
      const events = responses[callIndex] ?? [];
      callIndex++;
      for (const event of events) {
        yield event;
      }
    }),
  };
}

/**
 * 预填充记忆数据（用于测试 memory_search）
 */
export async function seedMemories(
  memoryDir: string,
  entries: MemoryEntry[]
): Promise<void> {
  const knowledgePath = join(memoryDir, 'knowledge.jsonl');
  const personalPath = join(memoryDir, 'personal.jsonl');

  // 分类存储
  const knowledgeEntries = entries.filter((e) =>
    ['user_preference', 'user_fact', 'project_fact', 'decision', 'tool_pattern', 'error_resolution', 'session_summary'].includes(e.type)
  );
  const personalEntries = entries.filter((e) =>
    ['relationship', 'important_date'].includes(e.type)
  );

  // 写入 knowledge.jsonl
  if (knowledgeEntries.length > 0) {
    const content = knowledgeEntries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await writeFile(knowledgePath, content, 'utf-8');
  }

  // 写入 personal.jsonl
  if (personalEntries.length > 0) {
    const content = personalEntries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await writeFile(personalPath, content, 'utf-8');
  }
}

/**
 * 预填充提醒数据（用于测试启动提醒）
 */
export async function seedReminders(
  remindersFile: string,
  reminders: Reminder[]
): Promise<void> {
  const content = reminders.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(remindersFile, content, 'utf-8');
}

/**
 * 提取工具调用序列（用于验证）
 */
export function extractToolCalls(
  events: StreamEvent[]
): Array<{ name: string; input: Record<string, unknown> }> {
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

  for (const event of events) {
    if (event.type === 'tool_use_end' && event.toolCall) {
      toolCalls.push({
        name: event.toolCall.name ?? 'unknown',
        input: (event.toolCall.input ?? {}) as Record<string, unknown>,
      });
    }
  }

  return toolCalls;
}

/**
 * 创建测试用的 AppConfig（指定临时目录）
 */
export function createTestConfig(tempDir: string, overrides?: Partial<AppConfig>): AppConfig {
  const baseConfig: AppConfig = {
    provider: {
      model: 'mock-model',
      adapter: 'anthropic',
      maxTokens: 4096,
      temperature: 0.7,
      apiKey: 'test-api-key',
    },
    ui: {
      theme: 'auto',
      language: 'zh',
      showTokenUsage: false,
      showCost: false,
      showThinking: false,
    },
    tools: {
      enabled: [],
      permissions: {
        fileWrite: 'always',
        fileRead: 'always',
        bashExec: 'always',
      },
    },
    memory: {
      enabled: true,
      shortTermMaxEntries: 100,
      longTermMaxEntries: 1000,
      retrieveMaxResults: 10,
      maxEntryLength: 500,
      maxPromptLength: 5000,
      compactionThreshold: 500,
      decayHalfLifeDays: 30,
      extractorModel: null,
      extractorTemperature: 0.3,
      extractorTimeout: 60_000,
      extractorMinConfidence: 0.6,
    },
    skills: {
      enabled: [
        'xuanji-assistant',
        'memory-context',
        'life-secretary',
        'code-assistant',
      ],
      disabled: [],
      loadCustom: false,
    },
    retry: {
      maxRetries: 0, // 集成测试中禁用重试
      initialDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      retryableStatusCodes: [429, 500, 502, 503, 529],
    },
  };

  // 合并覆盖配置
  if (overrides) {
    return {
      ...baseConfig,
      ...overrides,
      provider: { ...baseConfig.provider, ...overrides.provider },
      ui: { ...baseConfig.ui, ...overrides.ui },
      tools: { ...baseConfig.tools, ...overrides.tools },
      memory: { ...baseConfig.memory, ...overrides.memory } as MemoryConfig,
      skills: { ...baseConfig.skills, ...overrides.skills },
      retry: { ...baseConfig.retry, ...overrides.retry },
    };
  }

  return baseConfig;
}
