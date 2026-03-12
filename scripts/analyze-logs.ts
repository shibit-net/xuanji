#!/usr/bin/env tsx
// ============================================================
// AgentLoop 日志分析工具
// ============================================================

import { AgentLoopLogger } from '../src/core/telemetry/AgentLoopLogger';
import type { AgentLoopLog, LLMRetryLog, IterationEndLog } from '../src/core/telemetry/AgentLoopLogger';

/**
 * 分析频率限制问题
 */
async function analyzeRateLimits(sessionId?: string) {
  console.log('🔍 分析 API 频率限制问题\n');

  // 查询所有重试日志
  const retries = await AgentLoopLogger.query({
    eventType: 'llm_retry',
    sessionId,
  });

  if (retries.length === 0) {
    console.log('✅ 未发现 API 重试记录');
    return;
  }

  console.log(`⚠️  发现 ${retries.length} 次 API 重试\n`);

  // 按会话分组
  const sessionRetries = new Map<string, LLMRetryLog[]>();
  retries.forEach((log) => {
    const logs = sessionRetries.get(log.sessionId) || [];
    logs.push(log as LLMRetryLog);
    sessionRetries.set(log.sessionId, logs);
  });

  console.log(`涉及 ${sessionRetries.size} 个会话:\n`);

  // 分析每个会话
  for (const [sid, logs] of sessionRetries.entries()) {
    console.log(`📋 会话: ${sid}`);
    console.log(`   重试次数: ${logs.length}`);

    // 统计重试原因
    const reasons = new Map<string, number>();
    logs.forEach((log) => {
      reasons.set(log.reason, (reasons.get(log.reason) || 0) + 1);
    });

    console.log('   重试原因:');
    for (const [reason, count] of reasons.entries()) {
      console.log(`     - ${reason}: ${count} 次`);
    }

    // 分析重试间隔
    const delays = logs.map((l) => l.delayMs || 0);
    const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
    console.log(`   平均延迟: ${avgDelay.toFixed(0)}ms\n`);
  }
}

/**
 * 分析迭代性能
 */
async function analyzePerformance(sessionId?: string) {
  console.log('⚡ 分析迭代性能\n');

  // 查询所有迭代结束日志
  const iterations = await AgentLoopLogger.query({
    eventType: 'iteration_end',
    sessionId,
  });

  if (iterations.length === 0) {
    console.log('❌ 未找到迭代记录');
    return;
  }

  console.log(`找到 ${iterations.length} 次迭代\n`);

  const durations = (iterations as IterationEndLog[]).map((log) => ({
    iteration: log.iteration,
    durationMs: log.durationMs,
    sessionId: log.sessionId,
  }));

  // 排序找出最慢的
  durations.sort((a, b) => b.durationMs - a.durationMs);

  console.log('🐌 最慢的 5 次迭代:');
  durations.slice(0, 5).forEach((d, i) => {
    console.log(`  ${i + 1}. 迭代 ${d.iteration} - ${d.durationMs}ms (${d.sessionId.slice(0, 20)}...)`);
  });

  // 统计
  const totalDuration = durations.reduce((sum, d) => sum + d.durationMs, 0);
  const avgDuration = totalDuration / durations.length;
  const maxDuration = durations[0].durationMs;
  const minDuration = durations[durations.length - 1].durationMs;

  console.log('\n📊 统计信息:');
  console.log(`  平均耗时: ${avgDuration.toFixed(0)}ms`);
  console.log(`  最长耗时: ${maxDuration}ms`);
  console.log(`  最短耗时: ${minDuration}ms`);
  console.log(`  总耗时: ${(totalDuration / 1000).toFixed(1)}s`);
}

/**
 * 分析工具执行
 */
async function analyzeToolUsage(sessionId?: string) {
  console.log('\n🔧 分析工具执行情况\n');

  // 查询所有工具结果日志
  const toolResults = await AgentLoopLogger.query({
    eventType: 'tool_result',
    sessionId,
  });

  if (toolResults.length === 0) {
    console.log('❌ 未找到工具执行记录');
    return;
  }

  console.log(`找到 ${toolResults.length} 次工具调用\n`);

  // 按工具名统计
  const toolStats = new Map<
    string,
    { count: number; successCount: number; totalDuration: number; errors: string[] }
  >();

  toolResults.forEach((log: any) => {
    const stats = toolStats.get(log.toolName) || {
      count: 0,
      successCount: 0,
      totalDuration: 0,
      errors: [],
    };

    stats.count++;
    if (log.success) stats.successCount++;
    else if (log.errorMessage) stats.errors.push(log.errorMessage);
    stats.totalDuration += log.durationMs || 0;

    toolStats.set(log.toolName, stats);
  });

  console.log('📈 工具使用统计:');
  for (const [name, stats] of toolStats.entries()) {
    const successRate = ((stats.successCount / stats.count) * 100).toFixed(1);
    const avgDuration = (stats.totalDuration / stats.count).toFixed(0);

    console.log(`\n  ${name}:`);
    console.log(`    调用次数: ${stats.count}`);
    console.log(`    成功率: ${successRate}%`);
    console.log(`    平均耗时: ${avgDuration}ms`);

    if (stats.errors.length > 0) {
      console.log(`    错误 (${stats.errors.length}):`);
      stats.errors.slice(0, 3).forEach((err) => {
        console.log(`      - ${err.slice(0, 60)}...`);
      });
    }
  }
}

