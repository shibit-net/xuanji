#!/usr/bin/env node
// ============================================================
// 璇玑 (Xuanji) — 主入口
// ============================================================

import { render } from 'ink';
import React from 'react';
import { App } from './adapters/cli/App';
import { SessionFactory } from './core/chat/SessionFactory';
import type { ChatSession } from './core/chat/ChatSession';
import type { AppConfig } from './shared/types/config';
import { createRequire } from 'module';
import { logger } from './core/logger';

const log = logger.child({ module: 'Main' });

/**
 * 版本号（从 package.json 动态读取）
 */
const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json');

/**
 * 解析命令行参数
 */
function parseArgs(argv: string[]): {
  help: boolean;
  version: boolean;
  model?: string;
  prompt?: string;
  // IM 机器人
  bot: boolean;
  dingtalk: boolean;
  feishu: boolean;
  wecom: boolean;
  // GUI 模式
  gui: boolean;
  // 守护进程
  daemon: boolean;
  daemonAction?: 'start' | 'stop' | 'status';
} {
  const args = argv.slice(2);
  const result = {
    help: false,
    version: false,
    model: undefined as string | undefined,
    prompt: undefined as string | undefined,
    bot: false,
    dingtalk: false,
    feishu: false,
    wecom: false,
    gui: false,
    daemon: false,
    daemonAction: undefined as 'start' | 'stop' | 'status' | undefined,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-h':
      case '--help':
        result.help = true;
        break;
      case '-v':
      case '--version':
        result.version = true;
        break;
      case '-m':
      case '--model':
        result.model = args[++i];
        break;
      case '-p':
      case '--prompt':
        result.prompt = args.slice(i + 1).join(' ');
        i = args.length;
        break;
      case 'bot':
        result.bot = true;
        break;
      case 'gui':
        result.gui = true;
        break;
      case 'daemon':
        result.daemon = true;
        // 下一个参数是 start/stop/status
        if (args[i + 1] && !args[i + 1].startsWith('-')) {
          const action = args[++i];
          if (action === 'start' || action === 'stop' || action === 'status') {
            result.daemonAction = action;
          }
        }
        break;
      case '--dingtalk':
        result.dingtalk = true;
        break;
      case '--feishu':
        result.feishu = true;
        break;
      case '--wecom':
        result.wecom = true;
        break;
      default:
        // 非 flag 参数视为 prompt
        if (!args[i].startsWith('-')) {
          result.prompt = args.slice(i).join(' ');
          i = args.length;
        }
        break;
    }
  }

  return result;
}

/**
 * 打印帮助信息
 */
function printHelp(): void {
  log.info(`
  ✦ 璇玑 (Xuanji) v${VERSION} — AI 助手

  使用:
    xuanji [选项] [prompt]
    xuanji gui                   启动桌面 GUI
    xuanji bot --dingtalk        启动钉钉机器人
    xuanji bot --feishu          启动飞书机器人
    xuanji bot --wecom           启动企业微信机器人
    xuanji bot                   自动启动 config.json 中 enabled 的机器人
    xuanji daemon start          启动提醒守护进程
    xuanji daemon stop           停止提醒守护进程
    xuanji daemon status         查看守护进程状态

  选项:
    -h, --help           显示帮助信息
    -v, --version        显示版本号
    -m, --model <model>  指定模型
    -p, --prompt <text>  直接提问 (非交互模式)

  IM 机器人选项:
    bot                  启动 IM 机器人模式
    --dingtalk           启动钉钉机器人 (WebSocket Stream)
    --feishu             启动飞书机器人 (WebSocket)
    --wecom              启动企业微信机器人 (HTTP 回调)

  桌面 GUI:
    gui                  启动 Electron 桌面应用

  交互模式命令:
    /help       显示帮助
    /clear      清空对话
    /reset      重置会话
    /cost       查看费用
    /compact    压缩上下文
    /model      查看/切换模型
    /memory     查看记忆库
    /save       保存会话
    /resume     恢复会话
    /sessions   管理会话
    /checkpoint 创建检查点
    /rewind     回滚检查点
    /settings   配置管理
    /logs       查看日志
    /bots       机器人管理
    /lang       切换语言
    /init       初始化配置
    /doctor     系统诊断
    /exit       退出

  环境变量:
    XUANJI_API_KEY               API Key (必需)
    XUANJI_BASE_URL              API 地址
    XUANJI_MODEL                 默认模型
    XUANJI_MAX_TOKENS            最大输出 token
    DINGTALK_APP_KEY             钉钉机器人 App Key
    DINGTALK_APP_SECRET          钉钉机器人 App Secret
    FEISHU_APP_ID                飞书机器人 App ID
    FEISHU_APP_SECRET            飞书机器人 App Secret
    WECOM_CORPID                 企业微信 Corp ID
    WECOM_SECRET                 企业微信应用 Secret
    WECOM_AGENT_ID               企业微信 Agent ID
    WECOM_TOKEN                  企业微信回调 Token
    WECOM_ENCODING_AES_KEY       企业微信回调 EncodingAESKey
    WECOM_PORT                   企业微信回调端口 (默认 80，仅支持 80/443)

  文档: https://github.com/shibit/xuanji

  配置文件 (.xuanji/config.json) 示例:
    {
      "bots": {
        "dingtalk": { "enabled": true, "appKey": "...", "appSecret": "..." },
        "feishu":   { "enabled": true, "appId": "...", "appSecret": "..." }
      }
    }

  后台运行:
    pm2 start xuanji -- bot --dingtalk
    pm2 start xuanji -- bot              # 自动发现 config.json 中 enabled 的机器人
`);
}

