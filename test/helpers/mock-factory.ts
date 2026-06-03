/**
 * Mock 工厂 - 测试基础设施
 * 
 * 提供智能 Mock Provider、性能测试辅助、Fixture 管理等功能
 */

import { vi } from 'vitest';
import type { ILLMProvider, IToolRegistry, AgentConfig } from '@/infrastructure/core-types';
import type { TeamExecutionResult } from '@/agent/team/types';
import * as fs from 'fs';
import * as path from 'path';

// ==================== Mock Provider ====================

export interface IntelligentMockConfig {
  /** 随机延迟范围 [min, max] 毫秒 */
  delay?: [number, number];
  /** 关键词 → 响应映射 */
  responses?: Record<string, string>;
  /** 默认响应 */
  defaultResponse?: string;
  /** 是否记录调用 */
  recordCalls?: boolean;
}

/**
 * 创建智能 Mock Provider
 * 根据消息内容返回不同响应
 */
export function createIntelligentMockProvider(config?: IntelligentMockConfig): ILLMProvider {
  const calls: Array<{ messages: any[]; response: string; timestamp: number }> = [];
  
  const chatSync = vi.fn(async (messages: any[]) => {
    // 模拟真实延迟
    if (config?.delay) {
      const [min, max] = config.delay;
      const delay = min + Math.random() * (max - min);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // 获取最后一条消息
    const lastMessage = messages[messages.length - 1];
    const content = typeof lastMessage.content === 'string' 
      ? lastMessage.content 
      : String(lastMessage.content);
    
    // 根据关键词匹配响应
    let response = config?.defaultResponse || 'Mock response';
    
    if (config?.responses) {
      for (const [keyword, resp] of Object.entries(config.responses)) {
        if (content.toLowerCase().includes(keyword.toLowerCase())) {
          response = resp;
          break;
        }
      }
    }
    
    // 记录调用
    if (config?.recordCalls) {
      calls.push({
        messages: JSON.parse(JSON.stringify(messages)),
        response,
        timestamp: Date.now(),
      });
    }
    
    return { 
      content: response, 
      stopReason: 'end_turn' as const 
    };
  });
  
  const chat = vi.fn(async function* (messages: any[]) {
    const response = await chatSync(messages);
    yield { type: 'text_delta', text: response.content };
    yield { type: 'end', stopReason: 'end_turn', usage: { input: 10, output: 5 } };
  });

  const stream = vi.fn(async function* (messages: any[]) {
    const response = await chatSync(messages);
    yield { type: 'usage', usage: { input: 10, output: 0 } };
    yield { type: 'text_delta', text: response.content };
    yield { type: 'end', stopReason: 'end_turn', usage: { input: 0, output: 5 } };
  });
  
  return {
    name: 'intelligent-mock',
    chat,
    chatSync,
    stream,
    getCalls: () => calls,
  } as any;
}

/**
 * 创建简单 Mock Provider（固定响应）
 */
export function createSimpleMockProvider(response = 'Mock response'): ILLMProvider {
  return {
    name: 'simple-mock',
    chat: vi.fn(async function* () {
      yield { type: 'text_delta', text: response };
      yield { type: 'end', stopReason: 'end_turn', usage: { input: 10, output: 5 } };
    }),
    chatSync: vi.fn(async () => ({
      content: response,
      stopReason: 'end_turn' as const
    })),
    stream: vi.fn(async function* () {
      yield { type: 'usage', usage: { input: 10, output: 0 } };
      yield { type: 'text_delta', text: response };
      yield { type: 'end', stopReason: 'end_turn', usage: { input: 0, output: 5 } };
    }),
  } as any;
}

/**
 * 创建场景化 Mock Provider（多步骤响应）
 */
export function createScenarioMockProvider(
  scenarios: Record<string, string[]>
): ILLMProvider {
  const callCounts: Record<string, number> = {};
  
  const chatSync = vi.fn(async (messages: any[]) => {
    const lastMessage = messages[messages.length - 1];
    const content = String(lastMessage.content).toLowerCase();
    
    // 找到匹配的场景
    for (const [keyword, responses] of Object.entries(scenarios)) {
      if (content.includes(keyword.toLowerCase())) {
        callCounts[keyword] = (callCounts[keyword] || 0) + 1;
        const index = Math.min(callCounts[keyword] - 1, responses.length - 1);
        return { 
          content: responses[index], 
          stopReason: 'end_turn' as const 
        };
      }
    }
    
    return { 
      content: 'Mock response', 
      stopReason: 'end_turn' as const 
    };
  });
  
  return {
    name: 'scenario-mock',
    chatSync,
    chat: vi.fn(async function* (messages: any[]) {
      const response = await chatSync(messages);
      yield { type: 'text_delta', text: response.content };
      yield { type: 'end', stopReason: 'end_turn', usage: { input: 10, output: 5 } };
    }),
    stream: vi.fn(async function* (messages: any[]) {
      const response = await chatSync(messages);
      yield { type: 'usage', usage: { input: 10, output: 0 } };
      yield { type: 'text_delta', text: response.content };
      yield { type: 'end', stopReason: 'end_turn', usage: { input: 0, output: 5 } };
    }),
  } as any;
}

// ==================== Mock Tool Registry ====================

/**
 * 创建 Mock Tool Registry
 */
export function createMockToolRegistry(): IToolRegistry {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(),
    getAll: vi.fn(() => []),
    getSchemas: vi.fn(() => []),
    has: vi.fn(() => false),
    execute: vi.fn(async () => ({ 
      content: 'mock tool result', 
      isError: false 
    })),
  } as any;
}

