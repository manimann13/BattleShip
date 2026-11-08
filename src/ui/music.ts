import { context } from './sound';

// Background music, synthesized like the sound effects so there are no audio files.
// The menu plays a lilting 6/8 sea shanty on a reedy, concertina-like voice; battles play a
// driving march. Both tunes are original. Notes are scheduled a little ahead of time on the
// audio clock, which keeps the rhythm steady even when the page is busy.

export type Track = 'menu' | 'battle';

type Out = AudioNode;
type Play = (ac: AudioContext, t: number, out: Out) => void;

interface Song {
  readonly stepSeconds: number;
  readonly steps: number;
  // Steps in one bar, so a change of tune can wait for the next downbeat.
  readonly barSteps: number;
  readonly events: ReadonlyMap<number, readonly Play[]>;
}

const VOLUME = 0.5;
// Changing tunes: the old one plays on and fades out while the new one fades in, both starting on
// the old tune's next downbeat, so the switch blends instead of cutting.
const FADE_OUT_SECONDS = 2.2;
const FADE_IN_SECONDS = 1.6;
// Turning the music off, or hiding the tab, fades out quickly.
const STOP_SECONDS = 0.6;
const LOOKAHEAD_SECONDS = 0.3;
const TICK_MS = 80;

const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// ---------- Instruments ----------

let noiseBuffer: AudioBuffer | undefined;
function noise(ac: AudioContext): AudioBufferSourceNode {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ac.sampleRate) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const source = ac.createBufferSource();
  source.buffer = noiseBuffer;
  return source;
}

// Holds `volume` for most of the note, then lets it go.
function envelope(ac: AudioContext, t: number, seconds: number, volume: number, attack: number): GainNode {
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + attack);
  gain.gain.setValueAtTime(volume, t + Math.max(attack, seconds * 0.8));
  gain.gain.linearRampToValueAtTime(0, t + seconds);
  return gain;
}

// Concertina: two slightly detuned reeds with a gentle wobble.
function reed(midi: number, seconds: number, volume: number): Play {
  return (ac, t, out) => {
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1700;
    const gain = envelope(ac, t, seconds, volume, 0.03);
    filter.connect(gain).connect(out);
    const wobble = ac.createOscillator();
    wobble.frequency.value = 5;
    const depth = ac.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(5, t + Math.min(0.3, seconds));
    wobble.connect(depth);
    for (const [wave, detune] of [['square', -6], ['sawtooth', 6]] as const) {
      const osc = ac.createOscillator();
      osc.type = wave;
      osc.frequency.value = freq(midi);
      osc.detune.value = detune;
      depth.connect(osc.detune);
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + seconds + 0.05);
    }
    wobble.start(t);
    wobble.stop(t + seconds + 0.05);
  };
}

// Plucked bass string.
function pluck(midi: number, seconds: number, volume: number): Play {
  return (ac, t, out) => {
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq(midi);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + seconds);
  };
}

// Buzzy bass for the battle march.
function growl(midi: number, seconds: number, volume: number): Play {
  return (ac, t, out) => {
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq(midi);
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(250, t + seconds);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    osc.connect(filter).connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + seconds);
  };
}

// Brass call: the filter opens as the note swells.
function brass(midi: number, seconds: number, volume: number): Play {
  return (ac, t, out) => {
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(350, t);
    filter.frequency.linearRampToValueAtTime(1500, t + 0.12);
    filter.frequency.linearRampToValueAtTime(900, t + seconds);
    const gain = envelope(ac, t, seconds, volume, 0.06);
    filter.connect(gain).connect(out);
    for (const detune of [-5, 5]) {
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq(midi);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + seconds + 0.05);
    }
  };
}

// Boot on a wooden deck.
function stomp(volume: number): Play {
  return (ac, t, out) => {
    const osc = ac.createOscillator();
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 0.2);
  };
}

function hiss(seconds: number, frequency: number, type: BiquadFilterType, volume: number): Play {
  return (ac, t, out) => {
    const source = noise(ac);
    const filter = ac.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    source.connect(filter).connect(gain).connect(out);
    source.start(t, Math.random() * 0.5, seconds);
  };
}

