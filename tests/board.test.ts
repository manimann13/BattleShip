import { describe, expect, it } from 'vitest';
import { Board } from '../src/game/board';
import { BOARD_SIZE, FLEET, coordLabel } from '../src/game/types';
import { seeded, stackedBoard } from './helpers';

const [carrier, battleship, , , destroyer] = FLEET;

describe('classic fleet', () => {
  it('has the five classic ships', () => {
    expect(FLEET.map((ship) => ship.length)).toEqual([5, 4, 3, 3, 2]);
    expect(BOARD_SIZE).toBe(10);
  });
});

describe('placement', () => {
  it('allows a ship that touches the far edge', () => {
    const board = new Board();
    expect(board.canPlace(carrier, { x: 5, y: 0 }, 'horizontal')).toBe(true);
    expect(board.canPlace(carrier, { x: 0, y: 5 }, 'vertical')).toBe(true);
  });

  it('rejects a ship that runs off the board', () => {
    const board = new Board();
    expect(board.canPlace(carrier, { x: 6, y: 0 }, 'horizontal')).toBe(false);
    expect(board.canPlace(carrier, { x: 0, y: 6 }, 'vertical')).toBe(false);
    expect(board.canPlace(carrier, { x: -1, y: 0 }, 'horizontal')).toBe(false);
  });

  it('rejects overlapping ships', () => {
    const board = new Board();
    board.place(carrier, { x: 0, y: 0 }, 'horizontal');
    expect(board.canPlace(battleship, { x: 2, y: 0 }, 'vertical')).toBe(false);
    expect(() => board.place(battleship, { x: 2, y: 0 }, 'vertical')).toThrow();
    expect(board.canPlace(battleship, { x: 2, y: 1 }, 'vertical')).toBe(true);
  });

  it('rejects placing the same ship twice', () => {
    const board = new Board();
    board.place(carrier, { x: 0, y: 0 }, 'horizontal');
    expect(board.canPlace(carrier, { x: 0, y: 5 }, 'horizontal')).toBe(false);
  });

  it('frees squares when a ship is undone', () => {
    const board = new Board();
    board.place(carrier, { x: 0, y: 0 }, 'horizontal');
    board.removeLastShip();
    expect(board.ships).toHaveLength(0);
    expect(board.shipAt({ x: 0, y: 0 })).toBeUndefined();
    expect(board.nextSpec).toBe(carrier);
  });

  it('places a complete, legal fleet at random', () => {
    for (let seed = 0; seed < 50; seed++) {
      const board = new Board();
      board.placeFleetRandomly(seeded(seed));
      expect(board.isFleetComplete).toBe(true);
      const cells = board.ships.flatMap((ship) => ship.cells.map(coordLabel));
      expect(cells).toHaveLength(17);
      expect(new Set(cells).size).toBe(17);
      expect(board.ships.flatMap((ship) => ship.cells).every(({ x, y }) => x >= 0 && x < 10 && y >= 0 && y < 10)).toBe(true);
    }
  });
});

describe('firing', () => {
  it('reports a miss, a hit, then a sunk ship', () => {
    const board = stackedBoard();
    expect(board.fire({ x: 9, y: 9 }).result).toBe('miss');
    const hit = board.fire({ x: 0, y: 4 });
    expect(hit.result).toBe('hit');
    expect(hit.ship?.spec).toBe(destroyer);
    expect(board.fire({ x: 1, y: 4 }).result).toBe('sunk');
    expect(board.shotAt({ x: 9, y: 9 })).toBe('miss');
    expect(board.shotAt({ x: 0, y: 4 })).toBe('hit');
  });

  it('rejects repeat and off-board shots', () => {
    const board = stackedBoard();
    board.fire({ x: 9, y: 9 });
    expect(() => board.fire({ x: 9, y: 9 })).toThrow();
    expect(() => board.fire({ x: 10, y: 0 })).toThrow();
  });

  it('knows when the whole fleet is gone', () => {
    const board = stackedBoard();
    const cells = board.ships.flatMap((ship) => ship.cells);
    cells.slice(0, -1).forEach((cell) => board.fire(cell));
    expect(board.allSunk).toBe(false);
    board.fire(cells[cells.length - 1]);
    expect(board.allSunk).toBe(true);
  });

  it('does not count an empty board as defeated', () => {
    expect(new Board().allSunk).toBe(false);
  });
});

describe('labels', () => {
  it('names squares like the grid', () => {
    expect(coordLabel({ x: 0, y: 0 })).toBe('A1');
    expect(coordLabel({ x: 9, y: 9 })).toBe('J10');
  });
});
