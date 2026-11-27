import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// One Vite project, four pages: the launcher plus one page per game.
// Each game folder is self-contained (index.html, src/, models/), so you can
// copy a single folder out and it still works with its own Vite setup.
export default defineConfig({
  base: './', // relative URLs so the build works under a GitHub Pages project path
  build: {
    chunkSizeWarningLimit: 900, // three.js itself is ~650 kB; that's expected
    rollupOptions: {
      input: {
        launcher: resolve(import.meta.dirname, 'index.html'),
        'retro-rush': resolve(import.meta.dirname, 'retro-rush/index.html'),
        'orbit-defense': resolve(import.meta.dirname, 'orbit-defense/index.html'),
        'crypt-crawler': resolve(import.meta.dirname, 'crypt-crawler/index.html'),
      },
    },
  },
});
