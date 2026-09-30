import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 900 },   // three.js alone is ~600 kB
  test: { environment: 'node', include: ['src/tests/**/*.test.ts'] },
});
