import { DEFAULT_DEMAND_CONFIG } from '../sim/demand';

export type StayPreset = 'short' | 'balanced' | 'long';
export type GroupPreset = 'solo' | 'balanced' | 'group';
export type WeightedDistribution = ReadonlyArray<[number, number]>;

export const STAY_PRESETS: Record<StayPreset, WeightedDistribution> = {
  short: [
    [1, 0.15],
    [2, 0.25],
    [3, 0.25],
    [4, 0.15],
    [5, 0.08],
    [6, 0.05],
    [7, 0.05],
    [14, 0.02],
    [30, 0],
  ],
  balanced: DEFAULT_DEMAND_CONFIG.stayNights,
  long: [
    [1, 0.02],
    [2, 0.05],
    [3, 0.08],
    [4, 0.1],
    [5, 0.1],
    [6, 0.1],
    [7, 0.2],
    [14, 0.2],
    [30, 0.15],
  ],
};

export const GROUP_PRESETS: Record<GroupPreset, WeightedDistribution> = {
  solo: [
    [1, 0.5],
    [2, 0.3],
    [3, 0.15],
    [4, 0.05],
  ],
  balanced: DEFAULT_DEMAND_CONFIG.groupSize,
  group: [
    [1, 0.15],
    [2, 0.3],
    [3, 0.3],
    [4, 0.25],
  ],
};

export const STAY_PRESET_NAMES: Record<StayPreset, string> = {
  short: '短住為主',
  balanced: '平衡',
  long: '長住為主',
};

export const GROUP_PRESET_NAMES: Record<GroupPreset, string> = {
  solo: '多獨行客',
  balanced: '平衡',
  group: '多團體',
};

export function expectedValue(distribution: WeightedDistribution): number {
  return distribution.reduce(
    (sum, [value, probability]) => sum + value * probability,
    0,
  );
}
