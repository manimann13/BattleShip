import { BOARD_SIZE, type Coord, type PlacedShip, type Rng, type ShotResult, isOnBoard } from '../game/types';

const DIRECTIONS: readonly Coord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const key = ({ x, y }: Coord): string => `${x},${y}`;

// Fires at random until it hits something, then hunts the squares around that hit.
export class ComputerPlayer {
  private readonly tried = new Set<string>();
  // Hits on ships that are not sunk yet.
  private openHits: Coord[] = [];

  constructor(private readonly rng: Rng = Math.random) {}

  chooseShot(): Coord {
    const line = this.lineTargets();
    const pool = line.length > 0 ? line : this.neighbourTargets();
    return this.pick(pool.length > 0 ? pool : this.untried());
  }

  report(target: Coord, result: ShotResult, sunkShip?: PlacedShip): void {
    this.tried.add(key(target));
    if (result === 'hit') this.openHits.push(target);
    if (result === 'sunk' && sunkShip) {
      const sunk = new Set(sunkShip.cells.map(key));
      this.openHits = this.openHits.filter((hit) => !sunk.has(key(hit)));
    }
  }

  private isOpenTarget(cell: Coord): boolean {
    return isOnBoard(cell) && !this.tried.has(key(cell));
  }

  // Squares continuing a run of two or more hits.
  private lineTargets(): Coord[] {
    const hits = new Set(this.openHits.map(key));
    const targets: Coord[] = [];
    for (const hit of this.openHits) {
      for (const d of DIRECTIONS) {
        const behind = { x: hit.x - d.x, y: hit.y - d.y };
        const ahead = { x: hit.x + d.x, y: hit.y + d.y };
        if (hits.has(key(behind)) && this.isOpenTarget(ahead)) targets.push(ahead);
      }
    }
    return targets;
  }

  private neighbourTargets(): Coord[] {
    return this.openHits.flatMap((hit) =>
      DIRECTIONS.map((d) => ({ x: hit.x + d.x, y: hit.y + d.y })).filter((cell) => this.isOpenTarget(cell)),
    );
  }

  private untried(): Coord[] {
    const cells: Coord[] = [];
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        if (!this.tried.has(key({ x, y }))) cells.push({ x, y });
      }
    }
    return cells;
  }

  private pick(cells: readonly Coord[]): Coord {
    if (cells.length === 0) throw new Error('No squares left to fire at');
    return cells[Math.floor(this.rng() * cells.length)];
  }
}
