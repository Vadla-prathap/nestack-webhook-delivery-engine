const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const databasePath =
  process.env.DATABASE_PATH || "./data/webhooks.sqlite";

if (databasePath !== ":memory:") {
  fs.mkdirSync(path.dirname(path.resolve(databasePath)), {
    recursive: true
  });
}

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    webhook_url TEXT NOT NULL,
    status TEXT NOT NULL
      CHECK(status IN ('pending','delivered','failed','dead')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    next_attempt_at TEXT,
    attempts_in_cycle INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_error TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_events_due
    ON events(status, next_attempt_at, locked_until);

  CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    attempted_at TEXT NOT NULL,
    http_status INTEGER,
    outcome TEXT NOT NULL
      CHECK(outcome IN ('success','failed')),
    error TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_attempts_event
    ON attempts(event_id, id);
`);

module.exports = db;