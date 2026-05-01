import { app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import schemaSql from './schema.sql?raw'
import { preSchemaMigrations, postSchemaMigrations } from './migrations'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  const dataDir = app.getPath('userData')
  mkdirSync(dataDir, { recursive: true })
  const dbPath = join(dataDir, 'roundhouse.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Phase 1: ALTER existing tables to add new columns the seed inserts
  // about to run will reference. No-op on a fresh DB.
  preSchemaMigrations(db)
  // Phase 2: idempotent canonical schema (CREATE IF NOT EXISTS + INSERT
  // OR IGNORE seeds).
  db.exec(schemaSql)
  // Phase 3: data backfills (link items to collections, create defaults).
  postSchemaMigrations(db)
  return db
}

export function closeDb(): void {
  if (!db) return
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // best effort — checkpoint failure is not fatal
  }
  db.close()
  db = null
}
