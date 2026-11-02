import { Board } from '../game/board';
import { FLEET, type Coord, coordLabel } from '../game/types';
import { Connection } from '../net/connection';
import { type ClientMessage, type ServerMessage, type ShipPlacement, toPlacement } from '../net/protocol';
import { type BoardView, createBoardView } from './boardView';
import { button, h, icon } from './dom';
import type { Settings } from './settings';

// What the online game needs from the App that owns the screen.
export interface OnlineHost {
  show(...content: Node[]): void;
  showFresh(...content: Node[]): void;
  announce(message: string): void;
  settings: Settings;
  // Runs the shared ship-placement screen for this board and calls onReady when the player confirms.
  startPlacement(board: Board, onReady: () => void): void;
  quit(): void;
  showModes(): void;
}

type Phase = 'connecting' | 'waiting' | 'placing' | 'battle' | 'over';

const CODE_LENGTH = 4;

// Plays a match against a remote opponent. The server owns the real boards; this side
// keeps its own fleet plus a record of the shots it has fired at the enemy.
export class OnlineGame {
  private connection: Connection | null = null;
  private phase: Phase = 'connecting';
  private own = new Board();
  private enemy = new Board();
  private myTurn = false;
  private won = false;
  private message = '';
  private lastTarget: Coord | undefined;
  private awaitingShot = false;
  private rematchSent = false;
  private opponentLeft = false;

  constructor(private readonly host: OnlineHost) {}

  // Closes any open connection. Safe to call at any time.
  dispose(): void {
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
      h(
        'div',
        'menu',
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
      h(
        'div',
        'menu',
        icon('icon-radar', 'pass-icon'),
        h('h1', 'heading', title),
        h('p', 'menu-prompt', text),
        h('div', 'menu-buttons', ...actions),
      ),
    );
    this.host.announce(`${title}. ${text}`);
  }

  private open(first: ClientMessage): void {
    this.dispose();
    this.phase = 'connecting';
    this.opponentLeft = false;
    this.notice(
      'Connecting…',
      'The first connection can take up to a minute while the server wakes up.',
      button('Cancel', () => this.showLobby(), 'btn-quiet'),
    );
    this.connection = new Connection({
      onOpen: () => this.connection?.send(first),
      onMessage: (message) => this.handle(message),
      onClose: () => this.handleDrop(),
    });
  }

  private handleDrop(): void {
    this.connection = null;
    this.notice(
      'Connection lost',
      'The connection to the server was lost.',
      button('Back to Lobby', () => this.showLobby()),
      button('Main Menu', () => this.host.quit(), 'btn-quiet'),
    );
  }

