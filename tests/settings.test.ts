import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings, loadSettings, parseSettings, saveSettings } from '../src/ui/settings';

// Tests run in plain Node, so give the module a minimal window.localStorage.
const host = globalThis as { window?: unknown };
const originalWindow = host.window;

function stubStorage(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  host.window = { localStorage: storage };
}

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

const failing = () => {
  throw new Error('storage blocked');
};

afterEach(() => {
  if (originalWindow === undefined) delete host.window;
  else host.window = originalWindow;
});

describe('settings storage', () => {
  it('loads what was saved', () => {
    stubStorage(memoryStorage());
    const choice: Settings = { difficulty: 'hard', computerSpeed: 'slow', animations: false, gridLabels: true, sound: false };
    saveSettings(choice);
    expect(loadSettings()).toEqual(choice);
  });

  it('loads the defaults when nothing is saved', () => {
    stubStorage(memoryStorage());
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps the defaults intact when loaded settings are changed', () => {
    stubStorage({ getItem: failing, setItem: failing });
    const loaded = loadSettings();
    loaded.sound = false;
    expect(DEFAULT_SETTINGS.sound).toBe(true);
  });

  it('falls back to the defaults when storage throws', () => {
    stubStorage({ getItem: failing, setItem: failing });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings({ ...DEFAULT_SETTINGS, sound: false })).not.toThrow();
  });

  it('survives having no storage at all', () => {
    delete host.window;
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });

  it('repairs a corrupt saved value on load', () => {
    const storage = memoryStorage();
    stubStorage(storage);
    saveSettings(DEFAULT_SETTINGS);
    const [key] = storage.items.keys();
    storage.items.set(key, '{"computerSpeed":"fast","sound":"maybe"');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    storage.items.set(key, '{"computerSpeed":"fast","sound":"maybe"}');
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, computerSpeed: 'fast' });
  });
});

describe('parseSettings', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('reads saved choices', () => {
    const saved = { difficulty: 'hard', computerSpeed: 'fast', animations: false, gridLabels: false, sound: false };
    expect(parseSettings(JSON.stringify(saved))).toEqual(saved);
  });

  it('fills in anything missing', () => {
    expect(parseSettings('{"animations":false}')).toEqual({ ...DEFAULT_SETTINGS, animations: false });
  });

  it('ignores invalid values', () => {
    const saved = { difficulty: 'impossible', computerSpeed: 'warp', animations: 'no', gridLabels: 1, sound: 'loud' };
    expect(parseSettings(JSON.stringify(saved))).toEqual(DEFAULT_SETTINGS);
  });

  it('survives corrupt data', () => {
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1]')).toEqual(DEFAULT_SETTINGS);
  });
});
