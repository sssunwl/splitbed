import type { ISODate } from './types';

const MILLISECONDS_PER_DAY = 86_400_000;

function dayNumber(d: ISODate): number {
  const [year, month, day] = d.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / MILLISECONDS_PER_DAY;
}

function dateFromDayNumber(value: number): ISODate {
  return new Date(value * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

/** Returns the ISO date that is n calendar days after d. */
export function addDays(d: ISODate, n: number): ISODate {
  return dateFromDayNumber(dayNumber(d) + n);
}

/** Returns the number of calendar days from from to to. */
export function diffDays(from: ISODate, to: ISODate): number {
  return dayNumber(to) - dayNumber(from);
}

/** Returns every night in the left-closed, right-open interval [from, to). */
export function eachNight(from: ISODate, to: ISODate): ISODate[] {
  const nights: ISODate[] = [];
  for (let current = from; current < to; current = addDays(current, 1)) {
    nights.push(current);
  }
  return nights;
}

/** Returns whether d is in the configured left-closed, right-open interval. */
export function isWithin(
  d: ISODate,
  from: ISODate | null,
  to: ISODate | null,
): boolean {
  if (from === null && to === null) {
    return false;
  }
  if (from !== null && d < from) {
    return false;
  }
  if (to !== null && d >= to) {
    return false;
  }
  return true;
}
