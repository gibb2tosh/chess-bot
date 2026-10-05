/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative base so the built app works from any static host or sub-path (e.g. GitHub Pages).
  base: './',
  test: {
    include: ['test/**/*.test.ts'],
  },
})
