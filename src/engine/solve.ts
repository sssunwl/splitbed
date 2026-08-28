import { diffDays } from './dates';
import { canPlace } from './feasible';
import { evaluate } from './objective';
import { mulberry32 } from './rng';
import { AllocationState } from './state';
import type {
  Assignment,
  Bed,
  Booking,
  Guest,
  ISODate,
  Property,
  Room,
} from './types';

export interface AllocationProblem {
  property: Property;
  rooms: readonly Room[];
  beds: readonly Bed[];
  bookings: readonly Booking[];
  guests: readonly Guest[];
  currentAssignments: readonly Assignment[];
  horizonFrom: ISODate;
  horizonTo: ISODate;
}

export interface Weights {
  reject: number;
  stability: number;
  strand: number;
  fragment: number;
  priority: number;
}

export interface SolveOptions {
  weights: Weights;
  maxPasses: number;
  seed: number;
  allowReject: boolean;
}

export interface Placement {
  guestId: string;
  roomId: string;
}

export type BlockReason =
  | 'capacity'
  | 'gender_conflict'
  | 'female_only'
  | 'male_only'
  | 'private_occupied'
  | 'requires_private'
  | 'staff_only'
  | 'maintenance'
  | 'manual_only'
  | 'locked_elsewhere';

export interface Diagnostic {
  bookingId: string;
  perRoom: ReadonlyArray<{ roomId: string; reason: BlockReason }>;
}

export interface ObjectiveBreakdown {
  reject: number;
  stability: number;
  strand: number;
  fragment: number;
  priority: number;
  total: number;
}

export interface SolveResult {
  placements: readonly Placement[];
  rejectedBookingIds: readonly string[];
  forcedSplitBookingIds: readonly string[];
  breakdown: ObjectiveBreakdown;
  diagnostics: readonly Diagnostic[];
  passes: number;
}

const DEFAULT_WEIGHTS: Weights = {
  reject: 1_000,
  stability: 120,
  strand: 10,
  fragment: 3,
  priority: 50,
};

function compareIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function placementList(roomByGuestId: ReadonlyMap<string, string>): Placement[] {
  return [...roomByGuestId]
    .map(([guestId, roomId]) => ({ guestId, roomId }))
    .sort((left, right) => compareIds(left.guestId, right.guestId));
}

function sortedRooms(rooms: readonly Room[]): Room[] {
  return [...rooms].sort(
    (left, right) => left.sortOrder - right.sortOrder || compareIds(left.id, right.id),
  );
}

function sortedBookings(problem: AllocationProblem): Booking[] {
  const guestCountByBookingId = new Map<string, number>();
  for (const guest of problem.guests) {
    guestCountByBookingId.set(
      guest.bookingId,
      (guestCountByBookingId.get(guest.bookingId) ?? 0) + 1,
    );
  }
  return [...problem.bookings].sort(
    (left, right) =>
      right.priority - left.priority ||
      (guestCountByBookingId.get(right.id) ?? 0) -
        (guestCountByBookingId.get(left.id) ?? 0) ||
      diffDays(right.checkIn, right.checkOut) - diffDays(left.checkIn, left.checkOut) ||
      compareIds(left.id, right.id),
  );
}

function guestsForBooking(problem: AllocationProblem, bookingId: string): Guest[] {
  return problem.guests
    .filter((guest) => guest.bookingId === bookingId)
    .sort((left, right) => compareIds(left.id, right.id));
}

function testRooms(
  state: AllocationState,
  problem: AllocationProblem,
  weights: Weights,
  roomByGuestId: Map<string, string>,
  guests: readonly Guest[],
  rooms: readonly Room[],
): { roomId: string; total: number } | null {
  let best: { roomId: string; total: number } | null = null;
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
    const total = evaluate(state, problem, weights, placementList(roomByGuestId)).total;
    state.unplace(room.id, guests);
    for (const guest of guests) {
      roomByGuestId.delete(guest.id);
    }

    if (best === null || total < best.total) {
      best = { roomId: room.id, total };
    }
  }
  return best;
}

