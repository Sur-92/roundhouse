import { app, dialog, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Wires the electron-updater to silently check, download, and prompt
 * the user to restart when a new release lands on the GitHub repo
 * configured in electron-builder.yml.
 *
 * Behavior:
 * - In development (npm run dev) the updater is a no-op — there is no
 *   packaged app to update, and the autoUpdater would otherwise crash
 *   trying to read code-signing metadata.
 * - In production it checks once on startup and again every 4 hours
 *   while the app is running.
 * - When a new version is downloaded it shows a native dialog with
 *   "Restart now" / "Later". Choosing Later means the update is applied
 *   automatically the next time the user quits.
 */
export function setupAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    // Network down, GitHub flaky, signed-bundle mismatch — never crash the app.
    console.warn('[autoUpdater] error:', err?.message ?? err)
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[autoUpdater] update available:', info.version)
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[autoUpdater] up to date')
  })

  autoUpdater.on('update-downloaded', async (info) => {
    const win = getMainWindow()
    if (!win) return
    const result = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Roundhouse update ready',
      message: `Roundhouse ${info.version} has been downloaded.`,
      detail: 'Restart now to install the update, or it will install automatically the next time you quit.'
    })
    if (result.response === 0) {
      autoUpdater.quitAndInstall()
    }
  })

  // Initial check on startup.
  void autoUpdater.checkForUpdates().catch((err) => {
    console.warn('[autoUpdater] initial check failed:', err?.message ?? err)
  })

  // Re-check every 4 hours.
  setInterval(
    () => {
      void autoUpdater.checkForUpdates().catch(() => {
        // already logged via 'error' event
      })
    },
    4 * 60 * 60 * 1000
  )
}
