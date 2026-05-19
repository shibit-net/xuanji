/**
 * 记忆系统全局引用
 *
 * MemorySearchTool / MemoryStoreTool 通过此模块获取 MemoryManager 实例。
 * SessionFactory 在初始化时调用 registerMemoryManager() 设置。
 */

import type { MemoryManager } from '@/core/memory/MemoryManager';

let instance: MemoryManager | null = null;
let initError: string | null = null;

export function registerMemoryManager(manager: MemoryManager): void {
  instance = manager;
  initError = null;
}

export function getMemoryManager(): MemoryManager | null {
  return instance;
}

export function unregisterMemoryManager(): void {
  instance = null;
  initError = null;
}

export function setMemoryInitError(error: string): void {
  initError = error;
}

export function getMemoryInitError(): string | null {
  return initError;
}
