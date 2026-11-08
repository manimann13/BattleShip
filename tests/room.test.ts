import { describe, expect, it } from 'vitest';
import { type Peer, Room } from '../server/room';
import { FLEET } from '../src/game/types';
import { type ServerMessage, type ShipPlacement, boardFromFleet, parseClientMessage } from '../src/net/protocol';

// Ships stacked in rows 0-4, all starting at column 0.
const fleet: ShipPlacement[] = FLEET.map((spec, y) => ({
  type: spec.type,
  x: 0,
  y,
  orientation: 'horizontal',
}));

function fakePeer(): Peer & { messages: ServerMessage[] } {
  const messages: ServerMessage[] = [];
  return { messages, send: (message) => messages.push(message) };
}

// rng() < 0.5 means player 0 (the host) fires first.
function startedRoom() {
  const host = fakePeer();
  const guest = fakePeer();
  const room = new Room('ABCD', host, () => 0);
  room.join(guest);
  room.ready(0, fleet);
  room.ready(1, fleet);
  return { room, host, guest };
}

describe('Room', () => {
  it('matches a guest with the host and rejects a third player', () => {
    const host = fakePeer();
    const guest = fakePeer();
    const room = new Room('ABCD', host);
    expect(room.join(guest)).toBe(1);
    expect(host.messages).toContainEqual({ type: 'matched' });
    expect(guest.messages).toContainEqual({ type: 'matched' });
    expect(room.join(fakePeer())).toBeNull();
  });

  it('starts the battle once both fleets are in, telling each side whose turn it is', () => {
    const { host, guest } = startedRoom();
    expect(host.messages).toContainEqual({ type: 'opponentReady' });
    expect(host.messages).toContainEqual({ type: 'start', yourTurn: true });
    expect(guest.messages).toContainEqual({ type: 'start', yourTurn: false });
  });

  it('rejects an invalid fleet', () => {
    const host = fakePeer();
    const room = new Room('ABCD', host);
    room.join(fakePeer());
    room.ready(0, fleet.slice(1));
    expect(host.messages.at(-1)).toMatchObject({ type: 'error' });
  });

  it('reports shots to both players and enforces turns', () => {
    const { room, host, guest } = startedRoom();
    room.fire(1, 0, 0);
    expect(guest.messages.at(-1)).toEqual({ type: 'error', message: 'It is not your turn' });

    room.fire(0, 0, 0);
    expect(host.messages.at(-1)).toMatchObject({ type: 'shot', byYou: true, x: 0, y: 0, result: 'hit' });
    expect(guest.messages.at(-1)).toMatchObject({ type: 'shot', byYou: false, x: 0, y: 0, result: 'hit' });

    room.fire(0, 5, 5);
    expect(host.messages.at(-1)).toMatchObject({ type: 'error' });
  });

  it('never leaks the opponent fleet before the game ends', () => {
    const { room, host } = startedRoom();
    room.fire(0, 9, 9);
    expect(host.messages.at(-1)).toMatchObject({ result: 'miss', gameOver: false });
    // Undefined values are dropped when the message is serialised.
    expect(JSON.parse(JSON.stringify(host.messages.at(-1)))).not.toHaveProperty('fleet');
    expect(JSON.parse(JSON.stringify(host.messages.at(-1)))).not.toHaveProperty('sunk');
  });

  it('reveals the fleets when the game ends and supports a rematch', () => {
    const { room, host, guest } = startedRoom();
    // The host sinks every ship while the guest keeps missing in rows 5-6.
    const hits = FLEET.flatMap((spec, y) => Array.from({ length: spec.length }, (_, x) => ({ x, y })));
    hits.forEach((cell, i) => {
      room.fire(0, cell.x, cell.y);
      if (i < hits.length - 1) room.fire(1, i % 10, 5 + Math.floor(i / 10));
    });
    expect(host.messages.at(-1)).toMatchObject({ type: 'shot', byYou: true, gameOver: true });
    expect((host.messages.at(-1) as { fleet?: unknown[] }).fleet).toHaveLength(FLEET.length);
    expect((guest.messages.at(-1) as { fleet?: unknown[] }).fleet).toHaveLength(FLEET.length);

    room.requestRematch(0);
    expect(guest.messages.at(-1)).toEqual({ type: 'rematchRequested' });
    room.requestRematch(1);
    expect(host.messages.at(-1)).toEqual({ type: 'rematchStart' });
    expect(guest.messages.at(-1)).toEqual({ type: 'rematchStart' });
  });

  it('tells the remaining player when someone leaves', () => {
    const { room, host } = startedRoom();
    room.leave(1);
    expect(host.messages.at(-1)).toEqual({ type: 'opponentLeft' });
    expect(room.closed).toBe(true);
  });
});

