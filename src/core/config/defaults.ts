// ============================================================
// M9 配置管理 — 默认配置
// ============================================================

import type { AppConfig } from '@/core/types';
import { DEFAULT_ROUTING_CONFIG } from '@/core/routing/TaskRouter';

/**
 * 默认应用配置
 */
export const DEFAULT_CONFIG: AppConfig = {
  provider: {
    model: '[CC]claude-sonnet-4-5-20250929',
    lightModel: '[CC]claude-haiku-4-5-20251001',
    adapter: 'anthropic',
    maxTokens: 64000,  // ✅ 修复：claude-sonnet-4-5 限制为 64000
    temperature: undefined,
    timeout: 120_000,
    baseURL: 'https://shibit.net',
    // 🆕 P0 优化：Extended Thinking 默认配置（自适应模式，中等深度）
    thinking: {
      type: 'adaptive',
      effort: 'medium',
    },
  },
  ui: {
    theme: 'auto',
    language: 'en',
    showTokenUsage: true,
    showCost: true,
    showThinking: false,
  },
  tools: {
    enabled: [],
    schemaMode: 'compact', // 默认使用极简模式
    resultSummary: {
      enabled: false, // 默认不启用（Phase 2 功能）
      threshold: 10_000,
      tools: ['read_file', 'bash', 'grep'],
    },
    permissions: {
      fileWrite: 'ask',
      fileRead: 'always',
      bashExec: 'ask',
      warnLevel: 'ask', // 默认需要确认 warn 级别操作（更保守，之前是 auto-allow）
      confirmWrite: 'plan-only', // 新增：依赖 LLM 通过 plan_review 主动确认（平衡模式）
      confirmBatchWrite: false, // 默认不启用批量确认合并
      allowedCommands: [],
      deniedCommands: [],
      allowedPaths: [],
      deniedPaths: [],
      persistDecisions: true,  // ← 新增
      decisionsFile: '.xuanji/permission-decisions.json',  // ← 新增
    },
  },
  retry: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30_000,
    backoffMultiplier: 2,
    retryableStatusCodes: [429, 500, 502, 503, 529],
  },
  skills: {
    enabled: [
      'xuanji-assistant',
      'memory-context',
      'code-assistant',
      'life-secretary',
      'tool-guidance',
      'security-rules',
      'agent-rules',
    ],
    disabled: [],
    loadCustom: true,
    customPath: '.xuanji/skills',
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
  },
  agent: {
    subAgent: {
      maxNestingDepth: 3,
      maxConcurrent: 3,
      timeout: 300_000, // 5 minutes
      maxIterations: Infinity,
    },
  },
  session: {
    autoSave: true,
    autoSaveInterval: 1,
    maxSessions: 50,
    maxMessages: 100,
  },
  features: {
    dynamicToolLoading: true, // 默认启用工具按需加载
  },
  butler: {
    enabled: true, // ✅ 启用智能管家
    decisionModel: null, // 使用默认轻量模型
    decisionTemperature: 0.3,
    antiBother: {
      minIntervalMinutes: 60,
      quietHours: ['22:00', '08:00'],
      dailySummaryTime: '09:00',
    },
    checkSchedule: ['09:00', '20:00'], // 每天早晚各一次主动检查
    fallbackIntervalMinutes: 60, // 每小时兜底检查
    defaultChannels: ['system'],
    storageFile: 'butler_pushes.jsonl',
  },
  routing: DEFAULT_ROUTING_CONFIG, // 使用 TaskRouter 默认配置
  planner: {
    model: 'claude-3-5-sonnet-20241022', // Planner 使用 Sonnet 模型
    maxSteps: 10,
    timeout: 30000,
    requireConfirmation: true, // 默认需要用户确认计划
  },
  executor: {
    maxConcurrent: 3, // 最多并行执行 3 个子任务
    timeout: 300000, // 5 分钟超时
    stopOnError: false, // 默认不在错误时停止（继续执行其他任务）
  },
};
