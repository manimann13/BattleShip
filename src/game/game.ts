import type { Board, FireResult } from './board';
import type { Coord } from './types';

export type PlayerId = 0 | 1;

export interface ShotOutcome extends FireResult {
  readonly shooter: PlayerId;
  readonly target: Coord;
  readonly gameOver: boolean;
}

const opponentOf = (player: PlayerId): PlayerId => (player === 0 ? 1 : 0);

// Runs the battle: players alternate one shot each until a fleet is gone.
export class Game {
  current: PlayerId = 0;
  winner: PlayerId | null = null;

  constructor(readonly boards: readonly [Board, Board]) {
    if (!boards.every((board) => board.isFleetComplete)) {
      throw new Error('Both fleets must be placed before the battle starts');
    }
  }

  boardOf(player: PlayerId): Board {
    return this.boards[player];
  }

  fire(target: Coord): ShotOutcome {
    if (this.winner !== null) throw new Error('The game is over');
    const shooter = this.current;
    const opponent = opponentOf(shooter);
    const fired = this.boards[opponent].fire(target);
    const gameOver = this.boards[opponent].allSunk;
    if (gameOver) this.winner = shooter;
    else this.current = opponent;
    return { ...fired, shooter, target, gameOver };
  }
}
