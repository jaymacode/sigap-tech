/**
 * PRNG deterministik (mulberry32) — seed tetap agar data demo selalu sama (DATA_MODEL.md §Seed).
 */
export interface Rng {
  /** Angka [0, 1). */
  next(): number;
  /** Integer [min, max] inklusif. */
  int(min: number, max: number): number;
  /** Elemen acak dari array tidak kosong. */
  pick<T>(items: readonly T[]): T;
  /** Pilih berdasarkan bobot. */
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T;
  /** true dengan probabilitas p. */
  chance(p: number): boolean;
}

/**
 * Membuat PRNG deterministik.
 * @param seed - seed integer
 * @throws Error jika `pick`/`weighted` dipanggil dengan array kosong
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick() dari array kosong');
      return items[Math.floor(next() * items.length)] as T;
    },
    weighted: <T>(entries: ReadonlyArray<readonly [T, number]>): T => {
      if (entries.length === 0) throw new Error('weighted() dari array kosong');
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return entries[entries.length - 1]![0];
    },
    chance: (p) => next() < p,
  };
}
