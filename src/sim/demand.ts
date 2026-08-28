import { addDays } from '../engine/dates';
import type { Booking, Guest, ISODate } from '../engine/types';
import { geometric, makeRng, pickWeighted, randInt } from './rng';

export interface DemandConfig {
  horizonNights: number;
  totalCapacityBedNights: number;
  demandRatio: number;
  nightlyRate: number;
  maleRatio: number;
  sameGenderGroupProb: number;
  stayNights: ReadonlyArray<[number, number]>;
  groupSize: ReadonlyArray<[number, number]>;
  leadTimeMeanDays: number;
}

export interface SimBooking extends Booking {
  guests: readonly Guest[];
}

export const DEFAULT_DEMAND_CONFIG: DemandConfig = {
  horizonNights: 90,
  totalCapacityBedNights: 1_080,
  demandRatio: 1,
  nightlyRate: 5_000,
  maleRatio: 0.6,
  sameGenderGroupProb: 0.7,
  stayNights: [
    [1, 0.05],
    [2, 0.15],
    [3, 0.2],
    [4, 0.15],
    [5, 0.1],
    [6, 0.1],
    [7, 0.15],
    [14, 0.07],
    [30, 0.03],
  ],
  groupSize: [
    [1, 0.3],
    [2, 0.4],
    [3, 0.2],
    [4, 0.1],
  ],
  leadTimeMeanDays: 14,
};

function makeGender(rng: () => number, maleRatio: number): Guest['gender'] {
  return rng() < maleRatio ? 'male' : 'female';
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Generates demand in booked-at order from one deterministic seed. */
export function generateDemand(
  config: DemandConfig,
  seed: number,
  horizonFrom: ISODate = '2026-01-01',
  propertyId = 'property-1',
): SimBooking[] {
  const rng = makeRng(seed);
  const targetBedNights = config.totalCapacityBedNights * config.demandRatio;
  const bookings: SimBooking[] = [];
  let requestedBedNights = 0;

  while (requestedBedNights < targetBedNights) {
    const groupSize = pickWeighted(rng, config.groupSize);
    const sampledStayNights = pickWeighted(rng, config.stayNights);
    const checkInOffset = randInt(rng, 0, config.horizonNights);
    const checkOutOffset = Math.min(
      checkInOffset + sampledStayNights,
      config.horizonNights,
    );
    const actualStayNights = checkOutOffset - checkInOffset;
    const checkIn = addDays(horizonFrom, checkInOffset);
    const checkOut = addDays(horizonFrom, checkOutOffset);

    const genders: Guest['gender'][] = [];
    if (groupSize === 1 || rng() < config.sameGenderGroupProb) {
      const gender = makeGender(rng, config.maleRatio);
      for (let index = 0; index < groupSize; index += 1) {
        genders.push(gender);
      }
    } else {
      for (let index = 0; index < groupSize; index += 1) {
        genders.push(makeGender(rng, config.maleRatio));
      }
    }

    const sequence = bookings.length;
    const bookingId = `booking-${String(sequence).padStart(4, '0')}`;
    const bookedAt = addDays(
      checkIn,
      -geometric(rng, config.leadTimeMeanDays),
    );
    const guests = genders.map<Guest>((gender, index) => ({
      id: `${bookingId}-guest-${index}`,
      bookingId,
      name: `${bookingId}-guest-${index}`,
      gender,
      birthYear: null,
      accessibilityNeed: false,
      checkIn,
      checkOut,
    }));
    const bedNights = groupSize * actualStayNights;
    bookings.push({
      id: bookingId,
      propertyId,
      reference: bookingId,
      source: 'direct',
      bookedAt,
      checkIn,
      checkOut,
      status: 'confirmed_unassigned',
      cancelled: false,
      noShow: false,
      totalValue: bedNights * config.nightlyRate,
      currency: 'JPY',
      mustStayTogether: false,
      requiresPrivateRoom: false,
      priority: 0,
      notes: '',
      guests,
    });
    requestedBedNights += bedNights;
  }

  return bookings.sort(
    (left, right) =>
      compareIds(left.bookedAt, right.bookedAt) || compareIds(left.id, right.id),
  );
}
