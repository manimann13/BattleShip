import type { Board } from '../game/board';
import { BOARD_SIZE, type Coord, type PlacedShip, coordLabel } from '../game/types';
import { assetUrl, h, icon } from './dom';

export type BoardMode = 'place' | 'fire' | 'static';
export type EffectKind = 'explosion' | 'splash';

export interface BoardViewOptions {
  board: Board;
  mode: BoardMode;
  showShip: (ship: PlacedShip) => boolean;
  label: string;
  locked?: boolean;
  initialFocus?: Coord;
  onActivate?: (cell: Coord) => void;
  onHover?: (cell: Coord | null) => void;
}

export interface BoardView {
  element: HTMLElement;
  setPreview: (cells: readonly Coord[], valid: boolean) => void;
  playEffect: (cell: Coord, kind: EffectKind) => void;
  focusCell: (cell: Coord) => void;
}

const percent = (cells: number): string => `${(cells * 100) / BOARD_SIZE}%`;

function shipOverlay(ship: PlacedShip): HTMLImageElement {
  const image = icon(`ship-${ship.spec.type}`, 'ship');
  image.style.width = percent(ship.spec.length);
  image.style.height = percent(1);
  image.style.top = percent(ship.origin.y);
  if (ship.orientation === 'horizontal') {
    image.style.left = percent(ship.origin.x);
  } else {
    // Rotating about the top-left corner swings the sprite left by one cell.
    image.style.left = percent(ship.origin.x + 1);
    image.style.transform = 'rotate(90deg)';
  }
  return image;
}

function cellStateLabel(board: Board, cell: Coord, showShip: BoardViewOptions['showShip']): string {
  const ship = board.shipAt(cell);
  const shot = board.shotAt(cell);
  if (shot === 'miss') return 'miss';
  if (shot === 'hit') return ship && board.isSunk(ship) ? `sunk ${ship.spec.name}` : 'hit';
  return ship && showShip(ship) ? ship.spec.name : 'open water';
}

export function createBoardView(options: BoardViewOptions): BoardView {
  const { board, mode, showShip, label, locked, initialFocus, onActivate, onHover } = options;
  const interactive = mode !== 'static';
  const grid = h('div', `board board-${mode}`);
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', label);

  const cells: HTMLElement[] = [];
  const cellAt = ({ x, y }: Coord) => cells[y * BOARD_SIZE + x];

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const coord = { x, y };
      const stateLabel = `${coordLabel(coord)}, ${cellStateLabel(board, coord, showShip)}`;
      const shot = board.shotAt(coord);
      const cell = interactive ? h('button', 'cell') : h('div', 'cell');
      if (shot === 'miss') cell.classList.add('cell-miss');
      cell.setAttribute('aria-label', stateLabel);
      if (cell instanceof HTMLButtonElement) {
        const unavailable = locked || (mode === 'fire' && shot !== undefined);
        cell.type = 'button';
        cell.tabIndex = -1;
        if (unavailable) cell.setAttribute('aria-disabled', 'true');
        cell.addEventListener('click', () => {
          if (!unavailable) onActivate?.(coord);
        });
        cell.addEventListener('pointerenter', () => onHover?.(coord));
        cell.addEventListener('focus', () => onHover?.(coord));
      } else {
        cell.setAttribute('role', 'img');
      }
      cells.push(cell);
      grid.append(cell);
    }
  }

  if (interactive) {
    cellAt(initialFocus ?? { x: 0, y: 0 }).tabIndex = 0;
    grid.addEventListener('pointerleave', () => onHover?.(null));
    grid.addEventListener('focusout', (event) => {
      if (!grid.contains(event.relatedTarget as Node | null)) onHover?.(null);
    });
    grid.addEventListener('keydown', (event) => {
      const step: Record<string, Coord> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      };
      const move = step[event.key];
      const index = cells.indexOf(event.target as HTMLElement);
      if (!move || index < 0) return;
      event.preventDefault();
      focusCell({
        x: Math.min(BOARD_SIZE - 1, Math.max(0, (index % BOARD_SIZE) + move.x)),
        y: Math.min(BOARD_SIZE - 1, Math.max(0, Math.floor(index / BOARD_SIZE) + move.y)),
      });
    });
  }

  const shipsLayer = h('div', 'board-layer');
  for (const ship of board.ships) {
    if (showShip(ship)) shipsLayer.append(shipOverlay(ship));
  }

  const marksLayer = h('div', 'board-layer');
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const coord = { x, y };
      if (board.shotAt(coord) !== 'hit') continue;
      const ship = board.shipAt(coord);
      const mark = icon(ship && board.isSunk(ship) ? 'mark-sunk' : 'mark-hit', 'mark');
      mark.style.left = percent(x);
      mark.style.top = percent(y);
      marksLayer.append(mark);
    }
  }
  grid.append(shipsLayer, marksLayer);

  function focusCell(coord: Coord): void {
    for (const cell of cells) cell.tabIndex = -1;
    const target = cellAt(coord);
    target.tabIndex = 0;
    target.focus({ preventScroll: true });
  }

  function setPreview(previewCells: readonly Coord[], valid: boolean): void {
    for (const cell of cells) cell.classList.remove('preview-valid', 'preview-invalid');
    for (const coord of previewCells) {
      if (coord.x < 0 || coord.y < 0 || coord.x >= BOARD_SIZE || coord.y >= BOARD_SIZE) continue;
      cellAt(coord).classList.add(valid ? 'preview-valid' : 'preview-invalid');
    }
  }

  function playEffect(coord: Coord, kind: EffectKind): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const effect = h('div', 'effect');
    effect.style.left = percent(coord.x);
    effect.style.top = percent(coord.y);
    effect.style.backgroundImage = `url(${assetUrl(`${kind}-strip`)})`;
    effect.addEventListener('animationend', () => effect.remove());
    marksLayer.append(effect);
  }

  const columnLabels = h('div', 'axis axis-x');
  for (let x = 0; x < BOARD_SIZE; x++) columnLabels.append(h('span', '', String.fromCharCode(65 + x)));
  const rowLabels = h('div', 'axis axis-y');
  for (let y = 0; y < BOARD_SIZE; y++) rowLabels.append(h('span', '', String(y + 1)));
  columnLabels.setAttribute('aria-hidden', 'true');
  rowLabels.setAttribute('aria-hidden', 'true');

  const element = h('div', 'board-frame', h('span'), columnLabels, rowLabels, grid);
  return { element, setPreview, playEffect, focusCell };
}
