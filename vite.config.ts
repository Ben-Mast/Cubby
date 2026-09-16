import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icons/cubby-icon.svg',
        'icons/cubby-icon-192.png',
        'icons/cubby-icon-512.png',
        'icons/cubby-apple-touch-icon.png',
      ],
      manifest: {
        id: '/',
        name: 'Cubby — Shared Voxel Home',
        short_name: 'Cubby',
        description: 'A shared voxel home for two people.',
        theme_color: '#5b4bdb',
        background_color: '#f4f2ff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'any',
        icons: [
          {
            src: '/icons/cubby-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icons/cubby-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icons/cubby-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/icons/cubby-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          }
        ]
      }
    })
  ]
})
