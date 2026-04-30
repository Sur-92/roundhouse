import { app, shell } from 'electron'
import { appendFileSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Append-only diagnostic log at %APPDATA%\Roundhouse\diag.log (Windows)
 * or ~/Library/Application Support/roundhouse/diag.log (macOS).
 *
 * Both main and renderer use this; renderer goes through the diag:log
 * IPC. Lines are timestamped, never throw, and rotate at 1 MB to keep
 * the file from growing unbounded.
 */

const MAX_BYTES = 1_048_576  // 1 MB

let logFile: string | null = null

export function getDiagLogPath(): string {
  if (logFile) return logFile
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  logFile = join(dir, 'diag.log')
  return logFile
}

function rotateIfNeeded(): void {
  const path = getDiagLogPath()
  try {
    if (existsSync(path) && statSync(path).size > MAX_BYTES) {
      writeFileSync(path, '')  // wipe and start over
    }
  } catch {
    // ignore — never throw from logging
  }
}

export function diagLog(msg: string): void {
  try {
    rotateIfNeeded()
    const stamp = new Date().toISOString()
    appendFileSync(getDiagLogPath(), `[${stamp}] ${msg}\n`)
  } catch {
    // ignore
  }
}

/**
 * Write a session-start marker with full system info. Called once on
 * app ready so every diagnostic capture starts with environment context.
 */
export function diagSession(): void {
  diagLog('═'.repeat(70))
  diagLog(`SESSION START · Roundhouse v${app.getVersion()}`)
  diagLog(`platform=${process.platform} arch=${process.arch} os=${process.getSystemVersion()}`)
  diagLog(`electron=${process.versions.electron} chromium=${process.versions.chrome} node=${process.versions.node}`)
  diagLog(`packaged=${app.isPackaged} userData=${app.getPath('userData')}`)
  diagLog('═'.repeat(70))
}

export function resetDiagLog(): void {
  try {
    writeFileSync(getDiagLogPath(), '')
    diagSession()
  } catch {
    // ignore
  }
}

export function openDiagLogInEditor(): Promise<string> {
  const path = getDiagLogPath()
  if (!existsSync(path)) writeFileSync(path, '')
  return shell.openPath(path)
}
