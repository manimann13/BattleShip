import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../src/ui/settings';

describe('parseSettings', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('reads saved choices', () => {
    const saved = { computerSpeed: 'fast', animations: false, gridLabels: false };
    expect(parseSettings(JSON.stringify(saved))).toEqual(saved);
  });

  it('fills in anything missing', () => {
    expect(parseSettings('{"animations":false}')).toEqual({ ...DEFAULT_SETTINGS, animations: false });
  });

  it('ignores invalid values', () => {
    const saved = { computerSpeed: 'warp', animations: 'no', gridLabels: 1 };
    expect(parseSettings(JSON.stringify(saved))).toEqual(DEFAULT_SETTINGS);
  });

  it('survives corrupt data', () => {
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1]')).toEqual(DEFAULT_SETTINGS);
  });
});
