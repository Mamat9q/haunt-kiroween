// game.js — HAUNT game core: loop state, movement, collision, sanity/oil,
// riddle & key doors, relic pedestals, win/lose, leaderboard, seed handling.
// Pure logic (no DOM at module top level) so Node test harnesses can import it.
// Browser wiring lives in index.html, which imports this module.

import { generateManor, TILE, roomAt, doorAt, keysAt, relicAt, candleAt, bfsPath } from './manor.js';
import { createWarden } from './warden.js';
import { Narrator } from './narration.js';
import { createRng } from './rng.js';

export const DIFFICULTY = {
  normal: {
    label: 'Normal', oilStart: 100, wardenSpeed: 2.1, chaseSpeed: 3.4,
    sanityDrainDark: 1.0, sanityDrainWarden: 3.0, wardenSight: 5,
  },
  hard: {
    label: 'Hard', oilStart: 60, wardenSpeed: 2.9, chaseSpeed: 4.1,
    sanityDrainDark: 1.5, sanityDrainWarden: 4.5, wardenSight: 6,
  },
};

export const BEST_PREFIX = 'haunt.best.';
export const PLAYER_SPEED = 5.2; // tiles per second
// Interact radius and relic channel-hold radius. The hold radius MUST be >=
// the interact radius: a player who can start "Claiming…" at 1.6 tiles must
// not have the channel silently cancelled at 1.41–1.6. Hold is deliberately a
// touch larger (1.75) so standing still — or a small nudge — never breaks it.
export const INTERACT_RADIUS = 1.6;
export const CHANNEL_HOLD_RADIUS = 1.75;
export const CHANNEL_CANCEL_TEXT = "You step back — the relic's pull fades.";
export const LIGHT_RADIUS_LIT = 4.6;
export const LIGHT_RADIUS_DARK = 2.6;

/** Daily manor seed: local date as YYYY-MM-DD. */
export function dailySeed(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function storageGet(key) {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch { return null; }
}
function storageSet(key, val) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, val);
  } catch { /* private mode etc. — leaderboard simply does not persist */ }
}

export function getBestTime(seed) {
  const v = storageGet(BEST_PREFIX + seed);
  return v === null ? null : Number(v);
}

/** Records ms if it beats the stored best for this seed. Returns the best. */
export function setBestTime(seed, ms) {
  const prev = getBestTime(seed);
  if (prev === null || ms < prev) {
    storageSet(BEST_PREFIX + seed, String(ms));
    return ms;
  }
  return prev;
}

export class Game {
  /**
   * @param {string} seedString
   * @param {{difficulty?: 'normal'|'hard'}} opts
   */
  constructor(seedString, opts = {}) {
    this.seed = String(seedString || 'manor');
    this.difficultyKey = DIFFICULTY[opts.difficulty] ? opts.difficulty : 'normal';
    this.diff = DIFFICULTY[this.difficultyKey];
    this.manor = generateManor(this.seed);
    this.rng = createRng(`${this.seed}::game`);
    this.narrator = new Narrator(this.seed);
    this.warden = createWarden(this.manor, this.seed, {
      speed: this.diff.wardenSpeed,
      chaseSpeed: this.diff.chaseSpeed,
      sightRange: this.diff.wardenSight,
    });
    this.player = {
      x: this.manor.spawn.x + 0.5, y: this.manor.spawn.y + 0.5,
      tx: this.manor.spawn.x, ty: this.manor.spawn.y,
    };
    this.sanity = 100;
    this.oil = this.diff.oilStart;
    this.lanternOn = true;
    this.keys = new Set();
    this.relicsGot = 0;
    this.state = 'title'; // title | playing | paused | riddle | won | lost
    this.elapsed = 0;
    this.time = 0; // wall-clock-ish render time (seconds)
    this.explored = new Uint8Array(this.manor.width * this.manor.height);
    this.events = []; // drained by the UI: {type, text?, data?}
    this.hint = '';
    this.channel = null; // {relic, progress} while standing at a pedestal
    this.invuln = 0;
    this.flash = 0;
    this.currentRoomId = -1;
    this.visitedRooms = new Set();
    this.riddleDoor = null;
    this.riddle = null;
    this.lostReason = '';
    this.sanityLowWarned = false;
    this.oilLowWarned = false;
    this.markExplored();
    this.updateHint();
  }

  get lanternLit() {
    return this.lanternOn && this.oil > 0;
  }

  get relicsTotal() {
    return this.manor.relics.length;
  }