const tick = (volume: number) => hiss(0.03, 6500, 'highpass', volume);
const snare = (volume: number) => hiss(0.14, 1800, 'bandpass', volume);

// ---------- Songs ----------

type Note = readonly [midi: number | null, steps: number];

function song(stepSeconds: number, steps: number, barSteps: number, build: (at: (step: number, play: Play) => void) => void): Song {
  const events = new Map<number, Play[]>();
  build((step, play) => {
    const list = events.get(step) ?? [];
    list.push(play);
    events.set(step, list);
  });
  return { stepSeconds, steps, barSteps, events };
}

// Places a melody note by note, starting at step `from`.
function melody(at: (step: number, play: Play) => void, notes: readonly Note[], stepSeconds: number, voice: (midi: number, seconds: number) => Play, from = 0): void {
  let step = from;
  for (const [midi, length] of notes) {
    if (midi !== null) at(step, voice(midi, length * stepSeconds * 0.95));
    step += length;
  }
}

// D minor shanty in 6/8: six eighth notes per bar, 16 bars.
const MENU_STEP = 0.2;
const MENU_TUNE: readonly Note[] = [
  [62, 2], [65, 1], [69, 2], [69, 1], [67, 2], [65, 1], [64, 2], [62, 1],
  [60, 2], [64, 1], [67, 2], [67, 1], [69, 3], [64, 3],
  [62, 2], [65, 1], [69, 2], [72, 1], [74, 2], [72, 1], [69, 2], [65, 1],
  [67, 2], [64, 1], [60, 2], [64, 1], [62, 6],
  [74, 2], [74, 1], [72, 2], [69, 1], [70, 2], [69, 1], [67, 3],
  [72, 2], [72, 1], [70, 2], [67, 1], [69, 6],
  [74, 2], [74, 1], [72, 2], [69, 1], [70, 2], [69, 1], [67, 2], [65, 1],
  [64, 2], [65, 1], [67, 2], [64, 1], [62, 6],
];
const MENU_ROOTS = [50, 43, 48, 45, 50, 46, 48, 50, 50, 46, 48, 45, 50, 46, 48, 50];

const MENU = song(MENU_STEP, 16 * 6, 6, (at) => {
  melody(at, MENU_TUNE, MENU_STEP, (midi, seconds) => reed(midi, seconds, 0.045));
  MENU_ROOTS.forEach((root, bar) => {
    const start = bar * 6;
    at(start, pluck(root - 12, 0.55, 0.22));
    at(start + 3, pluck(root - 5, 0.55, 0.16));
    // A soft held chord note under the tune, like the concertina's left hand.
    at(start, reed(root + 12, 6 * MENU_STEP * 0.95, 0.012));
    at(start, stomp(0.22));
    at(start + 3, stomp(0.12));
    at(start + 2, tick(0.025));
    at(start + 5, tick(0.025));
  });
});

// D minor march in 4/4: sixteen steps per bar, 8 bars.
const BATTLE_STEP = 0.115;
const BATTLE_ROOTS = [38, 38, 34, 36, 38, 38, 43, 45];
const BATTLE_BASS = [0, 0, 12, 0, 0, 12, 0, 7];
const BATTLE_CALL: readonly Note[] = [
  [62, 16], [69, 8], [65, 8], [70, 16], [72, 8], [69, 8],
  [74, 16], [72, 8], [69, 8], [70, 8], [67, 8], [69, 12], [null, 4],
];

const BATTLE = song(BATTLE_STEP, 8 * 16, 16, (at) => {
  melody(at, BATTLE_CALL, BATTLE_STEP, (midi, seconds) => brass(midi, seconds, 0.035));
  BATTLE_ROOTS.forEach((root, bar) => {
    const start = bar * 16;
    BATTLE_BASS.forEach((offset, i) => at(start + i * 2, growl(root + offset, 0.2, 0.12)));
    at(start, stomp(0.3));
    at(start + 8, stomp(0.3));
    if (bar % 2 === 1) at(start + 6, stomp(0.18));
    at(start + 4, snare(0.09));
    at(start + 12, snare(0.09));
    for (let i = 0; i < 16; i += 2) at(start + i, tick(0.018));
  });
  // A drum roll into the top of the loop.
  for (const step of [8 * 16 - 3, 8 * 16 - 2, 8 * 16 - 1]) at(step, snare(0.07));
});

