import type { IMessageRouter, MessageHandler } from '@/shared/plugin';

interface RouteEntry {
  pattern: RegExp;
  handler: MessageHandler;
}

export class MessageRouter implements IMessageRouter {
  private routes: RouteEntry[] = [];

  registerHandler(pattern: string, handler: MessageHandler): void {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/:/g, '([^:]+)') + '$'
    );
    this.routes.push({ pattern: regex, handler });
  }

  async dispatch<T>(pattern: string, payload?: unknown): Promise<T> {
    for (const route of this.routes) {
      const match = route.pattern.exec(pattern);
      if (match) {
        return (await route.handler(payload)) as T;
      }
    }
    throw new Error(`No handler registered for message: "${pattern}"`);
  }

  clear(): void {
    this.routes = [];
  }
}
