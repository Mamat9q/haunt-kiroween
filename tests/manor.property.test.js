// tests/manor.property.test.js — property tests for the HAUNT manor generator.
//
// Run: `npm test`  (node --test tests/)
// Gates (design.md / requirements.md §5): determinism, connectivity,
// solvability (relics + exit + keys, with key/door ordering), relic
// placement, door/key pairing — over >= 30 seeds.
//
// The tests import the REAL game modules via tests/manor-adapter.js, which
// normalizes whatever js/manor.js actually exports (see the adapter header
// for the probing rules). If a module has not landed yet, every test fails
// with a MODULE_MISSING / MODULE_SHAPE error naming the missing piece —
// that is a dependency report, not a passing suite.

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadManorGenerator,
  loadRng,
  generateCanonical,
  bfsReachable,
  bfsWithKeys,
} from './manor-adapter.js';

// 30 generated seeds + 6 edge-case seeds = 36 seeds total.
const SEEDS = [
  ...Array.from({ length: 30 }, (_, i) => `haunt-${String(i).padStart(3, '0')}`),
  '', // empty seed
  'a', // single char
  '0', // numeric-looking
  'daily-2026-11-17', // daily-manor shape
  'HAUNT! #Kiroween2026', // punctuation / mixed case
  'x'.repeat(128), // very long seed
];

let generate = null; // (seed) => raw manor
let generateVia = null;
let loadError = null;
let rng = null;

before(async () => {
  try {
    const m = await loadManorGenerator();
    generate = m.generate;
    generateVia = m.via;
  } catch (e) {
    loadError = e;
  }
  try {
    rng = await loadRng();
  } catch {
    rng = null; // rng is tested opportunistically; manor tests do not depend on it
  }
});

function requireLoaded() {
  assert.ok(!loadError, `manor module failed to load: ${loadError?.message ?? loadError}`);
  assert.equal(typeof generate, 'function', 'no generator function resolved');
}

async function manorFor(seed) {
  requireLoaded();
  return generateCanonical(generate, seed);
}

describe('manor generator — module contract', () => {
  test('js/manor.js loads and exports a generator function', () => {
    requireLoaded();
    assert.match(generateVia, /generateManor|generate|createManor|buildManor|default/);
  });

  test('js/rng.js loads with mulberry32 + xmur3 (if present)', () => {
    if (!rng) {
      // rng.js missing entirely — manor determinism below still covers the
      // seeded-RNG behaviour end to end; report, do not hard-fail here.
      console.warn('  [warn] js/rng.js not loadable yet; skipping direct PRNG checks');
      return;
    }
    assert.equal(typeof rng.mulberry32, 'function', `rng.js: mulberry32 missing (exports probed via ${rng.mulberryVia})`);
    assert.equal(typeof rng.xmur3, 'function', `rng.js: xmur3 missing (exports probed via ${rng.xmurVia})`);
    // Same seed -> same sequence; different seed -> different sequence.
    const seq = (fn) => Array.from({ length: 5 }, () => fn());
    const a = seq(rng.mulberry32(rng.xmur3('haunt-000')()));
    const b = seq(rng.mulberry32(rng.xmur3('haunt-000')()));
    const c = seq(rng.mulberry32(rng.xmur3('haunt-001')()));
    assert.deepEqual(a, b, 'mulberry32 is not deterministic for the same seed hash');
    assert.notDeepEqual(a, c, 'mulberry32 gives identical output for different seeds');
    for (const v of a) assert.ok(v >= 0 && v < 1, `mulberry32 out of [0,1): ${v}`);
  });
});

