#!/usr/bin/env node
/**
 * 测试 DiffRenderer 的 changesOnly 功能
 */

import { DiffRenderer } from './src/core/utils/DiffRenderer.js';

const oldContent = `function hello() {
  console.log('Hello World');
  console.log('Line 2');
  console.log('Line 3');
  console.log('Line 4');
  console.log('Line 5');
  console.log('Line 6');
  return true;
}`;

const newContent = `function hello() {
  console.log('Hello Xuanji');
  console.log('Line 2');
  console.log('Line 3');
  console.log('Line 4 Modified');
  console.log('Line 5');
  console.log('New Line 6.5');
  console.log('Line 6');
  return true;
}`;

console.log('='.repeat(80));
console.log('测试 1: changesOnly = true（默认，仅显示变更）');
console.log('='.repeat(80));
const diff1 = DiffRenderer.renderPreview(oldContent, newContent, 'test.js');
console.log(diff1);

console.log('\n');
console.log('='.repeat(80));
console.log('测试 2: changesOnly = false（显示所有行）');
console.log('='.repeat(80));
const diff2 = DiffRenderer.renderPreview(oldContent, newContent, 'test.js', true, false);
console.log(diff2);
