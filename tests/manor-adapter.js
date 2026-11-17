// tests/manor-adapter.js — TEST-ONLY helper (not a test file; node --test ignores it).
//
// Adapts whatever `js/manor.js` (and `js/rng.js`) actually export into one
// canonical manor shape so the property tests and the playtest harness do not
// depend on a single guessed API. The contract it expects is the one in
// `.kiro/specs/haunt/design.md`:
//
//   js/rng.js     — mulberry32(seed) PRNG + xmur3(string) seed hash
//   js/manor.js   — a generator function returning a manor object with
//                   rooms, corridors, doors, keys, relics, exit, spawn
//                   on a rectangular walkable grid, solvable by construction.
//
// Probing rules: try the documented/likely export names and field names in
// order; never silently invent data. Anything the adapter had to guess is
// recorded in `manor.assumptions` (array of strings) and surfaced in test
// output. If a required piece is genuinely absent, canonicalize() throws a
// MODULE_SHAPE error naming the missing piece — that is a game-code bug to
// report, not something to paper over.
//
// Canonical manor shape:
//   { seed, width, height, rooms:[{id,x,y,w,h,type,cx,cy}],
//     spawn:{x,y,roomId}, exit:{x,y,roomId},
//     relics:[{id,x,y,roomId}], keys:[{id,x,y,roomId}],
//     doors:[{id,x,y,keyId,locked}], walkable:Set<"x,y">,
//     isWalkable(x,y), roomAt(x,y), assumptions:[], raw }

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const JS_DIR = path.join(REPO_ROOT, 'js');

export class ModuleShapeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModuleShapeError';
    this.code = 'MODULE_SHAPE';
  }
}

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

async function importJs(name) {
  const p = path.join(JS_DIR, name);
  if (!fileExists(p)) {
    const err = new Error(`Game module not present yet: js/${name} does not exist (build agent has not landed it).`);
    err.code = 'MODULE_MISSING';
    throw err;
  }
  return import(new URL(`../js/${name}`, import.meta.url).href);
}

