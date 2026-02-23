// ============================================================
// Electron 主进程 — 桌面 GUI 入口
// ============================================================
//
// 职责:
// 1. 创建 BrowserWindow
// 2. 实例化 ChatSession（进程内直接调用）
// 3. IPC 处理程序：会话管理 + IM 机器人启停
// 4. 日志记录
//

import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ChatSession } from '../../core/chat/ChatSession';
import { ConfigLoader } from '../../core/config/ConfigLoader';
import type { IMAdapter } from '../im/IMAdapter';
import { MessageFormatter } from '../im/MessageFormatter';

// ── 全局状态 ──────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let session: ChatSession | null = null;
let activeBots: Map<string, IMAdapter> = new Map();

// ── 日志管理系统 ────────────────────────────────────────────

/** 日志目录 */
function getLogDir(): string {
  return path.join(os.homedir(), '.xuanji', 'logs');
}

/** 当天日志文件路径 */
function getLogFilePath(date?: Date): string {
  const d = date || new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return path.join(getLogDir(), `${dateStr}.log`);
}

/** 确保日志目录存在 */
function ensureLogDir(): void {
  const dir = getLogDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 将日志条目追加写入文件（每行一个 JSON 对象，JSONL 格式）
 */
function appendLogToFile(entry: { timestamp: string; source: string; message: string; level: string }): void {
  try {
    ensureLogDir();
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(getLogFilePath(), line, 'utf-8');
  } catch {
    // 文件写入失败不应影响主流程，静默忽略
  }
}

/**
 * 加载最近的日志条目
 * @param maxLines 最多返回的条目数（默认 500）
 * @param days 加载最近几天的日志（默认 3）
 */
function loadRecentLogs(maxLines = 500, days = 3): Array<{ timestamp: string; source: string; message: string; level: string }> {
  const results: Array<{ timestamp: string; source: string; message: string; level: string }> = [];

  try {
    const logDir = getLogDir();
    if (!fs.existsSync(logDir)) return results;

    // 收集最近 N 天的日志文件（从今天往前）
    const files: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const filePath = getLogFilePath(d);
      if (fs.existsSync(filePath)) {
        files.push(filePath);
      }
    }

    // 从最近的文件开始读（今天 → 昨天 → ...）
    for (const filePath of files) {
      if (results.length >= maxLines) break;

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      // 从文件末尾开始读（最新的日志在最后）
      for (let i = lines.length - 1; i >= 0; i--) {
        if (results.length >= maxLines) break;
        try {
          const entry = JSON.parse(lines[i]);
          results.push(entry);
        } catch {
          // 跳过格式错误的行
        }
      }
    }
  } catch {
    // 读取失败返回空数组
  }

  return results;
}

/**
 * 统一日志系统：同时输出到 console、IPC 和文件
 */
function log(source: string, message: string, level: 'info' | 'error' = 'info') {
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const prefix = `[${timestamp}] [${source}]`;
  const logMessage = `${prefix} ${message}`;

  // 1. 输出到终端
  if (level === 'error') {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }

  // 2. 通过 IPC 发送到 GUI（如果窗口已打开）
  const entry = { timestamp, source, message, level };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('main:log', entry);
  }

  // 3. 追加写入日志文件
  appendLogToFile(entry);
}

/**
 * API Key 脱敏：显示前 8 位和后 4 位
 */
function maskApiKey(key?: string): string {
  if (!key) return '(未配置)';
  if (key.length <= 12) return key.slice(0, 4) + '****';
  return key.slice(0, 8) + '...' + key.slice(-4);
}

// 替换原有的 console.log 调用
// 示例：log('Electron', '会话初始化成功');

// ── 配置文件路径 ─────────────────────────────────────────

function getConfigPath(): string {
  return path.join(os.homedir(), '.xuanji', 'config.json');
}

/**
 * 读取全局配置文件
 */
