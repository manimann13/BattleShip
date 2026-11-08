import type { ShotResult } from '../game/types';

// Sound effects are synthesized with the Web Audio API, so no audio files are needed.
// The music in music.ts shares this audio context.
let ctx: AudioContext | undefined;

export function context(): AudioContext | undefined {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return undefined;
  ctx = new Ctor();
  return ctx;
}

function noise(ac: AudioContext, seconds: number): AudioBufferSourceNode {
  const buffer = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * seconds)), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ac.createBufferSource();
  source.buffer = buffer;
  return source;
}

// A burst of filtered noise whose volume fades out; the filter sweeps from `from` to `to` Hz.
function burst(ac: AudioContext, start: number, seconds: number, from: number, to: number, volume: number, type: BiquadFilterType): void {
  const source = noise(ac, seconds);
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(to, start + seconds);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + seconds);
  source.connect(filter).connect(gain).connect(ac.destination);
  source.start(start);
}

// A tone that glides from `from` to `to` Hz while fading out.
function tone(ac: AudioContext, start: number, seconds: number, from: number, to: number, volume: number, wave: OscillatorType): void {
  const osc = ac.createOscillator();
  osc.type = wave;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + seconds);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + seconds);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + seconds);
}

// Rising "bloop" like a bubble popping in water.
function bubble(ac: AudioContext, start: number, from: number, volume: number): void {
  tone(ac, start, 0.08 + Math.random() * 0.05, from, from * (1.6 + Math.random() * 0.8), volume, 'sine');
}

// Many tiny random clicks spread over `seconds`, like fire crackling.
function crackle(ac: AudioContext, start: number, seconds: number, count: number, volume: number): void {
  for (let i = 0; i < count; i++) {
    // Squaring bunches the pops toward the start, so the crackle trails off.
    const at = start + seconds * Math.random() ** 2;
    const length = 0.008 + Math.random() * 0.025;
    burst(ac, at, length, 2000 + Math.random() * 5000, 800, volume * (0.4 + Math.random() * 0.6), 'highpass');
  }
}

// Water splash: a sharp slap, a wash of water that fades out, then a few bubbles.
function playMiss(ac: AudioContext, t: number): void {
  burst(ac, t, 0.08, 6000, 2000, 0.5, 'highpass');
  burst(ac, t + 0.02, 0.7, 2200, 350, 0.4, 'bandpass');
  tone(ac, t, 0.12, 300, 90, 0.3, 'sine');
  for (let i = 0; i < 5; i++) bubble(ac, t + 0.08 + Math.random() * 0.45, 500 + Math.random() * 700, 0.12);
}

// Punchy impact: low thump, a blast of noise, then crackling fire.
function playHit(ac: AudioContext, t: number): void {
  tone(ac, t, 0.3, 160, 40, 0.7, 'sine');
  burst(ac, t, 0.4, 2500, 200, 0.45, 'lowpass');
  crackle(ac, t + 0.05, 0.7, 28, 0.35);
}

// Big explosion followed by a long, sinking rumble and a descending groan.
function playSunk(ac: AudioContext, t: number): void {
  playHit(ac, t);
  tone(ac, t + 0.1, 1.2, 220, 35, 0.4, 'sawtooth');
  burst(ac, t + 0.15, 1.4, 900, 60, 0.55, 'lowpass');
  tone(ac, t + 0.5, 0.9, 90, 30, 0.5, 'sine');
}

// Plays the effect for a shot. Never throws: audio problems must not break the game.
export function playShotSound(result: ShotResult): void {
  try {
    const ac = context();
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume();
    const t = ac.currentTime + 0.01;
    if (result === 'miss') playMiss(ac, t);
    else if (result === 'hit') playHit(ac, t);
    else playSunk(ac, t);
  } catch {
    // Ignore: sound is optional.
  }
}

