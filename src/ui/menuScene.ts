import type { ShotResult } from '../game/types';

// A naval battle drawn as pixel art behind the menus. It is rendered on a small canvas
// (one canvas pixel per art pixel) and scaled up by CSS with crisp edges.
// Interactive: turrets follow the pointer, clicking the sea fires a shell, clicking the sky fires flak.
// Each hit scars and sets fire to an enemy ship, and the fifth blows it up; it sinks and later sails back in.
// Clicking the moon turns night into a sunny day, and clicking the sun turns it back.
// Easter egg: hitting your own ships three times wakes the kraken (so does the Konami code, against an enemy).

export interface MenuScene {
  readonly element: HTMLCanvasElement;
  // Mounts the animation if it is not already running. Call after the canvas is in the page.
  start(): void;
  // True while the scene shows a sunny day.
  isDay(): boolean;
}

export interface SceneOptions {
  // Called when a shell the player fired lands, to play the matching sound.
  onImpact(result: ShotResult): void;
  // The moon or sun was clicked and the sky changed.
  onSkyChange?(day: boolean): void;
  // The kraken is rising.
  onKraken?(): void;
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
  // A brighter copy of the art for daytime, for the hazy far ships.
  readonly dayArt: HTMLCanvasElement | null;
  hits: number;
  burning: number;
  // Burn marks from hits, relative to the ship's top left. Each one smoulders.
  scars: { x: number; y: number }[];
  // Seconds of explosions left before a fatally hit ship goes down.
  dying: number;
  blastTimer: number;
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
const SKY_DAY = ['#2f7fd0', '#3c8ad6', '#4b96dc', '#5ba3e2', '#6eb0e7', '#84bdeb', '#9dcbee', '#b9daf0'];
const SEA_DAY = ['#4f9fd8', '#4592cd', '#3b85c1', '#3278b5', '#296ba8', '#21609b', '#1a558e'];
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

// The far ships by day: pale blue-grey, softened by the haze.
const haze = (side: Side): Palette => ({
  deck: '#8fa8c6',
  hullLight: '#8199b8',
  hull: '#7790b0',
  red: '#7790b0',
  redDark: '#7790b0',
  sup: '#859ebd',
  supLight: '#97afcb',
  window: '#8199b8',
  windowDim: '#859ebd',
  funnel: '#8199b8',
  band: '#8199b8',
  flag: side === 'ally' ? '#4777bd' : '#bd5246',
  turret: '#8199b8',
  turretTop: '#8fa8c6',
  mast: '#97afcb',
  outline: null,
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

function cloudArt(seed: number, day = false): HTMLCanvasElement {
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
      // Lit from above: a lighter rim on the top edge.
      const above = blobs.some((b) => (x - b.x) ** 2 + ((y - 1 - b.y) * 1.6) ** 2 <= b.r * b.r);
      if (day) ctx.fillStyle = above ? '#e3edf7' : '#ffffff';
      else ctx.fillStyle = above ? '#1a2550' : '#3a4478';
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


// Blends two #rrggbb colours; t = 0 gives a, 1 gives b.
function mix(a: string, b: string, t: number): string {
  const channel = (i: number) => {
    const from = parseInt(a.slice(i, i + 2), 16);
    const to = parseInt(b.slice(i, i + 2), 16);
    return Math.round(from + (to - from) * t).toString(16).padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
// Kraken timeline, in seconds: the water churns, tentacles rise, then they drag the ship down.
const KRAKEN_RISE = 1.2;
const KRAKEN_GRAB = 2.6;
const KRAKEN_END = 9;
// Hits that sink a ship on the menu, and how long it burns and blows apart before going down.
const SINK_HITS = 5;
const DYING_SECONDS = 0.9;
const MAX_SCARS = 7;
const SKY_KEY = 'battleship-sky';

// Night and day versions of the water colours, blended as the sky changes.
const WATER = {
  waveFar: ['#34508a', '#78b8e8'],
  waveNear: ['#4d71b0', '#9ccdf2'],
  crest: ['#a4c0ea', '#f4fbff'],
  glint: ['#f1e6b0', '#fffbe8'],
  glintDim: ['#9c936e', '#cfe7f8'],
} as const;

function loadDay(): boolean {
  try {
    return window.localStorage.getItem(SKY_KEY) === 'day';
  } catch {
    return false;
  }
}

function saveDay(day: boolean): void {
  try {
    window.localStorage.setItem(SKY_KEY, day ? 'day' : 'night');
  } catch {
    // The sky then resets to night next time.
  }
}

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
  let skyNight: HTMLCanvasElement = canvas(1, 1);
  let skyDay: HTMLCanvasElement = canvas(1, 1);
  // The sky: day is what the player chose; dayness eases between night (0) and day (1).
  let day = loadDay();
  let dayness = day ? 1 : 0;
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
  const dayArts = {
    allyFar: shipArt(false, haze('ally')).canvas,
    enemyFar: shipArt(true, haze('enemy')).canvas,
  };
  const clouds = [0, 1, 2, 3].map((i) => ({
    art: cloudArt(i + 11),
    dayArt: cloudArt(i + 11, true),
    x: rand(),
    y: 0.12 + rand() * 0.4,
    speed: 1 + rand() * 2,
  }));

  const makeShip = (
    art: ShipArt,
    side: Side,
    layer: 0 | 1 | 2,
    place: (w: number) => number,
    dayArt: HTMLCanvasElement | null = null,
  ): Ship => ({
    art,
    dayArt,
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
    scars: [],
    dying: 0,
    blastTimer: 0,
    sink: -1,
    respawn: 0,
    enter: 1,
    smokeTimer: rand(),
  });

  const ships: Ship[] = [
    makeShip(arts.allyFar, 'ally', 0, (w) => w * 0.12, dayArts.allyFar),
    makeShip(arts.enemyFar, 'enemy', 0, (w) => w * 0.78, dayArts.enemyFar),
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

  // Easter egg state.
  let friendlyHits = 0;
  let kraken: { ship: Ship; t: number } | null = null;
  let konami = 0;

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

    skyNight = bakeSky(false);
    skyDay = bakeSky(true);
    seaImage = ctx.createImageData(W, H - horizon);
    dirty = false;
    return true;
  }

  // Baked with a margin on both sides, so the parallax shift never shows an edge.
  // Night has the moon; day has the sun in the same spot, so one click toggles between them.
  function bakeSky(sunny: boolean): HTMLCanvasElement {
    const element = canvas(W + SKY_MARGIN * 2, horizon + 1);
    const c = context(element);
    c.translate(SKY_MARGIN, 0);
    const colors = sunny ? SKY_DAY : SKY;
    for (let y = 0; y <= horizon; y++) {
      const v = (y / horizon) * (colors.length - 1);
      for (let x = -SKY_MARGIN; x < W + SKY_MARGIN; x++) {
        const i = Math.min(colors.length - 1, Math.floor(v) + (v % 1 > dither(x, y) ? 1 : 0));
        c.fillStyle = colors[i];
        c.fillRect(x, y, 1, 1);
      }
    }
    // Glow: dithered rings fading outward.
    const glow = sunny ? ['#fff4c8', '#d8ecf6', '#b8dcf3'] : ['#3a3f78', '#2c3266', '#222a58'];
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
    if (sunny) {
      // Short pixel rays around the sun.
      c.fillStyle = '#fff1b8';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const reach = i % 2 === 0 ? 2.2 : 1.8;
        for (let d = moon.r * 1.35; d <= moon.r * reach; d += 1) {
          c.fillRect(Math.round(moon.x + Math.cos(a) * d), Math.round(moon.y + Math.sin(a) * d), 1, 1);
        }
      }
    }
    // The disc, shaded on its lower left; the moon also has a few craters.
    for (let y = moon.y - moon.r; y <= moon.y + moon.r; y++) {
      for (let x = moon.x - moon.r; x <= moon.x + moon.r; x++) {
        const d = Math.hypot(x - moon.x, y - moon.y);
        if (d > moon.r) continue;
        const shade = (x - moon.x) * -0.5 + (y - moon.y) * 0.6 > moon.r * 0.55;
        if (sunny) c.fillStyle = d > moon.r - 1.2 ? '#ffd65a' : shade ? '#ffe680' : '#fff8d0';
        else c.fillStyle = shade ? '#d6cf9f' : '#f5f0cf';
        c.fillRect(x, y, 1, 1);
      }
    }
    if (!sunny) {
      c.fillStyle = '#c9c290';
      const r = moon.r;
      for (const [dx, dy, s] of [[-0.35, -0.25, 0.22], [0.3, 0.2, 0.18], [-0.05, 0.45, 0.14], [0.35, -0.4, 0.1]]) {
        const size = Math.max(1, Math.round(r * s));
        c.fillRect(Math.round(moon.x + dx * r), Math.round(moon.y + dy * r), size, size);
      }
    }
    // Distant islands on the horizon, lit on the side facing the moon or sun.
    const rr = seeded(5);
    const island = (cx: number, width: number, height: number) => {
      for (let x = Math.round(cx - width / 2); x <= cx + width / 2; x++) {
        const t = (x - (cx - width / 2)) / width;
        const top = horizon - Math.round(Math.sin(t * Math.PI) ** 0.7 * height + (rr() < 0.3 ? 1 : 0));
        for (let y = top; y <= horizon; y++) {
          if (sunny) c.fillStyle = y === top && x > cx ? '#8fbf74' : y - top < 2 ? '#5f8f5a' : '#4a7552';
          else c.fillStyle = y === top && x > cx ? '#2a3466' : '#0c1430';
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
    // A ship in the kraken's grip shudders.
    if (kraken?.ship === ship && ship.sink < 0 && kraken.t > 0.4) x += Math.round(Math.sin(time * 38));
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
    // Damaged ships settle lower in the water.
    const list = ship.sink < 0 ? Math.floor(ship.hits / 2) : 0;
    return ship.baseline - ship.art.waterline + bob(ship) + Math.max(0, ship.sink) + list;
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

  const afloat = (ship: Ship) =>
    ship.sink < 0 && ship.dying <= 0 && ship.enter >= 1 && ship.homeX > -900 && kraken?.ship !== ship;

  function elevationTo(ship: Ship, i: number, tx: number, ty: number): number | null {
    const p = pivot(ship, ship.art.turrets[i]);
    const ahead = (tx - p.x) * p.dir;
    if (ahead <= 2) return null;
    return Math.max(0.08, Math.min(1.15, Math.atan2(p.y - ty, ahead) + 0.15));
  }

  // With `anyway`, a gun that cannot bear lobs the shell high over the ship (used for friendly fire).
  function fire(ship: Ship, tx: number, ty: number, byPlayer: boolean, anyway = false): boolean {
    let best = -1;
    for (let i = 0; i < ship.art.turrets.length; i++) {
      if (elevationTo(ship, i, tx, ty) !== null && (best < 0 || ship.art.turrets[i].dir === 1)) best = i;
    }
    if (best < 0 && anyway) {
      best = 0;
      ship.aim[0] = 1.15;
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
    // Nearest ships first, so a shot lands on whatever is in front.
    for (const ship of [...ships].sort((a, b) => b.layer - a.layer)) {
      if (!afloat(ship) || ship.layer === 0) continue;
      if (!shell.byPlayer && ship.side !== shell.target) continue;
      if (!onShip(ship, x, y)) continue;
      if (!shell.byPlayer) break; // Ambient fire never hits.
      if (ship.side === 'ally') {
        friendlyFire(ship, x, y);
        return;
      }
      ship.hits++;
      scar(ship, x, y);
      explosion(x, Math.min(y, ship.baseline - 1), ship.hits >= 3);
      // The last hit sets off a chain of explosions; blowUp() then sends it down.
      if (ship.hits >= SINK_HITS) ship.dying = DYING_SECONDS;
      options.onImpact('hit');
      return;
    }
    splash(x, Math.max(y, horizon + 1));
    if (shell.byPlayer) options.onImpact('miss');
  }

  function onShip(ship: Ship, x: number, y: number): boolean {
    const left = shipX(ship);
    return x >= left && x < left + ship.art.w && y >= shipTop(ship) + 4 && y <= ship.baseline + 3;
  }

  // A burn mark where a shell struck. It smoulders until the ship sinks.
  function scar(ship: Ship, x: number, y: number): void {
    if (ship.scars.length >= MAX_SCARS) ship.scars.shift();
    const top = shipTop(ship);
    ship.scars.push({
      x: Math.max(1, Math.min(ship.art.w - 2, Math.round(x - shipX(ship)))),
      y: Math.max(ship.art.waterline - 9, Math.min(ship.art.waterline - 2, Math.round(y - top))),
    });
  }

  // Fire and smoke from every burn mark; more hits, more fire.
  function smoulder(ship: Ship, dt: number): void {
    const water = ship.baseline + bob(ship);
    for (const s of ship.scars) {
      const x = shipX(ship) + s.x;
      const y = shipTop(ship) + s.y;
      if (y >= water) continue;
      if (rand() < dt * (3 + ship.hits * 2)) burst(x, y - 1, 1, ['#fff1a8', '#ffb43c', '#ff6a2a'], 4, -14, 0.45, 1);
      if (rand() < dt * (1 + ship.hits)) burst(x, y - 3, 1, ['#3d414c', '#2a2d36', '#202228'], 3, -9, 1.8, 1, 1);
    }
  }

  // A random spot on the hull or deck, in scene pixels.
  function onHull(ship: Ship): { x: number; y: number } {
    return {
      x: shipX(ship) + 3 + rand() * (ship.art.w - 6),
      y: shipTop(ship) + ship.art.waterline - 2 - rand() * 8,
    };
  }

  function debris(x: number, y: number, count: number): void {
    burst(x, y, count, ['#20232b', '#3d414c', '#5b6070'], 55, -45, 1.1, 1, 0, 130);
  }

  // The final blast: the magazine goes up and the ship starts to sink.
  function blowUp(ship: Ship): void {
    const cx = shipX(ship) + ship.art.w / 2;
    const cy = shipTop(ship) + ship.art.waterline - 4;
    burst(cx, cy, 30, ['#ffffff', '#fff1a8', '#ffc23c', '#ff7a2a'], 95, -15, 0.35, 2);
    explosion(cx - ship.art.w * 0.25, cy, true);
    explosion(cx + ship.art.w * 0.25, cy + 1, true);
    debris(cx, cy, 22);
    burst(cx, cy - 4, 14, ['#4a4f5c', '#3d414c', '#2a2d36'], 10, -18, 2.6, 1, 1.5);
    rings.push({ x: cx, y: ship.baseline + 1, t: 0 }, { x: cx - 8, y: ship.baseline + 2, t: -0.15 }, { x: cx + 8, y: ship.baseline + 2, t: -0.3 });
    ship.sink = 0;
    options.onImpact('sunk');
  }

  // ---------- Easter eggs ----------

  function friendlyFire(ship: Ship, x: number, y: number): void {
    explosion(x, Math.min(y, ship.baseline - 1), false);
    scar(ship, x, y);
    ship.burning = 4;
    options.onImpact('hit');
    friendlyHits++;
    if (friendlyHits < 3) return;
    friendlyHits = 0;
    summonKraken(ship);
  }

  function summonKraken(ship: Ship): boolean {
    if (kraken || !afloat(ship) || ship.layer === 0) return false;
    kraken = { ship, t: 0 };
    options.onKraken?.();
    return true;
  }

  // The moon by night and the sun by day sit in the same place.
  function onSkyLight(x: number, y: number): boolean {
    return Math.hypot(x - (moon.x - Math.round(parallax)), y - moon.y) <= moon.r + 2;
  }

  function toggleSky(): void {
    day = !day;
    saveDay(day);
    options.onSkyChange?.(day);
  }

  function updateEggs(dt: number): void {
    dayness += ((day ? 1 : 0) - dayness) * Math.min(1, dt * 1.6);
    if (Math.abs(dayness - (day ? 1 : 0)) < 0.002) dayness = day ? 1 : 0;

    if (!kraken) return;
    const ship = kraken.ship;
    kraken.t += dt;
    if (kraken.t < KRAKEN_GRAB && rand() < dt * 4) {
      rings.push({ x: shipX(ship) + rand() * ship.art.w, y: ship.baseline + 1 + Math.round(rand() * 2), t: 0 });
    }
    if (kraken.t >= KRAKEN_GRAB && ship.sink < 0 && ship.respawn <= 0 && ship.enter >= 1) {
      ship.sink = 0;
      ship.burning = 0;
      splash(shipX(ship) + ship.art.w / 2, ship.baseline + 1);
      options.onImpact('sunk');
    }
    if (kraken.t >= KRAKEN_END) kraken = null;
  }

  // ---------- Update ----------

  function update(dt: number): void {
    time += dt;
    updateEggs(dt);
    parallax += ((pointer.x / W - 0.5) - parallax) * Math.min(1, dt * 3);
    for (const cloud of clouds) {
      cloud.x += (cloud.speed * dt) / W;
      if (cloud.x > 1.1) cloud.x = -0.25;
    }

    for (const ship of ships) {
      if (ship.homeX < -900) continue;
      if (ship.respawn <= 0) smoulder(ship, dt);
      if (ship.dying > 0) {
        // Secondary explosions rip along the ship before it goes down.
        ship.dying -= dt;
        ship.blastTimer -= dt;
        if (ship.blastTimer <= 0) {
          ship.blastTimer = 0.14 + rand() * 0.1;
          const spot = onHull(ship);
          explosion(spot.x, spot.y, false);
          debris(spot.x, spot.y, 4);
        }
        if (ship.dying <= 0) blowUp(ship);
        continue;
      }
      if (ship.sink >= 0) {
        // The kraken pulls faster than the sea.
        ship.sink += dt * (kraken?.ship === ship ? 8 : 5);
        if (rand() < dt * 12) burst(shipX(ship) + rand() * ship.art.w, ship.baseline, 1, ['#cfe3ff', '#8fb3e6'], 6, -10, 0.8, 1);
        if (ship.sink > ship.art.h) {
          ship.sink = -1;
          ship.hits = 0;
          ship.burning = 0;
          ship.scars = [];
          ship.respawn = 3;
          ship.enter = 0;
          // The kraken lets go once the ship is under, so it does not ride the ship back in.
          if (kraken?.ship === ship) kraken = null;
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
    // Colours blend from night to day as the sky changes.
    const blend = ([night, sunny]: readonly [string, string]) => rgba(mix(night, sunny, dayness));
    const seaColors = SEA.map((night, i) => blend([night, SEA_DAY[i]]));
    const waveFar = blend(WATER.waveFar);
    const waveNear = blend(WATER.waveNear);
    const crest = blend(WATER.crest);
    const glint = blend(WATER.glint);
    const glintDim = blend(WATER.glintDim);
    const depth = H - horizon;
    const moonX = moon.x - Math.round(parallax);
    for (let row = 0; row < depth; row++) {
      const y = row + horizon;
      const d = row / depth;
      const v = d * (seaColors.length - 1);
      // Waves get longer and move faster toward the viewer. Each row has its own phase, so the
      // highlights break into short scattered dashes instead of lining up diagonally.
      const k = 0.5 / (0.3 + d * 1.6);
      const phase = rowPhase[row % rowPhase.length];
      const speed = 0.5 + d * 0.9;
      const glintWidth = 1.5 + d * 9;
      for (let x = 0; x < W; x++) {
        const base = seaColors[Math.min(seaColors.length - 1, Math.floor(v) + (v % 1 > dither(x, y) ? 1 : 0))];
        const wave = Math.sin(x * k + time * speed + phase) * Math.sin(x * k * 0.23 - time * 0.35 + phase * 1.7);
        let color = base;
        if (wave > 0.62) color = d < 0.35 ? waveFar : waveNear;
        if (wave > 0.9 && d > 0.45) color = crest;
        // Moonlight (or sunlight) path: broken sparkles that thin out away from its centre.
        const off = Math.abs(x - moonX) / glintWidth;
        if (off < 1) {
          const sparkle = Math.sin(x * 0.9 + phase * 3 + time * (1.5 + d)) * 0.5 + wave * 0.6;
          if (sparkle > 0.35 + off * 0.5) color = off < 0.45 && sparkle > 0.6 ? glint : glintDim;
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
    if (dayness > 0.97) return;
    ctx.fillStyle = `rgba(205, 220, 255, ${0.07 * (1 - dayness)})`;
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
    const flipped = (image: HTMLCanvasElement) => {
      if (ship.facing === 1) {
        ctx.drawImage(image, x, y);
        return;
      }
      ctx.save();
      ctx.translate(x + ship.art.w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(image, 0, 0);
      ctx.restore();
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, water);
    ctx.clip();
    // A blown-up ship goes down stern first, bow rising. The kraken pulls straight down.
    if (ship.sink >= 0 && kraken?.ship !== ship) {
      const pivotX = x + ship.art.w / 2;
      ctx.translate(pivotX, water);
      ctx.rotate(-ship.facing * Math.min(0.4, (ship.sink / ship.art.h) * 0.7));
      ctx.translate(-pivotX, -water);
    }
    flipped(ship.art.canvas);
    if (ship.dayArt && dayness > 0) {
      ctx.globalAlpha = dayness;
      flipped(ship.dayArt);
      ctx.globalAlpha = 1;
    }
    for (const s of ship.scars) {
      ctx.fillStyle = '#1c1714';
      ctx.fillRect(x + s.x - 1, y + s.y, 3, 1);
      ctx.fillRect(x + s.x, y + s.y - 1, 1, 3);
      ctx.fillStyle = Math.sin(time * 9 + s.x * 2.3) > 0.2 ? '#ff8a2a' : '#a8341c';
      ctx.fillRect(x + s.x, y + s.y, 1, 1);
    }
    if (ship.sink < 0) {
      const barrel = ship.layer === 0 ? mix('#121c3e', '#8199b8', dayness) : '#1f2a38';
      ship.art.turrets.forEach((turret, i) => {
        const p = pivot(ship, turret);
        const end = barrelEnd(ship, i);
        line(p.x, p.y, end.x, end.y, barrel);
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

  // Tentacles rise around the ship, sway, curl inward and follow it down.
  function drawKraken(): void {
    if (!kraken) return;
    const ship = kraken.ship;
    if (ship.respawn > 0 || ship.homeX < -900 || ship.enter < 1) return;
    const rise = Math.min(1, Math.max(0, (kraken.t - KRAKEN_RISE) / (KRAKEN_GRAB - KRAKEN_RISE)));
    const eased = 1 - (1 - rise) ** 3;
    const water = ship.baseline + bob(ship) + 1;
    const left = shipX(ship);
    const centre = left + ship.art.w / 2;
    const full = ship.art.waterline + 8;
    const height = Math.round(full * eased - Math.max(0, ship.sink));
    if (kraken.t < KRAKEN_GRAB) {
      // Dark water churning under the ship.
      ctx.fillStyle = '#070d20';
      for (let x = left - 4; x < left + ship.art.w + 4; x++) {
        for (let y = water; y < water + 3; y++) if (dither(x, y) < 0.5 * Math.min(1, kraken.t)) ctx.fillRect(x, y, 1, 1);
      }
    }
    if (height <= 0) return;
    [0.06, 0.34, 0.66, 0.94].forEach((at, i) => {
      const base = left + ship.art.w * at;
      const lean = Math.sign(centre - base) || 1;
      for (let s = 0; s < height; s++) {
        const k = s / Math.max(1, height);
        const sway = Math.sin(s * 0.35 + time * 4 + i * 1.7) * (0.6 + s * 0.05);
        const x = Math.round(base + sway + lean * k * k * 7 * eased);
        const y = water - s;
        const thick = k < 0.35 ? 4 : k < 0.6 ? 3 : k < 0.85 ? 2 : 1;
        ctx.fillStyle = '#9a4aa6';
        ctx.fillRect(x - 1, y, thick, 1);
        ctx.fillStyle = '#5a2266';
        ctx.fillRect(lean > 0 ? x - 1 : x + thick - 2, y, 1, 1);
        if (s % 3 === 1 && thick > 1) {
          ctx.fillStyle = '#ffc2e2';
          ctx.fillRect(lean > 0 ? x + thick - 2 : x - 1, y, 1, 1);
        }
      }
      // The tip curls over toward the ship.
      const tipX = Math.round(base + lean * 7 * eased + Math.sin(height * 0.35 + time * 4 + i * 1.7));
      ctx.fillStyle = '#c47ad0';
      ctx.fillRect(tipX + lean, water - height, 1, 1);
      ctx.fillRect(tipX + lean * 2, water - height + 1, 1, 1);
    });
  }

  function draw(): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const skyX = -SKY_MARGIN - Math.round(parallax);
    if (dayness < 1) ctx.drawImage(skyNight, skyX, 0);
    if (dayness > 0) {
      ctx.globalAlpha = dayness;
      ctx.drawImage(skyDay, skyX, 0);
      ctx.globalAlpha = 1;
    }

    if (dayness < 0.95) {
      ctx.globalAlpha = 1 - dayness;
      for (const star of stars) {
        const twinkle = Math.sin(time * (1 + star.level * 2) + star.phase);
        const level = Math.min(STAR_COLORS.length - 1, Math.max(0, Math.floor(star.level * 3 + twinkle * 0.9)));
        if (twinkle < -0.85) continue;
        ctx.fillStyle = STAR_COLORS[level];
        ctx.fillRect(star.x - Math.round(parallax * 0.5), star.y, 1, 1);
      }
      ctx.globalAlpha = 1;
    }
    for (const cloud of clouds) {
      const cx = Math.round(cloud.x * W - parallax * 1.5);
      const cy = Math.round(cloud.y * horizon);
      if (dayness < 1) ctx.drawImage(cloud.art, cx, cy);
      if (dayness > 0) {
        ctx.globalAlpha = dayness;
        ctx.drawImage(cloud.dayArt, cx, cy);
        ctx.globalAlpha = 1;
      }
    }

    drawSea();
    drawSearchlight(ships[3], 1.3);
    drawSearchlight(ships[2], 4.1);
    for (const layer of [0, 1, 2]) {
      for (const ship of ships) if (ship.layer === layer) drawShip(ship);
      if (kraken?.ship.layer === layer) drawKraken();
    }

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
    if (!element.isConnected || event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest('button, input, select, textarea, a, label, .menu-plaque')) return;
    const { x, y } = toArt(event);
    if (onSkyLight(x, y)) {
      toggleSky();
      if (still) {
        dayness = day ? 1 : 0;
        draw();
      }
      return;
    }
    if (still) return;
    pointer = { x, y };
    // The closest allied gun ship that can bear on the spot fires.
    const shooters = ships
      .filter((s) => s.side === 'ally' && s.layer > 0 && afloat(s))
      .sort((a, b) => Math.abs(shipX(a) - x) - Math.abs(shipX(b) - x));
    for (const ship of shooters) if (fire(ship, Math.round(x), Math.round(y), true)) return;
    // Aiming at one of our own ships that no gun can bear on: a gun crew lobs one over anyway.
    const own = ships.find((s) => s.side === 'ally' && afloat(s) && s.layer > 0 && onShip(s, x, y));
    if (!own) return;
    const others = shooters.filter((s) => s !== own);
    fire(others[0] ?? own, Math.round(x), Math.round(y), true, true);
  });
  document.addEventListener('keydown', (event) => {
    if (!element.isConnected || still) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    konami = key === KONAMI[konami] ? konami + 1 : key === KONAMI[0] ? 1 : 0;
    if (konami < KONAMI.length) return;
    konami = 0;
    const enemies = ships.filter((s) => s.side === 'enemy' && s.layer > 0 && afloat(s));
    const target = enemies[Math.floor(rand() * enemies.length)];
    if (target) summonKraken(target);
  });

  return {
    element,
    isDay: () => day,
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
