import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import config from '../vite.config';

export default mergeConfig(config, defineConfig({
  build: { outDir: 'dist-ui', rollupOptions: { input: fileURLToPath(new URL('./fixture.html', import.meta.url)) } },
}));
