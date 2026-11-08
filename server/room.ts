import { randomBytes } from 'node:crypto';
import type { Board } from '../src/game/board';
import { Game, type PlayerId } from '../src/game/game';
import type { Rng, ShotResult } from '../src/game/types';
import {
  type EmoteId,
  type ServerMessage,
  type ShipPlacement,
  boardFromFleet,
  toPlacement,
} from '../src/net/protocol';

export interface Peer {
  send(message: ServerMessage): void;
  // Closes this connection. Called when the same player reconnects on a new one.
  close?(): void;
}

export interface RoomOptions {
  // How long a dropped player has to reconnect before the room closes.
  graceMs?: number;
  // How long a hosted game waits for someone to join.
  lobbyMs?: number;
  // How long a match can go without any move before it closes.
  idleMs?: number;
  // Shortest gap between two emotes from the same player.
  emoteGapMs?: number;
  // Called once, when the room closes.
  onClose?: (room: Room) => void;
  makeToken?: () => string;
}

type Phase = 'lobby' | 'placing' | 'battle' | 'over' | 'closed';

interface LoggedShot {
  readonly by: PlayerId;
  readonly x: number;
  readonly y: number;
  readonly result: ShotResult;
  readonly sunk?: ShipPlacement;
}

export const GRACE_MS = 60_000;
export const LOBBY_MS = 10 * 60_000;
export const IDLE_MS = 30 * 60_000;
const EMOTE_GAP_MS = 1_500;

const other = (player: PlayerId): PlayerId => (player === 0 ? 1 : 0);