// Mechanical switch, like a heavy toggle on a ship's control panel: a sharp metal snap,
// a low thunk from the switch body, then a faint click as it springs back. Never throws.
export function playClickSound(): void {
  try {
    const ac = context();
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume();
    const t = ac.currentTime + 0.005;
    burst(ac, t, 0.012, 7000, 3000, 0.35, 'highpass');
    tone(ac, t, 0.045, 190, 95, 0.3, 'triangle');
    tone(ac, t + 0.002, 0.02, 1800, 1200, 0.06, 'square');
    burst(ac, t + 0.045, 0.008, 4500, 2500, 0.14, 'bandpass');
  } catch {
    // Ignore: sound is optional.
  }
}

// A soft two-note bell when the sky changes: rising into day, falling into night.
export function playSkyChime(day: boolean): void {
  try {
    const ac = context();
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume();
    const t = ac.currentTime + 0.01;
    const [first, second] = day ? [660, 990] : [880, 587];
    tone(ac, t, 0.9, first, first * 0.998, 0.1, 'sine');
    tone(ac, t + 0.14, 1.3, second, second * 0.998, 0.1, 'sine');
    tone(ac, t + 0.14, 0.8, second * 2.76, second * 2.75, 0.02, 'sine');
  } catch {
    // Ignore: sound is optional.
  }
}

// A deep, wet rumble as something huge rises from the sea.
export function playKrakenSound(): void {
  try {
    const ac = context();
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume();
    const t = ac.currentTime + 0.01;
    tone(ac, t, 2.2, 70, 38, 0.5, 'sawtooth');
    burst(ac, t, 2, 600, 80, 0.4, 'lowpass');
    for (let i = 0; i < 8; i++) bubble(ac, t + 0.3 + Math.random() * 1.5, 150 + Math.random() * 250, 0.18);
  } catch {
    // Ignore: sound is optional.
  }
}

// A held note with a quick attack, a steady middle and a short fade, through a soft low-pass so
// square and sawtooth waves sound more like brass. `bend` slides the pitch down by that ratio.
function note(
  ac: AudioContext,
  start: number,
  seconds: number,
  freq: number,
  volume: number,
  wave: OscillatorType,
  cutoff: number,
  bend = 1,
): void {
  const osc = ac.createOscillator();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, start);
  if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(freq * bend, start + seconds);
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoff, start);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.02);
  gain.gain.setValueAtTime(volume, start + seconds * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.001, start + seconds);
  osc.connect(filter).connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + seconds + 0.02);
}

// Victory: a bright brass fanfare (G, C, E, G, then a long high C), with fireworks popping after.
// Defeat: one of the DEFEAT_SOUNDS below.
export function playEndSound(won: boolean): void {
  try {
    const ac = context();
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume();
    const t = ac.currentTime + 0.05;
    if (won) {
      const steps: [number, number, number][] = [
        [0, 0.14, 392],
        [0.15, 0.14, 523.25],
        [0.3, 0.14, 659.25],
        [0.45, 0.3, 783.99],
        [0.8, 1.1, 1046.5],
      ];
      for (const [at, length, freq] of steps) {
        note(ac, t + at, length, freq, 0.09, 'square', 2600);
        note(ac, t + at, length, freq / 2, 0.08, 'sawtooth', 1200);
      }
      // A chord under the last note.
      note(ac, t + 0.8, 1.1, 659.25, 0.05, 'triangle', 3000);
      note(ac, t + 0.8, 1.1, 392, 0.05, 'triangle', 3000);
      for (let i = 0; i < 5; i++) crackle(ac, t + 1.2 + i * 0.35 + Math.random() * 0.2, 0.4, 12, 0.18);
    } else {
      DEFEAT_SOUNDS[defeatSound](ac, t);
    }
  } catch {
    // Ignore: sound is optional.
  }
}

// A deep ship's bell: a low tone with the bright, out-of-tune overtones of struck metal.
function bell(ac: AudioContext, start: number, freq: number, volume: number, seconds: number): void {
  for (const [ratio, level, length] of [[1, 1, 1], [2, 0.5, 0.7], [2.76, 0.35, 0.5], [5.4, 0.15, 0.25]] as const) {
    tone(ac, start, seconds * length, freq * ratio, freq * ratio * 0.999, volume * level, 'sine');
  }
  burst(ac, start, 0.03, 4000, 1500, volume * 0.6, 'bandpass');
}

