import { describe, it, expect } from 'vitest';
import { darkTheme, lightTheme, getTheme } from '@/adapters/cli/Theme';

describe('Theme', () => {
  it('darkTheme 应包含所有必要的颜色', () => {
    expect(darkTheme.primary).toBeTruthy();
    expect(darkTheme.secondary).toBeTruthy();
    expect(darkTheme.success).toBeTruthy();
    expect(darkTheme.warning).toBeTruthy();
    expect(darkTheme.error).toBeTruthy();
    expect(darkTheme.dim).toBeTruthy();
    expect(darkTheme.thinking).toBeTruthy();
    expect(darkTheme.tool).toBeTruthy();
  });

  it('lightTheme 应包含所有必要的颜色', () => {
    expect(lightTheme.primary).toBeTruthy();
    expect(lightTheme.secondary).toBeTruthy();
    expect(lightTheme.success).toBeTruthy();
    expect(lightTheme.warning).toBeTruthy();
    expect(lightTheme.error).toBeTruthy();
    expect(lightTheme.dim).toBeTruthy();
    expect(lightTheme.thinking).toBeTruthy();
    expect(lightTheme.tool).toBeTruthy();
  });

  it('darkTheme 和 lightTheme 应有不同的颜色', () => {
    expect(darkTheme.primary).not.toBe(lightTheme.primary);
  });

  describe('getTheme()', () => {
    it('mode="dark" 应返回暗色主题', () => {
      expect(getTheme('dark')).toBe(darkTheme);
    });

    it('mode="light" 应返回亮色主题', () => {
      expect(getTheme('light')).toBe(lightTheme);
    });

    it('mode="auto" 应返回暗色主题（默认）', () => {
      expect(getTheme('auto')).toBe(darkTheme);
    });

    it('不传参数应返回暗色主题', () => {
      expect(getTheme()).toBe(darkTheme);
    });
  });
});
