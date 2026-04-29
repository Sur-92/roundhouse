import { app, BrowserWindow, Menu, protocol, net, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { getDb, closeDb } from './db'
import { registerIpc } from './ipc'
import { photosRoot } from './photos'
import { loadFeedbackConfig } from './feedback'
import { setupAutoUpdater } from './updater'

const isDev = !app.isPackaged

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null

function iconForBrowserWindow(): string | undefined {
  // macOS uses the dock icon (set below) and the .icns embedded in the
  // packaged .app — BrowserWindow.icon is ignored on macOS.
  if (process.platform === 'darwin') return undefined
  const filename = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const dev = join(app.getAppPath(), 'resources', filename)
  const prod = join(process.resourcesPath, filename)
  if (existsSync(dev)) return dev
  if (existsSync(prod)) return prod
  return undefined
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#1a1410',
    title: 'Roundhouse',
    icon: iconForBrowserWindow(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow = win
  win.on('closed', () => { mainWindow = null })
  win.once('ready-to-show', () => win.show())

  // Open external links in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Dev-mode dock icon on macOS. The packaged .app uses the embedded
  // .icns from electron-builder; `npm run dev` runs from the generic
  // Electron.app bundle, so we override at runtime.
  if (process.platform === 'darwin' && !app.isPackaged) {
    const devIcon = join(app.getAppPath(), 'resources', 'icon.png')
    if (existsSync(devIcon)) {
      try { app.dock?.setIcon(devIcon) } catch { /* ignore */ }
    }
  }

  // app://photo/<relPath> serves files from the user photos dir only.
  protocol.handle('app', (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'photo') return new Response(null, { status: 404 })
      const rel = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!rel || rel.includes('..') || rel.startsWith('/') || rel.includes('\\')) {
        return new Response(null, { status: 400 })
      }
      const abs = join(photosRoot(), rel)
      return net.fetch(pathToFileURL(abs).toString())
    } catch {
      return new Response(null, { status: 500 })
    }
  })

  getDb()                                         // open DB and apply schema
  loadFeedbackConfig()                            // read feedback.json if present
  registerIpc()                                   // wire handlers
  createWindow()
  setupAutoUpdater(() => mainWindow)              // check GitHub Releases for updates

  // Right-click context menu in editable fields (textareas, inputs).
  // Without this, Windows users right-click expecting a Paste option,
  // see nothing, and conclude paste is broken — even though Ctrl+V
  // works fine. Fixes user-reported issue #3.
  app.on('web-contents-created', (_e, contents) => {
    contents.on('context-menu', (_event, params) => {
      if (!params.isEditable) return
      const items: Electron.MenuItemConstructorOptions[] = []
      if (params.editFlags.canCut) items.push({ role: 'cut' })
      if (params.editFlags.canCopy) items.push({ role: 'copy' })
      if (params.editFlags.canPaste) {
        items.push({ role: 'paste' })
        items.push({ role: 'pasteAndMatchStyle', label: 'Paste as plain text' })
      }
      if (items.length) items.push({ type: 'separator' })
      if (params.editFlags.canSelectAll) items.push({ role: 'selectAll' })
      if (items.length) Menu.buildFromTemplate(items).popup({})
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeDb()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  closeDb()
})
