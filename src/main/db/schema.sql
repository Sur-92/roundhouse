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
  type                 TEXT    NOT NULL CHECK (type IN
    ('locomotive','rolling_stock','building','figurine','track','scenery','accessory','other')),
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
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_photos_item ON item_photos(item_id);

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
