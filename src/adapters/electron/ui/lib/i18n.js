// ============================================================
// i18n — GUI 国际化模块（浏览器端）
// ============================================================
//
// 与 CLI 的 src/core/i18n/ 保持一致的 key 约定，
// 但独立运行在 Electron 渲染进程中（无 Node.js 依赖）。
//

(function () {
  'use strict';

  var currentLang = 'en';

  // ── 中文消息 ──────────────────────────────────────────────

  var zh = {
    // -- Loading --
    'gui.loading': '正在初始化...',
    'gui.connecting': '正在连接 LLM 服务...',

    // -- Header / Nav --
    'gui.nav.chat': '对话',
    'gui.nav.settings': '设置',
    'gui.theme_toggle': '切换主题',

    // -- Welcome --
    'gui.welcome.title': '璇玑 Xuanji',
    'gui.welcome.subtitle': 'AI 助手 — 输入问题开始对话',

    // -- Chat --
    'gui.chat.user_role': '你',
    'gui.chat.assistant_role': '璇玑',
    'gui.chat.thinking': '思考中',
    'gui.chat.thinking_process': '思考过程',
    'gui.chat.thinking_chars': '{count} 字',
    'gui.chat.deep_thinking': '深度思考',
    'gui.chat.outputting': '输出中',
    'gui.chat.stream_buffered': '接收中... {lines} 行',
    'gui.chat.calling_tool': '调用 {name}',
    'gui.chat.send_failed': '发送失败',
    'gui.chat.cache_hit': '缓存命中',
    'gui.chat.cache_write': '缓存写入',

    // -- Input --
    'gui.input.placeholder': '输入消息... (Enter 发送，Shift+Enter 换行)',
    'gui.input.placeholder_no_key': '请先在设置中配置 API Key',
    'gui.input.send': '发送',
    'gui.input.stop': '停止',
    'gui.input.reset': '重置',

    // -- Status Bar --
    'gui.status.model': '模型: {model}',
    'gui.status.model_default': '模型: -',
    'gui.status.tokens': 'Token: {input} / {output}',
    'gui.status.tokens_default': 'Token: 0 / 0',

    // -- Setup Guide --
    'gui.setup.title': '欢迎使用璇玑',
    'gui.setup.desc': '首次使用需要配置 API Key',
    'gui.setup.go_settings': '前往设置',

    // -- Toast --
    'gui.toast.session_ready': '会话已就绪 — {model}',
    'gui.toast.need_api_key': '请先在设置中配置 API Key',
    'gui.toast.init_failed': '初始化失败: {error}',
    'gui.toast.session_init_failed': '会话初始化失败: {error}',

    // -- Settings Menu --
    'gui.settings.categories': '配置分类',
    'gui.settings.tab.llm': 'LLM 配置',
    'gui.settings.tab.ui': '界面设置',
    'gui.settings.tab.im': 'IM 机器人',
    'gui.settings.tab.logs': '运行日志',

    // -- LLM Settings --
    'gui.llm.active_config': '当前生效配置',
    'gui.llm.label_model': '模型',
    'gui.llm.label_apikey': 'API Key',
    'gui.llm.label_adapter': 'API 端点',
    'gui.llm.label_baseurl': 'API Base URL',
    'gui.llm.config_hint': '配置优先级: 环境变量 > 项目配置 > 全局配置 > 默认值。修改下方配置后需重启生效。',
    'gui.llm.title': 'LLM 配置',
    'gui.llm.search_model': '搜索或选择模型...',
    'gui.llm.loading': '加载中...',
    'gui.llm.no_models': '暂无模型',
    'gui.llm.load_failed': '加载失败',
    'gui.llm.adapter_auto': '从模型配置自动选择',
    'gui.llm.adapter_custom': '自定义模型，请手动选择端点',
    'gui.llm.adapter_auto_prefix': '自动: ',
    'gui.llm.adapter_unsupported': '原端点 {adapters} 暂不支持，已使用 OpenAI Chat',
    'gui.llm.baseurl_placeholder': '默认: https://shibit.net',
    'gui.llm.price_input': '输入',
    'gui.llm.price_output': '输出',
    'gui.llm.not_configured': '(未配置)',
    'gui.llm.default_suffix': '(默认)',
    'gui.llm.auto_label': '(自动)',

    // -- Save / Reset --
    'gui.settings.save_llm': '保存 LLM 配置',
    'gui.settings.reset': '重置',
    'gui.settings.saved': 'LLM 配置已保存，正在重新初始化...',
    'gui.settings.save_failed': '保存失败: {error}',
    'gui.settings.reset_failed': '重置失败: {error}',
    'gui.settings.llm_reset': 'LLM 配置已重置',

    // -- UI Settings --
    'gui.ui.title': '界面设置',
    'gui.ui.theme': '主题',
    'gui.ui.theme_dark': '深色',
    'gui.ui.theme_light': '浅色',
    'gui.ui.theme_auto': '自动',
    'gui.ui.language': '语言',
    'gui.ui.lang_zh': '中文',
    'gui.ui.lang_en': 'English',

    // -- IM Bots --
    'gui.bot.dingtalk': '钉钉机器人',
    'gui.bot.feishu': '飞书机器人',
    'gui.bot.wecom': '企业微信机器人',
    'gui.bot.status_running': '运行中',
    'gui.bot.save': '保存',
    'gui.bot.start': '启动',
    'gui.bot.stop': '停止',
    'gui.bot.started': '{type} 机器人已启动',
    'gui.bot.stopped': '{type} 机器人已停止',
    'gui.bot.start_failed': '启动失败: {error}',
    'gui.bot.stop_failed': '停止失败: {error}',
    'gui.bot.saved': '{type} 配置已保存',
    'gui.bot.dingtalk_required': '请填写钉钉 App Key 和 App Secret',
    'gui.bot.feishu_required': '请填写飞书 App ID 和 App Secret',
    'gui.bot.wecom_required_corp': '请填写企业微信 Corp ID 和 Secret',
    'gui.bot.wecom_required_agent': '请填写企业微信 Agent ID',
    'gui.bot.dingtalk_appkey_placeholder': '钉钉应用 App Key',
    'gui.bot.dingtalk_appsecret_placeholder': '钉钉应用 App Secret',
    'gui.bot.feishu_appid_placeholder': '飞书应用 App ID',
    'gui.bot.feishu_appsecret_placeholder': '飞书应用 App Secret',
    'gui.bot.wecom_corpid_placeholder': '企业微信 Corp ID',
    'gui.bot.wecom_secret_placeholder': '企业微信应用 Secret',
    'gui.bot.wecom_agentid_placeholder': '企业微信 Agent ID',
    'gui.bot.wecom_port_label': '回调端口',
    'gui.bot.wecom_port_note': '（企业微信仅支持 80/443）',
    'gui.bot.wecom_warning_port': '企业微信回调 URL <b>只支持 80 和 443 端口</b>。如使用其他端口需配置 Nginx 反向代理。',
    'gui.bot.wecom_warning_ip': '调用 API 发送消息需要在企业微信后台配置<b>「企业可信 IP」</b>为你的公网 IP。',
    'gui.bot.wecom_callback_title': '回调配置',
    'gui.bot.wecom_regen': '重新生成',
    'gui.bot.wecom_token_label': '回调 Token',
    'gui.bot.wecom_aeskey_label': 'EncodingAESKey',
    'gui.bot.wecom_copy': '复制',
    'gui.bot.wecom_callback_url_label': '回调地址',
    'gui.bot.wecom_callback_url_note': '（填入企业微信后台）',
    'gui.bot.wecom_callback_url_placeholder': '启动后自动识别，也可手动输入（如 http://123.45.67.89/wecom）',
    'gui.bot.wecom_callback_url_ip_fail': '无法自动获取IP，请输入外网IP（如: http://123.45.67.89/wecom）',
    'gui.bot.wecom_regen_success': '回调 Token 和 AESKey 已重新生成',
    'gui.bot.copied_token': '已复制回调 Token',
    'gui.bot.copied_aeskey': '已复制 EncodingAESKey',
    'gui.bot.copy_empty': '{label} 为空，请先生成',
    'gui.bot.copy_failed': '复制失败，请手动复制',
    'gui.bot.callback_url_updated': '回调地址已更新',

    // -- Logs --
    'gui.logs.title': '运行日志',
    'gui.logs.pause': '暂停',
    'gui.logs.resume': '恢复',
    'gui.logs.clear': '清空',
    'gui.logs.pause_tooltip': '暂停日志滚动',
    'gui.logs.resume_tooltip': '恢复日志滚动',

    // -- IPC Fallback --
    'gui.ipc.unavailable': 'API 不可用',

    // -- Electron main.ts --
    'gui.main.config_migrated': '已自动迁移旧版配置到嵌套结构',
    'gui.main.config_read_failed': '读取配置失败: {error}',
    'gui.main.config_write_failed': '写入配置失败: {error}',
    'gui.main.config_bot_save_failed': '保存机器人状态失败: {error}',
    'gui.main.bot_restored': '自动恢复 {type} 机器人',
    'gui.main.bot_restore_failed': '恢复 {type} 机器人失败: {error}',
    'gui.main.bot_restore_state_failed': '恢复机器人状态失败: {error}',
    'gui.main.ui_build_not_found': '构建版 UI 未找到，尝试加载源码版...',
    'gui.main.ui_load_failed': '加载 UI 失败: {error}',
    'gui.main.session_not_init': '会话未初始化，请先调用 chat:init',
    'gui.main.session_not_init_short': '会话未初始化',
    'gui.main.bot_already_running': '{type} 机器人已在运行',
    'gui.main.bot_unsupported': '不支持的机器人类型: {type}',
    'gui.main.models_loading': '获取模型列表: page={page}, size={size}, name={name}',
    'gui.main.models_failed': '获取模型列表失败: {error}',
    'gui.main.models_api_failed': '获取模型列表失败',
    'gui.main.not_configured': '(未配置)',
  };

  // ── 英文消息 ──────────────────────────────────────────────

  var en = {
    // -- Loading --
    'gui.loading': 'Initializing...',
    'gui.connecting': 'Connecting to LLM service...',

    // -- Header / Nav --
    'gui.nav.chat': 'Chat',
    'gui.nav.settings': 'Settings',
    'gui.theme_toggle': 'Toggle theme',

    // -- Welcome --
    'gui.welcome.title': 'Xuanji',
    'gui.welcome.subtitle': 'AI Assistant — Type a question to start',

    // -- Chat --
    'gui.chat.user_role': 'You',
    'gui.chat.assistant_role': 'Xuanji',
    'gui.chat.thinking': 'Thinking',
    'gui.chat.thinking_process': 'Thinking process',
    'gui.chat.thinking_chars': '{count} chars',
    'gui.chat.deep_thinking': 'Deep thinking',
    'gui.chat.outputting': 'Outputting',
    'gui.chat.stream_buffered': 'Receiving... {lines} lines',
    'gui.chat.calling_tool': 'Calling {name}',
    'gui.chat.send_failed': 'Send failed',
    'gui.chat.cache_hit': 'Cache hit',
    'gui.chat.cache_write': 'Cache write',

    // -- Input --
    'gui.input.placeholder': 'Type a message... (Enter to send, Shift+Enter for new line)',
    'gui.input.placeholder_no_key': 'Please configure API Key in settings first',
    'gui.input.send': 'Send',
    'gui.input.stop': 'Stop',
    'gui.input.reset': 'Reset',

    // -- Status Bar --
    'gui.status.model': 'Model: {model}',
    'gui.status.model_default': 'Model: -',
    'gui.status.tokens': 'Token: {input} / {output}',
    'gui.status.tokens_default': 'Token: 0 / 0',

    // -- Setup Guide --
    'gui.setup.title': 'Welcome to Xuanji',
    'gui.setup.desc': 'Please configure your API Key to get started',
    'gui.setup.go_settings': 'Go to Settings',

    // -- Toast --
    'gui.toast.session_ready': 'Session ready — {model}',
    'gui.toast.need_api_key': 'Please configure API Key in settings first',
    'gui.toast.init_failed': 'Init failed: {error}',
    'gui.toast.session_init_failed': 'Session init failed: {error}',

    // -- Settings Menu --
    'gui.settings.categories': 'Categories',
    'gui.settings.tab.llm': 'LLM Config',
    'gui.settings.tab.ui': 'UI Settings',
    'gui.settings.tab.im': 'IM Bots',
    'gui.settings.tab.logs': 'Logs',

    // -- LLM Settings --
    'gui.llm.active_config': 'Active Configuration',
    'gui.llm.label_model': 'Model',
    'gui.llm.label_apikey': 'API Key',
    'gui.llm.label_adapter': 'API Endpoint',
    'gui.llm.label_baseurl': 'API Base URL',
    'gui.llm.config_hint': 'Priority: Env vars > Project config > Global config > Defaults. Restart required after changes.',
    'gui.llm.title': 'LLM Config',
    'gui.llm.search_model': 'Search or select a model...',
    'gui.llm.loading': 'Loading...',
    'gui.llm.no_models': 'No models available',
    'gui.llm.load_failed': 'Load failed',
    'gui.llm.adapter_auto': 'Auto-selected from model config',
    'gui.llm.adapter_custom': 'Custom model, please select endpoint manually',
    'gui.llm.adapter_auto_prefix': 'Auto: ',
    'gui.llm.adapter_unsupported': 'Endpoint {adapters} not supported, using OpenAI Chat',
    'gui.llm.baseurl_placeholder': 'Default: https://shibit.net',
    'gui.llm.price_input': 'Input',
    'gui.llm.price_output': 'Output',
    'gui.llm.not_configured': '(not configured)',
    'gui.llm.default_suffix': '(default)',
    'gui.llm.auto_label': '(auto)',

    // -- Save / Reset --
    'gui.settings.save_llm': 'Save LLM Config',
    'gui.settings.reset': 'Reset',
    'gui.settings.saved': 'LLM config saved, reinitializing...',
    'gui.settings.save_failed': 'Save failed: {error}',
    'gui.settings.reset_failed': 'Reset failed: {error}',
    'gui.settings.llm_reset': 'LLM config reset',

    // -- UI Settings --
    'gui.ui.title': 'UI Settings',
    'gui.ui.theme': 'Theme',
    'gui.ui.theme_dark': 'Dark',
    'gui.ui.theme_light': 'Light',
    'gui.ui.theme_auto': 'Auto',
    'gui.ui.language': 'Language',
    'gui.ui.lang_zh': '中文',
    'gui.ui.lang_en': 'English',

    // -- IM Bots --
    'gui.bot.dingtalk': 'DingTalk Bot',
    'gui.bot.feishu': 'Feishu Bot',
    'gui.bot.wecom': 'WeCom Bot',
    'gui.bot.status_running': 'Running',
    'gui.bot.save': 'Save',
    'gui.bot.start': 'Start',
    'gui.bot.stop': 'Stop',
    'gui.bot.started': '{type} bot started',
    'gui.bot.stopped': '{type} bot stopped',
    'gui.bot.start_failed': 'Start failed: {error}',
    'gui.bot.stop_failed': 'Stop failed: {error}',
    'gui.bot.saved': '{type} config saved',
    'gui.bot.dingtalk_required': 'Please enter DingTalk App Key and App Secret',
    'gui.bot.feishu_required': 'Please enter Feishu App ID and App Secret',
    'gui.bot.wecom_required_corp': 'Please enter WeCom Corp ID and Secret',
    'gui.bot.wecom_required_agent': 'Please enter WeCom Agent ID',
    'gui.bot.dingtalk_appkey_placeholder': 'DingTalk App Key',
    'gui.bot.dingtalk_appsecret_placeholder': 'DingTalk App Secret',
    'gui.bot.feishu_appid_placeholder': 'Feishu App ID',
    'gui.bot.feishu_appsecret_placeholder': 'Feishu App Secret',
    'gui.bot.wecom_corpid_placeholder': 'WeCom Corp ID',
    'gui.bot.wecom_secret_placeholder': 'WeCom App Secret',
    'gui.bot.wecom_agentid_placeholder': 'WeCom Agent ID',
    'gui.bot.wecom_port_label': 'Callback Port',
    'gui.bot.wecom_port_note': '(WeCom only supports 80/443)',
    'gui.bot.wecom_warning_port': 'WeCom callback URL <b>only supports port 80 and 443</b>. Use Nginx reverse proxy for other ports.',
    'gui.bot.wecom_warning_ip': 'To send messages via API, configure <b>"Trusted IP"</b> in WeCom admin console.',
    'gui.bot.wecom_callback_title': 'Callback Config',
    'gui.bot.wecom_regen': 'Regenerate',
    'gui.bot.wecom_token_label': 'Callback Token',
    'gui.bot.wecom_aeskey_label': 'EncodingAESKey',
    'gui.bot.wecom_copy': 'Copy',
    'gui.bot.wecom_callback_url_label': 'Callback URL',
    'gui.bot.wecom_callback_url_note': '(enter in WeCom admin)',
    'gui.bot.wecom_callback_url_placeholder': 'Auto-detected after start, or enter manually (e.g. http://123.45.67.89/wecom)',
    'gui.bot.wecom_callback_url_ip_fail': 'Cannot detect public IP, please enter manually (e.g. http://123.45.67.89/wecom)',
    'gui.bot.wecom_regen_success': 'Callback Token and AESKey regenerated',
    'gui.bot.copied_token': 'Callback Token copied',
    'gui.bot.copied_aeskey': 'EncodingAESKey copied',
    'gui.bot.copy_empty': '{label} is empty, please generate first',
    'gui.bot.copy_failed': 'Copy failed, please copy manually',
    'gui.bot.callback_url_updated': 'Callback URL updated',

    // -- Logs --
    'gui.logs.title': 'Logs',
    'gui.logs.pause': 'Pause',
    'gui.logs.resume': 'Resume',
    'gui.logs.clear': 'Clear',
    'gui.logs.pause_tooltip': 'Pause log scrolling',
    'gui.logs.resume_tooltip': 'Resume log scrolling',

    // -- IPC Fallback --
    'gui.ipc.unavailable': 'API unavailable',

    // -- Electron main.ts --
    'gui.main.config_migrated': 'Auto-migrated legacy config to nested structure',
    'gui.main.config_read_failed': 'Failed to read config: {error}',
    'gui.main.config_write_failed': 'Failed to write config: {error}',
    'gui.main.config_bot_save_failed': 'Failed to save bot status: {error}',
    'gui.main.bot_restored': 'Auto-restored {type} bot',
    'gui.main.bot_restore_failed': 'Failed to restore {type} bot: {error}',
    'gui.main.bot_restore_state_failed': 'Failed to restore bot state: {error}',
    'gui.main.ui_build_not_found': 'Build UI not found, trying source version...',
    'gui.main.ui_load_failed': 'Failed to load UI: {error}',
    'gui.main.session_not_init': 'Session not initialized, call chat:init first',
    'gui.main.session_not_init_short': 'Session not initialized',
    'gui.main.bot_already_running': '{type} bot is already running',
    'gui.main.bot_unsupported': 'Unsupported bot type: {type}',
    'gui.main.models_loading': 'Fetching models: page={page}, size={size}, name={name}',
    'gui.main.models_failed': 'Failed to fetch models: {error}',
    'gui.main.models_api_failed': 'Failed to fetch model list',
    'gui.main.not_configured': '(not configured)',
  };

  var messages = { zh: zh, en: en };

  // ── 核心函数 ──────────────────────────────────────────────

  /**
   * 翻译文本，支持 {key} 占位符替换
   */
  function t(key, params) {
    var text = (messages[currentLang] && messages[currentLang][key]) || (messages['en'] && messages['en'][key]) || key;
    if (params) {
      var keys = Object.keys(params);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k]));
      }
    }
    return text;
  }

  /**
   * 设置当前语言
   */
  function setLanguage(lang) {
    if (lang === 'zh' || lang === 'en') {
      currentLang = lang;
    }
  }

  /**
   * 获取当前语言
   */
  function getLanguage() {
    return currentLang;
  }

  /**
   * 翻译页面中所有 data-i18n 标记的元素
   *
   * 用法:
   *   <span data-i18n="gui.nav.chat">对话</span>
   *   <input data-i18n-placeholder="gui.input.placeholder" placeholder="...">
   *   <button data-i18n-title="gui.theme_toggle" title="...">
   */
  function translatePage() {
    console.log('[i18n] 开始翻译页面，当前语言:', currentLang);

    // textContent
    var elements = document.querySelectorAll('[data-i18n]');
    console.log('[i18n] 找到 ' + elements.length + ' 个 data-i18n 元素');
    for (var i = 0; i < elements.length; i++) {
      var key = elements[i].getAttribute('data-i18n');
      if (key) {
        // 保留 HTML 标签的情况
        var hasHtml = elements[i].getAttribute('data-i18n-html');
        if (hasHtml === 'true') {
          elements[i].innerHTML = t(key);
        } else {
          elements[i].textContent = t(key);
        }
      }
    }

    // placeholder
    var placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    console.log('[i18n] 找到 ' + placeholders.length + ' 个 data-i18n-placeholder 元素');
    for (var j = 0; j < placeholders.length; j++) {
      var pKey = placeholders[j].getAttribute('data-i18n-placeholder');
      if (pKey) placeholders[j].placeholder = t(pKey);
    }

    // title
    var titles = document.querySelectorAll('[data-i18n-title]');
    console.log('[i18n] 找到 ' + titles.length + ' 个 data-i18n-title 元素');
    for (var k = 0; k < titles.length; k++) {
      var tKey = titles[k].getAttribute('data-i18n-title');
      if (tKey) titles[k].title = t(tKey);
    }

    console.log('[i18n] 翻译完成');
  }

  // ── 暴露到全局 ──────────────────────────────────────────

  window.XuanjiI18n = {
    t: t,
    setLanguage: setLanguage,
    getLanguage: getLanguage,
    translatePage: translatePage,
  };
})();
