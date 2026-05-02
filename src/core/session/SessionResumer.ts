import { logger } from '@/core/logger';
import type { Session } from './types';
import type { SessionStore } from './SessionStore';

const log = logger.child({ module: 'SessionResumer' });

export class SessionResumer {
  private store: SessionStore;

  constructor(store: SessionStore) {
    this.store = store;
  }

  async resume(sessionId: string): Promise<Session | null> {
    const session = this.store.load(sessionId);
    if (!session) {
      log.warn(`Session not found: ${sessionId}`);
      return null;
    }

    session.status = 'active';
    session.updatedAt = Date.now();
    this.store.save(session);

    log.info(`Session resumed: ${sessionId} (${session.messages.length} messages)`);
    return session;
  }

  listSessions(): Array<{ id: string; name: string }> {
    const ids = this.store.list();
    const results: Array<{ id: string; name: string }> = [];
    for (const id of ids) {
      const s = this.store.load(id);
      if (s) results.push({ id: s.id, name: s.name });
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }
}
