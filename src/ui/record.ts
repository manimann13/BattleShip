import type { Difficulty } from '../ai/computer';

// Wins and losses kept in this browser: one tally per computer difficulty, plus online.
export type RecordKey = Difficulty | 'online';

export interface Tally {
  wins: number;
  losses: number;
}

export type PlayerRecord = Record<RecordKey, Tally>;

const KEYS: readonly RecordKey[] = ['easy', 'normal', 'hard', 'online'];
const STORAGE_KEY = 'battleship-record';

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

// Anything missing or invalid counts as zero.
export function parseRecord(raw: string | null): PlayerRecord {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>;
  } catch {
    // Corrupt data: start again from zero.
  }
  const record = {} as PlayerRecord;
  for (const key of KEYS) {
    const tally = saved[key] as Partial<Record<keyof Tally, unknown>> | undefined;
    record[key] = {
      wins: isCount(tally?.wins) ? tally.wins : 0,
      losses: isCount(tally?.losses) ? tally.losses : 0,
    };
  }
  return record;
}

export function loadRecord(): PlayerRecord {
  try {
    return parseRecord(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseRecord(null);
  }
}

// Adds one result and returns the updated tally for that key.
export function addResult(key: RecordKey, won: boolean): Tally {
  const record = loadRecord();
  if (won) record[key].wins++;
  else record[key].losses++;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage blocked: the tally lasts only for this result.
  }
  return record[key];
}

// Gold Anchors: wins with 85% accuracy or better. Just a count, kept in this browser.
const GOLD_KEY = 'battleship-gold-anchors';

export function parseGoldAnchors(raw: string | null): number {
  const value = Number(raw ?? 0);
  return isCount(value) ? value : 0;
}

export function loadGoldAnchors(): number {
  try {
    return parseGoldAnchors(window.localStorage.getItem(GOLD_KEY));
  } catch {
    return 0;
  }
}

// Adds one Gold Anchor and returns the new total.
export function addGoldAnchor(): number {
  const total = loadGoldAnchors() + 1;
  try {
    window.localStorage.setItem(GOLD_KEY, String(total));
  } catch {
    // Storage blocked: the badge still shows for this game.
  }
  return total;
}
