// ============================================================
// 经验教训系统 - 端到端测试
// ============================================================
// 测试场景：
// 1. 工具执行失败 → 自动创建失败教训
// 2. 用户纠正输入 → 自动创建纠正教训
// 3. LessonStore 存储和检索
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LessonDetector } from '@/learning/LessonDetector';
import { LessonStore } from '@/learning/LessonStore';
import type { ToolCallContext, AgentContext } from '@/learning/LessonDetector';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('Lesson System E2E', () => {
  let detector: LessonDetector;
  let store: LessonStore;
  let testDir: string;

  beforeAll(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `xuanji-lesson-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    // 初始化 Detector 和 Store
    detector = new LessonDetector();
    store = new LessonStore(testDir);
    await store.init();
  });

  afterAll(async () => {
    // 清理测试数据
    store.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('工具失败检测', () => {
    it('应该从工具执行失败中创建教训', async () => {
      const toolCall: ToolCallContext = {
        toolName: 'bash',
        input: { command: 'invalid-command' },
        output: undefined,
        error: 'Command not found: invalid-command',
        success: false,
        duration: 100,
      };

      const context: AgentContext = {
        task: '执行命令',
        userInput: '运行 invalid-command',
        assistantAction: '使用 bash 工具执行命令',
        files: [],
        toolsUsed: ['bash'],
        cwd: '/test',
        projectType: 'typescript',
      };

      const lesson = await detector.createLessonFromToolFailure(toolCall, context);

      // 验证教训结构
      expect(lesson.type).toBe('failure');
      expect(lesson.domain).toBe('coding'); // bash 工具归类为 coding
      expect(lesson.experience.title).toContain('bash');
      expect(lesson.experience.title).toContain('失败');
      expect(lesson.experience.description).toContain('invalid-command');
      expect(lesson.experience.impact).toBe('major'); // bash 是关键工具
      expect(lesson.experience.discoveredBy).toBe('tool_result');

      // 保存到 LessonStore
      const lessonId = await store.add(lesson);
      expect(lessonId).toBeTruthy();

      // 从 Store 中检索
      const retrieved = await store.get(lessonId);
      expect(retrieved).toBeTruthy();
      expect(retrieved?.experience.title).toBe(lesson.experience.title);
    });
  });

  describe('用户纠正检测', () => {
    it('应该检测"不是...应该是..."模式', () => {
      const input1 = '不是修改文件A，应该是修改文件B';
      const result1 = detector.detectCorrectionPattern(input1);
      expect(result1.isCorrection).toBe(true);
      expect(result1.originalAction).toContain('修改文件A');
      expect(result1.correction).toContain('修改文件B');

      const input2 = '错了，应该使用 npm 而不是 yarn';
      const result2 = detector.detectCorrectionPattern(input2);
      expect(result2.isCorrection).toBe(true);
      expect(result2.correction).toContain('使用 npm 而不是 yarn');
    });

    it('应该从用户纠正创建教训', async () => {
      const context: AgentContext = {
        task: '安装依赖',
        userInput: '不是用 yarn，应该用 npm',
        assistantAction: '使用 yarn install 安装依赖',
        files: ['package.json'],
        toolsUsed: ['bash'],
        cwd: '/project',
      };

      const lesson = await detector.createLessonFromUserCorrection(
        '使用 yarn install',
        '使用 npm install',
        context
      );

      expect(lesson.type).toBe('failure');
      expect(lesson.domain).toBe('communication');
      expect(lesson.experience.title).toBe('误解用户意图');
      expect(lesson.experience.description).toContain('yarn');
      expect(lesson.experience.description).toContain('npm');

      // 保存并检索
      const lessonId = await store.add(lesson);
      const retrieved = await store.get(lessonId);
      expect(retrieved?.domain).toBe('communication');
    });
  });

  describe('语义搜索', () => {
    it('应该通过语义搜索找到相关教训', async () => {
      // 添加几条测试教训
      const lessons = [
        {
          type: 'failure' as const,
          domain: 'coding' as const,
          experience: {
            title: 'TypeScript 类型错误',
            description: '使用了错误的类型注解导致编译失败',
            impact: 'minor' as const,
            discoveredBy: 'tool_result' as const,
          },
          context: {
            task: '修复类型错误',
            userInput: '修复 TypeScript 错误',
            myAction: '修改类型注解',
            files: ['index.ts'],
            toolsUsed: ['edit'],
            cwd: '/test',
          },
          verification: {
            applied: false,
            verified: false,
            applicationCount: 0,
            successCount: 0,
          },
        },
        {
          type: 'success' as const,
          domain: 'tool_usage' as const,
          experience: {
            title: '成功使用 grep 搜索代码',
            description: '使用 grep 工具快速定位了目标代码',
            impact: 'minor' as const,
            discoveredBy: 'tool_result' as const,
          },
          context: {
            task: '搜索代码',
            userInput: '找到包含 handleError 的文件',
            myAction: '使用 grep 工具',
            files: [],
            toolsUsed: ['grep'],
            cwd: '/test',
          },
          verification: {
            applied: false,
            verified: false,
            applicationCount: 0,
            successCount: 0,
          },
        },
      ];

      for (const lesson of lessons) {
        await store.add(lesson);
      }

      // 搜索 TypeScript 相关教训
      const results = await store.search({
        query: 'TypeScript 编译错误',
        limit: 10,
      });

      // 应该能找到 TypeScript 相关的教训
      expect(results.length).toBeGreaterThan(0);
      const tsLesson = results.find((l) => l.experience.title.includes('TypeScript'));
      expect(tsLesson).toBeTruthy();
    });

    it('应该支持按类型和领域过滤', async () => {
      const results = await store.search({
        type: 'failure',
        domain: 'coding',
      });

      // 所有结果都应该符合过滤条件
      results.forEach((lesson) => {
        expect(lesson.type).toBe('failure');
        expect(lesson.domain).toBe('coding');
      });
    });
  });

  describe('统计信息', () => {
    it('应该正确统计教训数量', async () => {
      const stats = await store.getStats();

      expect(stats.total).toBeGreaterThan(0);
      expect(typeof stats.byType.failure).toBe('number');
      expect(typeof stats.byType.success).toBe('number');
      expect(typeof stats.byDomain.coding).toBe('number');
      expect(typeof stats.byDomain.communication).toBe('number');
      expect(stats.verified).toBeGreaterThanOrEqual(0);
      expect(stats.applied).toBeGreaterThanOrEqual(0);
    });
  });

  describe('更新和删除', () => {
    it('应该支持更新教训', async () => {
      // 创建一条教训
      const lesson = {
        type: 'failure' as const,
        domain: 'debugging' as const,
        experience: {
          title: '调试技巧',
          description: '使用 console.log 调试',
          impact: 'minor' as const,
          discoveredBy: 'self_reflection' as const,
        },
        context: {
          task: '调试代码',
          userInput: '找到 bug',
          myAction: '添加日志',
          files: [],
          toolsUsed: [],
          cwd: '/test',
        },
        verification: {
          applied: false,
          verified: false,
          applicationCount: 0,
          successCount: 0,
        },
      };

      const lessonId = await store.add(lesson);

      // 更新验证状态
      await store.update(lessonId, {
        verification: {
          applied: true,
          verified: true,
          applicationCount: 1,
          successCount: 1,
        },
      });

      // 验证更新
      const updated = await store.get(lessonId);
      expect(updated?.verification.applied).toBe(true);
      expect(updated?.verification.verified).toBe(true);
      expect(updated?.verification.applicationCount).toBe(1);
    });

    it('应该支持删除教训', async () => {
      const lesson = {
        type: 'failure' as const,
        domain: 'workflow' as const,
        experience: {
          title: '待删除的教训',
          description: '这条教训将被删除',
          impact: 'minor' as const,
          discoveredBy: 'user_feedback' as const,
        },
        context: {
          task: '测试删除',
          userInput: '测试',
          myAction: '测试',
          files: [],
          toolsUsed: [],
          cwd: '/test',
        },
        verification: {
          applied: false,
          verified: false,
          applicationCount: 0,
          successCount: 0,
        },
      };

      const lessonId = await store.add(lesson);

      // 验证存在
      let retrieved = await store.get(lessonId);
      expect(retrieved).toBeTruthy();

      // 删除
      await store.delete(lessonId);

      // 验证已删除
      retrieved = await store.get(lessonId);
      expect(retrieved).toBeNull();
    });
  });
});