/**
 * 创建 Mock Agent Config
 */
export function createMockAgentConfig(): AgentConfig {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    temperature: 0.7,
    maxTokens: 4096,
    maxIterations: 30,
  } as any;
}

/**
 * 创建 Mock Agent Registry
 */
export function createMockAgentRegistry(): any {
  // 创建一个通用的 agent 配置，用于所有角色
  const mockAgentConfig = {
    id: 'mock-agent',
    name: 'Mock Agent',
    systemPrompt: 'You are a helpful assistant.',
    model: {
      primary: 'claude-sonnet-4',
      temperature: 0.7,
      maxTokens: 4096,
    },
    execution: {
      timeout: 60000,
      maxIterations: 10,
    },
    tools: [],
    metadata: {
      builtin: true,
      source: 'mock',
    },
  };

  return {
    register: vi.fn(),
    get: vi.fn((id: string) => ({
      ...mockAgentConfig,
      id,
      name: `Mock Agent (${id})`,
    })),
    has: vi.fn(() => true),
    getAll: vi.fn(() => [mockAgentConfig]),
  };
}

/**
 * 创建 Mock Provider Manager
 */
export function createMockProviderManager(mockProvider?: ILLMProvider): any {
  const defaultProvider = mockProvider || createSimpleMockProvider();
  
  return {
    getProvider: vi.fn(() => defaultProvider),
    hasProvider: vi.fn(() => true),
    registerProvider: vi.fn(),
  };
}

// ==================== 性能测试辅助 ====================

export interface BenchmarkResult {
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  samples: number[];
}

/**
 * 性能基准测试
 * @param name 测试名称
 * @param fn 要测试的函数
 * @param iterations 迭代次数
 */
export async function benchmark(
  name: string,
  fn: () => Promise<void>,
  iterations = 10
): Promise<BenchmarkResult> {
  const durations: number[] = [];
  
  console.log(`\n🔥 Benchmarking: ${name} (${iterations} iterations)`);
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const duration = performance.now() - start;
    durations.push(duration);
    
    if ((i + 1) % Math.max(1, Math.floor(iterations / 5)) === 0) {
      console.log(`  Progress: ${i + 1}/${iterations} iterations`);
    }
  }
  
  durations.sort((a, b) => a - b);
  
  const result: BenchmarkResult = {
    avg: durations.reduce((a, b) => a + b, 0) / iterations,
    min: durations[0],
    max: durations[iterations - 1],
    p50: durations[Math.floor(iterations * 0.5)],
    p95: durations[Math.floor(iterations * 0.95)],
    p99: durations[Math.floor(iterations * 0.99)],
    samples: durations,
  };
  
  console.log(`  ✅ Results: avg=${result.avg.toFixed(2)}ms, p50=${result.p50.toFixed(2)}ms, p95=${result.p95.toFixed(2)}ms`);
  
  return result;
}

