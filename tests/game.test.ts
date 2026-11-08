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

describe('Game end', () => {
  // The player to move sinks the other fleet while the opponent misses along rows 5-9.
  function playToWin(game: Game) {
    const loser = game.current === 0 ? 1 : 0;
    const cells = game.boardOf(loser).ships.flatMap((ship) => ship.cells);
    return cells.map((cell, i) => {
      const outcome = game.fire(cell);
      if (i < cells.length - 1) game.fire({ x: i % 10, y: 5 + Math.floor(i / 10) });
      return outcome;
    });
  }

  it('lets the second player win when they move first', () => {
    const game = new Game([stackedBoard(), stackedBoard()]);
    game.current = 1;
    expect(playToWin(game).at(-1)).toMatchObject({ gameOver: true, shooter: 1 });
    expect(game.winner).toBe(1);
  });

  it('reports game over only on the final shot', () => {
    const game = new Game([stackedBoard(), stackedBoard()]);
    const outcomes = playToWin(game);
    expect(outcomes.filter((outcome) => outcome.gameOver)).toHaveLength(1);
    expect(outcomes.at(-1)?.gameOver).toBe(true);
  });

  it('keeps the winner and turn fixed after the game ends', () => {
    const game = new Game([stackedBoard(), stackedBoard()]);
    playToWin(game);
    expect(game.winner).toBe(0);
    expect(game.current).toBe(0);
    game.current = 1;
    expect(() => game.fire({ x: 9, y: 9 })).toThrow();
    expect(game.winner).toBe(0);
    expect(game.boardOf(0).shotAt({ x: 9, y: 9 })).toBeUndefined();
  });

  it('keeps the turn when a shot misses the board', () => {
    const game = new Game([stackedBoard(), stackedBoard()]);
    expect(() => game.fire({ x: 10, y: 0 })).toThrow();
    expect(game.current).toBe(0);
    expect(game.winner).toBeNull();
  });
});
