import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Dev only: a page in the iOS simulator has no console to read, so it sends its errors here to be printed.
    {
      name: 'client-errors',
      apply: 'serve',
      configureServer(server) {
        server.ws.on('cicis:client-error', (data: { kind: string; message: string; stack?: string; url?: string }) => {
          console.log(`[client ${data.kind}] ${data.url ?? ''}\n${data.message}\n${data.stack ?? ''}`);
        });
      },
    },
  ],
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
