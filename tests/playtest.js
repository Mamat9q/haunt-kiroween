// tests/playtest.js — scripted playthrough harness for HAUNT.
//
// Run: `node tests/playtest.js`
// Plays 20 seeds headlessly in Node (no browser) with a solver policy
// (BFS to nearest objective: key -> relic -> exit) driving the REAL
// js/game.js `Game` class (Mode A), and writes results to
// tests/playtest-log.md. Gates: 0 errors, >= 15/20 seeds won, fallback
// narration produces lines with no API key set and zero network calls.
// If game.js has no usable headless API, Mode B (manor-level simulation
// over the canonical manor, design.md rates) runs instead and says so.
//
// Browser stubs (localStorage / document / AudioContext) are installed
// BEFORE any game module is imported. fetch is stubbed to record + throw,
// proving the no-key run makes zero network calls. No API key is set
// anywhere (env + stub storage are empty).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadManorGenerator,
  generateCanonical,
  bfsWithKeys,
  bfsPath as adapterBfsPath,
} from './manor-adapter.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(HERE, 'playtest-log.md');
const SEEDS = Array.from({ length: 20 }, (_, i) => `haunt-play-${String(i).padStart(2, '0')}`);

// Solver / simulation constants.
const DT = 0.05; // game seconds per solver tick (20 Hz)
const MAX_TICKS = 30000; // 1500 game-seconds cap per seed
const STUCK_TICKS = 160; // ~8s without progress towards the objective = stuck
const CHANNEL_TIMEOUT_TICKS = 80; // 4s to finish a 1s relic channel
// Mode B constants (design.md rates).
const SECONDS_PER_TILE = 0.3;
const MAX_STEPS_B = 5000;

const ROOM_TYPES = ['Foyer', 'Library', 'Kitchen', 'Chapel', 'Cellar', 'Bedroom', 'Gallery', 'Study'];
const NARRATION_EVENTS = ['start', 'enter_room', 'relic_found', 'key_found', 'door_locked', 'riddle_wrong', 'riddle_right', 'warden_spotted', 'sanity_low', 'oil_low', 'candle_found', 'escape', 'victory'];

// ---------------------------------------------------------------------------
// Browser stubs (installed before any game module import)
// ---------------------------------------------------------------------------

const fetchCalls = [];
function installStubs() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(String(k), String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.HAUNT_API_KEY;
  const dummyCtx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'canvas') return {};
      if (prop === 'measureText') return () => ({ width: 0 });
      if (prop === 'getImageData') return () => ({ data: [] });
      return () => {};
    },
    set: () => true,
  });
  const dummyEl = {
    getContext: () => dummyCtx, addEventListener: () => {}, removeEventListener: () => {},
    appendChild: () => {}, setAttribute: () => {}, style: {}, width: 0, height: 0,
  };
  globalThis.window = globalThis;
  globalThis.document = {
    createElement: () => ({ ...dummyEl }), getElementById: () => null,
    querySelector: () => null, addEventListener: () => {}, body: { ...dummyEl },
  };
  try { globalThis.navigator = { userAgent: 'node-playtest' }; } catch { /* getter-only in Node 24 — non-essential */ }
  globalThis.AudioContext = class {
    constructor() { this.state = 'suspended'; this.currentTime = 0; }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    createGain() { return { connect: () => {}, gain: { value: 0, setValueAtTime: () => {} } }; }
    createOscillator() { return { connect: () => {}, start: () => {}, stop: () => {}, frequency: { value: 0 } }; }
    createBufferSource() { return { connect: () => {}, start: () => {}, stop: () => {} }; }
    createBiquadFilter() { return { connect: () => {}, frequency: { value: 0 } }; }
    createAnalyser() { return { connect: () => {} }; }
    get destination() { return {}; }
  };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    throw new Error('playtest stub: fetch must not be called (no network in headless playtest)');
  };
}

