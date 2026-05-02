import type { LoggedEvent } from './types';

export class EventLog {
  private log: LoggedEvent[] = [];
  private maxSize = 200;
  private counter = 0;

  record(event: string, payload: any): void {
    this.log.push({ id: `ev-${++this.counter}`, event, timestamp: Date.now(), payload });
    if (this.log.length > this.maxSize) {
      this.log = this.log.slice(-this.maxSize);
    }
  }

  getRecent(count: number = 50): LoggedEvent[] {
    return this.log.slice(-count);
  }

  clear(): void { this.log = []; }
  get size(): number { return this.log.length; }
}
