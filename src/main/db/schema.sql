-- Roundhouse schema v2 — kind-aware (trains + coins).
-- Idempotent: all CREATE statements use IF NOT EXISTS.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT,
  kind        TEXT    NOT NULL DEFAULT 'trains' CHECK (kind IN ('trains','coins')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_collections_kind ON collections(kind);

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
  collection_id        INTEGER REFERENCES collections(id) ON DELETE SET NULL,
  type                 TEXT    NOT NULL,
  name                 TEXT    NOT NULL,
  -- Train-flavored fields (sparse for coins)
  manufacturer         TEXT,
  model_number         TEXT,
  scale                TEXT,
  road_name            TEXT,
  era                  TEXT,
  -- Coin-flavored fields (sparse for trains)
  country              TEXT,
  face_value           REAL,
  denomination         TEXT,
  mint_mark            TEXT,
  quantity             INTEGER NOT NULL DEFAULT 1,
  -- Shared
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
CREATE INDEX IF NOT EXISTS idx_items_set         ON items(set_id);
CREATE INDEX IF NOT EXISTS idx_items_collection  ON items(collection_id);
CREATE INDEX IF NOT EXISTS idx_items_type        ON items(type);
CREATE INDEX IF NOT EXISTS idx_items_scale       ON items(scale);
CREATE INDEX IF NOT EXISTS idx_items_country     ON items(country);
CREATE INDEX IF NOT EXISTS idx_items_source      ON items(source);

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

-- Per-kind lookup tables that drive the dropdowns for item.type /
-- item.scale / item.condition. Items.type/scale/condition are stored
-- as plain TEXT (no FK) — the user can rename or delete a lookup row
-- without breaking historical items.
CREATE TABLE IF NOT EXISTS item_types (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL DEFAULT 'trains' CHECK (kind IN ('trains','coins')),
  value      TEXT    NOT NULL,
  label      TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(kind, value)
);

CREATE TABLE IF NOT EXISTS item_scales (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL DEFAULT 'trains' CHECK (kind IN ('trains','coins')),
  value      TEXT    NOT NULL,
  label      TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(kind, value)
);

CREATE TABLE IF NOT EXISTS item_conditions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL DEFAULT 'trains' CHECK (kind IN ('trains','coins')),
  value      TEXT    NOT NULL,
  label      TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(kind, value)
);

-- Seed system rows (idempotent: INSERT OR IGNORE on UNIQUE(kind,value)).

-- Trains lookups
INSERT OR IGNORE INTO item_types (kind, value, label, sort_order, is_system) VALUES
  ('trains', 'locomotive',    'Locomotive',     10, 1),
  ('trains', 'rolling_stock', 'Rolling stock',  20, 1),
  ('trains', 'building',      'Building',       30, 1),
  ('trains', 'figurine',      'Figurine',       40, 1),
  ('trains', 'track',         'Track',          50, 1),
  ('trains', 'scenery',       'Scenery',        60, 1),
  ('trains', 'accessory',     'Accessory',      70, 1),
  ('trains', 'other',         'Other',          80, 1);

INSERT OR IGNORE INTO item_scales (kind, value, label, sort_order, is_system) VALUES
  ('trains', 'Z',  'Z',  10, 1),
  ('trains', 'N',  'N',  20, 1),
  ('trains', 'HO', 'HO', 30, 1),
  ('trains', 'OO', 'OO', 40, 1),
  ('trains', 'S',  'S',  50, 1),
  ('trains', 'O',  'O',  60, 1),
  ('trains', 'G',  'G',  70, 1);

INSERT OR IGNORE INTO item_conditions (kind, value, label, sort_order, is_system) VALUES
  ('trains', 'new',       'New',        10, 1),
  ('trains', 'like_new',  'Like new',   20, 1),
  ('trains', 'excellent', 'Excellent',  30, 1),
  ('trains', 'good',      'Good',       40, 1),
  ('trains', 'fair',      'Fair',       50, 1),
  ('trains', 'poor',      'Poor',       60, 1),
  ('trains', 'parts',     'For parts',  70, 1);

-- Coins lookups
INSERT OR IGNORE INTO item_types (kind, value, label, sort_order, is_system) VALUES
  ('coins', 'coin', 'Coin', 10, 1),
  ('coins', 'bill', 'Bill', 20, 1);

-- Coins use Sheldon-style grading (P-1 through MS-70, plus Proof).
-- Labels include the numeric range so the user has the reference
-- inline; values stay snake_case for stability.
INSERT OR IGNORE INTO item_conditions (kind, value, label, sort_order, is_system) VALUES
  ('coins', 'poor',                'Poor (P-1)',                          10, 1),
  ('coins', 'fair',                'Fair (FR-2)',                         20, 1),
  ('coins', 'about_good',          'About Good (AG-3)',                   30, 1),
  ('coins', 'good',                'Good (G-4 to G-6)',                   40, 1),
  ('coins', 'very_good',           'Very Good (VG-8 to VG-10)',           50, 1),
  ('coins', 'fine',                'Fine (F-12 to F-15)',                 60, 1),
  ('coins', 'very_fine',           'Very Fine (VF-20 to VF-35)',          70, 1),
  ('coins', 'extremely_fine',      'Extremely Fine (EF-40 to EF-45)',     80, 1),
  ('coins', 'about_uncirculated',  'About Uncirculated (AU-50 to AU-58)', 90, 1),
  ('coins', 'mint_state',          'Mint State (MS-60 to MS-70)',        100, 1),
  ('coins', 'proof',               'Proof (PR-60 to PR-70)',             110, 1);

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