/**
 * 断言性能符合基准
 * @param result 实际测试结果
 * @param baseline 基准配置
 */
export function assertPerformance(
  result: BenchmarkResult,
  baseline: { avg: number; tolerance: number }
): void {
  const maxAllowed = baseline.avg * (1 + baseline.tolerance);
  const minAllowed = baseline.avg * (1 - baseline.tolerance * 0.5);
  
  if (result.avg > maxAllowed) {
    throw new Error(
      `Performance regression detected!\n` +
      `  Expected: ${baseline.avg.toFixed(2)}ms (±${(baseline.tolerance * 100).toFixed(0)}%)\n` +
      `  Actual: ${result.avg.toFixed(2)}ms\n` +
      `  Max allowed: ${maxAllowed.toFixed(2)}ms\n` +
      `  Exceeded by: ${((result.avg / maxAllowed - 1) * 100).toFixed(1)}%`
    );
  }
  
  if (result.avg < minAllowed) {
    console.warn(
      `⚠️  Performance significantly improved (possible measurement error?):\n` +
      `  Expected: ${baseline.avg.toFixed(2)}ms\n` +
      `  Actual: ${result.avg.toFixed(2)}ms\n` +
      `  Improved by: ${((1 - result.avg / baseline.avg) * 100).toFixed(1)}%`
    );
  }
}

/**
 * 比较两个性能结果
 */
export function comparePerformance(
  baseline: BenchmarkResult,
  current: BenchmarkResult
): {
  avgChange: number; // 百分比变化
  p95Change: number;
  improved: boolean;
} {
  const avgChange = (current.avg / baseline.avg - 1) * 100;
  const p95Change = (current.p95 / baseline.p95 - 1) * 100;
  const improved = avgChange < 0;
  
  return { avgChange, p95Change, improved };
}

// ==================== Fixture 管理 ====================

const FIXTURES_DIR = path.join(__dirname, '../fixtures');

/**
 * 确保 fixtures 目录存在
 */
export function ensureFixturesDir(): void {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }
}

/**
 * 创建测试 Fixture 文件
 * @param name 文件名
 * @param content 文件内容
 * @returns 文件完整路径
 */
export function createTestFixture(name: string, content: string): string {
  ensureFixturesDir();
  const fixturePath = path.join(FIXTURES_DIR, name);
  fs.writeFileSync(fixturePath, content, 'utf-8');
  return fixturePath;
}

/**
 * 读取测试 Fixture
 */
export function readTestFixture(name: string): string {
  const fixturePath = path.join(FIXTURES_DIR, name);
  return fs.readFileSync(fixturePath, 'utf-8');
}

/**
 * 清理测试 Fixture
 */
export function cleanupFixtures(): void {
  if (fs.existsSync(FIXTURES_DIR)) {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
  }
}

// ==================== 结果验证辅助 ====================

/**
 * 断言 TeamExecutionResult 结构有效
 */
