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

describe('placement edges', () => {
  it('fits a vertical ship flush with the bottom edge but not one square lower', () => {
    const board = new Board();
    expect(board.canPlace(destroyer, { x: 9, y: 8 }, 'vertical')).toBe(true);
    expect(board.canPlace(destroyer, { x: 9, y: 9 }, 'vertical')).toBe(false);
    expect(board.canPlace(destroyer, { x: 8, y: 9 }, 'horizontal')).toBe(true);
  });

  it('rejects origins that are not whole squares', () => {
    const board = new Board();
    expect(board.canPlace(destroyer, { x: 0.5, y: 0 }, 'horizontal')).toBe(false);
    expect(board.canPlace(destroyer, { x: 0, y: Number.NaN }, 'vertical')).toBe(false);
  });

  it('rejects a ship that crosses another at a single square', () => {
    const board = new Board();
    board.place(carrier, { x: 0, y: 4 }, 'horizontal');
    expect(board.canPlace(battleship, { x: 4, y: 1 }, 'vertical')).toBe(false);
    expect(board.canPlace(battleship, { x: 5, y: 1 }, 'vertical')).toBe(true);
  });

  it('leaves the board unchanged when a placement is refused', () => {
    const board = new Board();
    board.place(carrier, { x: 0, y: 0 }, 'horizontal');
    expect(() => board.place(battleship, { x: 7, y: 5 }, 'horizontal')).toThrow();
    expect(board.ships).toHaveLength(1);
    expect(board.shipAt({ x: 7, y: 5 })).toBeUndefined();
    expect(board.nextSpec).toBe(battleship);
  });

  it('undoes only the most recent ship', () => {
    const board = new Board();
    board.place(carrier, { x: 0, y: 0 }, 'horizontal');
    board.place(battleship, { x: 0, y: 1 }, 'horizontal');
    board.removeLastShip();
    expect(board.ships.map((ship) => ship.spec)).toEqual([carrier]);
    expect(board.shipAt({ x: 0, y: 0 })?.spec).toBe(carrier);
    expect(board.shipAt({ x: 0, y: 1 })).toBeUndefined();
    expect(board.canPlace(battleship, { x: 0, y: 1 }, 'horizontal')).toBe(true);
  });

  it('treats undo on an empty board as a no-op', () => {
    const board = new Board();
    board.removeLastShip();
    expect(board.ships).toHaveLength(0);
    expect(board.nextSpec).toBe(carrier);
  });

  it('clears every ship and frees every square', () => {
    const board = stackedBoard();
    board.clearShips();
    expect(board.ships).toHaveLength(0);
    expect(board.isFleetComplete).toBe(false);
    expect(board.nextSpec).toBe(carrier);
    expect(board.shipAt({ x: 0, y: 0 })).toBeUndefined();
    expect(board.canPlace(carrier, { x: 0, y: 0 }, 'horizontal')).toBe(true);
  });

  it('replaces an existing fleet when placing at random', () => {
    const board = stackedBoard();
    board.placeFleetRandomly(seeded(7));
    expect(board.isFleetComplete).toBe(true);
    expect(board.ships.map((ship) => ship.spec)).toEqual(FLEET);
  });

  it('places random fleets whose ships are straight, in bounds and match their origin', () => {
    for (let seed = 0; seed < 300; seed++) {
      const board = new Board();
      board.placeFleetRandomly(seeded(seed));
      for (const ship of board.ships) {
        expect(ship.cells).toHaveLength(ship.spec.length);
        ship.cells.forEach((cell, i) => {
          const horizontal = ship.orientation === 'horizontal';
          expect(horizontal ? cell.x - ship.origin.x : cell.y - ship.origin.y).toBe(i);
          expect(horizontal ? cell.y : cell.x).toBe(horizontal ? ship.origin.y : ship.origin.x);
          expect(cell.x >= 0 && cell.x < BOARD_SIZE && cell.y >= 0 && cell.y < BOARD_SIZE).toBe(true);
          expect(board.shipAt(cell)).toBe(ship);
        });
      }
    }
  });
});

describe('firing details', () => {
  it('only reports sunk on the last square, whatever the order', () => {
    const board = stackedBoard();
    for (const x of [4, 2, 0, 3]) expect(board.fire({ x, y: 0 }).result).toBe('hit');
    const last = board.fire({ x: 1, y: 0 });
    expect(last.result).toBe('sunk');
    expect(last.ship?.spec).toBe(carrier);
  });

  it('does not sink a ship because its neighbour was sunk', () => {
    const board = stackedBoard();
    board.fire({ x: 0, y: 4 });
    board.fire({ x: 1, y: 4 });
    const submarine = board.shipAt({ x: 0, y: 3 });
    expect(submarine && board.isSunk(submarine)).toBe(false);
    expect(board.allSunk).toBe(false);
  });

  it('does not count a repeat shot towards sinking a ship', () => {
    const board = stackedBoard();
    board.fire({ x: 0, y: 4 });
    expect(() => board.fire({ x: 0, y: 4 })).toThrow();
    expect(board.shotAt({ x: 0, y: 4 })).toBe('hit');
    expect(board.fire({ x: 1, y: 4 }).result).toBe('sunk');
  });

  it('does not record a shot that misses the board', () => {
    const board = stackedBoard();
    for (const cell of [{ x: -1, y: 0 }, { x: 0, y: 10 }, { x: 0.5, y: 0 }, { x: Number.NaN, y: 0 }]) {
      expect(() => board.fire(cell)).toThrow();
    }
    expect(board.shotAt({ x: 0, y: 0 })).toBeUndefined();
  });

  it('records known results on a board with no ships', () => {
    const enemy = new Board();
    enemy.recordShot({ x: 3, y: 3 }, 'hit');
    enemy.recordShot({ x: 4, y: 3 }, 'miss');
    expect(enemy.shotAt({ x: 3, y: 3 })).toBe('hit');
    expect(enemy.shotAt({ x: 4, y: 3 })).toBe('miss');
    expect(enemy.allSunk).toBe(false);
    expect(() => enemy.fire({ x: 3, y: 3 })).toThrow();
    expect(() => enemy.recordShot({ x: 10, y: 0 }, 'miss')).toThrow();
  });
});
