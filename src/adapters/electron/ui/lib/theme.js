// ============================================================
// 主题管理 — 深色/浅色/自动切换
// ============================================================

(function () {
  'use strict';

  const STORAGE_KEY = 'xuanji-theme';

  /**
   * 获取系统偏好主题
   */
  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  /**
   * 应用主题
   */
  function applyTheme(theme) {
    const resolved = theme === 'auto' ? getSystemTheme() : theme;
    document.documentElement.setAttribute('data-theme', resolved);

    // 更新图标显示
    const moonIcon = document.querySelector('.icon-moon');
    const sunIcon = document.querySelector('.icon-sun');
    if (moonIcon && sunIcon) {
      moonIcon.style.display = resolved === 'dark' ? 'inline' : 'none';
      sunIcon.style.display = resolved === 'light' ? 'inline' : 'none';
    }
  }

  /**
   * 获取当前保存的主题
   */
  function getSavedTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'dark';
  }

  /**
   * 保存主题
   */
  function saveTheme(theme) {
    localStorage.setItem(STORAGE_KEY, theme);
  }

  /**
   * 切换主题 (dark → light → dark)
   */
  function toggleTheme() {
    const current = getSavedTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    saveTheme(next);
    applyTheme(next);
    return next;
  }

  // 初始化
  applyTheme(getSavedTheme());

  // 监听系统主题变化 (auto 模式下生效)
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
    if (getSavedTheme() === 'auto') {
      applyTheme('auto');
    }
  });

  // 暴露到全局
  window.XuanjiTheme = {
    apply: applyTheme,
    toggle: toggleTheme,
    get: getSavedTheme,
    save: saveTheme,
  };
})();
