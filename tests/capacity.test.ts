import { describe, expect, it } from 'vitest';

import { capacity } from '../src/engine/capacity';
import type { Bed, ISODate } from '../src/engine/types';

const beds: readonly Bed[] = [
  {
    id: 'a-1',
    roomId: 'room-a',
    code: '1',
    position: 'lower',
    outOfServiceFrom: null,
    outOfServiceTo: null,
  },
  {
    id: 'a-2',
    roomId: 'room-a',
    code: '2',
    position: 'upper',
    outOfServiceFrom: '2026-01-10',
    outOfServiceTo: '2026-01-15',
  },
  {
    id: 'a-3',
    roomId: 'room-a',
    code: '3',
    position: 'single',
    outOfServiceFrom: '2026-01-20',
    outOfServiceTo: null,
  },
  {
    id: 'a-4',
    roomId: 'room-a',
    code: '4',
    position: 'single',
    outOfServiceFrom: null,
    outOfServiceTo: '2026-01-05',
  },
  {
    id: 'b-1',
    roomId: 'room-b',
    code: '1',
    position: 'single',
    outOfServiceFrom: null,
    outOfServiceTo: null,
  },
];

describe('capacity', () => {
  it.each<[ISODate, number]>([
    ['2026-01-01', 3],
    ['2026-01-04', 3],
    ['2026-01-05', 4],
    ['2026-01-09', 4],
    ['2026-01-10', 3],
    ['2026-01-14', 3],
    ['2026-01-15', 4],
    ['2026-01-19', 4],
    ['2026-01-20', 3],
  ])('returns the available capacity on %s', (date, expected) => {
    expect(capacity('room-a', beds, date)).toBe(expected);
  });

  it('ignores beds belonging to another room', () => {
    expect(capacity('room-a', beds.slice(4), '2026-01-01')).toBe(0);
  });

  it('returns zero when no beds are provided', () => {
    expect(capacity('room-a', [], '2026-01-01')).toBe(0);
  });
});
