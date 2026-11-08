import { type MatchStats, accuracy, formatDuration } from '../game/stats';
import { button, h, icon } from './dom';
import type { Tally } from './record';
import { type Settings, saveSettings } from './settings';

// End-of-game table comparing both sides, with an optional saved win/loss line.
export function statsPanel(
  stats: MatchStats,
  names: readonly [string, string],
  record?: { label: string; tally: Tally },
): HTMLElement {
  const [a, b] = stats.sides;
  const rows: [string, string, string][] = [
    ['Shots', String(a.shots), String(b.shots)],
    ['Hits', String(a.hits), String(b.hits)],
    ['Accuracy', `${accuracy(a)}%`, `${accuracy(b)}%`],
    ['Ships sunk', String(a.sunk), String(b.sunk)],
    ['Longest hit streak', String(a.longestStreak), String(b.longestStreak)],
  ];
  const header = h('tr', '', h('th', '', ''), h('th', '', names[0]), h('th', '', names[1]));
  const body = rows.map(([label, left, right]) =>
    h('tr', '', h('th', '', label), h('td', '', left), h('td', '', right)),
  );
  const table = h('table', 'stats-table', h('thead', '', header), h('tbody', '', ...body));
  table.setAttribute('aria-label', 'Match stats');

  const footer = h('p', 'stats-footer', `Time played: ${formatDuration(stats.durationSeconds())}`);
  if (record) {
    footer.append(
      h('br'),
      `${record.label}: ${record.tally.wins} ${record.tally.wins === 1 ? 'win' : 'wins'}, ${record.tally.losses} ${
        record.tally.losses === 1 ? 'loss' : 'losses'
      }`,
    );
  }
  return h('section', 'panel stats', h('h2', 'subheading', 'Match Stats'), table, footer);
}

// Small sound toggle for the battle screens. Saves straight away and updates itself in place.
export function muteButton(settings: Settings): HTMLButtonElement {
  const element = button('', () => {
    settings.sound = !settings.sound;
    saveSettings(settings);
    update();
  }, 'btn-small btn-quiet btn-icon');
  const update = () => {
    const label = settings.sound ? 'Mute sound' : 'Unmute sound';
    element.replaceChildren(icon(settings.sound ? 'icon-sound-on' : 'icon-sound-off', 'icon'));
    element.setAttribute('aria-label', label);
    element.title = label;
  };
  update();
  return element;
}
