// ============================================================
// 日志面板 — 显示主进程和机器人日志
// ============================================================

(function () {
  'use strict';

  var logsContainer = document.getElementById('logsContainer');
  var clearLogsBtn = document.getElementById('clearLogsBtn');
  var pauseLogsBtn = document.getElementById('pauseLogsBtn');
  var MAX_LOG_LINES = 1000;
  var paused = false;

  // ── 日志收集 ──────────────────────────────────────────

  var allLogs = [];

  /**
   * 添加日志条目
   */
  function addLog(source, message, level, timestamp) {
    var entry = {
      source: source,
      message: message,
      level: level || 'info',
      timestamp: timestamp || new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    };

    // 新日志插入到数组头部（倒序）
    allLogs.unshift(entry);

    // 限制日志数量（删除尾部旧日志）
    if (allLogs.length > MAX_LOG_LINES) {
      allLogs.pop();
    }

    // 如果未暂停，显示日志
    if (!paused) {
      displayLog(entry);
    }
  }

  /**
   * 显示单条日志（插入到容器顶部）
   */
  function displayLog(entry) {
    var el = createLogElement(entry);

    // 新日志插入到顶部
    if (logsContainer.firstChild) {
      logsContainer.insertBefore(el, logsContainer.firstChild);
    } else {
      logsContainer.appendChild(el);
    }

    // 限制 DOM 节点数量（删除底部旧节点）
    while (logsContainer.children.length > MAX_LOG_LINES) {
      logsContainer.removeChild(logsContainer.lastChild);
    }
  }

  /**
   * 转义 HTML
   */
  function escapeHtml(text) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, function (m) { return map[m]; });
  }

  /**
   * 清空日志
   */
  function clearLogs() {
    logsContainer.innerHTML = '';
    allLogs = [];
  }

  /**
   * 暂停/恢复日志
   */
  function togglePauseLogs() {
    paused = !paused;
    pauseLogsBtn.textContent = paused ? '▶️ 恢复' : '⏸️ 暂停';
    pauseLogsBtn.title = paused ? '恢复日志滚动' : '暂停日志滚动';
  }

  // ── 事件监听 ──────────────────────────────────────────

  // 加载历史日志（从文件恢复）
  function loadHistoryLogs() {
    window.XuanjiIPC.loadLogs({ maxLines: 500, days: 3 }).then(function (result) {
      if (!result || !result.success || !result.logs || result.logs.length === 0) {
        return;
      }

      // result.logs 已按时间倒序排列（最新在前）
      var logs = result.logs;

      // 批量添加到 allLogs 数组（不触发 DOM 渲染，一次性渲染）
      for (var i = 0; i < logs.length; i++) {
        allLogs.push(logs[i]);
      }

      // 限制总数
      if (allLogs.length > MAX_LOG_LINES) {
        allLogs.length = MAX_LOG_LINES;
      }

      // 一次性渲染到 DOM
      if (!paused) {
        var fragment = document.createDocumentFragment();
        for (var j = 0; j < allLogs.length; j++) {
          var entry = allLogs[j];
          var el = createLogElement(entry);
          fragment.appendChild(el);
        }
        logsContainer.innerHTML = '';
        logsContainer.appendChild(fragment);
      }

      console.log('[Logs] 已加载 ' + logs.length + ' 条历史日志');
    }).catch(function (err) {
      console.error('[Logs] 加载历史日志失败:', err);
    });
  }

  /**
   * 创建日志 DOM 元素
   */
  function createLogElement(entry) {
    var el = document.createElement('div');
    el.className = 'log-entry log-' + entry.level;

    // 获取图标
    var icon = getLogIcon(entry.source);

    el.innerHTML =
      '<span class="log-time">' + entry.timestamp + '</span>' +
      '<span class="log-icon">' + icon + '</span>' +
      '<span class="log-source">[' + entry.source + ']</span>' +
      '<span class="log-message">' + escapeHtml(entry.message) + '</span>';

    return el;
  }

  /**
   * 获取日志源图标
   */
  function getLogIcon(source) {
    switch (source) {
      case 'Chat': return '💬';
      case 'Bot': return '🤖';
      case 'Config': return '⚙️';
      case 'Window': return '🪟';
      case 'Electron': return '⚡';
      default: return '📋';
    }
  }

  // 启动时加载历史日志
  loadHistoryLogs();

  // 主进程日志
  window.XuanjiIPC.onMainLog(function (data) {
    addLog(data.source, data.message, data.level, data.timestamp);
  });

  // 机器人日志
  window.XuanjiIPC.onBotLog(function (data) {
    addLog(data.type || 'Bot', data.message, 'info', data.timestamp);
  });

  // 按钮事件
  clearLogsBtn.addEventListener('click', function () {
    clearLogs();
  });

  pauseLogsBtn.addEventListener('click', function () {
    togglePauseLogs();
  });

  // 导出到全局
  window.XuanjiLogs = {
    addLog: addLog,
    clearLogs: clearLogs,
    getLogs: function () { return allLogs; },
  };

  console.log('[Logs] 日志面板已初始化');
})();
