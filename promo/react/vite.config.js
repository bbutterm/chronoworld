import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base './' — статику из dist можно выложить в любую папку (GitHub Pages, Vercel, artifact).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 400 },
});
