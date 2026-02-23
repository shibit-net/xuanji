// ============================================================
// i18n — 中英文消息定义
// ============================================================

export type Language = 'zh' | 'en';

export interface Messages {
  [key: string]: string;
}

/**
 * 中文消息
 */
const zh: Messages = {
  // ── CLI 通用 ──
  'cli.title': '✦ Shibit 璇玑',
  'cli.started': '璇玑 CLI 已启动',
  'cli.exit': '璇玑 CLI 退出',
  'cli.thinking': '思考中...',
  'cli.help_hint': '/help',
  'cli.startup_failed': '启动失败:',

  // ── 命令 ──
  'cmd.help': '/help',
  'cmd.help_desc': '显示帮助信息',
  'cmd.clear': '/clear',
  'cmd.clear_desc': '清空对话历史',
  'cmd.reset': '/reset',
  'cmd.reset_desc': '重置会话 (清空历史和 token 计数)',
  'cmd.cost': '/cost',
  'cmd.cost_desc': '显示当前会话费用',
  'cmd.exit': '/exit',
  'cmd.exit_desc': '退出璇玑',
  'cmd.settings': '/settings',
  'cmd.settings_desc': '进入设置面板',
  'cmd.logs': '/logs',
  'cmd.logs_desc': '查看运行日志',
  'cmd.bots': '/bots',
  'cmd.bots_desc': '管理 IM 机器人',
  'cmd.lang': '/lang',
  'cmd.lang_desc': '切换语言 / Switch language',

  // ── 帮助文本 ──
  'help.title': '可用命令:',
  'help.help': '  /help      — 显示帮助信息',
  'help.clear': '  /clear     — 清空对话历史',
  'help.reset': '  /reset     — 重置会话',
  'help.cost': '  /cost      — 显示 Token 用量',
  'help.settings': '  /settings  — 进入设置面板',
  'help.logs': '  /logs      — 查看运行日志',
  'help.bots': '  /bots      — 管理 IM 机器人',
  'help.lang': '  /lang      — 切换语言',
  'help.exit': '  /exit      — 退出璇玑',
  'help.shortcuts_title': '快捷键:',
  'help.shortcut_ctrlc': '  Ctrl+C     — 中断运行 / 退出模式',
  'help.shortcut_shift_enter': '  Shift+Enter — 换行（多行输入）',

  // ── 会话 ──
  'chat.session_reset': '会话已重置',
  'chat.token_label': 'Token',
  'chat.input_label': '输入',
  'chat.output_label': '输出',
  'chat.cache_hit': '缓存命中',
  'chat.unknown_command': '未知命令: {name}，输入 /help 查看帮助',

  // ── 设置模式 ──
  'settings.title': '⚙️  设置',
  'settings.hint': '↑↓选择  Enter进入  1/2/3快速跳转  Q=返回对话',
  'settings.enter': '进入设置模式',

  // ── 设置标签页 ──
  'settings.tab.llm': 'LLM 配置',
  'settings.tab.ui': '界面设置',
  'settings.tab.bots': 'IM 机器人',

  // ── UI 设置 ──
  'ui.theme_title': '🎨 主题设置',
  'ui.theme_dark': '深色',
  'ui.theme_dark_desc': '深色主题（默认）',
  'ui.theme_light': '浅色',
  'ui.theme_light_desc': '浅色主题',
  'ui.theme_auto': '自动',
  'ui.theme_auto_desc': '跟随系统设置',
  'ui.theme_changed': '主题已切换为 {theme}',
  'ui.other_settings': '其他设置',
  'ui.show_token_usage': '显示 Token 用量',
  'ui.show_cost': '显示费用',
  'ui.show_thinking': '显示思考过程',
  'ui.enabled': '启用',
  'ui.disabled': '禁用',
  'ui.hint': '↑↓选择  Enter确认  1=深色 2=浅色 3=自动  Q=返回',
  'ui.config_load_failed': '配置加载失败',
  'ui.loading_config': '加载配置中...',
  'ui.switch_failed': '切换失败',

  // ── 语言设置 ──
  'ui.language_title': '🌐 语言设置',
  'ui.lang_zh': '中文',
  'ui.lang_zh_desc': '使用中文界面',
  'ui.lang_en': 'English',
  'ui.lang_en_desc': '使用英文界面',
  'ui.language_changed': '语言已切换为 {lang}',
  'ui.language_hint': '选择语言 / Select language:',

  // ── LLM 设置 ──
  'llm.title': '🤖 LLM 配置',
  'llm.field_model': '模型',
  'llm.field_apikey': 'API Key',
  'llm.field_adapter': 'Adapter',
  'llm.field_baseurl': 'Base URL',
  'llm.not_set': '(未设置)',
  'llm.auto': '(自动)',
  'llm.not_loaded': '(未加载)',
  'llm.saved': '{field} 已保存',
  'llm.save_failed': '保存失败',
  'llm.edit_hint': '输入新值 → Enter 保存 | Esc 取消',
  'llm.hint': '↑↓选择  Enter编辑  1/2/3/4快速编辑  Q=返回',

  // ── 机器人管理 ──
  'bots.title': '🤖 IM 机器人管理',
  'bots.dingtalk': '钉钉机器人',
  'bots.feishu': '飞书机器人',
  'bots.wecom': '企业微信机器人',
  'bots.status_running': '● 运行中',
  'bots.status_error': '● 错误',
  'bots.status_stopped': '○ 已停止',
  'bots.stopped': '{name} 已停止',
  'bots.start_hint': '请通过 /bots start <type> 命令启动（需要先配置机器人密钥）',
  'bots.operation_failed': '操作失败',
  'bots.operating': '操作中...',
  'bots.hint': '↑↓ 选择机器人  Enter 启动/停止  Q 返回',
  'bots.enter': '进入机器人管理模式',

  // ── 机器人配置面板 ──
  'bots_config.title': '💬 IM 机器人配置',
  'bots_config.fields_title': '{icon} {name} — 配置字段',
  'bots_config.not_configured': '(未配置)',
  'bots_config.edit_hint': '💡 编辑 ~/.xuanji/config.json 中的 bots 字段进行配置',
  'bots_config.hint': '↑↓选择  1/2/3快速切换  Q=返回',

  // ── 日志 ──
  'logs.title': '📋 运行日志',
  'logs.count': '{count} 条',
  'logs.paused': '[暂停]',
  'logs.loading': '加载日志中...',
  'logs.empty': '暂无日志',
  'logs.more': '↓ 还有 {remaining} 条日志（显示最近 {max} 条）',
  'logs.hint': 'P=暂停/继续  C=清空  Q=返回',

  // ── 帮助文本 (index.ts) ──
  'index.help_title': '✦ 璇玑 (Xuanji) v{version} — AI 助手',
  'index.usage': '使用:',
  'index.options': '选项:',
  'index.option_help': '-h, --help           显示帮助信息',
  'index.option_version': '-v, --version        显示版本号',
  'index.option_model': '-m, --model <model>  指定模型',
  'index.option_prompt': '-p, --prompt <text>  直接提问 (非交互模式)',
  'index.bot_options': 'IM 机器人选项:',
  'index.bot_mode': 'bot                  启动 IM 机器人模式',
  'index.bot_dingtalk': '--dingtalk           启动钉钉机器人 (WebSocket Stream)',
  'index.bot_feishu': '--feishu             启动飞书机器人 (WebSocket)',
  'index.bot_wecom': '--wecom              启动企业微信机器人 (HTTP 回调)',
  'index.gui_title': '桌面 GUI:',
  'index.gui_desc': 'gui                  启动 Electron 桌面应用',
  'index.interactive_cmds': '交互模式命令:',
  'index.env_vars': '环境变量:',
  'index.docs': '文档: https://github.com/shibit/xuanji',
  'index.config_example': '配置文件 (~/.xuanji/config.json) 示例:',
  'index.background': '后台运行:',

  // ── Bot 模式 (index.ts) ──
  'bot.started': '璇玑 Bot 模式启动',
  'bot.no_bot_found': '未找到要启动的机器人。\n  方式 1: xuanji bot --dingtalk (命令行指定)\n  方式 2: 在 ~/.xuanji/config.json 中配置 bots.dingtalk.enabled = true',
  'bot.starting': '🤖 正在启动{name}机器人...',
  'bot.started_ok': '✅ {name}机器人已启动',
  'bot.start_failed': '❌ {name}机器人启动失败: {error}',
  'bot.running': '\n✦ 璇玑 Bot 模式运行中 ({count} 个机器人)',
  'bot.log_dir': '  日志文件: ~/.xuanji/logs/',
  'bot.stop_hint': '  Ctrl+C 或 SIGTERM 停止\n',
  'bot.signal_received': '收到 {signal}，开始优雅退出',
  'bot.stopping': '\n⏹️  收到 {signal}，正在停止机器人...',
  'bot.stopped_ok': '  ✓ {name}机器人已停止',
  'bot.stop_failed': '  ✗ {name}停止失败: {error}',
  'bot.exited': '璇玑 Bot 模式已退出',

  // ── IM Bot 适配器 ──
  'im.config_missing': '机器人配置缺失，请设置 {appKeyEnv} 和 {appSecretEnv}',
  'im.ws_connected': 'WebSocket 已连接',
  'im.ws_disconnected': 'WebSocket 已断开 (code: {code})',
  'im.ws_error': 'WebSocket 错误: {error}',
  'im.connection_failed': '连接失败: {error}',
  'im.message_received': '收到消息 ({sender}): {preview}',
  'im.message_parse_failed': '解析消息失败: {error}',
  'im.message_process_failed': '处理消息失败: {error}',
  'im.reconnecting': '{delay} 秒后重连...',
  'im.reconnect_failed': '重连失败: {error}',
  'im.reply_failed': '回复失败: {error}',
  'im.content_truncated': '...(内容过长已截断)',
  'im.callback_config_missing': '企业微信回调配置缺失，请设置 {tokenEnv} 和 {keyEnv}',

  // ── GUI 模式 ──
  'gui.starting': '✦ 正在启动璇玑桌面应用...',
  'gui.start_failed': '❌ GUI 启动失败:',
};

