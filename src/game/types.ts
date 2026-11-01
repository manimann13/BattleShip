export const BOARD_SIZE = 10;

export type ShipType = 'carrier' | 'battleship' | 'cruiser' | 'submarine' | 'destroyer';

export interface ShipSpec {
  readonly type: ShipType;
  readonly name: string;
  readonly length: number;
}

export const FLEET: readonly ShipSpec[] = [
  { type: 'carrier', name: 'Carrier', length: 5 },
  { type: 'battleship', name: 'Battleship', length: 4 },
  { type: 'cruiser', name: 'Cruiser', length: 3 },
  { type: 'submarine', name: 'Submarine', length: 3 },
  { type: 'destroyer', name: 'Destroyer', length: 2 },
];

export interface Coord {
  readonly x: number;
  readonly y: number;
}

export type Orientation = 'horizontal' | 'vertical';

export interface PlacedShip {
  readonly spec: ShipSpec;
  readonly origin: Coord;
  readonly orientation: Orientation;
  readonly cells: readonly Coord[];
}

export type ShotResult = 'miss' | 'hit' | 'sunk';

// Returns a number in [0, 1). Injectable so tests can be repeatable.
export type Rng = () => number;

export const isOnBoard = ({ x, y }: Coord): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;

// Grid label such as "C4".
export const coordLabel = ({ x, y }: Coord): string => `${String.fromCharCode(65 + x)}${y + 1}`;
