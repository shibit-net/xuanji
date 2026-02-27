// ============================================================
// MemoryStoreTool 单元测试
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { MemoryStoreTool } from '@/core/tools/MemoryStoreTool';
import { MemoryManager } from '@/memory/MemoryManager';

describe('MemoryStoreTool', () => {
  let tool: MemoryStoreTool;
  let tempGlobalDir: string;
  let tempProjectDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    tempGlobalDir = await mkdtemp(join(tmpdir(), 'xuanji-store-global-'));
    tempProjectDir = await mkdtemp(join(tmpdir(), 'xuanji-store-project-'));

    manager = new MemoryManager({}, tempProjectDir);
    // 覆盖全局目录实现测试隔离
    manager['longTerm']['globalDir'] = tempGlobalDir;
    await manager.init();

    tool = new MemoryStoreTool();
    tool.setMemoryManager(manager);
  });

  afterEach(async () => {
    for (const dir of [tempGlobalDir, tempProjectDir]) {
      if (existsSync(dir)) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('should store user_preference memory', async () => {
    const result = await tool.execute({
      type: 'user_preference',
      content: 'Does not eat spicy food',
      keywords: ['food', 'spicy', 'preference'],
      confidence: 0.9,
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('Memory stored');
    expect(result.content).toContain('user_preference');

    // 验证文件写入
    const filePath = join(tempGlobalDir, 'knowledge.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const content = await readFile(filePath, 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry.type).toBe('user_preference');
    expect(entry.content).toBe('Does not eat spicy food');
    expect(entry.source).toBe('llm-explicit');
    expect(entry.confidence).toBe(0.9);
  });

  it('should store relationship memory to personal.jsonl', async () => {
    const result = await tool.execute({
      type: 'relationship',
      content: 'Alice likes Japanese cuisine',
      keywords: ['Alice', 'japanese', 'cuisine'],
      confidence: 0.85,
    });

    expect(result.isError).toBe(false);

    // 验证写入 personal.jsonl
    const filePath = join(tempGlobalDir, 'personal.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const content = await readFile(filePath, 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry.type).toBe('relationship');
    expect(entry.content).toBe('Alice likes Japanese cuisine');
  });

  it('should store important_date memory to personal.jsonl', async () => {
    const result = await tool.execute({
      type: 'important_date',
      content: "Alice's birthday is March 8th",
      keywords: ['Alice', 'birthday', 'march'],
      confidence: 0.95,
    });

    expect(result.isError).toBe(false);

    const filePath = join(tempGlobalDir, 'personal.jsonl');
    expect(existsSync(filePath)).toBe(true);
  });

  it('should use default confidence of 0.8', async () => {
    const result = await tool.execute({
      type: 'user_fact',
      content: 'Works as a software engineer',
      keywords: ['software', 'engineer', 'job'],
      // no confidence provided
    });

    expect(result.isError).toBe(false);
    expect(result.metadata?.confidence).toBe(0.8);
  });

  it('should reject missing type', async () => {
    const result = await tool.execute({
      content: 'Some content',
      keywords: ['test'],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('type');
  });

  it('should reject empty content', async () => {
    const result = await tool.execute({
      type: 'user_preference',
      content: '',
      keywords: ['test'],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('content');
  });

  it('should reject empty keywords array', async () => {
    const result = await tool.execute({
      type: 'user_preference',
      content: 'Some preference',
      keywords: [],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('keywords');
  });

  it('should reject confidence below 0.6', async () => {
    const result = await tool.execute({
      type: 'user_preference',
      content: 'Some preference',
      keywords: ['test'],
      confidence: 0.3,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('confidence');
  });

  it('should reject confidence above 1.0', async () => {
    const result = await tool.execute({
      type: 'user_preference',
      content: 'Some preference',
      keywords: ['test'],
      confidence: 1.5,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('confidence');
  });

  it('should error when memory manager is not set', async () => {
    const toolWithoutManager = new MemoryStoreTool();

    const result = await toolWithoutManager.execute({
      type: 'user_preference',
      content: 'Some preference',
      keywords: ['test'],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('not available');
  });

  it('should lowercase and trim keywords', async () => {
    const result = await tool.execute({
      type: 'user_preference',
      content: 'Prefers dark mode',
      keywords: [' Dark ', 'MODE', '  Editor  '],
    });

    expect(result.isError).toBe(false);

    const filePath = join(tempGlobalDir, 'knowledge.jsonl');
    const content = await readFile(filePath, 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry.keywords).toEqual(['dark', 'mode', 'editor']);
  });

  it('should have correct tool metadata', () => {
    expect(tool.name).toBe('memory_store');
    expect(tool.readonly).toBe(false);
    expect(tool.input_schema.required).toContain('type');
    expect(tool.input_schema.required).toContain('content');
    expect(tool.input_schema.required).toContain('keywords');
  });
});
