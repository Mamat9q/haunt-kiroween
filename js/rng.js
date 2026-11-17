// rng.js — seeded PRNG for HAUNT. ALL game-logic randomness flows from here.
// Never use Math.random() in game logic (cosmetic fog/flicker only, in render.js).

/** xmur3 string hash — returns a function that yields a 32-bit seed. */
export function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function seed() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/** mulberry32 — small fast seeded PRNG. Returns a function yielding [0, 1). */
export function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One-shot 32-bit hash of a seed string. */
export function hashSeed(str) {
  return xmur3(String(str))();
}

/**
 * Create a seeded RNG bound to a seed string.
 * @param {string} seedString
 * @returns {{seed:number, next:()=>number, nextInt:(min:number,max:number)=>number,
 *   pick:(arr:any[])=>any, shuffle:(arr:any[])=>any[], chance:(p:number)=>boolean,
 *   range:(min:number,max:number)=>number}}
 */
export function createRng(seedString) {
  const seed = xmur3(String(seedString))();
  const next = mulberry32(seed);
  return {
    seed,
    next,
    nextInt(min, max) {
      // inclusive min, exclusive max
      return min + Math.floor(next() * (max - min));
    },
    range(min, max) {
      return min + next() * (max - min);
    },
    chance(p) {
      return next() < p;
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}
