import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // In development the game server runs separately (npm run server); forward its WebSocket.
  server: { port: 5173, proxy: { '/ws': { target: 'ws://localhost:3001', ws: true } } },
});
