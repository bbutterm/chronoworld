import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Арт лежит в assets/ и отдаётся с корня, пути берутся из assets/manifest.json
  publicDir: 'assets',
  base: './',
  // Phaser целиком ~1.2 МБ — это нормально для Mini App
  build: { chunkSizeWarningLimit: 2000 },
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
