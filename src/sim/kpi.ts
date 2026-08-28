import { AllocationState } from '../engine/state';
import type { Room } from '../engine/types';

export interface Kpi {
  soldBedNights: number;
  revenue: number;
  occupancy: number;
  lostBedNights: number;
  strandedBedNights: number;
  forcedSplits: number;
}

export interface KpiInput {
  soldBedNights: number;
  requestedBedNights: number;
  strandedBedNights: number;
  forcedSplits: number;
  nightlyRate: number;
  totalCapacityBedNights: number;
}

/** Counts stranded bed-nights from the final room-by-night occupancy state. */
export function countStrandedBedNights(
  state: AllocationState,
  rooms: readonly Room[],
): number {
  let total = 0;
  for (const room of rooms) {
    const nights = state.roomNights.get(room.id) ?? [];
    for (const night of nights) {
      if (night.policy !== 'mixed' && night.occupants > 0) {
        total += night.capacity - night.occupants;
      }
    }
  }
  return total;
}

/** Converts replay totals into the public KPI shape. */
export function calculateKpi(input: KpiInput): Kpi {
  return {
    soldBedNights: input.soldBedNights,
    revenue: input.soldBedNights * input.nightlyRate,
    occupancy:
      input.totalCapacityBedNights === 0
        ? 0
        : input.soldBedNights / input.totalCapacityBedNights,
    lostBedNights: input.requestedBedNights - input.soldBedNights,
    strandedBedNights: input.strandedBedNights,
    forcedSplits: input.forcedSplits,
  };
}
