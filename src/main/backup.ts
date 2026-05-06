import { app } from 'electron'
import { join } from 'node:path'
import { createWriteStream, existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from 'node:fs'
import archiver from 'archiver'
import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import { diagLog } from './diag'

export interface BackupResult {
  zipPath: string
  sizeBytes: number
  itemCount: number
  photoCount: number
  videoCount: number
  durationMs: number
}

/**
 * Write a portable .zip backup of the user's Roundhouse data to
 * `destZipPath`. Contents:
 *   - roundhouse.db          ← SQLite snapshot via better-sqlite3 .backup()
 *                              (consistent even with WAL active, no need
 *                              to close the live DB)
 *   - photos/<itemId>/...    ← every photo + video file under userData
 *
 * Restoration is the natural pair (replace userData copies of those
 * files), but is left out of this module — out of scope for issue #11.
 */
export async function createBackup(destZipPath: string): Promise<BackupResult> {
  const start = Date.now()
  const userData = app.getPath('userData')
  const photosDir = join(userData, 'photos')

  // 1. Snapshot the live DB to a temp file. better-sqlite3's .backup()
  //    runs the SQLite online backup API which produces a consistent
  //    copy regardless of WAL state and without locking the main DB.
  const tmpDir = join(userData, '.backup-tmp')
  mkdirSync(tmpDir, { recursive: true })
  const dbSnapshotPath = join(tmpDir, `roundhouse-${randomUUID()}.db`)
  const live = getDb()
  // .backup() is async (returns a Promise resolving to { totalPages, ... }).
  await live.backup(dbSnapshotPath)
  diagLog(`[backup] DB snapshot → ${dbSnapshotPath} (${statSync(dbSnapshotPath).size} bytes)`)

  // 2. Stream into the zip.
  const output = createWriteStream(destZipPath)
  const zip = archiver('zip', { zlib: { level: 6 } })

  // Stats accumulators.
  let photoCount = 0
  let videoCount = 0
  const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v'])

  return new Promise<BackupResult>((resolve, reject) => {
    output.on('close', () => {
      // Best-effort cleanup of the temp snapshot.
      try { unlinkSync(dbSnapshotPath) } catch { /* ignore */ }
      const sizeBytes = statSync(destZipPath).size
      const itemCount = (live.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n
      const result: BackupResult = {
        zipPath: destZipPath,
        sizeBytes,
        itemCount,
        photoCount,
        videoCount,
        durationMs: Date.now() - start
      }
      diagLog(`[backup] done — ${JSON.stringify(result)}`)
      resolve(result)
    })
    output.on('error', (err) => {
      diagLog(`[backup] output stream error: ${String(err)}`)
      reject(err)
    })
    zip.on('warning', (err) => {
      diagLog(`[backup] archive warning: ${String(err)}`)
    })
    zip.on('error', (err) => {
      diagLog(`[backup] archive error: ${String(err)}`)
      reject(err)
    })

    zip.pipe(output)

    // a) The DB snapshot.
    zip.file(dbSnapshotPath, { name: 'roundhouse.db' })

    // b) Walk the photos directory if it exists. Each file lands at
    //    photos/<rel> inside the zip, mirroring the on-disk layout so
    //    a future Restore can drop them straight back into userData.
    if (existsSync(photosDir)) {
      const walk = (dir: string, baseRel: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const abs = join(dir, entry.name)
          const rel = baseRel ? `${baseRel}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            walk(abs, rel)
          } else if (entry.isFile()) {
            const ext = (entry.name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase()
            if (VIDEO_EXTS.has(ext)) videoCount += 1
            else photoCount += 1
            zip.file(abs, { name: `photos/${rel}` })
          }
        }
      }
      walk(photosDir, '')
    }

    void zip.finalize()
  })
}
