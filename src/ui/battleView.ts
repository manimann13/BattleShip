import type { Board } from '../game/board';
import { type Coord, FLEET, type PlacedShip, type ShotResult } from '../game/types';
import { type BoardView, createBoardView } from './boardView';
import { button, h, icon } from './dom';
import type { Settings } from './settings';
import { audioButtons } from './statsView';

// The battle screen shared by local games (vs Computer, 2 Players) and online games.
// Each mode decides the words and buttons; the layout lives here.

export type BannerStyle = 'blue' | 'red' | 'victory' | 'defeat';

export function banner(style: BannerStyle, text: string): HTMLElement {
  return h('div', `banner banner-${style}`, text);
}

// The brass strip across the top of every play screen: the wordmark, a badge in the middle
// (the turn banner or a heading) and the corner buttons on the right.
export function topStrip(middle: HTMLElement, ...actions: HTMLElement[]): HTMLElement {
  return h(
    'header',
    'topbar',
    h('p', 'brand', icon('icon-anchor', 'icon'), h('span', 'brand-text', 'Battle Ship')),
    middle,
    h('div', 'topbar-actions', ...actions),
  );
}

// A board laid on an old sea chart: a faint parchment frame with a compass rose and a ribbon title.
export function seaChart(board: HTMLElement, title?: HTMLElement, ...below: HTMLElement[]): HTMLElement {
  const compass = h('span', 'chart-compass');
  compass.setAttribute('aria-hidden', 'true');
  return h('div', 'sea-chart', ...(title ? [title] : []), board, compass, ...below);
}

// The fleet under a board as small ship sprites, greyed and crossed out once sunk. The names stay
// for screen readers. Works for an enemy board that only knows the ships sunk so far.
export function fleetStatus(board: Board): HTMLElement {
  const items = FLEET.map((spec) => {
    const ship = board.ships.find((placed) => placed.spec.type === spec.type);
    const sunk = ship !== undefined && board.isSunk(ship);
    const sprite = icon(`ship-${spec.type}`, 'status-ship');
    sprite.style.width = `calc(${spec.length} * var(--status-cell))`;
    const item = h('li', sunk ? 'status-item is-sunk' : 'status-item', sprite, h('span', 'sr-only', sunk ? `${spec.name} (sunk)` : spec.name));
    item.title = sunk ? `${spec.name} (sunk)` : spec.name;
    return item;
  });
  return h('ul', 'status-list', ...items);
}

export interface BattleScreenOptions {
  settings: Settings;
  banner: HTMLElement;
  message: HTMLElement;
  // The last shot, to flash the message plate.
  flash?: ShotResult;
  onQuit: () => void;
  // Buttons under the message, such as End Turn, or on the results plaque once the game is over.
  controls: readonly HTMLElement[];
  // Extra top-bar controls placed before the sound buttons.
  topbarExtras?: readonly HTMLElement[];
  // The end-of-game result: shown on a plaque that swings open over the boards.
  result?: { won: boolean; title: string; summary: HTMLElement };
  own: { board: Board; title: string; badge?: HTMLElement };
  enemy: {
    board: Board;
    title: string;
    badge?: HTMLElement;
    locked: boolean;
    initialFocus?: Coord;
    showShip: (ship: PlacedShip) => boolean;
    onActivate: (cell: Coord) => void;
  };
}

export interface BattleScreen {
  content: Node[];
  own: BoardView;
  enemy: BoardView;
}

export function battleScreen(options: BattleScreenOptions): BattleScreen {
  const own = createBoardView({ board: options.own.board, mode: 'static', label: 'Your fleet', showShip: () => true });
  const enemy = createBoardView({
    board: options.enemy.board,
    mode: 'fire',
    label: 'Enemy waters',
    locked: options.enemy.locked,
    initialFocus: options.enemy.initialFocus,
    showShip: options.enemy.showShip,
    onActivate: options.enemy.onActivate,
  });

  const panel = (side: { board: Board; title: string; badge?: HTMLElement }, flag: string, view: BoardView) =>
    h(
      'section',
      'board-panel',
      seaChart(
        view.element,
        h('h2', 'board-title', icon(flag, 'icon'), side.title, ...(side.badge ? [side.badge] : [])),
        fleetStatus(side.board),
      ),
    );

  const message = options.message;
  if (options.flash && options.settings.animations) message.classList.add(`flash-${options.flash}`);

  const battlefield = h(
    'div',
    'battlefield',
    panel(options.own, 'icon-flag-blue', own),
    panel(options.enemy, 'icon-flag-red', enemy),
  );

  const area = h('div', 'battle-area', battlefield);
  const controls = h('div', 'battle-controls');
  const result = options.result;
  if (result) {
    // "View boards" folds the plaque away to look at the final boards; "Show results" brings it back.
    const showResults = button('Show results', () => setHidden(false), 'btn-small');
    const plaque = h(
      'div',
      'menu-plaque end-plaque',
      h('h2', `end-title ${result.won ? 'end-victory' : 'end-defeat'}`, result.title),
      result.summary,
      h('div', 'end-buttons', ...options.controls, button('View boards', () => setHidden(true), 'btn-quiet')),
    );
    plaque.setAttribute('role', 'dialog');
    plaque.setAttribute('aria-label', result.title);
    const setHidden = (hidden: boolean) => {
      area.classList.toggle('results-hidden', hidden);
      showResults.hidden = !hidden;
      (hidden ? showResults : plaque.querySelector('button'))?.focus({ preventScroll: true });
    };
    showResults.hidden = true;
    controls.append(showResults);
    area.classList.add('has-results');
    area.append(plaque);
  } else {
    controls.append(...options.controls);
  }

  const content: Node[] = [
    topStrip(
      options.banner,
      ...(options.topbarExtras ?? []),
      ...audioButtons(options.settings),
      button('Quit', options.onQuit, 'btn-small btn-quiet'),
    ),
    h('div', 'message-plate', message),
    controls,
    area,
  ];
  return { content, own, enemy };
}
