// ============================================================
// 璇玑 Xuanji — Electron GUI 主应用逻辑
// ============================================================

(function () {
  'use strict';

  // ── 面板切换 ──────────────────────────────────────────

  var navBtns = document.querySelectorAll('.nav-btn');
  var panels = document.querySelectorAll('.panel');

  navBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-panel');

      // 更新导航按钮
      navBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      // 切换面板
      panels.forEach(function (p) { p.classList.remove('active'); });
      var targetPanel = document.getElementById('panel' + capitalize(target));
      if (targetPanel) targetPanel.classList.add('active');

      // 切到对话面板时聚焦输入框
      if (target === 'chat') {
        var input = document.getElementById('inputText');
        if (input) input.focus();
      }
    });
  });

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // ── 主题切换按钮 ──────────────────────────────────────

  var themeToggle = document.getElementById('themeToggle');
  themeToggle.addEventListener('click', function () {
    var newTheme = window.XuanjiTheme.toggle();
    // 同步设置面板的主题下拉
    var settingTheme = document.getElementById('settingTheme');
    if (settingTheme) settingTheme.value = newTheme;
  });

  // ── 初始化会话 ────────────────────────────────────────

  var loadingScreen = document.getElementById('loadingScreen');
  var loadingText = document.getElementById('loadingText');

  function showToast(message, type) {
    if (window.XuanjiSettings && window.XuanjiSettings.showToast) {
      window.XuanjiSettings.showToast(message, type);
    }
  }

  function hideLoading() {
    if (!loadingScreen) return;
    loadingScreen.classList.add('fade-out');
    setTimeout(function () {
      loadingScreen.style.display = 'none';
    }, 400);
  }

  var isFirstInit = true;

  async function initSession() {
    // 显示 loading（仅首次启动，保存配置后重新 init 不再显示）
    if (loadingScreen && !loadingScreen.classList.contains('fade-out')) {
      loadingText.textContent = '正在连接 LLM 服务...';
    }

    var result = await window.XuanjiIPC.chat.init();

    if (result.success) {
      window.XuanjiChat.updateStatus({
        model: result.config.model,
        tokenUsage: { input: 0, output: 0 },
        cost: 0,
      });

      // 更新 LLM 当前生效配置展示
      updateActiveConfig(result.config);
      // 隐藏引导提示（如果有）
      hideSetupGuide();

      console.log('[App] 会话初始化成功:', result.config.model);
      hideLoading();
    } else {
      console.error('[App] 会话初始化失败:', result.error);
      hideLoading();

      // 即使失败也更新状态栏和配置展示（显示默认模型等信息）
      if (result.config) {
        window.XuanjiChat.updateStatus({
          model: result.config.model,
          tokenUsage: { input: 0, output: 0 },
          cost: 0,
        });
        updateActiveConfig(result.config);
      }

      // API Key 缺失时显示引导
      if (result.error && result.error.includes('API Key')) {
        showSetupGuide();
        // 非首次初始化（如保存配置后）才提示 toast
        if (!isFirstInit) {
          showToast('请先在设置中配置 API Key', 'error');
        }
      } else {
        window.XuanjiChat.addErrorMessage('会话初始化失败: ' + result.error);
        showToast('初始化失败: ' + result.error, 'error');
      }
    }

    isFirstInit = false;
  }

  /**
   * 显示首次设置引导（替换欢迎页）
   */
  function showSetupGuide() {
    var messageList = document.getElementById('messageList');
    if (!messageList) return;

    messageList.innerHTML =
      '<div class="welcome">' +
        '<div class="welcome-icon">&#128273;</div>' +
        '<h2>欢迎使用璇玑</h2>' +
        '<p style="margin-bottom: 16px;">首次使用需要配置 API Key</p>' +
        '<button class="btn btn-primary" id="goSettingsBtn" style="font-size: 14px; padding: 10px 28px;">前往设置</button>' +
      '</div>';

    var goBtn = document.getElementById('goSettingsBtn');
    if (goBtn) {
      goBtn.addEventListener('click', function () {
        // 切到设置面板 → LLM 标签页
        var settingsBtn = document.querySelector('[data-panel="settings"]');
        if (settingsBtn) settingsBtn.click();
      });
    }

    // 禁用输入
    var inputText = document.getElementById('inputText');
    if (inputText) {
      inputText.disabled = true;
      inputText.placeholder = '请先在设置中配置 API Key';
    }
  }

  /**
   * 隐藏引导，恢复正常状态
   */
  function hideSetupGuide() {
    var messageList = document.getElementById('messageList');
    if (!messageList) return;

    // 如果当前是引导页（含 goSettingsBtn），恢复为欢迎页
    if (document.getElementById('goSettingsBtn')) {
      messageList.innerHTML =
        '<div class="welcome">' +
          '<div class="welcome-icon">&#10022;</div>' +
          '<h2>璇玑 Xuanji</h2>' +
          '<p>AI 助手 — 输入问题开始对话</p>' +
        '</div>';
    }

    // 恢复输入
    var inputText = document.getElementById('inputText');
    if (inputText) {
      inputText.disabled = false;
      inputText.placeholder = '输入消息... (Enter 发送，Shift+Enter 换行)';
      inputText.focus();
    }
  }

  /**
   * 更新 LLM 当前生效配置展示
   */
  function updateActiveConfig(config) {
    var activeModel = document.getElementById('activeModel');
    var activeApiKey = document.getElementById('activeApiKey');
    var activeAdapter = document.getElementById('activeAdapter');
    var activeBaseURL = document.getElementById('activeBaseURL');

    var adapterLabels = {
      'openai-response': 'OpenAI Responses',
      'openai': 'OpenAI Chat',
      'anthropic': 'Anthropic Messages',
    };

    if (activeModel) activeModel.textContent = config.model || '-';
    if (activeApiKey) activeApiKey.textContent = config.apiKey || '(未配置)';
    if (activeAdapter) activeAdapter.textContent = adapterLabels[config.adapter] || config.adapter || '(自动)';
    if (activeBaseURL) activeBaseURL.textContent = config.baseURL || 'https://shibit.net (默认)';
  }

  // ── 快捷键 ────────────────────────────────────────────

  document.addEventListener('keydown', function (e) {
    // Ctrl/Cmd + , → 打开设置
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      var settingsBtn = document.querySelector('[data-panel="settings"]');
      if (settingsBtn) settingsBtn.click();
    }

    // Ctrl/Cmd + L → 清空对话
    if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
      e.preventDefault();
      window.XuanjiChat.clearMessages();
    }

    // Escape → 停止运行
    if (e.key === 'Escape') {
      window.XuanjiIPC.chat.stop();
    }
  });

  // ── 启动 ──────────────────────────────────────────────

  /**
   * 初始化国际化（从配置读取语言设置）
   */
  async function initI18n() {
    try {
      var result = await window.XuanjiIPC.config.load();
      if (!result.success || !result.data) {
        console.warn('[App] 加载配置失败，使用默认语言');
        return;
      }

      var config = result.data;
      var ui = config.ui || {};
      var language = ui.language || 'zh';

      console.log('[App] 初始化国际化，语言:', language);
      console.log('[App] 完整配置:', config);

      // 设置 i18n 语言
      if (window.XuanjiI18n && window.XuanjiI18n.setLanguage) {
        console.log('[App] 设置i18n语言为:', language);
        window.XuanjiI18n.setLanguage(language);
        // 翻译页面中所有 data-i18n 标记的元素
        if (window.XuanjiI18n.translatePage) {
          console.log('[App] 开始翻译页面...');
          window.XuanjiI18n.translatePage();
          console.log('[App] 页面翻译完成');

          // 验证翻译结果
          var testBtn = document.querySelector('[data-i18n="gui.nav.chat"]');
          if (testBtn) {
            console.log('[App] 导航按钮翻译结果:', testBtn.textContent);
          }
        } else {
          console.error('[App] XuanjiI18n.translatePage 不存在!');
        }
      } else {
        console.error('[App] window.XuanjiI18n 不存在!');
      }
    } catch (err) {
      console.error('[App] 初始化国际化失败:', err);
    }
  }

  // 暴露到全局（供 settings-panel 保存后重新初始化）
  window.XuanjiApp = {
    initSession: initSession,
    initI18n: initI18n,
  };

  // 初始化国际化和会话
  initI18n();
  initSession();

  // 聚焦输入框
  var inputText = document.getElementById('inputText');
  if (inputText) inputText.focus();

  console.log('[App] 璇玑 Xuanji GUI 已启动');
})();
