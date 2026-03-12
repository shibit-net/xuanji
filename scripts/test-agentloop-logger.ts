#!/usr/bin/env tsx
// ============================================================
// AgentLoop 日志功能测试
// ============================================================

import { AgentLoopLogger } from '../src/core/telemetry/AgentLoopLogger';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

async function testAgentLoopLogger() {
  console.log('🧪 测试 AgentLoopLogger...\n');

  const sessionId = `test-session-${Date.now()}`;
  const model = 'claude-sonnet-4-5';
  const logger = new AgentLoopLogger(sessionId, model);

  try {
    // 1. 测试迭代开始日志
    console.log('✅ 测试 1: 记录迭代开始');
    await logger.logIterationStart(1, 100, 5, false);

    // 2. 测试 LLM 请求日志
    console.log('✅ 测试 2: 记录 LLM 请求');
    await logger.logLLMRequest(
      1,
      5,
      19,
      8234,
      64000,
      {
        temperature: 1.0,
        hasThinking: false,
      }
    );

    // 3. 测试 LLM 响应日志
    console.log('✅ 测试 3: 记录 LLM 响应');
    await logger.logLLMResponse(
      1,
      'tool_use',
      2,
      1,
      {
        input: 8234,
        output: 156,
        cacheRead: 5123,
        cacheWrite: 3111,
      },
      3456
    );

    // 4. 测试工具分组日志
    console.log('✅ 测试 4: 记录工具分组');
    await logger.logToolGroup(1, ['tool-001', 'tool-002'], ['tool-003']);

    // 5. 测试工具执行日志
    console.log('✅ 测试 5: 记录工具执行');
    await logger.logToolExecute(
      1,
      'tool-001',
      'read_file',
      { file_path: '/path/to/file.ts' },
      true
    );

    // 6. 测试工具结果日志
    console.log('✅ 测试 6: 记录工具结果');
    await logger.logToolResult(1, 'tool-001', 'read_file', true, 1234, 45);

    // 7. 测试消息追加日志
    console.log('✅ 测试 7: 记录消息追加');
    await logger.logMessageAppend(2, '用英文回复', true, 100);

    // 8. 测试上下文压缩日志
    console.log('✅ 测试 8: 记录上下文压缩');
    await logger.logContextCompress(2, 15000, 8000, 0.47, 2341);

    // 9. 测试 LLM 重试日志
    console.log('✅ 测试 9: 记录 LLM 重试');
    await logger.logLLMRetry(
      3,
      1,
      'rate_limit_error',
      'RateLimitError',
      '模型服务请求频率超限',
      5000
    );

    // 10. 测试异常捕获日志
    console.log('✅ 测试 10: 记录异常捕获');
    const testError = new Error('Test error');
    await logger.logErrorCaught(
      3,
      testError,
      {
        running: true,
        messageCount: 10,
        pendingAppend: false,
        interrupted: false,
      },
      true
    );

    // 11. 测试用户中断日志
    console.log('✅ 测试 11: 记录用户中断');
    await logger.logInterrupt(3, 'user_interrupt', '用英文', true, []);

    // 12. 测试迭代结束日志
    console.log('✅ 测试 12: 记录迭代结束');
    await logger.logIterationEnd(3, 'end_turn', 0, 1523);

    // 13. 测试会话完成日志
    console.log('✅ 测试 13: 记录会话完成');
    await logger.logSessionComplete(
      3,
      {
        input: 25000,
        output: 3000,
        cacheRead: 15000,
        cacheWrite: 10000,
      },
      0.15,
      [
        {
          name: 'read_file',
          count: 3,
          totalDurationMs: 120,
          errorCount: 0,
        },
        {
          name: 'edit_file',
          count: 2,
          totalDurationMs: 850,
          errorCount: 0,
        },
      ],
      'completed'
    );

    // 等待异步写入完成
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.log('\n📁 检查日志文件...');
    const logPath = join(homedir(), '.xuanji', 'logs', 'agent-loop.log');
    if (existsSync(logPath)) {
      console.log(`✅ 日志文件存在: ${logPath}`);

      // 读取并验证日志
      const content = await readFile(logPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      const sessionLogs = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((log) => log && log.sessionId === sessionId);

      console.log(`✅ 本次测试生成了 ${sessionLogs.length} 条日志\n`);

      // 显示日志摘要
      console.log('📊 日志事件统计:');
      const eventCounts = new Map<string, number>();
      sessionLogs.forEach((log) => {
        eventCounts.set(log.eventType, (eventCounts.get(log.eventType) || 0) + 1);
      });

      Array.from(eventCounts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([eventType, count]) => {
          console.log(`  ${eventType.padEnd(25)} ${count} 条`);
        });

      // 显示最后几条日志
      console.log('\n📝 最后 3 条日志:');
      sessionLogs.slice(-3).forEach((log, index) => {
        console.log(`\n  ${index + 1}. ${log.eventType} (迭代 ${log.iteration})`);
        console.log(`     时间: ${log.timestamp}`);
        if (log.eventType === 'session_complete') {
          console.log(`     总迭代: ${log.totalIterations}`);
          console.log(`     总耗时: ${log.totalDurationMs}ms`);
          console.log(`     总 Token: ${log.totalUsage.input + log.totalUsage.output}`);
          console.log(`     总成本: $${log.totalCost}`);
          console.log(`     工具调用: ${log.toolStats.length} 种`);
        }
      });

      console.log('\n🔍 测试查询功能...');

      // 测试查询：按事件类型
      const errorLogs = await AgentLoopLogger.query({
        sessionId,
        eventType: ['error_caught', 'llm_retry'],
      });
      console.log(`✅ 查询错误日志: ${errorLogs.length} 条`);

      // 测试查询：按迭代范围
      const iteration2Logs = await AgentLoopLogger.query({
        sessionId,
        iterationRange: { min: 2, max: 2 },
      });
      console.log(`✅ 查询迭代 2 日志: ${iteration2Logs.length} 条`);

      // 测试会话摘要
      const summary = await AgentLoopLogger.getSessionSummary(sessionId);
      if (summary) {
        console.log('\n📊 会话摘要:');
        console.log(`  会话 ID: ${summary.sessionId}`);
        console.log(`  总迭代: ${summary.totalIterations}`);
        console.log(`  总耗时: ${summary.totalDurationMs}ms`);
        console.log(`  总 Token: ${summary.totalTokens}`);
        console.log(`  总成本: $${summary.totalCost}`);
        console.log(`  错误数: ${summary.errorCount}`);
        console.log(`  工具调用: ${summary.toolCallCount}`);
        console.log(`  事件统计:`, Object.keys(summary.events).length, '种事件');
      }

      console.log('\n✅ 所有测试通过！');
    } else {
      console.error(`❌ 日志文件不存在: ${logPath}`);
    }
  } catch (error) {
    console.error('❌ 测试失败:', error);
    throw error;
  }
}

// 运行测试
testAgentLoopLogger().catch(console.error);
