// warden.js — the Warden: patrolling ghost AI for HAUNT.
// Pure logic, no DOM. States: patrol -> chase (4s) -> patrol.
// Line of sight: Bresenham, walls block. The Warden walks the manor's
// corridors like the player (BFS pathing) — it cannot phase through walls,
// so breaking line of sight around a corner genuinely escapes it.
// Contact costs sanity (applied by game.js).

import { TILE, bfsPath } from './manor.js';
import { createRng } from './rng.js';

export const WARDEN_STATES = { PATROL: 'patrol', CHASE: 'chase' };

function tileAt(manor, x, y) {
  if (x < 0 || y < 0 || x >= manor.width || y >= manor.height) return TILE.WALL;
  return manor.grid[y * manor.width + x];
}

/** Bresenham line of sight: true if no WALL tile lies between the two tiles. */
export function hasLineOfSight(manor, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    if (!((x === x0 && y === y0) || (x === x1 && y === y1))) {
      if (tileAt(manor, x, y) === TILE.WALL) return false;
    }
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

export function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * @param {object} manor — generated manor
 * @param {string} seedString — run seed (Warden waypoints derive from it)
 * @param {object} opts — { speed, chaseSpeed, sightRange, chaseTime }
 */
export function createWarden(manor, seedString, opts = {}) {
  const rng = createRng(`${seedString}::warden`);
  const waypoints = rng
    .shuffle(manor.rooms.map((r) => ({ x: r.cx + 0.5, y: r.cy + 0.5 })))
    .filter((w) => !(w.x === manor.spawn.x + 0.5 && w.y === manor.spawn.y + 0.5));
  // Start far from the player: last waypoint in the shuffled order.
  const start = waypoints[waypoints.length - 1] || { x: manor.exit.x + 0.5, y: manor.exit.y + 0.5 };

  const warden = {
    x: start.x,
    y: start.y,
    state: WARDEN_STATES.PATROL,
    speed: opts.speed ?? 2.1, // tiles / second while patrolling
    chaseSpeed: opts.chaseSpeed ?? 3.4,
    sightRange: opts.sightRange ?? 5,
    chaseTime: opts.chaseTime ?? 4,
    chaseLeft: 0,
    waypointIndex: 0,
    waypoints,
    path: null, // BFS tile path currently being followed
    pathIndex: 0,
    repathIn: 0,
    time: 0, // warden's own clock (seconds)
    calmUntil: 0, // no new chase may start before this time (post-contact recoil)
    spotted: false, // true on the exact tick the Warden first sees the player
    contact: false, // true on the tick it touches the player
    visibleToPlayer: false,

    tilePos() {
      return { x: Math.floor(this.x), y: Math.floor(this.y) };
    },

    /** (Re)compute a walkable path to a target tile. */
    repath(target) {
      const from = this.tilePos();
      this.path = bfsPath(manor, from, { x: Math.floor(target.x), y: Math.floor(target.y) }, new Set());
      this.pathIndex = 0;
      return this.path;
    },

    /** Walk along the current path at `speed` tiles/s. Returns true if arrived. */
    followPath(dt, speed) {
      if (!this.path || this.pathIndex >= this.path.length) return true;
      // Skip nodes we are already standing on.
      while (this.pathIndex < this.path.length) {
        const n = this.path[this.pathIndex];
        if (distance(this.x, this.y, n.x + 0.5, n.y + 0.5) > 0.15) break;
        this.pathIndex++;
      }
      if (this.pathIndex >= this.path.length) return true;
      const n = this.path[this.pathIndex];
      const dx = (n.x + 0.5) - this.x;
      const dy = (n.y + 0.5) - this.y;
      const len = Math.hypot(dx, dy);
      const step = Math.min(len, speed * dt);
      this.x += (dx / len) * step;
      this.y += (dy / len) * step;
      return false;
    },

    /** Advance the Warden one tick. `player` = {x, y} in tile coords (floats). */
    update(dt, player, _isPlayerLit) {
      this.time += dt;
      this.spotted = false;
      this.contact = false;
      const d = distance(this.x, this.y, player.x, player.y);
      const sees = d <= this.sightRange
        && hasLineOfSight(manor, Math.floor(this.x), Math.floor(this.y), Math.floor(player.x), Math.floor(player.y));
      this.visibleToPlayer = sees;

      if (sees && this.state !== WARDEN_STATES.CHASE && this.time >= this.calmUntil) {
        this.state = WARDEN_STATES.CHASE;
        this.chaseLeft = this.chaseTime;
        this.spotted = true;
        this.repath(player); // hunt the player down the corridors
        this.repathIn = 0.4;
      }
      if (this.state === WARDEN_STATES.CHASE) {
        this.chaseLeft -= dt;
        this.repathIn -= dt;
        if (this.repathIn <= 0) {
          this.repath(player);
          this.repathIn = 0.4;
        }
        if (this.chaseLeft <= 0) {
          this.state = WARDEN_STATES.PATROL;
          this.path = null;
        }
      }

      if (this.state === WARDEN_STATES.CHASE) {
        this.followPath(dt, this.chaseSpeed);
      } else {
        // Patrol: walk the waypoint loop, one BFS leg at a time.
        const wp = this.waypoints[this.waypointIndex];
        if (!this.path) this.repath(wp);
        const arrived = this.followPath(dt, this.speed);
        if (arrived) {
          this.waypointIndex = (this.waypointIndex + 1) % this.waypoints.length;
          this.path = null;
        }
      }

      const dAfter = distance(this.x, this.y, player.x, player.y);
      if (dAfter < 0.9) this.contact = true;
      return { state: this.state, dist: dAfter, spotted: this.spotted, contact: this.contact };
    },

    distanceTo(player) {
      return distance(this.x, this.y, player.x, player.y);
    },

    /**
     * After claiming a piece of the player's sanity the Warden recoils:
     * it breaks off the hunt and will not start a new chase for `seconds`.
     * This is what makes contact survivable instead of a chain of hits.
     */
    recoil(seconds = 6) {
      this.state = WARDEN_STATES.PATROL;
      this.chaseLeft = 0;
      this.path = null;
      this.calmUntil = this.time + seconds;
    },
  };
  return warden;
}
