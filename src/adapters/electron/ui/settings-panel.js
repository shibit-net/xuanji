// ============================================================
// 设置面板 — API Key, 模型, IM 机器人启停
// ============================================================

(function () {
  'use strict';

  // ── DOM 元素 ──────────────────────────────────────────

  // LLM 设置
  var settingApiKey = document.getElementById('settingApiKey');
  var settingModel = document.getElementById('settingModel');
  var settingModelInput = document.getElementById('settingModelInput');
  var settingAdapter = document.getElementById('settingAdapter');
  var adapterHint = document.getElementById('adapterHint');
  var settingBaseURL = document.getElementById('settingBaseURL');
  var settingTheme = document.getElementById('settingTheme');
  var settingLanguage = document.getElementById('settingLanguage');

  // 钉钉
  var dingtalkAppKey = document.getElementById('dingtalkAppKey');
  var dingtalkAppSecret = document.getElementById('dingtalkAppSecret');
  var dingtalkStartBtn = document.getElementById('dingtalkStartBtn');
  var dingtalkStopBtn = document.getElementById('dingtalkStopBtn');
  var dingtalkStatus = document.getElementById('dingtalkStatus');

  // 飞书
  var feishuAppId = document.getElementById('feishuAppId');
  var feishuAppSecret = document.getElementById('feishuAppSecret');
  var feishuStartBtn = document.getElementById('feishuStartBtn');
  var feishuStopBtn = document.getElementById('feishuStopBtn');
  var feishuStatus = document.getElementById('feishuStatus');

  // 企业微信
  var wecomCorpId = document.getElementById('wecomCorpId');
  var wecomSecret = document.getElementById('wecomSecret');
  var wecomAgentId = document.getElementById('wecomAgentId');
  var wecomToken = document.getElementById('wecomToken');
  var wecomAesKey = document.getElementById('wecomAesKey');
  var wecomPort = document.getElementById('wecomPort');
  var wecomStartBtn = document.getElementById('wecomStartBtn');
  var wecomStopBtn = document.getElementById('wecomStopBtn');
  var wecomStatus = document.getElementById('wecomStatus');

  // 按钮
  var saveSettingsBtn = document.getElementById('saveSettingsBtn');
  var resetSettingsBtn = document.getElementById('resetSettingsBtn');

  var STORAGE_KEY = 'xuanji-settings';

  // ── 模型选择器（可搜索 + 懒加载分页） ──────────────────

  var modelDropdown = document.getElementById('modelDropdown');
  var modelList = document.getElementById('modelList');
  var modelLoading = document.getElementById('modelLoading');
  var modelEmpty = document.getElementById('modelEmpty');
  var modelPriceInfo = document.getElementById('modelPriceInfo');

  // 缓存已加载模型的价格和端点信息
  var modelPriceCache = {};

  /** adapter 显示名映射 */
  var ADAPTER_LABELS = {
    'openai-response': 'OpenAI Responses',
    'openai': 'OpenAI Chat',
    'anthropic': 'Anthropic Messages',
    'gemini': 'Google Gemini',
  };

  /** 支持的端点（按优先级排序） */
  var SUPPORTED_ADAPTERS = ['anthropic', 'openai-response', 'openai'];

  var modelState = {
    page: 0,         // 当前已加载页码（0 = 未加载）
    pages: 1,        // 总页数
    total: 0,        // 总条数
    loading: false,   // 是否加载中
    searchText: '',   // 搜索关键词
    searchTimer: null, // 搜索防抖定时器
    isOpen: false,     // 下拉是否展开
    pageSize: 30,      // 每页大小
  };

  /**
   * 加载一页模型数据
   */
  async function loadModelPage(page, searchName) {
    if (modelState.loading) return;
    modelState.loading = true;
    modelEmpty.style.display = 'none';

    // loading 指示器放到列表末尾（追加加载时跟随内容滚动）
    modelList.appendChild(modelLoading);
    modelLoading.style.display = '';
    // 滚动到 loading 可见
    modelLoading.scrollIntoView({ block: 'nearest' });

    try {
      var result = await window.XuanjiIPC.models.list({
        page: page,
        size: modelState.pageSize,
        name: searchName || '',
      });

      if (result.success && result.data) {
        modelState.page = result.data.pageNum;
        modelState.pages = result.data.pages;
        modelState.total = result.data.total;

        var list = result.data.list || [];

        if (page === 1 && list.length === 0) {
          modelEmpty.style.display = '';
        }

        list.forEach(function (m) {
          // 缓存价格和端点信息
          modelPriceCache[m.name] = {
            unitPriceReminder: m.unitPriceReminder,
            unitPriceComplete: m.unitPriceComplete,
            billingMethod: m.billingMethod,
            perCallPrice: m.perCallPrice,
            adapter: m.adapter,
          };

          var item = document.createElement('div');
          item.className = 'model-item';
          if (m.name === settingModel.value) {
            item.classList.add('selected');
          }
          item.setAttribute('data-model', m.name);

          var nameEl = document.createElement('div');
          nameEl.className = 'model-item-name';
          nameEl.textContent = m.name;

          var metaEl = document.createElement('div');
          metaEl.className = 'model-item-meta';

          // 展示单价信息
          var priceParts = [];
          if (m.unitPriceReminder != null && m.unitPriceComplete != null) {
            priceParts.push('输入 ¥' + Number(m.unitPriceReminder).toFixed(2) + ' / 输出 ¥' + Number(m.unitPriceComplete).toFixed(2));
          } else if (m.perCallPrice != null) {
            priceParts.push('¥' + Number(m.perCallPrice).toFixed(4) + '/次');
          }
          if (m.billingMethod) priceParts.push(m.billingMethod);
          metaEl.textContent = priceParts.join(' · ') || '';

          item.appendChild(nameEl);
          if (metaEl.textContent) item.appendChild(metaEl);

          item.addEventListener('click', function () {
            selectModel(m.name);
          });

          modelList.appendChild(item);
        });
      } else {
        if (page === 1) {
          modelEmpty.style.display = '';
          modelEmpty.textContent = result.error || '加载失败';
        }
      }
    } catch (err) {
      console.error('[Settings] 加载模型列表失败:', err);
      if (page === 1) {
        modelEmpty.style.display = '';
        modelEmpty.textContent = '加载失败: ' + (err.message || '未知错误');
      }
    } finally {
      modelState.loading = false;
      modelLoading.style.display = 'none';
      // 将 loading 移回 dropdown（不占列表空间）
      modelDropdown.appendChild(modelLoading);
      // 加载后尝试更新当前已选模型的费用显示
      if (settingModel.value && modelPriceCache[settingModel.value]) {
        updateModelPriceDisplay(settingModel.value);
      }
      // 如果内容不够撑满滚动区域，自动加载更多
      setTimeout(checkAutoLoadMore, 50);
    }
  }

  /**
   * 选择模型
   */
  function selectModel(modelName) {
    settingModel.value = modelName;
    settingModelInput.value = modelName;
    updateModelPriceDisplay(modelName);
    // 从缓存获取 adapter 并自动设定（锁定，不可手动更改）
    var cached = modelPriceCache[modelName];
    if (cached && cached.adapter) {
      updateAdapterFromModel(cached.adapter);
    }
    setAdapterEditable(false);
    closeModelDropdown();
  }

  /**
   * 设置 adapter 下拉是否可编辑
   */
  function setAdapterEditable(editable) {
    settingAdapter.disabled = !editable;
    if (editable) {
      adapterHint.textContent = '自定义模型，请手动选择端点';
    }
  }

  /**
   * 更新 adapter 下拉（从模型的 adapter 字段按优先级选择）
   * adapter 可能是字符串或 JSON 数组（如 ["anthropic","openai"]）
   */
  function updateAdapterFromModel(adapterValue) {
    // 解析 adapter 列表
    var adapterList = [];
    if (Array.isArray(adapterValue)) {
      adapterList = adapterValue;
    } else if (typeof adapterValue === 'string') {
      // 尝试解析 JSON 数组
      try {
        var parsed = JSON.parse(adapterValue);
        if (Array.isArray(parsed)) {
          adapterList = parsed;
        } else {
          adapterList = [adapterValue];
        }
      } catch (e) {
        adapterList = [adapterValue];
      }
    }

    // 全部转小写
    adapterList = adapterList.map(function (a) { return (a || '').toLowerCase(); });

    // 按优先级匹配：anthropic > openai-response > openai
    var matched = '';
    for (var i = 0; i < SUPPORTED_ADAPTERS.length; i++) {
      var target = SUPPORTED_ADAPTERS[i].toLowerCase();
      if (adapterList.indexOf(target) !== -1) {
        matched = SUPPORTED_ADAPTERS[i];
        break;
      }
    }

    if (matched) {
      settingAdapter.value = matched;
      adapterHint.textContent = '自动: ' + (ADAPTER_LABELS[matched] || matched);
    } else {
      // 未匹配，默认使用 openai
      settingAdapter.value = 'openai';
      adapterHint.textContent = '原端点 ' + adapterList.join(', ') + ' 暂不支持，已使用 OpenAI Chat';
    }
  }

  /**
   * 更新模型费用显示
   */
  function updateModelPriceDisplay(modelName) {
    if (!modelPriceInfo) return;
    var price = modelPriceCache[modelName];
    if (!price) {
      modelPriceInfo.textContent = '';
      return;
    }
    var parts = [];
    if (price.unitPriceReminder != null && price.unitPriceComplete != null) {
      parts.push('输入 ¥' + Number(price.unitPriceReminder).toFixed(2) + '/M · 输出 ¥' + Number(price.unitPriceComplete).toFixed(2) + '/M');
    } else if (price.perCallPrice != null) {
      parts.push('¥' + Number(price.perCallPrice).toFixed(4) + '/次');
    }
    if (price.billingMethod) parts.push(price.billingMethod);
    modelPriceInfo.textContent = parts.join('  ');
  }

  /**
   * 打开下拉
   */
  function openModelDropdown() {
    if (modelState.isOpen) return;
    modelState.isOpen = true;
    modelDropdown.classList.add('open');
    settingModelInput.select();

    // 首次打开或搜索词变化时重新加载
    if (modelState.page === 0) {
      modelList.innerHTML = '';
      loadModelPage(1, modelState.searchText);
    }
  }

  /**
   * 关闭下拉
   */
  function closeModelDropdown() {
    modelState.isOpen = false;
    modelDropdown.classList.remove('open');
    var inputVal = settingModelInput.value.trim();
    if (inputVal) {
      settingModel.value = inputVal;
      // 判断是否为列表中的模型
      if (!modelPriceCache[inputVal]) {
        // 自定义模型：解锁 adapter，清除价格
        setAdapterEditable(true);
        modelPriceInfo.textContent = '';
      }
    } else if (settingModel.value) {
      settingModelInput.value = settingModel.value;
    }
  }

  /**
   * 搜索模型（防抖 300ms）
   */
  function onModelSearch() {
    var text = settingModelInput.value.trim();
    if (text === modelState.searchText) return;

    modelState.searchText = text;

    if (modelState.searchTimer) {
      clearTimeout(modelState.searchTimer);
    }

    modelState.searchTimer = setTimeout(function () {
      // 重置分页状态并重新搜索
      modelState.page = 0;
      modelState.pages = 1;
      modelList.innerHTML = '';
      loadModelPage(1, modelState.searchText);
    }, 300);
  }

  // 输入框事件
  settingModelInput.addEventListener('focus', function () {
    openModelDropdown();
  });

  settingModelInput.addEventListener('input', function () {
    if (!modelState.isOpen) openModelDropdown();
    onModelSearch();
  });

  // Enter 确认自定义输入
  settingModelInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      var inputVal = settingModelInput.value.trim();
      if (inputVal) {
        settingModel.value = inputVal;
        if (!modelPriceCache[inputVal]) {
          // 自定义模型：解锁 adapter，清除价格
          setAdapterEditable(true);
          modelPriceInfo.textContent = '';
        }
      }
      closeModelDropdown();
      settingModelInput.blur();
    }
  });

  // 点击外部关闭
  document.addEventListener('click', function (e) {
    var selector = document.getElementById('modelSelector');
    if (selector && !selector.contains(e.target)) {
      closeModelDropdown();
    }
  });

  // 滚动到底部加载更多
  modelList.addEventListener('scroll', function () {
    if (modelState.loading) return;
    if (modelState.page >= modelState.pages) return;

    var scrollBottom = modelList.scrollHeight - modelList.scrollTop - modelList.clientHeight;
    if (scrollBottom < 40) {
      console.log('[ModelSelector] 触发加载更多, page:', modelState.page + 1, '/', modelState.pages);
      loadModelPage(modelState.page + 1, modelState.searchText);
    }
  });

  /**
   * 首页加载完后，如果内容没撑满滚动区域且还有更多页，自动加载下一页
   */
  function checkAutoLoadMore() {
    if (modelState.loading) return;
    if (modelState.page >= modelState.pages) return;
    // 内容不够撑满时 scrollHeight === clientHeight，需要继续加载
    if (modelList.scrollHeight <= modelList.clientHeight) {
      console.log('[ModelSelector] 内容不足，自动加载更多, page:', modelState.page + 1);
      loadModelPage(modelState.page + 1, modelState.searchText);
    }
  }

  /**
   * 获取当前模型的费用和端点信息（用于初始加载时展示）
   * 通过 name 搜索 API 精确匹配当前模型
   */
  async function fetchCurrentModelInfo(modelName) {
    if (!modelName) return;
    // 已有缓存则直接展示
    if (modelPriceCache[modelName]) {
      updateModelPriceDisplay(modelName);
      var cached = modelPriceCache[modelName];
      if (cached.adapter) {
        updateAdapterFromModel(cached.adapter);
        setAdapterEditable(false);
      }
      return;
    }

    try {
      var result = await window.XuanjiIPC.models.list({
        page: 1,
        size: 10,
        name: modelName,
      });

      if (result.success && result.data && result.data.list) {
        var list = result.data.list;
        // 缓存所有返回的模型
        list.forEach(function (m) {
          modelPriceCache[m.name] = {
            unitPriceReminder: m.unitPriceReminder,
            unitPriceComplete: m.unitPriceComplete,
            billingMethod: m.billingMethod,
            perCallPrice: m.perCallPrice,
            adapter: m.adapter,
          };
        });

        // 精确匹配当前模型
        if (modelPriceCache[modelName]) {
          updateModelPriceDisplay(modelName);
          var info = modelPriceCache[modelName];
          if (info.adapter) {
            updateAdapterFromModel(info.adapter);
            setAdapterEditable(false);
          }
          console.log('[Settings] 已加载当前模型费用信息:', modelName);
        } else {
          // 未精确匹配到 → 视为自定义模型
          setAdapterEditable(true);
          console.log('[Settings] 当前模型非列表模型，视为自定义:', modelName);
        }
      }
    } catch (err) {
      console.error('[Settings] 获取当前模型信息失败:', err);
    }
  }

  // ── 标签页切换 ────────────────────────────────────────────

  /**
   * 初始化标签页菜单
   */
  function initTabMenu() {
    var menuBtns = document.querySelectorAll('.settings-menu-btn');
    menuBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tabName = btn.getAttribute('data-tab');
        switchTab(tabName);
      });
    });
  }

  /**
   * 切换标签页
   */
  function switchTab(tabName) {
    // 更新菜单按钮的 active 状态
    var menuBtns = document.querySelectorAll('.settings-menu-btn');
    menuBtns.forEach(function (btn) {
      if (btn.getAttribute('data-tab') === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // 更新标签页的显示状态
    var tabs = document.querySelectorAll('.settings-tab');
    tabs.forEach(function (tab) {
      if (tab.getAttribute('data-tab') === tabName) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
  }

  // ── 配置持久化 ────────────────────────────────────────

  /**
   * 加载保存的配置
   */
  async function loadSettings() {
    try {
      var result = await window.XuanjiIPC.config.load();
      if (!result.success) {
        console.error('[Settings] 加载配置失败:', result.error);
        return;
      }

      var settings = result.data || {};

      // LLM 配置（嵌套在 provider 下）
      var provider = settings.provider || {};
      settingApiKey.value = provider.apiKey || '';  // 总是设置，包括空字符串
      if (provider.model) {
        settingModel.value = provider.model;
        settingModelInput.value = provider.model;
      }
      if (provider.baseURL) settingBaseURL.value = provider.baseURL;
      if (provider.adapter) settingAdapter.value = provider.adapter;

      // 兼容旧版扁平结构（自动迁移）
      if (!settings.provider && (settings.apiKey || settings.model)) {
        if (settings.apiKey !== undefined) settingApiKey.value = settings.apiKey;
        if (settings.model) {
          settingModel.value = settings.model;
          settingModelInput.value = settings.model;
        }
        if (settings.baseURL) settingBaseURL.value = settings.baseURL;
      }

      // UI 配置（嵌套在 ui 下）
      var ui = settings.ui || {};
      var theme = ui.theme || settings.theme; // 兼容旧版
      if (theme) {
        settingTheme.value = theme;
        window.XuanjiTheme.save(theme);
        window.XuanjiTheme.apply(theme);
      }

      // 语言设置
      var language = ui.language || 'zh'; // 默认中文
      if (settingLanguage) {
        settingLanguage.value = language;
      }

      // IM 配置
      if (settings.dingtalk) {
        if (settings.dingtalk.appKey) dingtalkAppKey.value = settings.dingtalk.appKey;
        if (settings.dingtalk.appSecret) dingtalkAppSecret.value = settings.dingtalk.appSecret;
      }
      if (settings.feishu) {
        if (settings.feishu.appId) feishuAppId.value = settings.feishu.appId;
        if (settings.feishu.appSecret) feishuAppSecret.value = settings.feishu.appSecret;
      }
      if (settings.wecom) {
        if (settings.wecom.corpId) wecomCorpId.value = settings.wecom.corpId;
        if (settings.wecom.secret) wecomSecret.value = settings.wecom.secret;
        if (settings.wecom.agentId) wecomAgentId.value = settings.wecom.agentId;
        if (settings.wecom.token) wecomToken.value = settings.wecom.token;
        if (settings.wecom.encodingAESKey) wecomAesKey.value = settings.wecom.encodingAESKey;
        if (settings.wecom.port) wecomPort.value = settings.wecom.port;
      }

      // 同步机器人运行状态到 UI
      syncBotStatus();

      // 加载当前模型的费用和端点信息（非自定义模型）
      var currentModel = settingModel.value;
      if (currentModel) {
        fetchCurrentModelInfo(currentModel);
      }
    } catch (err) {
      console.error('[Settings] 加载配置失败:', err);
    }

    // 初始化标签页菜单
    initTabMenu();
  }

  /**
   * 查询当前运行中的机器人，同步 UI 状态
   */
  function syncBotStatus() {
    window.XuanjiIPC.bot.list().then(function (result) {
      if (result.success && result.bots) {
        result.bots.forEach(function (bot) {
          updateBotUI(bot.type, bot.running);
        });
      }
    }).catch(function (err) {
      console.error('[Settings] 获取机器人状态失败:', err);
    });
  }

  /**
   * 保存 LLM 和 UI 配置（嵌套结构，与 ConfigLoader 对齐）
   */
  async function saveSettings() {
    var settings = {
      provider: {
        apiKey: settingApiKey.value,
        model: settingModel.value,
        adapter: settingAdapter.value,
        baseURL: settingBaseURL.value,
      },
      ui: {
        theme: settingTheme.value,
        language: settingLanguage.value,
      },
    };

    console.log('[Settings] 保存配置:', settings);

    var result = await window.XuanjiIPC.config.save(settings);
    console.log('[Settings] 保存结果:', result);

    if (result.success) {
      showToast('LLM 配置已保存，正在重新初始化...', 'success');

      // 重新初始化国际化（语言可能已改变）
      if (window.XuanjiApp && window.XuanjiApp.initI18n) {
        console.log('[Settings] 调用 initI18n()...');
        await window.XuanjiApp.initI18n();
        console.log('[Settings] initI18n() 完成');
      } else {
        console.error('[Settings] window.XuanjiApp.initI18n 不存在!');
      }

      // 重新初始化会话（让新配置生效）
      if (window.XuanjiApp && window.XuanjiApp.initSession) {
        await window.XuanjiApp.initSession();
      }
    } else {
      showToast('保存失败: ' + (result.error || '未知错误'), 'error');
      return;
    }

    // 应用主题
    window.XuanjiTheme.save(settings.ui.theme);
    window.XuanjiTheme.apply(settings.ui.theme);
  }

  /**
   * 保存单个机器人配置
   */
  async function saveBotConfig(type) {
    var config = {};

    switch (type) {
      case 'dingtalk':
        config = {
          dingtalk: {
            appKey: dingtalkAppKey.value,
            appSecret: dingtalkAppSecret.value,
          },
        };
        break;
      case 'feishu':
        config = {
          feishu: {
            appId: feishuAppId.value,
            appSecret: feishuAppSecret.value,
          },
        };
        break;
      case 'wecom':
        config = {
          wecom: {
            corpId: wecomCorpId.value,
            secret: wecomSecret.value,
            agentId: wecomAgentId.value,
            token: wecomToken.value,
            encodingAESKey: wecomAesKey.value,
            port: parseInt(wecomPort.value) || 80,
          },
        };
        break;
      default:
        return;
    }

    var result = await window.XuanjiIPC.config.save(config);
    if (result.success) {
      showToast(type + ' 配置已保存', 'success');
      return true;
    } else {
      showToast('保存失败: ' + (result.error || '未知错误'), 'error');
      return false;
    }
  }

  /**
   * 重置 LLM 和 UI 配置（不重置机器人配置）
   */
  async function resetSettings() {
    var defaultSettings = {
      provider: {
        apiKey: '',
        model: '[CC]claude-sonnet-4-5-20250929',
        adapter: 'anthropic',
        baseURL: '',
      },
      ui: {
        theme: 'dark',
      },
    };

    // 通过 IPC 保存默认配置（仅 LLM + UI）
    var result = await window.XuanjiIPC.config.save(defaultSettings);
    if (!result.success) {
      showToast('重置失败: ' + (result.error || '未知错误'), 'error');
      return;
    }

    // 更新 UI 中的值
    settingApiKey.value = '';
    settingModel.value = '[CC]claude-sonnet-4-5-20250929';
    settingModelInput.value = '[CC]claude-sonnet-4-5-20250929';
    settingBaseURL.value = '';
    settingAdapter.value = 'anthropic';
    settingAdapter.disabled = true;
    adapterHint.textContent = '从模型配置自动选择';
    settingTheme.value = 'dark';
    if (settingLanguage) settingLanguage.value = 'zh';

    // 应用主题
    window.XuanjiTheme.save('dark');
    window.XuanjiTheme.apply('dark');
    showToast('LLM 配置已重置', 'success');
  }

  // ── 机器人启停 ────────────────────────────────────────

  /**
   * 设置按钮 loading 状态
   */
  function setBtnLoading(btn, loading) {
    if (loading) {
      btn.classList.add('loading');
      btn.disabled = true;
    } else {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  function updateBotUI(type, running) {
    var startBtn, stopBtn, statusEl, configFieldsEl, saveBtn;

    switch (type) {
      case 'dingtalk':
        startBtn = dingtalkStartBtn;
        stopBtn = dingtalkStopBtn;
        statusEl = dingtalkStatus;
        configFieldsEl = document.getElementById('dingtalkConfigFields');
        saveBtn = document.getElementById('dingtalkSaveBtn');
        break;
      case 'feishu':
        startBtn = feishuStartBtn;
        stopBtn = feishuStopBtn;
        statusEl = feishuStatus;
        configFieldsEl = document.getElementById('feishuConfigFields');
        saveBtn = document.getElementById('feishuSaveBtn');
        break;
      case 'wecom':
        startBtn = wecomStartBtn;
        stopBtn = wecomStopBtn;
        statusEl = wecomStatus;
        configFieldsEl = document.getElementById('wecomConfigFields');
        saveBtn = document.getElementById('wecomSaveBtn');
        break;
      default:
        return;
    }

    // 清除 loading 状态
    setBtnLoading(startBtn, false);
    setBtnLoading(stopBtn, false);

    // 更新按钮显示状态
    startBtn.classList.toggle('hidden', running);
    stopBtn.classList.toggle('hidden', !running);

    // 保存按钮: 运行中隐藏
    if (saveBtn) {
      saveBtn.classList.toggle('hidden', running);
    }

    // 更新状态标签
    statusEl.textContent = running ? '运行中' : '';
    statusEl.className = 'bot-status ' + (running ? 'running' : 'stopped');

    // 运行中时隐藏配置字段，停止时显示
    if (configFieldsEl) {
      configFieldsEl.style.display = running ? 'none' : '';
    }

    // 企业微信特殊处理：运行时显示回调配置面板，停止时隐藏
    if (type === 'wecom') {
      var callbackPanel = document.getElementById('wecomCallbackPanel');
      if (callbackPanel) {
        callbackPanel.style.display = running ? '' : 'none';
      }
    }
  }

  async function startBot(type) {
    var config = {};
    var startBtn;

    switch (type) {
      case 'dingtalk':
        startBtn = dingtalkStartBtn;
        config = { appKey: dingtalkAppKey.value, appSecret: dingtalkAppSecret.value };
        if (!config.appKey || !config.appSecret) {
          showToast('请填写钉钉 App Key 和 App Secret', 'error');
          return;
        }
        break;
      case 'feishu':
        startBtn = feishuStartBtn;
        config = { appId: feishuAppId.value, appSecret: feishuAppSecret.value };
        if (!config.appId || !config.appSecret) {
          showToast('请填写飞书 App ID 和 App Secret', 'error');
          return;
        }
        break;
      case 'wecom':
        startBtn = wecomStartBtn;
        // 企业微信：自动生成 Token/AESKey（如果缺失）
        if (!wecomToken.value) {
          wecomToken.value = randomString(32);
        }
        if (!wecomAesKey.value) {
          wecomAesKey.value = randomString(43);
        }

        config = {
          corpId: wecomCorpId.value,
          secret: wecomSecret.value,
          agentId: wecomAgentId.value,
          token: wecomToken.value,
          encodingAESKey: wecomAesKey.value,
          port: wecomPort.value,
        };
        if (!config.corpId || !config.secret) {
          showToast('请填写企业微信 Corp ID 和 Secret', 'error');
          return;
        }
        if (!config.agentId) {
          showToast('请填写企业微信 Agent ID', 'error');
          return;
        }
        break;
    }

    // 设置 loading
    setBtnLoading(startBtn, true);

    try {
      // 先保存机器人配置
      var saved = await saveBotConfig(type);
      if (!saved) {
        setBtnLoading(startBtn, false);
        return;
      }

      // 再启动机器人
      var result = await window.XuanjiIPC.bot.start(type, config);
      if (result.success) {
        updateBotUI(type, true);
        showToast(type + ' 机器人已启动', 'success');
      } else {
        setBtnLoading(startBtn, false);
        showToast('启动失败: ' + (result.error || '未知错误'), 'error');
      }
    } catch (err) {
      setBtnLoading(startBtn, false);
      showToast('启动失败: ' + (err.message || '未知错误'), 'error');
    }
  }

  async function stopBot(type) {
    var stopBtn;
    switch (type) {
      case 'dingtalk': stopBtn = dingtalkStopBtn; break;
      case 'feishu': stopBtn = feishuStopBtn; break;
      case 'wecom': stopBtn = wecomStopBtn; break;
    }

    // 设置 loading
    setBtnLoading(stopBtn, true);

    try {
      var result = await window.XuanjiIPC.bot.stop(type);
      if (result.success) {
        updateBotUI(type, false);
        showToast(type + ' 机器人已停止', 'success');
      } else {
        setBtnLoading(stopBtn, false);
        showToast('停止失败: ' + (result.error || '未知错误'), 'error');
      }
    } catch (err) {
      setBtnLoading(stopBtn, false);
      showToast('停止失败: ' + (err.message || '未知错误'), 'error');
    }
  }

  // ── Toast 通知 ────────────────────────────────────────

  function showToast(message, type) {
    type = type || 'info';
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(function () {
      toast.classList.add('show');
    });

    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 2500);
  }

  // ── 自动生成 Token / EncodingAESKey ────────────────────

  var CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  function randomString(len) {
    var arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    var result = '';
    for (var i = 0; i < len; i++) {
      result += CHARS[arr[i] % CHARS.length];
    }
    return result;
  }

  var genTokenBtn = document.getElementById('genTokenBtn');
  var genAesKeyBtn = document.getElementById('genAesKeyBtn');

  /**
   * 复制文本到剪贴板
   */
  function copyToClipboard(text, label) {
    navigator.clipboard.writeText(text).then(function () {
      showToast(`✓ 已复制 ${label}`, 'success');
    }).catch(function (err) {
      showToast('复制失败，请手动复制', 'error');
      console.error('[Settings] 复制失败:', err);
    });
  }

  genTokenBtn.addEventListener('click', function () {
    if (wecomToken.value) {
      copyToClipboard(wecomToken.value, '回调 Token');
    } else {
      showToast('Token 为空，请先生成', 'error');
    }
  });

  genAesKeyBtn.addEventListener('click', function () {
    if (wecomAesKey.value) {
      copyToClipboard(wecomAesKey.value, 'EncodingAESKey');
    } else {
      showToast('EncodingAESKey 为空，请先生成', 'error');
    }
  });

  // ── 事件绑定 ──────────────────────────────────────────

  saveSettingsBtn.addEventListener('click', function () {
    saveSettings().catch(function (err) {
      console.error('[Settings] 保存失败:', err);
      showToast('保存失败: ' + (err.message || '未知错误'), 'error');
    });
  });
  resetSettingsBtn.addEventListener('click', function () {
    resetSettings().catch(function (err) {
      console.error('[Settings] 重置失败:', err);
      showToast('重置失败: ' + (err.message || '未知错误'), 'error');
    });
  });

  // 钉钉 — 保存和启停
  document.getElementById('dingtalkSaveBtn').addEventListener('click', function () {
    saveBotConfig('dingtalk').catch(function (err) {
      console.error('[Settings] 保存钉钉配置失败:', err);
      showToast('保存失败: ' + (err.message || '未知错误'), 'error');
    });
  });
  dingtalkStartBtn.addEventListener('click', function () { startBot('dingtalk'); });
  dingtalkStopBtn.addEventListener('click', function () { stopBot('dingtalk'); });

  // 飞书 — 保存和启停
  document.getElementById('feishuSaveBtn').addEventListener('click', function () {
    saveBotConfig('feishu').catch(function (err) {
      console.error('[Settings] 保存飞书配置失败:', err);
      showToast('保存失败: ' + (err.message || '未知错误'), 'error');
    });
  });
  feishuStartBtn.addEventListener('click', function () { startBot('feishu'); });
  feishuStopBtn.addEventListener('click', function () { stopBot('feishu'); });

  // 企业微信 — 保存和启停
  document.getElementById('wecomSaveBtn').addEventListener('click', function () {
    saveBotConfig('wecom').catch(function (err) {
      console.error('[Settings] 保存企业微信配置失败:', err);
      showToast('保存失败: ' + (err.message || '未知错误'), 'error');
    });
  });
  wecomStartBtn.addEventListener('click', function () { startBot('wecom'); });
  wecomStopBtn.addEventListener('click', function () { stopBot('wecom'); });

  // 企业微信回调配置 — 重新生成（同时生成 Token 和 AESKey）
  document.getElementById('wecomRegenBtn').addEventListener('click', function () {
    wecomToken.value = randomString(32);
    wecomAesKey.value = randomString(43);
    saveBotConfig('wecom').then(function () {
      showToast('回调 Token 和 AESKey 已重新生成', 'success');
    }).catch(function (err) {
      console.error('[Settings] 重新生成企业微信回调配置失败:', err);
      showToast('保存失败: ' + (err.message || '未知错误'), 'error');
    });
  });

  // 企业微信回调地址 — 用户修改时自动保存
  var wecomCallbackUrlInput = document.getElementById('wecomCallbackUrlInput');
  if (wecomCallbackUrlInput) {
    wecomCallbackUrlInput.addEventListener('change', function () {
      if (wecomCallbackUrlInput.value.trim()) {
        // 保存用户输入的回调地址到配置
        console.log('[Settings] 企业微信回调地址已修改: ' + wecomCallbackUrlInput.value);
        // 这里可以添加额外的验证和保存逻辑
        showToast('✓ 回调地址已更新', 'success');
      }
    });
  }

  // 主题下拉即时应用
  settingTheme.addEventListener('change', function () {
    window.XuanjiTheme.save(settingTheme.value);
    window.XuanjiTheme.apply(settingTheme.value);
  });

  // 监听机器人状态（主进程推送）
  window.XuanjiIPC.onBotStatus(function (data) {
    updateBotUI(data.type, data.running);
    // 隐藏日志面板（不再显示）
  });

  // ── 机器人日志 ──────────────────────────────────────────
  // 注：日志面板已从 UI 中移除，仅保留日志收集和处理逻辑供 console 输出

  var botLogGroup = document.getElementById('botLogGroup');
  var botLogArea = botLogGroup ? document.getElementById('botLogArea') : null;
  var MAX_LOG_LINES = 100;

  function appendBotLog(type, message) {
    // 日志输出到 console
    console.log(`[${type}] ${message}`);

    // 企业微信：从日志中提取回调地址，显示在 UI 中
    if (type === 'wecom') {
      // 情况1: 自动获取的回调地址（IP获取成功）
      if (message.includes('回调地址:') && (message.includes('http://') || message.includes('https://'))) {
        console.log('[Settings] 检测到企业微信回调地址日志');
        var match = message.match(/回调地址:\s*(https?:\/\/[^\s]+)/);
        if (match) {
          var callbackUrl = match[1];
          console.log('[Settings] 提取到回调地址: ' + callbackUrl);
          var callbackUrlInput = document.getElementById('wecomCallbackUrlInput');
          if (callbackUrlInput) {
            callbackUrlInput.value = callbackUrl;
            callbackUrlInput.style.color = 'var(--text-primary)';
            console.log('[Settings] 已更新 UI 显示回调地址');
          }
        }
      }

      // 情况2: 无法自动获取IP，提示用户手动输入
      if (message.includes('无法自动获取外网 IP')) {
        console.log('[Settings] 检测到 IP 获取失败提示');
        var callbackUrlInput2 = document.getElementById('wecomCallbackUrlInput');
        if (callbackUrlInput2 && !callbackUrlInput2.value) {
          callbackUrlInput2.placeholder = '无法自动获取IP，请输入外网IP（如: http://123.45.67.89/wecom）';
          callbackUrlInput2.style.color = 'var(--text-muted)';
        }
      }
    }

    // 如果 botLogArea 存在，保存日志供调试
    if (botLogArea) {
      var entry = document.createElement('div');
      entry.className = 'bot-log-entry';

      var now = new Date();
      var timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });

      entry.innerHTML =
        '<span class="log-time">' + timeStr + '</span>' +
        '<span class="log-type">[' + type + ']</span>' +
        message;

      botLogArea.appendChild(entry);

      // 限制日志行数
      while (botLogArea.children.length > MAX_LOG_LINES) {
        botLogArea.removeChild(botLogArea.firstChild);
      }

      // 自动滚动到底部
      botLogArea.scrollTop = botLogArea.scrollHeight;
    }
  }

  window.XuanjiIPC.onBotLog(function (data) {
    appendBotLog(data.type, data.message);
  });

  // 初始加载
  loadSettings();

  // ── 暴露到全局 ────────────────────────────────────────

  window.XuanjiSettings = {
    load: loadSettings,
    save: saveSettings,
    showToast: showToast,
    getModel: function () { return settingModel.value; },
    getSettings: function () {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch (e) {
        return {};
      }
    },
  };
})();
