import { randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { PlayerId } from '../src/game/game';
import { type ServerMessage, parseClientMessage } from '../src/net/protocol';
import { type Peer, Room } from './room';

// Serves the built client from dist/ and hosts online matches on /ws, all on one port.
const PORT = Number(process.env.PORT ?? 3001);
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const HEARTBEAT_MS = 30_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const rooms = new Map<string, Room>();

function newRoomCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const server = createServer(async (request, response) => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  if (pathname === '/healthz') {
    response.writeHead(200).end('ok');
    return;
  }
  const target = normalize(join(DIST, pathname === '/' ? 'index.html' : pathname));
  if (!target.startsWith(DIST)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': MIME[extname(target)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found. Has the client been built? Run: npm run build');
  }
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
const alive = new WeakSet<WebSocket>();

wss.on('connection', (socket) => {
  alive.add(socket);
  socket.on('pong', () => alive.add(socket));

  const peer: Peer = {
    send(message: ServerMessage) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    },
  };
  let membership: { room: Room; player: PlayerId } | null = null;

  socket.on('message', (data) => {
    const message = parseClientMessage(data.toString());
    if (!message) {
      peer.send({ type: 'error', message: 'Unrecognised message' });
      return;
    }

    if (message.type === 'create' || message.type === 'join') {
      if (membership) {
        peer.send({ type: 'error', message: 'You are already in a game' });
        return;
      }
      if (message.type === 'create') {
        const room = new Room(newRoomCode(), peer);
        rooms.set(room.code, room);
        membership = { room, player: 0 };
        peer.send({ type: 'created', code: room.code });
        return;
      }
      const room = rooms.get(message.code.trim().toUpperCase());
      if (!room) {
        peer.send({ type: 'error', message: 'No game found with that code' });
        return;
      }
      const player = room.join(peer);
      if (player === null) {
        peer.send({ type: 'error', message: 'That game is already full' });
        return;
      }
      membership = { room, player };
      return;
    }

    if (!membership) {
      peer.send({ type: 'error', message: 'Create or join a game first' });
      return;
    }
    const { room, player } = membership;
    if (message.type === 'ready') room.ready(player, message.fleet);
    else if (message.type === 'fire') room.fire(player, message.x, message.y);
    else room.requestRematch(player);
  });

  socket.on('close', () => {
    if (!membership) return;
    membership.room.leave(membership.player);
    rooms.delete(membership.room.code);
  });
});

// Drops connections that stopped answering, and keeps idle ones from being closed by proxies.
setInterval(() => {
  for (const socket of wss.clients) {
    if (!alive.has(socket)) {
      socket.terminate();
      continue;
    }
    alive.delete(socket);
    socket.ping();
  }
}, HEARTBEAT_MS).unref();

server.listen(PORT, () => console.log(`Battle Ship server listening on http://localhost:${PORT}`));
