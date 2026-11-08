import type { ShotResult } from '../game/types';

// A moonlit naval battle drawn as pixel art behind the menus. It is rendered on a small canvas
// (one canvas pixel per art pixel) and scaled up by CSS with crisp edges.
// Interactive: turrets follow the pointer, clicking the sea fires a shell, clicking the sky fires flak,
// and three hits sink an enemy ship, which later sails back in.

export interface MenuScene {
  readonly element: HTMLCanvasElement;
  // Mounts the animation if it is not already running. Call after the canvas is in the page.
  start(): void;
}

export interface SceneOptions {
  // Called when a shell the player fired lands, to play the matching sound.
  onImpact(result: ShotResult): void;
}

type Facing = 1 | -1;
type Side = 'ally' | 'enemy';

interface Turret {
  // Pivot in sprite pixels, with the sprite facing right.
  readonly x: number;
  readonly y: number;
  // +1 points toward the bow, -1 toward the stern.
  readonly dir: Facing;
  readonly len: number;
}

interface ShipArt {
  readonly canvas: HTMLCanvasElement;
  readonly w: number;
  readonly h: number;
  // Row of the sprite that sits on the water line.
  readonly waterline: number;
  readonly turrets: readonly Turret[];
  readonly funnel: { readonly x: number; readonly y: number };
  readonly bridge: { readonly x: number; readonly y: number };
}

interface Ship {
  readonly art: ShipArt;
  readonly side: Side;
  readonly layer: 0 | 1 | 2;
  readonly facing: Facing;
  readonly place: (width: number) => number;
  readonly phase: number;
  baseline: number;
  homeX: number;
  aim: number[];
  hits: number;
  burning: number;
  sink: number; // Pixels sunk so far, or -1 when afloat.
  respawn: number; // Seconds until it sails back in.
  enter: number; // 0..1 while sailing back in, 1 when in place.
  smokeTimer: number;
}

interface Shell {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  dur: number;
  arc: number;
  byPlayer: boolean;
  target: Side;
  trail: { x: number; y: number }[];
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  gravity: number;
  colors: readonly string[];
  size: number;
  grow: number;
}

interface Ring {
  x: number;
  y: number;
  t: number;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const dither = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

const SKY_MARGIN = 4;
const SKY = ['#060a18', '#0a1026', '#0f1834', '#152042', '#1d2852', '#2a2f5e', '#3b3768', '#53406e'];
const SEA = ['#25386a', '#1d2f5c', '#18284f', '#132143', '#0f1b38', '#0b162e', '#09122a'];
const STAR_COLORS = ['#5d6a99', '#9aa7d6', '#e8ecff', '#ffe9a8'];

const ALLY_COLOR = '#3f7fe0';
const ENEMY_COLOR = '#e8473c';

interface Palette {
  deck: string;
  hullLight: string;
  hull: string;
  red: string;
  redDark: string;
  sup: string;
  supLight: string;
  window: string;
  windowDim: string;
  funnel: string;
  band: string;
  flag: string;
  turret: string;
  turretTop: string;
  mast: string;
  outline: string | null;
}

const steel = (side: Side): Palette => ({
  deck: '#71849b',
  hullLight: '#4d5f75',
  hull: '#36465b',
  red: '#8a2a34',
  redDark: '#5a1a22',
  sup: '#5b6e85',
  supLight: '#8296ad',
  window: '#ffd86b',
  windowDim: '#8f7a45',
  funnel: '#3d4b5d',
  band: side === 'ally' ? ALLY_COLOR : ENEMY_COLOR,
  flag: side === 'ally' ? ALLY_COLOR : ENEMY_COLOR,
  turret: '#4d5f75',
  turretTop: '#71849b',
  mast: '#9aa8b8',
  outline: '#060a12',
});

const silhouette = (side: Side): Palette => ({
  deck: '#16224a',
  hullLight: '#121c3e',
  hull: '#101935',
  red: '#101935',
  redDark: '#101935',
  sup: '#131d40',
  supLight: '#1b2750',
  window: '#c9a25a',
  windowDim: '#131d40',
  funnel: '#121c3e',
  band: '#121c3e',
  flag: side === 'ally' ? '#2a4f8a' : '#8a2f2a',
  turret: '#121c3e',
  turretTop: '#16224a',
  mast: '#1b2750',
  outline: null,
});

function canvas(w: number, h: number): HTMLCanvasElement {
  const element = document.createElement('canvas');
  element.width = w;
  element.height = h;
  return element;
}

function context(element: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = element.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

// Adds a one-pixel dark outline around everything drawn so far, like hand-made pixel art.
function outline(element: HTMLCanvasElement, color: string): void {
  const ctx = context(element);
  const { width: w, height: h } = element;
  const image = ctx.getImageData(0, 0, w, h);
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && image.data[(y * w + x) * 4 + 3] > 0;
  ctx.fillStyle = color;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) ctx.fillRect(x, y, 1, 1);
    }
  }
}