/** Resolve a function export, trying candidate names in order. */
export function pickFunction(mod, candidates) {
  for (const name of candidates) {
    if (typeof mod[name] === 'function') return { fn: mod[name], via: name };
  }
  if (typeof mod.default === 'function') return { fn: mod.default, via: 'default' };
  if (mod.default && typeof mod.default === 'object') {
    for (const name of candidates) {
      if (typeof mod.default[name] === 'function') return { fn: mod.default[name], via: `default.${name}` };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// rng.js
// ---------------------------------------------------------------------------

export async function loadRng() {
  const mod = await importJs('rng.js');
  const mulberry = pickFunction(mod, ['mulberry32', 'createRng', 'seededRandom', 'rng']);
  const xmur = pickFunction(mod, ['xmur3', 'hashSeed', 'hashString', 'seedHash']);
  return { mod, mulberry32: mulberry?.fn ?? null, mulberryVia: mulberry?.via ?? null, xmur3: xmur?.fn ?? null, xmurVia: xmur?.via ?? null };
}

// ---------------------------------------------------------------------------
// manor.js
// ---------------------------------------------------------------------------

export async function loadManorGenerator() {
  const mod = await importJs('manor.js');
  const picked = pickFunction(mod, ['generateManor', 'generate', 'createManor', 'buildManor']);
  if (!picked) {
    throw new ModuleShapeError(
      'js/manor.js exports no generator function (tried generateManor, generate, createManor, buildManor, default).',
    );
  }
  return { mod, generate: picked.fn, via: picked.via };
}

const asPos = (v) => {
  if (!v) return null;
  if (Array.isArray(v) && v.length >= 2) return { x: v[0], y: v[1] };
  if (typeof v.x === 'number' && typeof v.y === 'number') return { x: v.x, y: v.y };
  if (typeof v.col === 'number' && typeof v.row === 'number') return { x: v.col, y: v.row };
  return null;
};

const firstField = (obj, names) => {
  for (const n of names) if (obj && obj[n] !== undefined && obj[n] !== null) return obj[n];
  return undefined;
};

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v instanceof Set) return stableStringify([...v].sort());
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

const FLOOR_VALUES = new Set([0, '.', ' ', 'floor', 'F', '·', '0', false]);
const WALL_VALUES = new Set([1, '#', 'wall', 'W', '1', true]);
const DOOR_VALUES = new Set(['D', 'door', 'doorway']);

function gridCellWalkable(cell) {
  if (cell === null || cell === undefined) return false;
  if (typeof cell === 'object') {
    if (typeof cell.walkable === 'boolean') return cell.walkable;
    if (typeof cell.type === 'string') return !/wall/i.test(cell.type);
    if (typeof cell.tile === 'string') return FLOOR_VALUES.has(cell.tile) || DOOR_VALUES.has(cell.tile);
    return true;
  }
  if (DOOR_VALUES.has(cell)) return true;
  if (FLOOR_VALUES.has(cell)) return true;
  if (WALL_VALUES.has(cell)) return false;
  if (typeof cell === 'number') return cell === 0; // 0 = floor convention
  if (typeof cell === 'string') return cell !== '#';
  return false;
}

function gridCellIsDoor(cell) {
  if (typeof cell === 'string') return DOOR_VALUES.has(cell);
  if (cell && typeof cell === 'object') return /door/i.test(String(cell.type ?? cell.tile ?? ''));
  return false;
}

/**
 * Normalize one raw manor object into the canonical shape.
 * Throws ModuleShapeError naming the missing piece when it cannot.
 */
export function canonicalize(raw, seed) {
  if (!raw || typeof raw !== 'object') {
    throw new ModuleShapeError(`generateManor(${JSON.stringify(seed)}) returned ${raw === null ? 'null' : typeof raw} — expected a manor object.`);
  }
  const assumptions = [];
  const key = (x, y) => `${x},${y}`;

  // --- dimensions ---------------------------------------------------------
  const gridRaw = firstField(raw, ['grid', 'tiles', 'map', 'cells']);
  let width = firstField(raw, ['width', 'w', 'cols', 'columns']);
  let height = firstField(raw, ['height', 'h', 'rows']);
  if (Array.isArray(gridRaw) && gridRaw.length > 0) {
    height = height ?? gridRaw.length;
    width = width ?? (Array.isArray(gridRaw[0]) ? gridRaw[0].length : gridRaw[0]?.length);
  }
  if (typeof width !== 'number' || typeof height !== 'number') {
    throw new ModuleShapeError('Manor has no width/height and no 2D grid to infer them from.');
  }

  // --- rooms --------------------------------------------------------------
  const roomsRaw = firstField(raw, ['rooms']);
  if (!Array.isArray(roomsRaw) || roomsRaw.length === 0) {
    throw new ModuleShapeError('Manor has no `rooms` array (or it is empty).');
  }
  const rooms = roomsRaw.map((r, i) => {
    const rect = r.rect ?? r.bounds ?? r;
    const x = rect.x ?? rect.left ?? 0;
    const y = rect.y ?? rect.top ?? 0;
    const w = rect.w ?? rect.width ?? (rect.x2 !== undefined ? rect.x2 - x + 1 : undefined);
    const h = rect.h ?? rect.height ?? (rect.y2 !== undefined ? rect.y2 - y + 1 : undefined);
    if (typeof w !== 'number' || typeof h !== 'number') {
      throw new ModuleShapeError(`Room ${i} has no usable w/h (raw: ${JSON.stringify(r).slice(0, 120)}).`);
    }
    return {
      id: r.id ?? r.name ?? i,
      x, y, w, h,
      type: r.type ?? r.kind ?? r.name ?? 'Room',
      candleLit: r.candleLit ?? r.lit ?? r.safe ?? false,
      cx: r.cx ?? r.centerX ?? x + Math.floor(w / 2),
      cy: r.cy ?? r.centerY ?? y + Math.floor(h / 2),
    };
  });
  const roomAt = (x, y) => rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) ?? null;

  // --- walkable tiles -----------------------------------------------------
  // Real manor.js grid is a FLAT Uint8Array (length width*height) using the
  // TILE enum (WALL=0, FLOOR=1, KEY_DOOR=2, RIDDLE_DOOR=3): every non-wall
  // value is walkable, 2/3 are door tiles. 2D arrays / string rows are also
  // accepted as a fallback shape.
  const walkable = new Set();
  const doorTilesFromGrid = [];
  const flatGrid = gridRaw != null && typeof gridRaw.length === 'number'
    && gridRaw.length === width * height
    && (typeof gridRaw[0] === 'number' || gridRaw instanceof Uint8Array);
  if (flatGrid) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = gridRaw[y * width + x];
        if (v !== 0) walkable.add(key(x, y));
        if (v === 2 || v === 3) doorTilesFromGrid.push({ x, y });
      }
    }
  } else if (Array.isArray(gridRaw)) {
    for (let y = 0; y < gridRaw.length; y++) {
      const row = gridRaw[y];
      const cells = typeof row === 'string' ? [...row] : row;
      if (!Array.isArray(cells) && typeof row !== 'string') continue;
      for (let x = 0; x < cells.length; x++) {
        if (gridCellWalkable(cells[x])) walkable.add(key(x, y));
        if (gridCellIsDoor(cells[x])) doorTilesFromGrid.push({ x, y });
      }
    }
  } else {
    // No grid: walkable = union of room rects + corridor tiles/segments.
    for (const r of rooms) {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) walkable.add(key(x, y));
    }
    const corridors = firstField(raw, ['corridors', 'halls', 'passages']);
    if (Array.isArray(corridors)) {
      for (const c of corridors) {
        if (typeof c.x === 'number' && typeof c.y === 'number') walkable.add(key(c.x, c.y));
        else if (Array.isArray(c.points)) for (const p of c.points) { const q = asPos(p); if (q) walkable.add(key(q.x, q.y)); }
        else if (c.x1 !== undefined) {
          for (let x = Math.min(c.x1, c.x2); x <= Math.max(c.x1, c.x2); x++) walkable.add(key(x, c.y1 ?? c.y));
          for (let y = Math.min(c.y1, c.y2); y <= Math.max(c.y1, c.y2); y++) walkable.add(key(c.x2 ?? c.x, y));
        } else if (Array.isArray(c)) { const q = asPos(c); if (q) walkable.add(key(q.x, q.y)); }
      }
    } else {
      assumptions.push('no grid/corridors exported: walkable set derived from room rects only (corridor connectivity untestable)');
    }
  }

  // --- positions ----------------------------------------------------------
  const resolvePos = (v, label) => {
    if (!v) return null;
    const p = asPos(v);
    if (p) return p;
    if (typeof v === 'object') {
      const roomRef = v.room ?? v.roomId ?? v.roomIndex;
      const room = rooms.find((r) => r.id === roomRef) ?? rooms[roomRef];
      if (room) return { x: room.cx, y: room.cy };
      const inner = asPos(v.position ?? v.pos ?? v.tile);
      if (inner) return inner;
    }
    throw new ModuleShapeError(`Cannot resolve ${label} position from ${JSON.stringify(v).slice(0, 120)}.`);
  };

  const spawnRaw = firstField(raw, ['spawn', 'start', 'playerStart', 'spawnPoint', 'spawnRoom']);
  if (spawnRaw === undefined) throw new ModuleShapeError('Manor has no spawn/start position.');
  const spawnPos = resolvePos(spawnRaw, 'spawn');
  const spawnRoom = roomAt(spawnPos.x, spawnPos.y);
  const spawn = { ...spawnPos, roomId: spawnRoom?.id ?? null };

  const exitRaw = firstField(raw, ['exit', 'exitDoor', 'exitRoom', 'goal']);
  if (exitRaw === undefined) throw new ModuleShapeError('Manor has no exit position.');
  const exitPos = resolvePos(exitRaw, 'exit');
  const exitRoom = roomAt(exitPos.x, exitPos.y);
  const exit = { ...exitPos, roomId: exitRoom?.id ?? null };

  const relicsRaw = firstField(raw, ['relics', 'relicPositions']);
  if (!Array.isArray(relicsRaw) || relicsRaw.length === 0) {
    throw new ModuleShapeError('Manor has no `relics` array (or it is empty).');
  }
  const relics = relicsRaw.map((r, i) => {
    const p = resolvePos(r, `relic ${i}`);
    const room = roomAt(p.x, p.y);
    return { id: r.id ?? r.name ?? `relic-${i}`, ...p, roomId: room?.id ?? r.roomId ?? r.room ?? null };
  });

  const keysRaw = firstField(raw, ['keys']) ?? [];
  const keys = (Array.isArray(keysRaw) ? keysRaw : []).map((k, i) => {
    const p = resolvePos(k, `key ${i}`);
    const room = roomAt(p.x, p.y);
    return {
      id: k.id ?? k.keyId ?? k.name ?? `key-${i}`,
      doorId: k.doorId ?? k.opens ?? k.forDoor ?? null,
      ...p,
      roomId: room?.id ?? k.roomId ?? k.room ?? null,
    };
  });

  // --- doors --------------------------------------------------------------
  let doorsRaw = firstField(raw, ['doors', 'lockedDoors']);
  let doors = [];
  if (Array.isArray(doorsRaw)) {
    doors = doorsRaw.map((d, i) => {
      const p = resolvePos(d, `door ${i}`);
      // Real manor.js doors: {kind:'key'|'riddle', keyId?, open}. Only key
      // doors are key-locked; riddle doors are passable by answering.
      const kind = d.kind ?? (d.keyId !== undefined && d.keyId !== null ? 'key' : 'riddle');
      return {
        id: d.id ?? d.doorId ?? d.name ?? `door-${i}`,
        ...p,
        kind,
        keyId: kind === 'key' ? (d.keyId ?? d.key ?? d.opensWith ?? d.requiredKey ?? null) : null,
        locked: kind === 'key' ? (d.locked ?? d.isLocked ?? !d.open ?? true) : false,
      };
    });
  } else if (doorTilesFromGrid.length > 0) {
    doors = doorTilesFromGrid.map((p, i) => ({ id: `door-${i}`, ...p, kind: 'key', keyId: null, locked: true }));
    assumptions.push('doors taken from grid door tiles; no key linkage exported');
  }
  // Pair doors <-> keys when no explicit link exists.
  if (doors.length > 0 && keys.length > 0) {
    const linked = doors.filter((d) => d.keyId !== null && keys.some((k) => k.id === d.keyId || k.doorId === d.id));
    if (linked.length === 0) {
      if (doors.length === keys.length) {
        doors.forEach((d, i) => { d.keyId = keys[i].id; });
        assumptions.push(`door/key pairing inferred by array order (${doors.length} doors, ${keys.length} keys, no explicit keyId/doorId link exported)`);
      } else {
        assumptions.push(`no explicit door/key link exported (${doors.length} doors vs ${keys.length} keys) — pairing test will match by id only`);
      }
    }
  }

  const manor = {
    seed, width, height, rooms, spawn, exit, relics, keys, doors,
    walkable,
    isWalkable: (x, y) => walkable.has(key(x, y)),
    roomAt,
    assumptions,
    raw,
  };
  manor.canonicalJson = () => stableStringify({
    seed, width, height,
    rooms: rooms.map(({ id, x, y, w, h, type }) => ({ id, x, y, w, h, type })),
    spawn, exit, relics, keys, doors,
    walkable: [...walkable].sort(),
  });
  return manor;
}

