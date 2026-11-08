import { Board } from '../game/board';
import { MatchStats, earnsGoldAnchor } from '../game/stats';
import { FLEET, type Coord, type ShotResult, coordLabel } from '../game/types';
import { Connection } from '../net/connection';
import {
  type ClientMessage,
  EMOTES,
  type EmoteId,
  type ResumeState,
  type ServerMessage,
  type ShipPlacement,
  type ShotRecord,
  boardFromFleet,
  toPlacement,
} from '../net/protocol';
import type { BoardView } from './boardView';
import { button, h, icon } from './dom';
import { type Tally, addGoldAnchor, addResult } from './record';
import type { Settings } from './settings';
import { playShotSound } from './sound';
import { banner, battleScreen } from './battleView';
import { statsPanel } from './statsView';
import { setMusicTrack } from './music';

// What the online game needs from the App that owns the screen.
export interface OnlineHost {
  show(...content: Node[]): void;
  showFresh(...content: Node[]): void;
  // A brass plaque centred on the screen, for the lobby and the waiting and notice screens.
  plaque(...children: Node[]): HTMLElement;
  // The game just ended: plays the victory or defeat show.
  celebrate(won: boolean): void;
  announce(message: string): void;
  settings: Settings;
  // Runs the shared ship-placement screen for this board and calls onReady when the player confirms.
  startPlacement(board: Board, onReady: () => void): void;
  quit(): void;
  showModes(): void;
}

type Phase = 'connecting' | 'waiting' | 'placing' | 'battle' | 'over';

interface Session {
  code: string;
  token: string;
}

const CODE_LENGTH = 4;
const SESSION_KEY = 'battleship-online';
// Waits between reconnect attempts, about 60 seconds in all: as long as the server keeps a seat.
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000, 8000, 5000];
const EMOTE_SHOW_MS = 3000;
const EMOTE_GAP_MS = 1500;

function loadSession(): Session | null {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object') {
      const { code, token } = parsed as Record<string, unknown>;
      if (typeof code === 'string' && typeof token === 'string') return { code, token };
    }
  } catch {
    // Blocked or corrupt storage: nothing to rejoin.
  }
  return null;
}

// Kept per tab, so a reload can rejoin but a second tab does not take over the same seat.
function storeSession(session: Session | null): void {
  try {
    if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Rejoining after a reload then will not be offered.
  }
}

// Plays a match against a remote opponent. The server owns the real boards; this side
// keeps its own fleet plus a record of the shots it has fired at the enemy.
export class OnlineGame {
  private connection: Connection | null = null;
  private session: Session | null = loadSession();
  // True while this page is taking part in a match, as opposed to holding a session left by a reload.
  private active = false;
  private phase: Phase = 'connecting';
  private own = new Board();
  private enemy = new Board();
  private stats = new MatchStats();
  private goldAnchors: number | undefined;
  private tally: Tally | null = null;
  private myTurn = false;
  private won = false;
  private message = '';
  private lastTarget: Coord | undefined;
  private awaitingShot = false;
  private fleetSent = false;
  private rematchSent = false;
  private opponentLeft = false;
  private opponentAway = false;

  private connected = false;
  // The message that started the last connection attempt, so Retry can repeat it.
  private lastAttempt: ClientMessage = { type: 'create' };
  private reconnecting = false;
  private retry = 0;
  private retryTimer: number | undefined;

  private readonly bubbles = { mine: h('div', 'emote-bubble'), theirs: h('div', 'emote-bubble emote-theirs') };
  private readonly bubbleTimers = { mine: 0, theirs: 0 };
  private emoteReadyAt = 0;
  // The message button and its list are kept between renders, so the list stays open while the screen updates.
  private readonly messageToggle: HTMLButtonElement;
  private readonly messageMenu: HTMLElement;
  private readonly messageControl: HTMLElement;
  private messageMenuOpen = false;

