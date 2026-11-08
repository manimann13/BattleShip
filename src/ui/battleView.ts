import type { Board } from '../game/board';
import { type Coord, FLEET, type PlacedShip } from '../game/types';
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

// The list of ships under a board, crossing off the sunk ones. Works for an enemy board that
// only knows the ships sunk so far.
export function fleetStatus(board: Board): HTMLElement {
  const items = FLEET.map((spec) => {
    const ship = board.ships.find((placed) => placed.spec.type === spec.type);
    const sunk = ship !== undefined && board.isSunk(ship);
    return h('li', sunk ? 'status-item is-sunk' : 'status-item', sunk ? `${spec.name} (sunk)` : spec.name);
  });
  return h('ul', 'status-list', ...items);
}

export interface BattleScreenOptions {
  settings: Settings;
  banner: HTMLElement;
  message: HTMLElement;
  onQuit: () => void;
  // Buttons under the message, such as Play Again or End Turn.
  controls: readonly HTMLElement[];
  // Extra top-bar controls placed before the sound buttons.
  topbarExtras?: readonly HTMLElement[];
  // Shown between the controls and the boards, such as the end-of-game stats.
  summary?: HTMLElement;
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
      h('h2', 'board-title', icon(flag, 'icon'), side.title, ...(side.badge ? [side.badge] : [])),
      view.element,
      fleetStatus(side.board),
    );

  const content: Node[] = [
    h(
      'header',
      'topbar',
      h('p', 'brand', icon('icon-anchor', 'icon'), 'Battle Ship'),
      options.banner,
      h(
        'div',
        'topbar-actions',
        ...(options.topbarExtras ?? []),
        ...audioButtons(options.settings),
        button('Quit', options.onQuit, 'btn-small btn-quiet'),
      ),
    ),
    options.message,
    h('div', 'battle-controls', ...options.controls),
    ...(options.summary ? [options.summary] : []),
    h(
      'div',
      'battlefield',
      panel(options.own, 'icon-flag-blue', own),
      panel(options.enemy, 'icon-flag-red', enemy),
    ),
  ];
  return { content, own, enemy };
}
