#!/usr/bin/env tsx
// ============================================================
// 测试 ModelClassifier 自动下载功能
// ============================================================

import { ModelClassifier } from './src/core/agent/dispatch/ModelClassifier';
import { DownloadManager } from './src/core/download/DownloadManager';

const downloadManager = DownloadManager.getInstance();

// 监听下载事件
downloadManager.on('task-created', (task) => {
  console.log(`[下载创建] ${task.name}`);
});

downloadManager.on('task-started', (task) => {
  console.log(`[开始下载] ${task.name}`);
});

downloadManager.on('task-progress', (task) => {
  const percent = task.progress.percent.toFixed(1);
  const downloaded = (task.progress.downloaded / 1024 / 1024).toFixed(2);
  const total = (task.progress.total / 1024 / 1024).toFixed(2);
  const speed = (task.progress.speed / 1024 / 1024).toFixed(2);
  console.log(`[下载进度] ${percent}% - ${downloaded}/${total} MB - ${speed} MB/s`);
});

downloadManager.on('task-completed', (task) => {
  console.log(`[下载完成] ${task.name}`);
});

downloadManager.on('task-failed', (task) => {
  console.error(`[下载失败] ${task.name}: ${task.error}`);
});

async function main() {
  console.log('=== 测试 ModelClassifier 自动下载 ===\n');

  // 创建 ModelClassifier
  const classifier = new ModelClassifier({
    modelType: 'qwen2.5-0.5b-q4',
  });

  console.log('初始化 ModelClassifier...');
  await classifier.init();

  console.log(`\nModelClassifier 可用状态: ${classifier.isAvailable()}`);
  console.log(`当前模型: ${classifier.getCurrentModel()}`);

  // 如果模型正在下载，等待下载完成
  if (!classifier.isAvailable()) {
    console.log('\n模型正在后台下载，等待完成...');

    // 轮询检查状态
    while (!classifier.isAvailable()) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 显示下载队列状态
      const tasks = downloadManager.getAllTasks();
      const downloading = tasks.filter((t) => t.status === 'downloading');
      if (downloading.length > 0) {
        console.log(`\n当前下载任务: ${downloading.length} 个`);
      }
    }

    console.log('\n✓ 模型下载并加载完成！');
  } else {
    console.log('\n✓ 模型已就绪（本地已存在）');
  }

  // 测试分类
  console.log('\n=== 测试分类功能 ===\n');
  const testInputs = [
    '帮我写一个 React 组件',
    '这段代码有什么问题？',
    '搜索一下项目中的配置文件',
  ];

  for (const input of testInputs) {
    console.log(`输入: ${input}`);
    const result = await classifier.classify(input);
    if (result) {
      console.log(`  → agent: ${result.agent}, scene: ${result.scene}, confidence: ${result.confidence}`);
    } else {
      console.log('  → 分类失败（使用 fallback）');
    }
    console.log();
  }

  // 清理
  await classifier.dispose();
  console.log('测试完成！');
}

main().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
