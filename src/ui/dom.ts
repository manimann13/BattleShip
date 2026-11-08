export const assetUrl = (name: string): string => `assets/${name}.png`;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.append(...children);
  return element;
}

// Fetches sprites up front so tiles and effects do not flash blank on first use.
// Resolves once every sprite has loaded or failed; onProgress gets the fraction done.
export function preloadSprites(onProgress: (done: number) => void = () => {}): Promise<void> {
  const names = [
    'tile-empty', 'tile-selected', 'tile-valid', 'tile-invalid', 'tile-miss', 'tile-hit', 'tile-sunk',
    'mark-hit', 'mark-sunk', 'explosion-strip', 'splash-strip',
    'ship-carrier', 'ship-battleship', 'ship-cruiser', 'ship-submarine', 'ship-destroyer',
    'icon-anchor', 'icon-gear', 'icon-radar', 'icon-flag-blue', 'icon-flag-red', 'icon-sound-on', 'icon-sound-off', 'icon-message', 'icon-music-on', 'icon-music-off', 'icon-anchor-gold',
  ];
  let loaded = 0;
  return Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = image.onerror = () => {
            loaded++;
            onProgress(loaded / names.length);
            resolve();
          };
          image.src = assetUrl(name);
        }),
    ),
  ).then(() => undefined);
}

// Decorative by default: pass alt text only when the image carries meaning.
export function icon(name: string, className = 'icon', alt = ''): HTMLImageElement {
  const image = h('img', className);
  image.src = assetUrl(name);
  image.alt = alt;
  image.draggable = false;
  return image;
}

export function button(label: string, onClick: () => void, variant = ''): HTMLButtonElement {
  const element = h('button', `btn ${variant}`.trim(), label);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}
