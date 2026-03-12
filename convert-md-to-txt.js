import fs from 'fs';

// 读取Markdown文件
function readMarkdown(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// 简单处理Markdown，转换为纯文本
function markdownToText(markdown) {
  let text = markdown;
  
  // 移除标题标记
  text = text.replace(/^#{1,6}\s/gm, '');
  
  // 移除粗体和斜体标记
  text = text.replace(/\*\*(.*?)\*\*/g, '$1');
  text = text.replace(/\*(.*?)\*/g, '$1');
  text = text.replace(/__(.*?)__/g, '$1');
  
  // 移除代码块标记
  text = text.replace(/```[\s\S]*?```/g, '');
  
  // 移除行内代码标记
  text = text.replace(/`(.*?)`/g, '$1');
  
  // 移除链接标记
  text = text.replace(/\[(.*?)\]\((.*?)\)/g, '$1');
  
  // 移除图片标记
  text = text.replace(/!\[(.*?)\]\((.*?)\)/g, '');
  
  // 移除引用标记
  text = text.replace(/^>\s/gm, '');
  
  // 移除水平线
  text = text.replace(/^-{3,}$/gm, '');
  
  // 移除表格（简单处理）
  text = text.replace(/\|.*?\|/gm, '');
  
  // 移除多余的空行
  text = text.replace(/\n{3,}/g, '\n\n');
  
  // 保留列表标记，转换为纯文本列表
  text = text.replace(/^-\s/gm, '• ');
  text = text.replace(/^\d+\.\s/gm, '1. ');
  
  return text.trim();
}

// 保存为txt文件
function saveAsTxt(content, outputPath) {
  fs.writeFileSync(outputPath, content, 'utf8');
  console.log(`✅ 成功转换为TXT文件: ${outputPath}`);
}

// 主转换函数
function convertMarkdownToTxt(inputPath, outputPath) {
  try {
    console.log(`开始转换: ${inputPath}`);
    const markdown = readMarkdown(inputPath);
    const text = markdownToText(markdown);
    saveAsTxt(text, outputPath);
  } catch (error) {
    console.error('❌ 转换失败:', error);
  }
}

// 转换两个文件
const files = [
  {
    input: './docs/business-plan.md',
    output: './docs/business-plan.txt'
  },
  {
    input: './docs/product-introduction.md',
    output: './docs/product-introduction.txt'
  }
];

// 执行转换
function main() {
  console.log('开始转换Markdown文件为TXT文档...\n');
  
  for (const file of files) {
    convertMarkdownToTxt(file.input, file.output);
    console.log('');
  }
  
  console.log('🎉 所有转换任务完成！');
}

main();
