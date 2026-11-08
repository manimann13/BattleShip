import { afterEach, describe, expect, it, vi } from 'vitest';
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

function fakePeer(): Peer & { messages: ServerMessage[]; closed: boolean } {
  const messages: ServerMessage[] = [];
  const peer = {
    messages,
    closed: false,
    send: (message: ServerMessage) => messages.push(message),
    close: () => {
      peer.closed = true;
    },
  };
  return peer;
}

let tokenCount = 0;
const makeToken = () => `token-${tokenCount++}`;

// rng() < 0.5 means player 0 (the host) fires first.
function startedRoom(onClose?: (room: Room) => void) {
  const host = fakePeer();
  const guest = fakePeer();
  const room = new Room('ABCD', host, () => 0, { onClose, makeToken });
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
    expect(host.messages[0]).toMatchObject({ type: 'created', code: 'ABCD' });
    expect(room.join(guest)).toBe(1);
    expect(host.messages).toContainEqual(expect.objectContaining({ type: 'matched', code: 'ABCD' }));
    expect(guest.messages).toContainEqual(expect.objectContaining({ type: 'matched', code: 'ABCD' }));
    const tokenOf = (peer: typeof host) =>
      (peer.messages.find((message) => message.type === 'matched') as { token: string }).token;
    expect(tokenOf(host)).not.toBe(tokenOf(guest));
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
    const onClose = vi.fn();
    const { room, host } = startedRoom(onClose);
    room.leave(1);
    expect(host.messages.at(-1)).toEqual({ type: 'opponentLeft' });
    expect(room.closed).toBe(true);
    expect(onClose).toHaveBeenCalledWith(room);
  });
});

describe('Room reconnecting', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const tokenOf = (peer: ReturnType<typeof fakePeer>) =>
    (peer.messages.find((message) => message.type === 'matched') as { token: string }).token;

  it('keeps a dropped player\'s seat and lets them rejoin with the game state', () => {
    vi.useFakeTimers();
    const { room, host, guest } = startedRoom();
    room.fire(0, 0, 0);
    room.fire(1, 9, 9);

    room.disconnect(1, guest);
    expect(host.messages.at(-1)).toEqual({ type: 'opponentDisconnected', seconds: 60 });
    vi.advanceTimersByTime(30_000);
    expect(room.closed).toBe(false);

    const back = fakePeer();
    expect(room.rejoin(tokenOf(guest), back)).toBe(1);
    expect(host.messages.at(-1)).toEqual({ type: 'opponentReconnected' });
    expect(back.messages.at(-1)).toMatchObject({
      type: 'resume',
      phase: 'battle',
      yourTurn: false,
      opponentConnected: true,
      shots: [
        { byYou: false, x: 0, y: 0, result: 'hit' },
        { byYou: true, x: 9, y: 9, result: 'miss' },
      ],
    });
    expect((back.messages.at(-1) as { fleet: unknown[] }).fleet).toHaveLength(FLEET.length);
    // The resume message must not leak the opponent's ships mid-game.
    expect(JSON.parse(JSON.stringify(back.messages.at(-1)))).not.toHaveProperty('enemyFleet');

    // The grace timer was cancelled, and play carries on with the new connection.
    vi.advanceTimersByTime(60_000);
    expect(room.closed).toBe(false);
    room.fire(0, 1, 0);
    expect(back.messages.at(-1)).toMatchObject({ type: 'shot', byYou: false, x: 1, y: 0 });
  });

  it('closes the room when the grace period runs out', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { room, host, guest } = startedRoom(onClose);
    room.disconnect(1, guest);
    vi.advanceTimersByTime(60_000);
    expect(room.closed).toBe(true);
    expect(host.messages.at(-1)).toEqual({ type: 'opponentLeft' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(room.rejoin(tokenOf(guest), fakePeer())).toBeNull();
  });

  it('rejects a wrong token', () => {
    const { room, guest } = startedRoom();
    room.disconnect(1, guest);
    expect(room.rejoin('not-a-token', fakePeer())).toBeNull();
    room.leave(1);
  });

  it('closes the old connection when a player rejoins on a new one, and ignores its late drop', () => {
    const { room, host, guest } = startedRoom();
    const back = fakePeer();
    room.rejoin(tokenOf(guest), back);
    expect(guest.closed).toBe(true);
    room.disconnect(1, guest);
    expect(host.messages.at(-1)).toEqual({ type: 'opponentReconnected' });
    expect(room.closed).toBe(false);
  });

  it('closes a room straight away if the host drops before anyone joins', () => {
    const host = fakePeer();
    const room = new Room('ABCD', host, () => 0, { makeToken });
    room.disconnect(0, host);
    expect(room.closed).toBe(true);
  });
});

