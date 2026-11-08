import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { connect } from 'node:net';
import { type Plugin, defineConfig } from 'vite';

const GAME_PORT = 3001;

// True if something is already listening on the port, such as a game server started with `npm run server`.
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, 'localhost');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

// The running game server. Kept on globalThis because Vite reloads this file when it changes.
const holder = globalThis as { battleshipGameServer?: ChildProcess };

async function stopGameServer(): Promise<void> {
  const child = holder.battleshipGameServer;
  holder.battleshipGameServer = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

// Starts the online game server alongside `npm run dev`, so Online works without a second terminal.
function gameServer(): Plugin {
  return {
    name: 'battleship-game-server',
    apply: 'serve',
    async configureServer(server) {
      // Vitest also loads this config; tests do not need the game server.
      if (process.env.VITEST) return;
      // After a config reload, stop the previous copy before starting a new one.
      await stopGameServer();
      if (await portInUse(GAME_PORT)) {
        server.config.logger.info(`Game server already running on port ${GAME_PORT}; using it.`);
        return;
      }
      const child = spawn('npx', ['tsx', 'server/index.ts'], {
        stdio: 'inherit',
        env: { ...process.env, PORT: String(GAME_PORT) },
      });
      holder.battleshipGameServer = child;
      process.once('exit', () => child.kill());
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [gameServer()],
  // The game server runs on its own port; forward the page's WebSocket to it.
  server: { port: 5173, proxy: { '/ws': { target: `ws://localhost:${GAME_PORT}`, ws: true } } },
});
