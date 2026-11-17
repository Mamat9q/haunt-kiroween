// manor.js — seeded procedural manor generator for HAUNT.
// Solvable by construction (spanning-tree corridors) + BFS verification with
// key/door logic simulated; re-rolls (same seed + attempt counter) on failure.

import { createRng } from './rng.js';

export const TILE = { WALL: 0, FLOOR: 1, KEY_DOOR: 2, RIDDLE_DOOR: 3 };

export const ROOM_TYPES = [
  'Foyer', 'Library', 'Kitchen', 'Chapel', 'Cellar', 'Bedroom', 'Gallery', 'Study',
];

export const RELIC_NAMES = ['Obsidian Mirror', 'Bone Choir Bell', 'Waxen Heart'];

export const RIDDLES = [
  {
    q: 'I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?',
    choices: ['An echo', 'A candle', 'A mirror'],
    answer: 0,
  },
  {
    q: 'The more of me you take, the more you leave behind. What am I?',
    choices: ['Footsteps', 'Darkness', 'Dust'],
    answer: 0,
  },
  {
    q: 'I am always hungry and must be fed. The finger I touch will soon turn red. What am I?',
    choices: ['Fire', 'A rat', 'The Warden'],
    answer: 0,
  },
  {
    q: 'What has keys but cannot open a single lock?',
    choices: ['A piano', 'A diary', 'A coffin'],
    answer: 0,
  },
  {
    q: 'I have cities but no houses, forests but no trees, rivers without water. What am I?',
    choices: ['A map', 'A dream', 'A grave'],
    answer: 0,
  },
  {
    q: 'What can you catch but never throw?',
    choices: ['A cold', 'A ghost', 'A candle'],
    answer: 0,
  },
];

const KEY_NAMES = ['Brass Key', 'Iron Key'];

function idx(w, x, y) {
  return y * w + x;
}

/**
 * Pick a tile for a new key in `room`: its centre, unless another key already
 * sits there, in which case the nearest free floor tile in the same room
 * (closest first, row-major tie-break), then — if the room is somehow full —
 * the nearest free floor tile anywhere, found by expanding rings.
 * Returns {x, y}; never a tile already holding a key.
 */
function pickDistinctKeyTile(grid, width, room, keys) {
  const height = grid.length / width;
  const occupied = (x, y) => keys.some((k) => k.x === x && k.y === y);
  const free = (x, y) => x >= 0 && y >= 0 && x < width && y < height
    && grid[idx(width, x, y)] === TILE.FLOOR && !occupied(x, y);
  if (free(room.cx, room.cy)) return { x: room.cx, y: room.cy };
  const inRoom = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (free(x, y)) inRoom.push({ x, y, d: Math.hypot(x - room.cx, y - room.cy) });
    }
  }
  inRoom.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  if (inRoom.length) return { x: inRoom[0].x, y: inRoom[0].y };
  for (let r = 1; r < Math.max(width, height); r++) {
    for (let y = room.cy - r; y <= room.cy + r; y++) {
      for (let x = room.cx - r; x <= room.cx + r; x++) {
        if (Math.max(Math.abs(x - room.cx), Math.abs(y - room.cy)) !== r) continue;
        if (free(x, y)) return { x, y };
      }
    }
  }
  return { x: room.cx, y: room.cy }; // unreachable in practice: rooms hold >= 12 tiles
}

