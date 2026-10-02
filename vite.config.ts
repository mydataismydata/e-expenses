import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: { target: 'es2022' },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-192.png', 'theme.js'],
      manifest: {
        name: 'Expense Reports',
        short_name: 'Expenses',
        description: 'Offline expense reports with receipt OCR, Excel and PDF export.',
        theme_color: '#ffffff',
        background_color: '#eff2f7',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache everything, including the OCR engine, its model and the fonts, so the app works fully offline after the first visit.
        globPatterns: ['**/*.{js,css,html,svg,png,mjs,gz,wasm,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
      },
    }),
  ],
  test: { include: ['src/**/*.test.ts'] },
})
