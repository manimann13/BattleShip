import { describe, expect, it } from 'vitest';
import { Board } from '../src/game/board';
import { FLEET } from '../src/game/types';
import {
  type ShipPlacement,
  boardFromFleet,
  parseClientMessage,
  parseServerMessage,
  toPlacement,
} from '../src/net/protocol';
import { seeded } from './helpers';

// Ships stacked in rows 0-4, all starting at column 0.
const fleet: ShipPlacement[] = FLEET.map((spec, y) => ({ type: spec.type, x: 0, y, orientation: 'horizontal' }));

const ready = (ships: unknown) => JSON.stringify({ type: 'ready', fleet: ships });

describe('parseClientMessage', () => {
  it('accepts a full ready message', () => {
    expect(parseClientMessage(ready(fleet))).toEqual({ type: 'ready', fleet });
    expect(parseClientMessage('{"type":"rematch"}')).toEqual({ type: 'rematch' });
  });

  it('drops extra fields instead of passing them through', () => {
    expect(parseClientMessage('{"type":"create","admin":true}')).toEqual({ type: 'create' });
    expect(parseClientMessage('{"type":"fire","x":1,"y":2,"z":3}')).toEqual({ type: 'fire', x: 1, y: 2 });
    const parsed = parseClientMessage(ready(fleet.map((ship) => ({ ...ship, hidden: 'x' }))));
    expect(parsed).toEqual({ type: 'ready', fleet });
  });

  it('rejects numbers sent as strings', () => {
    expect(parseClientMessage('{"type":"fire","x":"1","y":2}')).toBeNull();
    expect(parseClientMessage(ready(fleet.map((ship, i) => (i === 2 ? { ...ship, x: '0' } : ship))))).toBeNull();
  });

  it('rejects non-finite and missing coordinates', () => {
    expect(parseClientMessage('{"type":"fire","x":1e400,"y":0}')).toBeNull();
    expect(parseClientMessage('{"type":"fire","x":null,"y":0}')).toBeNull();
    expect(parseClientMessage('{"type":"fire","y":0}')).toBeNull();
  });

  it('rejects null, missing or malformed fleet entries', () => {
    expect(parseClientMessage(ready([...fleet.slice(0, 4), null]))).toBeNull();
    expect(parseClientMessage(ready([...fleet.slice(0, 4), 7]))).toBeNull();
    expect(parseClientMessage(ready(fleet.map((ship, i) => (i === 0 ? { ...ship, orientation: 'diagonal' } : ship))))).toBeNull();
    expect(parseClientMessage('{"type":"ready"}')).toBeNull();
    expect(parseClientMessage('{"type":"ready","fleet":{"0":{}}}')).toBeNull();
  });

  it('handles a huge fleet array without accepting it as a board', () => {
    const huge = Array.from({ length: 5000 }, () => fleet[0]);
    const parsed = parseClientMessage(ready(huge));
    expect(parsed?.type).toBe('ready');
    expect(parsed?.type === 'ready' && boardFromFleet(parsed.fleet)).toBeNull();
  });

  it('rejects prototype keys and unknown types', () => {
    for (const type of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'CREATE', '']) {
      expect(parseClientMessage(JSON.stringify({ type }))).toBeNull();
    }
    expect(parseClientMessage('{"__proto__":{"type":"create"}}')).toBeNull();
    expect(parseClientMessage('{"type":{"toString":"create"}}')).toBeNull();
  });

  it('rejects JSON that is not an object', () => {
    for (const raw of ['null', '42', '"create"', 'true', '[]', '[{"type":"create"}]', '']) {
      expect(parseClientMessage(raw)).toBeNull();
    }
  });

  it('requires the join code to be a string', () => {
    expect(parseClientMessage('{"type":"join","code":1234}')).toBeNull();
    expect(parseClientMessage('{"type":"join","code":null}')).toBeNull();
  });
});

describe('parseServerMessage', () => {
  it('accepts objects with a string type', () => {
    expect(parseServerMessage('{"type":"start","yourTurn":true}')).toEqual({ type: 'start', yourTurn: true });
  });

  it('rejects non-JSON and non-object input', () => {
    for (const raw of ['', 'oops', '{', 'null', '7', '"shot"', '[]', '{}', '{"type":3}']) {
      expect(parseServerMessage(raw)).toBeNull();
    }
  });
});

describe('boardFromFleet', () => {
  it('rejects a missing, extra or duplicated ship', () => {
    expect(boardFromFleet(fleet.slice(0, 4))).toBeNull();
    expect(boardFromFleet([...fleet, { ...fleet[4], y: 9 }])).toBeNull();
    expect(boardFromFleet([fleet[0], { ...fleet[0], y: 1 }, fleet[2], fleet[3], fleet[4]])).toBeNull();
  });

  it('rejects ships out of fleet order even when they fit', () => {
    const swapped = [fleet[0], fleet[1], fleet[3], fleet[2], fleet[4]];
    expect(boardFromFleet(swapped)).toBeNull();
  });

  it('rejects a single overlap or a single ship off the board', () => {
    expect(boardFromFleet(fleet.map((ship, i) => (i === 4 ? { ...ship, y: 0, x: 3 } : ship)))).toBeNull();
    expect(boardFromFleet(fleet.map((ship, i) => (i === 0 ? { ...ship, x: 6 } : ship)))).toBeNull();
    expect(boardFromFleet(fleet.map((ship, i) => (i === 1 ? { ...ship, x: -1 } : ship)))).toBeNull();
    expect(boardFromFleet(fleet.map((ship, i) => (i === 4 ? { ...ship, y: 9, orientation: 'vertical' } : ship)))).toBeNull();
  });

  it('round-trips random fleets through toPlacement', () => {
    for (let seed = 0; seed < 200; seed++) {
      const original = new Board();
      original.placeFleetRandomly(seeded(seed));
      const rebuilt = boardFromFleet(original.ships.map(toPlacement));
      expect(rebuilt).not.toBeNull();
      expect(rebuilt?.ships.map((ship) => ship.cells)).toEqual(original.ships.map((ship) => ship.cells));
    }
  });
});