function carveCorridor(grid, w, ax, ay, bx, by, rng, outTiles) {
  // L-shaped corridor, horizontal first or vertical first (seeded).
  let x = ax;
  let y = ay;
  const horizFirst = rng.chance(0.5);
  const stepX = () => {
    while (x !== bx) {
      x += Math.sign(bx - x);
      if (grid[idx(w, x, y)] === TILE.WALL) {
        grid[idx(w, x, y)] = TILE.FLOOR;
        outTiles.push({ x, y });
      }
    }
  };
  const stepY = () => {
    while (y !== by) {
      y += Math.sign(by - y);
      if (grid[idx(w, x, y)] === TILE.WALL) {
        grid[idx(w, x, y)] = TILE.FLOOR;
        outTiles.push({ x, y });
      }
    }
  };
  if (horizFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
}

function buildManor(seedString, attempt, options) {
  const rng = createRng(`${seedString}::manor::${attempt}`);
  const width = options.width || 28;
  const height = options.height || 20;
  const grid = new Uint8Array(width * height); // all WALL

  // --- place rooms (random-rect packing, 1-tile gap) ---
  const rooms = [];
  const targetRooms = options.rooms || 9;
  for (let n = 0; n < targetRooms; n++) {
    let placed = null;
    for (let t = 0; t < 220 && !placed; t++) {
      const rw = rng.nextInt(4, 8);
      const rh = rng.nextInt(3, 6);
      const rx = rng.nextInt(1, width - rw - 1);
      const ry = rng.nextInt(1, height - rh - 1);
      const clash = rooms.some(
        (r) => rx < r.x + r.w + 1 && rx + rw + 1 > r.x && ry < r.y + r.h + 1 && ry + rh + 1 > r.y,
      );
      if (!clash) placed = { x: rx, y: ry, w: rw, h: rh };
    }
    if (!placed) break;
    placed.id = rooms.length;
    placed.cx = placed.x + Math.floor(placed.w / 2);
    placed.cy = placed.y + Math.floor(placed.h / 2);
    rooms.push(placed);
    for (let y = placed.y; y < placed.y + placed.h; y++) {
      for (let x = placed.x; x < placed.x + placed.w; x++) grid[idx(width, x, y)] = TILE.FLOOR;
    }
  }
  if (rooms.length < 7) return null;

  // --- connect rooms with a spanning chain + a couple of loops ---
  const connections = [];
  for (let i = 1; i < rooms.length; i++) {
    const tiles = [];
    carveCorridor(grid, width, rooms[i - 1].cx, rooms[i - 1].cy, rooms[i].cx, rooms[i].cy, rng, tiles);
    connections.push({ a: i - 1, b: i, tiles });
  }
  for (let i = 0; i < 2; i++) {
    const a = rng.nextInt(0, rooms.length);
    const b = rng.nextInt(0, rooms.length);
    if (a === b) continue;
    const tiles = [];
    carveCorridor(grid, width, rooms[a].cx, rooms[a].cy, rooms[b].cx, rooms[b].cy, rng, tiles);
    connections.push({ a, b, tiles });
  }

  // --- room types: room 0 is always the Foyer (spawn) ---
  const shuffledTypes = rng.shuffle(ROOM_TYPES.slice(1));
  rooms.forEach((r, i) => {
    r.type = i === 0 ? 'Foyer' : shuffledTypes[(i - 1) % shuffledTypes.length];
  });

  const spawn = { x: rooms[0].cx, y: rooms[0].cy, roomId: 0 };

  // --- exit: farthest room from spawn (BFS distance, doors open) ---
  const dist = bfsDistances(grid, width, height, spawn.x, spawn.y, () => true);
  let exitRoom = rooms[0];
  let bestD = -1;
  for (const r of rooms) {
    const d = dist[idx(width, r.cx, r.cy)];
    if (d > bestD && r.id !== 0) { bestD = d; exitRoom = r; }
  }
  const exit = { x: exitRoom.cx, y: exitRoom.cy, roomId: exitRoom.id };

  // --- relics: 3 distinct rooms, never spawn, prefer far rooms ---
  const farRooms = rooms
    .filter((r) => r.id !== 0 && r.id !== exitRoom.id)
    .sort((a, b) => dist[idx(width, b.cx, b.cy)] - dist[idx(width, a.cx, a.cy)]);
  const relicRooms = rng.shuffle(farRooms).slice(0, 3);
  // ensure spread: if shuffle put two adjacent, still fine — distinct rooms is the rule.
  const relics = relicRooms.map((r, i) => ({
    id: i,
    name: RELIC_NAMES[i],
    x: r.cx + (r.w > 4 ? rng.nextInt(-1, 2) : 0),
    y: r.cy,
    roomId: r.id,
    taken: false,
  }));

  // --- locked doors on chain branches; key placed in an earlier chain room ---
  const doors = [];
  const keys = [];
  const chainConns = connections.filter((c) => c.b === c.a + 1);
  const doorTargets = rng.shuffle(chainConns.filter((c) => c.b !== 0 && c.tiles.length >= 3));
  let keyDoorCount = 0;
  for (const conn of doorTargets) {
    if (keyDoorCount >= 2) break;
    if (conn.b === exitRoom.id && keyDoorCount === 0) {
      // one key door may guard the exit branch; that's fine, key is earlier.
    }
    const mid = conn.tiles[Math.floor(conn.tiles.length / 2)];
    if (!mid || grid[idx(width, mid.x, mid.y)] !== TILE.FLOOR) continue;
    const keyId = keyDoorCount;
    grid[idx(width, mid.x, mid.y)] = TILE.KEY_DOOR;
    doors.push({ x: mid.x, y: mid.y, kind: 'key', keyId, roomId: conn.b, open: false });
    // Key tile: the room centre, unless another key already sits there —
    // two keys on one tile meant only the first could ever be picked up
    // (keyAt returns the first match). Fall back to the nearest free floor
    // tile in the same room, then the nearest free floor tile anywhere.
    const keyRoom = rooms[rng.nextInt(0, Math.max(1, conn.b))];
    const keyTile = pickDistinctKeyTile(grid, width, keyRoom, keys);
    keys.push({
      id: keyId,
      name: KEY_NAMES[keyId],
      x: keyTile.x,
      y: keyTile.y,
      roomId: keyRoom.id,
      taken: false,
    });
    keyDoorCount++;
  }
  // --- one riddle door on a different branch ---
  const riddleTarget = doorTargets.find(
    (c) => !doors.some((d) => d.x === c.tiles[Math.floor(c.tiles.length / 2)]?.x
      && d.y === c.tiles[Math.floor(c.tiles.length / 2)]?.y),
  );
  if (riddleTarget && riddleTarget.tiles.length >= 3) {
    const mid = riddleTarget.tiles[Math.floor(riddleTarget.tiles.length / 2)];
    if (mid && grid[idx(width, mid.x, mid.y)] === TILE.FLOOR) {
      grid[idx(width, mid.x, mid.y)] = TILE.RIDDLE_DOOR;
      doors.push({
        x: mid.x, y: mid.y, kind: 'riddle',
        riddle: RIDDLES[rng.nextInt(0, RIDDLES.length)],
        roomId: riddleTarget.b, open: false,
      });
    }
  }

  // --- candle-lit safe rooms: spawn + 2 others; candle oil pickups ---
  const candleRooms = new Set([0]);
  while (candleRooms.size < 3) candleRooms.add(rng.nextInt(0, rooms.length));
  rooms.forEach((r) => { r.candleLit = candleRooms.has(r.id); });
  const candles = [];
  for (let i = 0; i < 4; i++) {
    const r = rooms[rng.nextInt(0, rooms.length)];
    candles.push({ x: r.cx + rng.nextInt(-1, 2), y: r.cy, roomId: r.id, taken: false });
  }

  return {
    seed: seedString, attempt, width, height, grid, rooms,
    spawn, exit, relics, doors, keys, candles,
  };
}

/** BFS distances from (sx,sy); passable(tile) decides walkability. -1 = unreachable. */
export function bfsDistances(grid, width, height, sx, sy, passable) {
  const dist = new Int32Array(width * height).fill(-1);
  const q = [[sx, sy]];
  dist[idx(width, sx, sy)] = 0;
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (dist[idx(width, nx, ny)] !== -1) continue;
      if (!passable(grid[idx(width, nx, ny)], nx, ny)) continue;
      dist[idx(width, nx, ny)] = dist[idx(width, x, y)] + 1;
      q.push([nx, ny]);
    }
  }
  return dist;
}

