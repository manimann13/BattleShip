import { Board } from '../game/board';
import { FLEET, type Orientation, type PlacedShip, type ShipType, type ShotResult } from '../game/types';

// Messages exchanged over the WebSocket. Shared by the browser and the server.

export interface ShipPlacement {
  readonly type: ShipType;
  readonly x: number;
  readonly y: number;
  readonly orientation: Orientation;
}

export type ClientMessage =
  | { type: 'create' }
  | { type: 'join'; code: string }
  | { type: 'ready'; fleet: ShipPlacement[] }
  | { type: 'fire'; x: number; y: number }
  | { type: 'rematch' };

export type ServerMessage =
  | { type: 'created'; code: string }
  | { type: 'matched' }
  | { type: 'opponentReady' }
  | { type: 'start'; yourTurn: boolean }
  | {
      type: 'shot';
      byYou: boolean;
      x: number;
      y: number;
      result: ShotResult;
      // Set when this shot sank a ship.
      sunk?: ShipPlacement;
      gameOver: boolean;
      // Set when the game ends: the receiving player's enemy fleet, so it can be revealed.
      fleet?: ShipPlacement[];
    }
  | { type: 'rematchRequested' }
  | { type: 'rematchStart' }
  | { type: 'opponentLeft' }
  | { type: 'error'; message: string };

export const toPlacement = (ship: PlacedShip): ShipPlacement => ({
  type: ship.spec.type,
  x: ship.origin.x,
  y: ship.origin.y,
  orientation: ship.orientation,
});

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

function parsePlacement(value: unknown): ShipPlacement | null {
  if (!value || typeof value !== 'object') return null;
  const { type, x, y, orientation } = value as Record<string, unknown>;
  const spec = FLEET.find((candidate) => candidate.type === type);
  if (!spec || !isInt(x) || !isInt(y)) return null;
  if (orientation !== 'horizontal' && orientation !== 'vertical') return null;
  return { type: spec.type, x, y, orientation };
}

// Returns null for anything that is not a well-formed client message.
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const message = data as Record<string, unknown>;
  switch (message.type) {
    case 'create':
    case 'rematch':
      return { type: message.type };
    case 'join':
      return typeof message.code === 'string' ? { type: 'join', code: message.code } : null;
    case 'fire':
      return isInt(message.x) && isInt(message.y) ? { type: 'fire', x: message.x, y: message.y } : null;
    case 'ready': {
      if (!Array.isArray(message.fleet)) return null;
      const fleet = message.fleet.map(parsePlacement);
      return fleet.every((ship) => ship !== null) ? { type: 'ready', fleet } : null;
    }
    default:
      return null;
  }
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (data && typeof data === 'object' && typeof (data as { type?: unknown }).type === 'string') {
      return data as ServerMessage;
    }
  } catch {
    // Fall through: not JSON.
  }
  return null;
}

// Builds a board from a submitted fleet, or null if it is not a legal full fleet in fleet order.
export function boardFromFleet(fleet: readonly ShipPlacement[]): Board | null {
  if (fleet.length !== FLEET.length) return null;
  const board = new Board();
  for (const ship of fleet) {
    const spec = board.nextSpec;
    const origin = { x: ship.x, y: ship.y };
    if (!spec || spec.type !== ship.type || !board.canPlace(spec, origin, ship.orientation)) return null;
    board.place(spec, origin, ship.orientation);
  }
  return board;
}
