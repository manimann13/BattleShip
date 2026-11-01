import { ComputerPlayer } from '../ai/computer';
import { Board, shipCells } from '../game/board';
import { Game, type PlayerId, type ShotOutcome } from '../game/game';
import { FLEET, type Coord, type Orientation, coordLabel, isOnBoard } from '../game/types';
import { type BoardView, createBoardView } from './boardView';
import { button, h, icon } from './dom';
import { COMPUTER_DELAY_MS, type ComputerSpeed, loadSettings, saveSettings } from './settings';

type Mode = 'computer' | 'two-player';

const opponentOf = (player: PlayerId): PlayerId => (player === 0 ? 1 : 0);

export class App {
  private readonly screen = h('div', 'screen');
  private readonly live = h('div', 'sr-only');
  private readonly settings = loadSettings();

  private mode: Mode = 'computer';
  private boards: [Board, Board] = [new Board(), new Board()];
  private game: Game | null = null;
  private computer: ComputerPlayer | null = null;
  private viewer: PlayerId = 0;
  private awaitingPass = false;
  private message = '';
  private lastTarget: Coord | undefined;
  private computerTimer: number | undefined;

  private orientation: Orientation = 'horizontal';
  private placementView: BoardView | null = null;
  private placementHover: Coord | null = null;
  private placingPlayer: PlayerId = 0;

  constructor(private readonly root: HTMLElement) {
    this.screen.tabIndex = -1;
    this.live.setAttribute('aria-live', 'polite');
    this.root.append(this.screen, this.live);
    this.applyGridLabels();
    document.addEventListener('keydown', (event) => {
      if (this.placementView && event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey) {
        this.rotate();
      }
    });
  }

  start(): void {
    this.showMenu();
  }

  private show(...content: Node[]): void {
    this.placementView = null;
    this.screen.replaceChildren(...content);
  }

  private showFresh(...content: Node[]): void {
    this.show(...content);
    this.screen.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  private stopGame(): void {
    window.clearTimeout(this.computerTimer);
    this.game = null;
    this.computer = null;
  }

  private playerName(player: PlayerId): string {
    if (this.mode === 'two-player') return `Player ${player + 1}`;
    return player === 0 ? 'You' : 'Enemy';
  }

  // ---------- Menus ----------

  private showMenu(): void {
    this.stopGame();
    this.showFresh(
      h(
        'div',
        'menu',
        this.title(),
        h(
          'div',
          'menu-buttons',
          button('Play', () => this.showModes()),
          button('Settings', () => this.showSettings()),
          button('How to Play', () => this.showHowTo()),
        ),
      ),
    );
  }

  private title(): HTMLElement {
    return h('h1', 'title', icon('icon-anchor', 'title-icon'), 'Battle Ship');
  }

  private showModes(): void {
    this.showFresh(
      h(
        'div',
        'menu',
        this.title(),
        h('p', 'menu-prompt', 'Choose your opponent'),
        h(
          'div',
          'menu-buttons',
          button('vs Computer', () => this.startSetup('computer')),
          button('2 Players', () => this.startSetup('two-player')),
          button('Back', () => this.showMenu(), 'btn-quiet'),
        ),
      ),
    );
  }

  private showHowTo(): void {
    const legend = ([
      ['tile-miss', 'Miss'],
      ['tile-hit', 'Hit'],
      ['tile-sunk', 'Sunk'],
      ['tile-valid', 'Valid placement'],
      ['tile-invalid', 'Invalid placement'],
    ] as const).map(([name, label]) => h('li', '', icon(name, 'legend-tile'), label));

    const fleet = FLEET.map((spec) => h('li', '', `${spec.name}: ${spec.length} squares`));

    this.showFresh(
      h(
        'div',
        'panel howto',
        h('h1', 'heading', 'How to Play'),
        h(
          'ol',
          'howto-steps',
          h('li', '', 'Place your five ships on the 10x10 grid. Ships cannot overlap or leave the board.'),
          h('li', '', 'Take turns firing one shot at a square on the enemy grid.'),
          h('li', '', 'A ship sinks when all of its squares are hit.'),
          h('li', '', 'Sink the whole enemy fleet to win.'),
          h('li', '', 'In 2 Players, pass the device between turns and look away while the other player is setting up or firing.'),
        ),
        h('h2', 'subheading', 'Your fleet'),
        h('ul', 'howto-fleet', ...fleet),
        h('h2', 'subheading', 'Board key'),
        h('ul', 'legend', ...legend),
        h('p', 'hint', 'Keyboard: arrow keys move, Enter fires or places, R rotates.'),
        h('div', 'actions', button('Back', () => this.showMenu())),
      ),
    );
  }

  private showSettings(): void {
    const speedOptions: readonly [ComputerSpeed, string][] = [
      ['slow', 'Slow'],
      ['normal', 'Normal'],
      ['fast', 'Fast'],
    ];
    const speeds = speedOptions.map(([speed, label]) => {
      const input = h('input');
      input.type = 'radio';
      input.name = 'computer-speed';
      input.checked = this.settings.computerSpeed === speed;
      input.addEventListener('change', () => {
        this.settings.computerSpeed = speed;
        saveSettings(this.settings);
      });
      return h('label', 'setting-option', input, label);
    });

    const toggle = (label: string, checked: boolean, onChange: (checked: boolean) => void) => {
      const input = h('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.addEventListener('change', () => {
        onChange(input.checked);
        saveSettings(this.settings);
      });
      return h('label', 'setting-option', input, label);
    };

    this.showFresh(
      h(
        'div',
        'panel settings',
        h('h1', 'heading settings-heading', icon('icon-gear', 'icon'), 'Settings'),
        h(
          'fieldset',
          'setting-group',
          h('legend', 'subheading', 'Computer speed'),
          h('p', 'hint', 'How long the computer waits before firing.'),
          h('div', 'setting-options', ...speeds),
        ),
        h(
          'fieldset',
          'setting-group',
          h('legend', 'subheading', 'Display'),
          h(
            'div',
            'setting-options',
            toggle('Explosion and splash animations', this.settings.animations, (checked) => {
              this.settings.animations = checked;
            }),
            toggle('Grid labels (A-J, 1-10)', this.settings.gridLabels, (checked) => {
              this.settings.gridLabels = checked;
              this.applyGridLabels();
            }),
          ),
        ),
        h('div', 'actions', button('Back', () => this.showMenu())),
      ),
    );
  }

