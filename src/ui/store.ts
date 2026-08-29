export interface RoomSpec {
  code: string;
  beds: number;
  mixed: boolean;
}

export interface SiteConfig {
  siteName: string;
  rooms: RoomSpec[];
  nightlyRate: number;
  seasonNights: number;
}

const STORAGE_KEY = 'splitbed.config.v1';

const DEFAULT_CONFIG: SiteConfig = {
  siteName: '札幌',
  rooms: [
    { code: 'A', beds: 2, mixed: false },
    { code: 'B', beds: 4, mixed: true },
    { code: 'C', beds: 3, mixed: false },
    { code: 'D', beds: 3, mixed: false },
  ],
  nightlyRate: 5_000,
  seasonNights: 90,
};

function defaultConfig(): SiteConfig {
  return {
    ...DEFAULT_CONFIG,
    rooms: DEFAULT_CONFIG.rooms.map((room) => ({ ...room })),
  };
}

function isRoomSpec(value: unknown): value is RoomSpec {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const room = value as Partial<RoomSpec>;
  return (
    typeof room.code === 'string' &&
    typeof room.beds === 'number' &&
    Number.isFinite(room.beds) &&
    typeof room.mixed === 'boolean'
  );
}

function isSiteConfig(value: unknown): value is SiteConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const config = value as Partial<SiteConfig>;
  return (
    typeof config.siteName === 'string' &&
    Array.isArray(config.rooms) &&
    config.rooms.every(isRoomSpec) &&
    typeof config.nightlyRate === 'number' &&
    Number.isFinite(config.nightlyRate) &&
    typeof config.seasonNights === 'number' &&
    Number.isFinite(config.seasonNights)
  );
}

/** Loads the saved site configuration, or the Sapporo defaults when unavailable. */
export function loadConfig(): SiteConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) {
      return defaultConfig();
    }
    const parsed: unknown = JSON.parse(saved);
    if (!isSiteConfig(parsed)) {
      return defaultConfig();
    }
    return {
      ...parsed,
      rooms: parsed.rooms.map((room) => ({ ...room })),
    };
  } catch {
    return defaultConfig();
  }
}

/** Saves the site configuration when browser storage is available. */
export function saveConfig(config: SiteConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // The current page remains usable when storage is unavailable.
  }
}

/** Removes the saved configuration when browser storage is available. */
export function resetConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A blocked storage API already behaves like an empty store.
  }
}
