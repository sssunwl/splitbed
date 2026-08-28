/** Creates a deterministic Mulberry32 pseudo-random number generator. */
export function makeRng(seed: number): () => number {
  let value = seed >>> 0;
  return (): number => {
    value = (value + 0x6d2b79f5) >>> 0;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Returns a uniformly distributed integer in [lo, hiExclusive). */
export function randInt(
  rng: () => number,
  lo: number,
  hiExclusive: number,
): number {
  return lo + Math.floor(rng() * (hiExclusive - lo));
}

/** Selects a value according to the non-negative weights in table. */
export function pickWeighted<T>(
  rng: () => number,
  table: ReadonlyArray<readonly [T, number]>,
): T {
  if (table.length === 0) {
    throw new Error('Weighted table must not be empty');
  }
  const totalWeight = table.reduce((sum, [, weight]) => sum + weight, 0);
  let remaining = rng() * totalWeight;
  for (const [value, weight] of table) {
    remaining -= weight;
    if (remaining < 0) {
      return value;
    }
  }
  return table[table.length - 1][0];
}

/** Samples a geometric distribution on positive integers with the given mean. */
export function geometric(rng: () => number, mean: number): number {
  if (mean <= 1) {
    return 1;
  }
  const probability = 1 / mean;
  return Math.floor(Math.log1p(-rng()) / Math.log1p(-probability)) + 1;
}