  private applyGridLabels(): void {
    this.root.classList.toggle('hide-grid-labels', !this.settings.gridLabels);
  }

  // ---------- Ship placement ----------

  private startSetup(mode: Mode): void {
    this.stopGame();
    this.mode = mode;
    this.boards = [new Board(), new Board()];
    this.orientation = 'horizontal';
    this.showPlacement(0);
  }

  private showPlacement(player: PlayerId, focus?: Coord, fresh = true): void {
    this.placingPlayer = player;
    const board = this.boards[player];
    const heading = this.mode === 'two-player' ? `Player ${player + 1}: Place Your Fleet` : 'Place Your Fleet';
    const next = board.nextSpec;

    const view = createBoardView({
      board,
      mode: 'place',
      label: `${heading} grid`,
      showShip: () => true,
      locked: board.isFleetComplete,
      initialFocus: focus,
      onActivate: (cell) => this.placeAt(cell),
      onHover: (cell) => {
        this.placementHover = cell;
        this.updatePreview();
      },
    });

    const shipList = FLEET.map((spec) => {
      const placed = board.ships.some((ship) => ship.spec.type === spec.type);
      const state = placed ? 'is-placed' : spec === next ? 'is-next' : '';
      return h(
        'li',
        `fleet-item ${state}`.trim(),
        icon(`ship-${spec.type}`, 'fleet-ship'),
        h('span', '', `${spec.name} (${spec.length})`),
        h('span', 'fleet-state', placed ? 'Placed' : spec === next ? 'Next' : ''),
      );
    });

    const ready = button('Ready', () => this.finishPlacement(player), 'btn-green');
    ready.disabled = !board.isFleetComplete;
    const undo = button('Undo', () => {
      board.removeLastShip();
      this.showPlacement(player, focus, false);
    });
    undo.disabled = board.ships.length === 0;

    const hint = next
      ? `Click a square to place the ${next.name}. Press R to rotate.`
      : 'Fleet ready. Press Ready to continue.';

    const content = [
      h(
        'header',
        'topbar',
        h('h1', 'heading', heading),
        button('Quit', () => this.showMenu(), 'btn-small btn-quiet'),
      ),
      h(
        'div',
        'placement',
        view.element,
        h(
          'div',
          'panel placement-side',
          h('p', 'hint', hint),
          h('ul', 'fleet-list', ...shipList),
          h(
            'div',
            'actions',
            button(`Rotate: ${this.orientation === 'horizontal' ? 'Across' : 'Down'}`, () => this.rotate()),
            button('Random', () => {
              board.placeFleetRandomly();
              this.showPlacement(player, focus, false);
            }),
            undo,
            ready,
          ),
        ),
      ),
    ];

    if (fresh) this.showFresh(...content);
    else this.show(...content);
    this.placementView = view;
    if (focus && !fresh) view.focusCell(focus);
    this.updatePreview();
  }

