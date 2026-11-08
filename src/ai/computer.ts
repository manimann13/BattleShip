import { BOARD_SIZE, FLEET, type Coord, type PlacedShip, type Rng, type ShotResult, isOnBoard } from '../game/types';

export type Difficulty = 'easy' | 'normal' | 'hard';

const DIRECTIONS: readonly Coord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const key = ({ x, y }: Coord): string => `${x},${y}`;

// Placements that cover open hits are far more likely, so they count much more on Hard.
const HIT_WEIGHT = 50;

// Easy fires at random. Normal fires at random until it hits, then hunts the squares around that hit.
// Hard works out, for every square, how many ways the ships still afloat could cover it, and fires at the best one.
export class ComputerPlayer {
  private readonly tried = new Set<string>();
  // Hits on ships that are not sunk yet.
  private openHits: Coord[] = [];
  // Lengths of the ships not sunk yet.
  private readonly remaining: number[] = FLEET.map((spec) => spec.length);

  constructor(
    private readonly rng: Rng = Math.random,
    readonly difficulty: Difficulty = 'normal',
  ) {}

  chooseShot(): Coord {
    if (this.difficulty === 'easy') return this.pick(this.untried());
    if (this.difficulty === 'hard') return this.pick(this.likeliest());
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
      const index = this.remaining.indexOf(sunkShip.spec.length);
      if (index >= 0) this.remaining.splice(index, 1);
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

  // The untried squares with the highest score. A placement can only use squares that are
  // untried or open hits; one that covers open hits counts HIT_WEIGHT times per hit.
  private likeliest(): Coord[] {
    const open = new Set(this.openHits.map(key));
    const scores = new Map<string, number>();
    for (const length of this.remaining) {
      for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
            const cells: Coord[] = [];
            let hits = 0;
            let fits = true;
            for (let i = 0; i < length && fits; i++) {
              const cell = { x: x + dx * i, y: y + dy * i };
              const k = key(cell);
              if (!isOnBoard(cell) || (this.tried.has(k) && !open.has(k))) fits = false;
              else if (open.has(k)) hits++;
              else cells.push(cell);
            }
            // A length-1 ship would be placed twice; there are none, so both orientations are distinct.
            if (!fits || cells.length === 0) continue;
            const weight = HIT_WEIGHT ** hits;
            for (const cell of cells) scores.set(key(cell), (scores.get(key(cell)) ?? 0) + weight);
          }
        }
      }
    }
    let best = 0;
    for (const score of scores.values()) best = Math.max(best, score);
    if (best === 0) return this.untried();
    return this.untried().filter((cell) => scores.get(key(cell)) === best);
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
