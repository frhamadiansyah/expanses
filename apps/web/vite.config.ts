import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/*
 * A diagnostic build (CICIS_INSPECTABLE=1, see capacitor.config.ts) installs `window.__expansesSync`. One variable for
 * both halves, so the web view and the helper cannot be turned on apart; VITE_INSPECTABLE=1 alone does the web half.
 */
if (process.env.CICIS_INSPECTABLE === '1') process.env.VITE_INSPECTABLE = '1';

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
