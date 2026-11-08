// Draws every game sprite as pixel art and writes transparent PNGs to public/assets.
// Run with `npm run assets`. Needs only Node, no packages.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const TILE = 32;
// Sprites are drawn on a 32px grid, then enlarged so the browser can scale them to any cell size.
const EXPORT_SCALE = 3;

const parseHex = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
  255,
];

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Sprite {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 4);
  }

  set(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels.set(parseHex(color), (Math.floor(y) * this.width + Math.floor(x)) * 4);
  }

  clear(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels.set([0, 0, 0, 0], (Math.floor(y) * this.width + Math.floor(x)) * 4);
  }

  rect(x, y, w, h, color) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, color);
    return this;
  }

  circle(cx, cy, r, color) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, color);
      }
    }
    return this;
  }

  ring(cx, cy, r, thickness, color) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r && d > r - thickness) this.set(x, y, color);
      }
    }
    return this;
  }

  line(x0, y0, x1, y1, color, thickness = 1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      this.rect(x - Math.floor((thickness - 1) / 2), y - Math.floor((thickness - 1) / 2), thickness, thickness, color);
    }
    return this;
  }

  polygon(points, color) {
    const ys = points.map((p) => p[1]);
    const xs = points.map((p) => p[0]);
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
      for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i];
          const [xj, yj] = points[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) this.set(x, y, color);
      }
    }
    return this;
  }

  // Copies the non-transparent pixels of another sprite on top of this one.
  blit(source, offsetX = 0, offsetY = 0) {
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const from = (y * source.width + x) * 4;
        if (source.pixels[from + 3] === 0) continue;
        const tx = x + offsetX;
        const ty = y + offsetY;
        if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue;
        this.pixels.set(source.pixels.subarray(from, from + 4), (ty * this.width + tx) * 4);
      }
    }
    return this;
  }

  scaled(factor) {
    const out = new Sprite(this.width * factor, this.height * factor);
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const from = (Math.floor(y / factor) * this.width + Math.floor(x / factor)) * 4;
        out.pixels.set(this.pixels.subarray(from, from + 4), (y * out.width + x) * 4);
      }
    }
    return out;
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(sprite) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(sprite.width, 0);
  header.writeUInt32BE(sprite.height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = sprite.width * 4;
  const raw = Buffer.alloc((stride + 1) * sprite.height);
  for (let y = 0; y < sprite.height; y++) {
    Buffer.from(sprite.pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function save(name, sprite) {
  writeFileSync(join(OUT_DIR, `${name}.png`), encodePng(sprite.scaled(EXPORT_SCALE)));
}

// ---------- Tiles ----------

function baseTile(fill, border, inner) {
  const tile = new Sprite(TILE, TILE);
  tile.rect(0, 0, TILE, TILE, border);
  tile.rect(1, 1, TILE - 2, TILE - 2, inner);
  tile.rect(2, 2, TILE - 4, TILE - 4, fill);
  for (const [x, y] of [[0, 0], [1, 0], [0, 1]]) {
    tile.clear(x, y);
    tile.clear(TILE - 1 - x, y);
    tile.clear(x, TILE - 1 - y);
    tile.clear(TILE - 1 - x, TILE - 1 - y);
  }
  return tile;
}

function texture(tile, seed, dark, light, count = 26) {
  const random = seededRandom(seed);
  for (let i = 0; i < count; i++) {
    const x = 3 + Math.floor(random() * 23);
    const y = 3 + Math.floor(random() * 26);
    tile.rect(x, y, 2 + Math.floor(random() * 4), 1, random() < 0.5 ? dark : light);
  }
  return tile;
}

const waterTile = (seed = 11) => texture(baseTile('#134269', '#2a76ad', '#0e3355'), seed, '#0f3759', '#184e7a');

function corners(sprite, color, length, thickness, inset) {
  const far = sprite.width - inset - 1;
  for (const [cx, dx] of [[inset, 1], [far, -1]]) {
    for (const [cy, dy] of [[inset, 1], [far, -1]]) {
      for (let t = 0; t < thickness; t++) {
        sprite.line(cx + dx * t, cy, cx + dx * t, cy + dy * (length - 1), color);
        sprite.line(cx, cy + dy * t, cx + dx * (length - 1), cy + dy * t, color);
      }
    }
  }
  return sprite;
}

function redX(sprite, inset, color, shadow, thickness) {
  const far = TILE - 1 - inset;
  if (shadow) {
    sprite.line(inset, inset + 1, far, far + 1, shadow, thickness);
    sprite.line(far, inset + 1, inset, far + 1, shadow, thickness);
  }
  sprite.line(inset, inset, far, far, color, thickness);
  sprite.line(far, inset, inset, far, color, thickness);
  return sprite;
}

// ---------- Effects ----------

function burst(radius, seed, sparks = 0) {
  const sprite = new Sprite(TILE, TILE);
  const random = seededRandom(seed);
  const center = (TILE - 1) / 2;
  const phase = random() * Math.PI * 2;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const dx = x - center;
      const dy = y - center;
      const reach = radius * (0.82 + 0.18 * Math.sin(Math.atan2(dy, dx) * 8 + phase));
      const t = Math.hypot(dx, dy) / reach;
      if (t > 1) continue;
      const grain = (random() - 0.5) * 0.08;
      const v = t + grain;
      const color = v < 0.25 ? '#fff4ad' : v < 0.5 ? '#ffc63d' : v < 0.72 ? '#ff8f1f' : v < 0.9 ? '#de4c17' : '#8c2a0e';
      sprite.set(x, y, color);
    }
  }
  for (let i = 0; i < sparks; i++) {
    const angle = random() * Math.PI * 2;
    const distance = radius + 2 + random() * 5;
    const x = Math.round(center + Math.cos(angle) * distance);
    const y = Math.round(center + Math.sin(angle) * distance);
    sprite.rect(x, y, 1 + Math.floor(random() * 2), 1, random() < 0.5 ? '#ff8f1f' : '#de4c17');
  }
  return sprite;
}

function splash(frame) {
  const sprite = new Sprite(TILE, TILE);
  const height = [7, 13, 17][frame];
  const spread = [8, 10, 12][frame];
  const baseY = 25;
  for (let i = -spread - 3; i <= spread + 3; i++) {
    const wobble = Math.abs(i) % 3 === 0 ? 1 : 0;
    sprite.set(15.5 + i, baseY + wobble, Math.abs(i) > spread ? '#2f9ad6' : '#7fd4f5');
  }
  for (const [offset, scale] of [[-spread, 0.45], [-spread / 2, 0.75], [0, 1], [spread / 2, 0.75], [spread, 0.45]]) {
    const tipX = Math.round(15.5 + offset * 1.1);
    const footX = Math.round(15.5 + offset * 0.7);
    const top = Math.round(baseY - height * scale);
    sprite.polygon([[footX - 3, baseY], [footX + 3, baseY], [tipX, top]], '#2f9ad6');
    sprite.polygon([[footX - 1, baseY], [footX + 2, baseY], [tipX, top + 2]], '#7fd4f5');
    sprite.line(tipX, top + 1, tipX, top + 3, '#e8f7ff');
  }
  if (frame > 0) {
    const random = seededRandom(40 + frame);
    for (let i = 0; i < frame * 5; i++) {
      const x = 4 + Math.floor(random() * 24);
      const y = Math.max(2, baseY - height - 2 + Math.floor(random() * 8));
      sprite.rect(x, y, 2, 2, random() < 0.5 ? '#7fd4f5' : '#2f9ad6');
    }
  }
  return sprite;
}

// ---------- Ships ----------

const HULL = {
  outline: '#262d38',
  light: '#a3adba',
  deck: '#7f8a99',
  shade: '#596373',
  dark: '#3b4350',
};

function drawHull(sprite, maxHalf) {
  const right = sprite.width - 3;
  const left = 2;
  const cy = 15.5;
  for (let x = left; x <= right; x++) {
    const stern = 3 + (x - left) * 0.8;
    const bow = 0.8 + (right - x) * 0.42;
    const half = Math.round(Math.min(maxHalf, stern, bow));
    for (let dy = -half; dy <= half; dy++) {
      const r = dy / Math.max(half, 1);
      let color = HULL.deck;
      if (Math.abs(dy) === half || x === left || x === right) color = HULL.outline;
      else if (r < -0.55) color = HULL.light;
      else if (r > 0.45) color = HULL.shade;
      sprite.set(x, Math.round(cy + dy), color);
    }
  }
  // Rivets along each side, and the deck's centre stripe.
  for (let x = left + 7; x < right - 12; x += 6) {
    sprite.set(x, Math.round(cy - maxHalf + 2), HULL.dark);
    sprite.set(x + 3, Math.round(cy + maxHalf - 2), HULL.dark);
  }
  return sprite;
}

function block(sprite, x, y, w, h) {
  sprite.rect(x, y, w, h, HULL.outline);
  sprite.rect(x + 1, y + 1, w - 2, h - 2, '#a9b3bf');
  sprite.rect(x + 1, y + 1, w - 2, 1, '#d0d7df');
  sprite.rect(x + 1, y + h - 2, w - 2, 1, '#6e7886');
  return sprite;
}

function turret(sprite, cx, cy, r, direction = 1, barrels = 1) {
  const gap = barrels > 1 ? [-1, 1] : [0];
  for (const offset of gap) {
    sprite.rect(direction > 0 ? cx : cx - r - 5, cy + offset, r + 6, 1, HULL.outline);
  }
  sprite.circle(cx, cy, r, HULL.outline);
  sprite.circle(cx, cy, r - 1, '#9ba6b3');
  sprite.rect(cx - 1, cy - r + 1, 2, 1, '#d0d7df');
  sprite.set(cx, cy, HULL.dark);
  return sprite;
}

function tower(sprite, x, y, size) {
  block(sprite, x, y + 2, size, size - 2);
  block(sprite, x + 2, y - 3, size - 4, size - 3);
  sprite.circle(x + size / 2 - 0.5, y - 1, Math.max(2, size / 4), '#b9c2cd');
  sprite.rect(x + 3, y - 2, size - 6, 1, HULL.dark);
  return sprite;
}

const SHIP_LAYOUTS = {
  carrier: (s) => {
    drawHull(s, 11);
    turret(s, 16, 15, 4, -1);
    block(s, 26, 11, 12, 9);
    block(s, 42, 8, 15, 5);
    block(s, 42, 18, 15, 5);
    tower(s, 70, 10, 15);
    turret(s, 92, 15, 4, 1, 2);
    block(s, 104, 10, 14, 5);
    block(s, 104, 17, 14, 5);
    turret(s, 128, 15, 4, 1);
  },
  battleship: (s) => {
    drawHull(s, 10);
    turret(s, 18, 15, 4, -1, 2);
    block(s, 30, 11, 11, 9);
    tower(s, 49, 10, 13);
    turret(s, 73, 15, 4, 1, 2);
    block(s, 84, 12, 9, 7);
    turret(s, 102, 15, 4, 1, 2);
  },
  cruiser: (s) => {
    drawHull(s, 9);
    turret(s, 17, 15, 3, -1);
    tower(s, 36, 11, 12);
    block(s, 52, 12, 10, 7);
    turret(s, 70, 15, 3, 1, 2);
  },
  submarine: (s) => {
    drawHull(s, 8);
    block(s, 15, 13, 9, 5);
    block(s, 30, 11, 11, 9);
    tower(s, 44, 12, 9);
    turret(s, 66, 15, 3, 1);
  },
  destroyer: (s) => {
    drawHull(s, 8);
    turret(s, 14, 15, 3, -1);
    tower(s, 25, 12, 10);
    turret(s, 44, 15, 3, 1);
  },
};

const SHIP_LENGTHS = { carrier: 5, battleship: 4, cruiser: 3, submarine: 3, destroyer: 2 };

function ship(type) {
  const sprite = new Sprite(SHIP_LENGTHS[type] * TILE, TILE);
  SHIP_LAYOUTS[type](sprite);
  return sprite;
}

// ---------- Icons ----------

function radar() {
  const s = new Sprite(TILE, TILE);
  const c = 15.5;
  s.circle(c, c, 15, '#2f9e58');
  s.circle(c, c, 13.5, '#07241a');
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const angle = Math.atan2(y - c, x - c);
      if (Math.hypot(x - c, y - c) <= 13 && angle > -Math.PI / 2 && angle < -Math.PI / 6) s.set(x, y, '#1f8f4d');
    }
  }
  s.ring(c, c, 9, 1, '#2f9e58');
  s.ring(c, c, 5, 1, '#2f9e58');
  s.line(2, 16, 29, 16, '#1b6b3e');
  s.line(16, 2, 16, 29, '#1b6b3e');
  s.line(16, 15, 27, 9, '#8df0a8', 1);
  s.rect(8, 19, 2, 2, '#8df0a8');
  s.rect(20, 8, 2, 2, '#8df0a8');
  return s;
}