  private placeAt(cell: Coord): void {
    const board = this.boards[this.placingPlayer];
    const spec = board.nextSpec;
    if (!spec || !board.canPlace(spec, cell, this.orientation)) return;
    board.place(spec, cell, this.orientation);
    this.live.textContent = `${spec.name} placed at ${coordLabel(cell)}.`;
    this.showPlacement(this.placingPlayer, cell, false);
  }

  private rotate(): void {
    this.orientation = this.orientation === 'horizontal' ? 'vertical' : 'horizontal';
    const hover = this.placementHover;
    this.showPlacement(this.placingPlayer, hover ?? undefined, false);
    this.placementHover = hover;
    this.updatePreview();
  }

  private updatePreview(): void {
    const view = this.placementView;
    if (!view) return;
    const board = this.boards[this.placingPlayer];
    const spec = board.nextSpec;
    const hover = this.placementHover;
    if (!spec || !hover || !isOnBoard(hover)) {
      view.setPreview([], true);
      return;
    }
    view.setPreview(shipCells(spec, hover, this.orientation), board.canPlace(spec, hover, this.orientation));
  }

  private finishPlacement(player: PlayerId): void {
    this.placementHover = null;
    if (this.mode === 'computer') {
      this.boards[1].placeFleetRandomly();
      this.computer = new ComputerPlayer();
      this.startBattle();
    } else if (player === 0) {
      this.orientation = 'horizontal';
      this.showPass(1, 'Player 1 fleet is ready.', () => this.showPlacement(1));
    } else {
      this.showPass(0, 'Both fleets are ready.', () => this.startBattle());
    }
  }

  // ---------- Pass the device ----------

  private showPass(to: PlayerId, note: string, onReady: () => void): void {
    const from = opponentOf(to);
    this.showFresh(
      h(
        'div',
        'menu',
        icon('icon-radar', 'pass-icon'),
        h('h1', 'heading', `Pass to Player ${to + 1}`),
        h('p', 'menu-prompt', `${note} Player ${from + 1}, look away.`),
        h(
          'div',
          'menu-buttons',
          button(`I'm Player ${to + 1}: Ready`, onReady, 'btn-green'),
          button('Quit', () => this.showMenu(), 'btn-quiet'),
        ),
      ),
    );
  }

  // ---------- Battle ----------

  private startBattle(): void {
    this.game = new Game(this.boards);
    this.viewer = 0;
    this.awaitingPass = false;
    this.lastTarget = undefined;
    this.setMessage('Choose a square on the enemy grid to fire.');
    this.renderBattle(true);
  }

  private setMessage(message: string): void {
    this.message = message;
    this.live.textContent = message;
  }

  private describeShot(outcome: ShotOutcome): string {
    const square = coordLabel(outcome.target);
    const shooter = this.playerName(outcome.shooter);
    if (outcome.result === 'sunk' && outcome.ship) {
      if (this.mode === 'computer') {
        return outcome.shooter === 0
          ? `${square}: You sank the enemy ${outcome.ship.spec.name}!`
          : `${square}: The enemy sank your ${outcome.ship.spec.name}!`;
      }
      return `${square}: ${shooter} sank Player ${opponentOf(outcome.shooter) + 1}'s ${outcome.ship.spec.name}!`;
    }
    const result = outcome.result === 'hit' ? 'Hit!' : 'Miss.';
    return `${shooter} fired at ${square}: ${result}`;
  }

  private fleetStatus(board: Board): HTMLElement {
    const items = board.ships.map((ship) => {
      const sunk = board.isSunk(ship);
      return h(
        'li',
        sunk ? 'status-item is-sunk' : 'status-item',
        sunk ? `${ship.spec.name} (sunk)` : ship.spec.name,
      );
    });
    return h('ul', 'status-list', ...items);
  }

  private banner(game: Game): HTMLElement {
    if (game.winner !== null) {
      const youWon = this.mode === 'two-player' || game.winner === 0;
      return h('div', `banner ${youWon ? 'banner-victory' : 'banner-defeat'}`, youWon ? 'Victory!' : 'Defeat!');
    }
    if (this.mode === 'computer') {
      return game.current === 0
        ? h('div', 'banner banner-blue', 'Your Turn')
        : h('div', 'banner banner-red', 'Enemy Turn');
    }
    return h('div', `banner ${this.viewer === 0 ? 'banner-blue' : 'banner-red'}`, `Player ${this.viewer + 1} Turn`);
  }

