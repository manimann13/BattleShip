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
// Wrong codes allowed per connection, so codes cannot be found by trying them all.
const MAX_FAILED_JOINS = 10;
// Limits that keep one person (or a script) from using up the server.
const MAX_ROOMS = 500;
const MAX_CONNECTIONS = 1000;
const MAX_CONNECTIONS_PER_ADDRESS = 20;
const MAX_MESSAGES_PER_WINDOW = 40;
const MESSAGE_WINDOW_MS = 5_000;
const connectionsByAddress = new Map<string, number>();

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

// Only remove the room that closed: a newer room may have reused its code.
const forget = (room: Room) => {
  if (rooms.get(room.code) === room) rooms.delete(room.code);
};

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

wss.on('connection', (socket, request) => {
  // Render puts the visitor's address first in X-Forwarded-For.
  const forwarded = request.headers['x-forwarded-for'];
  const address = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim() ?? request.socket.remoteAddress ?? '?';
  const fromAddress = (connectionsByAddress.get(address) ?? 0) + 1;
  if (wss.clients.size > MAX_CONNECTIONS || fromAddress > MAX_CONNECTIONS_PER_ADDRESS) {
    socket.close(1013, 'Server busy');
    return;
  }
  connectionsByAddress.set(address, fromAddress);
  socket.on('close', () => {
    const left = (connectionsByAddress.get(address) ?? 1) - 1;
    if (left > 0) connectionsByAddress.set(address, left);
    else connectionsByAddress.delete(address);
  });

  alive.add(socket);
  socket.on('pong', () => alive.add(socket));
  // Without a listener, a bad frame from one client would crash the server. The socket closes itself after this.
  socket.on('error', (error) => console.error('WebSocket error:', error.message));

  const peer: Peer = {
    send(message: ServerMessage) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    },
    close: () => socket.close(),
  };
  let membership: { room: Room; player: PlayerId } | null = null;
  let failedJoins = 0;
  let windowStart = Date.now();
  let messagesInWindow = 0;

  socket.on('message', (data) => {
    // A normal game sends a few messages a minute; a flood means a broken or hostile client.
    const now = Date.now();
    if (now - windowStart > MESSAGE_WINDOW_MS) {
      windowStart = now;
      messagesInWindow = 0;
    }
    if (++messagesInWindow > MAX_MESSAGES_PER_WINDOW) {
      socket.close(1008, 'Too many messages');
      return;
    }
    const message = parseClientMessage(data.toString());
    if (!message) {
      peer.send({ type: 'error', message: 'Unrecognised message' });
      return;
    }

    if (message.type === 'create' || message.type === 'join' || message.type === 'rejoin') {
      if (membership) {
        peer.send({ type: 'error', message: 'You are already in a game' });
        return;
      }
      if (message.type === 'create') {
        if (rooms.size >= MAX_ROOMS) {
          peer.send({ type: 'error', message: 'The server is full right now. Try again in a few minutes.' });
          return;
        }
        const room = new Room(newRoomCode(), peer, Math.random, { onClose: forget });
        rooms.set(room.code, room);
        membership = { room, player: 0 };
        return;
      }
      if (failedJoins >= MAX_FAILED_JOINS) {
        peer.send({ type: 'error', message: 'Too many attempts. Reload the page to try again.' });
        return;
      }
      const room = rooms.get(message.code.trim().toUpperCase());
      const player = message.type === 'join' ? room?.join(peer) : room?.rejoin(message.token, peer);
      if (!room || player === null || player === undefined) {
        failedJoins++;
        let reason = 'No game found with that code';
        if (message.type === 'rejoin') reason = 'That game has ended';
        else if (room) reason = 'That game is already full';
        peer.send({ type: 'error', message: reason });
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
    switch (message.type) {
      case 'ready':
        room.ready(player, message.fleet);
        break;
      case 'fire':
        room.fire(player, message.x, message.y);
        break;
      case 'rematch':
        room.requestRematch(player);
        break;
      case 'emote':
        room.emote(player, message.emote);
        break;
      case 'leave':
        room.leave(player);
        membership = null;
        break;
    }
  });

  // A drop is not the end: the room keeps this player's seat for a while (see Room.disconnect).
  socket.on('close', () => {
    membership?.room.disconnect(membership.player, peer);
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
