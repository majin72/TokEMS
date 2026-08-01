import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_ADMIN_BASE ?? '/admin/',
  plugins: [vue()],
  server: { host: '0.0.0.0', port: 3200 },
});
