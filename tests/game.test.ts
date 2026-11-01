import { describe, expect, it } from 'vitest';
import { Board } from '../src/game/board';
import { Game } from '../src/game/game';
import { stackedBoard } from './helpers';

describe('Game', () => {
  it('refuses to start without complete fleets', () => {
    expect(() => new Game([new Board(), stackedBoard()])).toThrow();
  });

  it('alternates turns after every shot, even a hit', () => {
    const game = new Game([stackedBoard(), stackedBoard()]);
    expect(game.current).toBe(0);
    expect(game.fire({ x: 0, y: 0 }).result).toBe('hit');
    expect(game.current).toBe(1);
    expect(game.fire({ x: 9, y: 9 }).result).toBe('miss');
    expect(game.current).toBe(0);
  });

  it('fires at the opponent, not the shooter', () => {
    const game = new Game([stackedBoard(), stackedBoard()]);
    game.fire({ x: 0, y: 0 });
    expect(game.boardOf(1).shotAt({ x: 0, y: 0 })).toBe('hit');
    expect(game.boardOf(0).shotAt({ x: 0, y: 0 })).toBeUndefined();
  });

  it('keeps the turn when a shot is rejected', () => {
    const game = new Game([stackedBoard(), stackedBoard()]);
    game.fire({ x: 0, y: 0 });
    game.fire({ x: 9, y: 9 });
    expect(() => game.fire({ x: 0, y: 0 })).toThrow();
    expect(game.current).toBe(0);
  });

  it('declares a winner and stops', () => {
    const game = new Game([stackedBoard(), stackedBoard()]);
    const cells = game.boardOf(1).ships.flatMap((ship) => ship.cells);
    let last;
    cells.forEach((cell, i) => {
      last = game.fire(cell);
      if (i < cells.length - 1) game.fire({ x: 9 - (i % 10), y: 9 - Math.floor(i / 10) });
    });
    expect(last).toMatchObject({ gameOver: true, result: 'sunk', shooter: 0 });
    expect(game.winner).toBe(0);
    expect(() => game.fire({ x: 9, y: 0 })).toThrow();
  });
});