/**
 * 启动 IM 机器人模式（支持后台运行）
 *
 * 配置优先级: 命令行参数 > config.json bots 字段 > 环境变量
 * 日志输出:   console + .xuanji/logs/YYYY-MM-DD.log (JSONL)
 * 后台运行:   pm2 start xuanji -- bot --dingtalk
 *             或 systemd 服务
 */
async function startBot(args: ReturnType<typeof parseArgs>): Promise<void> {
  // 1. 初始化 ConfigManager + LogSystem
  const { ConfigManager } = await import('./adapters/cli/utils/ConfigManager');
  const { LogSystem } = await import('./adapters/cli/utils/LogSystem');

  const configManager = new ConfigManager();
  const logSystem = new LogSystem();

  let config;
  try {
    config = await configManager.load();
  } catch {
    config = null;
  }

  await logSystem.info('System', '璇玑 Bot 模式启动');

  // 2. 初始化 ChatSession（Bot 模式使用固定用户 ID）
  const factory = new SessionFactory('bot-user');
  // 默认使用用户主 agent 配置
  const session = await factory.create({ model: args.model });

  // 3. 收集要启动的机器人（命令行参数优先，否则从 config.json 自动发现）
  const botsConfig = config?.bots;
  const adapters: Array<{ name: string; adapter: import('./adapters/im/IMAdapter').IMAdapter }> = [];

  const shouldStartDingtalk = args.dingtalk || (!args.dingtalk && !args.feishu && !args.wecom && botsConfig?.dingtalk?.enabled);
  const shouldStartFeishu = args.feishu || (!args.dingtalk && !args.feishu && !args.wecom && botsConfig?.feishu?.enabled);
  const shouldStartWecom = args.wecom || (!args.dingtalk && !args.feishu && !args.wecom && botsConfig?.wecom?.enabled);

  if (shouldStartDingtalk) {
    const { DingtalkBot } = await import('./adapters/im/DingtalkBot');
    const bot = new DingtalkBot(botsConfig?.dingtalk);
    bot.setLogger((msg) => logSystem.info('Bot', `[钉钉] ${msg}`));
    adapters.push({ name: '钉钉', adapter: bot });
  }

  if (shouldStartFeishu) {
    const { FeishuBot } = await import('./adapters/im/FeishuBot');
    const bot = new FeishuBot(botsConfig?.feishu);
    bot.setLogger?.((msg) => logSystem.info('Bot', `[飞书] ${msg}`));
    adapters.push({ name: '飞书', adapter: bot });
  }

  if (shouldStartWecom) {
    const { WecomBot } = await import('./adapters/im/WecomBot');
    const bot = new WecomBot(botsConfig?.wecom);
    bot.setLogger?.((msg) => logSystem.info('Bot', `[企微] ${msg}`));
    adapters.push({ name: '企业微信', adapter: bot });
  }

  if (adapters.length === 0) {
    const msg = '未找到要启动的机器人。\n'
      + '  方式 1: xuanji bot --dingtalk (命令行指定)\n'
      + '  方式 2: 在 .xuanji/config.json 中配置 bots.dingtalk.enabled = true';
    log.error(msg);
    await logSystem.error('System', msg);
    process.exit(1);
  }

  // 4. 启动机器人
  for (const { name, adapter } of adapters) {
    try {
      log.info(`正在启动${name}机器人...`);
      await logSystem.info('Bot', `正在启动${name}机器人`);
      await adapter.start(session);
      log.info(`${name}机器人已启动`);
      await logSystem.info('Bot', `${name}机器人已启动`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error(`${name}机器人启动失败: ${errMsg}`);
      await logSystem.error('Bot', `${name}机器人启动失败: ${errMsg}`);
    }
  }

  log.info(`璇玑 Bot 模式运行中 (${adapters.length} 个机器人)`);
  log.info(`日志文件: .xuanji/logs/`);
  log.info(`Ctrl+C 或 SIGTERM 停止`);

  // 5. 优雅退出
  const shutdown = async (signal: string) => {
    log.info(`收到 ${signal}，正在停止机器人...`);
    await logSystem.info('System', `收到 ${signal}，开始优雅退出`);

    for (const { name, adapter } of adapters) {
      try {
        await adapter.stop();
        log.info(`${name}机器人已停止`);
        await logSystem.info('Bot', `${name}机器人已停止`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error(`${name}停止失败: ${errMsg}`);
        await logSystem.error('Bot', `${name}停止失败: ${errMsg}`);
      }
    }

    await logSystem.info('System', '璇玑 Bot 模式已退出');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * 启动 Electron GUI 模式
 */
async function startGui(): Promise<void> {
  const { spawn } = await import('child_process');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');

  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const desktopDir = resolve(sourceDir, '..', 'desktop');

  log.info('正在启动璇玑桌面应用...');
  log.info(`位置: ${desktopDir}`);

  // 执行 npm run electron:dev
  const child = spawn('npm', ['run', 'electron:dev'], {
    cwd: desktopDir,
    stdio: 'inherit',
    shell: true,
  });

  child.on('error', (err) => {
    log.error('GUI 启动失败:', err.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // 版本号
  if (args.version) {
    log.info(`xuanji v${VERSION}`);
    process.exit(0);
  }

  // 帮助
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // IM 机器人模式
  if (args.bot) {
    await startBot(args);
    return;
  }

  // GUI 模式: 启动 Electron
  if (args.gui) {
    await startGui();
    return;
  }

  // CLI 模式: 初始化 ChatSession（CLI 模式使用固定用户 ID）
  const factory = new SessionFactory('cli-user');
  // 默认使用用户主 agent 配置
  const session = await factory.create({ model: args.model });

  // 注册退出清理（MCP 子进程、PersistentShell、SQLite 等）
  let cleanedUp = false;
  const cleanupOnExit = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    // TODO: 实现 cleanup 逻辑
  };
  process.on('SIGINT', () => { cleanupOnExit().finally(() => process.exit(0)); });
  process.on('SIGTERM', () => { cleanupOnExit().finally(() => process.exit(0)); });
  process.on('beforeExit', async () => { await cleanupOnExit(); });

  const agentLoop = session.getAgentLoop();
  const config = session.getContainer().resolveSync('config') as AppConfig;

  // 交互模式：在启动 UI 前初始化国际化
  if (!args.prompt) {
    const { ConfigManager } = await import('./adapters/cli/utils/ConfigManager');
    const { setLanguage } = await import('./core/i18n');

    try {
      const configManager = new ConfigManager();
      const appConfig = await configManager.load();

      // 从用户配置中读取语言设置（默认英文）
      const language = appConfig.ui?.language || 'en';
      setLanguage(language);
    } catch (err) {
      // 配置加载失败，使用默认语言（英文）
      // 静默失败，不影响主流程
      setLanguage('en');
    }
  }

  // 非交互模式: 直接执行 prompt
  if (args.prompt) {
    agentLoop.on({
      onText: (text: string) => process.stdout.write(text),
      onToolStart: (id: string, name: string) => {
        process.stderr.write(`\n🔧 ${name}...\n`);
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        process.stderr.write(`   ${isError ? '✗' : '✓'} ${name}\n`);
      },
      onError: (err: Error) => log.error(err.message),
      onEnd: () => {
        process.exit(0);
      },
    });
    await agentLoop.run(args.prompt);
    return;
  }

  // 交互模式: 启动 Ink 应用（带启动 logo 动画）
  const { StartupLogo } = await import('./adapters/cli/StartupLogo');

  // 会话通知状态（在 App 组件外部定义，用于跨组件共享）
  let resumeNotificationText: string | null = null;
  let archiveNotificationText: string | null = null;

  // 创建一个包装组件来处理 logo 和主界面的切换
  const AppWithLogo = () => {
    const [showLogo, setShowLogo] = React.useState(true);

    if (showLogo) {
      return React.createElement(StartupLogo, {
        onComplete: () => setShowLogo(false),
        duration: 3000,
      });
    }

    return React.createElement(App, {
      agentLoop,
      model: config.provider.model,
      session,
      // TODO: 实现这些回调
      onPermissionSetup: (handler: any) => {
        // session.setConfirmationHandler(handler)
      },
      onPlanReviewSetup: (handler: any) => {
        // session.setPlanReviewHandler(handler)
      },
      onPlanConfirmSetup: (handler: any) => {
        // session.setPlanConfirmHandler(handler)
      },
      onAskUserSetup: (handler: any) => {
        // session.setAskUserHandler(handler)
      },
      onModelChange: async (newModel: string) => {
        // TODO: 实现模型切换
        return newModel;
      },
      onMemoryQuery: async (query?: string) => {
        return '❌ 记忆系统已移除';
      },
      onAgentQuery: async (_args: string) => {
        return '❌ /agent 命令已移除\n提示: Agent 管理已迁移到配置文件 (.xuanji/agents/*.json5)\n详见: doc/tad/xuanji/05-architecture-refactoring-proposal.md';
      },
      onTemplateQuery: async (args: string) => {
        // TODO: 实现模板查询
        return '❌ 模板系统未启用';
      },
      // ─── 会话持久化回调 ─────────────────────────────
      onSessionSave: async (name?: string, historyMessages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string; timestamp: number }>) => {
        // TODO: 实现会话保存
        return 'session-id';
      },
      onSessionResume: async (sessionId: string) => {
        // TODO: 实现会话恢复
        return {
          sessionId,
          messageCount: 0,
          usage: { input: 0, output: 0, cost: 0 },
          historyMessages: [],
        };
      },
      onSessionList: async () => {
        // TODO: 实现会话列表
        return [];
      },
      onSessionDelete: async (sessionId: string) => {
        // TODO: 实现会话删除
      },
      onCheckpointCreate: async (label?: string) => {
        // TODO: 实现检查点创建
        return 'checkpoint-id';
      },
      onCheckpointRewind: async (checkpointId: string) => {
        // TODO: 实现检查点回滚
        return 0;
      },
      onCheckpointList: async () => {
        // TODO: 实现检查点列表
        return [];
      },
      onDoctorQuery: async () => {
        // TODO: 实现系统诊断
        return '系统诊断功能开发中';
      },
      // ─── SubAgent 进度事件绑定 ──────────────────────────
      onSubAgentSetup: (callbacks: any) => {
        // TODO: 实现 SubAgent 事件绑定
      },
      // ─── 连续会话通知 ──────────────────────────────────
      onResumeNotification: (summary: string, memoryCount: number) => {
        resumeNotificationText = `📂 已恢复上次对话：${summary}（检索到 ${memoryCount} 条记忆）`;
      },
      onArchiveNotification: (result) => {
        archiveNotificationText = `📦 已归档 ${result.archivedCount} 条消息，提取 ${result.memoriesExtracted} 条记忆`;
        // 3 秒后自动清除通知
        setTimeout(() => { archiveNotificationText = null; }, 3000);
      },
    });
  };

  // 渲染 App，配置选项以减少终端滚动问题
  const { waitUntilExit } = render(React.createElement(AppWithLogo), {
    patchConsole: false,  // 禁用 console 拦截，减少输出干扰和滚动
    exitOnCtrlC: false,   // 自定义退出处理（已在 App 中通过 useInput 实现）
  });

  // 等待应用退出
  await waitUntilExit;
}

// 导出核心模块，方便其他模块使用
export { SessionFactory } from './core/chat/SessionFactory';
export { ChatSession } from './core/chat/ChatSession';

// 导出类型
export type { SessionOptions } from './core/chat/SessionFactory';

// 启动
main().catch((err) => {
  log.error('启动失败:', err);
  process.exit(1);
});