  private renderBattle(fresh = false): { own: BoardView; enemy: BoardView } | null {
    const game = this.game;
    if (!game) return null;
    const over = game.winner !== null;
    const viewer = this.viewer;
    const opponent = opponentOf(viewer);
    const ownBoard = game.boardOf(viewer);
    const enemyBoard = game.boardOf(opponent);
    const canFire = !over && !this.awaitingPass && game.current === viewer;

    const own = createBoardView({
      board: ownBoard,
      mode: 'static',
      label: 'Your fleet',
      showShip: () => true,
    });
    const enemy = createBoardView({
      board: enemyBoard,
      mode: 'fire',
      label: 'Enemy waters',
      locked: !canFire,
      initialFocus: this.lastTarget,
      showShip: (ship) => over || enemyBoard.isSunk(ship),
      onActivate: (cell) => this.fireAt(cell),
    });

    const ownTitle = this.mode === 'computer' ? 'Your Fleet' : `Player ${viewer + 1} Fleet`;
    let enemyTitle = 'Enemy Waters';
    if (this.mode === 'two-player') {
      enemyTitle = over ? `Player ${opponent + 1} Fleet` : `Player ${opponent + 1} Waters`;
    }

    const controls = h('div', 'battle-controls');
    if (over) {
      controls.append(
        button('Play Again', () => this.startSetup(this.mode), 'btn-green'),
        button('Main Menu', () => this.showMenu()),
      );
    } else if (this.awaitingPass) {
      controls.append(button(`End Turn: Pass to Player ${opponent + 1}`, () => this.passTurn(), 'btn-green'));
    }

    const content = [
      h(
        'header',
        'topbar',
        h('p', 'brand', icon('icon-anchor', 'icon'), 'Battle Ship'),
        this.banner(game),
        button('Quit', () => this.showMenu(), 'btn-small btn-quiet'),
      ),
      h('p', 'message', this.message),
      controls,
      h(
        'div',
        'battlefield',
        h(
          'section',
          'board-panel',
          h('h2', 'board-title', icon('icon-flag-blue', 'icon'), ownTitle),
          own.element,
          this.fleetStatus(ownBoard),
        ),
        h(
          'section',
          'board-panel',
          h('h2', 'board-title', icon('icon-flag-red', 'icon'), enemyTitle),
          enemy.element,
          this.fleetStatus(enemyBoard),
        ),
      ),
    ];
    if (fresh) this.showFresh(...content);
    else this.show(...content);
    if (canFire && !fresh && this.lastTarget) enemy.focusCell(this.lastTarget);
    return { own, enemy };
  }

  private fireAt(cell: Coord): void {
    const game = this.game;
    if (!game) return;
    this.lastTarget = cell;
    const outcome = game.fire(cell);
    this.setMessage(this.gameMessage(outcome));
    if (this.mode === 'two-player' && !outcome.gameOver) this.awaitingPass = true;
    const views = this.renderBattle();
    if (this.settings.animations) {
      views?.enemy.playEffect(cell, outcome.result === 'miss' ? 'splash' : 'explosion');
    }
    if (this.mode === 'computer' && !outcome.gameOver) {
      this.computerTimer = window.setTimeout(
        () => this.computerTurn(),
        COMPUTER_DELAY_MS[this.settings.computerSpeed],
      );
    }
  }

  private computerTurn(): void {
    const { game, computer } = this;
    if (!game || !computer) return;
    const target = computer.chooseShot();
    const outcome = game.fire(target);
    computer.report(target, outcome.result, outcome.ship);
    this.setMessage(this.gameMessage(outcome));
    const views = this.renderBattle();
    if (this.settings.animations) {
      views?.own.playEffect(target, outcome.result === 'miss' ? 'splash' : 'explosion');
    }
  }

  private gameMessage(outcome: ShotOutcome): string {
    const shot = this.describeShot(outcome);
    if (!outcome.gameOver) return shot;
    if (this.mode === 'computer') {
      return `${shot} ${outcome.shooter === 0 ? 'You win!' : 'The enemy wins.'}`;
    }
    return `${shot} Player ${outcome.shooter + 1} wins!`;
  }

  private passTurn(): void {
    const game = this.game;
    if (!game) return;
    const next = game.current;
    this.showPass(next, 'Turn over.', () => {
      this.viewer = next;
      this.awaitingPass = false;
      this.lastTarget = undefined;
      this.renderBattle(true);
    });
  }
}