// One online match. Holds both boards so neither player ever sees the other's ships.
// A player whose connection drops keeps their seat for a while and can rejoin with their token.
export class Room {
  private readonly peers: [Peer | null, Peer | null];
  private readonly tokens: [string, string];
  private readonly graceTimers: [ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null] = [
    null,
    null,
  ];
  private readonly lastEmote: [number, number] = [-Infinity, -Infinity];
  private boards: [Board | null, Board | null] = [null, null];
  private fleets: [ShipPlacement[] | null, ShipPlacement[] | null] = [null, null];
  private game: Game | null = null;
  private shots: LoggedShot[] = [];
  private rematch: [boolean, boolean] = [false, false];
  private phase: Phase = 'lobby';
  private readonly graceMs: number;
  private readonly emoteGapMs: number;
  private readonly idleMs: number;
  private expiry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly code: string,
    host: Peer,
    private readonly rng: Rng = Math.random,
    private readonly options: RoomOptions = {},
  ) {
    const makeToken = options.makeToken ?? (() => randomBytes(16).toString('hex'));
    this.peers = [host, null];
    this.tokens = [makeToken(), makeToken()];
    this.graceMs = options.graceMs ?? GRACE_MS;
    this.emoteGapMs = options.emoteGapMs ?? EMOTE_GAP_MS;
    this.idleMs = options.idleMs ?? IDLE_MS;
    host.send({ type: 'created', code, token: this.tokens[0] });
    this.expire(options.lobbyMs ?? LOBBY_MS, 'Nobody joined, so this game code expired. Host a new game.');
  }

  // (Re)starts the countdown that closes an abandoned room.
  private expire(ms: number, reason: string): void {
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = setTimeout(() => this.close(reason), ms);
    this.expiry.unref?.();
  }

  private touch(): void {
    this.expire(this.idleMs, 'This game ended because nobody moved for 30 minutes.');
  }

  // Ends the room for both players, telling them why.
  private close(reason: string): void {
    if (this.phase === 'closed') return;
    this.peers[0]?.send({ type: 'error', message: reason });
    this.peers[1]?.send({ type: 'error', message: reason });
    this.peers[0]?.close?.();
    this.peers[1]?.close?.();
    this.shutDown();
  }

  private shutDown(): void {
    this.phase = 'closed';
    if (this.expiry) clearTimeout(this.expiry);
    for (const timer of this.graceTimers) if (timer) clearTimeout(timer);
    this.options.onClose?.(this);
  }

  get closed(): boolean {
    return this.phase === 'closed';
  }

  // Returns the joiner's player id, or null if the room cannot take them.
  join(peer: Peer): PlayerId | null {
    if (this.phase !== 'lobby' || this.peers[1]) return null;
    this.peers[1] = peer;
    this.phase = 'placing';
    this.touch();
    this.peers[0]?.send({ type: 'matched', code: this.code, token: this.tokens[0] });
    peer.send({ type: 'matched', code: this.code, token: this.tokens[1] });
    return 1;
  }

  // Puts a returning player back in their seat. Returns their id, or null if the token does not match.
  rejoin(token: string, peer: Peer): PlayerId | null {
    if (this.phase === 'closed' || this.phase === 'lobby') return null;
    const player = this.tokens.indexOf(token);
    if (player !== 0 && player !== 1) return null;
    const previous = this.peers[player];
    this.peers[player] = peer;
    // The old connection may not have noticed it dropped yet. Close it so it cannot act for this player.
    if (previous && previous !== peer) previous.close?.();
    const timer = this.graceTimers[player];
    if (timer) clearTimeout(timer);
    this.graceTimers[player] = null;
    peer.send(this.resumeState(player));
    this.peers[other(player)]?.send({ type: 'opponentReconnected' });
    return player;
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
    this.fleets[player] = [...fleet];
    this.touch();
    this.peers[other(player)]?.send({ type: 'opponentReady' });

    const [first, second] = this.boards;
    if (!first || !second) return;
    const game = new Game([first, second]);
    game.current = this.rng() < 0.5 ? 0 : 1;
    this.game = game;
    this.shots = [];
    this.phase = 'battle';
    this.peers[0]?.send({ type: 'start', yourTurn: game.current === 0 });
    this.peers[1]?.send({ type: 'start', yourTurn: game.current === 1 });
  }

  fire(player: PlayerId, x: number, y: number): void {
    const game = this.game;
    if (this.phase !== 'battle' || !game) {
      this.fail(player, this.phase === 'over' ? 'The game is over' : 'The battle has not started');
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
    this.touch();
    if (outcome.gameOver) this.phase = 'over';
    const sunk = outcome.result === 'sunk' && outcome.ship ? toPlacement(outcome.ship) : undefined;
    this.shots.push({ by: player, x, y, result: outcome.result, sunk });
    const shot = { type: 'shot' as const, x, y, result: outcome.result, sunk, gameOver: outcome.gameOver };
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
    this.touch();
    if (!this.rematch[other(player)]) {
      this.peers[other(player)]?.send({ type: 'rematchRequested' });
      return;
    }
    this.boards = [null, null];
    this.fleets = [null, null];
    this.game = null;
    this.shots = [];
    this.rematch = [false, false];
    this.phase = 'placing';
    this.peers[0]?.send({ type: 'rematchStart' });
    this.peers[1]?.send({ type: 'rematchStart' });
  }

  // Passes a quick reaction to the opponent. Extra emotes sent too quickly are dropped.
  emote(player: PlayerId, emote: EmoteId, now = Date.now()): void {
    if (this.phase !== 'battle' && this.phase !== 'over') return;
    if (now - this.lastEmote[player] < this.emoteGapMs) return;
    this.lastEmote[player] = now;
    this.peers[other(player)]?.send({ type: 'emote', emote });
  }

  // The connection for `peer` dropped. Mid-match, the player gets a grace period to come back.
  disconnect(player: PlayerId, peer: Peer): void {
    if (this.phase === 'closed' || this.peers[player] !== peer) return;
    if (this.phase === 'lobby') {
      this.leave(player);
      return;
    }
    this.peers[player] = null;
    this.peers[other(player)]?.send({ type: 'opponentDisconnected', seconds: Math.round(this.graceMs / 1000) });
    this.graceTimers[player] = setTimeout(() => this.leave(player), this.graceMs);
  }

  // The player quit for good (or never came back). The room ends.
  leave(player: PlayerId): void {
    if (this.phase === 'closed') return;
    this.peers[player] = null;
    this.peers[other(player)]?.send({ type: 'opponentLeft' });
    this.shutDown();
  }

  private resumeState(player: PlayerId): ServerMessage {
    const phase = this.phase === 'battle' || this.phase === 'over' ? this.phase : 'placing';
    const opponent = other(player);
    return {
      type: 'resume',
      phase,
      fleet: this.fleets[player],
      yourTurn: this.phase === 'battle' && this.game?.current === player,
      shots: this.shots.map(({ by, ...shot }) => ({ ...shot, byYou: by === player })),
      enemyFleet: this.phase === 'over' ? (this.fleets[opponent] ?? undefined) : undefined,
      opponentConnected: this.peers[opponent] !== null,
      rematchRequested: this.rematch[opponent],
      rematchSent: this.rematch[player],
    };
  }

  private fail(player: PlayerId, message: string): void {
    this.peers[player]?.send({ type: 'error', message });
  }
}
