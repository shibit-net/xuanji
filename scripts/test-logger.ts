#!/usr/bin/env tsx
/**
 * 测试日志系统
 */

import { logger } from '../src/core/logger/index.js';

const log = logger.child({ module: 'TestLogger' });

console.log('=== 测试日志系统 ===\n');

// 测试不同级别的日志
log.debug('这是 debug 日志', { data: 'debug data' });
log.info('这是 info 日志', { data: 'info data' });
log.warn('这是 warn 日志', { data: 'warn data' });
log.error('这是 error 日志', { data: 'error data' });

console.log('\n=== 测试子 Logger ===\n');

const childLog = log.child({ module: 'ChildModule' });
childLog.info('子模块日志');
childLog.error('子模块错误', new Error('测试错误'));

console.log('\n=== 日志文件位置 ===');
console.log('~/.xuanji/logs/debug.log');
console.log('~/.xuanji/logs/info.log');
console.log('~/.xuanji/logs/warn.log');
console.log('~/.xuanji/logs/error.log');

// 等待文件写入完成
setTimeout(async () => {
  const { closeFileWriter } = await import('../src/core/logger/index.js');
  await closeFileWriter();
  console.log('\n✅ 测试完成');
  process.exit(0);
}, 1000);