describe('determinism — same seed produces byte-identical manor', () => {
  for (const seed of SEEDS) {
    test(`seed ${JSON.stringify(seed)}`, async () => {
      const first = await manorFor(seed);
      const second = await manorFor(seed);
      assert.equal(
        second.canonicalJson(), first.canonicalJson(),
        `manor for seed ${JSON.stringify(seed)} is NOT deterministic (canonical form differs between two generations)`,
      );
      // The raw object must be deterministic too — a timestamp / Math.random()
      // leak in the generator is a real bug even if the canonical form hides it.
      const rawA = JSON.stringify(await generate(seed));
      const rawB = JSON.stringify(await generate(seed));
      assert.equal(rawB, rawA, `manor for seed ${JSON.stringify(seed)} is NOT byte-identical at the raw level`);
      if (first.assumptions.length > 0) {
        console.warn(`  [warn] seed ${JSON.stringify(seed)} adapter assumptions: ${first.assumptions.join('; ')}`);
      }
    });
  }
});

describe('connectivity — every room reachable from spawn', () => {
  for (const seed of SEEDS) {
    test(`seed ${JSON.stringify(seed)}`, async () => {
      const manor = await manorFor(seed);
      const reachable = bfsReachable(manor); // doors treated as passable
      assert.ok(reachable.size > 0, 'spawn tile itself is not walkable — BFS found nothing');
      const unreachable = manor.rooms.filter((r) => {
        // A room is reachable if ANY of its tiles is reachable.
        for (let y = r.y; y < r.y + r.h; y++) {
          for (let x = r.x; x < r.x + r.w; x++) if (reachable.has(`${x},${y}`)) return false;
        }
        return true;
      });
      assert.deepEqual(
        unreachable.map((r) => r.id), [],
        `unreachable room(s) for seed ${JSON.stringify(seed)}: ${unreachable.map((r) => `${r.id} (${r.type} @${r.x},${r.y} ${r.w}x${r.h})`).join(', ')}`,
      );
      assert.ok(
        reachable.has(`${manor.exit.x},${manor.exit.y}`),
        `exit tile (${manor.exit.x},${manor.exit.y}) unreachable from spawn for seed ${JSON.stringify(seed)}`,
      );
    });
  }
});

describe('solvability — all relics + exit winnable with key/door ordering', () => {
  for (const seed of SEEDS) {
    test(`seed ${JSON.stringify(seed)}`, async () => {
      const manor = await manorFor(seed);
      const result = bfsWithKeys(manor);
      assert.ok(
        result.reachedKeys.size >= manor.keys.length || manor.keys.length === 0,
        `seed ${JSON.stringify(seed)}: only ${result.reachedKeys.size}/${manor.keys.length} keys reachable ` +
          `(missing: ${manor.keys.filter((k) => !result.reachedKeys.has(k.id)).map((k) => k.id).join(', ')})`,
      );
      assert.deepEqual(
        [...result.reachedRelics].sort(), manor.relics.map((r) => r.id).sort(),
        `seed ${JSON.stringify(seed)}: not all relics reachable with key ordering ` +
          `(reached: ${[...result.reachedRelics].join(', ') || 'none'}; ` +
          `missing: ${manor.relics.filter((r) => !result.reachedRelics.has(r.id)).map((r) => r.id).join(', ')})`,
      );
      assert.ok(result.reachedExit, `seed ${JSON.stringify(seed)}: exit unreachable even after collecting reachable relics/keys`);
      assert.ok(result.canWin, `seed ${JSON.stringify(seed)}: NO winning path exists (all 3 relics + exit with key ordering)`);
      assert.ok(
        Array.isArray(result.winPath) && result.winPath.length > 0,
        `seed ${JSON.stringify(seed)}: solver claims winnable but produced no win path`,
      );
    });
  }
});

