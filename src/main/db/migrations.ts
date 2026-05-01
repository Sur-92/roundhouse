import type Database from 'better-sqlite3'

/**
 * Two-phase migration runner.
 *
 *   Phase 1 — preSchemaMigrations(db):
 *     Idempotent ALTER TABLE migrations. Run BEFORE schema.exec so that
 *     subsequent INSERT OR IGNORE seed rows (which reference new
 *     columns added here) don't fail on existing DBs.
 *
 *   Phase 2 — postSchemaMigrations(db):
 *     Data backfills and side-effecty bootstraps. Run AFTER schema.exec
 *     so that newly-created tables exist when we read/write them.
 *
 * Both phases share a single _migrations bookkeeping table; ids are
 * prefixed to make the phase clear in the log.
 */

interface Migration {
  id: string
  name: string
  up: (db: Database.Database) => void
}

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         TEXT    PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `)
}

function runMigrations(db: Database.Database, list: Migration[]): void {
  ensureMigrationsTable(db)
  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map((r) => r.id)
  )
  const record = db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)')
  for (const m of list) {
    if (applied.has(m.id)) continue
    console.log(`[migrations] applying: ${m.id}`)
    m.up(db)
    record.run(m.id, m.name)
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name)
}

function tableColumns(db: Database.Database, name: string): string[] {
  return (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name)
}

// ─── Phase 1: pre-schema (ALTER TABLE migrations) ────────────

const PRE_SCHEMA: Migration[] = [
  {
    id: 'pre/2026-04-29_add_is_primary_to_item_photos',
    name: 'Add is_primary flag to item_photos and seed it from display_order',
    up: (db) => {
      if (!tableExists(db, 'item_photos')) return
      const cols = tableColumns(db, 'item_photos')
      if (!cols.includes('is_primary')) {
        db.exec(`
          ALTER TABLE item_photos ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;
          UPDATE item_photos
             SET is_primary = 1
           WHERE id IN (
             SELECT id FROM (
               SELECT id, ROW_NUMBER() OVER (
                 PARTITION BY item_id ORDER BY display_order, id
               ) AS rn
               FROM item_photos
             ) t
             WHERE rn = 1
           );
        `)
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_photos_item_primary
          ON item_photos(item_id, is_primary);
      `)
    }
  },
  {
    id: 'pre/2026-04-29_drop_items_type_check',
    name: 'Drop CHECK constraint on items.type to allow user-defined types',
    up: (db) => {
      if (!tableExists(db, 'items')) return
      const row = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='items'"
      ).get() as { sql: string } | undefined
      if (!row || !/CHECK\s*\(\s*type\s+IN/i.test(row.sql)) return

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
  },
  {
    id: 'pre/2026-04-30_add_kind_and_coin_fields',
    name: 'Add kind to collections + lookups, add coin-specific item fields',
    up: (db) => {
      // Add kind to collections (default 'trains' so existing rows are
      // automatically classified correctly).
      if (tableExists(db, 'collections')) {
        const collCols = tableColumns(db, 'collections')
        if (!collCols.includes('kind')) {
          db.exec(`ALTER TABLE collections ADD COLUMN kind TEXT NOT NULL DEFAULT 'trains'`)
          db.exec(`CREATE INDEX IF NOT EXISTS idx_collections_kind ON collections(kind)`)
        }
      }

      // Add the coin-side and direct-collection-link columns to items.
      // Existing train items get NULL for the coin columns and quantity=1.
      if (tableExists(db, 'items')) {
        const itemCols = tableColumns(db, 'items')
        const adds: Array<[string, string]> = [
          ['country', 'TEXT'],
          ['face_value', 'REAL'],
          ['denomination', 'TEXT'],
          ['mint_mark', 'TEXT'],
          ['quantity', 'INTEGER NOT NULL DEFAULT 1'],
          ['collection_id', 'INTEGER REFERENCES collections(id) ON DELETE SET NULL']
        ]
        for (const [col, ddl] of adds) {
          if (!itemCols.includes(col)) {
            db.exec(`ALTER TABLE items ADD COLUMN ${col} ${ddl}`)
          }
        }
        db.exec(`CREATE INDEX IF NOT EXISTS idx_items_collection ON items(collection_id)`)
        db.exec(`CREATE INDEX IF NOT EXISTS idx_items_country    ON items(country)`)
      }

      // Rebuild lookup tables: add kind column + UNIQUE(kind, value).
      // SQLite can't ALTER an existing UNIQUE so we do the temp-table dance.
      for (const t of ['item_types', 'item_scales', 'item_conditions']) {
        if (!tableExists(db, t)) continue
        const cols = tableColumns(db, t)
        if (cols.includes('kind')) continue

        db.exec(`
          BEGIN;
          CREATE TABLE ${t}_new (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            kind       TEXT    NOT NULL DEFAULT 'trains',
            value      TEXT    NOT NULL,
            label      TEXT    NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_system  INTEGER NOT NULL DEFAULT 0,
            created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            UNIQUE(kind, value)
          );
          INSERT INTO ${t}_new (id, kind, value, label, sort_order, is_system, created_at)
          SELECT id, 'trains', value, label, sort_order, is_system, created_at FROM ${t};
          DROP TABLE ${t};
          ALTER TABLE ${t}_new RENAME TO ${t};
          COMMIT;
        `)
      }
    }
  }
]

// ─── Phase 2: post-schema (data backfill) ────────────────────

const POST_SCHEMA: Migration[] = [
  {
    id: 'post/2026-04-30_link_items_to_collections',
    name: 'Link items.collection_id from their set or the default trains collection',
    up: (db) => {
      if (!tableExists(db, 'items') || !tableExists(db, 'collections')) return
      const cols = tableColumns(db, 'items')
      if (!cols.includes('collection_id')) return  // pre-schema migration didn't run; abort

      // Get a default trains collection id (the first one), creating one
      // if no collection at all exists. (Edge case: brand-new install
      // with no items either — skip.)
      const trainsRow = db.prepare(
        `SELECT id FROM collections WHERE COALESCE(kind, 'trains') = 'trains' ORDER BY id LIMIT 1`
      ).get() as { id: number } | undefined
      const trainsId = trainsRow?.id ?? null

      if (trainsId != null) {
        // Backfill: each item's collection_id comes from its set's
        // collection_id; if no set, use the default trains collection.
        db.exec(`
          UPDATE items
             SET collection_id = COALESCE(
                   (SELECT collection_id FROM sets WHERE sets.id = items.set_id),
                   ${trainsId}
                 )
           WHERE collection_id IS NULL
        `)
      }
    }
  },
  {
    id: 'post/2026-04-30_ensure_coin_collection',
    name: 'Auto-create the default "Coin Collection" if no kind=coins collection exists',
    up: (db) => {
      if (!tableExists(db, 'collections')) return
      const cols = tableColumns(db, 'collections')
      if (!cols.includes('kind')) return

      const existing = db.prepare(`SELECT id FROM collections WHERE kind = 'coins'`).get()
      if (existing) return
      db.prepare(
        `INSERT INTO collections (name, description, kind) VALUES (?, ?, ?)`
      ).run('Coin Collection', 'World coins and currency', 'coins')
    }
  }
]

export function preSchemaMigrations(db: Database.Database): void {
  runMigrations(db, PRE_SCHEMA)
}

export function postSchemaMigrations(db: Database.Database): void {
  runMigrations(db, POST_SCHEMA)
}