  get won() { return this.state === 'won'; }
  get lost() { return this.state === 'lost'; }

  emit(type, text, data) {
    this.events.push({ type, text, data });
  }

  /** Emit a narration event carrying its event name + context (for the AI path). */
  narrate(event, ctx = {}) {
    const line = this.narrator.line(event, ctx);
    this.emit('narrate', line, { event, ctx });
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  markExplored() {
    const { width } = this.manor;
    const px = Math.floor(this.player.x);
    const py = Math.floor(this.player.y);
    const r = 5;
    for (let y = py - r; y <= py + r; y++) {
      for (let x = px - r; x <= px + r; x++) {
        if (x < 0 || y < 0 || x >= width || y >= this.manor.height) continue;
        if (Math.hypot(x - px, y - py) <= r) this.explored[y * width + x] = 1;
      }
    }
  }

  start() {
    if (this.state !== 'title') return;
    this.state = 'playing';
    this.narrate('start', {});
    this.updateHint();
  }

  togglePause() {
    if (this.state === 'playing') this.state = 'paused';
    else if (this.state === 'paused') this.state = 'playing';
  }

  toggleLantern() {
    if (this.state !== 'playing') return;
    this.lanternOn = !this.lanternOn;
    this.emit('lantern', this.lanternOn ? 'lantern_on' : 'lantern_off');
  }

  isSolidTile(x, y) {
    const t = this.manor.grid[y * this.manor.width + x];
    if (t === TILE.WALL) return true;
    if (t === TILE.KEY_DOOR || t === TILE.RIDDLE_DOOR) {
      const d = doorAt(this.manor, x, y);
      return !(d && d.open);
    }
    return false;
  }

  /** Circle-vs-wall collision: try to move, sliding along walls. */
  tryMove(nx, ny) {
    const r = 0.3;
    const { width, height } = this.manor;
    const solidAt = (x, y) => {
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) return true;
      return this.isSolidTile(tx, ty);
    };
    if (!solidAt(nx + r, this.player.y) && !solidAt(nx - r, this.player.y)) this.player.x = nx;
    if (!solidAt(this.player.x, ny + r) && !solidAt(this.player.x, ny - r)) this.player.y = ny;
    this.player.tx = Math.floor(this.player.x);
    this.player.ty = Math.floor(this.player.y);
  }

  update(dt, input = {}) {
    this.time += dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2);
    if (this.invuln > 0) this.invuln -= dt;
    if (this.state !== 'playing') return;

    this.elapsed += dt;

    // --- movement ---
    let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (mx !== 0 && my !== 0) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    if (mx !== 0 || my !== 0) {
      this.cancelChannel(); // moving breaks a relic channel (with feedback)
      this.tryMove(
        this.player.x + mx * PLAYER_SPEED * dt,
        this.player.y + my * PLAYER_SPEED * dt,
      );
    }
    this.markExplored();
    this.checkTileEvents();
    this.checkRoomEvents();

    // --- relic channel ---
    if (this.channel) {
      const relic = this.channel.relic;
      const d = Math.hypot(this.player.x - (relic.x + 0.5), this.player.y - (relic.y + 0.5));
      if (d > CHANNEL_HOLD_RADIUS) this.cancelChannel();
      else {
        this.channel.progress += dt / 1.0; // 1 second to claim
        if (this.channel.progress >= 1) {
          relic.taken = true;
          this.relicsGot++;
          this.channel = null;
          this.narrate('relic_found', { relic: relic.name });
          this.emit('relic', `Relic claimed: ${relic.name} (${this.relicsGot}/${this.relicsTotal})`);
          this.updateHint();
        }
      }
    }

    // --- oil & sanity ---
    if (this.lanternOn && this.oil > 0) this.oil = Math.max(0, this.oil - dt * 1.0);
    const room = roomAt(this.manor, this.player.tx, this.player.ty);
    const inCandleRoom = !!(room && room.candleLit);
    const inDark = !this.lanternLit && !inCandleRoom;
    if (inDark) this.addSanity(-this.diff.sanityDrainDark * dt, 'dark');
    else if (inCandleRoom) this.addSanity(2 * dt, 'candle');
    if (!this.oilLowWarned && this.oil > 0 && this.oil < 20) {
      this.oilLowWarned = true;
      this.narrate('oil_low', {});
    }
    if (this.oil <= 0) this.oilLowWarned = true;
    if (!this.sanityLowWarned && this.sanity < 30) {
      this.sanityLowWarned = true;
      this.narrate('sanity_low', {});
    }

