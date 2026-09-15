import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `vite preview`'s static file serving doesn't mark hashed build assets as
// long-cacheable by default (unlike most production static servers), so the
// browser re-validates/re-downloads the whole JS bundle on every navigation.
// The hash in the filename already changes whenever content does, so these
// are safe to cache forever - the HTML shell itself is untouched and still
// fetched fresh every time, which is what actually needs to stay live.
function immutableAssetCaching(): Plugin {
  return {
    name: 'immutable-asset-caching',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        next()
      })
    },
  }
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact(), immutableAssetCaching()],
  // `vite preview` (what Render runs in production) checks the request's
  // Host header against an allowlist to block DNS-rebinding attacks - the
  // leading dot matches any Render subdomain, so this survives a service
  // rename without needing to hardcode "postpilot-ugph".
  preview: { allowedHosts: ['.onrender.com'] },
})

export default config