// Draws a warship facing right. `big` gives a battleship, otherwise a destroyer.
function shipArt(big: boolean, palette: Palette): ShipArt {
  const L = big ? 52 : 34;
  const top = big ? 2 : 1; // Room for the mast and flag.
  const deck = big ? 22 : 15;
  const hullRows = big ? 8 : 6;
  const h = deck + hullRows + 1;
  const element = canvas(L + 2, h + 1);
  const ctx = context(element);
  const px = (x: number, y: number, w: number, hh: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y, w, hh);
  };

  // Hull: the bow overhangs at the top and rakes back toward the keel; the stern is nearly vertical.
  const redRow = hullRows - 2;
  for (let r = 0; r < hullRows; r++) {
    const start = Math.max(0, r - (hullRows - 3)) + (r === 0 ? 1 : 0);
    const end = L - 1 - Math.floor(r * (big ? 1.3 : 1.2));
    let color = palette.hull;
    if (r === 0) color = palette.deck;
    else if (r <= 2) color = palette.hullLight;
    if (r === redRow) color = palette.red;
    if (r > redRow) color = palette.redDark;
    px(start, deck + r, end - start + 1, 1, color);
  }
  for (let x = 5; x < L - 10; x += big ? 5 : 4) px(x, deck + 3, 1, 1, (x / 5) % 3 === 0 ? palette.windowDim : palette.window);

  const turrets: Turret[] = [];
  const turret = (x: number, dir: Facing) => {
    const w = big ? 5 : 3;
    px(x - Math.floor(w / 2), deck - 2, w, 2, palette.turret);
    px(x - Math.floor(w / 2), deck - 2, w, 1, palette.turretTop);
    turrets.push({ x: x + 1, y: deck - 2, dir, len: big ? 7 : 5 });
  };

  let funnel: { x: number; y: number };
  let bridge: { x: number; y: number };
  if (big) {
    // Three stepped decks, a bridge with lit windows, a tripod mast and a funnel.
    px(16, deck - 4, 18, 4, palette.sup);
    px(16, deck - 4, 18, 1, palette.supLight);
    for (const x of [18, 21, 24, 27, 30]) px(x, deck - 2, 1, 1, palette.window);
    px(20, deck - 7, 11, 3, palette.sup);
    px(20, deck - 7, 11, 1, palette.supLight);
    px(23, deck - 10, 6, 3, palette.sup);
    px(23, deck - 10, 6, 1, palette.supLight);
    px(24, deck - 9, 1, 1, palette.window);
    px(26, deck - 9, 1, 1, palette.window);
    px(26, top + 2, 1, deck - 12 - top, palette.mast);
    px(24, top + 6, 5, 1, palette.mast);
    px(27, top, 4, 3, palette.flag);
    px(10, deck - 9, 4, 9, palette.funnel);
    px(10, deck - 9, 4, 2, palette.band);
    funnel = { x: 12, y: deck - 10 };
    bridge = { x: 28, y: deck - 9 };
    turret(7, -1);
    turret(37, 1);
    turret(43, 1);
  } else {
    px(12, deck - 3, 10, 3, palette.sup);
    px(12, deck - 3, 10, 1, palette.supLight);
    px(15, deck - 6, 5, 3, palette.sup);
    px(15, deck - 6, 5, 1, palette.supLight);
    px(16, deck - 5, 1, 1, palette.window);
    px(18, deck - 5, 1, 1, palette.window);
    px(17, top + 2, 1, deck - 8 - top, palette.mast);
    px(18, top, 3, 2, palette.flag);
    px(8, deck - 7, 3, 7, palette.funnel);
    px(8, deck - 7, 3, 2, palette.band);
    funnel = { x: 10, y: deck - 8 };
    bridge = { x: 20, y: deck - 5 };
    turret(4, -1);
    turret(27, 1);
  }

  if (palette.outline) outline(element, palette.outline);
  return {
    canvas: element,
    w: element.width,
    h: element.height,
    waterline: deck + redRow,
    turrets,
    funnel: { x: funnel.x + 1, y: funnel.y },
    bridge: { x: bridge.x + 1, y: bridge.y },
  };
}

