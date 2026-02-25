/**
 * ============================================================
 * Built-in Prompt Skill: Project Rules
 * ============================================================
 * 注入项目特定的上下文和规则到 system prompt。
 *
 * 扫描项目类型 → 加载 XUANJI.md / .xuanji/rules.md → 组装上下文字符串
 */

import type { Skill } from '../../types';
import { ProjectScanner } from '@/context/ProjectScanner';
import { RulesLoader } from '@/context/RulesLoader';
import { ContextBuilder } from '@/context/ContextBuilder';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'project-rules' });

export const projectRulesSkill: Skill<string> = {
  id: 'project-rules',
  name: 'Project Rules',
  version: '1.0.0',
  description: '注入项目特定的上下文和规则',
  category: 'prompt',
  tags: ['context', 'rules', 'project'],
  author: 'Shibit Team',
  createdAt: new Date('2025-02-26'),

  dependencies: [],
  conflicts: [],
  enabled: true,
  priority: 90, // 低于 xuanji-assistant (100)

  render: (_options?: any): string => {
    try {
      // 1. 扫描项目类型
      const scanner = new ProjectScanner();
      const metadata = scanner.scan();

      // 2. 加载规则文件（同步包装异步）
      // 注意：RulesLoader.load() 是异步的，但 Skill.render() 当前接口是同步的
      // 这里使用同步读取作为 fallback
      const loader = new RulesLoader();
      const rules = loadRulesSync(metadata.rootPath);

      // 3. 组装上下文
      const builder = new ContextBuilder(metadata, rules);
      return builder.build();
    } catch (error) {
      log.error('Failed to build project context:', error);
      return '';
    }
  },
};

/**
 * 同步加载规则文件
 * Skill.render() 当前接口是同步的，使用同步 fs API
 */
function loadRulesSync(rootPath: string): import('@/context/types').RulesContent {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');

  const MAX_FILE_SIZE = 500 * 1024;
  const result: import('@/context/types').RulesContent = {};

  const loadFile = (filePath: string, label: string): string | undefined => {
    try {
      if (!fs.existsSync(filePath)) return undefined;
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return undefined;

      let content = fs.readFileSync(filePath, 'utf-8');
      if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_SIZE) {
        log.warn(`${label} exceeds 500KB, truncating`);
        content = content.slice(0, MAX_FILE_SIZE);
      }
      return content;
    } catch (error) {
      log.error(`Failed to load ${label}:`, error);
      return undefined;
    }
  };

  result.xuanjiMd = loadFile(path.join(rootPath, 'XUANJI.md'), 'XUANJI.md');
  result.projectRules = loadFile(path.join(rootPath, '.xuanji', 'rules.md'), '.xuanji/rules.md');
  result.globalRules = loadFile(path.join(os.homedir(), '.xuanji', 'rules.md'), '~/.xuanji/rules.md');

  return result;
}
