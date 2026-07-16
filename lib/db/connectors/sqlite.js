import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { hashPassword, verifyPassword } from "../../password.js";

export const SQLITE_DB_PATH =
  process.env.DATABASE_PATH || path.join(process.cwd(), "data", "tinitiate.db");

// better-sqlite3 can't bind Date/boolean directly. Serialize Date to the same
// 'YYYY-MM-DD HH:MM:SS' UTC text that datetime('now') stores, so timestamp
// comparisons (passed as Date params) work the same as on Postgres.
function toSqliteParam(p) {
  if (p instanceof Date) return p.toISOString().slice(0, 19).replace("T", " ");
  if (typeof p === "boolean") return p ? 1 : 0;
  return p;
}

// Async connector interface shared with the Postgres connector:
//   prepare(sql).get/all/run(...params) -> Promise
//   tx(async ({ prepare }) => { ... })   -> Promise
// SQLite is synchronous under the hood; the async shape just lets the two
// backends be swapped behind a single `DB_CONNECTOR` without changing callers.
export function createSqliteConnector() {
  fs.mkdirSync(path.dirname(SQLITE_DB_PATH), { recursive: true });
  const db = new Database(SQLITE_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  bootstrapAdmin(db);

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  const ser = (params) => (params || []).map(toSqliteParam);

  function prepare(sql) {
    return {
      // .get() also handles INSERT ... RETURNING id (SQLite 3.35+).
      async get(...params) {
        return stmt(sql).get(...ser(params));
      },
      async all(...params) {
        return stmt(sql).all(...ser(params));
      },
      async run(...params) {
        const info = stmt(sql).run(...ser(params));
        return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
      },
    };
  }

  async function tx(fn) {
    db.exec("BEGIN");
    try {
      const result = await fn({ prepare });
      db.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw err;
    }
  }

  return { kind: "sqlite", prepare, tx, raw: db };
}

function runtimeEnv(parts, fallback = "") {
  return process.env[parts.join("_")] || fallback;
}

// First-boot admin for fresh deploys: with an empty users table and
// ADMIN_EMAIL + ADMIN_PASSWORD set, create the business + admin login so a
// brand-new database is usable without running the demo seed.
function bootstrapAdmin(db) {
  const email = runtimeEnv(["ADMIN", "EMAIL"]).trim();
  const password = runtimeEnv(["ADMIN", "PASSWORD"]);
  if (!email || !password) return;
  const existing = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email);
  if (existing) {
    if (!verifyPassword(password, existing.password_hash)) {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), existing.id);
    }
    return;
  }

  let business = db.prepare("SELECT id FROM businesses ORDER BY id LIMIT 1").get();
  if (!business) {
    const biz = db
      .prepare("INSERT INTO businesses (name, admin_number, provider, currency) VALUES (?, ?, ?, ?)")
      .run(
        runtimeEnv(["BUSINESS", "NAME"], "AgenticThat"),
        runtimeEnv(["WA", "FROM"]),
        runtimeEnv(["WA", "PROVIDER"], "mock"),
        runtimeEnv(["CURRENCY"], "INR")
      );
    business = { id: biz.lastInsertRowid };
  }
  db.prepare(
    "INSERT INTO users (business_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')"
  ).run(business.id, "Admin", email, hashPassword(password));
}

// One deployment serves one business (single-tenant), but every row carries a
// business_id so the same schema can grow into multi-tenant later.
function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      admin_number  TEXT,
      provider      TEXT NOT NULL DEFAULT 'mock',
      currency      TEXT NOT NULL DEFAULT 'INR',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'admin',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id      INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      phone            TEXT NOT NULL,
      tags             TEXT,
      notes            TEXT,
      opted_in         INTEGER NOT NULL DEFAULT 1,
      last_activity_at TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(business_id, phone)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS templates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'marketing',
      body        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      contact_id    INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      direction     TEXT NOT NULL,
      body          TEXT NOT NULL,
      template_name TEXT,
      status        TEXT NOT NULL DEFAULT 'queued',
      provider_id   TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, created_at);
  `);

  ensureColumn(db, "messages", "kind", "TEXT NOT NULL DEFAULT 'text'");
  ensureColumn(db, "messages", "buttons", "TEXT");
  ensureColumn(db, "messages", "reply_to_id", "INTEGER");
  ensureColumn(db, "contacts", "last_read_message_id", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "messages", "phone_number_id", "TEXT");
}

function ensureColumn(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (err) {
    if (!/duplicate column name/i.test(String(err && err.message))) throw err;
  }
}
