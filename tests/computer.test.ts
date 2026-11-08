import { describe, expect, it } from 'vitest';
import { ComputerPlayer, type Difficulty } from '../src/ai/computer';
import { Board } from '../src/game/board';
import { FLEET, coordLabel } from '../src/game/types';
import { seeded } from './helpers';

const isAdjacent = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

function playOut(seed: number, difficulty: Difficulty = 'normal'): number {
  const board = new Board();
  board.placeFleetRandomly(seeded(seed));
  const computer = new ComputerPlayer(seeded(seed + 1000), difficulty);
  const seen = new Set<string>();
  let shots = 0;
  while (!board.allSunk) {
    const target = computer.chooseShot();
    expect(seen.has(coordLabel(target))).toBe(false);
    seen.add(coordLabel(target));
    const { result, ship } = board.fire(target);
    computer.report(target, result, ship);
    shots++;
    expect(shots).toBeLessThanOrEqual(100);
  }
  return shots;
}

describe('ComputerPlayer', () => {
  it('always finishes a game without repeating a square', () => {
    for (let seed = 0; seed < 100; seed++) playOut(seed);
  });

  it('wins well before firing at every square on average', () => {
    const games = 200;
    let total = 0;
    for (let seed = 0; seed < games; seed++) total += playOut(seed);
    expect(total / games).toBeLessThan(75);
  });

  it('finishes a game on every difficulty without repeating a square', () => {
    for (const difficulty of ['easy', 'hard'] as const) {
      for (let seed = 0; seed < 30; seed++) playOut(seed, difficulty);
    }
  });

  it('gets better with each difficulty level', () => {
    const average = (difficulty: Difficulty) => {
      let total = 0;
      for (let seed = 0; seed < 100; seed++) total += playOut(seed, difficulty);
      return total / 100;
    };
    const easy = average('easy');
    const normal = average('normal');
    const hard = average('hard');
    expect(normal).toBeLessThan(easy - 10);
    expect(hard).toBeLessThan(normal - 5);
  });

  it('on Hard, fires next to a hit', () => {
    const computer = new ComputerPlayer(seeded(5), 'hard');
    const hit = { x: 5, y: 5 };
    computer.report(hit, 'hit');
    expect(isAdjacent(computer.chooseShot(), hit)).toBe(true);
  });

  it('fires next to a hit', () => {
    const computer = new ComputerPlayer(seeded(1));
    const hit = { x: 5, y: 5 };
    computer.report(hit, 'hit');
    expect(isAdjacent(computer.chooseShot(), hit)).toBe(true);
  });

  it('follows the line after two hits in a row', () => {
    const computer = new ComputerPlayer(seeded(2));
    computer.report({ x: 4, y: 5 }, 'hit');
    computer.report({ x: 5, y: 5 }, 'hit');
    const next = computer.chooseShot();
    expect(next.y).toBe(5);
    expect([3, 6]).toContain(next.x);
  });

  it('keeps hunting a second ship after sinking the first', () => {
    const board = new Board();
    const destroyer = FLEET[4];
    const ship = board.place(destroyer, { x: 2, y: 2 }, 'horizontal');
    const computer = new ComputerPlayer(seeded(3));
    const otherHit = { x: 2, y: 3 };
    computer.report(otherHit, 'hit');
    computer.report({ x: 2, y: 2 }, 'hit');
    computer.report({ x: 3, y: 2 }, 'sunk', ship);
    expect(isAdjacent(computer.chooseShot(), otherHit)).toBe(true);
  });

  it('returns to random firing once nothing is left to hunt', () => {
    const board = new Board();
    const ship = board.place(FLEET[4], { x: 0, y: 0 }, 'horizontal');
    const computer = new ComputerPlayer(seeded(4));
    computer.report({ x: 0, y: 0 }, 'hit');
    computer.report({ x: 1, y: 0 }, 'sunk', ship);
    const next = computer.chooseShot();
    expect(coordLabel(next)).not.toBe('A1');
    expect(coordLabel(next)).not.toBe('B1');
  });
});

const onBoard = ({ x, y }: { x: number; y: number }) =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 10 && y >= 0 && y < 10;

describe('ComputerPlayer targeting', () => {
  it('fires at all 100 squares exactly once when it never hits', () => {
    const computer = new ComputerPlayer(seeded(9));
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const target = computer.chooseShot();
      expect(onBoard(target)).toBe(true);
      seen.add(coordLabel(target));
      computer.report(target, 'miss');
    }
    expect(seen.size).toBe(100);
    expect(() => computer.chooseShot()).toThrow();
  });

  it('never fires off the board across many seeded games', () => {
    for (let seed = 0; seed < 200; seed++) {
      const board = new Board();
      board.placeFleetRandomly(seeded(seed * 7 + 3));
      const computer = new ComputerPlayer(seeded(seed));
      while (!board.allSunk) {
        const target = computer.chooseShot();
        expect(onBoard(target)).toBe(true);
        const { result, ship } = board.fire(target);
        computer.report(target, result, ship);
      }
    }
  });

  it('only hunts on the board next to a corner hit', () => {
    for (let seed = 0; seed < 20; seed++) {
      const computer = new ComputerPlayer(seeded(seed));
      computer.report({ x: 0, y: 0 }, 'hit');
      expect(['B1', 'A2']).toContain(coordLabel(computer.chooseShot()));
    }
  });

  it('extends a line inward when it reaches the edge', () => {
    const computer = new ComputerPlayer(seeded(5));
    computer.report({ x: 0, y: 5 }, 'hit');
    computer.report({ x: 1, y: 5 }, 'hit');
    expect(computer.chooseShot()).toEqual({ x: 2, y: 5 });
  });

  it('tries the other end of a line after a miss', () => {
    const computer = new ComputerPlayer(seeded(6));
    computer.report({ x: 4, y: 5 }, 'hit');
    computer.report({ x: 5, y: 5 }, 'hit');
    computer.report({ x: 6, y: 5 }, 'miss');
    expect(computer.chooseShot()).toEqual({ x: 3, y: 5 });
  });

  it('stops circling a ship once it is sunk', () => {
    const board = new Board();
    const ship = board.place(FLEET[2], { x: 4, y: 4 }, 'vertical');
    let nextToWreck = 0;
    for (let seed = 0; seed < 100; seed++) {
      const computer = new ComputerPlayer(seeded(seed));
      computer.report({ x: 4, y: 4 }, 'hit');
      computer.report({ x: 4, y: 5 }, 'hit');
      computer.report({ x: 4, y: 6 }, 'sunk', ship);
      const next = computer.chooseShot();
      if (ship.cells.some((cell) => isAdjacent(cell, next))) nextToWreck++;
    }
    // A random pick lands beside the wreck about 8 times in 97; still hunting would be every time.
    expect(nextToWreck).toBeLessThan(30);
  });
});