function cloudArt(seed: number): HTMLCanvasElement {
  const rand = seeded(seed);
  const w = 34 + Math.floor(rand() * 26);
  const h = 12;
  const element = canvas(w, h);
  const ctx = context(element);
  const blobs = Array.from({ length: 5 }, () => ({
    x: 6 + rand() * (w - 12),
    y: 6 + rand() * 3,
    r: 3 + rand() * 4,
  }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = blobs.some((b) => (x - b.x) ** 2 + ((y - b.y) * 1.6) ** 2 <= b.r * b.r);
      if (!inside) continue;
      // Lit from above by the moon: a lighter rim on the top edge.
      const above = blobs.some((b) => (x - b.x) ** 2 + ((y - 1 - b.y) * 1.6) ** 2 <= b.r * b.r);
      ctx.fillStyle = above ? '#1a2550' : '#3a4478';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return element;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgba = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (255 << 24) | (b << 16) | (g << 8) | r;
};

const SEA_RGBA = SEA.map(rgba);
const WAVE_FAR = rgba('#34508a');
const WAVE_NEAR = rgba('#4d71b0');
const CREST = rgba('#a4c0ea');
const GLINT = rgba('#f1e6b0');
const GLINT_DIM = rgba('#9c936e');

export function createMenuScene(options: SceneOptions): MenuScene {
  const element = canvas(1, 1);
  element.className = 'menu-scene';
  element.setAttribute('aria-hidden', 'true');
  const ctx = context(element);
  const rand = seeded(7);
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  // Art pixels; recomputed on resize.
  let W = 0;
  let H = 0;
  let scale = 3;
  let horizon = 0;
  let sky: HTMLCanvasElement = canvas(1, 1);
  let seaImage: ImageData | null = null;
  let moon = { x: 0, y: 0, r: 10 };
  let stars: { x: number; y: number; phase: number; level: number }[] = [];
  let dirty = true;
  const rowRand = seeded(19);
  const rowPhase = Array.from({ length: 64 }, () => rowRand() * Math.PI * 2);

  const arts = {
    allyBig: shipArt(true, steel('ally')),
    enemyBig: shipArt(true, steel('enemy')),
    allySmall: shipArt(false, steel('ally')),
    enemySmall: shipArt(false, steel('enemy')),
    allyFar: shipArt(false, silhouette('ally')),
    enemyFar: shipArt(true, silhouette('enemy')),
  };
  const clouds = [0, 1, 2, 3].map((i) => ({ art: cloudArt(i + 11), x: rand(), y: 0.12 + rand() * 0.4, speed: 1 + rand() * 2 }));

  const makeShip = (art: ShipArt, side: Side, layer: 0 | 1 | 2, place: (w: number) => number): Ship => ({
    art,
    side,
    layer,
    facing: side === 'ally' ? 1 : -1,
    place,
    phase: rand() * Math.PI * 2,
    baseline: 0,
    homeX: 0,
    aim: art.turrets.map(() => 0.2),
    hits: 0,
    burning: 0,
    sink: -1,
    respawn: 0,
    enter: 1,
    smokeTimer: rand(),
  });

  const ships: Ship[] = [
    makeShip(arts.allyFar, 'ally', 0, (w) => w * 0.12),
    makeShip(arts.enemyFar, 'enemy', 0, (w) => w * 0.78),
    makeShip(arts.allySmall, 'ally', 1, (w) => w * 0.26),
    makeShip(arts.enemySmall, 'enemy', 1, (w) => w * 0.62),
    makeShip(arts.allyBig, 'ally', 2, (w) => w * 0.03),
    makeShip(arts.enemyBig, 'enemy', 2, (w) => w * 0.97 - arts.enemyBig.w),
  ];

  const shells: Shell[] = [];
  const particles: Particle[] = [];
  const rings: Ring[] = [];
  let pointer = { x: -1, y: -1 };
  let parallax = 0;
  let ambientTimer = 2;
  let running = false;
  let last = 0;
  let time = 0;

  // ---------- Layout ----------

  // Returns false while the window has no size yet (for example a tab opened in the background).
  function layout(): boolean {
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (vw < 1 || vh < 1) return false;
    scale = Math.max(2, Math.min(6, Math.round(Math.min(vw / 270, vh / 190))));
    W = Math.ceil(vw / scale);
    H = Math.ceil(vh / scale);
    element.width = W;
    element.height = H;
    element.style.width = `${W * scale}px`;
    element.style.height = `${H * scale}px`;
    ctx.imageSmoothingEnabled = false;

    const seaDepth = Math.round(Math.max(56, Math.min(H * 0.4, 100)));
    horizon = H - seaDepth;
    moon = { x: Math.round(W * 0.86), y: Math.round(horizon * 0.5), r: Math.round(Math.max(7, Math.min(H * 0.065, 14))) };
    if (pointer.x < 0) pointer = { x: W / 2, y: horizon - 20 };

    const r = seeded(3);
    stars = Array.from({ length: Math.round((W * horizon) / 220) }, () => ({
      x: Math.floor(r() * W),
      y: Math.floor(r() * (horizon - 6)),
      phase: r() * Math.PI * 2,
      level: r(),
    }));

    const narrow = W < 215;
    for (const ship of ships) {
      const depth = ship.layer === 0 ? 1 : ship.layer === 1 ? 0.38 : 0.82;
      ship.baseline = horizon + Math.round(seaDepth * depth) - (ship.layer === 0 ? seaDepth - 2 : 0);
      ship.homeX = Math.round(ship.place(W));
    }
    // Mid-distance ships would crowd a phone screen.
    for (const ship of ships) if (narrow && ship.layer === 1) ship.homeX = -999;

    sky = bakeSky();
    seaImage = ctx.createImageData(W, H - horizon);
    dirty = false;
    return true;
  }

  // Baked with a margin on both sides, so the parallax shift never shows an edge.
  function bakeSky(): HTMLCanvasElement {
    const element = canvas(W + SKY_MARGIN * 2, horizon + 1);
    const c = context(element);
    c.translate(SKY_MARGIN, 0);
    for (let y = 0; y <= horizon; y++) {
      const v = (y / horizon) * (SKY.length - 1);
      for (let x = -SKY_MARGIN; x < W + SKY_MARGIN; x++) {
        const i = Math.min(SKY.length - 1, Math.floor(v) + (v % 1 > dither(x, y) ? 1 : 0));
        c.fillStyle = SKY[i];
        c.fillRect(x, y, 1, 1);
      }
    }
    // Moon glow: dithered rings fading outward.
    const glow = ['#3a3f78', '#2c3266', '#222a58'];
    for (let y = moon.y - moon.r * 3; y <= moon.y + moon.r * 3; y++) {
      for (let x = moon.x - moon.r * 3; x <= moon.x + moon.r * 3; x++) {
        const d = Math.hypot(x - moon.x, y - moon.y) / moon.r;
        if (d < 1 || d > 3 || y > horizon) continue;
        const ring = Math.floor((d - 1) * 1.5);
        if (dither(x, y) < 0.75 - (d - 1) * 0.35 && ring < glow.length) {
          c.fillStyle = glow[ring];
          c.fillRect(x, y, 1, 1);
        }
      }
    }
    // The moon, shaded on its lower left, with a few craters.
    for (let y = moon.y - moon.r; y <= moon.y + moon.r; y++) {
      for (let x = moon.x - moon.r; x <= moon.x + moon.r; x++) {
        const d = Math.hypot(x - moon.x, y - moon.y);
        if (d > moon.r) continue;
        const shade = (x - moon.x) * -0.5 + (y - moon.y) * 0.6 > moon.r * 0.55;
        c.fillStyle = shade ? '#d6cf9f' : '#f5f0cf';
        c.fillRect(x, y, 1, 1);
      }
    }
    c.fillStyle = '#c9c290';
    const r = moon.r;
    for (const [dx, dy, s] of [[-0.35, -0.25, 0.22], [0.3, 0.2, 0.18], [-0.05, 0.45, 0.14], [0.35, -0.4, 0.1]]) {
      const size = Math.max(1, Math.round(r * s));
      c.fillRect(Math.round(moon.x + dx * r), Math.round(moon.y + dy * r), size, size);
    }
    // Distant islands on the horizon, rim-lit on the moon side.
    const rr = seeded(5);
    const island = (cx: number, width: number, height: number) => {
      for (let x = Math.round(cx - width / 2); x <= cx + width / 2; x++) {
        const t = (x - (cx - width / 2)) / width;
        const top = horizon - Math.round(Math.sin(t * Math.PI) ** 0.7 * height + (rr() < 0.3 ? 1 : 0));
        for (let y = top; y <= horizon; y++) {
          c.fillStyle = y === top && x > cx ? '#2a3466' : '#0c1430';
          c.fillRect(x, y, 1, 1);
        }
      }
    };
    island(W * 0.04, W * 0.24, 7);
    island(W * 0.3, W * 0.12, 4);
    island(W * 0.58, W * 0.18, 5);
    return element;
  }

  // ---------- Ships ----------

  const shipX = (ship: Ship): number => {
    const shift = Math.round(-parallax * (ship.layer === 0 ? 2 : ship.layer === 1 ? 4 : 7));
    let x = ship.homeX + shift;
    if (ship.enter < 1) {
      // Sail back in from the nearest edge.
      const off = ship.facing === 1 ? -(ship.homeX + ship.art.w + 4) : W - ship.homeX + 4;
      const e = 1 - (1 - ship.enter) ** 3;
      x += Math.round(off * (1 - e));
    }
    return x;
  };

  const bob = (ship: Ship): number => (ship.layer === 0 ? 0 : Math.round(Math.sin(time * 1.1 + ship.phase) * 0.7));

  function shipTop(ship: Ship): number {
    return ship.baseline - ship.art.waterline + bob(ship) + Math.max(0, ship.sink);
  }

  function pivot(ship: Ship, turret: Turret): { x: number; y: number; dir: number } {
    const x = shipX(ship);
    return {
      x: ship.facing === 1 ? x + turret.x : x + ship.art.w - 1 - turret.x,
      y: shipTop(ship) + turret.y,
      dir: ship.facing * turret.dir,
    };
  }

  function barrelEnd(ship: Ship, i: number): { x: number; y: number } {
    const turret = ship.art.turrets[i];
    const p = pivot(ship, turret);
    const a = ship.aim[i];
    return { x: p.x + Math.cos(a) * turret.len * p.dir, y: p.y - Math.sin(a) * turret.len };
  }

  const afloat = (ship: Ship) => ship.sink < 0 && ship.enter >= 1 && ship.homeX > -900;

  function elevationTo(ship: Ship, i: number, tx: number, ty: number): number | null {
    const p = pivot(ship, ship.art.turrets[i]);
    const ahead = (tx - p.x) * p.dir;
    if (ahead <= 2) return null;
    return Math.max(0.08, Math.min(1.15, Math.atan2(p.y - ty, ahead) + 0.15));
  }

  function fire(ship: Ship, tx: number, ty: number, byPlayer: boolean): boolean {
    let best = -1;
    for (let i = 0; i < ship.art.turrets.length; i++) {
      if (elevationTo(ship, i, tx, ty) !== null && (best < 0 || ship.art.turrets[i].dir === 1)) best = i;
    }
    if (best < 0) return false;
    ship.aim[best] = elevationTo(ship, best, tx, ty) ?? ship.aim[best];
    const start = barrelEnd(ship, best);
    const dist = Math.hypot(tx - start.x, ty - start.y);
    shells.push({
      sx: start.x,
      sy: start.y,
      tx,
      ty,
      t: 0,
      dur: 0.45 + dist / 220,
      arc: 8 + dist * 0.28,
      byPlayer,
      target: ship.side === 'ally' ? 'enemy' : 'ally',
      trail: [],
    });
    burst(start.x, start.y, 5, ['#fff6c8', '#ffd86b', '#ff9a3c'], 40, 0, 0.14, 1);
    burst(start.x, start.y, 2, ['#5a6070', '#3d4250'], 8, -6, 0.9, 1, 0.8);
    return true;
  }

  // ---------- Effects ----------

  function burst(
    x: number,
    y: number,
    count: number,
    colors: readonly string[],
    speed: number,
    lift: number,
    life: number,
    size: number,
    grow = 0,
    gravity = 0,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const s = speed * (0.4 + rand() * 0.6);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.6 + lift,
        life: life * (0.6 + rand() * 0.4),
        max: life,
        gravity,
        colors,
        size,
        grow,
      });
    }
  }

  function splash(x: number, y: number): void {
    for (let i = 0; i < 14; i++) {
      particles.push({
        x: x + (rand() - 0.5) * 3,
        y,
        vx: (rand() - 0.5) * 22,
        vy: -35 - rand() * 45,
        life: 0.6 + rand() * 0.3,
        max: 0.9,
        gravity: 140,
        colors: ['#ffffff', '#cfe3ff', '#8fb3e6'],
        size: 1,
        grow: 0,
      });
    }
    rings.push({ x, y, t: 0 });
  }

  function explosion(x: number, y: number, big: boolean): void {
    burst(x, y, big ? 26 : 16, ['#ffffff', '#fff1a8', '#ffc23c', '#ff7a2a', '#d83a22'], big ? 60 : 45, -20, 0.55, 1, 0, 40);
    burst(x, y - 2, big ? 10 : 6, ['#6a6f7c', '#4a4f5c', '#30343e'], 12, -14, 1.8, 1, 1.2);
  }

  function land(shell: Shell): void {
    const { tx: x, ty: y } = shell;
    if (y < horizon - 1) {
      // Anti-aircraft burst in the sky.
      burst(x, y, 8, ['#fff1a8', '#ffb43c'], 30, 0, 0.18, 1);
      burst(x, y, 7, ['#565b68', '#3d414c', '#2a2d36'], 10, -2, 1.4, 1, 1);
      if (shell.byPlayer) options.onImpact('miss');
      return;
    }
    for (const ship of ships) {
      if (ship.side !== shell.target || !afloat(ship) || ship.layer === 0) continue;
      const left = shipX(ship);
      const top = shipTop(ship);
      if (x < left || x >= left + ship.art.w || y < top + 4 || y > ship.baseline + 3) continue;
      if (!shell.byPlayer) break; // Ambient fire never hits.
      ship.hits++;
      ship.burning = 9;
      explosion(x, Math.min(y, ship.baseline - 1), ship.hits >= 3);
      if (ship.hits >= 3) {
        ship.sink = 0;
        options.onImpact('sunk');
      } else {
        options.onImpact('hit');
      }
      return;
    }
    splash(x, Math.max(y, horizon + 1));
    if (shell.byPlayer) options.onImpact('miss');
  }

  // ---------- Update ----------

  function update(dt: number): void {
    time += dt;
    parallax += ((pointer.x / W - 0.5) - parallax) * Math.min(1, dt * 3);
    for (const cloud of clouds) {
      cloud.x += (cloud.speed * dt) / W;
      if (cloud.x > 1.1) cloud.x = -0.25;
    }

    for (const ship of ships) {
      if (ship.homeX < -900) continue;
      if (ship.sink >= 0) {
        ship.sink += dt * 5;
        if (rand() < dt * 12) burst(shipX(ship) + rand() * ship.art.w, ship.baseline, 1, ['#cfe3ff', '#8fb3e6'], 6, -10, 0.8, 1);
        if (ship.sink > ship.art.h) {
          ship.sink = -1;
          ship.hits = 0;
          ship.burning = 0;
          ship.respawn = 3;
          ship.enter = 0;
        }
        continue;
      }
      if (ship.respawn > 0) {
        ship.respawn -= dt;
        continue;
      }
      if (ship.enter < 1) ship.enter = Math.min(1, ship.enter + dt / 5);

      // Allied turrets follow the pointer; enemies drift slowly.
      ship.aim = ship.aim.map((a, i) => {
        let target = 0.2 + Math.sin(time * 0.6 + ship.phase + i) * 0.08;
        if (ship.side === 'ally' && ship.layer > 0) target = elevationTo(ship, i, pointer.x, pointer.y) ?? 0.15;
        return a + (target - a) * Math.min(1, dt * 5);
      });

      ship.smokeTimer -= dt;
      if (ship.smokeTimer <= 0 && ship.layer > 0) {
        ship.smokeTimer = 0.35 + rand() * 0.3;
        const fx = ship.facing === 1 ? shipX(ship) + ship.art.funnel.x : shipX(ship) + ship.art.w - 1 - ship.art.funnel.x;
        particles.push({
          x: fx,
          y: shipTop(ship) + ship.art.funnel.y,
          vx: -ship.facing * (3 + rand() * 2),
          vy: -4 - rand() * 2,
          life: 2.6,
          max: 2.6,
          gravity: 0,
          colors: ['#4a5060', '#3a3f4c', '#2c303a'],
          size: 1,
          grow: 0.7,
        });
      }
      if (ship.burning > 0) {
        ship.burning -= dt;
        if (rand() < dt * 18) {
          const x = shipX(ship) + ship.art.w * (0.3 + rand() * 0.4);
          const y = ship.baseline - 4 - rand() * 4;
          burst(x, y, 1, ['#fff1a8', '#ffb43c', '#ff6a2a'], 4, -14, 0.45, 1);
          if (rand() < 0.4) burst(x, y - 2, 1, ['#3d414c', '#2a2d36'], 3, -8, 1.6, 1, 1);
        }
      }
    }

    ambientTimer -= dt;
    if (ambientTimer <= 0) {
      ambientTimer = 2.2 + rand() * 3;
      const shooters = ships.filter((s) => afloat(s) && s.layer > 0);
      const shooter = shooters[Math.floor(rand() * shooters.length)];
      const targets = ships.filter((s) => afloat(s) && s.side !== shooter?.side && s.layer > 0);
      const target = targets[Math.floor(rand() * targets.length)];
      if (shooter && target) {
        // Always a near miss: lands in the water a little short of or past the target.
        const miss = (rand() < 0.5 ? -1 : 1) * (6 + rand() * 12);
        const tx = shipX(target) + target.art.w / 2 + miss;
        fire(shooter, tx, target.baseline + 1 + Math.round(rand() * 3), false);
      }
    }

    for (let i = shells.length - 1; i >= 0; i--) {
      const shell = shells[i];
      shell.t += dt / shell.dur;
      const pos = shellAt(shell);
      shell.trail.push(pos);
      if (shell.trail.length > 4) shell.trail.shift();
      if (shell.t >= 1) {
        shells.splice(i, 1);
        land(shell);
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size += p.grow * dt;
      if (p.gravity > 0 && p.y > horizon + 2 && p.vy > 0 && p.colors[0] === '#ffffff') p.life = 0;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].t += dt;
      if (rings[i].t > 0.7) rings.splice(i, 1);
    }
  }

  function shellAt(shell: Shell): { x: number; y: number } {
    const t = Math.min(1, shell.t);
    return {
      x: shell.sx + (shell.tx - shell.sx) * t,
      y: shell.sy + (shell.ty - shell.sy) * t - shell.arc * 4 * t * (1 - t),
    };
  }

  // ---------- Draw ----------

  function drawSea(): void {
    if (!seaImage) return;
    const data = new Uint32Array(seaImage.data.buffer);
    const depth = H - horizon;
    const moonX = moon.x - Math.round(parallax);
    for (let row = 0; row < depth; row++) {
      const y = row + horizon;
      const d = row / depth;
      const v = d * (SEA_RGBA.length - 1);
      // Waves get longer and move faster toward the viewer. Each row has its own phase, so the
      // highlights break into short scattered dashes instead of lining up diagonally.
      const k = 0.5 / (0.3 + d * 1.6);
      const phase = rowPhase[row % rowPhase.length];
      const speed = 0.5 + d * 0.9;
      const glintWidth = 1.5 + d * 9;
      for (let x = 0; x < W; x++) {
        const base = SEA_RGBA[Math.min(SEA_RGBA.length - 1, Math.floor(v) + (v % 1 > dither(x, y) ? 1 : 0))];
        const wave = Math.sin(x * k + time * speed + phase) * Math.sin(x * k * 0.23 - time * 0.35 + phase * 1.7);
        let color = base;
        if (wave > 0.62) color = d < 0.35 ? WAVE_FAR : WAVE_NEAR;
        if (wave > 0.9 && d > 0.45) color = CREST;
        // Moonlight path: broken sparkles that thin out away from its centre.
        const off = Math.abs(x - moonX) / glintWidth;
        if (off < 1) {
          const sparkle = Math.sin(x * 0.9 + phase * 3 + time * (1.5 + d)) * 0.5 + wave * 0.6;
          if (sparkle > 0.35 + off * 0.5) color = off < 0.45 && sparkle > 0.6 ? GLINT : GLINT_DIM;
        }
        data[row * W + x] = color;
      }
    }
    ctx.putImageData(seaImage, 0, horizon);
  }

  function line(x0: number, y0: number, x1: number, y1: number, color: string): void {
    ctx.fillStyle = color;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps), 1, 1);
    }
  }

  function drawSearchlight(ship: Ship, offset: number): void {
    if (!afloat(ship)) return;
    const x = ship.facing === 1 ? shipX(ship) + ship.art.bridge.x : shipX(ship) + ship.art.w - 1 - ship.art.bridge.x;
    const y = shipTop(ship) + ship.art.bridge.y;
    const angle = -Math.PI / 2 + ship.facing * (0.55 + Math.sin(time * 0.22 + offset) * 0.45);
    const length = H * 1.4;
    const spread = 0.05;
    ctx.fillStyle = 'rgba(205, 220, 255, 0.07)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle - spread) * length, y + Math.sin(angle - spread) * length);
    ctx.lineTo(x + Math.cos(angle + spread) * length, y + Math.sin(angle + spread) * length);
    ctx.closePath();
    ctx.fill();
  }

  function drawShip(ship: Ship): void {
    if (ship.homeX < -900 || ship.respawn > 0) return;
    const x = shipX(ship);
    const y = shipTop(ship);
    const water = ship.baseline + bob(ship) + 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, water);
    ctx.clip();
    if (ship.facing === 1) {
      ctx.drawImage(ship.art.canvas, x, y);
    } else {
      ctx.translate(x + ship.art.w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(ship.art.canvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (ship.sink < 0) {
      ship.art.turrets.forEach((turret, i) => {
        const p = pivot(ship, turret);
        const end = barrelEnd(ship, i);
        line(p.x, p.y, end.x, end.y, ship.layer === 0 ? '#121c3e' : '#1f2a38');
      });
    }
    ctx.restore();

    if (ship.layer > 0 && ship.sink < 0) {
      // Foam along the hull and a bow wave.
      for (let i = 0; i < ship.art.w; i += 2) {
        if (Math.sin(time * 6 + i * 1.7 + ship.phase) > 0.2) {
          ctx.fillStyle = i % 4 === 0 ? '#cfe3ff' : '#8fb3e6';
          ctx.fillRect(x + i, water - 1, 1, 1);
        }
      }
      const bowX = ship.facing === 1 ? x + ship.art.w - 3 : x + 2;
      ctx.fillStyle = '#e8f2ff';
      ctx.fillRect(bowX + (Math.sin(time * 4 + ship.phase) > 0 ? ship.facing : 0), water - 2, 1, 1);
    }
  }

  function draw(): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sky, -SKY_MARGIN - Math.round(parallax), 0);

    for (const star of stars) {
      const twinkle = Math.sin(time * (1 + star.level * 2) + star.phase);
      const level = Math.min(STAR_COLORS.length - 1, Math.max(0, Math.floor(star.level * 3 + twinkle * 0.9)));
      if (twinkle < -0.85) continue;
      ctx.fillStyle = STAR_COLORS[level];
      ctx.fillRect(star.x - Math.round(parallax * 0.5), star.y, 1, 1);
    }
    for (const cloud of clouds) {
      ctx.drawImage(cloud.art, Math.round(cloud.x * W - parallax * 1.5), Math.round(cloud.y * horizon));
    }

    drawSea();
    drawSearchlight(ships[3], 1.3);
    drawSearchlight(ships[2], 4.1);
    for (const layer of [0, 1, 2]) for (const ship of ships) if (ship.layer === layer) drawShip(ship);

    for (const ring of rings) {
      const r = 1 + ring.t * 9;
      ctx.fillStyle = ring.t < 0.35 ? '#cfe3ff' : '#6f93c8';
      for (let a = 0; a < Math.PI * 2; a += 0.35) {
        ctx.fillRect(Math.round(ring.x + Math.cos(a) * r), Math.round(ring.y + Math.sin(a) * r * 0.3), 1, 1);
      }
    }
    for (const shell of shells) {
      shell.trail.forEach((p, i) => {
        ctx.fillStyle = i === shell.trail.length - 1 ? '#fff6c8' : i > 1 ? '#ffb43c' : '#a8542a';
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      });
    }
    for (const p of particles) {
      const age = 1 - p.life / p.max;
      ctx.fillStyle = p.colors[Math.min(p.colors.length - 1, Math.floor(age * p.colors.length))];
      const size = Math.max(1, Math.round(p.size));
      ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
    }
  }

  // ---------- Loop and input ----------

  function frame(now: number): void {
    if (!element.isConnected) {
      running = false;
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!dirty || layout()) {
      update(dt);
      draw();
    }
    requestAnimationFrame(frame);
  }

  const toArt = (event: PointerEvent) => ({ x: event.clientX / scale, y: event.clientY / scale });

  window.addEventListener('resize', () => {
    dirty = true;
    if (still && element.isConnected && layout()) draw();
  });
  document.addEventListener('pointermove', (event) => {
    if (element.isConnected) pointer = toArt(event);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!element.isConnected || still || event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest('button, input, select, textarea, a, label, .menu-plaque')) return;
    const { x, y } = toArt(event);
    pointer = { x, y };
    // The closest allied gun ship that can bear on the spot fires.
    const shooters = ships
      .filter((s) => s.side === 'ally' && s.layer > 0 && afloat(s))
      .sort((a, b) => Math.abs(shipX(a) - x) - Math.abs(shipX(b) - x));
    for (const ship of shooters) if (fire(ship, Math.round(x), Math.round(y), true)) return;
  });

  return {
    element,
    start() {
      if (running) return;
      if (still) {
        if (!dirty || layout()) draw();
        return;
      }
      running = true;
      last = performance.now();
      requestAnimationFrame(frame);
    },
  };
}
