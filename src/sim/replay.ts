import { diffDays } from '../engine/dates';
import { canPlace } from '../engine/feasible';
import { evaluate } from '../engine/objective';
import type {
  AllocationProblem,
  Placement,
  Weights,
} from '../engine/solve';
import { AllocationState } from '../engine/state';
import type {
  Bed,
  Guest,
  ISODate,
  Property,
  PropertyPolicy,
  Room,
} from '../engine/types';
import type { SimBooking } from './demand';
import { countStrandedBedNights } from './kpi';

export interface ReplayResult {
  placements: readonly Placement[];
  requestedBedNights: number;
  soldBedNights: number;
  strandedBedNights: number;
  forcedSplits: number;
  lostBookingIds: readonly string[];
}

/**
 * Room-choice weights for the replay. Matches the engine's own strand/fragment
 * defaults so the simulation behaves the way the real allocator will.
 *
 * Measured 2026-08-29 against fragment-only (strand: 0, fragment: 1):
 * mixed is identical (mixed rooms can never strand) and same_gender moves by
 * -0.03%, but hybrid gains +1.4% revenue and drops stranded bed-nights from
 * 109 to 93 — hybrid's benefit over same_gender goes from ¥106k to ¥155k.
 * Under-weighting strand therefore understates hybrid by roughly 45%.
 *
 * reject/stability/priority stay 0: the replay never chooses to reject and
 * never moves an earlier placement, so those terms are inert here.
 */
const REPLAY_WEIGHTS: Weights = {
  reject: 0,
  stability: 0,
  strand: 10,
  fragment: 3,
  priority: 0,
};

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function placementList(roomByGuestId: ReadonlyMap<string, string>): Placement[] {
  return [...roomByGuestId]
    .map(([guestId, roomId]) => ({ guestId, roomId }))
    .sort((left, right) => compareIds(left.guestId, right.guestId));
}

function inferHorizon(bookings: readonly SimBooking[]): readonly [ISODate, ISODate] {
  const guests = bookings.flatMap((booking) => booking.guests);
  if (guests.length === 0) {
    return ['2026-01-01', '2026-01-02'];
  }
  let horizonFrom = guests[0].checkIn;
  let horizonTo = guests[0].checkOut;
  for (const guest of guests) {
    if (guest.checkIn < horizonFrom) {
      horizonFrom = guest.checkIn;
    }
    if (guest.checkOut > horizonTo) {
      horizonTo = guest.checkOut;
    }
  }
  return [horizonFrom, horizonTo];
}

function tryRooms(
  state: AllocationState,
  problem: AllocationProblem,
  rooms: readonly Room[],
  guests: readonly Guest[],
  roomByGuestId: Map<string, string>,
): string | null {
  let bestRoomId: string | null = null;
  let bestTotal = Number.POSITIVE_INFINITY;
  for (const room of rooms) {
    if (
      canPlace(
        state,
        room.id,
        guests,
        problem.property,
        problem.rooms,
        problem.beds,
      ) !== true
    ) {
      continue;
    }
    state.place(room.id, guests);
    for (const guest of guests) {
      roomByGuestId.set(guest.id, room.id);
    }
    const total = evaluate(
      state,
      problem,
      REPLAY_WEIGHTS,
      placementList(roomByGuestId),
    ).total;
    state.unplace(room.id, guests);
    for (const guest of guests) {
      roomByGuestId.delete(guest.id);
    }
    const [firstNight] = state.rangeFor(guests[0]);
    const candidateCapacity = state.getNight(room.id, firstNight).capacity;
    const bestCapacity =
      bestRoomId === null
        ? Number.POSITIVE_INFINITY
        : state.getNight(bestRoomId, firstNight).capacity;
    if (total < bestTotal || (total === bestTotal && candidateCapacity < bestCapacity)) {
      bestTotal = total;
      bestRoomId = room.id;
    }
  }
  return bestRoomId;
}

function place(
  state: AllocationState,
  roomByGuestId: Map<string, string>,
  roomId: string,
  guests: readonly Guest[],
): void {
  state.place(roomId, guests);
  for (const guest of guests) {
    roomByGuestId.set(guest.id, roomId);
  }
}

/** Replays bookings incrementally in booked-at order without moving earlier placements. */
export function replay(
  bookings: readonly SimBooking[],
  rooms: readonly Room[],
  beds: readonly Bed[],
  policy: PropertyPolicy,
  property: Property,
): ReplayResult {
  const orderedBookings = [...bookings].sort(
    (left, right) =>
      compareIds(left.bookedAt, right.bookedAt) || compareIds(left.id, right.id),
  );
  const activeBookings = orderedBookings.filter(
    (booking) => !booking.cancelled && !booking.noShow,
  );
  const [horizonFrom, horizonTo] = inferHorizon(activeBookings);
  const effectiveProperty: Property = {
    ...property,
    defaultPolicy: policy,
    pendingPolicy: null,
    pendingPolicyFrom: null,
  };
  const catalogProblem: AllocationProblem = {
    property: effectiveProperty,
    rooms,
    beds,
    bookings: activeBookings,
    guests: activeBookings.flatMap((booking) => booking.guests),
    currentAssignments: [],
    horizonFrom,
    horizonTo,
  };
  const state = new AllocationState(catalogProblem);
  const knownBookings: SimBooking[] = [];
  const knownGuests: Guest[] = [];
  const knownProblem: AllocationProblem = {
    ...catalogProblem,
    bookings: knownBookings,
    guests: knownGuests,
  };
  const roomByGuestId = new Map<string, string>();
  const lostBookingIds: string[] = [];
  let requestedBedNights = 0;
  let forcedSplits = 0;

  for (const booking of activeBookings) {
    const guests = [...booking.guests].sort((left, right) => compareIds(left.id, right.id));
    knownBookings.push(booking);
    knownGuests.push(...guests);
    const bookingBedNights = guests.reduce(
      (sum, guest) => sum + diffDays(guest.checkIn, guest.checkOut),
      0,
    );
    requestedBedNights += bookingBedNights;

    const groupRoomId = tryRooms(
      state,
      knownProblem,
      rooms,
      guests,
      roomByGuestId,
    );
    if (groupRoomId !== null) {
      place(state, roomByGuestId, groupRoomId, guests);
      continue;
    }

    let placedGuestCount = 0;
    for (const guest of guests) {
      const roomId = tryRooms(
        state,
        knownProblem,
        rooms,
        [guest],
        roomByGuestId,
      );
      if (roomId !== null) {
        place(state, roomByGuestId, roomId, [guest]);
        placedGuestCount += 1;
      }
    }
    if (placedGuestCount > 0) {
      forcedSplits += 1;
    }
    if (placedGuestCount < guests.length) {
      lostBookingIds.push(booking.id);
    }
  }

  const placements = placementList(roomByGuestId);
  const guestById = new Map(
    activeBookings.flatMap((booking) => booking.guests).map((guest) => [guest.id, guest]),
  );
  const soldBedNights = placements.reduce((sum, placement) => {
    const guest = guestById.get(placement.guestId);
    return guest === undefined ? sum : sum + diffDays(guest.checkIn, guest.checkOut);
  }, 0);

  return {
    placements,
    requestedBedNights,
    soldBedNights,
    strandedBedNights: countStrandedBedNights(state, rooms),
    forcedSplits,
    lostBookingIds,
  };
}
