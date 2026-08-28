/** Creates a deterministic Mulberry32 pseudo-random number generator. */
export function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return (): number => {
    value = (value + 0x6d2b79f5) >>> 0;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}
