/**
 * StoreEventBus — Store 间交叉通知的解耦总线。
 *
 * 各 Store 只 import storeEventBus，不 import 彼此，消除循环依赖。
 */

type EventHandler = (...args: any[]) => void;

class StoreEventBusImpl {
  private handlers = new Map<string, Set<EventHandler>>();

  on(event: string, handler: EventHandler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (set!.size === 0) this.handlers.delete(event);
    };
  }

  emit(event: string, ...args: any[]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(...args);
      } catch {
        /* isolate */
      }
    }
  }

  off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  offAll(event: string): void {
    this.handlers.delete(event);
  }
}

export const storeEventBus = new StoreEventBusImpl();
export { StoreEventBusImpl as StoreEventBus };
