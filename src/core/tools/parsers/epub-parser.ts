/**
 * ============================================================
 * EPUB Parser — .epub → Markdown
 * ============================================================
 * EPUB 本质是 ZIP + XHTML，解压后提取各章节文本。
 */

import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { FileParserResult } from './types';

/**
 * 从 XHTML 中提取纯文本
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, m => String.fromCharCode(parseInt(m.slice(2, -1), 10)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 找到 spine（阅读顺序）中列出的章节文件
 */
function getSpineItemRefs(opfXml: string): string[] {
  const refs: string[] = [];
  const spineMatch = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
  if (spineMatch) {
    const itemRefRegex = /<itemref[^>]*idref="([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRefRegex.exec(spineMatch[1]!)) !== null) {
      refs.push(m[1]!);
    }
  }
  return refs;
}

function getManifestMap(opfXml: string): Map<string, string> {
  const map = new Map<string, string>();
  const manifestMatch = opfXml.match(/<manifest[^>]*>([\s\S]*?)<\/manifest>/i);
  if (manifestMatch) {
    const itemRegex = /<item[^>]*id="([^"]+)"[^>]*href="([^"]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(manifestMatch[1]!)) !== null) {
      map.set(m[1]!, m[2]!);
    }
  }
  return map;
}

export async function parseEpub(filePath: string): Promise<FileParserResult> {
  const buffer = await readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);

  // 找到 .opf 文件（清单文件）
  const opfFile = Object.keys(zip.files).find(
    f => f.endsWith('.opf') && !f.startsWith('__'),
  );
  if (!opfFile) {
    return { content: '无法找到 EPUB 清单文件 (.opf)' };
  }

  const opfXml = await zip.files[opfFile]!.async('string');
  const manifest = getManifestMap(opfXml);
  const spineRefs = getSpineItemRefs(opfXml);

  // 基础路径：用于解析相对 href
  const baseDir = opfFile.substring(0, opfFile.lastIndexOf('/') + 1);

  // 提取标题
  let title = '';
  const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  if (titleMatch) title = titleMatch[1]!;

  // 提取作者
  let author = '';
  const authorMatch = opfXml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
  if (authorMatch) author = authorMatch[1]!;

  const lines: string[] = [];
  if (title) lines.push(`# ${title}`);
  if (author) lines.push(`> Author: ${author}`);
  lines.push('');

  let chapterCount = 0;

  // 按 spine 顺序读取章节
  for (const ref of spineRefs) {
    const href = manifest.get(ref);
    if (!href) continue;

    const fullPath = baseDir + href;
    const file = zip.files[fullPath];
    if (!file || file.dir) continue;

    try {
      const content = await file.async('string');
      const text = stripHtml(content);
      if (text.length > 20) { // 跳过空/太短的章节
        chapterCount++;
        lines.push(text);
        lines.push('');
        lines.push('---');
        lines.push('');
      }
    } catch { /* skip unreadable chapters */ }
  }

  return {
    content: lines.join('\n').trim(),
    metadata: { chapters: chapterCount, title, author },
  };
}