// One frame of the animated radar: the beam points at `beam` radians (0 = right, clockwise),
// with a fading trail behind it, and blips that light up as the beam passes and then fade.
const RADAR_FRAMES = 16;
const RADAR_BLIPS = [[21, 8], [8, 19], [22, 21], [11, 9]];

function radarFrame(beam) {
  const s = new Sprite(TILE, TILE);
  const c = 15.5;
  const behind = (x, y) => {
    const angle = Math.atan2(y - c, x - c);
    return (((beam - angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  };
  s.circle(c, c, 15, '#2f9e58');
  s.circle(c, c, 13.5, '#07241a');
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (Math.hypot(x - c, y - c) > 13) continue;
      const d = behind(x, y);
      if (d < 0.4) s.set(x, y, '#2fbf6a');
      else if (d < 0.9) s.set(x, y, '#1f8f4d');
      else if (d < 1.5) s.set(x, y, '#145f36');
    }
  }
  s.ring(c, c, 9, 1, '#2f9e58');
  s.ring(c, c, 5, 1, '#2f9e58');
  s.line(3, 16, 28, 16, '#1b6b3e');
  s.line(16, 3, 16, 28, '#1b6b3e');
  for (const [x, y] of RADAR_BLIPS) {
    const d = behind(x + 1, y + 1);
    if (d < 0.9) s.rect(x, y, 2, 2, '#d8ffe4');
    else if (d < 2.4) s.rect(x, y, 2, 2, '#6fe39a');
    else if (d < 3.6) s.rect(x, y, 2, 2, '#2f9e58');
  }
  s.line(16, 16, Math.round(16 + Math.cos(beam) * 12), Math.round(16 + Math.sin(beam) * 12), '#b8ffcc');
  s.rect(15, 15, 2, 2, '#d8ffe4');
  return s;
}

function crosshair() {
  const s = new Sprite(TILE, TILE);
  s.ring(15.5, 15.5, 9, 2, '#e8eef5');
  s.rect(15, 2, 2, 9, '#e8eef5');
  s.rect(15, 21, 2, 9, '#e8eef5');
  s.rect(2, 15, 9, 2, '#e8eef5');
  s.rect(21, 15, 9, 2, '#e8eef5');
  s.rect(15, 15, 2, 2, '#e8eef5');
  return s;
}

function anchor() {
  const s = new Sprite(TILE, TILE);
  const color = '#9aa8b8';
  s.ring(15.5, 6, 4, 2, color);
  s.rect(14, 9, 4, 18, color);
  s.rect(9, 11, 14, 3, color);
  s.line(14, 27, 6, 21, color, 3);
  s.line(17, 27, 25, 21, color, 3);
  s.polygon([[3, 17], [10, 20], [5, 24]], color);
  s.polygon([[28, 17], [21, 20], [26, 24]], color);
  s.rect(14, 10, 1, 16, '#d0d7df');
  return s;
}

function gear() {
  const s = new Sprite(TILE, TILE);
  const c = 15.5;
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    s.line(c + Math.cos(angle) * 8, c + Math.sin(angle) * 8, c + Math.cos(angle) * 13, c + Math.sin(angle) * 13, '#8a97a7', 5);
  }
  s.circle(c, c, 10, '#8a97a7');
  s.ring(c, c, 10, 1, '#a9b3bf');
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (Math.hypot(x - c, y - c) <= 4) s.clear(x, y);
    }
  }
  return s;
}