  // ---------- Messages ----------

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'created':
        this.phase = 'waiting';
        this.notice(
          `Game code: ${message.code}`,
          'Share this code with your friend. The game starts when they join.',
          button('Cancel', () => this.showLobby(), 'btn-quiet'),
        );
        break;
      case 'matched':
      case 'rematchStart':
        this.beginPlacement();
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
      case 'opponentLeft':
        this.handleOpponentLeft();
        break;
      case 'error':
        this.handleError(message.message);
        break;
    }
  }

  private handleError(text: string): void {
    if (this.phase === 'connecting' || this.phase === 'waiting') {
      this.notice('Could not join', text, button('Back to Lobby', () => this.showLobby()));
      this.dispose();
      return;
    }
    this.host.announce(text);
    if (this.phase === 'battle') {
      // The shot was refused, so let the player try again.
      this.message = text;
      this.myTurn = this.awaitingShot;
      this.awaitingShot = false;
      this.renderBattle();
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
      'Your opponent disconnected.',
      button('Back to Lobby', () => this.showLobby()),
      button('Main Menu', () => this.host.quit(), 'btn-quiet'),
    );
  }

  // ---------- Placement ----------

  private beginPlacement(): void {
    this.phase = 'placing';
    this.own = new Board();
    this.enemy = new Board();
    this.myTurn = false;
    this.won = false;
    this.message = '';
    this.lastTarget = undefined;
    this.awaitingShot = false;
    this.rematchSent = false;
    this.host.startPlacement(this.own, () => this.sendFleet());
  }

  private sendFleet(): void {
    this.connection?.send({ type: 'ready', fleet: this.own.ships.map(toPlacement) });
    this.notice(
      'Fleet ready',
      'Waiting for your opponent to finish placing their ships…',
      button('Quit', () => this.host.quit(), 'btn-quiet'),
    );
  }

  // ---------- Battle ----------

  private beginBattle(yourTurn: boolean): void {
    this.phase = 'battle';
    this.myTurn = yourTurn;
    this.message = yourTurn ? 'You fire first. Choose a square on the enemy grid.' : 'Your opponent fires first.';
    this.host.announce(this.message);
    this.renderBattle(true);
  }

  private fireAt(cell: Coord): void {
    if (!this.myTurn || this.phase !== 'battle') return;
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

  private applyShot(shot: Extract<ServerMessage, { type: 'shot' }>): void {
    const cell = { x: shot.x, y: shot.y };
    const square = coordLabel(cell);
    if (shot.byYou) {
      this.enemy.recordShot(cell, shot.result === 'miss' ? 'miss' : 'hit');
      if (shot.sunk) this.reveal(this.enemy, shot.sunk);
    } else {
      this.own.fire(cell);
    }
    for (const ship of shot.fleet ?? []) this.reveal(this.enemy, ship);

    this.awaitingShot = false;
    if (shot.gameOver) {
      this.phase = 'over';
      this.won = shot.byYou;
      this.myTurn = false;
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

    const views = this.renderBattle();
    if (this.host.settings.animations) {
      const kind = shot.result === 'miss' ? 'splash' : 'explosion';
      (shot.byYou ? views.enemy : views.own).playEffect(cell, kind);
    }
  }

  private banner(): HTMLElement {
    if (this.phase === 'over') {
      return h('div', `banner ${this.won ? 'banner-victory' : 'banner-defeat'}`, this.won ? 'Victory!' : 'Defeat!');
    }
    return this.myTurn
      ? h('div', 'banner banner-blue', 'Your Turn')
      : h('div', 'banner banner-red', 'Opponent’s Turn');
  }

  private fleetStatus(board: Board): HTMLElement {
    const items = FLEET.map((spec) => {
      // Enemy ships only appear on our copy of their board once they have sunk (or the game ended).
      const ship = board.ships.find((placed) => placed.spec.type === spec.type);
      const sunk = ship !== undefined && board.isSunk(ship);
      return h('li', sunk ? 'status-item is-sunk' : 'status-item', sunk ? `${spec.name} (sunk)` : spec.name);
    });
    return h('ul', 'status-list', ...items);
  }

  private renderBattle(fresh = false): { own: BoardView; enemy: BoardView } {
    const over = this.phase === 'over';
    const canFire = this.myTurn && !over;

    const own = createBoardView({ board: this.own, mode: 'static', label: 'Your fleet', showShip: () => true });
    const enemy = createBoardView({
      board: this.enemy,
      mode: 'fire',
      label: 'Enemy waters',
      locked: !canFire,
      initialFocus: this.lastTarget,
      showShip: () => true,
      onActivate: (cell) => this.fireAt(cell),
    });

    const controls = h('div', 'battle-controls');
    if (over) {
      const rematch = button(this.rematchSent ? 'Waiting for opponent…' : 'Rematch', () => {
        this.rematchSent = true;
        this.connection?.send({ type: 'rematch' });
        this.renderBattle();
      }, 'btn-green');
      rematch.disabled = this.rematchSent || this.opponentLeft;
      controls.append(rematch, button('Main Menu', () => this.host.quit()));
    }

    const content = [
      h(
        'header',
        'topbar',
        h('p', 'brand', icon('icon-anchor', 'icon'), 'Battle Ship'),
        this.banner(),
        button('Quit', () => this.host.quit(), 'btn-small btn-quiet'),
      ),
      h('p', 'message', this.message),
      controls,
      h(
        'div',
        'battlefield',
        h(
          'section',
          'board-panel',
          h('h2', 'board-title', icon('icon-flag-blue', 'icon'), 'Your Fleet'),
          own.element,
          this.fleetStatus(this.own),
        ),
        h(
          'section',
          'board-panel',
          h('h2', 'board-title', icon('icon-flag-red', 'icon'), over ? 'Enemy Fleet' : 'Enemy Waters'),
          enemy.element,
          this.fleetStatus(this.enemy),
        ),
      ),
    ];
    if (fresh) this.host.showFresh(...content);
    else this.host.show(...content);
    if (canFire && !fresh && this.lastTarget) enemy.focusCell(this.lastTarget);
    return { own, enemy };
  }
}