/** Generate + canonicalize one manor for `seed`. */
export async function generateCanonical(generate, seed) {
  const raw = await generate(seed);
  return canonicalize(raw, seed);
}

// ---------------------------------------------------------------------------
// BFS helpers over the canonical manor
// ---------------------------------------------------------------------------

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Plain BFS from spawn. `isBlocked(x, y)` may forbid extra tiles (e.g. a door). Returns Set of "x,y". */
export function bfsReachable(manor, isBlocked = null) {
  const seen = new Set();
  const start = `${manor.spawn.x},${manor.spawn.y}`;
  if (!manor.isWalkable(manor.spawn.x, manor.spawn.y)) return seen;
  const queue = [[manor.spawn.x, manor.spawn.y]];
  seen.add(start);
  while (queue.length > 0) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      const k = `${nx},${ny}`;
      if (seen.has(k) || !manor.isWalkable(nx, ny)) continue;
      if (isBlocked && isBlocked(nx, ny)) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

/** Shortest path (list of {x,y}, excluding start, including goal) or null. */
export function bfsPath(manor, from, to, isBlocked = null) {
  const start = `${from.x},${from.y}`;
  const goal = `${to.x},${to.y}`;
  if (start === goal) return [];
  const prev = new Map([[start, null]]);
  const queue = [[from.x, from.y]];
  while (queue.length > 0) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      const k = `${nx},${ny}`;
      if (prev.has(k) || !manor.isWalkable(nx, ny)) continue;
      if (isBlocked && isBlocked(nx, ny)) continue;
      prev.set(k, `${x},${y}`);
      if (k === goal) {
        const path = [];
        let cur = k;
        while (cur !== start) {
          const [px, py] = cur.split(',').map(Number);
          path.unshift({ x: px, y: py });
          cur = prev.get(cur);
        }
        return path;
      }
      queue.push([nx, ny]);
    }
  }
  return null;
}

