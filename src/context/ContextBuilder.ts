/**
 * ============================================================
 * M3 上下文引擎 — ContextBuilder
 * ============================================================
 * 将项目元数据和规则组装为格式化的 system prompt 片段。
 *
 * 输出格式为 Markdown，空内容 section 不渲染。
 */

import * as os from 'node:os';
import type { ProjectMetadata, RulesContent } from './types';

/** 项目类型到人类可读名称的映射 */
const PROJECT_TYPE_LABELS: Record<string, string> = {
  node: 'Node.js',
  python: 'Python',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  unknown: 'Unknown',
};

export class ContextBuilder {
  constructor(
    private metadata: ProjectMetadata,
    private rules: RulesContent,
  ) {}

  /**
   * 组装完整的项目上下文字符串
   */
  build(): string {
    const sections: string[] = [];

    // 项目类型 section
    sections.push(this.buildProjectSection());

    // XUANJI.md section
    if (this.rules.xuanjiMd) {
      sections.push(this.buildSection('Project Instructions (XUANJI.md)', this.rules.xuanjiMd));
    }

    // .xuanji/rules.md section
    if (this.rules.projectRules) {
      sections.push(this.buildSection('Custom Rules (.xuanji/rules.md)', this.rules.projectRules));
    }

    // ~/.xuanji/rules.md section
    if (this.rules.globalRules) {
      sections.push(this.buildSection('Global Rules (~/.xuanji/rules.md)', this.rules.globalRules));
    }

    // 环境信息 section
    sections.push(this.buildEnvironmentSection());

    return `## Project Context\n\n${sections.join('\n\n')}`;
  }

  private buildProjectSection(): string {
    const typeLabel = PROJECT_TYPE_LABELS[this.metadata.type] || this.metadata.type;
    const lines = [
      '### Project Type',
      `- Type: ${typeLabel}`,
      `- Git Repository: ${this.metadata.hasGit ? 'Yes' : 'No'}`,
      `- Root: ${this.metadata.rootPath}`,
    ];
    if (this.metadata.configFiles.length > 0) {
      lines.push(`- Config Files: ${this.metadata.configFiles.join(', ')}`);
    }
    return lines.join('\n');
  }

  private buildSection(title: string, content: string): string {
    return `### ${title}\n${content}`;
  }

  private buildEnvironmentSection(): string {
    const lines = [
      '### Environment',
      `- Node: ${process.version}`,
      `- Platform: ${process.platform}`,
      `- Arch: ${process.arch}`,
      `- Shell: ${process.env.SHELL || 'unknown'}`,
      `- Home: ${os.homedir()}`,
    ];
    return lines.join('\n');
  }
}
