export type ComputerSpeed = 'slow' | 'normal' | 'fast';

export interface Settings {
  computerSpeed: ComputerSpeed;
  animations: boolean;
  gridLabels: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  computerSpeed: 'normal',
  animations: true,
  gridLabels: true,
};

export const COMPUTER_DELAY_MS: Readonly<Record<ComputerSpeed, number>> = {
  slow: 1800,
  normal: 1000,
  fast: 300,
};

const STORAGE_KEY = 'battleship-settings';

// Falls back to the default for anything missing or invalid in saved data.
export function parseSettings(raw: string | null): Settings {
  let saved: Partial<Record<keyof Settings, unknown>> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (parsed && typeof parsed === 'object') saved = parsed;
  } catch {
    // Corrupt data: keep the defaults.
  }
  const speed = saved.computerSpeed;
  return {
    computerSpeed:
      speed === 'slow' || speed === 'normal' || speed === 'fast' ? speed : DEFAULT_SETTINGS.computerSpeed,
    animations: typeof saved.animations === 'boolean' ? saved.animations : DEFAULT_SETTINGS.animations,
    gridLabels: typeof saved.gridLabels === 'boolean' ? saved.gridLabels : DEFAULT_SETTINGS.gridLabels,
  };
}

// Browser storage can be blocked, for example in a private window. The game still works without it.
export function loadSettings(): Settings {
  try {
    return parseSettings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Choices then last only until the page is closed.
  }
}
