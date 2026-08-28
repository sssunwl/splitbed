import { beforeAll, describe, expect, it } from 'vitest';

import type { Bed, Property, Room } from '../src/engine/types';
import {
  comparePolicies,
  type ComparisonResult,
  type SimulationPolicy,
} from '../src/sim/compare';
import {
  DEFAULT_DEMAND_CONFIG,
  generateDemand,
  type SimBooking,
} from '../src/sim/demand';
import { replay } from '../src/sim/replay';
import { makeRng } from '../src/sim/rng';

const property: Property = {
  id: 'property-1',
  name: 'Test',
  defaultPolicy: 'same_gender',
  pendingPolicy: null,
  pendingPolicyFrom: null,
};

function roomsFor(policy: SimulationPolicy): Room[] {
  return ['A', 'B', 'C', 'D'].map((code, index) => ({
    id: `room-${code}`,
    propertyId: property.id,
    code,
    roomType:
      policy === 'mixed' || (policy === 'hybrid' && code === 'B')
        ? 'mixed'
        : 'same_gender',
    sortOrder: index,
  }));
}

function sapporoBeds(): Bed[] {
  const capacities = [
    ['A', 2],
    ['B', 4],
    ['C', 3],
    ['D', 3],
  ] as const;
  return capacities.flatMap(([code, count]) =>
    Array.from({ length: count }, (_, index) => ({
      id: `room-${code}-bed-${index}`,
      roomId: `room-${code}`,
      code: `${index + 1}`,
      position: 'single' as const,
      outOfServiceFrom: null,
      outOfServiceTo: null,
    })),
  );
}

function row(
  result: ComparisonResult,
  demandRatio: number,
  policy: SimulationPolicy,
) {
  const found = result.rows.find(
    (item) => item.demandRatio === demandRatio && item.policy === policy,
  );
  if (found === undefined) {
    throw new Error(`Missing comparison row: ${demandRatio} ${policy}`);
  }
  return found;
}

describe('simulation RNG and demand', () => {
  it('returns exactly the same sequence and demand for the same seed', () => {
    const rngA = makeRng(42);
    const rngB = makeRng(42);
    expect(Array.from({ length: 20 }, () => rngA())).toEqual(
      Array.from({ length: 20 }, () => rngB()),
    );
    const demandA = generateDemand(DEFAULT_DEMAND_CONFIG, 42);
    const demandB = generateDemand(DEFAULT_DEMAND_CONFIG, 42);
    expect(demandA).toEqual(demandB);
    expect(
      replay(demandA, roomsFor('same_gender'), sapporoBeds(), 'same_gender', property),
    ).toEqual(
      replay(demandB, roomsFor('same_gender'), sapporoBeds(), 'same_gender', property),
    );
  });

  it('returns different demand for different seeds', () => {
    const demandA = generateDemand(DEFAULT_DEMAND_CONFIG, 1);
    const demandB = generateDemand(DEFAULT_DEMAND_CONFIG, 2);
    expect(demandA).not.toEqual(demandB);
    expect(
      replay(demandA, roomsFor('mixed'), sapporoBeds(), 'mixed', property),
    ).not.toEqual(
      replay(demandB, roomsFor('mixed'), sapporoBeds(), 'mixed', property),
    );
  });

  it('passes identical booking data to all three policies without mutation', () => {
    const bookings = generateDemand(
      { ...DEFAULT_DEMAND_CONFIG, demandRatio: 0.7 },
      7,
    );
    const snapshots: SimBooking[][] = [];
    for (const policy of ['same_gender', 'hybrid', 'mixed'] as const) {
      replay(bookings, roomsFor(policy), sapporoBeds(), policy, property);
      snapshots.push(structuredClone(bookings));
    }
    expect(snapshots[1]).toEqual(snapshots[0]);
    expect(snapshots[2]).toEqual(snapshots[0]);
  });

  it('skips cancelled and no-show bookings without occupancy or lost demand', () => {
    const generated = generateDemand(DEFAULT_DEMAND_CONFIG, 12);
    const skipped: SimBooking[] = [
      { ...generated[0], cancelled: true },
      { ...generated[1], noShow: true },
    ];
    const result = replay(
      skipped,
      roomsFor('mixed'),
      sapporoBeds(),
      'mixed',
      property,
    );
    expect(result.placements).toEqual([]);
    expect(result.requestedBedNights).toBe(0);
    expect(result.soldBedNights).toBe(0);
    expect(result.lostBookingIds).toEqual([]);
  });
});

