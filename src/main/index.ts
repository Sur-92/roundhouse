import { app, BrowserWindow, Menu, dialog, protocol, net, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { getDb, closeDb } from './db'
import { registerIpc } from './ipc'
import { photosRoot } from './photos'
import { loadFeedbackConfig } from './feedback'
import { loadEbayConfig } from './ebay'
import { setupAutoUpdater } from './updater'
import { diagLog, diagSession, openDiagLogInEditor, resetDiagLog } from './diag'

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
        // Custom paste — sends an IPC the renderer handles by reading
        // clipboard via main's privileged clipboard.readText() and
        // inserting at the caret. This bypasses webContents.paste() which
        // silently fails on Windows + sandbox: true (Surface user
        // diag log: zero paste events fired despite Ctrl+V being pressed
        // multiple times). Same accelerator, same UX, working pipeline.
        {
          label: 'Paste',
          accelerator: 'CommandOrControl+V',
          click: (_, win) => {
            if (win) (win as BrowserWindow).webContents.send('roundhouse:menu-paste')
          }
        },
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
        },
        { type: 'separator' },
        {
          label: 'Show Diagnostic Log',
          click: () => {
            void openDiagLogInEditor()
          }
        },
        {
          label: 'Reset Diagnostic Log',
          click: () => {
            resetDiagLog()
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

/**
 * Right-click context menu. Two cases:
 *   1. Editable fields (textareas, inputs)         → Cut/Copy/Paste/Select All
 *   2. Read-only text with an active selection     → Copy only
 * Attached directly to a webContents instance, NOT via the app-wide
 * web-contents-created event — that listener firing order was racy
 * on Windows: the window's webContents was created before the listener
 * existed, so the Surface user got no context menu at all (per the diag
 * log showing renderer contextmenu firing but main never receiving).
 */
function attachContextMenu(contents: Electron.WebContents): void {
  contents.on('context-menu', (_event, params) => {
    diagLog(`context-menu event: isEditable=${params.isEditable} selectionText.length=${params.selectionText?.length ?? 0} x=${params.x} y=${params.y} mediaType=${params.mediaType}`)
    const items: Electron.MenuItemConstructorOptions[] = []

    if (params.isEditable) {
      if (params.editFlags.canCut) items.push({ role: 'cut' })
      if (params.editFlags.canCopy) items.push({ role: 'copy' })
      if (params.editFlags.canPaste) {
        // Custom paste handler — see comment on customPasteItem below.
        items.push({
          label: 'Paste',
          click: () => contents.send('roundhouse:menu-paste')
        })
      }
      if (items.length) items.push({ type: 'separator' })
      if (params.editFlags.canSelectAll) items.push({ role: 'selectAll' })
    } else if (params.selectionText && params.selectionText.trim().length > 0) {
      items.push({ role: 'copy' })
    }

    if (items.length) items.push({ type: 'separator' })
    items.push({
      label: 'Inspect',
      click: () => contents.inspectElement(params.x, params.y)
    })

    const win = BrowserWindow.fromWebContents(contents) ?? undefined
    try {
      Menu.buildFromTemplate(items).popup(win ? { window: win } : {})
      diagLog(`context-menu popup() called; items=${items.map(i => i.role || i.label).join(',')}`)
    } catch (err) {
      diagLog(`context-menu popup() THREW: ${String(err)}`)
    }
  })
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

  // Attach context-menu handler directly to this window's webContents.
  attachContextMenu(win.webContents)

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

  diagSession()                                   // session marker in diag.log
  getDb()                                         // open DB and apply schema
  loadFeedbackConfig()                            // read feedback.json if present
  loadEbayConfig()                                // read ebay.json if present
  registerIpc()                                   // wire handlers
  Menu.setApplicationMenu(buildApplicationMenu()) // app menu with About item
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
