import type { ResearchEngine } from './ingest/engine.ts';
import type { WorldRepo } from './worldRepo.ts';
import type { UserRepo } from './userRepo.ts';
import type { BackupManager } from './backup.ts';

/**
 * Checks once a minute whether a research update or a daily user backup is due.
 * Using "time since last run" (persisted in the DB) instead of a fixed timer means the
 * schedule survives restarts and sleeping laptops.
 */
export class Scheduler {
  timer: NodeJS.Timeout | null = null;
  engine: ResearchEngine;
  world: WorldRepo;
  user: UserRepo;
  backups: BackupManager;
  defaultInterval: number;
  log: (m: string) => void;

  constructor(o: { engine: ResearchEngine; world: WorldRepo; user: UserRepo; backups: BackupManager; defaultInterval: number; log: (m: string) => void }) {
    this.engine = o.engine;
    this.world = o.world;
    this.user = o.user;
    this.backups = o.backups;
    this.defaultInterval = o.defaultInterval;
    this.log = o.log;
  }

  intervalHours(): number {
    const h = Number(this.user.getSetting('updateIntervalHours', this.defaultInterval));
    return Number.isFinite(h) && h >= 1 ? h : this.defaultInterval;
  }

  nextRunAt(): string | null {
    const last = this.world.lastRun();
    if (!last) return new Date().toISOString();
    return new Date(Date.parse(last.startedAt) + this.intervalHours() * 3600_000).toISOString();
  }

  tick(): void {
    try {
      const last = this.world.lastRun();
      const due = !last || Date.now() - Date.parse(last.startedAt) >= this.intervalHours() * 3600_000;
      if (due && !this.engine.isRunning()) {
        void this.engine.run(last ? 'schedule' : 'startup').catch((e) => this.log(`scheduled update failed: ${(e as Error).message}`));
      }
      if (Date.now() - this.backups.lastAutoBackupAt() > 24 * 3600_000) {
        const b = this.backups.backupUser(this.user.db, 'auto');
        this.log(`daily user backup written: ${b.name}`);
      }
    } catch (e) {
      this.log(`scheduler error: ${(e as Error).message}`);
    }
  }

  start(): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
