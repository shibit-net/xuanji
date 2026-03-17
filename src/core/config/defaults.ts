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
    maxTokens: 64000,  // claude-sonnet-4-5 上限（代理服务直连时有效）
    temperature: undefined,
    timeout: 120_000,
    baseURL: 'https://shibit.net',
    // thinking 功能仅在直连官方 API 时生效，代理服务不支持
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
      // Workflow Skills（真正的技能）
      'commit',
      'review-pr',
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
    // Phase 4: 智能记忆刷新配置（OpenClaw 启发）
    intelligentFlush: {
      enabled: true,
      tokenThreshold: 0.75,
      timeThreshold: 30 * 60 * 1000, // 30 分钟
      valueThreshold: 50,
      keepRecentMessages: 5,
    },
    // Phase 3: 主题提取配置（OpenClaw 启发）
    topicExtraction: {
      enabled: true,
      autoTrigger: 'session-end',
      mergeThreshold: 0.85,
      minEntriesForExtraction: 2,
    },
    // Phase 2: 记忆格式化配置（OpenClaw 风格）
    formatting: {
      style: 'openclaw',
      showAccessCount: true,
      showRelatedMemories: true,
      maxTimelineItems: 10,
    },
    // Phase 5: Token 估算配置
    tokenEstimation: {
      method: 'simple',
      charsPerToken: 3,
    },
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
    archiveThresholds: {
      messageCount: 50,      // 50 条消息
      tokenCount: 100_000,   // 100k tokens
      timeMinutes: 120,      // 2 小时
    },
    archiveStrategy: {
      keepRecentMessages: 10,
      generateSummary: true,
      extractKeyPoints: true,
    },
    autoResumeLastSession: true,
    memoryRetrievalCount: 20,
    showResumeNotification: true,
    maxSessions: 50,
  },
  features: {
    dynamicToolLoading: true, // 默认启用工具按需加载
    useLayeredPromptBuilder: true, // 默认使用分层 Prompt 构建器
    multiAgentTools: true, // 🆕 默认启用 Multi-Agent 工具（委托、编排、管道）
    intentRouter: true, // 🆕 默认启用意图路由系统
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