async function tryImport(name) {
  try {
    return await import(new URL(`../js/${name}`, import.meta.url).href);
  } catch (e) {
    return { __loadError: e };
  }
}

// ---------------------------------------------------------------------------
// Fallback narration check (no API key, zero network)
// ---------------------------------------------------------------------------

async function testFallbackNarration() {
  const result = { ok: false, via: null, lines: {}, errors: [], fetchCalls: 0, distinct: 0, deterministic: null };
  const mod = await tryImport('narration.js');
  if (mod.__loadError) {
    result.errors.push(`js/narration.js failed to load: ${mod.__loadError.message}`);
    return result;
  }
  const { Narrator, ENTER_ROOM_LINES, EVENT_LINES, offlineLine } = mod;
  if (typeof Narrator !== 'function') {
    result.errors.push('js/narration.js exports no Narrator class.');
    return result;
  }
  result.via = 'Narrator.line (offline engine)';
  // Bank depth: design.md requires >= 6 variants per bank.
  for (const [room, bank] of Object.entries(ENTER_ROOM_LINES ?? {})) {
    if (!Array.isArray(bank) || bank.length < 6) result.errors.push(`ENTER_ROOM_LINES.${room} has ${bank?.length ?? 0} variants (need >= 6)`);
  }
  for (const [event, bank] of Object.entries(EVENT_LINES ?? {})) {
    if (!Array.isArray(bank) || bank.length < 6) result.errors.push(`EVENT_LINES.${event} has ${bank?.length ?? 0} variants (need >= 6)`);
  }
  const n1 = new Narrator('haunt-play-00');
  const n2 = new Narrator('haunt-play-00');
  if (n1.apiKey) result.errors.push('Narrator picked up an API key with empty storage/env — key leak?');
  const seq1 = [];
  let counter = 0;
  for (const event of NARRATION_EVENTS) {
    const lines = [];
    for (const roomType of ROOM_TYPES) {
      let line = null;
      try { line = n1.line(event, { roomType, relic: 'Obsidian Mirror', key: 'Brass Key', relics: 1, sanity: 80, oil: 90 }); } catch (e) {
        result.errors.push(`Narrator.line(${event}, ${roomType}) threw: ${e.message}`);
      }
      if (typeof line !== 'string' || line.trim().length === 0) {
        result.errors.push(`Narrator.line(${event}, ${roomType}) returned no usable line`);
      } else {
        lines.push(line);
        seq1.push(line);
        if (/api key|openrouter|fetch failed|network error|as an ai/i.test(line)) {
          result.errors.push(`line for ${event}/${roomType} leaks API/AI wording: ${JSON.stringify(line.slice(0, 80))}`);
        }
        if (/\{(room|relic|key)\}/.test(line)) result.errors.push(`unfilled placeholder in ${event}/${roomType} line: ${JSON.stringify(line.slice(0, 80))}`);
      }
      counter++;
    }
    result.lines[event] = lines;
  }
  // Determinism: same seed -> same sequence of lines.
  const seq2 = NARRATION_EVENTS.flatMap((event) => ROOM_TYPES.map((roomType) => n2.line(event, { roomType, relic: 'Obsidian Mirror', key: 'Brass Key', relics: 1, sanity: 80, oil: 90 })));
  result.deterministic = JSON.stringify(seq1) === JSON.stringify(seq2);
  if (!result.deterministic) result.errors.push('two Narrators with the same seed produced different line sequences');
  // Variety: same (room, event) over many fresh Narrators seeded differently.
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(new Narrator(`haunt-play-${i}`).line('enter_room', { roomType: 'Library' }));
  result.distinct = seen.size;
  if (seen.size < 2) result.errors.push(`no variety in enter_room/Library lines (${seen.size} distinct over 40 seeds)`);
  // narrate() without an onAi callback must return the offline line, no fetch.
  try {
    const out = n1.narrate('enter_room', { roomType: 'Chapel' });
    if (typeof out !== 'string' || out.length === 0) result.errors.push('Narrator.narrate() without onAi returned no line');
  } catch (e) { result.errors.push(`Narrator.narrate() threw: ${e.message}`); }
  // offlineLine direct entry point (if exported).
  if (typeof offlineLine === 'function') {
    try {
      const { createRng } = await tryImport('rng.js');
      const rng = createRng('haunt-play-00');
      const line = offlineLine('enter_room', 'Library', rng, {});
      if (typeof line !== 'string' || line.length === 0) result.errors.push('offlineLine() returned no line');
    } catch (e) { result.errors.push(`offlineLine() threw: ${e.message}`); }
  }
  result.fetchCalls = fetchCalls.length;
  if (fetchCalls.length > 0) result.errors.push(`narration made ${fetchCalls.length} fetch call(s) with no key set`);
  result.ok = result.errors.length === 0;
  return result;
}

