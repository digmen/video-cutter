import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

// Телеметрия и учёт: кто пользовался, сколько нарезал, где ошибки. И прошёл ли вход по подписке.
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_user_id  INTEGER NOT NULL,
    tg_username TEXT,
    duration    REAL,          -- длительность исходника, сек
    kind        TEXT,          -- range | every | parts
    segments    INTEGER,       -- сколько кусков заказано
    status      TEXT NOT NULL, -- queued | running | done | error
    detail      TEXT,          -- ошибка/примечание
    started_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(tg_user_id);

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_user_id  INTEGER NOT NULL,
    tg_username TEXT,
    step        TEXT NOT NULL, -- start | sub_ok | sub_fail | video_in | cut_ok | cut_err | done
    detail      TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gate_passed (
    tg_user_id INTEGER PRIMARY KEY,
    at         TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export function logEvent(user: { id: number; username?: string }, step: string, detail?: string): void {
  try {
    db.prepare('INSERT INTO events (tg_user_id, tg_username, step, detail) VALUES (?, ?, ?, ?)').run(
      user.id,
      user.username ?? null,
      step,
      detail ?? null,
    );
  } catch {
    /* журнал не должен ронять бота */
  }
}

export function markGatePassed(userId: number): void {
  db.prepare('INSERT OR IGNORE INTO gate_passed (tg_user_id) VALUES (?)').run(userId);
}
export function gatePassed(userId: number): boolean {
  return db.prepare('SELECT 1 FROM gate_passed WHERE tg_user_id = ?').get(userId) !== undefined;
}

export function createJob(user: { id: number; username?: string }, duration: number, kind: string, segments: number): number {
  const r = db
    .prepare(`INSERT INTO jobs (tg_user_id, tg_username, duration, kind, segments, status) VALUES (?, ?, ?, ?, ?, 'queued')`)
    .run(user.id, user.username ?? null, duration, kind, segments);
  return Number(r.lastInsertRowid);
}
export function setJobStatus(id: number, status: string, detail?: string): void {
  const now = `datetime('now')`;
  if (status === 'running') db.prepare(`UPDATE jobs SET status='running', started_at=${now} WHERE id=?`).run(id);
  else if (status === 'done' || status === 'error')
    db.prepare(`UPDATE jobs SET status=?, detail=?, finished_at=${now} WHERE id=?`).run(status, detail ?? null, id);
  else db.prepare('UPDATE jobs SET status=?, detail=? WHERE id=?').run(status, detail ?? null, id);
}

/** Активные (queued|running) задачи этого пользователя — для лимита «в очереди по одной на человека». */
export function activeJobsOf(userId: number): number {
  return (db.prepare(`SELECT COUNT(*) c FROM jobs WHERE tg_user_id=? AND status IN ('queued','running')`).get(userId) as { c: number }).c;
}

export interface Stats {
  users: number;
  jobs: number;
  done: number;
  errors: number;
  segments: number;
}
export function stats(): Stats {
  const g = (q: string) => (db.prepare(q).get() as { c: number }).c;
  return {
    users: g('SELECT COUNT(DISTINCT tg_user_id) c FROM jobs'),
    jobs: g('SELECT COUNT(*) c FROM jobs'),
    done: g(`SELECT COUNT(*) c FROM jobs WHERE status='done'`),
    errors: g(`SELECT COUNT(*) c FROM jobs WHERE status='error'`),
    segments: g(`SELECT COALESCE(SUM(segments),0) c FROM jobs WHERE status='done'`),
  };
}
