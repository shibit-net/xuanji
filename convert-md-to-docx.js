import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import { asBlob } from 'html-docx-js';
import { Buffer } from 'buffer';

// 读取Markdown文件
function readMarkdown(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// 转换Markdown到HTML
function markdownToHtml(markdown) {
  return marked(markdown);
}

// 转换HTML到Word文档
async function htmlToWord(html, outputPath) {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; margin: 20px; }
        h1, h2, h3, h4, h5, h6 { color: #333; margin-top: 20px; margin-bottom: 10px; }
        p { margin-bottom: 15px; }
        ul, ol { margin-bottom: 15px; }
        li { margin-bottom: 5px; }
        code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; font-family: 'Courier New', monospace; }
        pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }
        blockquote { border-left: 4px solid #ddd; padding-left: 15px; margin: 15px 0; color: #666; }
        table { border-collapse: collapse; width: 100%; margin: 15px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
      </style>
    </head>
    <body>
      ${html}
    </body>
    </html>
  `;

  try {
    const blob = await asBlob(htmlContent);
    const buffer = Buffer.from(await blob.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    console.log(`✅ 成功转换为Word文档: ${outputPath}`);
  } catch (error) {
    console.error('❌ 转换失败:', error);
  }
}

// 主转换函数
async function convertMarkdownToWord(inputPath, outputPath) {
  try {
    console.log(`开始转换: ${inputPath}`);
    const markdown = readMarkdown(inputPath);
    const html = markdownToHtml(markdown);
    await htmlToWord(html, outputPath);
  } catch (error) {
    console.error('❌ 转换过程出错:', error);
  }
}

// 转换两个文件
const files = [
  {
    input: './docs/business-plan.md',
    output: './docs/business-plan.docx'
  },
  {
    input: './docs/product-introduction.md',
    output: './docs/product-introduction.docx'
  }
];

// 执行转换
async function main() {
  console.log('开始转换Markdown文件为Word文档...\n');
  
  for (const file of files) {
    await convertMarkdownToWord(file.input, file.output);
    console.log('');
  }
  
  console.log('🎉 所有转换任务完成！');
}

main();