const SONGS: Record<Track, Song> = { menu: MENU, battle: BATTLE };

// ---------- Player ----------

interface Player {
  track: Track;
  bus: GainNode;
  timer: number;
  // Audio-clock time of the next step not yet scheduled.
  nextTime: number;
  step: number;
  // Stop scheduling notes after this time (set once the player is fading out).
  until: number;
}

let enabled = true;
let unlocked = false;
let wanted: Track | null = null;
let playing: Player | null = null;
let updateQueued = false;

function schedule(ac: AudioContext, player: Player): void {
  const song = SONGS[player.track];
  // After a stall (a busy page or a sleeping laptop), pick up from now instead of rushing to catch up.
  if (player.nextTime < ac.currentTime) player.nextTime = ac.currentTime + 0.05;
  while (player.nextTime < ac.currentTime + LOOKAHEAD_SECONDS && player.nextTime < player.until) {
    for (const play of song.events.get(player.step) ?? []) play(ac, player.nextTime, player.bus);
    player.nextTime += song.stepSeconds;
    player.step = (player.step + 1) % song.steps;
  }
}

// When the playing tune next reaches the start of a bar, at most one bar away.
function nextDownbeat(ac: AudioContext, player: Player): number {
  const song = SONGS[player.track];
  const stepsLeft = (song.barSteps - (player.step % song.barSteps)) % song.barSteps;
  return Math.max(ac.currentTime + 0.05, player.nextTime + stepsLeft * song.stepSeconds);
}

// Keeps the player going until `from`, then fades it out over `seconds` and lets it go.
function fadeOut(ac: AudioContext, player: Player, from: number, seconds: number): void {
  const gain = player.bus.gain;
  const now = ac.currentTime;
  const level = gain.value;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(level, now);
  gain.setValueAtTime(level, Math.max(now, from));
  gain.linearRampToValueAtTime(0, Math.max(now, from) + seconds);
  player.until = from + seconds;
  window.setTimeout(() => {
    window.clearInterval(player.timer);
    player.bus.disconnect();
  }, (from + seconds - now + LOOKAHEAD_SECONDS + 0.3) * 1000);
}

function begin(ac: AudioContext, track: Track, at: number): Player {
  const bus = ac.createGain();
  bus.gain.setValueAtTime(0, at);
  bus.gain.linearRampToValueAtTime(VOLUME, at + FADE_IN_SECONDS);
  bus.connect(ac.destination);
  const player: Player = { track, bus, timer: 0, nextTime: at, step: 0, until: Infinity };
  player.timer = window.setInterval(() => schedule(ac, player), TICK_MS);
  schedule(ac, player);
  return player;
}

function update(): void {
  updateQueued = false;
  try {
    const desired = enabled && unlocked && !document.hidden ? wanted : null;
    if ((playing?.track ?? null) === desired) return;
    const ac = context();
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume();
    const old = playing;
    playing = null;
    if (!desired) {
      if (old) fadeOut(ac, old, ac.currentTime, STOP_SECONDS);
      return;
    }
    // Start the new tune on the old one's next downbeat, as the old one begins to fade.
    const at = old ? nextDownbeat(ac, old) : ac.currentTime + 0.1;
    if (old) fadeOut(ac, old, at, FADE_OUT_SECONDS);
    playing = begin(ac, desired, at);
  } catch {
    // Music is optional: never let it break the game.
  }
}

// Screens often change the track twice in a row (show, then refine). Only the last choice counts.
function queueUpdate(): void {
  if (updateQueued) return;
  updateQueued = true;
  queueMicrotask(update);
}

export function setMusicTrack(track: Track | null): void {
  wanted = track;
  queueUpdate();
}

export function setMusicEnabled(on: boolean): void {
  enabled = on;
  queueUpdate();
}

// Browsers only allow sound after the player interacts with the page.
export function unlockMusic(): void {
  if (unlocked) return;
  unlocked = true;
  queueUpdate();
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', queueUpdate);
