import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

function versionJsonPlugin() {
  return {
    name: 'version-json',
    closeBundle() {
      try {
        const version = process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36) + '-' + Date.now()
        const payload = JSON.stringify({ version, buildTime: new Date().toISOString() })
        const outPath = path.resolve('dist/version.json')
        fs.mkdirSync(path.dirname(outPath), { recursive: true })
        fs.writeFileSync(outPath, payload)
        // also keep public/version.json in sync for dev fallback
        const publicPath = path.resolve('public/version.json')
        fs.writeFileSync(publicPath, payload)
      } catch (e) {
        console.warn('[version-json] failed to write version.json', e)
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), versionJsonPlugin()],
  server: {
    port: 3000,
    open: true,
  },


})
