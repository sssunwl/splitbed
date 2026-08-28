import { describe, expect, it } from 'vitest';

import { canPlace } from '../src/engine/feasible';
import type { AllocationProblem } from '../src/engine/solve';
import { AllocationState } from '../src/engine/state';
import type { Bed, Booking, Guest, Room, RoomPolicy } from '../src/engine/types';

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
    checkOut: '2026-01-03',
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
  gender: Guest['gender'],
): Guest {
  return {
    id,
    bookingId,
    name: id,
    gender,
    birthYear: null,
    accessibilityNeed: false,
    checkIn: '2026-01-01',
    checkOut: '2026-01-03',
  };
}

function room(id: string, roomType: RoomPolicy | null = null): Room {
  return {
    id,
    propertyId: 'property-1',
    code: id,
    roomType,
    sortOrder: 1,
  };
}

function beds(roomId: string, count = 2): Bed[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${roomId}-bed-${index}`,
    roomId,
    code: `${index + 1}`,
    position: 'single' as const,
    outOfServiceFrom: null,
    outOfServiceTo: null,
  }));
}

function problem(
  rooms: Room[],
  bookings: Booking[],
  guests: Guest[],
  allBeds: Bed[],
  currentAssignments: AllocationProblem['currentAssignments'] = [],
): AllocationProblem {
  return {
    property: {
      id: 'property-1',
      name: 'Test',
      defaultPolicy: 'same_gender',
      pendingPolicy: null,
      pendingPolicyFrom: null,
    },
    rooms,
    beds: allBeds,
    bookings,
    guests,
    currentAssignments,
    horizonFrom: '2026-01-01',
    horizonTo: '2026-01-04',
  };
}

function resultFor(
  allocationProblem: AllocationProblem,
  roomId: string,
  guests: readonly Guest[],
) {
  const state = new AllocationState(allocationProblem);
  return canPlace(
    state,
    roomId,
    guests,
    allocationProblem.property,
    allocationProblem.rooms,
    allocationProblem.beds,
  );
}

describe('canPlace', () => {
  it.each([
    ['maintenance', 'maintenance'],
    ['manual_only', 'manual_only'],
  ] as const)('returns %s only for a %s room', (roomType, expected) => {
    const newBooking = booking('new');
    const newGuest = guest('new-guest', 'new', 'female');
    const testRoom = room('room-a', roomType);
    expect(resultFor(problem([testRoom], [newBooking], [newGuest], beds(testRoom.id)), testRoom.id, [newGuest])).toBe(
      expected,
    );
  });

  it('returns staff_only for a non-staff booking in a staff room', () => {
    const newBooking = booking('new', { source: 'direct' });
    const newGuest = guest('new-guest', 'new', 'female');
    const testRoom = room('room-a', 'staff');
    expect(resultFor(problem([testRoom], [newBooking], [newGuest], beds(testRoom.id)), testRoom.id, [newGuest])).toBe(
      'staff_only',
    );
  });

  it('returns female_only only when a male guest enters a female-only room', () => {
    const newBooking = booking('new');
    const newGuest = guest('new-guest', 'new', 'male');
    const testRoom = room('room-a', 'female_only');
    expect(resultFor(problem([testRoom], [newBooking], [newGuest], beds(testRoom.id)), testRoom.id, [newGuest])).toBe(
      'female_only',
    );
  });

  it('returns male_only only when a female guest enters a male-only room', () => {
    const newBooking = booking('new');
    const newGuest = guest('new-guest', 'new', 'female');
    const testRoom = room('room-a', 'male_only');
    expect(resultFor(problem([testRoom], [newBooking], [newGuest], beds(testRoom.id)), testRoom.id, [newGuest])).toBe(
      'male_only',
    );
  });

  it('returns capacity when the room is full', () => {
    const existingBooking = booking('existing');
    const newBooking = booking('new');
    const existingGuest = guest('existing-guest', 'existing', 'unspecified');
    const newGuest = guest('new-guest', 'new', 'unspecified');
    const testRoom = room('room-a', 'mixed');
    const allocationProblem = problem(
      [testRoom],
      [existingBooking, newBooking],
      [existingGuest, newGuest],
      beds(testRoom.id, 1),
    );
    const state = new AllocationState(allocationProblem);
    state.place(testRoom.id, [existingGuest]);
    expect(canPlace(state, testRoom.id, [newGuest], allocationProblem.property, allocationProblem.rooms, allocationProblem.beds)).toBe(
      'capacity',
    );
  });

  it('returns private_occupied when another booking occupies a private room', () => {
    const existingBooking = booking('existing');
    const newBooking = booking('new');
    const existingGuest = guest('existing-guest', 'existing', 'female');
    const newGuest = guest('new-guest', 'new', 'female');
    const testRoom = room('room-a', 'private');
    const allocationProblem = problem(
      [testRoom],
      [existingBooking, newBooking],
      [existingGuest, newGuest],
      beds(testRoom.id),
    );
    const state = new AllocationState(allocationProblem);
    state.place(testRoom.id, [existingGuest]);
    expect(canPlace(state, testRoom.id, [newGuest], allocationProblem.property, allocationProblem.rooms, allocationProblem.beds)).toBe(
      'private_occupied',
    );
  });

  it('returns requires_private when a private-requiring booking meets another booking', () => {
    const existingBooking = booking('existing');
    const newBooking = booking('new', { requiresPrivateRoom: true });
    const existingGuest = guest('existing-guest', 'existing', 'female');
    const newGuest = guest('new-guest', 'new', 'female');
    const testRoom = room('room-a', 'mixed');
    const allocationProblem = problem(
      [testRoom],
      [existingBooking, newBooking],
      [existingGuest, newGuest],
      beds(testRoom.id),
    );
    const state = new AllocationState(allocationProblem);
    state.place(testRoom.id, [existingGuest]);
    expect(canPlace(state, testRoom.id, [newGuest], allocationProblem.property, allocationProblem.rooms, allocationProblem.beds)).toBe(
      'requires_private',
    );
  });

  it('returns gender_conflict only when same_gender occupancy conflicts', () => {
    const femaleBooking = booking('female-booking');
    const maleBooking = booking('male-booking');
    const femaleGuest = guest('female-guest', 'female-booking', 'female');
    const maleGuest = guest('male-guest', 'male-booking', 'male');
    const testRoom = room('room-a');
    const allocationProblem = problem(
      [testRoom],
      [femaleBooking, maleBooking],
      [femaleGuest, maleGuest],
      beds(testRoom.id),
    );
    const state = new AllocationState(allocationProblem);
    state.place(testRoom.id, [femaleGuest]);
    expect(canPlace(state, testRoom.id, [maleGuest], allocationProblem.property, allocationProblem.rooms, allocationProblem.beds)).toBe(
      'gender_conflict',
    );
  });

  it('returns locked_elsewhere for a hard-locked guest', () => {
    const newBooking = booking('new');
    const newGuest = guest('new-guest', 'new', 'female');
    const roomA = room('room-a');
    const roomB = room('room-b');
    const allocationProblem = problem(
      [roomA, roomB],
      [newBooking],
      [newGuest],
      [...beds(roomA.id), ...beds(roomB.id)],
      [
        {
          id: 'assignment-1',
          guestId: newGuest.id,
          roomId: roomB.id,
          bedId: null,
          dateFrom: newGuest.checkIn,
          dateTo: newGuest.checkOut,
          lockLevel: 'hard',
          isCurrent: true,
          createdBy: 'staff',
        },
      ],
    );
    expect(resultFor(allocationProblem, roomA.id, [newGuest])).toBe('locked_elsewhere');
  });

  it('allows unspecified guests into a room with no gender lock', () => {
    const newBooking = booking('new');
    const newGuest = guest('new-guest', 'new', 'unspecified');
    const testRoom = room('room-a');
    expect(resultFor(problem([testRoom], [newBooking], [newGuest], beds(testRoom.id)), testRoom.id, [newGuest])).toBe(true);
  });

  it('blocks an unspecified guest from a female-locked room', () => {
    const femaleBooking = booking('female-booking');
    const newBooking = booking('new');
    const femaleGuest = guest('female-guest', 'female-booking', 'female');
    const newGuest = guest('new-guest', 'new', 'unspecified');
    const testRoom = room('room-a');
    const allocationProblem = problem(
      [testRoom],
      [femaleBooking, newBooking],
      [femaleGuest, newGuest],
      beds(testRoom.id),
    );
    const state = new AllocationState(allocationProblem);
    state.place(testRoom.id, [femaleGuest]);
    expect(canPlace(state, testRoom.id, [newGuest], allocationProblem.property, allocationProblem.rooms, allocationProblem.beds)).toBe(
      'gender_conflict',
    );
  });

  it('does not let an unspecified guest create a gender lock', () => {
    const unspecifiedBooking = booking('unspecified-booking');
    const maleBooking = booking('male-booking');
    const unspecifiedGuest = guest('unspecified-guest', 'unspecified-booking', 'unspecified');
    const maleGuest = guest('male-guest', 'male-booking', 'male');
    const testRoom = room('room-a');
    const allocationProblem = problem(
      [testRoom],
      [unspecifiedBooking, maleBooking],
      [unspecifiedGuest, maleGuest],
      beds(testRoom.id),
    );
    const state = new AllocationState(allocationProblem);
    state.place(testRoom.id, [unspecifiedGuest]);
    expect(canPlace(state, testRoom.id, [maleGuest], allocationProblem.property, allocationProblem.rooms, allocationProblem.beds)).toBe(true);
  });

  it('restores every room-night field after place followed by unplace', () => {
    const newBooking = booking('new');
    const guests = [guest('female', 'new', 'female'), guest('unknown', 'new', 'unspecified')];
    const testRoom = room('room-a');
    const allocationProblem = problem([testRoom], [newBooking], guests, beds(testRoom.id));
    const state = new AllocationState(allocationProblem);
    const before = state.dates.map((_, index) => {
      const night = state.getNight(testRoom.id, index);
      return {
        occupants: night.occupants,
        males: night.males,
        females: night.females,
        bookingIds: [...night.bookingIds],
      };
    });
    state.place(testRoom.id, guests);
    state.unplace(testRoom.id, guests);
    const after = state.dates.map((_, index) => {
      const night = state.getNight(testRoom.id, index);
      return {
        occupants: night.occupants,
        males: night.males,
        females: night.females,
        bookingIds: [...night.bookingIds],
      };
    });
    expect(after).toEqual(before);
  });
});
