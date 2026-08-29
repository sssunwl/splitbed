import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig, saveConfig, type SiteConfig } from '../src/ui/store';

const sapporoDefault: SiteConfig = {
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ui config store', () => {
  it('returns the Sapporo defaults when there is no saved config', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    expect(loadConfig()).toEqual(sapporoDefault);
  });

  it('reads back the same config after saving', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    const config: SiteConfig = {
      siteName: '我的旅舍',
      rooms: [{ code: '101', beds: 6, mixed: true }],
      nightlyRate: 6_800,
      seasonNights: 120,
    };
    saveConfig(config);
    expect(loadConfig()).toEqual(config);
  });

  it('returns the defaults when storage reads and writes throw', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => saveConfig(sapporoDefault)).not.toThrow();
    expect(loadConfig()).toEqual(sapporoDefault);
  });
});