describe('simulation policy relationships', () => {
  let comparison: ComparisonResult;

  beforeAll(() => {
    comparison = comparePolicies(30);
  });

  it('has mixed revenue above hybrid above same_gender at every demand level', () => {
    for (const demandRatio of [0.7, 0.85, 1, 1.15, 1.3]) {
      const same = row(comparison, demandRatio, 'same_gender').revenue.mean;
      const hybrid = row(comparison, demandRatio, 'hybrid').revenue.mean;
      const mixed = row(comparison, demandRatio, 'mixed').revenue.mean;
      expect(mixed).toBeGreaterThan(hybrid);
      expect(hybrid).toBeGreaterThan(same);
    }
  });

  it('keeps mixed stranded bed-nights exactly zero', () => {
    for (const demandRatio of [0.7, 0.85, 1, 1.15, 1.3]) {
      expect(row(comparison, demandRatio, 'mixed').strandedBedNights.mean).toBe(0);
    }
  });

  it('keeps hybrid stranded bed-nights near one-half to three-fifths of same_gender', () => {
    for (const demandRatio of [0.7, 0.85, 1, 1.15, 1.3]) {
      const same = row(comparison, demandRatio, 'same_gender').strandedBedNights.mean;
      const hybrid = row(comparison, demandRatio, 'hybrid').strandedBedNights.mean;
      expect(hybrid / same).toBeGreaterThan(0.45);
      expect(hybrid / same).toBeLessThan(0.7);
    }
  });

  it('has forced splits ordered same_gender above hybrid above mixed', () => {
    for (const demandRatio of [0.7, 0.85, 1, 1.15, 1.3]) {
      const same = row(comparison, demandRatio, 'same_gender').forcedSplits.mean;
      const hybrid = row(comparison, demandRatio, 'hybrid').forcedSplits.mean;
      const mixed = row(comparison, demandRatio, 'mixed').forcedSplits.mean;
      expect(same).toBeGreaterThan(hybrid);
      expect(hybrid).toBeGreaterThan(mixed);
    }
  });

  it('grows the mixed revenue advantage as demand rises', () => {
    const lowGap =
      row(comparison, 0.7, 'mixed').revenue.mean -
      row(comparison, 0.7, 'same_gender').revenue.mean;
    const highGap =
      row(comparison, 1.3, 'mixed').revenue.mean -
      row(comparison, 1.3, 'same_gender').revenue.mean;
    expect(highGap).toBeGreaterThan(lowGap);
  });
});

describe('simulation KPI', () => {
  it('counts 10 stranded bed-nights for one guest in a three-bed room for five nights', () => {
    const testRoom: Room = {
      id: 'room-a',
      propertyId: property.id,
      code: 'A',
      roomType: 'same_gender',
      sortOrder: 0,
    };
    const testBeds: Bed[] = Array.from({ length: 3 }, (_, index) => ({
      id: `bed-${index}`,
      roomId: testRoom.id,
      code: `${index + 1}`,
      position: 'single',
      outOfServiceFrom: null,
      outOfServiceTo: null,
    }));
    const booking: SimBooking = {
      id: 'booking-1',
      propertyId: property.id,
      reference: 'booking-1',
      source: 'direct',
      bookedAt: '2025-12-20',
      checkIn: '2026-01-01',
      checkOut: '2026-01-06',
      status: 'confirmed_unassigned',
      cancelled: false,
      noShow: false,
      totalValue: 25_000,
      currency: 'JPY',
      mustStayTogether: false,
      requiresPrivateRoom: false,
      priority: 0,
      notes: '',
      guests: [
        {
          id: 'guest-1',
          bookingId: 'booking-1',
          name: 'Guest',
          gender: 'female',
          birthYear: null,
          accessibilityNeed: false,
          checkIn: '2026-01-01',
          checkOut: '2026-01-06',
        },
      ],
    };
    const result = replay(
      [booking],
      [testRoom],
      testBeds,
      'same_gender',
      property,
    );
    expect(result.strandedBedNights).toBe(10);
  });
});
