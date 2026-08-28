import type {
  AllocationProblem,
  ObjectiveBreakdown,
  Placement,
  Weights,
} from './solve';
import { AllocationState } from './state';

/** Evaluates an allocation; lower totals are better. */
export function evaluate(
  state: AllocationState,
  problem: AllocationProblem,
  weights: Weights,
  placements: readonly Placement[],
): ObjectiveBreakdown {
  const roomByGuestId = new Map(placements.map((placement) => [placement.guestId, placement.roomId]));
  const guestsByBookingId = new Map<string, string[]>();
  for (const guest of problem.guests) {
    const guestIds = guestsByBookingId.get(guest.bookingId) ?? [];
    guestIds.push(guest.id);
    guestsByBookingId.set(guest.bookingId, guestIds);
  }

  const rejectedBookings = problem.bookings.filter((booking) => {
    const guestIds = guestsByBookingId.get(booking.id) ?? [];
    return guestIds.length > 0 && guestIds.some((guestId) => !roomByGuestId.has(guestId));
  });
  const allValuesAreZero = problem.bookings.every((booking) => booking.totalValue === 0);
  const averageValue =
    problem.bookings.length === 0
      ? 0
      : problem.bookings.reduce((sum, booking) => sum + booking.totalValue, 0) /
        problem.bookings.length;
  const rejectedValueUnits = rejectedBookings.reduce(
    (sum, booking) => sum + (allValuesAreZero ? 1 : booking.totalValue / averageValue),
    0,
  );
  const reject = weights.reject * rejectedValueUnits;
  const priority =
    weights.priority *
    rejectedBookings.reduce((sum, booking) => sum + booking.priority, 0);

  let strandUnits = 0;
  let fragmentUnits = 0;
  for (const room of problem.rooms) {
    const nights = state.roomNights.get(room.id);
    if (nights === undefined) {
      continue;
    }
    for (const night of nights) {
      if (night.occupants > 0) {
        fragmentUnits += 1;
        if (night.policy !== 'mixed') {
          strandUnits += night.capacity - night.occupants;
        }
      }
    }
  }
  const strand = weights.strand * strandUnits;
  const fragment = weights.fragment * fragmentUnits;

  const currentAssignmentByGuestId = new Map(
    problem.currentAssignments
      .filter((assignment) => assignment.isCurrent)
      .map((assignment) => [assignment.guestId, assignment]),
  );
  let stabilityUnits = 0;
  for (const placement of placements) {
    const current = currentAssignmentByGuestId.get(placement.guestId);
    if (current?.roomId === placement.roomId) {
      continue;
    }
    stabilityUnits += current?.lockLevel === 'soft' ? 4 : 1;
  }
  const stability = weights.stability * stabilityUnits;
  const total = reject + stability + strand + fragment + priority;

  return { reject, stability, strand, fragment, priority, total };
}
