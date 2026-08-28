import { describe, expect, it } from 'vitest';

import { evaluate } from '../src/engine/objective';
import type { AllocationProblem, Placement, Weights } from '../src/engine/solve';
import { AllocationState } from '../src/engine/state';
import type { Bed, Booking, Guest, Room } from '../src/engine/types';

const unitWeights: Weights = {
  reject: 0,
  stability: 0,
  strand: 0,
  fragment: 0,
  priority: 0,
};

function room(id: string, roomType: Room['roomType'] = null): Room {
  return {
    id,
    propertyId: 'property-1',
    code: id,
    roomType,
    sortOrder: Number(id.slice(-1)) || 1,
  };
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

function booking(id: string, totalValue = 100, priority = 0): Booking {
  return {
    id,
    propertyId: 'property-1',
    reference: id,
    source: 'direct',
    bookedAt: '2026-01-01',
    checkIn: '2026-01-01',
    checkOut: '2026-01-06',
    status: 'confirmed_unassigned',
    cancelled: false,
    noShow: false,
    totalValue,
    currency: 'JPY',
    mustStayTogether: true,
    requiresPrivateRoom: false,
    priority,
    notes: '',
  };
}

function guest(id: string, bookingId: string): Guest {
  return {
    id,
    bookingId,
    name: id,
    gender: 'female',
    birthYear: null,
    accessibilityNeed: false,
    checkIn: '2026-01-01',
    checkOut: '2026-01-06',
  };
}

function problem(
  rooms: Room[],
  allBeds: Bed[],
  bookings: Booking[],
  guests: Guest[],
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
    horizonTo: '2026-01-06',
  };
}

function evaluated(
  allocationProblem: AllocationProblem,
  placements: readonly Placement[],
  weights: Weights,
) {
  const state = new AllocationState(allocationProblem);
  const guestsById = new Map(allocationProblem.guests.map((item) => [item.id, item]));
  for (const placement of placements) {
    const placedGuest = guestsById.get(placement.guestId);
    if (placedGuest !== undefined) {
      state.place(placement.roomId, [placedGuest]);
    }
  }
  return evaluate(state, allocationProblem, weights, placements);
}

describe('evaluate', () => {
  it('counts 10 stranded bed-nights for one guest in a three-bed same_gender room', () => {
    const testRoom = room('room-1');
    const testBooking = booking('booking-1');
    const testGuest = guest('guest-1', testBooking.id);
    const allocationProblem = problem(
      [testRoom],
      beds(testRoom.id, 3),
      [testBooking],
      [testGuest],
    );
    const result = evaluated(
      allocationProblem,
      [{ guestId: testGuest.id, roomId: testRoom.id }],
      { ...unitWeights, strand: 1 },
    );
    expect(result.strand).toBe(10);
  });

  it('counts no stranded bed-nights for the same occupancy under mixed policy', () => {
    const testRoom = room('room-1', 'mixed');
    const testBooking = booking('booking-1');
    const testGuest = guest('guest-1', testBooking.id);
    const allocationProblem = problem(
      [testRoom],
      beds(testRoom.id, 3),
      [testBooking],
      [testGuest],
    );
    const result = evaluated(
      allocationProblem,
      [{ guestId: testGuest.id, roomId: testRoom.id }],
      { ...unitWeights, strand: 1 },
    );
    expect(result.strand).toBe(0);
  });

  it('charges more fragment cost when two guests occupy two rooms', () => {
    const room1 = room('room-1', 'mixed');
    const room2 = room('room-2', 'mixed');
    const booking1 = booking('booking-1');
    const booking2 = booking('booking-2');
    const guest1 = guest('guest-1', booking1.id);
    const guest2 = guest('guest-2', booking2.id);
    const allocationProblem = problem(
      [room1, room2],
      [...beds(room1.id, 2), ...beds(room2.id, 2)],
      [booking1, booking2],
      [guest1, guest2],
    );
    const together = evaluated(
      allocationProblem,
      [
        { guestId: guest1.id, roomId: room1.id },
        { guestId: guest2.id, roomId: room1.id },
      ],
      { ...unitWeights, fragment: 1 },
    );
    const separate = evaluated(
      allocationProblem,
      [
        { guestId: guest1.id, roomId: room1.id },
        { guestId: guest2.id, roomId: room2.id },
      ],
      { ...unitWeights, fragment: 1 },
    );
    expect(separate.fragment).toBeGreaterThan(together.fragment);
  });

  it('charges zero stability when placement matches the current assignment', () => {
    const testRoom = room('room-1');
    const testBooking = booking('booking-1');
    const testGuest = guest('guest-1', testBooking.id);
    const allocationProblem = problem(
      [testRoom],
      beds(testRoom.id, 1),
      [testBooking],
      [testGuest],
      [
        {
          id: 'assignment-1',
          guestId: testGuest.id,
          roomId: testRoom.id,
          bedId: null,
          dateFrom: testGuest.checkIn,
          dateTo: testGuest.checkOut,
          lockLevel: 'soft',
          isCurrent: true,
          createdBy: 'staff',
        },
      ],
    );
    const result = evaluated(
      allocationProblem,
      [{ guestId: testGuest.id, roomId: testRoom.id }],
      { ...unitWeights, stability: 1 },
    );
    expect(result.stability).toBe(0);
  });

  it('normalizes rejected value by the average booking value', () => {
    const testRoom = room('room-1');
    const booking1 = booking('booking-1', 100);
    const booking2 = booking('booking-2', 300);
    const guest1 = guest('guest-1', booking1.id);
    const guest2 = guest('guest-2', booking2.id);
    const allocationProblem = problem(
      [testRoom],
      beds(testRoom.id, 2),
      [booking1, booking2],
      [guest1, guest2],
    );
    const result = evaluated(
      allocationProblem,
      [{ guestId: guest1.id, roomId: testRoom.id }],
      { ...unitWeights, reject: 1 },
    );
    expect(result.reject).toBe(1.5);
  });

  it('counts each rejected zero-value booking as one unit and adds priority', () => {
    const testRoom = room('room-1');
    const booking1 = booking('booking-1', 0, 2);
    const booking2 = booking('booking-2', 0, 3);
    const guest1 = guest('guest-1', booking1.id);
    const guest2 = guest('guest-2', booking2.id);
    const allocationProblem = problem(
      [testRoom],
      beds(testRoom.id, 2),
      [booking1, booking2],
      [guest1, guest2],
    );
    const result = evaluated(allocationProblem, [], {
      ...unitWeights,
      reject: 10,
      priority: 2,
    });
    expect(result.reject).toBe(20);
    expect(result.priority).toBe(10);
    expect(result.total).toBe(30);
  });
});
