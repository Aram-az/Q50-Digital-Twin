import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Same-origin proxy: browser talks to Vite; Vite forwards to the local API.
// This supports WebSockets without manually hardcoding IP addresses in React.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
});
