import { isWithin } from './dates';
import type { Bed, ISODate } from './types';

/** Returns the number of beds available in a room on a date. */
export function capacity(roomId: string, beds: readonly Bed[], on: ISODate): number {
  return beds.filter(
    (bed) =>
      bed.roomId === roomId &&
      !isWithin(on, bed.outOfServiceFrom, bed.outOfServiceTo),
  ).length;
}
