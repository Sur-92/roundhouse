import type Database from 'better-sqlite3'

/**
 * Tiny migration runner — executes pending migrations in order, tracks
 * what's been applied in a _migrations table.
 *
 * Migrations are idempotent: each guards itself with a feature check
 * (read sqlite_master, look at PRAGMA table_info, etc.) before doing
 * any DDL, so even if the bookkeeping table was lost, re-running is safe.
 */

interface Migration {
  id: string
  name: string
  up: (db: Database.Database) => void
}

const MIGRATIONS: Migration[] = [
  {
    id: '2026-04-29_drop_items_type_check',
    name: 'Drop CHECK constraint on items.type to allow user-defined types',
    up: (db) => {
      // Has the CHECK been removed already? sqlite_master holds the original CREATE.
      const row = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='items'"
      ).get() as { sql: string } | undefined
      if (!row || !/CHECK\s*\(\s*type\s+IN/i.test(row.sql)) return

      // SQLite doesn't support ALTER TABLE DROP CONSTRAINT — rebuild the table.
      db.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN;

        CREATE TABLE items_new (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          set_id               INTEGER REFERENCES sets(id) ON DELETE SET NULL,
          type                 TEXT    NOT NULL,
          name                 TEXT    NOT NULL,
          manufacturer         TEXT,
          model_number         TEXT,
          scale                TEXT,
          road_name            TEXT,
          era                  TEXT,
          year                 INTEGER,
          condition            TEXT,
          original_box         INTEGER CHECK (original_box IN (0, 1)),
          purchase_date        TEXT,
          purchase_price_cents INTEGER,
          current_value_cents  INTEGER,
          storage_location     TEXT,
          source               TEXT,
          notes                TEXT,
          created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );

        INSERT INTO items_new (
          id, set_id, type, name, manufacturer, model_number, scale,
          road_name, era, year, condition, original_box,
          purchase_date, purchase_price_cents, current_value_cents,
          storage_location, source, notes, created_at, updated_at
        )
        SELECT
          id, set_id, type, name, manufacturer, model_number, scale,
          road_name, era, year, condition, original_box,
          purchase_date, purchase_price_cents, current_value_cents,
          storage_location, source, notes, created_at, updated_at
        FROM items;

        DROP TABLE items;
        ALTER TABLE items_new RENAME TO items;

        CREATE INDEX IF NOT EXISTS idx_items_set    ON items(set_id);
        CREATE INDEX IF NOT EXISTS idx_items_type   ON items(type);
        CREATE INDEX IF NOT EXISTS idx_items_scale  ON items(scale);
        CREATE INDEX IF NOT EXISTS idx_items_source ON items(source);

        COMMIT;
        PRAGMA foreign_keys = ON;
      `)

      // Triggers don't survive the table rebuild — re-create.
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_items_updated
          AFTER UPDATE ON items FOR EACH ROW
          BEGIN
            UPDATE items
               SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
             WHERE id = OLD.id;
          END;
      `)
    }
  }
]

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         TEXT    PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `)

  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map((r) => r.id)
  )
  const recordApplied = db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)')

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    console.log(`[migrations] applying: ${m.id}`)
    m.up(db)
    recordApplied.run(m.id, m.name)
  }
}
