// ============================================================
// 对话面板 — 消息列表 + 流式显示 + 工具调用展示
// ============================================================

(function () {
  'use strict';

  var messageList = document.getElementById('messageList');
  var inputText = document.getElementById('inputText');
  var sendBtn = document.getElementById('sendBtn');
  var sendIcon = document.getElementById('sendIcon');
  var stopIcon = document.getElementById('stopIcon');
  var resetBtn = document.getElementById('resetBtn');
  var statusModel = document.getElementById('statusModel');
  var statusTokens = document.getElementById('statusTokens');
  var statusIndicator = document.getElementById('statusIndicator');
  var statusState = document.getElementById('statusState');

  var isRunning = false;
  var currentAssistantEl = null;  // 当前正在流式输出的 assistant 消息 .message-body
  var currentAssistantMsg = null; // 当前轮次的 assistant .message 容器
  var currentTextBuffer = '';     // 当前流式文本缓冲
  var turnTokenUsage = null;     // 当前轮次累计 token 用量
  var currentThinkingEl = null;  // 当前思考块元素
  var currentThinkingBuffer = ''; // 当前思考文本缓冲

  var STATE_DOTS = '<span class="state-dots"><span></span><span></span><span></span></span>';

  /**
   * 更新状态栏的运行状态文字
   */
  function setStatusState(text) {
    if (!statusState) return;
    if (text) {
      statusState.innerHTML = STATE_DOTS + ' ' + text;
    } else {
      statusState.innerHTML = '';
    }
  }

  // ── 消息渲染 ──────────────────────────────────────────

  /**
   * 清除欢迎消息
   */
  function clearWelcome() {
    var welcome = messageList.querySelector('.welcome');
    if (welcome) welcome.remove();
  }

  /**
   * 添加用户消息
   */
  function addUserMessage(text) {
    clearWelcome();
    var el = document.createElement('div');
    el.className = 'message message-user';
    el.innerHTML =
      '<div class="message-role">你</div>' +
      '<div class="message-body">' + window.XuanjiFormatter.escapeHtml(text) + '</div>';
    messageList.appendChild(el);
    scrollToBottom();
  }

  /**
   * 开始 assistant 流式消息（带思考动画）
   */
  function startAssistantMessage() {
    clearWelcome();
    var el = document.createElement('div');
    el.className = 'message message-assistant';
    el.innerHTML =
      '<div class="message-role">璇玑</div>' +
      '<div class="message-body thinking-bubble">' +
        '<div class="thinking-indicator">' +
          '<span></span><span></span><span></span>' +
        '</div>' +
      '</div>';
    messageList.appendChild(el);
    currentAssistantEl = el.querySelector('.message-body');
    currentAssistantMsg = el;
    currentTextBuffer = '';
    turnTokenUsage = null;
    scrollToBottom();
    return el;
  }

  /**
   * 追加思考内容（流式）
   */
  function appendThinking(text) {
    if (!currentAssistantMsg) {
      startAssistantMessage();
    }
    // 移除思考气泡动画（如果还在）
    if (currentAssistantEl && currentAssistantEl.classList.contains('thinking-bubble')) {
      currentAssistantEl.classList.remove('thinking-bubble');
      currentAssistantEl.innerHTML = '';
    }

    // 首次收到思考内容时创建思考块
    if (!currentThinkingEl) {
      currentThinkingEl = document.createElement('div');
      currentThinkingEl.className = 'thinking-block open';
      currentThinkingEl.innerHTML =
        '<div class="thinking-block-header">' +
          '<span class="thinking-block-icon">💭</span>' +
          '<span class="thinking-block-label">思考中</span>' +
          '<span class="thinking-block-dots"><span></span><span></span><span></span></span>' +
        '</div>' +
        '<div class="thinking-block-body"></div>';
      // 插入到 message-body 之前
      currentAssistantMsg.insertBefore(currentThinkingEl, currentAssistantEl);
      currentThinkingBuffer = '';
    }

    currentThinkingBuffer += text;
    var bodyEl = currentThinkingEl.querySelector('.thinking-block-body');
    if (bodyEl) {
      bodyEl.textContent = currentThinkingBuffer;
    }
    scrollToBottom();
  }

  /**
   * 完成思考（折叠）
   */
  function finishThinking() {
    if (!currentThinkingEl) return;

    // 移除动画点，添加字数统计
    var dotsEl = currentThinkingEl.querySelector('.thinking-block-dots');
    if (dotsEl) dotsEl.remove();

    var labelEl = currentThinkingEl.querySelector('.thinking-block-label');
    var charCount = currentThinkingBuffer.length;
    var countText = charCount > 1000 ? (charCount / 1000).toFixed(1) + 'k' : String(charCount);
    if (labelEl) labelEl.textContent = '思考过程 (' + countText + ' 字)';

    // 折叠
    currentThinkingEl.classList.remove('open');

    // 点击 header 切换展开/折叠
    var headerEl = currentThinkingEl.querySelector('.thinking-block-header');
    if (headerEl) {
      headerEl.style.cursor = 'pointer';
      headerEl.addEventListener('click', function () {
        currentThinkingEl.classList.toggle('open');
        scrollToBottom();
      });
    }

    currentThinkingEl = null;
    currentThinkingBuffer = '';
  }

  /**
   * 追加流式文本到当前 assistant 消息
   */
  function appendText(text) {
    if (!currentAssistantEl) {
      startAssistantMessage();
    }
    // 首次收到文本时：移除思考动画 + 折叠思考块
    if (currentAssistantEl.classList.contains('thinking-bubble')) {
      currentAssistantEl.classList.remove('thinking-bubble');
    }
    if (currentThinkingEl) {
      finishThinking();
    }
    currentTextBuffer += text;
    currentAssistantEl.innerHTML = window.XuanjiFormatter.markdownToHtml(currentTextBuffer);
    scrollToBottom();
  }

  /**
   * 完成当前 assistant 消息
   */
  function finishAssistantMessage() {
    // 结束未完成的思考块
    if (currentThinkingEl) {
      finishThinking();
    }
    if (currentAssistantEl && currentTextBuffer) {
      currentAssistantEl.innerHTML = window.XuanjiFormatter.markdownToHtml(currentTextBuffer);
    }
    currentAssistantEl = null;
    currentTextBuffer = '';
    scrollToBottom();
  }

  /**
   * 在当前轮次结束后追加 token 用量标签
   */
  function appendTurnUsage(usage) {
    if (!usage) return;
    // 找到最后一个 assistant 消息容器
    var target = currentAssistantMsg;
    if (!target) {
      var msgs = messageList.querySelectorAll('.message-assistant');
      target = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    }
    if (!target) return;

    var el = document.createElement('div');
    el.className = 'message-usage';
    var parts = [];
    parts.push('↑' + formatTokenCount(usage.input));
    parts.push('↓' + formatTokenCount(usage.output));
    if (usage.cacheRead) parts.push('⚡' + formatTokenCount(usage.cacheRead) + ' 缓存命中');
    if (usage.cacheWrite) parts.push('📝' + formatTokenCount(usage.cacheWrite) + ' 缓存写入');
    el.textContent = parts.join('  ');
    target.appendChild(el);
    scrollToBottom();
  }

  /**
   * 格式化 token 数量（>1000 用 k 表示）
   */
  function formatTokenCount(n) {
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  /**
   * 添加工具调用开始
   */
  function addToolStart(data) {
    clearWelcome();
    var el = document.createElement('div');
    el.className = 'tool-call';
    el.id = 'tool-' + data.id;  // 使用工具 ID 而不是时间戳
    el.setAttribute('data-tool-id', data.id);  // 保存工具 ID 到 data 属性
    el.innerHTML =
      '<div class="tool-header">' +
        '<span class="tool-icon">&#9881;</span>' +
        '<span class="tool-name">' + window.XuanjiFormatter.escapeHtml(data.name) + '</span>' +
        '<span class="tool-duration thinking"><span class="thinking-dots"><span></span><span></span><span></span></span></span>' +
      '</div>' +
      '<div class="tool-input">' + window.XuanjiFormatter.escapeHtml(window.XuanjiFormatter.formatToolInput(data.input)) + '</div>';
    messageList.appendChild(el);
    scrollToBottom();
    return el.id;
  }

  /**
   * 更新工具调用结束
   */
  function updateToolEnd(data) {
    // 根据工具 ID 找到对应的 DOM 元素
    var el = document.getElementById('tool-' + data.id);

    if (!el) return;

    // 更新图标和状态
    var icon = data.isError ? '&#10060;' : '&#9989;';
    var iconEl = el.querySelector('.tool-icon');
    if (iconEl) iconEl.innerHTML = icon;

    // 移除思考动画，添加耗时
    var durationEl = el.querySelector('.tool-duration');
    if (durationEl) durationEl.remove();

    // 添加类
    el.classList.add(data.isError ? 'tool-error' : 'tool-success');

    // 添加结果（截断长内容）
    if (data.result) {
      var resultEl = document.createElement('div');
      resultEl.className = 'tool-result';
      resultEl.textContent = window.XuanjiFormatter.truncate(data.result, 500);
      el.appendChild(resultEl);
    }

    scrollToBottom();
  }

  /**
   * 添加错误消息
   */
  function addErrorMessage(error) {
    var el = document.createElement('div');
    el.className = 'error-message';
    el.textContent = '❌ ' + error;
    messageList.appendChild(el);
    scrollToBottom();
  }

  /**
   * 清空所有消息
   */
  function clearMessages() {
    messageList.innerHTML =
      '<div class="welcome">' +
        '<div class="welcome-icon">&#10022;</div>' +
        '<h2>璇玑 Xuanji</h2>' +
        '<p>AI 助手 — 输入问题开始对话</p>' +
      '</div>';
  }

  /**
   * 滚动到底部
   */
  function scrollToBottom() {
    requestAnimationFrame(function () {
      messageList.scrollTop = messageList.scrollHeight;
    });
  }

  // ── 状态更新 ──────────────────────────────────────────

  function updateStatus(data) {
    if (data.model) statusModel.textContent = '模型: ' + data.model;
    if (data.tokenUsage) {
      statusTokens.textContent = 'Token: ' + data.tokenUsage.input + ' / ' + data.tokenUsage.output;
    }
  }

  function setRunningState(running) {
    isRunning = running;
    inputText.disabled = running;
    statusIndicator.classList.toggle('active', running);

    // 切换按钮图标和样式
    sendIcon.classList.toggle('hidden', running);
    stopIcon.classList.toggle('hidden', !running);
    sendBtn.classList.toggle('send-btn', !running);
    sendBtn.classList.toggle('stop-btn', running);
    sendBtn.title = running ? '停止' : '发送';

    if (!running) {
      setStatusState('');
      inputText.focus();
    }
  }

  // ── 发送逻辑 ──────────────────────────────────────────

  async function sendMessage() {
    var text = inputText.value.trim();
    if (!text || isRunning) return;

    // 显示用户消息
    addUserMessage(text);
    inputText.value = '';
    autoResizeInput();

    // 开始运行
    setRunningState(true);
    setStatusState('思考中');
    startAssistantMessage();

    var result = await window.XuanjiIPC.chat.run(text);
    if (!result.success) {
      addErrorMessage(result.error || '发送失败');
      setRunningState(false);
    }
  }

  // ── 输入框自动调整高度 ────────────────────────────────

  function autoResizeInput() {
    inputText.style.height = 'auto';
    inputText.style.height = Math.min(inputText.scrollHeight, 120) + 'px';
  }

  // ── 事件绑定 ──────────────────────────────────────────

  // 追踪输入法状态
  var isComposing = false;

  inputText.addEventListener('compositionstart', function (e) {
    isComposing = true;
  });

  inputText.addEventListener('compositionend', function (e) {
    isComposing = false;
  });

  // 发送/停止按钮（合一）
  sendBtn.addEventListener('click', function () {
    if (isRunning) {
      window.XuanjiIPC.chat.stop();
    } else {
      sendMessage();
    }
  });

  // 重置按钮
  resetBtn.addEventListener('click', async function () {
    await window.XuanjiIPC.chat.reset();
    clearMessages();
    updateStatus({ tokenUsage: { input: 0, output: 0 }, cost: 0 });
  });

  // Enter 发送, Shift+Enter 换行
  // 修复：检查输入法状态，IME 输入中不执行发送
  inputText.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  // 自动调整高度
  inputText.addEventListener('input', autoResizeInput);

  // ── IPC 事件监听 ──────────────────────────────────────

  // 思考内容
  window.XuanjiIPC.onThinking(function (text) {
    setStatusState('深度思考');
    appendThinking(text);
  });

  // 流式文本
  window.XuanjiIPC.onText(function (text) {
    setStatusState('输出中');
    appendText(text);
  });

  // 工具开始
  window.XuanjiIPC.onToolStart(function (data) {
    setStatusState('调用 ' + data.name);
    // 先完成当前文本流
    if (currentTextBuffer) {
      finishAssistantMessage();
    }
    addToolStart(data);
  });

  // 工具结束
  window.XuanjiIPC.onToolEnd(function (data) {
    setStatusState('思考中');
    updateToolEnd(data);
  });

  // Token 用量（每轮可能多次触发，累计记录）
  window.XuanjiIPC.onUsage(function (usage) {
    turnTokenUsage = usage;
    updateStatus({ tokenUsage: usage });
  });

  // 错误
  window.XuanjiIPC.onError(function (error) {
    addErrorMessage(error);
  });

  // 结束
  window.XuanjiIPC.onEnd(function (data) {
    finishAssistantMessage();
    // 追加本轮 token 用量到消息下方
    var usage = (data && data.tokenUsage) || turnTokenUsage;
    appendTurnUsage(usage);
    currentAssistantMsg = null;
    setRunningState(false);
    updateStatus(data);
  });

  // ── 暴露到全局（供 app.js 使用） ─────────────────────

  window.XuanjiChat = {
    clearMessages: clearMessages,
    updateStatus: updateStatus,
    setRunningState: setRunningState,
    addErrorMessage: addErrorMessage,
  };
})();