/**
 * State-space BFS that simulates key collection: state = (tile, keyMask).
 * Doors block unless their key is held. Returns:
 *   { canWin, reachedRelics:Set(id), reachedExit:boolean, reachedKeys:Set(id),
 *     visitedStates:number, winPath } — winPath is a tile path that collects
 *   all relics then reaches the exit, or null.
 * `opts.forceClosed` ({x,y}) forces one door tile shut for the whole search
 * (used by the door/key pairing test: the key must be reachable without
 * passing its own door).
 */
export function bfsWithKeys(manor, opts = {}) {
  const keyIndex = new Map(manor.keys.map((k, i) => [k.id, i]));
  const doorAt = new Map(manor.doors.filter((d) => d.locked).map((d) => [`${d.x},${d.y}`, d]));
  // Tile -> ALL keys/relics on it. Several keys may share one tile (the
  // generator places keys at room centres, and two key rooms can coincide);
  // a single-key-per-tile map would silently drop all but one.
  const keysAt = new Map();
  for (const k of manor.keys) {
    const arr = keysAt.get(`${k.x},${k.y}`) ?? [];
    arr.push(k);
    keysAt.set(`${k.x},${k.y}`, arr);
  }
  const relicsAt = new Map();
  for (const r of manor.relics) {
    const arr = relicsAt.get(`${r.x},${r.y}`) ?? [];
    arr.push(r);
    relicsAt.set(`${r.x},${r.y}`, arr);
  }
  const exitKey = `${manor.exit.x},${manor.exit.y}`;

  const startKey = `${manor.spawn.x},${manor.spawn.y}|0|0`;
  const seen = new Set([startKey]);
  const prev = new Map([[startKey, null]]);
  const queue = [{ x: manor.spawn.x, y: manor.spawn.y, mask: 0, rmask: 0 }];
  let best = null; // first state with all relics + exit (BFS => shortest)

  // State tracks collected relics too (relic bitmask in the state key):
  // collection is monotonic, and a relic tile may be passed before/after
  // detours, so (tile, keyMask, relicMask) is the full state.
  const relicIndex = new Map(manor.relics.map((r, i) => [r.id, i]));
  const stateKey = (x, y, mask, rmask) => `${x},${y}|${mask}|${rmask}`;

  const reachedKeys = new Set();
  const reachedRelics = new Set();
  let reachedExit = false;

  while (queue.length > 0) {
    const s = queue.shift();
    for (const kHere of keysAt.get(`${s.x},${s.y}`) ?? []) reachedKeys.add(kHere.id);
    for (const rHere of relicsAt.get(`${s.x},${s.y}`) ?? []) reachedRelics.add(rHere.id);
    if (`${s.x},${s.y}` === exitKey) reachedExit = true;
    const allRelics = (1 << manor.relics.length) - 1;
    if (s.rmask === allRelics && `${s.x},${s.y}` === exitKey) { best = s; break; }

    for (const [dx, dy] of DIRS) {
      const nx = s.x + dx, ny = s.y + dy;
      if (!manor.isWalkable(nx, ny)) continue;
      if (opts.forceClosed && nx === opts.forceClosed.x && ny === opts.forceClosed.y) continue;
      const door = doorAt.get(`${nx},${ny}`);
      if (door) {
        const ki = keyIndex.get(door.keyId);
        if (ki === undefined || !(s.mask & (1 << ki))) continue; // locked, key not held
      }
      let nmask = s.mask, nrmask = s.rmask;
      for (const kk of keysAt.get(`${nx},${ny}`) ?? []) {
        if (keyIndex.has(kk.id)) nmask |= 1 << keyIndex.get(kk.id);
      }
      for (const rr of relicsAt.get(`${nx},${ny}`) ?? []) {
        if (relicIndex.has(rr.id)) nrmask |= 1 << relicIndex.get(rr.id);
      }
      const sk = stateKey(nx, ny, nmask, nrmask);
      if (seen.has(sk)) continue;
      seen.add(sk);
      prev.set(sk, stateKey(s.x, s.y, s.mask, s.rmask));
      queue.push({ x: nx, y: ny, mask: nmask, rmask: nrmask });
    }
  }

  let winPath = null;
  if (best) {
    winPath = [];
    let cur = stateKey(best.x, best.y, best.mask, best.rmask);
    const tiles = [];
    while (cur !== null) {
      const [xy] = cur.split('|');
      const [px, py] = xy.split(',').map(Number);
      tiles.unshift({ x: px, y: py });
      cur = prev.get(cur);
    }
    // Collapse consecutive duplicates (same tile, different key/relic mask).
    for (const t of tiles) {
      const last = winPath[winPath.length - 1];
      if (!last || last.x !== t.x || last.y !== t.y) winPath.push(t);
    }
    winPath.shift(); // drop spawn tile
  }
  return {
    canWin: best !== null,
    reachedRelics, reachedExit, reachedKeys,
    visitedStates: seen.size,
    winPath,
  };
}
