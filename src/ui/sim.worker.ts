import type { Bed, Property, PropertyPolicy, Room } from '../engine/types';
import { generateDemand, type DemandConfig } from '../sim/demand';
import { calculateKpi } from '../sim/kpi';
import { replay } from '../sim/replay';
import {
  GROUP_PRESETS,
  STAY_PRESETS,
  type GroupPreset,
  type StayPreset,
} from './sim-presets';
import type { RoomSpec, SiteConfig } from './store';

export type ScenarioId = 'same_gender' | 'hybrid' | 'mixed';

export interface AdvancedDemand {
  maleRatio: number;
  stayPreset: StayPreset;
  groupPreset: GroupPreset;
}

export interface SimulationRequest {
  type: 'start';
  siteConfig: SiteConfig;
  demandPercent: number;
  seedCount: number;
  advanced: AdvancedDemand;
}

export interface SimulationRow {
  scenario: ScenarioId;
  occupancy: number;
  revenue: number;
  strandedBedNights: number;
  forcedSplits: number;
}

export type SimulationResponse =
  | { type: 'progress'; completed: number; total: number }
  | { type: 'result'; rows: SimulationRow[]; elapsedMs: number }
  | { type: 'error'; message: string };

const SCENARIOS: readonly ScenarioId[] = ['same_gender', 'hybrid', 'mixed'];

function makeRooms(roomSpecs: readonly RoomSpec[], scenario: ScenarioId): Room[] {
  return roomSpecs.map((room, index) => ({
    id: `room-${index}`,
    propertyId: 'property-1',
    code: room.code,
    roomType:
      scenario === 'mixed' || (scenario === 'hybrid' && room.mixed)
        ? 'mixed'
        : 'same_gender',
    sortOrder: index,
  }));
}

function makeBeds(roomSpecs: readonly RoomSpec[]): Bed[] {
  return roomSpecs.flatMap((room, roomIndex) =>
    Array.from({ length: room.beds }, (_, bedIndex) => ({
      id: `room-${roomIndex}-bed-${bedIndex}`,
      roomId: `room-${roomIndex}`,
      code: `${bedIndex + 1}`,
      position: 'single' as const,
      outOfServiceFrom: null,
      outOfServiceTo: null,
    })),
  );
}

function propertyFor(siteName: string, scenario: ScenarioId): Property {
  return {
    id: 'property-1',
    name: siteName,
    defaultPolicy: scenario as PropertyPolicy,
    pendingPolicy: null,
    pendingPolicyFrom: null,
  };
}

/** Runs the deterministic comparison without depending on the Worker environment. */
export function runSimulation(
  request: SimulationRequest,
  onProgress: (completed: number, total: number) => void = () => undefined,
): SimulationRow[] {
  const totalBeds = request.siteConfig.rooms.reduce((sum, room) => sum + room.beds, 0);
  const totalCapacityBedNights = totalBeds * request.siteConfig.seasonNights;
  const demandConfig: DemandConfig = {
    horizonNights: request.siteConfig.seasonNights,
    totalCapacityBedNights,
    demandRatio: request.demandPercent / 100,
    nightlyRate: request.siteConfig.nightlyRate,
    maleRatio: request.advanced.maleRatio / 100,
    sameGenderGroupProb: 0.7,
    stayNights: STAY_PRESETS[request.advanced.stayPreset],
    groupSize: GROUP_PRESETS[request.advanced.groupPreset],
    leadTimeMeanDays: 14,
  };
  const beds = makeBeds(request.siteConfig.rooms);
  const totals = new Map<ScenarioId, Omit<SimulationRow, 'scenario'>>(
    SCENARIOS.map((scenario) => [
      scenario,
      { occupancy: 0, revenue: 0, strandedBedNights: 0, forcedSplits: 0 },
    ]),
  );

  for (let seed = 0; seed < request.seedCount; seed += 1) {
    const bookings = generateDemand(demandConfig, seed);
    for (const scenario of SCENARIOS) {
      const result = replay(
        bookings,
        makeRooms(request.siteConfig.rooms, scenario),
        beds,
        scenario as PropertyPolicy,
        propertyFor(request.siteConfig.siteName, scenario),
      );
      const kpi = calculateKpi({
        ...result,
        nightlyRate: request.siteConfig.nightlyRate,
        totalCapacityBedNights,
      });
      const total = totals.get(scenario);
      if (total !== undefined) {
        total.occupancy += kpi.occupancy;
        total.revenue += kpi.revenue;
        total.strandedBedNights += kpi.strandedBedNights;
        total.forcedSplits += kpi.forcedSplits;
      }
    }
    onProgress(seed + 1, request.seedCount);
  }

  return SCENARIOS.map((scenario) => {
    const total = totals.get(scenario);
    if (total === undefined) {
      throw new Error('模擬結果不完整，請再試一次。');
    }
    return {
      scenario,
      occupancy: total.occupancy / request.seedCount,
      revenue: total.revenue / request.seedCount,
      strandedBedNights: total.strandedBedNights / request.seedCount,
      forcedSplits: total.forcedSplits / request.seedCount,
    };
  });
}

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  self.addEventListener('message', (event: MessageEvent<SimulationRequest>) => {
    if (event.data.type !== 'start') {
      return;
    }
    const startedAt = performance.now();
    try {
      const rows = runSimulation(event.data, (completed, total) => {
        self.postMessage({ type: 'progress', completed, total } satisfies SimulationResponse);
      });
      self.postMessage({
        type: 'result',
        rows,
        elapsedMs: performance.now() - startedAt,
      } satisfies SimulationResponse);
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : '計算失敗，請再試一次。',
      } satisfies SimulationResponse);
    }
  });
}
