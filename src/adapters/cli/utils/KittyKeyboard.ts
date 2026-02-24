// ============================================================
// Kitty 键盘协议支持
// ============================================================
//
// 在支持的终端中启用 CSI u 协议，使得 Shift+Enter 等修饰键
// 组合可以被正确识别。
//
// 协议文档: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
//
// 支持的终端: iTerm.app, kitty, WezTerm, ghostty
// 不支持: Apple Terminal, 旧版 Alacritty

/**
 * 支持 Kitty 键盘协议的终端列表
 * 通过 TERM_PROGRAM 环境变量判断
 */
const KITTY_TERMINALS = ['iTerm.app', 'kitty', 'WezTerm', 'ghostty'];

/**
 * CSI u 转义序列
 */
const CSI_PUSH_KEYBOARD = '\x1b[>1u';  // 启用: flags=1 (disambiguate)
const CSI_POP_KEYBOARD = '\x1b[<u';    // 禁用: pop keyboard mode

/**
 * CSI u 序列正则
 * 格式: ESC [ keycode ; modifier u
 * 例如: \x1b[13;2u = Shift+Enter (keycode=13, modifier=2)
 */
const CSI_U_REGEX = /^\x1b\[(\d+)(?:;(\d+))?u$/;

/**
 * 检测当前终端是否支持 Kitty 键盘协议
 */
export function isKittySupported(): boolean {
  const termProgram = process.env.TERM_PROGRAM ?? '';
  return KITTY_TERMINALS.includes(termProgram);
}

/**
 * 启用 Kitty 键盘协议
 * 仅在支持的终端中生效，不支持的终端会忽略该序列
 */
export function enableKittyProtocol(): void {
  if (isKittySupported()) {
    process.stdout.write(CSI_PUSH_KEYBOARD);
  }
}

/**
 * 禁用 Kitty 键盘协议
 */
export function disableKittyProtocol(): void {
  if (isKittySupported()) {
    process.stdout.write(CSI_POP_KEYBOARD);
  }
}

/**
 * CSI u 解析结果
 */
export interface CSIuKeyEvent {
  name: string;
  char?: string;  // 如果是字符按键，存放实际字符
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
}

/**
 * 解码 CSI u modifier 位
 *
 * modifier 值 = bitmask + 1
 * bit 0 = shift (1)
 * bit 1 = alt/meta (2)
 * bit 2 = ctrl (4)
 * bit 3 = super (8, 也视为 meta)
 */
function decodeModifier(modifier: number): { shift: boolean; meta: boolean; ctrl: boolean } {
  const bits = modifier - 1;
  return {
    shift: !!(bits & 1),
    meta: !!(bits & 2) || !!(bits & 8),
    ctrl: !!(bits & 4),
  };
}

/**
 * 将 keycode 映射为键名，或返回对应的字符
 */
function keycodeName(keycode: number): string | { char: string } {
  switch (keycode) {
    case 9: return 'tab';
    case 13: return 'return';
    case 27: return 'escape';
    case 32: return 'space';
    case 127: return 'backspace';
    default:
      // 所有可打印字符（包括中文等 Unicode 字符）
      if (keycode >= 32) {
        return { char: String.fromCodePoint(keycode) };
      }
      return `unknown(${keycode})`;
  }
}

/**
 * 尝试解析 CSI u 序列
 *
 * @param raw 原始输入字符串
 * @returns 解析结果，如果不是 CSI u 序列则返回 null
 *
 * 示例:
 *   "\x1b[13;2u" → { name: "return", shift: true, meta: false, ctrl: false }
 *   "\x1b[13u"   → { name: "return", shift: false, meta: false, ctrl: false }
 */
export function parseCSIu(raw: string): CSIuKeyEvent | null {
  const match = CSI_U_REGEX.exec(raw);
  if (!match) return null;

  const keycode = parseInt(match[1], 10);
  const modifier = match[2] ? parseInt(match[2], 10) : 1;
  const mods = decodeModifier(modifier);
  const nameOrChar = keycodeName(keycode);

  if (typeof nameOrChar === 'object') {
    // 字符按键（包括中文等 Unicode）
    return {
      name: 'char',
      char: nameOrChar.char,
      ...mods,
    };
  }

  return {
    name: nameOrChar,
    ...mods,
  };
}
