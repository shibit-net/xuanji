// ============================================================
// M5 权限控制 — 路径模式匹配器
// ============================================================
//
// 轻量级 glob 转正则实现，支持:
//   - ** → 任意层级目录
//   - * → 单层级通配
//   - ? → 单字符通配
//   - 前缀匹配: /home/user/ (末尾斜杠)
//   - 精确匹配: /etc/passwd
//
// 不依赖 minimatch 等外部库。
//

/**
 * 将 glob 模式转换为正则表达式
 */
export function globToRegex(pattern: string): RegExp {
  let regex = '';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // ** → 匹配任意层级（包含 /）
        if (pattern[i + 2] === '/') {
          regex += '(?:.*/)?';
          i += 3;
        } else {
          regex += '.*';
          i += 2;
        }
      } else {
        // * → 匹配单层级（不含 /）
        regex += '[^/]*';
        i += 1;
      }
    } else if (char === '?') {
      regex += '[^/]';
      i += 1;
    } else if (char === '.') {
      regex += '\\.';
      i += 1;
    } else if (char === '/' || char === '-' || char === '_') {
      regex += char;
      i += 1;
    } else if (/[{}()[\]^$+|\\]/.test(char)) {
      // 转义其他正则特殊字符
      regex += '\\' + char;
      i += 1;
    } else {
      regex += char;
      i += 1;
    }
  }

  return new RegExp(`^${regex}$`);
}

/**
 * PathMatcher — 路径模式匹配器
 *
 * 对外提供 matches(path, pattern) 方法，
 * 内部缓存编译后的正则以提升性能。
 */
export class PathMatcher {
  /** 编译后的正则缓存 */
  private cache: Map<string, RegExp> = new Map();
  /** 缓存上限，超出后清空重建 */
  private static readonly MAX_CACHE_SIZE = 500;

  /**
   * 检查路径是否匹配模式
   *
   * @param filePath 待检查的绝对路径
   * @param pattern  匹配模式 (glob / 前缀 / 精确)
   */
  matches(filePath: string, pattern: string): boolean {
    // 前缀匹配: 末尾斜杠表示目录前缀
    if (pattern.endsWith('/')) {
      return filePath.startsWith(pattern) || filePath === pattern.slice(0, -1);
    }

    // 精确匹配: 不含通配符
    if (!pattern.includes('*') && !pattern.includes('?')) {
      return filePath === pattern;
    }

    // Glob 匹配
    let regex = this.cache.get(pattern);
    if (!regex) {
      regex = globToRegex(pattern);
      if (this.cache.size >= PathMatcher.MAX_CACHE_SIZE) {
        this.cache.clear();
      }
      this.cache.set(pattern, regex);
    }
    return regex.test(filePath);
  }

  /**
   * 检查路径是否匹配模式列表中的任意一个
   */
  matchesAny(filePath: string, patterns: string[]): boolean {
    return patterns.some((p) => this.matches(filePath, p));
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }
}