function tileAt(manor, x, y) {
  if (x < 0 || y < 0 || x >= manor.width || y >= manor.height) return TILE.WALL;
  return manor.grid[idx(manor.width, x, y)];
}

export function doorAt(manor, x, y) {
  return manor.doors.find((d) => d.x === x && d.y === y) || null;
}

export function keyAt(manor, x, y) {
  return manor.keys.find((k) => k.x === x && k.y === y && !k.taken) || null;
}

/** ALL untaken keys on a tile (keyAt returns only the first — see isSolvable). */
export function keysAt(manor, x, y) {
  return manor.keys.filter((k) => k.x === x && k.y === y && !k.taken);
}

export function relicAt(manor, x, y) {
  return manor.relics.find((r) => r.x === x && r.y === y && !r.taken) || null;
}

export function candleAt(manor, x, y) {
  return manor.candles.find((c) => c.x === x && c.y === y && !c.taken) || null;
}

export function roomAt(manor, x, y) {
  return manor.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;
}

/**
 * Solvability check: BFS over (x, y, keyMask, relicMask). A state wins when all
 * relics are collected and the player stands on the exit. Key doors need their
 * key; riddle doors are always passable (the player can answer).
 */
export function isSolvable(manor) {
  const { width, height } = manor;
  const keyBits = manor.keys.length;
  const relicBits = manor.relics.length;
  const seen = new Set();
  const startKey = `${manor.spawn.x},${manor.spawn.y},0,0`;
  seen.add(startKey);
  const q = [{ x: manor.spawn.x, y: manor.spawn.y, keys: 0, relics: 0 }];
  const allRelics = (1 << relicBits) - 1;
  while (q.length) {
    const s = q.shift();
    if (s.relics === allRelics && s.x === manor.exit.x && s.y === manor.exit.y) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = s.x + dx;
      const ny = s.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const t = tileAt(manor, nx, ny);
      if (t === TILE.WALL) continue;
      let keys = s.keys;
      if (t === TILE.KEY_DOOR) {
        const door = doorAt(manor, nx, ny);
        if (!door || !((keys >> door.keyId) & 1)) continue;
      }
      // Collect EVERY key on this tile: keyAt() returns only the first, so
      // stacked keys used to leave the second key's bit permanently unset.
      for (const key of keysAt(manor, nx, ny)) keys |= (1 << key.id);
      let relics = s.relics;
      const relic = relicAt(manor, nx, ny);
      if (relic) relics |= (1 << relic.id);
      const k = `${nx},${ny},${keys},${relics}`;
      if (seen.has(k)) continue;
      seen.add(k);
      q.push({ x: nx, y: ny, keys, relics });
    }
  }
  return false;
}

