/**
 * 共享停用词表
 *
 * 中英文停用词，用于记忆检索、关键词提取等场景。
 * 避免在多个模块中重复定义。
 */

/** 英文停用词 */
export const STOP_WORDS_EN = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'out', 'off', 'over', 'under',
  'again', 'further', 'then', 'once',
  'and', 'or', 'but', 'if', 'not', 'no', 'so', 'than', 'too', 'very', 'just',
  'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their',
  'what', 'which', 'who', 'how', 'when', 'where', 'why',
  'here', 'there',
  'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'only', 'own', 'same',
  'because', 'while',
]);

/** 中文停用词 */
export const STOP_WORDS_ZH = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '他', '她', '它', '们', '那', '些', '什么', '怎么', '为什么',
  '可以', '已经', '这个', '那个', '还是', '但是', '所以', '如果', '因为',
]);

/** 合并的中英文停用词（用于同时需要过滤两种语言的场景） */
export const STOP_WORDS = new Set([...STOP_WORDS_EN, ...STOP_WORDS_ZH]);

/**
 * 过滤停用词
 * @param words 待过滤的词列表
 * @param minLength 最小词长度（默认 2）
 * @returns 过滤后的词列表
 */
export function filterStopWords(words: string[], minLength = 2): string[] {
  return words.filter((w) => w.length >= minLength && !STOP_WORDS.has(w));
}
