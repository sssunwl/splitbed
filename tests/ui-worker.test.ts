import { describe, expect, it } from 'vitest';

import {
  runSimulation,
  type ScenarioId,
  type SimulationRequest,
} from '../src/ui/sim.worker';

describe('ui simulation worker', () => {
  it('matches the CLI baseline with all default values', () => {
    const request: SimulationRequest = {
      type: 'start',
      siteConfig: {
        siteName: '札幌',
        rooms: [
          { code: 'A', beds: 2, mixed: false },
          { code: 'B', beds: 4, mixed: true },
          { code: 'C', beds: 3, mixed: false },
          { code: 'D', beds: 3, mixed: false },
        ],
        nightlyRate: 5_000,
        seasonNights: 90,
      },
      demandPercent: 100,
      seedCount: 200,
      advanced: {
        maleRatio: 60,
        stayPreset: 'balanced',
        groupPreset: 'balanced',
      },
    };
    const revenueByScenario = new Map<ScenarioId, number>(
      runSimulation(request).map((row) => [row.scenario, row.revenue]),
    );

    expect(revenueByScenario.get('same_gender')).toBe(3_367_425);
    expect(revenueByScenario.get('hybrid')).toBe(3_522_250);
    expect(revenueByScenario.get('mixed')).toBe(3_621_125);
  });
});