function speaker(muted) {
  const s = new Sprite(TILE, TILE);
  s.polygon([[4, 11], [11, 11], [20, 4], [20, 28], [11, 21], [4, 21]], '#8a97a7');
  s.rect(5, 12, 5, 2, '#b9c2cd');
  if (muted) {
    s.line(3, 27, 28, 5, '#ee4a3c', 3);
  } else {
    s.rect(23, 11, 2, 10, '#8a97a7');
    s.rect(27, 8, 2, 16, '#8a97a7');
  }
  return s;
}

// Speech bubble with three dots, for the quick-message button.
function message() {
  const s = new Sprite(TILE, TILE);
  const edge = '#8a97a7';
  const fill = '#e8eef5';
  s.rect(5, 5, 22, 16, edge).rect(4, 6, 24, 14, edge);
  s.rect(6, 6, 20, 14, fill).rect(5, 7, 22, 12, fill);
  s.polygon([[9, 20], [16, 20], [8, 27]], edge);
  s.polygon([[10, 20], [14, 20], [9, 25]], fill);
  for (const x of [10, 15, 20]) s.rect(x, 12, 3, 3, '#3a5a80');
  return s;
}

function flag(color, shade) {
  const s = new Sprite(TILE, TILE);
  s.rect(6, 3, 2, 26, '#e8eef5');
  s.polygon([[8, 4], [28, 11], [8, 20]], color);
  s.polygon([[8, 13], [28, 11], [8, 20]], shade);
  return s;
}

