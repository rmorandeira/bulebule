import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { APP_VERSION_NAME } from './src/version.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// version.js es la fuente que de verdad se actualiza en cada bump (junto con
// android/app/build.gradle) — depender de tags de git aquí se desincroniza
// en cuanto alguien bumpea sin crear el tag v*, que es justo lo que pasó
// (último tag v1.3.40 mientras version.js ya iba por 1.3.43).
function getVersion() {
  if (APP_VERSION_NAME) return `v${APP_VERSION_NAME}`
  try {
    return execSync("git describe --tags --abbrev=0 --match 'v*'", { encoding: 'utf-8' }).trim()
  } catch {}
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))
    return `v${pkg.version}`
  } catch {}
  return 'dev'
}
const version = getVersion()

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@3d-dice/dice-box'],
  },
  server: {
    allowedHosts: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
