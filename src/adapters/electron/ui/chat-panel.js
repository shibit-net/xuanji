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

  // 缓冲模式：流式输出过长时停止实时 Markdown 渲染，改为显示行数进度
  var STREAM_BUFFER_THRESHOLD = 50;
  var streamBuffered = false;
  var streamLineCount = 0;

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
      '<div class="message-role">' + window.XuanjiI18n.t('gui.chat.user_role') + '</div>' +
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
      '<div class="message-role">' + window.XuanjiI18n.t('gui.chat.assistant_role') + '</div>' +
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
          '<span class="thinking-block-label">' + window.XuanjiI18n.t('gui.chat.thinking') + '</span>' +
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
    if (labelEl) labelEl.textContent = window.XuanjiI18n.t('gui.chat.thinking_process') + ' (' + countText + ' ' + window.XuanjiI18n.t('gui.chat.thinking_chars', { count: '' }).trim() + ')';

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
   * 当文本行数超过阈值时，进入缓冲模式：停止 Markdown 渲染，仅显示行数进度。
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

    var lines = currentTextBuffer.split('\n');
    if (lines.length > STREAM_BUFFER_THRESHOLD) {
      // 缓冲模式：只更新行数进度，不做 Markdown 渲染
      if (!streamBuffered) {
        streamBuffered = true;
      }
      streamLineCount = lines.length;
      currentAssistantEl.innerHTML =
        '<div class="stream-buffered-progress">' +
          '<span class="thinking-dots"><span></span><span></span><span></span></span> ' +
          window.XuanjiFormatter.escapeHtml(
            window.XuanjiI18n.t('gui.chat.stream_buffered', { lines: String(streamLineCount) })
          ) +
        '</div>';
    } else {
      currentAssistantEl.innerHTML = window.XuanjiFormatter.markdownToHtml(currentTextBuffer);
    }
    scrollToBottom();
  }

  /**
   * 完成当前 assistant 消息
   * 缓冲模式下在此处一次性渲染完整 Markdown。
   */
  function finishAssistantMessage() {
    console.log('[GUI] finishAssistantMessage: 完成 assistant 消息');

    // 结束未完成的思考块
    if (currentThinkingEl) {
      finishThinking();
    }

    // 移除加载气泡（thinking-bubble）
    if (currentAssistantEl && currentAssistantEl.classList.contains('thinking-bubble')) {
      console.log('[GUI] 移除加载气泡');
      currentAssistantEl.classList.remove('thinking-bubble');
      currentAssistantEl.innerHTML = '';
    }

    // 渲染完整 Markdown（包括缓冲模式下的延迟渲染）
    if (currentAssistantEl && currentTextBuffer) {
      console.log('[GUI] 更新 assistant 消息内容' + (streamBuffered ? '（缓冲模式，一次性渲染）' : ''));
      currentAssistantEl.innerHTML = window.XuanjiFormatter.markdownToHtml(currentTextBuffer);
    }

    currentAssistantEl = null;
    currentTextBuffer = '';
    streamBuffered = false;
    streamLineCount = 0;
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
    if (usage.cacheRead) parts.push('⚡' + formatTokenCount(usage.cacheRead) + ' ' + window.XuanjiI18n.t('gui.chat.cache_hit'));
    if (usage.cacheWrite) parts.push('📝' + formatTokenCount(usage.cacheWrite) + ' ' + window.XuanjiI18n.t('gui.chat.cache_write'));
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
   * 添加或更新工具调用开始
   * 注意：onToolStart 会被调用两次:
   *   - 第 1 次: tool_use_start（input 为空 {}）→ 创建 DOM
   *   - 第 2 次: tool_use_end（input 完整）→ 更新已有 DOM 的 input 内容
   */
  function addToolStart(data) {
    // 如果该工具 ID 的 DOM 已存在，说明是第二次调用（更新 input）
    var existing = document.getElementById('tool-' + data.id);
    if (existing) {
      // 更新 tool-input
      var inputEl = existing.querySelector('.tool-input');
      if (inputEl) {
        inputEl.textContent = window.XuanjiFormatter.formatToolInput(data.input);
      }
      // 补建 tool-command（第一次调用时 input 为空，此元素未创建）
      var command = window.XuanjiFormatter.formatToolCommand(data.name, data.input);
      var headerEl = existing.querySelector('.tool-header');
      var durationEl = headerEl ? headerEl.querySelector('.tool-duration, .tool-duration-text') : null;
      if (command) {
        var existingCmd = existing.querySelector('.tool-command');
        if (existingCmd) {
          existingCmd.textContent = command;
        } else {
          var cmdSpan = document.createElement('span');
          cmdSpan.className = 'tool-command';
          cmdSpan.textContent = command;
          if (durationEl) {
            headerEl.insertBefore(cmdSpan, durationEl);
          } else if (headerEl) {
            headerEl.appendChild(cmdSpan);
          }
        }
      }
      // write_file: 显示写入文件大小
      if (data.name === 'write_file' && data.input && data.input.content) {
        var bytes = window.XuanjiFormatter.byteLength(String(data.input.content));
        var sizeTag = document.createElement('span');
        sizeTag.className = 'tool-meta';
        sizeTag.textContent = window.XuanjiFormatter.formatFileSize(bytes);
        // 重新查询 durationEl，因为前面 insertBefore 可能改变了 DOM
        durationEl = headerEl ? headerEl.querySelector('.tool-duration, .tool-duration-text') : null;
        if (durationEl) {
          headerEl.insertBefore(sizeTag, durationEl);
        } else if (headerEl) {
          headerEl.appendChild(sizeTag);
        }
      }
      scrollToBottom();
      return existing.id;
    }

    // 格式化工具名和指令
    var displayName = window.XuanjiFormatter.formatToolName(data.name);
    var command = window.XuanjiFormatter.formatToolCommand(data.name, data.input);

    // 首次调用：创建新 DOM
    clearWelcome();
    var el = document.createElement('div');
    el.className = 'tool-call';
    el.id = 'tool-' + data.id;
    el.setAttribute('data-tool-id', data.id);
    el.innerHTML =
      '<div class="tool-header">' +
        '<span class="tool-name">' + window.XuanjiFormatter.escapeHtml(displayName) + '</span>' +
        (command ? '<span class="tool-command">' + window.XuanjiFormatter.escapeHtml(command) + '</span>' : '') +
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

    // 1. 更新状态图标（添加到工具名后）
    var nameEl = el.querySelector('.tool-name');
    if (nameEl) {
      var icon = data.isError ? ' ❌' : ' ✅';
      nameEl.innerHTML += icon;
    }

    // 2. 替换思考动画为耗时
    var durationEl = el.querySelector('.tool-duration');
    if (durationEl) {
      durationEl.className = 'tool-duration-text';
      durationEl.textContent = window.XuanjiFormatter.formatToolDuration(data.duration);
    }

    // 3. 添加状态 class
    el.classList.add(data.isError ? 'tool-error' : 'tool-success');

    // 4. 渲染结果（折叠状态：默认仅展示 1 行）
    if (data.result) {
      var resultContainer = document.createElement('div');
      resultContainer.className = 'tool-result collapsed';

      // 截断预览：仅保留首行
      var preview = window.XuanjiFormatter.formatToolResultPreview(data.result, 1);
      var resultContent = document.createElement('div');
      resultContent.className = 'tool-result-content';
      resultContent.innerHTML = window.XuanjiFormatter.markdownToHtml(preview);
      resultContainer.appendChild(resultContent);

      // 如果超过 1 行，添加展开按钮
      var lines = data.result.split('\n');
      if (lines.length > 1) {
        var toggleBtn = document.createElement('button');
        toggleBtn.className = 'tool-result-toggle';
        toggleBtn.textContent = '▼ 展开全部 (' + lines.length + ' 行)';
        toggleBtn.onclick = function() {
          var isCollapsed = resultContainer.classList.contains('collapsed');
          if (isCollapsed) {
            // 展开：渲染完整结果
            resultContent.innerHTML = window.XuanjiFormatter.markdownToHtml(data.result);
            resultContainer.classList.remove('collapsed');
            toggleBtn.textContent = '▲ 收起';
          } else {
            // 折叠：恢复预览
            resultContent.innerHTML = window.XuanjiFormatter.markdownToHtml(preview);
            resultContainer.classList.add('collapsed');
            toggleBtn.textContent = '▼ 展开全部 (' + lines.length + ' 行)';
          }
        };
        resultContainer.appendChild(toggleBtn);
      }

      el.appendChild(resultContainer);
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
   * 在当前助手气泡内显示错误信息（而不是创建新的错误气泡）
   */
  function showErrorInBubble(error) {
    // 如果没有当前的助手消息气泡，创建一个
    if (!currentAssistantMsg) {
      startAssistantMessage();
    }

    // 在气泡内显示错误信息
    if (currentAssistantEl) {
      // 移除加载动画
      if (currentAssistantEl.classList.contains('thinking-bubble')) {
        currentAssistantEl.classList.remove('thinking-bubble');
      }

      // 显示错误信息
      currentAssistantEl.innerHTML =
        '<div style="color: #e74c3c; padding: 12px; line-height: 1.6;">' +
        '❌ ' +
        error +
        '</div>';
    }

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
    console.log('[GUI] setRunningState:', running);
    isRunning = running;
    inputText.disabled = running;
    statusIndicator.classList.toggle('active', running);
    console.log('[GUI] statusIndicator.classList:', statusIndicator.className);

    // 切换按钮图标和样式
    sendIcon.classList.toggle('hidden', running);
    stopIcon.classList.toggle('hidden', !running);
    sendBtn.classList.toggle('send-btn', !running);
    sendBtn.classList.toggle('stop-btn', running);
    sendBtn.title = running ? '停止' : '发送';

    if (!running) {
      setStatusState('');
      inputText.focus();
      console.log('[GUI] 已清除运行状态');
    }
  }

  // ── 发送逻辑 ──────────────────────────────────────────

  var currentRunId = 0;  // 用于追踪当前对话的 ID
  var lastRunId = -1;    // 上一次处理的运行 ID

  async function sendMessage() {
    var text = inputText.value.trim();
    if (!text || isRunning) return;

    console.log('[GUI] sendMessage: 开始发送消息', text);

    // 生成新的运行 ID
    currentRunId++;
    var thisRunId = currentRunId;

    // 显示用户消息
    addUserMessage(text);
    inputText.value = '';
    autoResizeInput();

    // 开始运行
    setRunningState(true);
    setStatusState(window.XuanjiI18n.t('gui.chat.thinking'));
    startAssistantMessage();

    try {
      console.log('[GUI] sendMessage: 调用 IPC chat.run()...');
      var result = await window.XuanjiIPC.chat.run(text);
      console.log('[GUI] sendMessage: IPC 返回', result);

      // 只处理当前运行的结果
      if (thisRunId !== currentRunId) {
        console.log('[GUI] sendMessage: 忽略过期的返回结果（当前运行 ID:', currentRunId, '，此结果 ID:', thisRunId, '）');
        return;
      }

      if (!result.success) {
        console.error('[GUI] sendMessage: 返回失败', result.error);
        // 注意：onError 回调已经调用了 addErrorMessage()，不要重复调用

        // 如果 onEnd 还没有被调用，手动清除状态
        if (thisRunId === currentRunId && lastRunId !== thisRunId) {
          console.log('[GUI] sendMessage: 手动调用 setRunningState(false)');
          setRunningState(false);
        }
      }
      // 注意：成功时，onEnd 回调会处理 setRunningState(false)
    } catch (err) {
      // 如果 IPC 调用本身出现异常（极少见）
      console.error('[GUI] sendMessage 异常:', err);
      // onError 已经添加过错误消息了，这里只记录日志

      if (thisRunId === currentRunId) {
        setRunningState(false);
      }
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
    setStatusState(window.XuanjiI18n.t('gui.chat.deep_thinking'));
    appendThinking(text);
  });

  // 流式文本
  window.XuanjiIPC.onText(function (text) {
    setStatusState(window.XuanjiI18n.t('gui.chat.outputting'));
    appendText(text);
  });

  // 工具开始
  window.XuanjiIPC.onToolStart(function (data) {
    setStatusState(window.XuanjiI18n.t('gui.chat.calling_tool', { name: data.name }));
    // 检查是否是同一工具的第二次调用（input 更新）
    var existing = document.getElementById('tool-' + data.id);
    if (!existing) {
      // 首次工具调用：先完成当前文本流
      if (currentTextBuffer) {
        finishAssistantMessage();
      }
    }
    addToolStart(data);
  });

  // 工具 input 流式接收进度（实时更新写入大小等）
  window.XuanjiIPC.onToolDelta(function (data) {
    var el = document.getElementById('tool-' + data.id);
    if (!el) return;
    var headerEl = el.querySelector('.tool-header');
    if (!headerEl) return;
    var metaEl = el.querySelector('.tool-meta');
    if (!metaEl) {
      metaEl = document.createElement('span');
      metaEl.className = 'tool-meta';
      var durationEl = headerEl.querySelector('.tool-duration, .tool-duration-text');
      if (durationEl) {
        headerEl.insertBefore(metaEl, durationEl);
      } else {
        headerEl.appendChild(metaEl);
      }
    }
    metaEl.textContent = window.XuanjiFormatter.formatFileSize(data.receivedBytes);
  });

  // 工具结束
  window.XuanjiIPC.onToolEnd(function (data) {
    setStatusState(window.XuanjiI18n.t('gui.chat.thinking'));
    updateToolEnd(data);
  });

  // Token 用量（每轮可能多次触发，累计记录）
  window.XuanjiIPC.onUsage(function (usage) {
    turnTokenUsage = usage;
    updateStatus({ tokenUsage: usage });
  });

  // 错误
  window.XuanjiIPC.onError(function (error) {
    console.log('[GUI] onError 回调触发，当前运行 ID:', currentRunId, '错误:', error);
    // 只处理当前运行的错误
    if (currentRunId !== lastRunId) {
      showErrorInBubble(error);
    } else {
      console.log('[GUI] onError: 忽略过期的错误事件');
    }
  });

  // 结束
  window.XuanjiIPC.onEnd(function (data) {
    console.log('[GUI] onEnd 回调触发，当前运行 ID:', currentRunId, '上次处理 ID:', lastRunId, '数据:', data);

    // 只处理最新的运行结果
    if (currentRunId === lastRunId) {
      console.log('[GUI] onEnd: 忽略重复的结束事件');
      return;
    }

    lastRunId = currentRunId;

    finishAssistantMessage();
    // 追加本轮 token 用量到消息下方
    var usage = (data && data.tokenUsage) || turnTokenUsage;
    appendTurnUsage(usage);
    currentAssistantMsg = null;
    console.log('[GUI] onEnd: 调用 setRunningState(false)');
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
