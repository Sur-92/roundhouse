import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const sharedAlias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    // Bundle `archiver` (and its hoisted transitive deps like
    // archiver-utils, zip-stream, etc.) directly into out/main/index.js
    // instead of leaving runtime require() calls. electron-builder's
    // production-deps walker has historically dropped some of these
    // hoisted transitive deps from the asar on Windows, surfacing as
    // "Cannot find module 'archiver-utils'" on packaged installs.
    // Bundling sidesteps the packaging walker entirely.
    plugins: [externalizeDepsPlugin({ exclude: ['archiver'] })],
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    publicDir: resolve(__dirname, 'assets'),
    resolve: {
      alias: {
        ...sharedAlias,
        '@renderer': resolve(__dirname, 'src/renderer')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