describe('relic placement — 3 relics, 3 distinct rooms, none in spawn room', () => {
  for (const seed of SEEDS) {
    test(`seed ${JSON.stringify(seed)}`, async () => {
      const manor = await manorFor(seed);
      assert.equal(manor.relics.length, 3, `seed ${JSON.stringify(seed)}: expected 3 relics, got ${manor.relics.length}`);
      const rooms = manor.relics.map((r) => r.roomId);
      assert.equal(
        new Set(rooms).size, 3,
        `seed ${JSON.stringify(seed)}: relics share rooms (rooms: ${rooms.join(', ')})`,
      );
      assert.ok(
        !rooms.includes(manor.spawn.roomId),
        `seed ${JSON.stringify(seed)}: a relic is in the spawn room (${manor.spawn.roomId})`,
      );
      for (const r of manor.relics) {
        assert.ok(manor.isWalkable(r.x, r.y), `seed ${JSON.stringify(seed)}: relic ${r.id} sits on a non-walkable tile (${r.x},${r.y})`);
        assert.notDeepEqual([r.x, r.y], [manor.spawn.x, manor.spawn.y], `seed ${JSON.stringify(seed)}: relic ${r.id} sits on the spawn tile`);
      }
      // Exit must not be in the spawn room either (farthest-room rule).
      assert.notEqual(manor.exit.roomId, manor.spawn.roomId, `seed ${JSON.stringify(seed)}: exit is in the spawn room`);
    });
  }
});

describe('door/key pairing — every locked door has its key reachable without passing that door', () => {
  for (const seed of SEEDS) {
    test(`seed ${JSON.stringify(seed)}`, async () => {
      const manor = await manorFor(seed);
      const locked = manor.doors.filter((d) => d.locked && d.kind === 'key');
      if (locked.length === 0) {
        console.warn(`  [warn] seed ${JSON.stringify(seed)}: manor has no locked key doors — pairing vacuously true`);
        return;
      }
      for (const door of locked) {
        const key = manor.keys.find((k) => k.id === door.keyId);
        assert.ok(key, `seed ${JSON.stringify(seed)}: locked door ${door.id} @(${door.x},${door.y}) has no matching key (keyId=${door.keyId}; keys: ${manor.keys.map((k) => k.id).join(', ') || 'none'})`);
        // State-space BFS (keys collected along the way, other key doors
        // respected) with THIS door forced shut: its key must be reachable
        // without ever passing through that door.
        const result = bfsWithKeys(manor, { forceClosed: { x: door.x, y: door.y } });
        assert.ok(
          result.reachedKeys.has(key.id),
          `seed ${JSON.stringify(seed)}: key ${key.id} for door ${door.id} @(${door.x},${door.y}) is NOT reachable without passing that door (key @${key.x},${key.y} room ${key.roomId})`,
        );
        assert.ok(manor.isWalkable(key.x, key.y), `seed ${JSON.stringify(seed)}: key ${key.id} sits on a non-walkable tile`);
      }
      // No two locked key doors share one key.
      const keyIds = locked.map((d) => d.keyId);
      assert.equal(new Set(keyIds).size, keyIds.length, `seed ${JSON.stringify(seed)}: two locked doors share a key (${keyIds.join(', ')})`);
    });
  }
});

describe('manor shape sanity', () => {
  for (const seed of SEEDS) {
    test(`seed ${JSON.stringify(seed)}`, async () => {
      const manor = await manorFor(seed);
      assert.ok(manor.width > 0 && manor.height > 0, 'manor has non-positive dimensions');
      assert.ok(manor.rooms.length >= 4, `seed ${JSON.stringify(seed)}: only ${manor.rooms.length} rooms (expected >= 4)`);
      assert.ok(manor.isWalkable(manor.spawn.x, manor.spawn.y), 'spawn tile is not walkable');
      assert.ok(manor.isWalkable(manor.exit.x, manor.exit.y), 'exit tile is not walkable');
      assert.ok(manor instanceof Object && typeof manor.canonicalJson === 'function', 'adapter did not return a canonical manor');
      if (manor.raw && typeof manor.raw === 'object' && manor.raw.grid) {
        assert.ok(true); // grid-backed manor: walkable set came from the grid
      }
      assert.ok(
        manor.assumptions.length === 0 || manor.assumptions.every((a) => typeof a === 'string'),
        'adapter assumptions malformed',
      );
    });
  }
});