// ---------- Export ----------

mkdirSync(OUT_DIR, { recursive: true });

for (const type of Object.keys(SHIP_LENGTHS)) save(`ship-${type}`, ship(type));

const markHit = burst(11, 7, 4);
const markSunk = redX(new Sprite(TILE, TILE), 6, '#ee3f35', '#7a1712', 4);
save('mark-hit', markHit);
save('mark-sunk', markSunk);

save('tile-empty', waterTile());
save('tile-selected', corners(texture(baseTile('#1f6191', '#3f8fc7', '#17527d'), 12, '#1a5786', '#2a6fa3'), '#e8eef5', 6, 2, 4));
save('tile-valid', texture(baseTile('#1b6e3c', '#31a35c', '#14552e'), 13, '#17602f', '#237f48'));
save('tile-invalid', redX(texture(baseTile('#6d2231', '#b03c3f', '#541826'), 14, '#5e1c29', '#7c2a39'), 8, '#ee4a3c', null, 3));

const miss = waterTile(15);
miss.circle(15.5, 15.5, 3.5, '#b8cfe3');
miss.circle(15, 15, 2.5, '#ffffff');
save('tile-miss', miss);
save('tile-hit', waterTile(16).blit(markHit));

const sunkTile = texture(baseTile('#0f3557', '#2a76ad', '#0b2946'), 17, '#0b2a47', '#134269');
sunkTile.rect(5, 13, 22, 6, '#3b4350');
sunkTile.rect(9, 11, 5, 2, '#596373');
save('tile-sunk', sunkTile.blit(markSunk));

