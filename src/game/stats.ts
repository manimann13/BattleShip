import type { ShotResult } from './types';

export interface ShooterStats {
  shots: number;
  hits: number;
  sunk: number;
  longestStreak: number;
}

// Counts each side's shots during one match. Side 0 is always the local player (or Player 1).
export class MatchStats {
  readonly sides: [ShooterStats, ShooterStats] = [emptyStats(), emptyStats()];
  private readonly streaks: [number, number] = [0, 0];
  readonly startedAt: number;
  endedAt: number | null = null;

  constructor(now: number = Date.now()) {
    this.startedAt = now;
  }

  record(side: 0 | 1, result: ShotResult): void {
    const stats = this.sides[side];
    stats.shots++;
    if (result === 'miss') {
      this.streaks[side] = 0;
      return;
    }
    stats.hits++;
    if (result === 'sunk') stats.sunk++;
    this.streaks[side]++;
    stats.longestStreak = Math.max(stats.longestStreak, this.streaks[side]);
  }

  finish(now: number = Date.now()): void {
    this.endedAt ??= now;
  }

  // Whole seconds from the first turn to the end (or to now, if still playing).
  durationSeconds(now: number = Date.now()): number {
    return Math.max(0, Math.round(((this.endedAt ?? now) - this.startedAt) / 1000));
  }
}

function emptyStats(): ShooterStats {
  return { shots: 0, hits: 0, sunk: 0, longestStreak: 0 };
}

// Whole-number percentage, or 0 before the first shot.
export function accuracy(stats: ShooterStats): number {
  return stats.shots === 0 ? 0 : Math.round((stats.hits / stats.shots) * 100);
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
