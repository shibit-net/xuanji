// ============================================================
// i18n — 模块化国际化系统
// ============================================================
//
// 将原来单一的 messages.ts 拆分为多个模块:
// - locales/zh_common.ts — 中文通用
// - locales/en_common.ts — 英文通用
// - locales/zh_settings.ts — 中文设置
// - locales/en_settings.ts — 英文设置
// - locales/zh_session.ts — 中文会话
// - locales/en_session.ts — 英文会话
//
// 优点:
// 1. 更好的维护性 — 按功能模块组织
// 2. 更快的加载速度 — 支持懒加载
// 3. 更容易扩展 — 添加新语言只需新增文件

import { zh_common } from './locales/zh_common';
import { en_common } from './locales/en_common';
import { zh_settings } from './locales/zh_settings';
import { en_settings } from './locales/en_settings';

export type Language = 'zh' | 'en';

export interface Messages {
  [key: string]: string;
}

/**
 * 合并所有模块的翻译
 */
const zh: Messages = {
  ...zh_common,
  ...zh_settings,
  // TODO: 添加更多模块
};

const en: Messages = {
  ...en_common,
  ...en_settings,
  // TODO: 添加更多模块
};

/**
 * 所有语言的翻译映射
 */
export const allMessages: Record<Language, Messages> = {
  zh,
  en,
};

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

/**
 * 获取所有支持的语言
 */
export function getSupportedLanguages(): Language[] {
  return ['zh', 'en'];
}

/**
 * 检查某个 key 是否存在翻译
 */
export function hasTranslation(key: string, lang?: Language): boolean {
  const targetLang = lang || currentLang;
  return key in (allMessages[targetLang] || {});
}
