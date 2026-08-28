import type { Property, PropertyPolicy, Room } from '../engine/types';
import {
  DEFAULT_DEMAND_CONFIG,
  generateDemand,
  type DemandConfig,
} from './demand';
import { calculateKpi, type Kpi } from './kpi';
import { replay } from './replay';

export type SimulationPolicy = 'same_gender' | 'hybrid' | 'mixed';

export interface MetricSummary {
  mean: number;
  ci95: number;
}

export interface ComparisonRow {
  demandRatio: number;
  policy: SimulationPolicy;
  soldBedNights: MetricSummary;
  revenue: MetricSummary;
  occupancy: MetricSummary;
  lostBedNights: MetricSummary;
  strandedBedNights: MetricSummary;
  forcedSplits: MetricSummary;
}

export interface ComparisonResult {
  seedCount: number;
  rows: readonly ComparisonRow[];
}

export const DEMAND_RATIOS = [0.7, 0.85, 1, 1.15, 1.3] as const;
export const SIMULATION_POLICIES: readonly SimulationPolicy[] = [
  'same_gender',
  'hybrid',
  'mixed',
];

const PROPERTY: Property = {
  id: 'property-1',
  name: 'Sapporo',
  defaultPolicy: 'same_gender',
  pendingPolicy: null,
  pendingPolicyFrom: null,
};

function makeRooms(policy: SimulationPolicy): Room[] {
  const capacities = [
    ['A', 2],
    ['B', 4],
    ['C', 3],
    ['D', 3],
  ] as const;
  return capacities.map(([code], index) => ({
    id: `room-${code}`,
    propertyId: PROPERTY.id,
    code,
    roomType:
      policy === 'mixed' || (policy === 'hybrid' && code === 'B')
        ? 'mixed'
        : 'same_gender',
    sortOrder: index,
  }));
}

function makeBeds() {
  const capacities = [
    ['A', 2],
    ['B', 4],
    ['C', 3],
    ['D', 3],
  ] as const;
  return capacities.flatMap(([code, count]) =>
    Array.from({ length: count }, (_, index) => ({
      id: `room-${code}-bed-${index}`,
      roomId: `room-${code}`,
      code: `${index + 1}`,
      position: 'single' as const,
      outOfServiceFrom: null,
      outOfServiceTo: null,
    })),
  );
}

function summarize(values: readonly number[]): MetricSummary {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (values.length < 2) {
    return { mean, ci95: 0 };
  }
  const squaredDeviationSum = values.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0,
  );
  const standardDeviation = Math.sqrt(squaredDeviationSum / (values.length - 1));
  return { mean, ci95: (1.96 * standardDeviation) / Math.sqrt(values.length) };
}

function summarizeKpis(
  demandRatio: number,
  policy: SimulationPolicy,
  kpis: readonly Kpi[],
): ComparisonRow {
  return {
    demandRatio,
    policy,
    soldBedNights: summarize(kpis.map((kpi) => kpi.soldBedNights)),
    revenue: summarize(kpis.map((kpi) => kpi.revenue)),
    occupancy: summarize(kpis.map((kpi) => kpi.occupancy)),
    lostBedNights: summarize(kpis.map((kpi) => kpi.lostBedNights)),
    strandedBedNights: summarize(kpis.map((kpi) => kpi.strandedBedNights)),
    forcedSplits: summarize(kpis.map((kpi) => kpi.forcedSplits)),
  };
}

/** Compares the three Sapporo policies using shared demand for every seed. */
export function comparePolicies(
  seedCount = 200,
  demandRatios: readonly number[] = DEMAND_RATIOS,
  baseConfig: DemandConfig = DEFAULT_DEMAND_CONFIG,
): ComparisonResult {
  const rows: ComparisonRow[] = [];
  const beds = makeBeds();

  for (const demandRatio of demandRatios) {
    const kpisByPolicy = new Map<SimulationPolicy, Kpi[]>(
      SIMULATION_POLICIES.map((policy) => [policy, []]),
    );
    const config: DemandConfig = { ...baseConfig, demandRatio };
    for (let seed = 0; seed < seedCount; seed += 1) {
      const bookings = generateDemand(config, seed);
      for (const policy of SIMULATION_POLICIES) {
        const rooms = makeRooms(policy);
        const replayResult = replay(
          bookings,
          rooms,
          beds,
          policy as PropertyPolicy,
          PROPERTY,
        );
        kpisByPolicy.get(policy)?.push(
          calculateKpi({
            ...replayResult,
            nightlyRate: config.nightlyRate,
            totalCapacityBedNights: config.totalCapacityBedNights,
          }),
        );
      }
    }
    for (const policy of SIMULATION_POLICIES) {
      rows.push(
        summarizeKpis(demandRatio, policy, kpisByPolicy.get(policy) ?? []),
      );
    }
  }

  return { seedCount, rows };
}
