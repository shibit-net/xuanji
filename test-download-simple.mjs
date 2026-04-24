#!/usr/bin/env node
// 简单测试 DownloadManager

import { DownloadManager } from './src/core/download/DownloadManager.js';
import * as path from 'node:path';
import * as os from 'node:os';

const dm = DownloadManager.getInstance();

dm.on('task-created', (t) => console.log('[创建]', t.name));
dm.on('task-started', (t) => console.log('[开始]', t.name));
dm.on('task-progress', (t) => {
  process.stdout.write(`\r[进度] ${t.progress.percent.toFixed(1)}% - ${(t.progress.speed / 1024 / 1024).toFixed(2)} MB/s`);
});
dm.on('task-completed', (t) => console.log('\n[完成]', t.name));
dm.on('task-failed', (t) => console.log('\n[失败]', t.error));

const dest = path.join(os.homedir(), '.xuanji', 'models', 'test-download.gguf');

console.log('开始下载测试...');
const taskId = await dm.download({
  url: 'https://hf-mirror.com/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
  dest,
  name: 'Test Model',
  category: 'model',
});

console.log('任务 ID:', taskId);

// 等待完成
while (true) {
  const task = dm.getTask(taskId);
  if (!task) break;
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    break;
  }
  await new Promise(r => setTimeout(r, 1000));
}

console.log('\n测试完成');
