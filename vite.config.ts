import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
  // `vite preview` (what Render runs in production) checks the request's
  // Host header against an allowlist to block DNS-rebinding attacks - the
  // leading dot matches any Render subdomain, so this survives a service
  // rename without needing to hardcode "postpilot-ugph".
  preview: { allowedHosts: ['.onrender.com'] },
})

export default config
