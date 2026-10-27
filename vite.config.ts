import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      srcDirectory: 'src',
    }),
    viteReact(),
    // Vercel sets VERCEL=1 during its build. Local builds keep the normal
    // Node server output used by `npm start` and the browser test runner.
    nitro({ preset: process.env.VERCEL ? 'vercel' : 'node-server' }),
  ],
})