// ---------------------------------------------------------------------------
// Mode A: drive the real Game class with the BFS solver policy
// ---------------------------------------------------------------------------

function nearestTarget(game, pathFn) {
  const manor = game.manor;
  const from = { x: game.player.tx, y: game.player.ty };
  const cands = [];
  for (const k of manor.keys) if (!k.taken && !game.keys.has(k.id)) cands.push({ x: k.x, y: k.y, kind: 'key', id: k.id });
  for (const r of manor.relics) if (!r.taken) cands.push({ x: r.x, y: r.y, kind: 'relic', id: r.id });
  if (game.relicsGot >= game.relicsTotal) cands.push({ x: manor.exit.x, y: manor.exit.y, kind: 'exit', id: 'exit' });
  let best = null;
  for (const c of cands) {
    const p = pathFn(manor, from, { x: c.x, y: c.y }, game.keys);
    if (p && p.length > 0 && (!best || p.length < best.path.length)) best = { ...c, path: p };
  }
  return best; // null => no objective reachable (soft-lock)
}

async function playSeedModeA(seed, GameClass, pathFn) {
  const log = { mode: 'A', won: false, ticks: 0, gameSeconds: 0, sanityEnd: null, oilEnd: null, minSanity: 100, relicsEnd: 0, riddles: 0, contacts: 0, error: null, reason: null };
  try {
    const game = new GameClass(seed, { difficulty: 'normal' });
    game.start();
    if (game.state !== 'playing') throw new Error(`Game.start() left state=${game.state} (expected playing)`);
    let stuckTicks = 0;
    let bestDist = Infinity;
    let channelTicks = 0;
    let lastTile = `${game.player.tx},${game.player.ty}`;
    for (let tick = 0; tick < MAX_TICKS; tick++) {
      log.ticks = tick;
      if (game.state === 'won') { log.won = true; break; }
      if (game.state === 'lost') { log.reason = `game over: ${game.lostReason || 'unknown'} (sanity ${game.sanity.toFixed(1)}, relics ${game.relicsGot}/3)`; break; }
      if (game.sanity < 0) { log.error = `sanity went negative (${game.sanity}) without game over at tick ${tick}`; break; }
      log.minSanity = Math.min(log.minSanity, game.sanity);
      for (const e of game.drainEvents()) if (e.type === 'contact') log.contacts++;

      if (game.state === 'riddle') {
        // Headless solver answers from the exposed riddle object. A human
        // player reads the riddle; the harness proves the door CAN be opened.
        const answer = game.riddle?.answer;
        if (typeof answer !== 'number') { log.reason = 'riddle open but game.riddle.answer is not a number'; break; }
        game.answerRiddle(answer);
        log.riddles++;
        continue;
      }
      if (game.channel) {
        channelTicks++;
        if (channelTicks > CHANNEL_TIMEOUT_TICKS) { log.reason = `relic channel timed out at tick ${tick}`; break; }
        game.update(DT, {}); // stand still to complete the 1s channel
        continue;
      }
      channelTicks = 0;

      // Near an untaken relic? Start the claim channel — ONLY when standing
      // on the relic's own tile and well inside the game's 1.4 channel-hold
      // radius. (Earlier harness bug: triggering at 1.5 let the channel
      // start at 1.41–1.5 and be cancelled instantly by game.js every tick,
      // soft-locking seeds haunt-play-11/-15. The game's interact radius
      // 1.6 vs hold radius 1.4 dead zone is also reported as a game issue.)
      const nearRelic = game.manor.relics.find((r) => !r.taken
        && game.player.tx === r.x && game.player.ty === r.y
        && Math.hypot(game.player.x - (r.x + 0.5), game.player.y - (r.y + 0.5)) <= 1.0);
      if (nearRelic) {
        game.interact();
        continue;
      }
      // Near a closed riddle door? Open the riddle prompt (answered above).
      // Only when the door tile is Manhattan-adjacent to the player tile —
      // nearestInteractable() uses a 1.6 Euclidean radius that also fires
      // through walls at doors in the next room.
      const it = game.nearestInteractable();
      if (it && it.kind === 'riddle'
        && Math.abs(it.door.x - game.player.tx) + Math.abs(it.door.y - game.player.ty) === 1) {
        game.interact();
        continue;
      }

      const target = nearestTarget(game, pathFn);
      if (!target) { log.reason = `soft-lock: no reachable objective from (${game.player.tx},${game.player.ty}) with keys [${[...game.keys].join(', ')}], relics ${game.relicsGot}/3`; break; }
      const next = target.path[1] ?? target.path[0];
      if (!next) { log.reason = `empty path to ${target.kind} ${target.id}`; break; }
      if (next.x === game.player.tx && next.y === game.player.ty) {
        // Standing on the target tile but the objective did not trigger
        // (e.g. relic just out of interact range) — step toward its centre.
        game.update(DT, {});
        continue;
      }
      const dx = (next.x + 0.5) - game.player.x;
      const dy = (next.y + 0.5) - game.player.y;
      const input = { left: dx < -0.12, right: dx > 0.12, up: dy < -0.12, down: dy > 0.12 };
      game.update(DT, input);

      // Stuck detection: no progress toward the objective tile for a while.
      const d = Math.hypot(dx, dy);
      const tileNow = `${game.player.tx},${game.player.ty}`;
      if (d < bestDist - 0.01 || tileNow !== lastTile) { bestDist = d; stuckTicks = 0; }
      else if (++stuckTicks > STUCK_TICKS) {
        log.reason = `stuck: no progress toward ${target.kind} ${target.id} for ${STUCK_TICKS} ticks at (${game.player.tx},${game.player.ty}); state=${game.state}, sanity ${game.sanity.toFixed(1)}`;
        break;
      }
      lastTile = tileNow;
    }
    if (log.ticks >= MAX_TICKS - 1 && !log.won) log.reason = `tick cap ${MAX_TICKS} hit (relics ${game.relicsGot}/3)`;
    log.gameSeconds = +game.elapsed.toFixed(1);
    log.sanityEnd = +game.sanity.toFixed(1);
    log.oilEnd = +game.oil.toFixed(1);
    log.relicsEnd = game.relicsGot;
    if (game.state === 'won' && log.gameSeconds <= 0) log.error = 'game won but elapsed timer was not recorded (>0 expected)';
  } catch (e) {
    log.error = `${e.name}: ${e.message}`;
  }
  return log;
}

