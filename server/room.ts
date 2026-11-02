import type { Board } from '../src/game/board';
import { Game, type PlayerId } from '../src/game/game';
import type { Rng } from '../src/game/types';
import { type ServerMessage, type ShipPlacement, boardFromFleet, toPlacement } from '../src/net/protocol';

export interface Peer {
  send(message: ServerMessage): void;
}

type Phase = 'lobby' | 'placing' | 'battle' | 'over' | 'closed';

const other = (player: PlayerId): PlayerId => (player === 0 ? 1 : 0);

// One online match. Holds both boards so neither player ever sees the other's ships.
export class Room {
  private readonly peers: [Peer | null, Peer | null];
  private boards: [Board | null, Board | null] = [null, null];
  private game: Game | null = null;
  private rematch: [boolean, boolean] = [false, false];
  private phase: Phase = 'lobby';

  constructor(
    readonly code: string,
    host: Peer,
    private readonly rng: Rng = Math.random,
  ) {
    this.peers = [host, null];
  }

  get closed(): boolean {
    return this.phase === 'closed';
  }

  // Returns the joiner's player id, or null if the room cannot take them.
  join(peer: Peer): PlayerId | null {
    if (this.phase !== 'lobby' || this.peers[1]) return null;
    this.peers[1] = peer;
    this.phase = 'placing';
    this.peers[0]?.send({ type: 'matched' });
    peer.send({ type: 'matched' });
    return 1;
  }

  ready(player: PlayerId, fleet: readonly ShipPlacement[]): void {
    if (this.phase !== 'placing' || this.boards[player]) {
      this.fail(player, 'Fleet cannot be placed right now');
      return;
    }
    const board = boardFromFleet(fleet);
    if (!board) {
      this.fail(player, 'That fleet is not valid');
      return;
    }
    this.boards[player] = board;
    this.peers[other(player)]?.send({ type: 'opponentReady' });

    const [first, second] = this.boards;
    if (!first || !second) return;
    const game = new Game([first, second]);
    game.current = this.rng() < 0.5 ? 0 : 1;
    this.game = game;
    this.phase = 'battle';
    this.peers[0]?.send({ type: 'start', yourTurn: game.current === 0 });
    this.peers[1]?.send({ type: 'start', yourTurn: game.current === 1 });
  }

  fire(player: PlayerId, x: number, y: number): void {
    const game = this.game;
    if (this.phase !== 'battle' || !game) {
      this.fail(player, 'The battle has not started');
      return;
    }
    if (game.current !== player) {
      this.fail(player, 'It is not your turn');
      return;
    }
    let outcome;
    try {
      outcome = game.fire({ x, y });
    } catch (error) {
      this.fail(player, error instanceof Error ? error.message : 'Invalid shot');
      return;
    }

    const opponent = other(player);
    if (outcome.gameOver) this.phase = 'over';
    const shot = {
      type: 'shot' as const,
      x,
      y,
      result: outcome.result,
      sunk: outcome.result === 'sunk' && outcome.ship ? toPlacement(outcome.ship) : undefined,
      gameOver: outcome.gameOver,
    };
    const fleetOf = (side: PlayerId) => (outcome.gameOver ? game.boardOf(side).ships.map(toPlacement) : undefined);
    this.peers[player]?.send({ ...shot, byYou: true, fleet: fleetOf(opponent) });
    this.peers[opponent]?.send({ ...shot, byYou: false, fleet: fleetOf(player) });
  }

  requestRematch(player: PlayerId): void {
    if (this.phase !== 'over') {
      this.fail(player, 'The game is not over');
      return;
    }
    this.rematch[player] = true;
    if (!this.rematch[other(player)]) {
      this.peers[other(player)]?.send({ type: 'rematchRequested' });
      return;
    }
    this.boards = [null, null];
    this.game = null;
    this.rematch = [false, false];
    this.phase = 'placing';
    this.peers[0]?.send({ type: 'rematchStart' });
    this.peers[1]?.send({ type: 'rematchStart' });
  }

  // A room ends as soon as either player leaves.
  leave(player: PlayerId): void {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    this.peers[player] = null;
    this.peers[other(player)]?.send({ type: 'opponentLeft' });
  }

  private fail(player: PlayerId, message: string): void {
    this.peers[player]?.send({ type: 'error', message });
  }
}
