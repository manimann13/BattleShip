import {
  BOARD_SIZE,
  FLEET,
  type Coord,
  type Orientation,
  type PlacedShip,
  type Rng,
  type ShipSpec,
  type ShotResult,
  isOnBoard,
} from './types';

export interface FireResult {
  readonly result: ShotResult;
  // The ship that was struck; undefined on a miss.
  readonly ship?: PlacedShip;
}

const cellIndex = ({ x, y }: Coord): number => y * BOARD_SIZE + x;

export function shipCells(spec: ShipSpec, origin: Coord, orientation: Orientation): Coord[] {
  return Array.from({ length: spec.length }, (_, i) =>
    orientation === 'horizontal' ? { x: origin.x + i, y: origin.y } : { x: origin.x, y: origin.y + i },
  );
}

export class Board {
  private readonly placed: PlacedShip[] = [];
  private readonly occupied = new Map<number, PlacedShip>();
  private readonly shots = new Map<number, 'miss' | 'hit'>();

  get ships(): readonly PlacedShip[] {
    return this.placed;
  }

  // The next ship still to be placed, in fleet order.
  get nextSpec(): ShipSpec | undefined {
    return FLEET[this.placed.length];
  }

  get isFleetComplete(): boolean {
    return this.placed.length === FLEET.length;
  }

  canPlace(spec: ShipSpec, origin: Coord, orientation: Orientation): boolean {
    if (this.placed.some((ship) => ship.spec.type === spec.type)) return false;
    return shipCells(spec, origin, orientation).every(
      (cell) => isOnBoard(cell) && !this.occupied.has(cellIndex(cell)),
    );
  }

  place(spec: ShipSpec, origin: Coord, orientation: Orientation): PlacedShip {
    if (!this.canPlace(spec, origin, orientation)) {
      throw new Error(`Cannot place ${spec.name} there`);
    }
    const ship: PlacedShip = { spec, origin, orientation, cells: shipCells(spec, origin, orientation) };
    this.placed.push(ship);
    for (const cell of ship.cells) this.occupied.set(cellIndex(cell), ship);
    return ship;
  }

  removeLastShip(): void {
    const ship = this.placed.pop();
    if (ship) for (const cell of ship.cells) this.occupied.delete(cellIndex(cell));
  }

  clearShips(): void {
    this.placed.length = 0;
    this.occupied.clear();
  }

  placeFleetRandomly(rng: Rng = Math.random): void {
    this.clearShips();
    for (const spec of FLEET) {
      let placed = false;
      while (!placed) {
        const orientation: Orientation = rng() < 0.5 ? 'horizontal' : 'vertical';
        const origin = { x: Math.floor(rng() * BOARD_SIZE), y: Math.floor(rng() * BOARD_SIZE) };
        if (this.canPlace(spec, origin, orientation)) {
          this.place(spec, origin, orientation);
          placed = true;
        }
      }
    }
  }

  shipAt(cell: Coord): PlacedShip | undefined {
    return this.occupied.get(cellIndex(cell));
  }

  shotAt(cell: Coord): 'miss' | 'hit' | undefined {
    return this.shots.get(cellIndex(cell));
  }

  isSunk(ship: PlacedShip): boolean {
    return ship.cells.every((cell) => this.shots.has(cellIndex(cell)));
  }

  get allSunk(): boolean {
    return this.placed.length > 0 && this.placed.every((ship) => this.isSunk(ship));
  }

  fire(cell: Coord): FireResult {
    if (!isOnBoard(cell)) throw new Error('Shot is off the board');
    if (this.shots.has(cellIndex(cell))) throw new Error('That square has already been fired at');
    const ship = this.shipAt(cell);
    this.shots.set(cellIndex(cell), ship ? 'hit' : 'miss');
    if (!ship) return { result: 'miss' };
    return { result: this.isSunk(ship) ? 'sunk' : 'hit', ship };
  }
}
