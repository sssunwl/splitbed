import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  base: '/splitbed/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        simulator: resolve(import.meta.dirname, 'simulator.html'),
        allocator: resolve(import.meta.dirname, 'allocator.html'),
        guide: resolve(import.meta.dirname, 'guide.html'),
      },
    },
  },
});
