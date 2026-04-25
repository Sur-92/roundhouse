# Roundhouse

A desktop catalog for model train collections — locomotives, rolling stock, buildings, figurines, track, and scenery — for the analog hobbyist.

## Stack

- **Electron** + **TypeScript** (main, preload, renderer)
- **Vite** (via [`electron-vite`](https://electron-vite.org/)) for build and dev hot-reload
- **better-sqlite3** for the local database (single-user, fast, synchronous)
- **electron-builder** for packaging (Windows NSIS installer)
- Plain TypeScript renderer — no React/Vue/Svelte

## Hierarchy

```
Collection ──> Set ──> Item
                        └─ Photos (multiple per item)
```

Item types: `locomotive`, `rolling_stock`, `building`, `figurine`, `track`, `scenery`, `accessory`, `other`.

## Data location (Windows)

- Database: `%APPDATA%\Roundhouse\roundhouse.db`
- Photos:   `%APPDATA%\Roundhouse\photos\<item_id>\<filename>`

The repo never contains user data.

## Development

Requires Node 20+. First-time setup uses a custom script because plain
`npm install` runs `better-sqlite3`'s gyp build against the system Node,
which we don't want — we rebuild it against Electron's ABI instead.

```bash
npm run setup        # first-time only: install + Electron binary + native rebuild
npm run dev          # launches Electron with hot reload
npm run typecheck    # strict TS check across main + renderer
npm run build        # bundles to ./out
npm run build:win    # produces a Windows installer in ./release
```

If you ever blow away `node_modules`, run `npm run setup` again (not `npm install`).

## Security posture

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- Renderer talks to the DB only through a typed IPC bridge in the preload
- Strict CSP — `default-src 'self'`; no remote resources
- Photos served via a custom `app://` protocol scoped to the app data dir
- SQLite WAL mode, checkpointed on app close