    // --- warden ---
    const w = this.warden.update(dt, this.player, this.lanternLit);
    if (w.spotted) {
      this.narrate('warden_spotted', {});
      this.emit('spotted', 'The Warden has seen you — run!');
      this.flash = 1;
    }
    if (w.state === 'chase') {
      this.addSanity(-this.diff.sanityDrainWarden * dt * 0.4, 'chase');
    }
    if (w.contact && this.invuln <= 0) this.onWardenContact();
    this.wardenDanger = Math.max(0, 1 - w.dist / 8);

    // --- win check ---
    if (this.relicsGot >= this.relicsTotal
      && this.player.tx === this.manor.exit.x && this.player.ty === this.manor.exit.y) {
      this.win();
    }
    if (this.sanity <= 0) this.lose('Your sanity shattered. The Warden claims you.');
  }

  addSanity(delta, _cause) {
    this.sanity = Math.max(0, Math.min(100, this.sanity + delta));
  }

  onWardenContact() {
    this.invuln = 2;
    this.addSanity(-15, 'contact');
    this.flash = 1;
    // Knockback: push the player 2 tiles away from the Warden, and the Warden
    // recoils — it will not chase again for a few seconds.
    const dx = this.player.x - this.warden.x;
    const dy = this.player.y - this.warden.y;
    const len = Math.hypot(dx, dy) || 1;
    this.tryMove(this.player.x + (dx / len) * 2, this.player.y + (dy / len) * 2);
    this.warden.recoil(6);
    this.narrate('warden_spotted', {});
    this.emit('contact', 'The Warden touches you — cold, so cold. −15 sanity.');
    if (this.sanity <= 0) this.lose('The Warden claims you.');
  }

  checkTileEvents() {
    const { tx, ty } = this.player;
    // Collect EVERY key on this tile (keysAt, not keyAt): if two keys ever
    // shared a tile, the second must still be picked up, not silently lost.
    for (const key of keysAt(this.manor, tx, ty)) {
      key.taken = true;
      this.keys.add(key.id);
      this.narrate('key_found', { key: key.name });
      this.emit('key', `Picked up the ${key.name}.`);
      this.updateHint();
    }
    const candle = candleAt(this.manor, tx, ty);
    if (candle) {
      candle.taken = true;
      this.oil = Math.min(100, this.oil + 30);
      this.oilLowWarned = false;
      this.narrate('candle_found', {});
      this.emit('candle', 'Candle found — oil +30.');
    }
    // Auto-open a key door the player walks into while holding its key.
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= this.manor.width || ny >= this.manor.height) continue;
      const t = this.manor.grid[ny * this.manor.width + nx];
      if (t !== TILE.KEY_DOOR) continue;
      const door = doorAt(this.manor, nx, ny);
      if (door && !door.open && this.keys.has(door.keyId)) {
        door.open = true;
        this.manor.grid[ny * this.manor.width + nx] = TILE.FLOOR;
        this.emit('door', `The ${['Brass', 'Iron'][door.keyId]} Key turns. The door swings open.`);
        this.updateHint();
      }
    }
  }

  checkRoomEvents() {
    const room = roomAt(this.manor, this.player.tx, this.player.ty);
    if (!room) return;
    if (room.id === this.currentRoomId) return;
    this.currentRoomId = room.id;
    if (room.candleLit && this.sanity < 100) {
      this.addSanity(10, 'candle-room');
      this.emit('candle-room', 'Candlelight steadies you. Sanity +10.');
    }
    if (this.visitedRooms.has(room.id)) return;
    this.visitedRooms.add(room.id);
    this.narrate('enter_room', { roomType: room.type });
    // Seeded scare on first entry to some rooms (not the spawn foyer).
    if (room.id !== 0 && this.rng.chance(0.25)) {
      this.addSanity(-5, 'scare');
      this.flash = 1;
      this.emit('scare', 'Something moves in the dark. −5 sanity.');
    }
  }

  /** Cancel an in-progress relic channel, telling the player why. No-op if none. */
  cancelChannel() {
    if (!this.channel) return;
    this.channel = null;
    // 'channel-cancel' carries text, so index.html shows it as a HUD toast.
    this.emit('channel-cancel', CHANNEL_CANCEL_TEXT);
  }

  /** Nearest interactable: relic pedestal, riddle door, or locked key door. */
  nearestInteractable() {
    const { tx, ty } = this.player;
    const near = (x, y) => Math.hypot(x + 0.5 - this.player.x, y + 0.5 - this.player.y) <= INTERACT_RADIUS;
    for (const r of this.manor.relics) {
      if (!r.taken && near(r.x, r.y)) return { kind: 'relic', relic: r };
    }
    for (const d of this.manor.doors) {
      if (d.open) continue;
      if (!near(d.x, d.y)) continue;
      if (d.kind === 'riddle') return { kind: 'riddle', door: d };
      if (d.kind === 'key' && !this.keys.has(d.keyId)) {
        return { kind: 'locked', door: d, needKey: d.keyId };
      }
    }
    return null;
  }

  /** E / Space / tap: interact with whatever is in reach. Returns an action. */
  interact() {
    if (this.state !== 'playing') return null;
    const it = this.nearestInteractable();
    if (!it) return null;
    if (it.kind === 'relic') {
      this.channel = { relic: it.relic, progress: 0 };
      this.emit('channel', `Claiming the ${it.relic.name}… hold still.`);
      return { action: 'channel', relic: it.relic.name };
    }
    if (it.kind === 'riddle') {
      this.riddleDoor = it.door;
      this.riddle = it.door.riddle;
      this.state = 'riddle';
      return { action: 'riddle', riddle: it.door.riddle };
    }
    if (it.kind === 'locked') {
      this.narrate('door_locked', {});
      this.emit('door', 'Locked. You need the right key.');
      return { action: 'locked', needKey: it.needKey };
    }
    return null;
  }

  /** Answer the open riddle (choice index). Returns true if correct. */
  answerRiddle(choiceIndex) {
    if (this.state !== 'riddle' || !this.riddleDoor) return false;
    const correct = choiceIndex === this.riddle.answer;
    if (correct) {
      const d = this.riddleDoor;
      d.open = true;
      this.manor.grid[d.y * this.manor.width + d.x] = TILE.FLOOR;
      this.narrate('riddle_right', {});
      this.emit('door', 'The riddle door swings open.');
      this.updateHint();
    } else {
      this.addSanity(-5, 'riddle-wrong');
      this.narrate('riddle_wrong', {});
      this.emit('riddle-wrong', 'Wrong answer. −5 sanity.');
    }
    this.riddleDoor = null;
    this.riddle = null;
    this.state = 'playing';
    if (this.sanity <= 0) this.lose('Your sanity shattered. The Warden claims you.');
    return correct;
  }

  cancelRiddle() {
    if (this.state !== 'riddle') return;
    this.riddleDoor = null;
    this.riddle = null;
    this.state = 'playing';
  }

  win() {
    this.state = 'won';
    this.bestMs = setBestTime(this.seed, Math.round(this.elapsed * 1000));
    this.narrate('victory', {});
    this.emit('win', `You escaped in ${formatTime(this.elapsed * 1000)}!`);
  }

  lose(reason) {
    if (this.state === 'lost') return;
    this.state = 'lost';
    this.lostReason = reason;
    this.emit('lose', reason);
  }

  /** Hint for the HUD: next objective, via BFS with currently held keys. */
  updateHint() {
    const from = { x: this.player.tx, y: this.player.ty };
    const nextRelic = this.manor.relics.find((r) => !r.taken);
    if (nextRelic) {
      const path = bfsPath(this.manor, from, { x: nextRelic.x, y: nextRelic.y }, this.keys);
      if (path) {
        this.hint = `Find the ${nextRelic.name} — ${path.length - 1} steps away.`;
        return;
      }
      // Blocked by a door whose key we lack: point at the key.
      const missing = this.manor.keys.find((k) => !k.taken && !this.keys.has(k.id));
      if (missing) {
        this.hint = `A locked door bars the way — find the ${missing.name} first.`;
        return;
      }
      this.hint = `Find the ${nextRelic.name}.`;
      return;
    }
    const path = bfsPath(this.manor, from, { x: this.manor.exit.x, y: this.manor.exit.y }, this.keys);
    if (path) {
      this.hint = this.relicsGot >= this.relicsTotal
        ? `All relics found — reach the EXIT, ${path.length - 1} steps away!`
        : `Reach the EXIT, ${path.length - 1} steps away.`;
    } else {
      this.hint = 'Reach the EXIT.';
    }
    if (this.relicsGot >= this.relicsTotal && !this.escapeAnnounced) {
      this.escapeAnnounced = true;
      this.narrate('escape', {});
    }
  }
}