  constructor(private readonly host: OnlineHost) {
    for (const bubble of Object.values(this.bubbles)) bubble.setAttribute('aria-hidden', 'true');

    this.messageToggle = button('', () => this.setMessageMenu(!this.messageMenuOpen), 'btn-small btn-quiet btn-icon');
    this.messageToggle.append(icon('icon-message', 'icon'));
    this.messageToggle.setAttribute('aria-label', 'Send a message');
    this.messageToggle.title = 'Send a message';
    this.messageToggle.setAttribute('aria-controls', 'message-menu');
    const choices = (Object.keys(EMOTES) as EmoteId[]).map((emote) =>
      button(EMOTES[emote], () => {
        this.sendEmote(emote);
        this.setMessageMenu(false);
        this.messageToggle.focus();
      }, 'btn-small message-choice'),
    );
    this.messageMenu = h('div', 'message-menu', ...choices);
    this.messageMenu.id = 'message-menu';
    this.messageMenu.setAttribute('role', 'group');
    this.messageMenu.setAttribute('aria-label', 'Messages');
    this.messageControl = h('div', 'message-control', this.messageToggle, this.messageMenu);
    this.setMessageMenu(false);

    // Clicking anywhere else, or pressing Escape, closes the list.
    document.addEventListener('click', (event) => {
      if (this.messageMenuOpen && !this.messageControl.contains(event.target as Node)) this.setMessageMenu(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.messageMenuOpen) {
        this.setMessageMenu(false);
        this.messageToggle.focus();
      }
    });
  }

  private setMessageMenu(open: boolean): void {
    this.messageMenuOpen = open;
    this.messageMenu.hidden = !open;
    this.messageToggle.setAttribute('aria-expanded', String(open));
    if (open) this.messageMenu.querySelector('button')?.focus();
  }

  // True when a match from before a page reload may still be waiting for this player.
  canRejoin(): boolean {
    return this.session !== null;
  }

  rejoinSaved(): void {
    const session = this.session;
    if (!session) return;
    this.open({ type: 'rejoin', code: session.code, token: session.token });
  }

  // Leaves the current match, if any, and closes the connection. Safe to call at any time.
  dispose(): void {
    window.clearTimeout(this.retryTimer);
    this.reconnecting = false;
    if (this.active) {
      this.connection?.send({ type: 'leave' });
      this.session = null;
      storeSession(null);
    }
    this.active = false;
    this.connected = false;
    this.connection?.close();
    this.connection = null;
  }

  // ---------- Lobby ----------

  showLobby(): void {
    this.dispose();
    const input = h('input', 'text-input');
    input.type = 'text';
    input.maxLength = CODE_LENGTH;
    input.placeholder = 'CODE';
    input.autocomplete = 'off';
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Game code');
    const join = () => {
      const code = input.value.trim().toUpperCase();
      if (code.length === CODE_LENGTH) this.open({ type: 'join', code });
      else input.focus();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') join();
    });