function readConfig(): Record<string, unknown> {
  try {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
      return {};
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);

    // 自动迁移旧版扁平结构 → 嵌套结构
    if (config.apiKey || config.model || config.maxTokens || config.baseURL) {
      const provider = (config.provider || {}) as Record<string, unknown>;
      if (config.apiKey && !provider.apiKey) provider.apiKey = config.apiKey;
      if (config.model && !provider.model) provider.model = config.model;
      if (config.maxTokens && !provider.maxTokens) provider.maxTokens = config.maxTokens;
      if (config.baseURL && !provider.baseURL) provider.baseURL = config.baseURL;
      config.provider = provider;

      // 迁移 theme
      if (config.theme) {
        const ui = (config.ui || {}) as Record<string, unknown>;
        if (!ui.theme) ui.theme = config.theme;
        config.ui = ui;
      }

      // 删除旧字段
      delete config.apiKey;
      delete config.model;
      delete config.maxTokens;
      delete config.baseURL;
      delete config.theme;

      // 写回迁移后的配置
      writeConfig(config);
      log('Config', '已自动迁移旧版配置到嵌套结构');
    }

    return config;
  } catch (err) {
    log('Config', `读取配置失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return {};
  }
}

/**
 * 写入全局配置文件
 */
function writeConfig(config: Record<string, unknown>): void {
  try {
    const configPath = getConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    log('Config', `写入配置失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

/**
 * 深合并配置对象（嵌套对象递归合并，非对象值直接覆盖）
 */
function deepMergeConfig(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      result[key] = deepMergeConfig(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

/**
 * 更新机器人运行状态到配置文件
 */
function saveBotStatus(botType: string, running: boolean): void {
  try {
    const config = readConfig();
    const botStatus = (config.botStatus || {}) as Record<string, boolean>;
    botStatus[botType] = running;
    config.botStatus = botStatus;
    writeConfig(config);
  } catch (err) {
    log('Config', `保存机器人状态失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

/**
 * 恢复上次运行中的机器人
 */
async function restoreBots(): Promise<void> {
  if (!session) return;

  try {
    const config = readConfig();
    const botStatus = (config.botStatus || {}) as Record<string, boolean>;

    for (const [botType, running] of Object.entries(botStatus)) {
      if (!running || activeBots.has(botType)) continue;

      // 从同一份配置中读取该机器人的连接参数
      const botConfig = (config[botType] || {}) as Record<string, string>;

      try {
        let bot: IMAdapter;

        switch (botType) {
          case 'dingtalk': {
            if (!botConfig.appKey || !botConfig.appSecret) continue;
            const { DingtalkBot } = await import('../im/DingtalkBot');
            bot = new DingtalkBot(botConfig);
            break;
          }
          case 'feishu': {
            if (!botConfig.appId || !botConfig.appSecret) continue;
            const { FeishuBot } = await import('../im/FeishuBot');
            bot = new FeishuBot(botConfig);
            break;
          }
          case 'wecom': {
            if (!botConfig.corpId || !botConfig.secret) continue;
            const { WecomBot } = await import('../im/WecomBot');
            bot = new WecomBot(botConfig);
            break;
          }
          default:
            continue;
        }

        // 先设置日志回调，再启动
        if (bot.setLogger) {
          bot.setLogger((message: string) => {
            mainWindow?.webContents.send('bot:log', { type: botType, message });
            appendLogToFile({
              timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
              source: botType,
              message,
              level: 'info',
            });
          });
        }

        await bot.start(session);
        activeBots.set(botType, bot);

        mainWindow?.webContents.send('bot:status', { type: botType, running: true });
        log('Bot', `自动恢复 ${botType} 机器人`);
      } catch (err) {
        log('Bot', `恢复 ${botType} 机器人失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
        saveBotStatus(botType, false);
      }
    }
  } catch (err) {
    log('Bot', `恢复机器人状态失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

// ── 窗口创建 ─────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: '璇玑 Xuanji',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 加载渲染进程 HTML
  // 优先从 dist/electron/ui/ 加载（构建后），回退到源码目录（开发时）
  const distUiPath = path.join(__dirname, 'ui', 'index.html');
  const srcUiPath = path.join(__dirname, '..', '..', 'src', 'adapters', 'electron', 'ui', 'index.html');

  mainWindow.loadFile(distUiPath).catch(() => {
    log('Window', '构建版 UI 未找到，尝试加载源码版...', 'info');
    mainWindow?.loadFile(srcUiPath).catch((err) => {
      log('Window', `加载 UI 失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 开发模式下自动打开 DevTools
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--devtools')) {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }
}

// ── IPC 处理程序 ─────────────────────────────────────────

/**
 * config:load — 读取全局配置文件（包含环境变量，脱敏 API Key）
 *
 * 注意：返回的配置会合并环境变量（XUANJI_* 前缀），以反映系统实际使用的配置
 */
ipcMain.handle('config:load', async () => {
  try {
    // 使用 ConfigLoader 加载配置，它会自动合并环境变量
    const configLoader = new ConfigLoader();
    const config = await configLoader.load();

    // 深拷贝避免修改原始对象
    const sanitized = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;

    // 脱敏 API Key
    if (sanitized.provider && typeof sanitized.provider === 'object') {
      const provider = sanitized.provider as Record<string, unknown>;
      if (provider.apiKey && typeof provider.apiKey === 'string') {
        provider.apiKey = maskApiKey(provider.apiKey);
      }
    }

    return { success: true, data: sanitized };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
});

/**
 * config:save — 保存配置到全局配置文件（深合并，保留 botStatus 等内部字段）
 */
ipcMain.handle('config:save', async (_event: IpcMainInvokeEvent, config: Record<string, unknown>) => {
  try {
    const existing = readConfig();

    // 保护 API Key: config:load 返回的是掩码值，如果用户未修改则不覆盖原始值
    if (config.provider && typeof config.provider === 'object') {
      const provider = config.provider as Record<string, unknown>;
      const incomingKey = provider.apiKey;
      if (typeof incomingKey === 'string' && (incomingKey.includes('...') || incomingKey.includes('****') || incomingKey === '')) {
        // 掩码值或空值，不覆盖原始 apiKey
        delete provider.apiKey;
      }
    }

    const merged = deepMergeConfig(existing, config);
    writeConfig(merged);

    // 清除旧的 session 实例，强制下次 chat:init 重新加载配置
    session = null;

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
});

/**
 * chat:init — 初始化 ChatSession
 */
ipcMain.handle('chat:init', async (_event: IpcMainInvokeEvent, options?: { model?: string }) => {
  try {
    session = new ChatSession({ model: options?.model });
    await session.init();
    const config = session.getConfig();

    // 后台恢复上次运行的机器人（不阻塞 init 返回）
    restoreBots().catch(err => log('Bot', `恢复机器人失败: ${err instanceof Error ? err.message : String(err)}`, 'error'));

    return {
      success: true,
      config: {
        model: config.provider.model,
        adapter: config.provider.adapter || '',
        theme: config.ui.theme,
        apiKey: maskApiKey(config.provider.apiKey),
        baseURL: config.provider.baseURL || '',
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 即使 init 失败，也尝试返回已加载的配置（如默认模型）
    let config: Record<string, string> | undefined;
    try {
      if (session) {
        const cfg = session.getConfig();
        config = {
          model: cfg.provider.model,
          adapter: cfg.provider.adapter || '',
          theme: cfg.ui.theme,
          apiKey: '',
          baseURL: cfg.provider.baseURL || '',
        };
      } else {
        // session 为 null 时，从文件重新读取配置并返回
        const configLoader = new ConfigLoader();
        const cfg = await configLoader.load();
        config = {
          model: cfg.provider.model,
          adapter: cfg.provider.adapter || '',
          theme: cfg.ui.theme,
          apiKey: maskApiKey(cfg.provider.apiKey),
          baseURL: cfg.provider.baseURL || '',
        };
      }
    } catch { /* config 尚未加载，忽略 */ }
    return { success: false, error: msg, config };
  }
});

/**
 * chat:run — 运行一轮对话（流式事件通过 mainWindow.webContents.send 推送）
 */
ipcMain.handle('chat:run', async (_event: IpcMainInvokeEvent, message: string) => {
  if (!session) {
    return { success: false, error: '会话未初始化，请先调用 chat:init' };
  }

  console.log('[chat:run] 开始对话:', message);

  try {
    // 注册回调，将事件推送到渲染进程
    session.on({
      onText: (text: string) => {
        mainWindow?.webContents.send('chat:text', text);
      },
      onThinking: (thinking: string) => {
        mainWindow?.webContents.send('chat:thinking', thinking);
      },
      onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
        mainWindow?.webContents.send('chat:tool-start', { id, name, input });
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        mainWindow?.webContents.send('chat:tool-end', { id, name, result, isError });
      },
      onUsage: (usage) => {
        mainWindow?.webContents.send('chat:usage', usage);
      },
      onError: (err: Error) => {
        console.error('[chat:run] 错误回调:', err.message);
        log('Chat', `错误回调: ${err.message}`, 'error');

        // 确保发送 chat:error 事件
        if (mainWindow && !mainWindow.isDestroyed()) {
          console.log('[chat:run] 发送 chat:error 事件');
          mainWindow.webContents.send('chat:error', err.message);
        } else {
          console.error('[chat:run] mainWindow 不可用，无法发送 chat:error');
        }
      },
      onEnd: (state) => {
        console.log('[chat:run] 对话结束，迭代:', state.currentIteration);
        log('Chat', `对话结束，迭代: ${state.currentIteration}`);

        // 确保发送 chat:end 事件
        if (mainWindow && !mainWindow.isDestroyed()) {
          console.log('[chat:run] 发送 chat:end 事件');
          mainWindow.webContents.send('chat:end', {
            tokenUsage: state.tokenUsage,
            cost: state.cost,
            currentIteration: state.currentIteration,
          });
        } else {
          console.error('[chat:run] mainWindow 不可用，无法发送 chat:end');
        }
      },
    });

    console.log('[chat:run] 等待 session.run()...');
    await session.run(message);
    console.log('[chat:run] 对话成功完成');
    log('Chat', '对话成功完成');
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[chat:run] 异常捕获:', msg);
    log('Chat', `对话异常: ${msg}`, 'error');

    // 注意：AgentLoop 的 finally 块已经发送过 chat:end 事件了
    // 所以这里只需要确保错误被返回给调用方

    return { success: false, error: msg };
  }
});

/**
 * chat:stop — 停止当前运行
 */
ipcMain.handle('chat:stop', async () => {
  session?.stop();
  return { success: true };
});

/**
 * chat:reset — 重置会话
 */
ipcMain.handle('chat:reset', async () => {
  session?.reset();
  return { success: true };
});

/**
 * chat:state — 获取当前状态
 */
ipcMain.handle('chat:state', async () => {
  if (!session) {
    return { success: false, error: '会话未初始化' };
  }
  const state = session.getState();
  return {
    success: true,
    state: {
      status: state.status,
      tokenUsage: state.tokenUsage,
      cost: state.cost,
      currentIteration: state.currentIteration,
    },
  };
});

/**
 * bot:start — 启动 IM 机器人
 */
ipcMain.handle('bot:start', async (_event: IpcMainInvokeEvent, botType: string, config?: Record<string, string>) => {
  if (!session) {
    return { success: false, error: '会话未初始化，请先调用 chat:init' };
  }

  if (activeBots.has(botType)) {
    return { success: false, error: `${botType} 机器人已在运行` };
  }

  try {
    let bot: IMAdapter;

    switch (botType) {
      case 'dingtalk': {
        const { DingtalkBot } = await import('../im/DingtalkBot');
        bot = new DingtalkBot(config);
        break;
      }
      case 'feishu': {
        const { FeishuBot } = await import('../im/FeishuBot');
        bot = new FeishuBot(config);
        break;
      }
      case 'wecom': {
        const { WecomBot } = await import('../im/WecomBot');
        bot = new WecomBot(config);
        break;
      }
      default:
        return { success: false, error: `不支持的机器人类型: ${botType}` };
    }

    // 先设置日志回调，再启动（确保启动日志不丢失）
    if (bot.setLogger) {
      bot.setLogger((message: string) => {
        mainWindow?.webContents.send('bot:log', { type: botType, message });
        appendLogToFile({
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          source: botType,
          message,
          level: 'info',
        });
      });
    }

    await bot.start(session);
    activeBots.set(botType, bot);

    saveBotStatus(botType, true);
    mainWindow?.webContents.send('bot:status', { type: botType, running: true });
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
});

/**
 * bot:stop — 停止 IM 机器人
 */
ipcMain.handle('bot:stop', async (_event: IpcMainInvokeEvent, botType: string) => {
  const bot = activeBots.get(botType);
  if (!bot) {
    return { success: false, error: `${botType} 机器人未在运行` };
  }

  try {
    await bot.stop();
    activeBots.delete(botType);
    saveBotStatus(botType, false);
    mainWindow?.webContents.send('bot:status', { type: botType, running: false });
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
});

/**
 * bot:list — 列出所有运行中的机器人
 */
ipcMain.handle('bot:list', async () => {
  const bots = Array.from(activeBots.entries()).map(([type, bot]) => ({
    type,
    name: bot.name,
    running: true,
  }));
  return { success: true, bots };
});

/**
 * log:load — 加载历史日志（持久化）
 */
ipcMain.handle('log:load', async (_event: IpcMainInvokeEvent, options?: { maxLines?: number; days?: number }) => {
  try {
    const logs = loadRecentLogs(options?.maxLines, options?.days);
    return { success: true, logs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg, logs: [] };
  }
});

/**
 * models:list — 从模型广场获取模型列表（分页 + 搜索）
 */
ipcMain.handle('models:list', async (_event: IpcMainInvokeEvent, options?: { page?: number; size?: number; name?: string }) => {
  try {
    const page = options?.page || 1;
    const size = options?.size || 30;
    const name = options?.name || '';

    // 模型列表始终从官方市场获取，不使用自定义 baseURL
    const baseURL = 'https://shibit.net';

    const url = new URL('/api/llm/agent/marketplace', baseURL);
    url.searchParams.set('page', String(page));
    url.searchParams.set('size', String(size));
    if (name) url.searchParams.set('name', name);

    log('Models', `获取模型列表: page=${page}, size=${size}, name=${name}`);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json() as {
      success: boolean;
      data?: {
        pageNum: number;
        pageSize: number;
        total: number;
        pages: number;
        list: Array<Record<string, unknown>>;
      };
      message?: string;
    };

    if (!result.success || !result.data) {
      throw new Error(result.message || '获取模型列表失败');
    }

    return {
      success: true,
      data: {
        pageNum: result.data.pageNum,
        pageSize: result.data.pageSize,
        total: result.data.total,
        pages: result.data.pages,
        list: result.data.list.map((m) => ({
          name: m.name,                         // 显示名（含线路前缀 [CC]）
          vendor: m.vendor,
          adapter: m.adapter,
          tags: m.tags,
          desc: m.desc,
          unitPriceReminder: m.unitPriceReminder,   // 输入单价（元/百万Token）
          unitPriceComplete: m.unitPriceComplete,   // 输出单价（元/百万Token）
          billingMethod: m.billingMethod,            // 计费方式
          perCallPrice: m.perCallPrice,              // 按次计费价格
        })),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('Models', `获取模型列表失败: ${msg}`, 'error');
    return { success: false, error: msg };
  }
});

// ── 应用生命周期 ─────────────────────────────────────────

console.log('[Main] 璇玑 Electron 主进程启动');

app.whenReady().then(() => {
  console.log('[Main] app.whenReady() 触发，创建窗口...');
  createWindow();

  // macOS: 点击 dock 图标重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // 停止所有机器人
  for (const [type, bot] of activeBots) {
    bot.stop().catch(console.error);
  }
  activeBots.clear();

  // macOS 下不退出应用
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // 清理资源
  for (const [type, bot] of activeBots) {
    bot.stop().catch(console.error);
  }
  activeBots.clear();
});

// ── 导出（用于测试） ────────────────────────────────────

export { createWindow, session, activeBots };
