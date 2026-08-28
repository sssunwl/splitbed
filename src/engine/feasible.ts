import type { BlockReason } from './solve';
import { AllocationState } from './state';
import type { Bed, Guest, Property, Room } from './types';

function hasOtherBooking(
  bookingIds: ReadonlySet<string>,
  incomingBookingIds: ReadonlySet<string>,
): boolean {
  for (const bookingId of bookingIds) {
    if (!incomingBookingIds.has(bookingId)) {
      return true;
    }
  }
  return false;
}

/** Checks whether a group of guests can occupy one room without breaking a hard rule. */
export function canPlace(
  state: AllocationState,
  roomId: string,
  guests: readonly Guest[],
  property: Property,
  rooms: readonly Room[],
  beds: readonly Bed[],
): true | BlockReason {
  void property;
  void rooms;
  void beds;

  const incomingByNight = new Int32Array(state.dates.length);
  const activeNightIndexes: number[] = [];
  for (const guest of guests) {
    const [start, end] = state.rangeFor(guest);
    for (let nightIndex = start; nightIndex < end; nightIndex += 1) {
      if (incomingByNight[nightIndex] === 0) {
        activeNightIndexes.push(nightIndex);
      }
      incomingByNight[nightIndex] += 1;
    }
  }

  for (const nightIndex of activeNightIndexes) {
    if (state.getNight(roomId, nightIndex).policy === 'maintenance') {
      return 'maintenance';
    }
  }
  for (const nightIndex of activeNightIndexes) {
    if (state.getNight(roomId, nightIndex).policy === 'manual_only') {
      return 'manual_only';
    }
  }

  const incomingBookingIds = new Set(guests.map((guest) => guest.bookingId));
  for (const bookingId of incomingBookingIds) {
    if (state.bookingsById.get(bookingId)?.source !== 'staff') {
      for (const nightIndex of activeNightIndexes) {
        if (state.getNight(roomId, nightIndex).policy === 'staff') {
          return 'staff_only';
        }
      }
    }
  }

  const hasMale = guests.some((guest) => guest.gender === 'male');
  const hasFemale = guests.some((guest) => guest.gender === 'female');
  const hasUnspecified = guests.some((guest) => guest.gender === 'unspecified');

  if (hasMale) {
    for (const nightIndex of activeNightIndexes) {
      if (state.getNight(roomId, nightIndex).policy === 'female_only') {
        return 'female_only';
      }
    }
  }
  if (hasFemale) {
    for (const nightIndex of activeNightIndexes) {
      if (state.getNight(roomId, nightIndex).policy === 'male_only') {
        return 'male_only';
      }
    }
  }

  for (const nightIndex of activeNightIndexes) {
    const night = state.getNight(roomId, nightIndex);
    if (night.occupants + incomingByNight[nightIndex] > night.capacity) {
      return 'capacity';
    }
  }

  for (const nightIndex of activeNightIndexes) {
    const night = state.getNight(roomId, nightIndex);
    if (
      night.policy === 'private' &&
      hasOtherBooking(night.bookingIds, incomingBookingIds)
    ) {
      return 'private_occupied';
    }
  }

  const incomingRequiresPrivate = [...incomingBookingIds].some(
    (bookingId) => state.bookingsById.get(bookingId)?.requiresPrivateRoom === true,
  );
  for (const nightIndex of activeNightIndexes) {
    const night = state.getNight(roomId, nightIndex);
    const hasOther = hasOtherBooking(night.bookingIds, incomingBookingIds);
    const existingRequiresPrivate = [...night.bookingIds].some(
      (bookingId) =>
        !incomingBookingIds.has(bookingId) &&
        state.bookingsById.get(bookingId)?.requiresPrivateRoom === true,
    );
    if ((incomingRequiresPrivate && hasOther) || existingRequiresPrivate) {
      return 'requires_private';
    }
  }

  for (const nightIndex of activeNightIndexes) {
    const night = state.getNight(roomId, nightIndex);
    if (night.policy !== 'same_gender') {
      continue;
    }
    if (hasMale && hasFemale) {
      return 'gender_conflict';
    }
    if (hasMale && night.females > 0) {
      return 'gender_conflict';
    }
    if (hasFemale && night.males > 0) {
      return 'gender_conflict';
    }
    if (hasUnspecified && (night.males > 0 || night.females > 0)) {
      return 'gender_conflict';
    }
  }

  for (const guest of guests) {
    const lockedRoomId = state.hardLockedRoomByGuestId.get(guest.id);
    if (lockedRoomId !== undefined && lockedRoomId !== roomId) {
      return 'locked_elsewhere';
    }
  }

  return true;
}
