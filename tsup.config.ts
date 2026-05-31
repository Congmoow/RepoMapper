import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  dts: false,
  clean: true,
  sourcemap: false,
  outDir: 'dist',
  banner: {
    js: '#!/usr/bin/env node',
  },
});