// The host sinks every guest ship while the guest misses in rows 5-6.
function playToHostWin(room: Room) {
  const hits = FLEET.flatMap((spec, y) => Array.from({ length: spec.length }, (_, x) => ({ x, y })));
  hits.forEach((cell, i) => {
    room.fire(0, cell.x, cell.y);
    if (i < hits.length - 1) room.fire(1, i % 10, 5 + Math.floor(i / 10));
  });
}

const errors = (peer: { messages: ServerMessage[] }) => peer.messages.filter((message) => message.type === 'error');

describe('Room rules', () => {
  it('refuses a fleet before anyone has joined', () => {
    const host = fakePeer();
    const room = new Room('ABCD', host);
    room.ready(0, fleet);
    expect(host.messages.at(-1)).toEqual({ type: 'error', message: 'Fleet cannot be placed right now' });
  });

  it('refuses a second fleet from the same player', () => {
    const host = fakePeer();
    const guest = fakePeer();
    const room = new Room('ABCD', host);
    room.join(guest);
    room.ready(0, fleet);
    room.ready(0, fleet);
    expect(host.messages.at(-1)).toMatchObject({ type: 'error' });
    expect(guest.messages.filter((message) => message.type === 'opponentReady')).toHaveLength(1);
  });

  it('accepts a valid fleet after an invalid one', () => {
    const host = fakePeer();
    const guest = fakePeer();
    const room = new Room('ABCD', host, () => 0);
    room.join(guest);
    room.ready(0, fleet.map((ship) => ({ ...ship, y: 0 })));
    expect(guest.messages).not.toContainEqual({ type: 'opponentReady' });
    room.ready(0, fleet);
    room.ready(1, fleet);
    expect(host.messages.at(-1)).toEqual({ type: 'start', yourTurn: true });
  });

  it('lets the guest go first when the coin says so', () => {
    const host = fakePeer();
    const guest = fakePeer();
    const room = new Room('ABCD', host, () => 0.75);
    room.join(guest);
    room.ready(0, fleet);
    room.ready(1, fleet);
    expect(host.messages.at(-1)).toEqual({ type: 'start', yourTurn: false });
    expect(guest.messages.at(-1)).toEqual({ type: 'start', yourTurn: true });
  });

  it('refuses shots before the battle starts', () => {
    const host = fakePeer();
    const guest = fakePeer();
    const room = new Room('ABCD', host, () => 0);
    room.join(guest);
    room.ready(0, fleet);
    room.fire(0, 0, 0);
    expect(host.messages.at(-1)).toEqual({ type: 'error', message: 'The battle has not started' });
    expect(guest.messages.some((message) => message.type === 'shot')).toBe(false);
  });

  it('keeps the turn after an off-board shot', () => {
    const { room, host, guest } = startedRoom();
    room.fire(0, 10, 0);
    expect(host.messages.at(-1)).toMatchObject({ type: 'error' });
    expect(guest.messages.some((message) => message.type === 'shot')).toBe(false);
    room.fire(0, 9, 9);
    expect(host.messages.at(-1)).toMatchObject({ type: 'shot', result: 'miss' });
  });

  it('describes the sunk ship to both players', () => {
    const { room, host, guest } = startedRoom();
    room.fire(0, 0, 4);
    room.fire(1, 9, 9);
    room.fire(0, 1, 4);
    const sunk = { type: 'destroyer', x: 0, y: 4, orientation: 'horizontal' };
    expect(host.messages.at(-1)).toMatchObject({ result: 'sunk', sunk, gameOver: false });
    expect(guest.messages.at(-1)).toMatchObject({ result: 'sunk', sunk, byYou: false });
  });

  it('refuses shots once the game is over', () => {
    const { room, host, guest } = startedRoom();
    playToHostWin(room);
    const before = guest.messages.length;
    room.fire(0, 9, 9);
    room.fire(1, 9, 9);
    expect(host.messages.at(-1)).toMatchObject({ type: 'error' });
    expect(guest.messages.slice(before).every((message) => message.type === 'error')).toBe(true);
  });

  it('refuses a rematch before the game is over', () => {
    const { room, host, guest } = startedRoom();
    room.requestRematch(0);
    expect(host.messages.at(-1)).toEqual({ type: 'error', message: 'The game is not over' });
    expect(guest.messages).not.toContainEqual({ type: 'rematchRequested' });
  });

  it('starts a fresh game after a rematch', () => {
    const { room, host, guest } = startedRoom();
    playToHostWin(room);
    room.requestRematch(1);
    room.requestRematch(0);
    expect(host.messages.at(-1)).toEqual({ type: 'rematchStart' });

    // Nobody can fire until both fleets are placed again.
    room.fire(0, 0, 0);
    expect(host.messages.at(-1)).toEqual({ type: 'error', message: 'The battle has not started' });

    const errorsBefore = errors(host).length + errors(guest).length;
    room.ready(0, fleet);
    room.ready(1, fleet);
    expect(errors(host).length + errors(guest).length).toBe(errorsBefore);
    expect(host.messages.at(-1)).toMatchObject({ type: 'start' });

    // The old shots are gone: a square hit last game can be fired at again.
    room.fire(0, 0, 0);
    expect(host.messages.at(-1)).toMatchObject({ type: 'shot', x: 0, y: 0, result: 'hit', gameOver: false });
  });

  it('needs both players again for the next rematch', () => {
    const { room, host, guest } = startedRoom();
    playToHostWin(room);
    room.requestRematch(0);
    room.requestRematch(1);
    room.ready(0, fleet);
    room.ready(1, fleet);
    playToHostWin(room);
    room.requestRematch(0);
    expect(guest.messages.at(-1)).toEqual({ type: 'rematchRequested' });
    expect(host.messages.at(-1)).not.toEqual({ type: 'rematchStart' });
  });

  it('closes a lobby when the host leaves and refuses late joiners', () => {
    const host = fakePeer();
    const room = new Room('ABCD', host);
    room.leave(0);
    expect(room.closed).toBe(true);
    expect(room.join(fakePeer())).toBeNull();
  });

  it('tells the other player only once and ignores the leaver afterwards', () => {
    const { room, host, guest } = startedRoom();
    room.leave(0);
    room.leave(1);
    expect(guest.messages.filter((message) => message.type === 'opponentLeft')).toHaveLength(1);
    const hostCount = host.messages.length;
    room.fire(0, 0, 0);
    room.requestRematch(0);
    expect(host.messages).toHaveLength(hostCount);
  });

  it('refuses play after the room closes during placing', () => {
    const host = fakePeer();
    const guest = fakePeer();
    const room = new Room('ABCD', host);
    room.join(guest);
    room.leave(1);
    expect(host.messages.at(-1)).toEqual({ type: 'opponentLeft' });
    room.ready(0, fleet);
    expect(host.messages.at(-1)).toMatchObject({ type: 'error' });
    expect(guest.messages.at(-1)).toEqual({ type: 'matched' });
  });
});

describe('protocol', () => {
  it('parses valid client messages and rejects malformed ones', () => {
    expect(parseClientMessage('{"type":"create"}')).toEqual({ type: 'create' });
    expect(parseClientMessage('{"type":"join","code":"ABCD"}')).toEqual({ type: 'join', code: 'ABCD' });
    expect(parseClientMessage('{"type":"fire","x":1,"y":2}')).toEqual({ type: 'fire', x: 1, y: 2 });
    expect(parseClientMessage('{"type":"fire","x":1.5,"y":2}')).toBeNull();
    expect(parseClientMessage('{"type":"join"}')).toBeNull();
    expect(parseClientMessage('{"type":"ready","fleet":[{"type":"boat"}]}')).toBeNull();
    expect(parseClientMessage('not json')).toBeNull();
  });

  it('builds a board only from a legal fleet', () => {
    expect(boardFromFleet(fleet)?.isFleetComplete).toBe(true);
    expect(boardFromFleet([...fleet].reverse())).toBeNull();
    expect(boardFromFleet(fleet.map((ship) => ({ ...ship, y: 0 })))).toBeNull();
    expect(boardFromFleet(fleet.map((ship) => ({ ...ship, x: 9 })))).toBeNull();
  });
});