function placeGuests(
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

function removeGuests(
  state: AllocationState,
  roomByGuestId: Map<string, string>,
  guests: readonly Guest[],
): Map<string, string> {
  const oldRooms = new Map<string, string>();
  for (const guest of guests) {
    const roomId = roomByGuestId.get(guest.id);
    if (roomId !== undefined) {
      state.unplace(roomId, [guest]);
      oldRooms.set(guest.id, roomId);
      roomByGuestId.delete(guest.id);
    }
  }
  return oldRooms;
}

function restoreGuests(
  state: AllocationState,
  roomByGuestId: Map<string, string>,
  guests: readonly Guest[],
  oldRooms: ReadonlyMap<string, string>,
): void {
  for (const guest of guests) {
    const roomId = oldRooms.get(guest.id);
    if (roomId !== undefined) {
      state.place(roomId, [guest]);
      roomByGuestId.set(guest.id, roomId);
    }
  }
}

function candidateRoomsForBooking(
  rooms: readonly Room[],
  guests: readonly Guest[],
  hardLockedRoomByGuestId: ReadonlyMap<string, string>,
): Room[] {
  const hardRoomIds = new Set(
    guests
      .map((guest) => hardLockedRoomByGuestId.get(guest.id))
      .filter((roomId): roomId is string => roomId !== undefined),
  );
  if (hardRoomIds.size > 1) {
    return [];
  }
  if (hardRoomIds.size === 1) {
    const hardRoomId = hardRoomIds.values().next().value as string;
    return rooms.filter((room) => room.id === hardRoomId);
  }
  return [...rooms];
}

function diagnosticFor(
  state: AllocationState,
  problem: AllocationProblem,
  bookingId: string,
  rooms: readonly Room[],
): Diagnostic {
  const guests = guestsForBooking(problem, bookingId);
  const perRoom: Array<{ roomId: string; reason: BlockReason }> = [];
  for (const room of rooms) {
    const reason = canPlace(
      state,
      room.id,
      guests,
      problem.property,
      problem.rooms,
      problem.beds,
    );
    if (reason !== true) {
      perRoom.push({ roomId: room.id, reason });
    }
  }
  return { bookingId, perRoom };
}

function shuffleBookings(bookings: readonly Booking[], random: () => number): Booking[] {
  const shuffled = [...bookings];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(random() * (index + 1));
    const temporary = shuffled[index];
    shuffled[index] = shuffled[otherIndex];
    shuffled[otherIndex] = temporary;
  }
  return shuffled;
}