/**
 * 英文消息
 */
const en: Messages = {
  // ── CLI General ──
  'cli.title': '✦ Shibit Xuanji',
  'cli.started': 'Xuanji CLI started',
  'cli.exit': 'Xuanji CLI exited',
  'cli.thinking': 'Thinking...',
  'cli.help_hint': '/help',
  'cli.startup_failed': 'Startup failed:',

  // ── Commands ──
  'cmd.help': '/help',
  'cmd.help_desc': 'Show help information',
  'cmd.clear': '/clear',
  'cmd.clear_desc': 'Clear chat history',
  'cmd.reset': '/reset',
  'cmd.reset_desc': 'Reset session (clear history and token count)',
  'cmd.cost': '/cost',
  'cmd.cost_desc': 'Show current session cost',
  'cmd.exit': '/exit',
  'cmd.exit_desc': 'Exit Xuanji',
  'cmd.settings': '/settings',
  'cmd.settings_desc': 'Open settings panel',
  'cmd.logs': '/logs',
  'cmd.logs_desc': 'View logs',
  'cmd.bots': '/bots',
  'cmd.bots_desc': 'Manage IM bots',
  'cmd.lang': '/lang',
  'cmd.lang_desc': 'Switch language / 切换语言',

  // ── Help Text ──
  'help.title': 'Available commands:',
  'help.help': '  /help      — Show help information',
  'help.clear': '  /clear     — Clear chat history',
  'help.reset': '  /reset     — Reset session',
  'help.cost': '  /cost      — Show token usage',
  'help.settings': '  /settings  — Open settings panel',
  'help.logs': '  /logs      — View logs',
  'help.bots': '  /bots      — Manage IM bots',
  'help.lang': '  /lang      — Switch language',
  'help.exit': '  /exit      — Exit Xuanji',
  'help.shortcuts_title': 'Shortcuts:',
  'help.shortcut_ctrlc': '  Ctrl+C     — Interrupt / Exit mode',
  'help.shortcut_shift_enter': '  Shift+Enter — New line (multi-line input)',

  // ── Chat ──
  'chat.session_reset': 'Session reset',
  'chat.token_label': 'Token',
  'chat.input_label': 'Input',
  'chat.output_label': 'Output',
  'chat.cache_hit': 'Cache hit',
  'chat.unknown_command': 'Unknown command: {name}, type /help for help',

  // ── Settings Mode ──
  'settings.title': '⚙️  Settings',
  'settings.hint': '↑↓ Navigate  Enter Select  1/2/3 Quick jump  Q=Back',
  'settings.enter': 'Entering settings mode',

  // ── Settings Tabs ──
  'settings.tab.llm': 'LLM Config',
  'settings.tab.ui': 'UI Settings',
  'settings.tab.bots': 'IM Bots',

  // ── UI Settings ──
  'ui.theme_title': '🎨 Theme Settings',
  'ui.theme_dark': 'Dark',
  'ui.theme_dark_desc': 'Dark theme (default)',
  'ui.theme_light': 'Light',
  'ui.theme_light_desc': 'Light theme',
  'ui.theme_auto': 'Auto',
  'ui.theme_auto_desc': 'Follow system settings',
  'ui.theme_changed': 'Theme changed to {theme}',
  'ui.other_settings': 'Other Settings',
  'ui.show_token_usage': 'Show token usage',
  'ui.show_cost': 'Show cost',
  'ui.show_thinking': 'Show thinking process',
  'ui.enabled': 'Enabled',
  'ui.disabled': 'Disabled',
  'ui.hint': '↑↓ Navigate  Enter Confirm  1=Dark 2=Light 3=Auto  Q=Back',
  'ui.config_load_failed': 'Failed to load config',
  'ui.loading_config': 'Loading config...',
  'ui.switch_failed': 'Switch failed',

  // ── Language Settings ──
  'ui.language_title': '🌐 Language Settings',
  'ui.lang_zh': '中文',
  'ui.lang_zh_desc': 'Chinese interface',
  'ui.lang_en': 'English',
  'ui.lang_en_desc': 'English interface',
  'ui.language_changed': 'Language changed to {lang}',
  'ui.language_hint': 'Select language / 选择语言:',

  // ── LLM Settings ──
  'llm.title': '🤖 LLM Config',
  'llm.field_model': 'Model',
  'llm.field_apikey': 'API Key',
  'llm.field_adapter': 'Adapter',
  'llm.field_baseurl': 'Base URL',
  'llm.not_set': '(not set)',
  'llm.auto': '(auto)',
  'llm.not_loaded': '(not loaded)',
  'llm.saved': '{field} saved',
  'llm.save_failed': 'Save failed',
  'llm.edit_hint': 'Enter new value → Enter to save | Esc to cancel',
  'llm.hint': '↑↓ Navigate  Enter Edit  1/2/3/4 Quick edit  Q=Back',

  // ── Bots Management ──
  'bots.title': '🤖 IM Bot Management',
  'bots.dingtalk': 'DingTalk Bot',
  'bots.feishu': 'Feishu Bot',
  'bots.wecom': 'WeCom Bot',
  'bots.status_running': '● Running',
  'bots.status_error': '● Error',
  'bots.status_stopped': '○ Stopped',
  'bots.stopped': '{name} stopped',
  'bots.start_hint': 'Use /bots start <type> to start (configure bot credentials first)',
  'bots.operation_failed': 'Operation failed',
  'bots.operating': 'Processing...',
  'bots.hint': '↑↓ Select bot  Enter Start/Stop  Q Back',
  'bots.enter': 'Entering bot management mode',

  // ── Bots Config Panel ──
  'bots_config.title': '💬 IM Bot Configuration',
  'bots_config.fields_title': '{icon} {name} — Config Fields',
  'bots_config.not_configured': '(not configured)',
  'bots_config.edit_hint': '💡 Edit the bots section in ~/.xuanji/config.json',
  'bots_config.hint': '↑↓ Navigate  1/2/3 Quick switch  Q=Back',

  // ── Logs ──
  'logs.title': '📋 Logs',
  'logs.count': '{count} entries',
  'logs.paused': '[Paused]',
  'logs.loading': 'Loading logs...',
  'logs.empty': 'No logs',
  'logs.more': '↓ {remaining} more entries (showing latest {max})',
  'logs.hint': 'P=Pause/Resume  C=Clear  Q=Back',

  // ── Help Text (index.ts) ──
  'index.help_title': '✦ Xuanji v{version} — AI Assistant',
  'index.usage': 'Usage:',
  'index.options': 'Options:',
  'index.option_help': '-h, --help           Show help',
  'index.option_version': '-v, --version        Show version',
  'index.option_model': '-m, --model <model>  Specify model',
  'index.option_prompt': '-p, --prompt <text>  Direct prompt (non-interactive)',
  'index.bot_options': 'IM Bot options:',
  'index.bot_mode': 'bot                  Start IM bot mode',
  'index.bot_dingtalk': '--dingtalk           Start DingTalk bot (WebSocket Stream)',
  'index.bot_feishu': '--feishu             Start Feishu bot (WebSocket)',
  'index.bot_wecom': '--wecom              Start WeCom bot (HTTP callback)',
  'index.gui_title': 'Desktop GUI:',
  'index.gui_desc': 'gui                  Start Electron desktop app',
  'index.interactive_cmds': 'Interactive commands:',
  'index.env_vars': 'Environment variables:',
  'index.docs': 'Docs: https://github.com/shibit/xuanji',
  'index.config_example': 'Config file (~/.xuanji/config.json) example:',
  'index.background': 'Background:',

  // ── Bot Mode (index.ts) ──
  'bot.started': 'Xuanji Bot mode started',
  'bot.no_bot_found': 'No bot found to start.\n  Method 1: xuanji bot --dingtalk (CLI)\n  Method 2: Set bots.dingtalk.enabled = true in ~/.xuanji/config.json',
  'bot.starting': '🤖 Starting {name} bot...',
  'bot.started_ok': '✅ {name} bot started',
  'bot.start_failed': '❌ {name} bot failed to start: {error}',
  'bot.running': '\n✦ Xuanji Bot mode running ({count} bot(s))',
  'bot.log_dir': '  Log files: ~/.xuanji/logs/',
  'bot.stop_hint': '  Ctrl+C or SIGTERM to stop\n',
  'bot.signal_received': 'Received {signal}, graceful shutdown',
  'bot.stopping': '\n⏹️  Received {signal}, stopping bots...',
  'bot.stopped_ok': '  ✓ {name} bot stopped',
  'bot.stop_failed': '  ✗ {name} failed to stop: {error}',
  'bot.exited': 'Xuanji Bot mode exited',

  // ── IM Bot Adapters ──
  'im.config_missing': 'Bot configuration missing, please set {appKeyEnv} and {appSecretEnv}',
  'im.ws_connected': 'WebSocket connected',
  'im.ws_disconnected': 'WebSocket disconnected (code: {code})',
  'im.ws_error': 'WebSocket error: {error}',
  'im.connection_failed': 'Connection failed: {error}',
  'im.message_received': 'Message received ({sender}): {preview}',
  'im.message_parse_failed': 'Failed to parse message: {error}',
  'im.message_process_failed': 'Failed to process message: {error}',
  'im.reconnecting': 'Reconnecting in {delay}s...',
  'im.reconnect_failed': 'Reconnect failed: {error}',
  'im.reply_failed': 'Failed to reply: {error}',
  'im.content_truncated': '...(content truncated)',
  'im.callback_config_missing': 'WeCom callback configuration missing, please set {tokenEnv} and {keyEnv}',

  // ── GUI Mode ──
  'gui.starting': '✦ Starting Xuanji desktop app...',
  'gui.start_failed': '❌ GUI startup failed:',
};

/**
 * 所有语言消息
 */
export const allMessages: Record<Language, Messages> = { zh, en };