// Ideas for the defeat sound, to try out. Each starts at time t.
export const DEFEAT_SOUNDS = {
  // 1. Sinking: a muffled boom, water rushing in, then bubbles slowing as the ship goes down.
  sinking(ac: AudioContext, t: number): void {
    tone(ac, t, 0.9, 110, 32, 0.6, 'sine');
    burst(ac, t, 0.8, 700, 80, 0.45, 'lowpass');
    burst(ac, t + 0.3, 1.8, 1400, 180, 0.3, 'bandpass');
    tone(ac, t + 0.5, 2.2, 75, 48, 0.12, 'sawtooth');
    for (let i = 0; i < 14; i++) {
      const at = t + 0.6 + (i / 14) ** 1.5 * 2.6;
      bubble(ac, at, 200 + Math.random() * 300 - i * 8, 0.14 - i * 0.006);
    }
  },
  // 2. Ship's bell: three slow, deep tolls, the last one lower.
  bell(ac: AudioContext, t: number): void {
    bell(ac, t, 220, 0.16, 2.2);
    bell(ac, t + 1.1, 220, 0.14, 2.2);
    bell(ac, t + 2.2, 164.81, 0.16, 3);
    burst(ac, t + 2.2, 2.4, 300, 50, 0.12, 'lowpass');
  },
  // 3. Minor fanfare: the victory fanfare's sad twin, slower, falling into a low minor chord.
  minor(ac: AudioContext, t: number): void {
    const steps: [number, number, number][] = [
      [0, 0.3, 440],
      [0.32, 0.3, 349.23],
      [0.64, 0.3, 293.66],
      [0.96, 1.6, 220],
    ];
    for (const [at, length, freq] of steps) {
      note(ac, t + at, length, freq, 0.07, 'square', 1600);
      note(ac, t + at, length, freq / 2, 0.07, 'triangle', 1200);
    }
    note(ac, t + 0.96, 1.6, 174.61, 0.05, 'triangle', 1400);
    note(ac, t + 0.96, 1.6, 146.83, 0.06, 'triangle', 1400);
  },
  // 4. Bugle lament: a soft solo bugle playing a slow falling phrase.
  bugle(ac: AudioContext, t: number): void {
    const steps: [number, number, number][] = [
      [0, 0.55, 440],
      [0.6, 0.35, 392],
      [1, 0.55, 349.23],
      [1.6, 0.55, 329.63],
      [2.2, 1.6, 293.66],
    ];
    for (const [at, length, freq] of steps) {
      note(ac, t + at, length, freq, 0.12, 'triangle', 1800);
      note(ac, t + at, length, freq * 2, 0.025, 'sawtooth', 1400);
    }
  },
  // The first version: a ship's horn sinking down in four falling notes.
  horn(ac: AudioContext, t: number): void {
    const steps: [number, number, number][] = [
      [0, 0.45, 196],
      [0.5, 0.45, 185],
      [1, 0.45, 174.61],
      [1.5, 1.4, 164.81],
    ];
    for (const [at, length, freq] of steps) {
      const last = length > 1;
      note(ac, t + at, length, freq, 0.12, 'sawtooth', 700, last ? 0.94 : 0.985);
      note(ac, t + at, length, freq / 2, 0.1, 'sawtooth', 400, last ? 0.94 : 0.985);
    }
    burst(ac, t + 1.6, 1.5, 500, 60, 0.25, 'lowpass');
  },
} as const;

export type DefeatSound = keyof typeof DEFEAT_SOUNDS;

// The one the game plays: Mani picked the minor fanfare (2026-11-08). The others are kept to try later.
let defeatSound: DefeatSound = 'minor';

// Plays one defeat sound now, to compare them.
export function previewDefeatSound(name: DefeatSound): void {
  try {
    const ac = context();
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume();
    DEFEAT_SOUNDS[name](ac, ac.currentTime + 0.05);
  } catch {
    // Ignore: sound is optional.
  }
}

export function setDefeatSound(name: DefeatSound): void {
  defeatSound = name;
}
