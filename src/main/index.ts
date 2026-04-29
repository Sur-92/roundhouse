import { app, BrowserWindow, Menu, dialog, protocol, net, shell } from 'electron'
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

/**
 * Native About dialog — modeled after the Manifest app's pattern.
 * Shows version + tagline + a "Release Notes…" button that hands off
 * to the renderer to open the changelog modal.
 */
async function showAboutDialog(win: BrowserWindow): Promise<void> {
  const result = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'About Roundhouse',
    message: `Roundhouse v${app.getVersion()}`,
    detail:
      'A desktop catalog for model train collections.\n\n' +
      '© 2026 Steve Beamesderfer · MIT License\n' +
      'github.com/Sur-92/roundhouse',
    buttons: ['Release Notes…', 'OK'],
    defaultId: 1,
    cancelId: 1,
    icon: iconForBrowserWindow()
  })
  if (result.response === 0) {
    win.webContents.send('roundhouse:show-release-notes')
  }
}

function buildApplicationMenu(): Menu {
  const isMac = process.platform === 'darwin'

  const aboutItem: Electron.MenuItemConstructorOptions = {
    label: 'About Roundhouse',
    click: (_, win) => {
      const target = (win as BrowserWindow) || mainWindow
      if (target) void showAboutDialog(target)
    }
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{
          label: app.name,
          submenu: [
            aboutItem,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle', label: 'Paste as plain text' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }]
    },
    {
      label: 'Help',
      submenu: [
        // On macOS the standard "About" lives in the app menu (above);
        // on Windows / Linux the Help menu is the conventional spot.
        ...(isMac ? [] : [aboutItem]),
        {
          label: 'Roundhouse on GitHub',
          click: () => {
            shell.openExternal('https://github.com/Sur-92/roundhouse').catch(() => {})
          }
        }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}

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
  Menu.setApplicationMenu(buildApplicationMenu()) // app menu with About item
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
