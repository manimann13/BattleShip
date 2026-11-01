import { describe, expect, it } from 'vitest';
import { ComputerPlayer } from '../src/ai/computer';
import { Board } from '../src/game/board';
import { FLEET, coordLabel } from '../src/game/types';
import { seeded } from './helpers';

const isAdjacent = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

function playOut(seed: number): number {
  const board = new Board();
  board.placeFleetRandomly(seeded(seed));
  const computer = new ComputerPlayer(seeded(seed + 1000));
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
