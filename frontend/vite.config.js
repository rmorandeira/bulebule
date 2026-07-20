import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function getVersion() {
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