export function assertValidTeamResult(result: TeamExecutionResult): void {
  // 基本字段
  expect(result).toHaveProperty('success');
  expect(result).toHaveProperty('output');
  expect(result).toHaveProperty('memberResults');
  expect(result).toHaveProperty('totalTokens');
  expect(result).toHaveProperty('duration');
  expect(result).toHaveProperty('rounds');
  expect(result).toHaveProperty('timedOut');
  
  // 类型检查
  expect(typeof result.success).toBe('boolean');
  expect(typeof result.output).toBe('string');
  expect(Array.isArray(result.memberResults)).toBe(true);
  expect(typeof result.duration).toBe('number');
  expect(typeof result.rounds).toBe('number');
  expect(typeof result.timedOut).toBe('boolean');
  
  // Token 统计
  expect(result.totalTokens).toHaveProperty('input');
  expect(result.totalTokens).toHaveProperty('output');
  expect(typeof result.totalTokens.input).toBe('number');
  expect(typeof result.totalTokens.output).toBe('number');
  expect(result.totalTokens.input).toBeGreaterThanOrEqual(0);
  expect(result.totalTokens.output).toBeGreaterThanOrEqual(0);
  
  // 成员结果
  result.memberResults.forEach((memberResult, index) => {
    expect(memberResult).toHaveProperty('taskId');
    expect(memberResult).toHaveProperty('memberId');
    expect(memberResult).toHaveProperty('result');
    expect(memberResult).toHaveProperty('success');
    expect(memberResult).toHaveProperty('duration');
    expect(memberResult).toHaveProperty('tokensUsed');
    
    expect(typeof memberResult.taskId).toBe('string');
    expect(typeof memberResult.memberId).toBe('string');
    expect(typeof memberResult.result).toBe('string');
    expect(typeof memberResult.success).toBe('boolean');
    expect(typeof memberResult.duration).toBe('number');
  });
}

/**
 * 断言团队执行成功
 */
export function assertTeamSuccess(result: TeamExecutionResult): void {
  expect(result.success).toBe(true);
  expect(result.timedOut).toBe(false);
  expect(result.output).toBeTruthy();
  expect(result.memberResults.length).toBeGreaterThan(0);
  expect(result.memberResults.every(r => r.success)).toBe(true);
}

/**
 * 断言执行时间在范围内
 */
export function assertDurationInRange(
  duration: number,
  expectedRange: [number, number]
): void {
  const [min, max] = expectedRange;
  expect(duration).toBeGreaterThanOrEqual(min);
  expect(duration).toBeLessThanOrEqual(max);
}

// ==================== 数据生成辅助 ====================

/**
 * 生成随机延迟
 */
export function randomDelay(min: number, max: number): Promise<void> {
  const delay = min + Math.random() * (max - min);
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * 生成随机整数
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * 生成测试用的代码片段（有问题的代码）
 */
export function generateCodeWithIssues(): string {
  return `
// 这是一个有多个问题的代码示例
class UserManager {
  private users: any = {}; // ❌ 使用 any 类型
  
  // ❌ 没有输入验证
  addUser(id: string, data: any) {
    this.users[id] = data;
    console.log('User added:', id); // ❌ 生产代码中使用 console.log
  }
  
  // ❌ 直接返回内部状态，没有防御性拷贝
  getAllUsers() {
    return this.users;
  }
  
  // ❌ SQL 注入风险
  deleteUser(id: string) {
    const query = \`DELETE FROM users WHERE id = '\${id}'\`;
    // executeQuery(query);
  }
  
  // ❌ 性能问题：O(n) 查找
  findUserByEmail(email: string) {
    for (const id in this.users) {
      if (this.users[id].email === email) {
        return this.users[id];
      }
    }
    return null;
  }
}
  `.trim();
}

/**
 * 生成研究主题列表
 */
export function generateResearchTopics(): string[] {
  return [
    'TypeScript best practices',
    'React Server Components architecture',
    'Multi-agent system design patterns',
    'Performance optimization techniques',
    'Test-driven development strategies',
  ];
}

/**
 * 生成辩论场景
 */
export function generateDebateScenarios(): Array<{
  topic: string;
  perspectives: string[];
}> {
  return [
    {
      topic: 'Microservices vs Monolith',
      perspectives: ['simplicity', 'scalability', 'practical'],
    },
    {
      topic: 'SQL vs NoSQL database choice',
      perspectives: ['consistency', 'flexibility', 'performance'],
    },
    {
      topic: 'REST vs GraphQL API design',
      perspectives: ['simplicity', 'efficiency', 'maintainability'],
    },
  ];
}
