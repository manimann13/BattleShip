import { ComputerPlayer, type Difficulty } from '../ai/computer';
import { Board, shipCells } from '../game/board';
import { Game, type PlayerId, type ShotOutcome } from '../game/game';
import { MatchStats, isFlawless } from '../game/stats';
import { FLEET, type Coord, type Orientation, coordLabel, isOnBoard } from '../game/types';
import { type BoardView, createBoardView } from './boardView';
import { button, h, icon } from './dom';
import { type MenuScene, createMenuScene } from './menuScene';
import { OnlineGame } from './online';
import { type Tally, addGoldAnchor, addResult, loadGoldAnchors } from './record';
import { banner, battleScreen } from './battleView';
import { audioButtons, statsPanel } from './statsView';
import { setMusicEnabled, setMusicTrack, unlockMusic } from './music';
import { playClickSound, playKrakenSound, playShotSound, playSkyChime } from './sound';
import { COMPUTER_DELAY_MS, type ComputerSpeed, loadSettings, saveSettings } from './settings';

type Mode = 'computer' | 'two-player' | 'online';

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
  private stats = new MatchStats();
  private tally: Tally | null = null;
  // Set when this game earned a Gold Anchor: the new total.
  private goldAnchors: number | undefined;

  private orientation: Orientation = 'horizontal';
  private placementView: BoardView | null = null;
  private placementHover: Coord | null = null;
  private placingPlayer: PlayerId = 0;
  private onlineReady: (() => void) | null = null;
  private readonly online: OnlineGame;
  private readonly scene: MenuScene;

  constructor(private readonly root: HTMLElement) {
    this.scene = createMenuScene({
      onImpact: (result) => {
        if (this.settings.sound) playShotSound(result);
      },
      onSkyChange: (day) => {
        if (this.settings.sound) playSkyChime(day);
        this.root.classList.toggle('sky-day', day);
      },
      onKraken: () => {
        if (this.settings.sound) playKrakenSound();
      },
    });
    this.online = new OnlineGame({
      show: (...content) => this.show(...content),
      showFresh: (...content) => this.showFresh(...content),
      announce: (message) => {
        this.live.textContent = message;
      },
      settings: this.settings,
      startPlacement: (board, onReady) => this.startOnlinePlacement(board, onReady),
      quit: () => this.showMenu(),
      showModes: () => this.showModes(),
    });
    this.screen.tabIndex = -1;
    this.live.setAttribute('aria-live', 'polite');
    this.root.append(this.screen, this.live);
    this.applyGridLabels();
    // Every menu and screen button ticks. Board squares are not .btn, so shots keep their own sounds.
    // This runs after the button's own handler, so unmuting ticks and muting stays silent.
    document.addEventListener('click', (event) => {
      if (this.settings.sound && (event.target as Element | null)?.closest?.('button.btn')) playClickSound();
    });
    // Browsers block sound until the first tap or key press, so the music waits for one.
    setMusicEnabled(this.settings.music);
    for (const type of ['pointerdown', 'keydown'] as const) {
      document.addEventListener(type, () => unlockMusic(), { once: true, capture: true });
    }
    document.addEventListener('keydown', (event) => {
      if (this.placementView && event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey) {
        this.rotate();
      }
    });
  }

  start(): void {
    this.showMenu();
  }

  // Every screen plays the menu music; a battle in progress switches to the battle music after this.
  private show(...content: Node[]): void {
    setMusicTrack('menu');
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
    this.online.dispose();
    this.game = null;
    this.computer = null;
  }

  private playerName(player: PlayerId): string {
    if (this.mode === 'two-player') return `Player ${player + 1}`;
    return player === 0 ? 'You' : 'Enemy';
  }

  // ---------- Menus ----------

  // The animated sea battle behind the main menus, with the buttons on a framed plaque.
  private showSceneMenu(prompt: string, ...buttons: HTMLElement[]): void {
    const plaque = h('div', 'menu-plaque');
    if (prompt) plaque.append(h('p', 'menu-prompt', prompt));
    plaque.append(h('div', 'menu-buttons', ...buttons));
    this.showScene(plaque);
  }

  // Any brass plaque over the animated scene, under the title: menus, Settings and How to Play.
  // The corner sound buttons are left off Settings, which has its own switches for them.
  private showScene(plaque: HTMLElement, cornerButtons = true): void {
    this.root.classList.toggle('sky-day', this.scene.isDay());
    this.showFresh(
      h(
        'div',
        'menu menu-majestic',
        this.scene.element,
        ...(cornerButtons ? [h('div', 'corner-controls', ...audioButtons(this.settings))] : []),
        this.title(),
        plaque,
        h('p', 'scene-tip', 'Tap the sea to fire: five hits sink a ship. Tap the moon or sun to change the sky.'),
      ),
    );
    this.scene.start();
  }


  private showMenu(): void {
    this.stopGame();
    this.showSceneMenu(
      '',
      ...(this.online.canRejoin()
        ? [button('Rejoin Online Game', () => this.online.rejoinSaved(), 'btn-green')]
        : []),
      button('Play', () => this.showModes()),
      button('Settings', () => this.showSettings()),
      button('How to Play', () => this.showHowTo()),
    );
  }

  private title(): HTMLElement {
    return h(
      'header',
      'title-block',
      h('h1', 'title', icon('icon-anchor', 'title-icon'), h('span', 'title-text', 'Battle Ship')),
      h('p', 'title-sub', 'Command the Seas'),
      ...this.goldBadge(),
    );
  }

  // Under the title, once the player has won a game without missing.
  private goldBadge(): HTMLElement[] {
    const count = loadGoldAnchors();
    if (count === 0) return [];
    const badge = h('p', 'title-badge', icon('icon-anchor-gold', 'icon'), count > 1 ? `Gold Anchor ×${count}` : 'Gold Anchor');
    badge.title = 'Won a game without a single miss';
    return [badge];
  }

  private showModes(): void {
    this.showSceneMenu(
      'Choose your opponent',
      button('vs Computer', () => this.showDifficulty()),
      button('2 Players', () => this.startSetup('two-player')),
      button('Online', () => this.online.showLobby()),
      button('Back', () => this.showMenu(), 'btn-quiet'),
    );
  }

  private showDifficulty(): void {
    const levels: readonly [Difficulty, string, string][] = [
      ['easy', 'Easy', 'Fires at random.'],
      ['normal', 'Normal', 'Hunts around every hit.'],
      ['hard', 'Hard', 'Works out where your ships are most likely to be.'],
    ];
    const choices = levels.map(([difficulty, label, about]) => {
      const choice = button(label, () => {
        this.settings.difficulty = difficulty;
        saveSettings(this.settings);
        this.startSetup('computer');
      }, this.settings.difficulty === difficulty ? 'btn-green' : '');
      choice.setAttribute('aria-describedby', `difficulty-${difficulty}`);
      const hint = h('p', 'hint difficulty-hint', about);
      hint.id = `difficulty-${difficulty}`;
      return h('div', 'difficulty-choice', choice, hint);
    });
    this.showSceneMenu('Choose a difficulty', ...choices, button('Back', () => this.showModes(), 'btn-quiet'));
  }

  // The rules in a few lines, the fleet, the board key and the keys, on one compact plaque.
  private showHowTo(): void {
    const legend = ([
      ['tile-miss', 'Miss'],
      ['tile-hit', 'Hit'],
      ['tile-sunk', 'Sunk'],
      ['tile-valid', 'Fits'],
      ['tile-invalid', 'Blocked'],
    ] as const).map(([name, label]) => h('li', '', icon(name, 'legend-tile'), label));

    // Each ship drawn to scale, so its length shows at a glance.
    const fleet = FLEET.map((spec) => {
      const ship = icon(`ship-${spec.type}`, 'howto-ship', `${spec.length} squares`);
      ship.style.width = `${spec.length * 26}px`;
      return h('li', '', h('span', '', spec.name), ship);
    });

    this.showScene(
      h(
        'div',
        'menu-plaque howto',
        h('h1', 'heading', 'How to Play'),
        h(
          'ol',
          'howto-steps',
          h('li', '', 'Place your 5 ships. They cannot overlap.'),
          h('li', '', 'Take turns firing one shot at the enemy grid.'),
          h('li', '', 'Hit every square of a ship to sink it.'),
          h('li', '', 'Sink the whole enemy fleet to win.'),
        ),
        h('h2', 'subheading', 'Your fleet'),
        h('ul', 'howto-fleet', ...fleet),
        h('h2', 'subheading', 'Board key'),
        h('ul', 'legend', ...legend),
        h('p', 'howto-keys', 'Keys: arrows move, Enter fires, R rotates'),
        h('div', 'menu-buttons', button('Back', () => this.showMenu())),
      ),
    );
  }


  // Five compact rows: a three-way switch for the computer's speed, then on/off toggles.
  private showSettings(): void {
    const speedOptions: readonly [ComputerSpeed, string][] = [
      ['slow', 'Slow'],
      ['normal', 'Normal'],
      ['fast', 'Fast'],
    ];
    const speeds = h('div', 'segmented', ...speedOptions.map(([speed, label]) => {
      const input = h('input');
      input.type = 'radio';
      input.name = 'computer-speed';
      input.checked = this.settings.computerSpeed === speed;
      input.addEventListener('change', () => {
        this.settings.computerSpeed = speed;
        saveSettings(this.settings);
      });
      return h('label', 'segment', input, h('span', '', label));
    }));
    speeds.setAttribute('role', 'radiogroup');
    speeds.setAttribute('aria-label', 'Computer speed');

    const toggle = (label: string, checked: boolean, onChange: (checked: boolean) => void) => {
      const input = h('input', 'switch');
      input.type = 'checkbox';
      input.setAttribute('role', 'switch');
      input.checked = checked;
      input.addEventListener('change', () => {
        onChange(input.checked);
        saveSettings(this.settings);
      });
      return h('label', 'setting-row', h('span', 'setting-label', label), input);
    };

    this.showScene(
      h(
        'div',
        'menu-plaque settings',
        h('h1', 'heading settings-heading', icon('icon-gear', 'icon'), 'Settings'),
        h(
          'div',
          'setting-list',
          h('div', 'setting-row', h('span', 'setting-label', 'Computer speed'), speeds),
          toggle('Sound effects', this.settings.sound, (checked) => {
            this.settings.sound = checked;
          }),
          toggle('Music', this.settings.music, (checked) => {
            this.settings.music = checked;
            setMusicEnabled(checked);
          }),
          toggle('Animations', this.settings.animations, (checked) => {
            this.settings.animations = checked;
          }),
          toggle('Grid labels', this.settings.gridLabels, (checked) => {
            this.settings.gridLabels = checked;
            this.applyGridLabels();
          }),
        ),
        h('div', 'menu-buttons', button('Back', () => this.showMenu())),
      ),
      false,
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

  // Online matches reuse the placement screen but keep their connection open, so this skips stopGame().
  private startOnlinePlacement(board: Board, onReady: () => void): void {
    this.mode = 'online';
    this.boards = [board, new Board()];
    this.orientation = 'horizontal';
    this.onlineReady = onReady;
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
        h('div', 'topbar-actions', ...audioButtons(this.settings), button('Quit', () => this.showMenu(), 'btn-small btn-quiet')),
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
    if (this.mode === 'online') {
      this.onlineReady?.();
    } else if (this.mode === 'computer') {
      this.boards[1].placeFleetRandomly();
      this.computer = new ComputerPlayer(Math.random, this.settings.difficulty);
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
    );    // Between turns the battle music keeps going.
    if (this.game) setMusicTrack('battle');
  }

  // ---------- Battle ----------

  private startBattle(): void {
    this.game = new Game(this.boards);
    this.viewer = 0;
    this.awaitingPass = false;
    this.lastTarget = undefined;
    this.stats = new MatchStats();
    this.tally = null;
    this.goldAnchors = undefined;
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

  private banner(game: Game): HTMLElement {
    if (game.winner !== null) {
      const youWon = this.mode === 'two-player' || game.winner === 0;
      return youWon ? banner('victory', 'Victory!') : banner('defeat', 'Defeat!');
    }
    if (this.mode === 'computer') {
      return game.current === 0 ? banner('blue', 'Your Turn') : banner('red', 'Enemy Turn');
    }
    return banner(this.viewer === 0 ? 'blue' : 'red', `Player ${this.viewer + 1} Turn`);
  }

  private renderBattle(fresh = false): { own: BoardView; enemy: BoardView } | null {
    const game = this.game;
    if (!game) return null;
    const over = game.winner !== null;
    const viewer = this.viewer;
    const opponent = opponentOf(viewer);
    const enemyBoard = game.boardOf(opponent);
    const canFire = !over && !this.awaitingPass && game.current === viewer;

    let enemyTitle = 'Enemy Waters';
    if (this.mode === 'two-player') {
      enemyTitle = over ? `Player ${opponent + 1} Fleet` : `Player ${opponent + 1} Waters`;
    }

    const controls: HTMLElement[] = [];
    if (over) {
      controls.push(
        button('Play Again', () => this.startSetup(this.mode), 'btn-green'),
        button('Main Menu', () => this.showMenu()),
      );
    } else if (this.awaitingPass) {
      controls.push(button(`End Turn: Pass to Player ${opponent + 1}`, () => this.passTurn(), 'btn-green'));
    }

    const { content, own, enemy } = battleScreen({
      settings: this.settings,
      banner: this.banner(game),
      message: h('p', 'message', this.message),
      onQuit: () => this.showMenu(),
      controls,
      summary: over ? this.endStats() : undefined,
      own: {
        board: game.boardOf(viewer),
        title: this.mode === 'computer' ? 'Your Fleet' : `Player ${viewer + 1} Fleet`,
      },
      enemy: {
        board: enemyBoard,
        title: enemyTitle,
        locked: !canFire,
        initialFocus: this.lastTarget,
        showShip: (ship) => over || enemyBoard.isSunk(ship),
        onActivate: (cell) => this.fireAt(cell),
      },
    });
    if (fresh) this.showFresh(...content);
    else this.show(...content);
    if (!over) setMusicTrack('battle');
    if (canFire && !fresh && this.lastTarget) enemy.focusCell(this.lastTarget);
    return { own, enemy };
  }

  private endStats(): HTMLElement {
    const names: [string, string] = this.mode === 'computer' ? ['You', 'Computer'] : ['Player 1', 'Player 2'];
    const level = this.settings.difficulty;
    const record = this.mode === 'computer' && this.tally
      ? { label: `Your record on ${level[0].toUpperCase()}${level.slice(1)}`, tally: this.tally }
      : undefined;
    return statsPanel(this.stats, names, record, this.goldAnchors);
  }

  private fireAt(cell: Coord): void {
    const game = this.game;
    if (!game) return;
    this.lastTarget = cell;
    const outcome = game.fire(cell);
    this.recordShot(outcome);
    this.setMessage(this.gameMessage(outcome));
    if (this.mode === 'two-player' && !outcome.gameOver) this.awaitingPass = true;
    const views = this.renderBattle();
    if (this.settings.sound) playShotSound(outcome.result);
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
    this.recordShot(outcome);
    this.setMessage(this.gameMessage(outcome));
    const views = this.renderBattle();
    if (this.settings.sound) playShotSound(outcome.result);
    if (this.settings.animations) {
      views?.own.playEffect(target, outcome.result === 'miss' ? 'splash' : 'explosion');
    }
  }

  // Updates the stats for a shot, and saves the result when a vs Computer game ends.
  private recordShot(outcome: ShotOutcome): void {
    this.stats.record(outcome.shooter, outcome.result);
    if (!outcome.gameOver) return;
    this.stats.finish();
    if (this.mode === 'computer') this.tally = addResult(this.settings.difficulty, outcome.shooter === 0);
    // A human winner who never missed earns a Gold Anchor (the computer cannot).
    const humanWon = this.mode === 'two-player' || outcome.shooter === 0;
    if (humanWon && isFlawless(this.stats.sides[outcome.shooter])) this.goldAnchors = addGoldAnchor();
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