describe('Room expiry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes a hosted game nobody joins after 10 minutes', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const host = fakePeer();
    const room = new Room('ABCD', host, () => 0, { onClose, makeToken });
    vi.advanceTimersByTime(9 * 60_000);
    expect(room.closed).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(room.closed).toBe(true);
    expect(host.messages.at(-1)).toMatchObject({ type: 'error' });
    expect(host.closed).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes a match after 30 minutes without a move, but not while players keep moving', () => {
    vi.useFakeTimers();
    const { room, host, guest } = startedRoom();
    vi.advanceTimersByTime(29 * 60_000);
    room.fire(0, 0, 0);
    vi.advanceTimersByTime(29 * 60_000);
    expect(room.closed).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(room.closed).toBe(true);
    expect(host.messages.at(-1)).toMatchObject({ type: 'error' });
    expect(guest.messages.at(-1)).toMatchObject({ type: 'error' });
  });
});

describe('Room emotes', () => {
  it('passes emotes to the opponent, dropping ones sent too quickly', () => {
    const { room, host, guest } = startedRoom();
    room.emote(0, 'nice', 10_000);
    expect(guest.messages.at(-1)).toEqual({ type: 'emote', emote: 'nice' });
    room.emote(0, 'wow', 10_500);
    expect(guest.messages.at(-1)).toEqual({ type: 'emote', emote: 'nice' });
    room.emote(0, 'gg', 12_000);
    expect(guest.messages.at(-1)).toEqual({ type: 'emote', emote: 'gg' });
    expect(host.messages.some((message) => message.type === 'emote')).toBe(false);
  });

  it('ignores emotes before the battle starts', () => {
    const host = fakePeer();
    const guest = fakePeer();
    const room = new Room('ABCD', host, () => 0, { makeToken });
    room.join(guest);
    room.emote(0, 'luck', 10_000);
    expect(guest.messages.some((message) => message.type === 'emote')).toBe(false);
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
    expect(host.messages.at(-1)).toEqual({ type: 'error', message: 'The game is over' });
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
    expect(guest.messages.at(-1)).toMatchObject({ type: 'matched', code: 'ABCD' });
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
    expect(parseClientMessage('{"type":"emote","emote":"gg"}')).toEqual({ type: 'emote', emote: 'gg' });
    expect(parseClientMessage('{"type":"emote","emote":"anything I like"}')).toBeNull();
    expect(parseClientMessage('{"type":"emote","emote":"toString"}')).toBeNull();
    expect(parseClientMessage('{"type":"rejoin","code":"ABCD","token":"t"}')).toEqual({
      type: 'rejoin',
      code: 'ABCD',
      token: 't',
    });
    expect(parseClientMessage('{"type":"rejoin","code":"ABCD"}')).toBeNull();
    expect(parseClientMessage('{"type":"leave"}')).toEqual({ type: 'leave' });
  });

  it('builds a board only from a legal fleet', () => {
    expect(boardFromFleet(fleet)?.isFleetComplete).toBe(true);
    expect(boardFromFleet([...fleet].reverse())).toBeNull();
    expect(boardFromFleet(fleet.map((ship) => ({ ...ship, y: 0 })))).toBeNull();
    expect(boardFromFleet(fleet.map((ship) => ({ ...ship, x: 9 })))).toBeNull();
  });
});