const placed = waterTile(18);
placed.blit(ship('destroyer'), -32 + 2, 0);
save('tile-ship', placed);

const explosions = [burst(5, 21, 5), burst(9, 22, 5), burst(14, 23, 3)];
const splashes = [splash(0), splash(1), splash(2)];
for (const [name, frames] of [['explosion', explosions], ['splash', splashes]]) {
  const strip = new Sprite(TILE * frames.length, TILE);
  frames.forEach((frame, i) => {
    save(`${name}-${i + 1}`, frame);
    strip.blit(frame, TILE * i);
  });
  save(`${name}-strip`, strip);
}

save('reticle-white', corners(new Sprite(TILE, TILE), '#f2f5f8', 8, 2, 3));
save('reticle-yellow', corners(new Sprite(TILE, TILE), '#ffd23c', 8, 2, 3));
save('reticle-red', corners(new Sprite(TILE, TILE), '#ee4a3c', 8, 3, 2));

save('icon-radar', radar());
const radarStrip = new Sprite(TILE * RADAR_FRAMES, TILE);
for (let i = 0; i < RADAR_FRAMES; i++) {
  radarStrip.blit(radarFrame(-Math.PI / 2 + (i * 2 * Math.PI) / RADAR_FRAMES), TILE * i);
}
save('radar-strip', radarStrip);
save('icon-crosshair', crosshair());
save('icon-anchor', anchor());
save('icon-gear', gear());
save('icon-sound-on', speaker(false));
save('icon-sound-off', speaker(true));
save('icon-message', message());
save('icon-flag-blue', flag('#3f7fe0', '#2c5fb5'));
save('icon-flag-red', flag('#e8473c', '#b5302a'));

console.log(`Assets written to ${OUT_DIR}`);
