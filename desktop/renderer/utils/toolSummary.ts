// ============================================================
// toolSummary - 工具调用摘要生成（纯函数，无 store 依赖）
// ============================================================

/** 提取可读的模型名 */
export function formatModelName(rawModel: string): string {
  if (!rawModel) return 'unknown';
  const cleaned = rawModel.replace(/^file:.*\//, '').replace(/\.gguf$/, '').replace(/^hf:/, '');
  return cleaned || rawModel;
}

/** 工具名称格式化：write_file → Write file */
export function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** 格式化场景标签：去除 l{n}- 前缀 */
export function formatSceneLabel(raw: string): string {
  return raw.replace(/^l\d+-/, '').slice(0, 20);
}

function cleanDiffContent(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .map(line => line.replace(/^\s*\d+\s*│\s*/, ''))
    .join('\n')
    .trim();
}

function extractDiffStats(result: string): { added: number; removed: number } | null {
  const statsMatch = result.match(/统计:\s*\+(\d+)\s*-(\d+)/);
  if (statsMatch) {
    return { added: parseInt(statsMatch[1], 10), removed: parseInt(statsMatch[2], 10) };
  }
  return null;
}

function extractDiffContent(result: string): string | null {
  const lines = result.split('\n');
  const separatorIndex = lines.findIndex(line => line.includes('─'.repeat(10)));
  if (separatorIndex === -1) return null;
  const diffLines = lines.slice(separatorIndex + 2);
  const cleanedDiff = cleanDiffContent(diffLines.join('\n'));
  return cleanedDiff || null;
}

/** 生成工具调用的对话式摘要 */
export function generateToolSummaryMessage(
  toolName: string,
  input: Record<string, unknown>,
  result: string,
): string {
  const filePath = (input.path || input.file_path) as string | undefined;
  if (!filePath) return '';

  switch (toolName) {
    case 'write_file': {
      const stats = extractDiffStats(result);
      const diffContent = extractDiffContent(result);
      if (stats && diffContent) {
        return `✅ **已更新文件** \`${filePath}\`\n\n📊 变更：+${stats.added} 行，-${stats.removed} 行\n\n\`\`\`diff\n${diffContent}\n\`\`\``;
      }
      const content = input.content as string;
      const lines = content.split('\n').length;
      const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;
      return `✅ **已创建文件** \`${filePath}\`\n\n📊 共 ${lines} 行\n\n> \`📎 预览\`\n> \`\`\`\n${preview}\n> \`\`\`\n\n内容较长，已截取前 200 字符。可发送 \`查看文件 ${filePath}\` 获取完整内容。`;
    }

    case 'edit_file': {
      const stats = extractDiffStats(result);
      const diffContent = extractDiffContent(result);
      if (stats && diffContent) {
        const replaceAll = input.replace_all as boolean;
        const countInfo = replaceAll ? '（批量替换）' : '';
        return `✅ **已编辑文件** \`${filePath}\`${countInfo}\n\n📊 变更：+${stats.added} 行，-${stats.removed} 行\n\n\`\`\`diff\n${diffContent}\n\`\`\``;
      }
      const oldString = (input.old_string as string || '').slice(0, 100);
      const newString = (input.new_string as string || '').slice(0, 100);
      return `✅ **已编辑文件** \`${filePath}\`\n\n**原内容：**\n\`\`\`\n${oldString}${oldString.length >= 100 ? '...' : ''}\n\`\`\`\n\n**新内容：**\n\`\`\`\n${newString}${newString.length >= 100 ? '...' : ''}\n\`\`\``;
    }

    case 'multi_edit': {
      const edits = input.edits as Array<any>;
      if (!edits || edits.length === 0) return '';
      const fileCount = new Set(edits.map(e => e.file_path)).size;
      const totalEdits = edits.length;
      const editList = edits.slice(0, 3).map(e =>
        `- \`${e.file_path}\`：${(e.old_string || '').slice(0, 30)}... → ${(e.new_string || '').slice(0, 30)}...`
      ).join('\n');
      return `✅ **批量编辑完成**\n\n📁 涉及 ${fileCount} 个文件，共 ${totalEdits} 处修改\n\n${editList}${edits.length > 3 ? `\n... 还有 ${edits.length - 3} 处修改` : ''}`;
    }

    default:
      return '';
  }
}

/** 生成文件变更的对话式摘要 */
export function generateFileChangeSummary(change: import('../global').FileChange): string {
  const change2 = change as any;
  const { filePath, operation, stats, diffContent } = change2;
  const cleanDiff = diffContent ? cleanDiffContent(diffContent) : '';

  switch (operation) {
    case 'create':
      return ['', `## 📄 新文件 — \`${filePath}\``, '', `共 ${stats.added} 行`, ''].join('\n');
    case 'edit':
    case 'overwrite': {
      const operationText = operation === 'edit' ? '编辑' : '覆盖';
      const lines: string[] = [
        '', `## ✏️ 文件${operationText} — \`${filePath}\``, '',
        `+\`${stats.added}\` 添加｜-\`${stats.removed}\` 删除｜共 ${(stats.added + stats.removed)} 处变更`, '',
      ];
      if (cleanDiff) {
        lines.push('```diff');
        lines.push(cleanDiff);
        lines.push('```');
      }
      return lines.join('\n');
    }
    default:
      return '';
  }
}
