import { describe, expect, it } from 'vitest';
import { MatchStats, accuracy, formatDuration, isFlawless } from '../src/game/stats';
import { parseGoldAnchors, parseRecord } from '../src/ui/record';

describe('MatchStats', () => {
  it('counts shots, hits, sinks and the longest run of hits for each side', () => {
    const stats = new MatchStats(0);
    for (const result of ['hit', 'hit', 'sunk', 'miss', 'hit'] as const) stats.record(0, result);
    stats.record(1, 'miss');
    expect(stats.sides[0]).toEqual({ shots: 5, hits: 4, sunk: 1, longestStreak: 3 });
    expect(stats.sides[1]).toEqual({ shots: 1, hits: 0, sunk: 0, longestStreak: 0 });
    expect(accuracy(stats.sides[0])).toBe(80);
    expect(accuracy(stats.sides[1])).toBe(0);
  });

  it('times the match until it is finished', () => {
    const stats = new MatchStats(1_000);
    expect(stats.durationSeconds(4_000)).toBe(3);
    stats.finish(66_000);
    expect(stats.durationSeconds(999_000)).toBe(65);
    expect(formatDuration(65)).toBe('1:05');
  });

  it('reports 0% accuracy before any shots', () => {
    expect(accuracy({ shots: 0, hits: 0, sunk: 0, longestStreak: 0 })).toBe(0);
  });
});

describe('parseRecord', () => {
  const zero = { wins: 0, losses: 0 };

  it('starts every tally at zero', () => {
    expect(parseRecord(null)).toEqual({ easy: zero, normal: zero, hard: zero, online: zero });
  });

  it('reads saved tallies and ignores bad values', () => {
    const saved = { hard: { wins: 3, losses: 1 }, easy: { wins: -2, losses: 'x' }, online: 5 };
    expect(parseRecord(JSON.stringify(saved))).toEqual({
      easy: zero,
      normal: zero,
      hard: { wins: 3, losses: 1 },
      online: zero,
    });
  });

  it('survives corrupt data', () => {
    expect(parseRecord('not json').normal).toEqual(zero);
    expect(parseRecord('[1,2]').hard).toEqual(zero);
  });
});

describe('Gold Anchor', () => {
  it('is earned only when every shot hit', () => {
    const perfect = new MatchStats(0);
    for (let i = 0; i < 16; i++) perfect.record(0, 'hit');
    perfect.record(0, 'sunk');
    expect(isFlawless(perfect.sides[0])).toBe(true);

    const oneMiss = new MatchStats(0);
    oneMiss.record(0, 'miss');
    for (let i = 0; i < 17; i++) oneMiss.record(0, 'hit');
    expect(isFlawless(oneMiss.sides[0])).toBe(false);
  });

  it('is not earned without firing', () => {
    expect(isFlawless(new MatchStats(0).sides[0])).toBe(false);
  });

  it('reads the saved count and ignores bad values', () => {
    expect(parseGoldAnchors(null)).toBe(0);
    expect(parseGoldAnchors('3')).toBe(3);
    expect(parseGoldAnchors('-1')).toBe(0);
    expect(parseGoldAnchors('1.5')).toBe(0);
    expect(parseGoldAnchors('lots')).toBe(0);
  });
});