    this.host.showFresh(
      this.host.plaque(
        h('h1', 'heading', 'Play Online'),
        h('p', 'menu-prompt', 'Play a friend on another device.'),
        h(
          'div',
          'menu-buttons',
          button('Host a Game', () => this.open({ type: 'create' }), 'btn-green'),
          h('p', 'hint', 'or enter a friend’s code'),
          input,
          button('Join Game', join),
          button('Back', () => this.host.showModes(), 'btn-quiet'),
        ),
      ),
    );
  }

  private notice(title: string, text: string, ...actions: HTMLButtonElement[]): void {
    this.host.showFresh(
      this.host.plaque(
        icon('icon-radar', 'pass-icon'),
        h('h1', 'heading', title),
        h('p', 'menu-prompt', text),
        h('div', 'menu-buttons', ...actions),
      ),
    );
    this.host.announce(`${title}. ${text}`);
  }

  // Like notice(), but with a sweeping radar, for screens that wait on the server or the opponent.
  private waiting(title: string, text: string, ...actions: HTMLButtonElement[]): void {
    this.radarScreen('pass-icon radar-sweep', title, text, actions);
  }

  // A slow red sweep: the signal is gone, but Retry can look for it again.
  private lostSignal(title: string, text: string, ...actions: HTMLButtonElement[]): void {
    this.radarScreen('pass-icon radar-sweep radar-lost', title, text, actions);
  }

  private radarScreen(radarClass: string, title: string, text: string, actions: HTMLButtonElement[]): void {
    const radar = h('div', radarClass);
    radar.setAttribute('aria-hidden', 'true');
    this.host.showFresh(
      this.host.plaque(
        radar,
        h('h1', 'heading', title),
        h('p', 'menu-prompt', text),
        h('div', 'menu-buttons', ...actions),
      ),
    );
    this.host.announce(`${title}. ${text}`);
  }

  private open(first: ClientMessage): void {
    this.dispose();
    this.lastAttempt = first;
    this.retry = 0;
    if (first.type === 'rejoin') {
      // dispose() forgot the seat; keep it while trying to get back in.
      this.session = { code: first.code, token: first.token };
      storeSession(this.session);
    }
    this.phase = 'connecting';
    this.opponentLeft = false;
    this.active = true;
    this.waiting(
      'Connecting…',
      'The first connection can take up to a minute while the server wakes up.',
      button('Cancel', () => this.showLobby(), 'btn-quiet'),
    );
    this.connect(first);
  }

  private connect(first: ClientMessage): void {
    let opened = false;
    this.connection = new Connection({
      onOpen: () => {
        opened = true;
        this.connection?.send(first);
      },
      onMessage: (message) => this.handle(message),
      onClose: () => this.handleDrop(opened),
    });
  }

  // ---------- Dropped connections ----------

  // `opened` is false when the server could not be reached at all.
  private handleDrop(opened: boolean): void {
    this.connection = null;
    this.connected = false;
    if (this.inMatch() && this.session && !this.opponentLeft) {
      this.scheduleReconnect();
      return;
    }
    this.giveUp(
      opened
        ? 'The connection to the server was lost.'
        : 'Could not reach the game server. Check your internet connection, then try again.',
    );
  }

  private inMatch(): boolean {
    return this.phase === 'placing' || this.phase === 'battle' || this.phase === 'over';
  }

  private scheduleReconnect(): void {
    if (this.retry >= RETRY_DELAYS_MS.length) {
      this.giveUp('Could not reconnect to the game.');
      return;
    }
    if (!this.reconnecting) {
      this.reconnecting = true;
      this.message = 'Connection lost. Reconnecting…';
      this.host.announce(this.message);
      if (this.phase === 'battle' || this.phase === 'over') this.renderBattle();
    }
    const session = this.session;
    this.retryTimer = window.setTimeout(() => {
      if (!session || !this.reconnecting) return;
      this.retry++;
      this.connect({ type: 'rejoin', code: session.code, token: session.token });
    }, RETRY_DELAYS_MS[this.retry]);
  }

  // Retry rejoins the match if there was one, otherwise repeats the last attempt (host or join).
  private giveUp(text: string): void {
    const session = this.inMatch() ? this.session : null;
    const attempt = this.lastAttempt;
    this.dispose();
    const retry = session
      ? () => this.open({ type: 'rejoin', code: session.code, token: session.token })
      : () => this.open(attempt);
    this.lostSignal(
      'Connection lost',
      text,
      button('Retry', retry, 'btn-green'),
      button('Main Menu', () => this.host.quit(), 'btn-quiet'),
    );
  }

  // ---------- Messages ----------

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'created':
        this.saveSession(message.code, message.token);
        this.phase = 'waiting';
        this.connected = true;
        this.waiting(
          `Game code: ${message.code}`,
          'Share this code with your friend. The game starts when they join.',
          button('Cancel', () => this.showLobby(), 'btn-quiet'),
        );
        break;
      case 'matched':
        this.saveSession(message.code, message.token);
        this.connected = true;
        this.beginPlacement();
        break;
      case 'rematchStart':
        this.beginPlacement();
        break;
      case 'resume':
        this.resume(message);
        break;
      case 'opponentReady':
        this.host.announce('Your opponent has placed their fleet.');
        break;
      case 'start':
        this.beginBattle(message.yourTurn);
        break;
      case 'shot':
        this.applyShot(message);
        break;
      case 'rematchRequested':
        this.message = 'Your opponent wants a rematch.';
        this.host.announce(this.message);
        if (this.phase === 'over') this.renderBattle();
        break;
      case 'opponentDisconnected':
        this.opponentAway = true;
        this.setMessage(`Your opponent lost connection. Waiting up to ${message.seconds} seconds for them…`);
        break;
      case 'opponentReconnected':
        this.opponentAway = false;
        this.setMessage('Your opponent is back.');
        break;
      case 'emote':
        this.showEmote('theirs', message.emote);
        break;
      case 'opponentLeft':
        this.handleOpponentLeft();
        break;
      case 'error':
        this.handleError(message.message);
        break;
    }
  }

  private saveSession(code: string, token: string): void {
    this.session = { code, token };
    storeSession(this.session);
  }

  // Shows a status line on the battle screen, or just announces it elsewhere.
  private setMessage(text: string): void {
    this.message = text;
    this.host.announce(text);
    if (this.phase === 'battle' || this.phase === 'over') this.renderBattle();
  }

  private handleError(text: string): void {
    // A rejoin was refused: the match is over for good (the grace period ran out, or the server restarted),
    // so Retry would never work.
    if (this.reconnecting || (this.phase === 'connecting' && this.lastAttempt.type === 'rejoin')) {
      this.dispose();
      this.notice(
        'Game ended',
        'The game ended while you were disconnected.',
        button('Back to Lobby', () => this.showLobby(), 'btn-green'),
        button('Main Menu', () => this.host.quit(), 'btn-quiet'),
      );
      return;
    }
    if (this.phase === 'connecting' || this.phase === 'waiting') {
      this.dispose();
      const title = this.phase === 'waiting' ? 'Game closed' : 'Could not join';
      this.notice(title, text, button('Back to Lobby', () => this.showLobby()));
      return;
    }
    this.host.announce(text);
    if (this.phase === 'battle' && this.awaitingShot) {
      // The shot was refused, so let the player try again.
      this.message = text;
      this.myTurn = true;
      this.awaitingShot = false;
      this.renderBattle();
    } else if (this.phase === 'placing' && this.fleetSent) {
      // The fleet was refused: go back to placing it.
      this.fleetSent = false;
      this.host.startPlacement(this.own, () => this.sendFleet());
    }
  }

  private handleOpponentLeft(): void {
    this.opponentLeft = true;
    this.dispose();
    if (this.phase === 'over') {
      this.message = 'Your opponent left the game.';
      this.host.announce(this.message);
      this.renderBattle();
      return;
    }
    this.notice(
      'Opponent left',
      'Your opponent left the game.',
      button('Back to Lobby', () => this.showLobby()),
      button('Main Menu', () => this.host.quit(), 'btn-quiet'),
    );
  }

  // ---------- Reconnecting ----------

  private resume(state: ResumeState): void {
    const wasReconnecting = this.reconnecting;
    this.reconnecting = false;
    this.retry = 0;
    this.connected = true;
    this.opponentAway = !state.opponentConnected;
    this.opponentLeft = false;

    if (state.phase === 'placing') {
      if (state.fleet) {
        this.phase = 'placing';
        this.own = boardFromFleet(state.fleet) ?? new Board();
        this.fleetSent = true;
        this.showFleetReady();
      } else if (this.phase === 'placing' && this.fleetSent) {
        // The fleet was sent while the connection was down: send it again.
        this.sendFleet();
      } else if (this.phase !== 'placing') {
        this.beginPlacement();
      }
      // Otherwise the player is still on the placement screen, which carries on as it was.
      if (wasReconnecting) this.host.announce('Reconnected.');
      return;
    }

    const own = state.fleet ? boardFromFleet(state.fleet) : null;
    if (!own) {
      this.giveUp('The game could not be restored.');
      return;
    }
    this.own = own;
    this.enemy = new Board();
    this.stats = new MatchStats();
    this.tally = null;
    this.goldAnchors = undefined;
    this.awaitingShot = false;
    this.fleetSent = true;
    for (const shot of state.shots) this.recordShot(shot);
    for (const ship of state.enemyFleet ?? []) this.reveal(this.enemy, ship);
    this.phase = state.phase;
    this.myTurn = state.phase === 'battle' && state.yourTurn;
    this.won = state.phase === 'over' && state.shots.at(-1)?.byYou === true;
    if (state.phase === 'over') this.stats.finish();
    this.rematchSent = state.rematchSent;
    this.lastTarget = undefined;

    const parts = [wasReconnecting ? 'Reconnected.' : 'Back in the game.'];
    if (this.opponentAway) parts.push('Waiting for your opponent to reconnect…');
    else if (state.rematchRequested) parts.push('Your opponent wants a rematch.');
    else if (state.phase === 'battle') parts.push(this.myTurn ? 'Your turn.' : 'Your opponent’s turn.');
    this.message = parts.join(' ');
    this.host.announce(this.message);
    this.renderBattle(true);
  }

  // ---------- Placement ----------

  private beginPlacement(): void {
    this.phase = 'placing';
    this.own = new Board();
    this.enemy = new Board();
    this.stats = new MatchStats();
    this.tally = null;
    this.goldAnchors = undefined;
    this.myTurn = false;
    this.won = false;
    this.message = '';
    this.lastTarget = undefined;
    this.awaitingShot = false;
    this.fleetSent = false;
    this.rematchSent = false;
    this.host.startPlacement(this.own, () => this.sendFleet());
  }

  private sendFleet(): void {
    this.fleetSent = true;
    // While reconnecting this is dropped; resume() sends it again once the connection is back.
    this.connection?.send({ type: 'ready', fleet: this.own.ships.map(toPlacement) });
    this.showFleetReady();
  }

  private showFleetReady(): void {
    this.waiting(
      'Fleet ready',
      'Waiting for your opponent to finish placing their ships…',
      button('Quit', () => this.host.quit(), 'btn-quiet'),
    );
  }

  // ---------- Battle ----------

  private beginBattle(yourTurn: boolean): void {
    this.phase = 'battle';
    this.myTurn = yourTurn;
    this.stats = new MatchStats();
    this.goldAnchors = undefined;
    this.message = yourTurn ? 'You fire first. Choose a square on the enemy grid.' : 'Your opponent fires first.';
    this.host.announce(this.message);
    this.renderBattle(true);
  }

  private fireAt(cell: Coord): void {
    if (!this.myTurn || this.phase !== 'battle' || !this.connected) return;
    this.lastTarget = cell;
    this.myTurn = false;
    this.awaitingShot = true;
    this.message = `Firing at ${coordLabel(cell)}…`;
    this.connection?.send({ type: 'fire', x: cell.x, y: cell.y });
    this.renderBattle();
  }

  private reveal(board: Board, ship: ShipPlacement): void {
    const spec = FLEET.find((candidate) => candidate.type === ship.type);
    if (!spec || board.ships.some((placed) => placed.spec.type === ship.type)) return;
    board.place(spec, { x: ship.x, y: ship.y }, ship.orientation);
  }

  // Applies a shot to the boards and stats, without touching the screen.
  private recordShot(shot: ShotRecord): void {
    const cell = { x: shot.x, y: shot.y };
    if (shot.byYou) {
      this.enemy.recordShot(cell, shot.result === 'miss' ? 'miss' : 'hit');
      if (shot.sunk) this.reveal(this.enemy, shot.sunk);
    } else {
      this.own.fire(cell);
    }
    this.stats.record(shot.byYou ? 0 : 1, shot.result);
  }

  private applyShot(shot: Extract<ServerMessage, { type: 'shot' }>): void {
    const cell = { x: shot.x, y: shot.y };
    const square = coordLabel(cell);
    this.recordShot(shot);
    for (const ship of shot.fleet ?? []) this.reveal(this.enemy, ship);

    this.awaitingShot = false;
    if (shot.gameOver) {
      this.phase = 'over';
      this.won = shot.byYou;
      this.myTurn = false;
      this.stats.finish();
      this.tally = addResult('online', shot.byYou);
      if (shot.byYou && earnsGoldAnchor(this.stats.sides[0])) this.goldAnchors = addGoldAnchor();
      this.host.celebrate(shot.byYou);
    } else {
      this.myTurn = !shot.byYou;
    }

    const who = shot.byYou ? 'You' : 'Your opponent';
    const name = FLEET.find((spec) => spec.type === shot.sunk?.type)?.name;
    this.message =
      shot.result === 'sunk' && name
        ? `${square}: ${who} sank ${shot.byYou ? 'the enemy' : 'your'} ${name}!`
        : `${who} fired at ${square}: ${shot.result === 'miss' ? 'Miss.' : 'Hit!'}`;
    if (shot.gameOver) this.message += shot.byYou ? ' You win!' : ' You lose.';
    this.host.announce(this.message);

    const views = this.renderBattle(false, shot.result);
    if (this.host.settings.sound) playShotSound(shot.result);
    if (this.host.settings.animations) {
      const kind = shot.result === 'miss' ? 'splash' : 'explosion';
      (shot.byYou ? views.enemy : views.own).playEffect(cell, kind);
    }
  }

  // ---------- Emotes ----------

  private sendEmote(emote: EmoteId): void {
    const now = Date.now();
    if (!this.connected || now < this.emoteReadyAt) return;
    this.emoteReadyAt = now + EMOTE_GAP_MS;
    this.connection?.send({ type: 'emote', emote });
    this.showEmote('mine', emote);
  }

  private showEmote(side: 'mine' | 'theirs', emote: EmoteId): void {
    const bubble = this.bubbles[side];
    bubble.textContent = EMOTES[emote];
    // Restart the pop-in animation even if a bubble is already showing.
    bubble.classList.remove('is-visible');
    void bubble.offsetWidth;
    bubble.classList.add('is-visible');
    window.clearTimeout(this.bubbleTimers[side]);
    this.bubbleTimers[side] = window.setTimeout(() => bubble.classList.remove('is-visible'), EMOTE_SHOW_MS);
    if (side === 'theirs') this.host.announce(`Your opponent says: ${EMOTES[emote]}`);
  }

  // ---------- Screen ----------

  private banner(): HTMLElement {
    if (this.phase === 'over') return this.won ? banner('victory', 'Victory!') : banner('defeat', 'Defeat!');
    return this.myTurn ? banner('blue', 'Your Turn') : banner('red', 'Opponent’s Turn');
  }

  // The status line. While waiting on a connection, its trailing "…" becomes animated dots.
  private messageLine(): HTMLElement {
    const trying = this.reconnecting || this.opponentAway;
    if (!trying) return h('p', 'message', this.message);
    const line = h('p', 'message message-warning', this.message);
    if (this.message.endsWith('…')) {
      const dots = h('span', 'dots', h('span', 'dots-inner', '...'));
      dots.setAttribute('aria-hidden', 'true');
      line.replaceChildren(this.message.slice(0, -1), dots);
    }
    return line;
  }

  private renderBattle(fresh = false, flash?: ShotResult): { own: BoardView; enemy: BoardView } {
    const over = this.phase === 'over';
    const canFire = this.myTurn && !over && this.connected;
    // Messages need someone on the other end.
    const canMessage = this.connected && !this.opponentLeft;
    if (!canMessage) this.setMessageMenu(false);

    const controls: HTMLElement[] = [];
    if (over) {
      const rematch = button(this.rematchSent ? 'Waiting for opponent…' : 'Rematch', () => {
        this.rematchSent = true;
        this.connection?.send({ type: 'rematch' });
        this.renderBattle();
      }, 'btn-green');
      rematch.disabled = this.rematchSent || this.opponentLeft || !this.connected;
      controls.push(rematch, button('Main Menu', () => this.host.quit()));
    }

    const { content, own, enemy } = battleScreen({
      settings: this.host.settings,
      banner: this.banner(),
      message: this.messageLine(),
      flash,
      onQuit: () => this.host.quit(),
      controls,
      topbarExtras: canMessage ? [this.messageControl] : [],
      result: over
        ? {
            won: this.won,
            title: this.won ? 'Victory!' : 'Defeat!',
            summary: statsPanel(
              this.stats,
              ['You', 'Opponent'],
              this.tally ? { label: 'Your online record', tally: this.tally } : undefined,
              this.goldAnchors,
            ),
          }
        : undefined,
      own: { board: this.own, title: 'Your Fleet', badge: this.bubbles.mine },
      enemy: {
        board: this.enemy,
        title: over ? 'Enemy Fleet' : 'Enemy Waters',
        badge: this.bubbles.theirs,
        locked: !canFire,
        initialFocus: this.lastTarget,
        // Our copy of the enemy board only holds ships we have sunk, or all of them once the game ends.
        showShip: () => true,
        onActivate: (cell) => this.fireAt(cell),
      },
    });
    if (fresh) this.host.showFresh(...content);
    else this.host.show(...content);
    if (!over) setMusicTrack('battle');
    if (canFire && !fresh && this.lastTarget) enemy.focusCell(this.lastTarget);
    return { own, enemy };
  }
}
