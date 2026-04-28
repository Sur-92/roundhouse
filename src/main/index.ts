import { app, BrowserWindow, protocol, net, shell } from 'electron'
import { join } from 'node:path'
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

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#1a1410',
    title: 'Roundhouse',
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