// ---------------------------------------------------------------------------
// Mode B: manor-level simulation fallback (game.js headless API unusable)
// ---------------------------------------------------------------------------

function playSeedModeB(manor) {
  const log = { mode: 'B', won: false, ticks: 0, gameSeconds: 0, sanityEnd: 100, oilEnd: 100, minSanity: 100, relicsEnd: 0, riddles: 0, contacts: 0, error: null, reason: null };
  try {
    let pos = { x: manor.spawn.x, y: manor.spawn.y };
    let sanity = 100, oil = 100, lanternOn = true;
    const keysHeld = new Set(), relicsHeld = new Set(), safeVisited = new Set(), riddlePaid = new Set();
    const keyAt = new Map(), relicAt = new Map(), doorAt = new Map();
    for (const k of manor.keys) keyAt.set(`${k.x},${k.y}`, k);
    for (const r of manor.relics) relicAt.set(`${r.x},${r.y}`, r);
    for (const d of manor.doors) doorAt.set(`${d.x},${d.y}`, d);
    const collect = () => {
      const k = keyAt.get(`${pos.x},${pos.y}`); if (k) keysHeld.add(k.id);
      const r = relicAt.get(`${pos.x},${pos.y}`); if (r) relicsHeld.add(r.id);
      const room = manor.roomAt(pos.x, pos.y);
      if (room?.candleLit && !safeVisited.has(room.id)) {
        safeVisited.add(room.id); sanity = Math.min(100, sanity + 15); oil = Math.min(100, oil + 30);
      }
    };
    collect();
    let steps = 0;
    while (steps < MAX_STEPS_B) {
      if (relicsHeld.size === manor.relics.length && pos.x === manor.exit.x && pos.y === manor.exit.y) { log.won = true; break; }
      const blocked = (x, y) => {
        const d = doorAt.get(`${x},${y}`);
        return !!d && d.kind === 'key' && !keysHeld.has(d.keyId);
      };
      const targets = [];
      for (const k of manor.keys) if (!keysHeld.has(k.id)) targets.push({ x: k.x, y: k.y });
      for (const r of manor.relics) if (!relicsHeld.has(r.id)) targets.push({ x: r.x, y: r.y });
      if (relicsHeld.size === manor.relics.length) targets.push({ x: manor.exit.x, y: manor.exit.y });
      let best = null;
      for (const t of targets) {
        const p = adapterBfsPath(manor, pos, t, blocked);
        if (p && (!best || p.length < best.length)) best = p;
      }
      if (!best || best.length < 2) { log.reason = `soft-lock: no reachable objective from (${pos.x},${pos.y})`; break; }
      pos = { x: best[1].x, y: best[1].y };
      steps++;
      if (lanternOn && oil > 0) { oil = Math.max(0, oil - SECONDS_PER_TILE); if (oil <= 0) lanternOn = false; }
      else sanity = Math.max(0, sanity - SECONDS_PER_TILE);
      const door = doorAt.get(`${pos.x},${pos.y}`);
      if (door?.kind === 'riddle' && !riddlePaid.has(door.id)) { riddlePaid.add(door.id); sanity = Math.max(0, sanity - 5); log.riddles++; }
      collect();
      log.minSanity = Math.min(log.minSanity, sanity);
      if (sanity <= 0) { log.reason = `sanity 0 at step ${steps}, relics ${relicsHeld.size}/3`; break; }
    }
    if (steps >= MAX_STEPS_B && !log.won) log.reason = `step cap ${MAX_STEPS_B} hit`;
    log.ticks = steps;
    log.gameSeconds = +(steps * SECONDS_PER_TILE).toFixed(1);
    log.sanityEnd = +sanity.toFixed(1);
    log.oilEnd = +oil.toFixed(1);
    log.relicsEnd = relicsHeld.size;
  } catch (e) {
    log.error = `${e.name}: ${e.message}`;
  }
  return log;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  installStubs();
  const startedAt = new Date();
  let generate = null, loadError = null;
  try { ({ generate } = await loadManorGenerator()); } catch (e) { loadError = e; }

  // Probe the real game API once.
  const gameMod = await tryImport('game.js');
  const manorMod = await tryImport('manor.js');
  let mode = 'B', modeReason = '', GameClass = null, pathFn = null;
  if (gameMod.__loadError) modeReason = `js/game.js failed to load: ${gameMod.__loadError.message}`;
  else if (typeof gameMod.Game !== 'function') modeReason = 'js/game.js exports no Game class';
  else {
    GameClass = gameMod.Game;
    pathFn = typeof manorMod.bfsPath === 'function'
      ? (manor, from, to, keysHeld) => manorMod.bfsPath(manor, from, to, keysHeld)
      : (manor, from, to, keysHeld) => adapterBfsPath(manor, from, to, (x, y) => false);
    try {
      const probe = new GameClass(SEEDS[0], { difficulty: 'normal' });
      probe.start();
      probe.update(DT, {});
      if (probe.state !== 'playing') throw new Error(`probe state=${probe.state}`);
      mode = 'A';
      modeReason = `Game class OK (probe state=playing, player @${probe.player.tx},${probe.player.ty})`;
    } catch (e) {
      modeReason = `Game class probe failed: ${e.message}`;
    }
  }
  if (loadError) { mode = 'B'; modeReason = `manor failed to load: ${loadError.message}`; }

  const results = [];
  for (const seed of SEEDS) {
    const t0 = Date.now();
    const entry = { seed, mode, won: false, ticks: 0, gameSeconds: 0, sanityEnd: null, oilEnd: null, minSanity: null, relicsEnd: 0, riddles: 0, contacts: 0, wallMs: 0, error: null, reason: null };
    try {
      if (loadError) throw loadError;
      const manor = await generateCanonical(generate, seed);
      const proof = bfsWithKeys(manor);
      if (!proof.canWin) {
        entry.reason = `manor itself unwinnable per state-space BFS (relics ${proof.reachedRelics.size}/3, exit ${proof.reachedExit})`;
      } else if (mode === 'A') {
        Object.assign(entry, await playSeedModeA(seed, GameClass, pathFn));
      } else {
        Object.assign(entry, await playSeedModeB(manor));
      }
    } catch (e) {
      entry.error = `${e.name}: ${e.message}`;
    }
    entry.wallMs = Date.now() - t0;
    if (entry.error) entry.won = false;
    results.push(entry);
    const status = entry.error ? 'ERROR' : entry.won ? 'WON ' : 'LOST';
    console.log(`[${status}] ${seed} mode=${entry.mode} ticks=${entry.ticks} time=${entry.gameSeconds}s sanity=${entry.sanityEnd} oil=${entry.oilEnd} relics=${entry.relicsEnd}/3 riddles=${entry.riddles} contacts=${entry.contacts}${entry.reason ? ` — ${entry.reason}` : ''}${entry.error ? ` — ${entry.error}` : ''}`);
  }

  const narration = await testFallbackNarration();
  console.log(`\nFallback narration (no key): ${narration.ok ? 'PASS' : 'FAIL'} via ${narration.via ?? 'n/a'}; distinct enter_room/Library lines: ${narration.distinct}; deterministic: ${narration.deterministic}; fetch calls: ${narration.fetchCalls}`);
  for (const e of narration.errors) console.log(`  [narration] ${e}`);

  const wins = results.filter((r) => r.won).length;
  const errors = results.filter((r) => r.error);
  const losses = results.filter((r) => !r.won && !r.error);
  const gates = { zeroErrors: errors.length === 0, winsAtLeast15: wins >= 15, narrationOk: narration.ok, noNetwork: fetchCalls.length === 0 };
  const allPass = Object.values(gates).every(Boolean);

  const L = [];
  L.push('# HAUNT — playtest log', '');
  L.push(`Generated: ${startedAt.toISOString()} (local run, Node ${process.version}).`);
  L.push('Harness: `node tests/playtest.js` — solver policy BFS to nearest objective (key → relic → exit).');
  L.push(`Mode: **${mode === 'A' ? 'A — real js/game.js Game class' : 'B — manor-level simulation fallback'}** (${modeReason})`);
  L.push(`Solver: dt=${DT}s/tick, tick cap ${MAX_TICKS}, stuck threshold ${STUCK_TICKS} ticks, relic channel = stand still 1s via interact(). Riddle doors are answered from the exposed riddle object (game.riddle.answer) — the harness proves the door CAN be opened; a human player reads the riddle.`);
  L.push('', '## Summary', '');
  L.push(`- Seeds played: ${results.length}`);
  L.push(`- Won: **${wins}/${results.length}** (gate: ≥ 15) — ${gates.winsAtLeast15 ? 'PASS' : 'FAIL'}`);
  L.push(`- Lost: ${losses.length}`);
  L.push(`- Errors (exceptions): **${errors.length}** (gate: 0) — ${gates.zeroErrors ? 'PASS' : 'FAIL'}`);
  L.push(`- Fallback narration with no API key: ${narration.ok ? 'PASS' : 'FAIL'} (via ${narration.via ?? 'n/a'}; ${narration.distinct} distinct enter_room/Library lines over 40 seeds; deterministic per seed: ${narration.deterministic}; ${narration.fetchCalls} fetch calls)`);
  L.push(`- Network calls during whole run: ${fetchCalls.length} (gate: 0) — ${gates.noNetwork ? 'PASS' : 'FAIL'}`);
  L.push(`- **Overall: ${allPass ? 'PASS' : 'FAIL'}**`);
  L.push('', '## Per-seed results', '');
  L.push('| seed | result | ticks | game time (s) | sanity at end | oil at end | min sanity | relics | riddles | warden contacts | wall (ms) | notes |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const notes = [r.error ? `ERROR: ${r.error}` : '', r.reason ?? ''].filter(Boolean).join(' ');
    L.push(`| ${r.seed} | ${r.won ? 'won' : r.error ? 'error' : 'lost'} | ${r.ticks} | ${r.gameSeconds} | ${r.sanityEnd ?? 'n/a'} | ${r.oilEnd ?? 'n/a'} | ${r.minSanity != null ? +r.minSanity.toFixed(1) : 'n/a'} | ${r.relicsEnd}/3 | ${r.riddles} | ${r.contacts} | ${r.wallMs} | ${notes.replace(/\|/g, '/')} |`);
  }
  L.push('', '## Fallback narration sample (no key set)', '');
  for (const [event, sample] of Object.entries(narration.lines)) {
    L.push(`- **${event}**: ${sample[0] ? `“${sample[0]}”` : '(no line produced)'}`);
  }
  if (narration.errors.length > 0) {
    L.push('', '### Narration failures', '');
    for (const e of narration.errors) L.push(`- ${e}`);
  }
  if (losses.length > 0 || errors.length > 0) {
    L.push('', '## Failing seeds (why)', '');
    for (const r of [...errors, ...losses]) L.push(`- **${r.seed}** (${r.error ? 'error' : 'lost'}): ${r.error ?? r.reason ?? 'no reason recorded'}`);
  }
  L.push('', '## Notes / gaps', '');
  if (mode === 'B') {
    L.push(`- Mode B ran because the game.js headless API was not usable: ${modeReason}`);
    L.push('- Mode B proves the manor + solver winnable and the sanity/oil economy survivable; it does NOT exercise game.js input/collision/Warden code. Close by exposing a headless create/move/tick API in js/game.js.');
  } else {
    L.push('- Mode A ran: win/lose verdicts come from the real Game instance (movement, collision, sanity/oil, Warden, riddle/key doors, relic channels, win/lose states).');
  }
  L.push('- Warden contact penalties ARE exercised in Mode A (game.update runs the Warden; contacts counted above).');
  L.push('- Riddle doors in Mode A are answered correctly from game.riddle.answer; wrong-answer sanity cost (-5) is not exercised by the solver.');
  L.push('');
  fs.writeFileSync(LOG_PATH, L.join('\n'));
  console.log(`\nLog written to ${LOG_PATH}`);
  console.log(`Gates: 0 errors=${gates.zeroErrors}, wins>=15=${gates.winsAtLeast15} (${wins}/20), narration=${gates.narrationOk}, no-network=${gates.noNetwork} → ${allPass ? 'PASS' : 'FAIL'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(`playtest harness crashed: ${e.stack ?? e}`);
  process.exit(2);
});
