// ============================================================
// 消息格式化 — Markdown → HTML 轻量转换
// ============================================================

(function () {
  'use strict';

  /**
   * 转义 HTML 特殊字符
   */
  function escapeHtml(text) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, function (m) { return map[m]; });
  }

  /**
   * 简单 Markdown → HTML 转换
   * 支持: **粗体**, `行内代码`, ```代码块```, 标题, 列表
   */
  function markdownToHtml(text) {
    if (!text) return '';

    var html = escapeHtml(text);

    // 代码块 (```...```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function (_m, lang, code) {
      return '<pre><code class="lang-' + lang + '">' + code.trim() + '</code></pre>';
    });

    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 粗体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // 斜体
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // 标题
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

    // 无序列表项
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');

    // 换行
    html = html.replace(/\n/g, '<br>');

    // 清理连续 <br> 在 <pre> 中
    html = html.replace(/<pre>([\s\S]*?)<\/pre>/g, function (_m, content) {
      return '<pre>' + content.replace(/<br>/g, '\n') + '</pre>';
    });

    return html;
  }

  /**
   * 格式化工具输入参数
   */
  function formatToolInput(input) {
    if (!input || typeof input !== 'object') return '';

    return Object.entries(input)
      .map(function (entry) {
        var k = entry[0], v = entry[1];
        var val = typeof v === 'string'
          ? (v.length > 60 ? v.slice(0, 60) + '...' : v)
          : JSON.stringify(v);
        return k + '=' + val;
      })
      .join(', ');
  }

  /**
   * 截断文本
   */
  function truncate(text, maxLen) {
    maxLen = maxLen || 200;
    if (!text || text.length <= maxLen) return text || '';
    return text.slice(0, maxLen) + '...';
  }

  /**
   * 工具名格式化 + 图标映射
   * @param {string} name - snake_case 工具名
   * @returns {string} 格式化后的名称 + 图标
   */
  function formatToolName(name) {
    // 图标映射表
    var icons = {
      'read_file': '📖',
      'write_file': '📝',
      'edit_file': '✏️',
      'bash': '🐚',
      'grep': '🔍',
      'glob': '🗂️',
    };

    // 转换为友好名称：read_file → Read file
    var displayName = name.replace(/_/g, ' ')
      .replace(/^[a-z]/, function(c) { return c.toUpperCase(); });

    // 添加图标（如果有）
    var icon = icons[name] || '🔧';
    return icon + ' ' + displayName;
  }

  /**
   * 工具指令摘要提取
   * @param {string} name - 工具名
   * @param {object} input - 输入参数
   * @returns {string} 关键参数摘要（最多 80 字符）
   */
  function formatToolCommand(name, input) {
    if (!input) return '';

    // 辅助函数：截断首行
    function truncateFirstLine(s, max) {
      if (!s) return '';
      var firstLine = s.split('\n')[0] || s;
      return firstLine.length > max ? firstLine.slice(0, max) + '...' : firstLine;
    }

    switch (name) {
      case 'read_file':
      case 'write_file':
      case 'edit_file':
        return truncateFirstLine(String(input.path || ''), 80);

      case 'bash':
        return truncateFirstLine(String(input.command || ''), 80);

      default:
        // 通用：取第一个 string 值
        var keys = Object.keys(input);
        if (keys.length === 0) return '';
        var firstVal = input[keys[0]];
        if (typeof firstVal === 'string') {
          return truncateFirstLine(firstVal, 80);
        }
        return truncateFirstLine(JSON.stringify(input), 80);
    }
  }

  /**
   * 耗时格式化
   * @param {number} ms - 毫秒
   * @returns {string} 格式化字符串 "1.2s"
   */
  function formatToolDuration(ms) {
    if (!ms || ms < 0) return '0.00s';
    return (ms / 1000).toFixed(2) + 's';
  }

  /**
   * 工具结果截断（保留多行结构）
   * @param {string} text - 原始结果
   * @param {number} maxLines - 最大行数（默认 10）
   * @returns {string} 截断后的结果
   */
  function formatToolResultPreview(text, maxLines) {
    maxLines = maxLines || 10;
    if (!text) return '';

    var lines = text.split('\n');
    if (lines.length <= maxLines) {
      return text;
    }

    return lines.slice(0, maxLines).join('\n') +
      '\n... (' + (lines.length - maxLines) + ' 行已折叠)';
  }

  /**
   * 文件大小格式化
   * @param {number} bytes - 字节数
   * @returns {string} 格式化字符串 "1.2 KB"
   */
  function formatFileSize(bytes) {
    if (!bytes || bytes < 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /**
   * 计算字符串的 UTF-8 字节数
   * @param {string} str - 输入字符串
   * @returns {number} 字节数
   */
  function byteLength(str) {
    if (!str) return 0;
    // 使用 Blob 计算精确 UTF-8 字节数（浏览器环境）
    if (typeof Blob !== 'undefined') {
      return new Blob([str]).size;
    }
    // 回退：手动计算
    var len = 0;
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code <= 0x7f) len += 1;
      else if (code <= 0x7ff) len += 2;
      else if (code >= 0xd800 && code <= 0xdfff) { len += 4; i++; }
      else len += 3;
    }
    return len;
  }

  // 暴露到全局
  window.XuanjiFormatter = {
    escapeHtml: escapeHtml,
    markdownToHtml: markdownToHtml,
    formatToolInput: formatToolInput,
    truncate: truncate,
    formatToolName: formatToolName,
    formatToolCommand: formatToolCommand,
    formatToolDuration: formatToolDuration,
    formatToolResultPreview: formatToolResultPreview,
    formatFileSize: formatFileSize,
    byteLength: byteLength,
  };
})();
