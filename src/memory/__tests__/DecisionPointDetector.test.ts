// ============================================================
// DecisionPointDetector 单元测试
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionPointDetector } from '../DecisionPointDetector';
import type { ToolCall } from '@/core/types';

describe('DecisionPointDetector', () => {
  let detector: DecisionPointDetector;

  beforeEach(() => {
    detector = new DecisionPointDetector();
  });

  describe('detectFromTool', () => {
    it('应该检测到 bash 命令执行决策点', async () => {
      const toolCall: ToolCall = {
        id: 'test-1',
        name: 'bash',
        input: { command: 'npm install axios' }
      };

      const points = await detector.detect({ toolCall, userMessage: '' });

      expect(points).toHaveLength(1);
      expect(points[0].type).toBe('command-execution');
      expect(points[0].tool).toBe('bash');
      expect(points[0].keywords).toContain('npm');
      expect(points[0].keywords).toContain('install');
    });

    it('应该检测到文件创建决策点', async () => {
      const toolCall: ToolCall = {
        id: 'test-2',
        name: 'write',
        input: { file_path: 'package.json', content: '{}' }
      };

      const points = await detector.detect({ toolCall, userMessage: '' });

      expect(points).toHaveLength(1);
      expect(points[0].type).toBe('file-creation');
      expect(points[0].keywords).toContain('package.json');
    });

    it('应该忽略无关键词的工具调用', async () => {
      const toolCall: ToolCall = {
        id: 'test-3',
        name: 'bash',
        input: { command: 'echo hello' }
      };

      const points = await detector.detect({ toolCall, userMessage: '' });

      // 可能检测到用户消息决策点，但不应该有工具决策点
      const toolPoints = points.filter(p => p.tool === 'bash');
      expect(toolPoints).toHaveLength(0);
    });
  });

  describe('detectFromThinking', () => {
    it('应该检测到中文决策关键词', async () => {
      const thinking = '我应该用 pnpm 来安装依赖，因为项目配置了 pnpm-lock.yaml';

      const points = await detector.detect({ thinking, userMessage: '' });

      const thinkingPoints = points.filter(p => p.thinking);
      expect(thinkingPoints.length).toBeGreaterThan(0);
      expect(thinkingPoints[0].type).toBe('tool-choice');
      expect(thinkingPoints[0].keywords).toContain('pnpm');
    });

    it('应该检测到英文决策关键词', async () => {
      const thinking = 'I should use TypeScript for this project';

      const points = await detector.detect({ thinking, userMessage: '' });

      const thinkingPoints = points.filter(p => p.thinking);
      expect(thinkingPoints.length).toBeGreaterThan(0);
      expect(thinkingPoints[0].type).toBe('tool-choice');
    });

    it('应该检测到多个决策点', async () => {
      const thinking = '我决定使用 Vue3，并且选择 TypeScript 作为开发语言';

      const points = await detector.detect({ thinking, userMessage: '' });

      const thinkingPoints = points.filter(p => p.thinking);
      expect(thinkingPoints.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('detectFromUserMessage', () => {
    it('应该检测到创建请求', async () => {
      const userMessage = '帮我创建一个 Vue3 项目';

      const points = await detector.detect({ userMessage });

      expect(points.length).toBeGreaterThan(0);
      expect(points[0].type).toBe('creation-request');
      expect(points[0].keywords).toContain('Vue3');
    });

    it('应该检测到修改请求', async () => {
      const userMessage = '修改配置文件，把端口改成 3000';

      const points = await detector.detect({ userMessage });

      expect(points.length).toBeGreaterThan(0);
      expect(points[0].type).toBe('modification-request');
    });

    it('应该检测到推荐请求', async () => {
      const userMessage = '用什么工具来管理依赖比较好？';

      const points = await detector.detect({ userMessage });

      expect(points.length).toBeGreaterThan(0);
      expect(points[0].type).toBe('recommendation-request');
    });

    it('应该检测到英文请求', async () => {
      const userMessage = 'How to setup a React project?';

      const points = await detector.detect({ userMessage });

      expect(points.length).toBeGreaterThan(0);
      expect(points[0].type).toBe('how-to-request');
    });
  });

  describe('extractKeywords', () => {
    it('应该提取中文关键词', async () => {
      const userMessage = '我想用 Vue3 和 TypeScript 创建一个项目';

      const points = await detector.detect({ userMessage });

      expect(points.length).toBeGreaterThan(0);
      expect(points[0].keywords).toContain('Vue3');
      expect(points[0].keywords).toContain('TypeScript');
      expect(points[0].keywords).toContain('项目');
    });

    it('应该过滤停用词', async () => {
      const userMessage = '我的项目需要一个配置文件';

      const points = await detector.detect({ userMessage });

      expect(points.length).toBeGreaterThan(0);
      // 停用词不应该被提取
      expect(points[0].keywords).not.toContain('的');
      expect(points[0].keywords).not.toContain('一个');
    });

    it('应该限制关键词数量', async () => {
      const userMessage = '帮我创建一个使用 Vue3 TypeScript Vite Pinia Router 的完整项目';

      const points = await detector.detect({ userMessage });

      expect(points.length).toBeGreaterThan(0);
      // 最多5个关键词
      expect(points[0].keywords.length).toBeLessThanOrEqual(5);
    });
  });

  describe('综合检测', () => {
    it('应该同时检测多种决策点', async () => {
      const toolCall: ToolCall = {
        id: 'test-4',
        name: 'bash',
        input: { command: 'pnpm install' }
      };
      const thinking = '我决定用 pnpm 安装依赖';
      const userMessage = '帮我安装依赖';

      const points = await detector.detect({ toolCall, thinking, userMessage });

      // 应该检测到至少2个决策点（工具调用 + thinking/用户消息）
      expect(points.length).toBeGreaterThanOrEqual(2);

      // 应该有工具调用决策点
      const toolPoints = points.filter(p => p.tool === 'bash');
      expect(toolPoints.length).toBeGreaterThan(0);

      // 应该有 thinking 或用户消息决策点
      const otherPoints = points.filter(p => p.thinking || !p.tool);
      expect(otherPoints.length).toBeGreaterThan(0);
    });
  });
});
