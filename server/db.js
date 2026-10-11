// Storage. The same SQL runs on Cloudflare D1 (production) and on node:sqlite (local),
// behind a three-method adapter: all(sql, ...params), get(sql, ...params), run(sql, ...params).
import { SEED } from './seed.js'

// Append new arrays to add a migration; never edit one that has shipped.
const MIGRATIONS = [
  [
    `CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, department TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '', web_search INTEGER NOT NULL DEFAULT 0, is_manager INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '#4f6bff', look TEXT NOT NULL DEFAULT '{}',
      floor INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, idle TEXT NOT NULL DEFAULT 'auto',
      archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE tasks (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'task', title TEXT NOT NULL, description TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '', agent_id TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'queued', due_at TEXT, plan_id TEXT, auto INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1, feedback TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '', activity TEXT NOT NULL DEFAULT '', run_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT)`,
    `CREATE TABLE task_deps (task_id TEXT NOT NULL, depends_on TEXT NOT NULL, PRIMARY KEY (task_id, depends_on))`,
    `CREATE TABLE runs (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent_id TEXT NOT NULL, revision INTEGER NOT NULL,
      status TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, output TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, finished_at TEXT)`,
    `CREATE TABLE attachments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, type TEXT NOT NULL, actor TEXT NOT NULL, agent_id TEXT, task_id TEXT, message TEXT NOT NULL)`,
    `CREATE TABLE messages (id TEXT PRIMARY KEY, at TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, plan TEXT, plan_status TEXT, task_id TEXT)`,
    `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE INDEX tasks_agent ON tasks (agent_id, status)`,
    `CREATE INDEX events_task ON events (task_id)`,
    `CREATE INDEX events_agent ON events (agent_id)`,
    `CREATE INDEX runs_task ON runs (task_id)`,
  ],
]

export function d1(binding) {
  const stmt = (sql, params) => (params.length ? binding.prepare(sql).bind(...params) : binding.prepare(sql))
  return {
    all: async (sql, ...params) => (await stmt(sql, params).all()).results,
    get: async (sql, ...params) => (await stmt(sql, params).first()) ?? undefined,
    run: async (sql, ...params) => ({ changes: (await stmt(sql, params).run()).meta.changes }),
  }
}

// `database` is a node:sqlite DatabaseSync; office.mjs passes it in so this file stays free of Node imports.
export function sqlite(database) {
  return {
    all: async (sql, ...params) => database.prepare(sql).all(...params),
    get: async (sql, ...params) => database.prepare(sql).get(...params),
    run: async (sql, ...params) => ({ changes: Number(database.prepare(sql).run(...params).changes) }),
  }
}

const prepared = new WeakMap()

// Creates the tables and, on a brand-new database, hires the agents defined in agents/*.md.
export function ready(db) {
  if (!prepared.has(db)) prepared.set(db, migrate(db).catch((e) => (prepared.delete(db), Promise.reject(e))))
  return prepared.get(db)
}

async function migrate(db) {
  await db.run('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)')
  const row = await db.get('SELECT MAX(v) AS v FROM schema_version')
  const done = row?.v ?? 0
  for (let v = done; v < MIGRATIONS.length; v++) {
    for (const sql of MIGRATIONS[v]) await db.run(sql)
    await db.run('INSERT INTO schema_version (v) VALUES (?)', v + 1)
  }
  if (done === 0) {
    const at = new Date().toISOString()
    for (const a of SEED) {
      await db.run(
        `INSERT INTO agents (id, name, role, department, description, instructions, web_search, is_manager, color, look, floor, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        a.id, a.name, a.role, a.department, a.description, a.instructions, a.web_search, a.is_manager, a.color, JSON.stringify(a.look), a.floor, a.sort, at, at,
      )
    }
  }
}

export const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`

export async function log(db, type, actor, message, { agent = null, task = null } = {}) {
  await db.run('INSERT INTO events (at, type, actor, agent_id, task_id, message) VALUES (?, ?, ?, ?, ?, ?)', new Date().toISOString(), type, actor, agent, task, message)
}

export async function setting(db, key, fallback = '') {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', key)
  return row ? row.value : fallback
}

export async function setSetting(db, key, value) {
  await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, String(value))
}
