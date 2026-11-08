import type { ShotResult } from '../game/types';

// Sound effects are synthesized with the Web Audio API, so no audio files are needed.
let ctx: AudioContext | undefined;

function context(): AudioContext | undefined {
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
