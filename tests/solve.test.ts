import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { capacity } from '../src/engine/capacity';
import { eachNight } from '../src/engine/dates';
import { resolvePolicy } from '../src/engine/policy';
import {
  solve,
  type AllocationProblem,
  type SolveOptions,
  type SolveResult,
} from '../src/engine/solve';
import type { Assignment, Bed, Booking, Guest, Room } from '../src/engine/types';

const defaultOptions: SolveOptions = {
  weights: {
    reject: 1_000,
    stability: 120,
    strand: 10,
    fragment: 3,
    priority: 50,
  },
  maxPasses: 20,
  seed: 42,
  allowReject: true,
};

function room(
  id: string,
  sortOrder: number,
  roomType: Room['roomType'] = null,
): Room {
  return { id, propertyId: 'property-1', code: id, roomType, sortOrder };
}

function beds(roomId: string, count: number): Bed[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${roomId}-bed-${index}`,
    roomId,
    code: `${index + 1}`,
    position: 'single' as const,
    outOfServiceFrom: null,
    outOfServiceTo: null,
  }));
}

function booking(
  id: string,
  overrides: Partial<Booking> = {},
): Booking {
  return {
    id,
    propertyId: 'property-1',
    reference: id,
    source: 'direct',
    bookedAt: '2026-01-01',
    checkIn: '2026-01-01',
    checkOut: '2026-01-04',
    status: 'confirmed_unassigned',
    cancelled: false,
    noShow: false,
    totalValue: 100,
    currency: 'JPY',
    mustStayTogether: true,
    requiresPrivateRoom: false,
    priority: 0,
    notes: '',
    ...overrides,
  };
}

function guest(
  id: string,
  bookingId: string,
  gender: Guest['gender'] = 'female',
  checkIn = '2026-01-01',
  checkOut = '2026-01-04',
): Guest {
  return {
    id,
    bookingId,
    name: id,
    gender,
    birthYear: null,
    accessibilityNeed: false,
    checkIn,
    checkOut,
  };
}

function assignment(
  guestId: string,
  roomId: string,
  lockLevel: Assignment['lockLevel'],
): Assignment {
  return {
    id: `assignment-${guestId}`,
    guestId,
    roomId,
    bedId: null,
    dateFrom: '2026-01-01',
    dateTo: '2026-01-04',
    lockLevel,
    isCurrent: true,
    createdBy: 'staff',
  };
}

function problem(
  rooms: Room[],
  allBeds: Bed[],
  bookings: Booking[],
  guests: Guest[],
  currentAssignments: Assignment[] = [],
  defaultPolicy: AllocationProblem['property']['defaultPolicy'] = 'same_gender',
  horizonFrom = '2026-01-01',
  horizonTo = '2026-01-05',
): AllocationProblem {
  return {
    property: {
      id: 'property-1',
      name: 'Test',
      defaultPolicy,
      pendingPolicy: null,
      pendingPolicyFrom: null,
    },
    rooms,
    beds: allBeds,
    bookings,
    guests,
    currentAssignments,
    horizonFrom,
    horizonTo,
  };
}

function validateCapacityAndGender(
  allocationProblem: AllocationProblem,
  result: SolveResult,
): void {
  const guestById = new Map(allocationProblem.guests.map((item) => [item.id, item]));
  for (const testRoom of allocationProblem.rooms) {
    for (const date of eachNight(allocationProblem.horizonFrom, allocationProblem.horizonTo)) {
      const occupants = result.placements
        .filter((placement) => placement.roomId === testRoom.id)
        .map((placement) => guestById.get(placement.guestId))
        .filter(
          (item): item is Guest =>
            item !== undefined && item.checkIn <= date && date < item.checkOut,
        );
      expect(occupants.length).toBeLessThanOrEqual(
        capacity(testRoom.id, allocationProblem.beds, date),
      );
      if (resolvePolicy(testRoom, allocationProblem.property, date) === 'same_gender') {
        expect(
          occupants.some((item) => item.gender === 'male') &&
            occupants.some((item) => item.gender === 'female'),
        ).toBe(false);
      }
    }
  }
}

describe('solve', () => {
  it('is deterministic for the same problem and seed', () => {
    const roomA = room('room-a', 1);
    const roomB = room('room-b', 2);
    const bookings = [booking('booking-a'), booking('booking-b'), booking('booking-c')];
    const guests = [
      guest('guest-a', 'booking-a', 'female'),
      guest('guest-b', 'booking-b', 'male'),
      guest('guest-c', 'booking-c', 'female'),
    ];
    const allocationProblem = problem(
      [roomA, roomB],
      [...beds(roomA.id, 2), ...beds(roomB.id, 2)],
      bookings,
      guests,
    );
    expect(solve(allocationProblem, defaultOptions)).toEqual(
      solve(allocationProblem, defaultOptions),
    );
  });

  it('places every guest at most once and never creates a room move', () => {
    const roomA = room('room-a', 1, 'mixed');
    const bookings = [booking('booking-a'), booking('booking-b')];
    const guests = [
      guest('guest-a', 'booking-a'),
      guest('guest-b', 'booking-b'),
    ];
    const result = solve(
      problem([roomA], beds(roomA.id, 2), bookings, guests),
      defaultOptions,
    );
    const guestIds = result.placements.map((placement) => placement.guestId);
    expect(new Set(guestIds).size).toBe(guestIds.length);
  });

  it('keeps a hard-locked guest in the current room', () => {
    const roomA = room('room-a', 1);
    const roomB = room('room-b', 2);
    const testBooking = booking('booking-a');
    const testGuest = guest('guest-a', testBooking.id);
    const allocationProblem = problem(
      [roomA, roomB],
      [...beds(roomA.id, 1), ...beds(roomB.id, 1)],
      [testBooking],
      [testGuest],
      [assignment(testGuest.id, roomB.id, 'hard')],
    );
    const result = solve(allocationProblem, defaultOptions);
    expect(result.placements).toContainEqual({ guestId: testGuest.id, roomId: roomB.id });
  });

  it('never exceeds nightly capacity or mixes genders in same_gender rooms', () => {
    const roomA = room('room-a', 1);
    const roomB = room('room-b', 2);
    const bookings = Array.from({ length: 6 }, (_, index) => booking(`booking-${index}`));
    const guests = bookings.map((item, index) =>
      guest(`guest-${index}`, item.id, index % 2 === 0 ? 'female' : 'male'),
    );
    const allocationProblem = problem(
      [roomA, roomB],
      [...beds(roomA.id, 2), ...beds(roomB.id, 2)],
      bookings,
      guests,
    );
    const result = solve(allocationProblem, defaultOptions);
    validateCapacityAndGender(allocationProblem, result);
  });

  it('records a forced split when a mixed-gender booking cannot stay together', () => {
    const roomA = room('room-a', 1);
    const roomB = room('room-b', 2);
    const testBooking = booking('booking-a', { mustStayTogether: false });
    const guests = [
      guest('guest-female', testBooking.id, 'female'),
      guest('guest-male', testBooking.id, 'male'),
    ];
    const result = solve(
      problem(
        [roomA, roomB],
        [...beds(roomA.id, 2), ...beds(roomB.id, 2)],
        [testBooking],
        guests,
      ),
      defaultOptions,
    );
    expect(result.rejectedBookingIds).toEqual([]);
    expect(result.forcedSplitBookingIds).toEqual([testBooking.id]);
  });

  it('improves a greedy allocation through local search', () => {
    const rooms = [
      room('room-0', 0, 'mixed'),
      room('room-1', 1, 'mixed'),
      room('room-2', 2, 'mixed'),
    ];
    const stays = [
      ['2026-01-05', '2026-01-07'],
      ['2026-01-04', '2026-01-06'],
      ['2026-01-03', '2026-01-05'],
      ['2026-01-05', '2026-01-09'],
      ['2026-01-03', '2026-01-09'],
      ['2026-01-02', '2026-01-04'],
      ['2026-01-02', '2026-01-06'],
      ['2026-01-02', '2026-01-04'],
    ] as const;
    const bookings = stays.map(([checkIn, checkOut], index) =>
      booking(`booking-${index}`, { checkIn, checkOut }),
    );
    const guests = stays.map(([checkIn, checkOut], index) =>
      guest(`guest-${index}`, `booking-${index}`, 'female', checkIn, checkOut),
    );
    const allocationProblem = problem(
      rooms,
      rooms.flatMap((item) => beds(item.id, 2)),
      bookings,
      guests,
      [],
      'mixed',
      '2026-01-01',
      '2026-01-09',
    );
    const options: SolveOptions = {
      weights: { reject: 1_000, stability: 0, strand: 0, fragment: 1, priority: 0 },
      maxPasses: 0,
      seed: 42,
      allowReject: true,
    };
    const greedy = solve(allocationProblem, options);
    const searched = solve(allocationProblem, { ...options, maxPasses: 20 });
    expect(greedy.breakdown.total).toBe(15);
    expect(searched.breakdown.total).toBe(14);
    expect(searched.breakdown.total).toBeLessThan(greedy.breakdown.total);
  });

  it('finds the hand-calculated full-capacity solution for four rooms and six guests', () => {
    const rooms = [
      room('room-a', 1),
      room('room-b', 2),
      room('room-c', 3),
      room('room-d', 4),
    ];
    const allBeds = [
      ...beds('room-a', 2),
      ...beds('room-b', 2),
      ...beds('room-c', 1),
      ...beds('room-d', 1),
    ];
    const bookings = Array.from({ length: 6 }, (_, index) =>
      booking(`booking-${index}`, { checkOut: '2026-01-03' }),
    );
    const guests = bookings.map((item, index) =>
      guest(`guest-${index}`, item.id, 'female', '2026-01-01', '2026-01-03'),
    );
    const allocationProblem = problem(
      rooms,
      allBeds,
      bookings,
      guests,
      [],
      'same_gender',
      '2026-01-01',
      '2026-01-03',
    );
    const result = solve(allocationProblem, {
      ...defaultOptions,
      weights: { reject: 1_000, stability: 0, strand: 10, fragment: 3, priority: 50 },
    });
    const occupancyByRoom = rooms
      .map((item) => result.placements.filter((placement) => placement.roomId === item.id).length)
      .sort((left, right) => left - right);
    expect(result.rejectedBookingIds).toEqual([]);
    expect(occupancyByRoom).toEqual([1, 1, 2, 2]);
    expect(result.breakdown.total).toBe(24);
  });

  it('reports the correct reason for every room when a booking cannot be placed', () => {
    const maintenanceRoom = room('room-maintenance', 1, 'maintenance');
    const femaleRoom = room('room-female', 2, 'female_only');
    const fullRoom = room('room-full', 3, 'mixed');
    const existingBooking = booking('booking-existing');
    const rejectedBooking = booking('booking-rejected');
    const existingGuest = guest('guest-existing', existingBooking.id, 'female');
    const rejectedGuest = guest('guest-rejected', rejectedBooking.id, 'male');
    const allocationProblem = problem(
      [maintenanceRoom, femaleRoom, fullRoom],
      [
        ...beds(maintenanceRoom.id, 1),
        ...beds(femaleRoom.id, 1),
        ...beds(fullRoom.id, 1),
      ],
      [existingBooking, rejectedBooking],
      [existingGuest, rejectedGuest],
      [assignment(existingGuest.id, fullRoom.id, 'hard')],
    );
    const result = solve(allocationProblem, defaultOptions);
    expect(result.rejectedBookingIds).toEqual([rejectedBooking.id]);
    expect(result.diagnostics).toEqual([
      {
        bookingId: rejectedBooking.id,
        perRoom: [
          { roomId: maintenanceRoom.id, reason: 'maintenance' },
          { roomId: femaleRoom.id, reason: 'female_only' },
          { roomId: fullRoom.id, reason: 'capacity' },
        ],
      },
    ]);
  });

  it('solves 200 guests across 30 rooms and 90 nights in under one second', () => {
    const rooms = Array.from({ length: 30 }, (_, index) =>
      room(`room-${String(index).padStart(2, '0')}`, index, 'mixed'),
    );
    const allBeds = rooms.flatMap((item) => beds(item.id, 8));
    const bookings = Array.from({ length: 200 }, (_, index) =>
      booking(`booking-${String(index).padStart(3, '0')}`, {
        checkIn: '2026-01-01',
        checkOut: '2026-04-01',
      }),
    );
    const guests = bookings.map((item, index) =>
      guest(
        `guest-${String(index).padStart(3, '0')}`,
        item.id,
        index % 2 === 0 ? 'female' : 'male',
        '2026-01-01',
        '2026-04-01',
      ),
    );
    const allocationProblem = problem(
      rooms,
      allBeds,
      bookings,
      guests,
      [],
      'mixed',
      '2026-01-01',
      '2026-04-01',
    );
    const startedAt = performance.now();
    const result = solve(allocationProblem, defaultOptions);
    const elapsedMs = performance.now() - startedAt;
    expect(result.placements).toHaveLength(200);
    expect(elapsedMs).toBeLessThan(1_000);
  });
});
