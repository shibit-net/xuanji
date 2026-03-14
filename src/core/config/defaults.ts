// ============================================================
// M9 配置管理 — 默认配置
// ============================================================

import type { AppConfig } from '@/core/types';

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
  agents: {
    enabled: false, // 默认禁用 Multi-Agent 模式（需要用户显式启用）
    defaultAgent: 'code-assistant',
    confidenceThreshold: 0.6,
    definitions: [
      // Router Agent
      {
        id: 'router',
        name: 'Intent Router',
        role: 'router',
        description: 'Analyzes user intent and recommends the best specialist agent',
        enabled: true,
        config: {
          model: '[CC]claude-haiku-4-5-20251001', // 使用轻量模型降低成本
          systemPrompt: 'You are an intent analysis router. Analyze user messages and recommend the best specialist agent.',
          tools: [],
          maxTokens: 2000,
          temperature: 0.3,
        },
      },
      // Default Specialist Agent
      {
        id: 'code-assistant',
        name: 'Code Assistant',
        role: 'specialist',
        description: 'General-purpose coding assistant for software development tasks',
        domains: ['coding', 'development', 'programming', 'debugging'],
        keywords: ['code', '代码', 'bug', 'implement', '实现', 'refactor', '重构'],
        priority: 5,
        enabled: true,
        config: {
          model: '[CC]claude-sonnet-4-5-20250929',
          systemPrompt: ['xuanji-assistant', 'code-assistant', 'tool-guidance', 'security-rules', 'agent-rules'],
          tools: [
            'read_file',
            'write_file',
            'edit_file',
            'multi_edit',
            'bash',
            'grep_search',
            'list_files',
            'web_search',
            'web_fetch',
            'plan_review',
            'memory_store',
            'memory_retrieve',
            'memory_delete',
          ],
          maxIterations: 25,
          temperature: 0.7,
          maxTokens: 4096,
        },
      },
    ],
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
};
