import { defineConfig } from 'vite';
export default defineConfig({
  root: 'web', base: './',
  build: {outDir: '../blindbox/dist', emptyOutDir: true},
  server: {proxy: {'/api':'http://127.0.0.1:8765', '/models':'http://127.0.0.1:8765'}}
});
