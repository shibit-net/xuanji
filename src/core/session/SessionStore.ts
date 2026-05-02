import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger } from '@/core/logger';
import type { Session } from './types';

const log = logger.child({ module: 'SessionStore' });

export class SessionStore {
  private storageDir: string;

  constructor(userId?: string) {
    const home = os.homedir();
    this.storageDir = path.join(home, '.xuanji', 'users', userId ?? 'default', 'sessions');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  save(session: Session): void {
    const fp = path.join(this.storageDir, `${session.id}.json`);
    fs.writeFileSync(fp, JSON.stringify(session, null, 2), 'utf-8');
    log.debug(`Session saved: ${session.id}`);
  }

  load(sessionId: string): Session | null {
    const fp = path.join(this.storageDir, `${sessionId}.json`);
    if (!fs.existsSync(fp)) return null;
    try {
      return JSON.parse(fs.readFileSync(fp, 'utf-8')) as Session;
    } catch (err) {
      log.error(`Failed to load session ${sessionId}:`, err);
      return null;
    }
  }

  delete(sessionId: string): void {
    const fp = path.join(this.storageDir, `${sessionId}.json`);
    if (fs.existsSync(fp)) { fs.unlinkSync(fp); }
  }

  list(): string[] {
    if (!fs.existsSync(this.storageDir)) return [];
    return fs.readdirSync(this.storageDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }
}
