// ============================================================
// i18n — 国际化核心模块
// ============================================================

import { allMessages, type Language } from './messages';

export type { Language } from './messages';

/**
 * 当前语言
 */
let currentLang: Language = 'en';

/**
 * 获取翻译文本
 *
 * 支持占位符替换: t('key', { name: 'value' }) → "hello value"
 * 占位符格式: {name}
 *
 * @param key 消息键
 * @param params 占位符参数
 * @returns 翻译后的文本，未找到时返回 key 本身
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let text = allMessages[currentLang]?.[key] ?? allMessages['en']?.[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return text;
}

/**
 * 设置当前语言
 */
export function setLanguage(lang: Language): void {
  if (lang === 'zh' || lang === 'en') {
    currentLang = lang;
  }
}

/**
 * 获取当前语言
 */
export function getLanguage(): Language {
  return currentLang;
}