/**
 * BFS path from `from` to `to` (tiles). Doors passable if their key is held
 * (keysHeld = Set of key ids) or they are riddle doors. Returns array of
 * {x,y} including start and goal, or null if unreachable.
 */
export function bfsPath(manor, from, to, keysHeld = new Set(), opened = new Set()) {
  const { width, height } = manor;
  const key = (x, y) => `${x},${y}`;
  const prev = new Map();
  const seen = new Set([key(from.x, from.y)]);
  const q = [{ x: from.x, y: from.y }];
  while (q.length) {
    const cur = q.shift();
    if (cur.x === to.x && cur.y === to.y) {
      const path = [cur];
      let k = key(cur.x, cur.y);
      while (prev.has(k)) {
        const p = prev.get(k);
        path.unshift(p);
        k = key(p.x, p.y);
      }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (seen.has(key(nx, ny))) continue;
      const t = tileAt(manor, nx, ny);
      if (t === TILE.WALL) continue;
      if (t === TILE.KEY_DOOR && !opened.has(key(nx, ny))) {
        const door = doorAt(manor, nx, ny);
        if (!door || !keysHeld.has(door.keyId)) continue;
      }
      seen.add(key(nx, ny));
      prev.set(key(nx, ny), cur);
      q.push({ x: nx, y: ny });
    }
  }
  return null;
}

/** Generate a manor for a seed string; re-rolls until solvable (max 50 tries). */
export function generateManor(seedString, options = {}) {
  let last = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    const m = buildManor(seedString, attempt, options);
    if (!m) continue;
    last = m;
    if (isSolvable(m)) return m;
  }
  // Extremely unlikely: return the last built manor even if the check failed,
  // so the game never hard-crashes; the check result is recorded.
  if (last) last.unsolved = true;
  return last;
}
