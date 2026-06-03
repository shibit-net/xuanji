/**
 * ============================================================
 * PPTX Parser — .pptx → Markdown
 * ============================================================
 * .pptx 本质是 ZIP 文件，解压后读取各 slide 的 XML 提取文本。
 * 使用 jszip 库解压，不依赖庞大库。
 */

import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import type { FileParserResult } from './types';

interface SlideText {
  slideNum: number;
  texts: string[];
  notes?: string;
}

/**
 * 从 XML 中提取文本节点
 */
function extractTextsFromXml(xml: string): string[] {
  const texts: string[] = [];
  // 匹配 <a:t>...</a:t> 标签内的文本
  const regex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const t = match[1]!.trim();
    if (t) texts.push(t);
  }
  return texts;
}

export async function parsePptx(filePath: string): Promise<FileParserResult> {
  const buffer = await readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);

  // 获取各 slide 的 XML
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort();

  const slides: SlideText[] = [];

  for (const slideFile of slideFiles) {
    const slideNum = parseInt(slideFile.match(/slide(\d+)\.xml$/)?.[1] ?? '0', 10);
    const xml = await zip.files[slideFile]!.async('string');
    const texts = extractTextsFromXml(xml);

    // 尝试读取对应的 notes
    let notes: string | undefined;
    const notesFile = slideFile.replace('slides/', 'notesSlides/').replace('slide', 'notesSlide');
    if (zip.files[notesFile]) {
      const notesXml = await zip.files[notesFile]!.async('string');
      const notesTexts = extractTextsFromXml(notesXml);
      if (notesTexts.length > 0) {
        notes = notesTexts.join('\n');
      }
    }

    slides.push({ slideNum, texts, notes });
  }

  // 渲染
  const lines: string[] = [];
  const totalSlides = slides.length;
  lines.push(`[PPTX] ${totalSlides} slides`);
  lines.push('');

  for (const slide of slides) {
    lines.push(`### Slide ${slide.slideNum}`);
    lines.push('');
    for (const text of slide.texts) {
      lines.push(text);
    }
    lines.push('');
    if (slide.notes) {
      lines.push(`> 📝 Notes: ${slide.notes}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  // 尝试读取主题颜色等信息（可选）
  let title = '';
  try {
    if (zip.files['ppt/presentation.xml']) {
      const presXml = await zip.files['ppt/presentation.xml']!.async('string');
      const titleMatch = presXml.match(/<p:sislides?[^>]*>/);
      // 不从演示文稿 XML 提取标题，太复杂，略过
    }
  } catch { /* ignore */ }

  return {
    content: lines.join('\n').trim(),
  };
}
