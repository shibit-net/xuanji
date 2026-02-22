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

  // 暴露到全局
  window.XuanjiFormatter = {
    escapeHtml: escapeHtml,
    markdownToHtml: markdownToHtml,
    formatToolInput: formatToolInput,
    truncate: truncate,
  };
})();
