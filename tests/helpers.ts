import { Board } from '../src/game/board';
import { FLEET } from '../src/game/types';

// Repeatable random numbers, so failures can be reproduced.
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ships stacked in rows 0-4, all starting at column 0.
export function stackedBoard(): Board {
  const board = new Board();
  FLEET.forEach((spec, y) => board.place(spec, { x: 0, y }, 'horizontal'));
  return board;
}
