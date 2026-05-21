/**
 * ============================================================
 * skill-worker.js — Worker Thread 入口
 * ============================================================
 * 在独立的 Worker 线程中加载并执行 action/workflow Skill。
 *
 * 安全隔离：
 *   - 不继承 process.env（由主线程通过 workerData 传入必要信息）
 *   - 30s 执行超时（由 SkillSandbox 管理）
 *   - 128MB 内存上限（由 SkillSandbox 管理）
 *
 * 协议：
 *   主线程 → workerData: { skillPath, params }
 *   Worker → parentPort.postMessage: { success, output?, error?, metadata? }
 */

'use strict';

const { parentPort, workerData } = require('worker_threads');

if (!parentPort) {
  // 不应该发生 — Worker 必须有 parentPort
  throw new Error('skill-worker.js must run in a Worker thread');
}

const { skillPath, params } = workerData;

(async () => {
  try {
    // 加载 Skill 模块
    // eslint-disable-next-line import/no-dynamic-require
    const skillModule = require(skillPath);
    const skill = skillModule.default || skillModule;

    if (typeof skill.execute !== 'function') {
      throw new Error(`Skill at ${skillPath} does not export a valid execute function`);
    }

    // 执行
    const result = await skill.execute(params || {});

    // 标准化返回值
    if (result && typeof result === 'object' && 'success' in result) {
      parentPort.postMessage(result);
    } else {
      parentPort.postMessage({
        success: true,
        output: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
  } catch (err) {
    parentPort.postMessage({
      success: false,
      error: err && err.message ? err.message : String(err),
    });
  }
})();