/** Solves a room allocation problem with greedy placement and deterministic local search. */
export function solve(problem: AllocationProblem, options: SolveOptions): SolveResult {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const maxPasses = options.maxPasses ?? 20;
  const seed = options.seed ?? 42;
  const allowReject = options.allowReject ?? true;
  void allowReject;

  const state = new AllocationState(problem);
  const rooms = sortedRooms(problem.rooms);
  const bookings = sortedBookings(problem);
  const roomByGuestId = new Map<string, string>();
  const initialDiagnostics = new Map<string, Diagnostic>();

  const guestsById = new Map(problem.guests.map((guest) => [guest.id, guest]));
  for (const [guestId, roomId] of state.hardLockedRoomByGuestId) {
    const guest = guestsById.get(guestId);
    if (guest !== undefined) {
      placeGuests(state, roomByGuestId, roomId, [guest]);
    }
  }

  for (const booking of bookings) {
    const bookingGuests = guestsForBooking(problem, booking.id);
    const movableGuests = bookingGuests.filter(
      (guest) => !state.hardLockedRoomByGuestId.has(guest.id),
    );
    if (movableGuests.length === 0) {
      continue;
    }

    const groupRooms = candidateRoomsForBooking(
      rooms,
      bookingGuests,
      state.hardLockedRoomByGuestId,
    );
    const groupChoice = testRooms(
      state,
      problem,
      weights,
      roomByGuestId,
      movableGuests,
      groupRooms,
    );
    if (groupChoice !== null) {
      placeGuests(state, roomByGuestId, groupChoice.roomId, movableGuests);
      continue;
    }

    if (!booking.mustStayTogether) {
      const individuallyPlaced: Guest[] = [];
      let allPlaced = true;
      for (const guest of movableGuests) {
        const choice = testRooms(
          state,
          problem,
          weights,
          roomByGuestId,
          [guest],
          rooms,
        );
        if (choice === null) {
          allPlaced = false;
          break;
        }
        placeGuests(state, roomByGuestId, choice.roomId, [guest]);
        individuallyPlaced.push(guest);
      }
      if (allPlaced) {
        continue;
      }
      removeGuests(state, roomByGuestId, individuallyPlaced);
    }

    initialDiagnostics.set(booking.id, diagnosticFor(state, problem, booking.id, rooms));
  }

  const random = mulberry32(seed);
  let passes = 0;
  for (; passes < maxPasses; passes += 1) {
    const currentTotal = evaluate(
      state,
      problem,
      weights,
      placementList(roomByGuestId),
    ).total;
    let bestMove: { guests: Guest[]; roomId: string } | null = null;
    let bestTotal = currentTotal;

    for (const booking of shuffleBookings(bookings, random)) {
      const bookingGuests = guestsForBooking(problem, booking.id);
      const movableGuests = bookingGuests.filter(
        (guest) => !state.hardLockedRoomByGuestId.has(guest.id),
      );
      if (movableGuests.length === 0) {
        continue;
      }

      const oldRooms = removeGuests(state, roomByGuestId, movableGuests);
      const candidates = candidateRoomsForBooking(
        rooms,
        bookingGuests,
        state.hardLockedRoomByGuestId,
      );
      const choice = testRooms(
        state,
        problem,
        weights,
        roomByGuestId,
        movableGuests,
        candidates,
      );
      restoreGuests(state, roomByGuestId, movableGuests, oldRooms);

      if (choice !== null && choice.total < bestTotal) {
        bestTotal = choice.total;
        bestMove = { guests: movableGuests, roomId: choice.roomId };
      }
    }

    if (bestMove === null) {
      passes += 1;
      break;
    }
    removeGuests(state, roomByGuestId, bestMove.guests);
    placeGuests(state, roomByGuestId, bestMove.roomId, bestMove.guests);
  }

  const placements = placementList(roomByGuestId);
  const placedGuestIds = new Set(placements.map((placement) => placement.guestId));
  const rejectedBookingIds = bookings
    .filter((booking) =>
      guestsForBooking(problem, booking.id).some((guest) => !placedGuestIds.has(guest.id)),
    )
    .map((booking) => booking.id)
    .sort(compareIds);
  const forcedSplitBookingIds = bookings
    .filter((booking) => {
      const bookingGuests = guestsForBooking(problem, booking.id);
      if (
        bookingGuests.length === 0 ||
        bookingGuests.some((guest) => !roomByGuestId.has(guest.id))
      ) {
        return false;
      }
      return new Set(bookingGuests.map((guest) => roomByGuestId.get(guest.id))).size > 1;
    })
    .map((booking) => booking.id)
    .sort(compareIds);
  const diagnostics = rejectedBookingIds.map((bookingId) => {
    const finalDiagnostic = diagnosticFor(state, problem, bookingId, rooms);
    return finalDiagnostic.perRoom.length === rooms.length
      ? finalDiagnostic
      : (initialDiagnostics.get(bookingId) ?? finalDiagnostic);
  });
  const breakdown = evaluate(state, problem, weights, placements);

  return {
    placements,
    rejectedBookingIds,
    forcedSplitBookingIds,
    breakdown,
    diagnostics,
    passes,
  };
}