/**
 * 分析错误日志
 */
async function analyzeErrors(sessionId?: string) {
  console.log('\n❌ 分析错误日志\n');

  // 查询所有错误
  const errors = await AgentLoopLogger.query({
    eventType: 'error_caught',
    sessionId,
  });

  if (errors.length === 0) {
    console.log('✅ 未发现错误记录');
    return;
  }

  console.log(`⚠️  发现 ${errors.length} 个错误\n`);

  errors.forEach((log: any, i) => {
    console.log(`${i + 1}. ${log.errorName}: ${log.errorMessage}`);
    console.log(`   时间: ${log.timestamp}`);
    console.log(`   会话: ${log.sessionId}`);
    console.log(`   迭代: ${log.iteration}`);
    console.log(`   可恢复: ${log.recoverable ? '是' : '否'}`);
    console.log(`   上下文:`);
    console.log(`     - 运行中: ${log.context.running}`);
    console.log(`     - 消息数: ${log.context.messageCount}`);
    console.log(`     - 待追加: ${log.context.pendingAppend}`);
    console.log(`     - 已中断: ${log.context.interrupted}`);
    if (log.errorStack) {
      console.log(`   堆栈: ${log.errorStack.split('\n')[1]}`);
    }
    console.log();
  });
}

/**
 * 会话诊断
 */
async function diagnoseSession(sessionId: string) {
  console.log(`\n🔬 会话诊断: ${sessionId}\n`);
  console.log('='.repeat(60));

  // 获取会话摘要
  const summary = await AgentLoopLogger.getSessionSummary(sessionId);

  if (!summary) {
    console.log('❌ 会话不存在或无日志记录');
    return;
  }

  console.log('\n📊 会话概览:');
  console.log(`  总迭代: ${summary.totalIterations}`);
  console.log(`  总耗时: ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`  总 Token: ${summary.totalTokens.toLocaleString()}`);
  console.log(`  总成本: $${summary.totalCost.toFixed(4)}`);
  console.log(`  错误数: ${summary.errorCount}`);
  console.log(`  工具调用: ${summary.toolCallCount}`);

  console.log('\n📝 事件统计:');
  Object.entries(summary.events)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([event, count]) => {
      console.log(`  ${event.padEnd(25)} ${count} 次`);
    });

  // 详细分析
  await analyzeRateLimits(sessionId);
  await analyzePerformance(sessionId);
  await analyzeToolUsage(sessionId);
  await analyzeErrors(sessionId);

  console.log('\n' + '='.repeat(60));
}

// ============================================================
// 主入口
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const sessionId = args[1];

  console.log('🧰 AgentLoop 日志分析工具\n');

  switch (command) {
    case 'rate-limits':
      await analyzeRateLimits(sessionId);
      break;

    case 'performance':
      await analyzePerformance(sessionId);
      break;

    case 'tools':
      await analyzeToolUsage(sessionId);
      break;

    case 'errors':
      await analyzeErrors(sessionId);
      break;

    case 'diagnose':
      if (!sessionId) {
        console.error('❌ 请提供会话 ID: npx tsx scripts/analyze-logs.ts diagnose <session-id>');
        process.exit(1);
      }
      await diagnoseSession(sessionId);
      break;

    case 'sessions':
      // 列出最近的会话
      const logs = await AgentLoopLogger.query({
        eventType: 'session_complete',
        limit: 10,
      });
      console.log('📋 最近的 10 个会话:\n');
      logs.reverse().forEach((log: any, i) => {
        console.log(`${i + 1}. ${log.sessionId}`);
        console.log(`   时间: ${log.timestamp}`);
        console.log(`   迭代: ${log.totalIterations}, 耗时: ${(log.totalDurationMs / 1000).toFixed(1)}s`);
        console.log(`   Token: ${(log.totalUsage.input + log.totalUsage.output).toLocaleString()}, 成本: $${log.totalCost.toFixed(4)}`);
        console.log();
      });
      break;

    default:
      console.log('用法:');
      console.log('  npx tsx scripts/analyze-logs.ts <command> [session-id]');
      console.log('\n命令:');
      console.log('  sessions              - 列出最近的会话');
      console.log('  rate-limits [sid]     - 分析频率限制问题');
      console.log('  performance [sid]     - 分析迭代性能');
      console.log('  tools [sid]           - 分析工具使用');
      console.log('  errors [sid]          - 分析错误日志');
      console.log('  diagnose <sid>        - 会话完整诊断');
      console.log('\n示例:');
      console.log('  npx tsx scripts/analyze-logs.ts sessions');
      console.log('  npx tsx scripts/analyze-logs.ts diagnose test-session-1772746719013');
      break;
  }
}

main().catch(console.error);
