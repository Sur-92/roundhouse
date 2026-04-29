-- Roundhouse schema v1
-- Idempotent: all CREATE statements use IF NOT EXISTS.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  description   TEXT,
  scale         TEXT,
  manufacturer  TEXT,
  era           TEXT,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sets_collection ON sets(collection_id);

CREATE TABLE IF NOT EXISTS items (
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
CREATE INDEX IF NOT EXISTS idx_items_set   ON items(set_id);
CREATE INDEX IF NOT EXISTS idx_items_type  ON items(type);
CREATE INDEX IF NOT EXISTS idx_items_scale ON items(scale);
CREATE INDEX IF NOT EXISTS idx_items_source ON items(source);

CREATE TABLE IF NOT EXISTS item_photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  file_path     TEXT    NOT NULL,
  caption       TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_primary    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_photos_item ON item_photos(item_id);
-- idx_photos_item_primary is created by the migration runner so it
-- can run safely on DBs that predate the is_primary column.

-- Lookup tables that drive the dropdowns for item.type / item.scale /
-- item.condition. Items.type/scale/condition are still stored as plain
-- TEXT (no FK) — the user can rename or delete a lookup row without
-- breaking historical items. The Settings page CRUDs these.
CREATE TABLE IF NOT EXISTS item_types (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  value      TEXT    NOT NULL UNIQUE,
  label      TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS item_scales (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  value      TEXT    NOT NULL UNIQUE,
  label      TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS item_conditions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  value      TEXT    NOT NULL UNIQUE,
  label      TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Seed system rows (idempotent: INSERT OR IGNORE on the unique value).
INSERT OR IGNORE INTO item_types (value, label, sort_order, is_system) VALUES
  ('locomotive',    'Locomotive',     10, 1),
  ('rolling_stock', 'Rolling stock',  20, 1),
  ('building',      'Building',       30, 1),
  ('figurine',      'Figurine',       40, 1),
  ('track',         'Track',          50, 1),
  ('scenery',       'Scenery',        60, 1),
  ('accessory',     'Accessory',      70, 1),
  ('other',         'Other',          80, 1);

INSERT OR IGNORE INTO item_scales (value, label, sort_order, is_system) VALUES
  ('Z',  'Z',  10, 1),
  ('N',  'N',  20, 1),
  ('HO', 'HO', 30, 1),
  ('OO', 'OO', 40, 1),
  ('S',  'S',  50, 1),
  ('O',  'O',  60, 1),
  ('G',  'G',  70, 1);

INSERT OR IGNORE INTO item_conditions (value, label, sort_order, is_system) VALUES
  ('new',       'New',        10, 1),
  ('like_new',  'Like new',   20, 1),
  ('excellent', 'Excellent',  30, 1),
  ('good',      'Good',       40, 1),
  ('fair',      'Fair',       50, 1),
  ('poor',      'Poor',       60, 1),
  ('parts',     'For parts',  70, 1);

-- updated_at maintenance (recursive_triggers is OFF by default, so these don't loop).
CREATE TRIGGER IF NOT EXISTS trg_collections_updated
  AFTER UPDATE ON collections FOR EACH ROW
  BEGIN
    UPDATE collections
       SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = OLD.id;
  END;

CREATE TRIGGER IF NOT EXISTS trg_sets_updated
  AFTER UPDATE ON sets FOR EACH ROW
  BEGIN
    UPDATE sets
       SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = OLD.id;
  END;

CREATE TRIGGER IF NOT EXISTS trg_items_updated
  AFTER UPDATE ON items FOR EACH ROW
  BEGIN
    UPDATE items
       SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = OLD.id;
  END;
