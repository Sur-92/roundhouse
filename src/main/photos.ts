import { app } from 'electron'
import { join, extname } from 'node:path'
import { mkdirSync, copyFileSync, unlinkSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

export function photosRoot(): string {
  const dir = join(app.getPath('userData'), 'photos')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Copy a source image into the app's photo store. Returns the relative path. */
export function importPhoto(itemId: number, sourcePath: string): string {
  const itemDir = join(photosRoot(), String(itemId))
  mkdirSync(itemDir, { recursive: true })
  const ext = (extname(sourcePath) || '.jpg').toLowerCase()
  const filename = `${randomUUID()}${ext}`
  copyFileSync(sourcePath, join(itemDir, filename))
  return `${itemId}/${filename}`
}

export function resolvePhoto(relPath: string): string {
  return join(photosRoot(), relPath)
}

export function deletePhoto(relPath: string): void {
  const abs = resolvePhoto(relPath)
  if (existsSync(abs)) unlinkSync(abs)
}
