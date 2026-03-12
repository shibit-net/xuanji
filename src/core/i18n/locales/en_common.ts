// ============================================================
// i18n — 英文通用词汇
// ============================================================

export const en_common = {
  // ── CLI Common ──
  'cli.title': '✦ Shibit Xuanji',
  'cli.started': 'Xuanji CLI started',
  'cli.exit': 'Xuanji CLI exited',
  'cli.thinking': '🤔 Let me think...',
  'cli.help_hint': 'Press ? for shortcuts · /help for commands',
  'cli.startup_failed': 'Startup failed:',
  'cli.tool_executing': '🔧 Using {name}...',
  'cli.processing_stream': '✍️  Writing...',
  'cli.stream_buffered': '✍️  Receiving... {lines} lines',
  'cli.config_not_init': 'ConfigManager not initialized, call load() first',
  'cli.config_not_init_short': 'ConfigManager not initialized',
  'cli.tool_nav_mode': '🔍 Tool Navigation Mode',
  'cli.tool_nav_hint': '↑↓ Navigate  Enter Toggle  Tab/Esc Exit',
  'cli.tool_nav_enter': '💡 Press Tab to enter Tool Navigation mode for details',
  'cli.parallel_tools': '⚡ {count} tools running in parallel',

  // ── Command Metadata ──
  'cmd.help': '/help',
  'cmd.help_desc': 'Show help information',
  'cmd.clear': '/clear',
  'cmd.clear_desc': 'Clear conversation history',
  'cmd.reset': '/reset',
  'cmd.reset_desc': 'Reset session (clear history and token count)',
  'cmd.cost': '/cost',
  'cmd.cost_desc': 'Show token usage statistics (last 7 days)',
  'cmd.exit': '/exit',
  'cmd.exit_desc': 'Exit Xuanji',
  'cmd.settings': '/settings',
  'cmd.settings_desc': 'Open settings panel',
  'cmd.logs': '/logs',
  'cmd.logs_desc': 'View runtime logs',
  'cmd.bots': '/bots',
  'cmd.bots_desc': 'Manage IM bots',
  'cmd.lang': '/lang',
  'cmd.lang_desc': 'Switch language / 切换语言',
  'cmd.init': '/init',
  'cmd.init_desc': 'Reset project config to defaults',
  'cmd.compact': '/compact',
  'cmd.compact_desc': 'Compact conversation context',
  'cmd.model': '/model',
  'cmd.model_desc': 'View or switch model',
  'cmd.memory': '/memory',
  'cmd.memory_desc': 'View memory store',

  // ── Input ──
  'input.multiline_hint': '↕ {count} lines (Shift+Enter for newline)',

  // ── Common Actions ──
  'common.back': 'Back',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.search': 'Search',
  'common.filter': 'Filter',
  'common.loading': 'Loading...',
  'common.success': 'Success',
  'common.failed': 'Failed',
  'common.error': 'Error',
  'common.warning': 'Warning',
  'common.info': 'Info',
};
