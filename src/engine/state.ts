import { capacity } from './capacity';
import { eachNight, diffDays } from './dates';
import { resolvePolicy } from './policy';
import type { AllocationProblem } from './solve';
import type { Booking, Guest, ISODate, RoomPolicy } from './types';

interface RoomNightState {
  occupants: number;
  males: number;
  females: number;
  bookingIds: Set<string>;
  bookingCounts: Map<string, number>;
  capacity: number;
  policy: RoomPolicy;
}

/** Mutable room-by-night occupancy used while constructing an allocation. */
export class AllocationState {
  readonly horizonFrom: ISODate;
  readonly horizonTo: ISODate;
  readonly dates: readonly ISODate[];
  readonly roomNights: ReadonlyMap<string, RoomNightState[]>;
  readonly bookingsById: ReadonlyMap<string, Booking>;
  readonly hardLockedRoomByGuestId: ReadonlyMap<string, string>;

  constructor(problem: AllocationProblem) {
    this.horizonFrom = problem.horizonFrom;
    this.horizonTo = problem.horizonTo;
    this.dates = eachNight(problem.horizonFrom, problem.horizonTo);
    this.bookingsById = new Map(problem.bookings.map((booking) => [booking.id, booking]));
    this.hardLockedRoomByGuestId = new Map(
      problem.currentAssignments
        .filter((assignment) => assignment.isCurrent && assignment.lockLevel === 'hard')
        .map((assignment) => [assignment.guestId, assignment.roomId]),
    );

    const roomNights = new Map<string, RoomNightState[]>();
    for (const room of problem.rooms) {
      roomNights.set(
        room.id,
        this.dates.map((date) => ({
          occupants: 0,
          males: 0,
          females: 0,
          bookingIds: new Set<string>(),
          bookingCounts: new Map<string, number>(),
          capacity: capacity(room.id, problem.beds, date),
          policy: resolvePolicy(room, problem.property, date),
        })),
      );
    }
    this.roomNights = roomNights;
  }

  /** Returns the half-open horizon index range occupied by a guest. */
  rangeFor(guest: Guest): readonly [number, number] {
    const start = Math.max(0, diffDays(this.horizonFrom, guest.checkIn));
    const end = Math.min(this.dates.length, diffDays(this.horizonFrom, guest.checkOut));
    return [Math.min(start, this.dates.length), Math.max(0, end)];
  }

  /** Returns the mutable occupancy record for one room-night. */
  getNight(roomId: string, nightIndex: number): RoomNightState {
    const night = this.roomNights.get(roomId)?.[nightIndex];
    if (night === undefined) {
      throw new Error(`Unknown room-night: ${roomId} at ${nightIndex}`);
    }
    return night;
  }

  /** Adds guests to one room for every night of each guest's stay. */
  place(roomId: string, guests: readonly Guest[]): void {
    for (const guest of guests) {
      const [start, end] = this.rangeFor(guest);
      for (let nightIndex = start; nightIndex < end; nightIndex += 1) {
        const night = this.getNight(roomId, nightIndex);
        night.occupants += 1;
        if (guest.gender === 'male') {
          night.males += 1;
        } else if (guest.gender === 'female') {
          night.females += 1;
        }
        const count = (night.bookingCounts.get(guest.bookingId) ?? 0) + 1;
        night.bookingCounts.set(guest.bookingId, count);
        night.bookingIds.add(guest.bookingId);
      }
    }
  }

  /** Removes guests symmetrically from one room for every night of their stay. */
  unplace(roomId: string, guests: readonly Guest[]): void {
    for (const guest of guests) {
      const [start, end] = this.rangeFor(guest);
      for (let nightIndex = start; nightIndex < end; nightIndex += 1) {
        const night = this.getNight(roomId, nightIndex);
        night.occupants -= 1;
        if (guest.gender === 'male') {
          night.males -= 1;
        } else if (guest.gender === 'female') {
          night.females -= 1;
        }
        const count = (night.bookingCounts.get(guest.bookingId) ?? 0) - 1;
        if (count === 0) {
          night.bookingCounts.delete(guest.bookingId);
          night.bookingIds.delete(guest.bookingId);
        } else {
          night.bookingCounts.set(guest.bookingId, count);
        }
      }
    }
  }
}
