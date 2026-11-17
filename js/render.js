// render.js — canvas 2D rendering for HAUNT: tiles, fog of war, candlelight,
// vector-glyph entities, dust/fog particles, minimap.
// Cosmetic-only Math.random is used here (flicker, particles) — never game logic.

import { TILE } from './manor.js';

export const TILE_SIZE = 32;

const ROOM_TINTS = {
  Foyer: '#1a1512', Library: '#141a12', Kitchen: '#1a140e', Chapel: '#12141c',
  Cellar: '#100f14', Bedroom: '#1a1216', Gallery: '#14161a', Study: '#151a14',
};
const WALL_TOP = '#3a2f28';
const WALL_FACE = '#17110e';

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{render:(state)=>void, resize:()=>void}}
 * state: { manor, player:{x,y}, warden, explored:Uint8Array, time, lanternOn,
 *   oil, channel:{active,progress}|null, flash, reducedMotion }
 */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  // Preallocated dust motes (cosmetic only).
  const motes = Array.from({ length: 70 }, () => ({
    x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.6,
    s: 0.1 + Math.random() * 0.35, a: 0.15 + Math.random() * 0.4,
  }));

  function resize() {
    const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
    const w = canvas.clientWidth || 960;
    const h = canvas.clientHeight || 600;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function tileAt(manor, x, y) {
    if (x < 0 || y < 0 || x >= manor.width || y >= manor.height) return TILE.WALL;
    return manor.grid[y * manor.width + x];
  }

  function drawGlyph(glyph, sx, sy, t) {
    ctx.save();
    ctx.translate(sx, sy);
    if (glyph === 'player') {
      // Hooded figure.
      ctx.fillStyle = '#e8e0d0';
      ctx.beginPath();
      ctx.arc(0, -4, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2b2118';
      ctx.beginPath();
      ctx.arc(0, -4, 7, Math.PI * 0.15, Math.PI * 0.85);
      ctx.fill();
      ctx.fillStyle = '#c9a86a';
      ctx.fillRect(-2.5, -6, 2, 2);
      ctx.fillRect(1.5, -6, 2, 2);
      ctx.fillStyle = '#3d2f23';
      ctx.beginPath();
      ctx.moveTo(-8, 12);
      ctx.quadraticCurveTo(0, -2, 8, 12);
      ctx.closePath();
      ctx.fill();
    } else if (glyph === 'warden') {
      // Pale wisp with trailing shroud.
      const pulse = 0.75 + 0.25 * Math.sin(t * 3);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#dfe8ff';
      ctx.beginPath();
      ctx.arc(0, -6, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-9, -2);
      ctx.quadraticCurveTo(-13, 12 + Math.sin(t * 2) * 3, -5, 12);
      ctx.quadraticCurveTo(0, 6, 5, 12);
      ctx.quadraticCurveTo(13, 12 + Math.cos(t * 2) * 3, 9, -2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0a0a12';
      ctx.fillRect(-4.5, -8, 2.4, 3);
      ctx.fillRect(2, -8, 2.4, 3);
    } else if (glyph === 'relic') {
      ctx.fillStyle = '#ffd76a';
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff9d00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 10 + Math.sin(t * 4) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#7a5c00';
      ctx.font = 'bold 10px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('◆', 0, 0.5);
    } else if (glyph === 'key') {
      ctx.strokeStyle = '#e8c85a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(-3, 0, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(1, 0);
      ctx.lineTo(9, 0);
      ctx.moveTo(6, 0);
      ctx.lineTo(6, 4);
      ctx.moveTo(9, 0);
      ctx.lineTo(9, 4);
      ctx.stroke();
    } else if (glyph === 'candle') {
      ctx.fillStyle = '#fff2c9';
      ctx.fillRect(-2, -4, 4, 9);
      ctx.fillStyle = '#ffb347';
      ctx.beginPath();
      ctx.arc(0, -7, 2.6 + Math.sin(t * 9) * 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else if (glyph === 'exit') {
      ctx.strokeStyle = '#8affc1';
      ctx.lineWidth = 2;
      ctx.strokeRect(-9, -11, 18, 22);
      ctx.fillStyle = '#8affc1';
      ctx.font = 'bold 11px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('EXIT', 0, 0);
    }
    ctx.restore();
  }

  function render(state) {
    const { manor, player, warden, explored, time } = state;
    const viewW = canvas.clientWidth || 960;
    const viewH = canvas.clientHeight || 600;
    const flicker = state.reducedMotion ? 1 : 0.92 + Math.random() * 0.14;
    const lightR = (state.lanternOn && state.oil > 0 ? 4.6 : 2.6) * TILE_SIZE * flicker;
    const camX = Math.max(0, Math.min(
      manor.width * TILE_SIZE - viewW,
      player.x * TILE_SIZE - viewW / 2,
    ));
    const camY = Math.max(0, Math.min(
      manor.height * TILE_SIZE - viewH,
      player.y * TILE_SIZE - viewH / 2,
    ));
    const toScreen = (tx, ty) => ({
      x: (tx + 0.5) * TILE_SIZE - camX,
      y: (ty + 0.5) * TILE_SIZE - camY,
    });

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, viewW, viewH);

    const x0 = Math.max(0, Math.floor(camX / TILE_SIZE));
    const y0 = Math.max(0, Math.floor(camY / TILE_SIZE));
    const x1 = Math.min(manor.width - 1, Math.ceil((camX + viewW) / TILE_SIZE));
    const y1 = Math.min(manor.height - 1, Math.ceil((camY + viewH) / TILE_SIZE));

    // --- tiles ---
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * manor.width + x;
        if (!explored[i]) continue; // fog of war: unexplored is pure black
        const t = manor.grid[i];
        const sx = x * TILE_SIZE - camX;
        const sy = y * TILE_SIZE - camY;
        if (t === TILE.WALL) {
          ctx.fillStyle = WALL_FACE;
          ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
          ctx.fillStyle = WALL_TOP;
          ctx.fillRect(sx, sy, TILE_SIZE, 4);
        } else {
          const room = manor.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
          ctx.fillStyle = room ? ROOM_TINTS[room.type] || '#171310' : '#171310';
          ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.strokeRect(sx + 0.5, sy + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
          if (room?.candleLit) {
            ctx.fillStyle = 'rgba(255,179,71,0.05)';
            ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
          }
        }
        if (t === TILE.KEY_DOOR || t === TILE.RIDDLE_DOOR) {
          ctx.fillStyle = t === TILE.KEY_DOOR ? '#6b4d12' : '#4d2a6b';
          ctx.fillRect(sx + 3, sy, TILE_SIZE - 6, TILE_SIZE);
          ctx.fillStyle = '#e8c85a';
          ctx.font = 'bold 13px serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(t === TILE.KEY_DOOR ? '🔒' : '?', sx + TILE_SIZE / 2, sy + TILE_SIZE / 2);
        }
      }
    }

    // --- objects ---
    const drawIfExplored = (tx, ty, glyph) => {
      if (!explored[ty * manor.width + tx]) return;
      const p = toScreen(tx, ty);
      drawGlyph(glyph, p.x, p.y, time);
    };
    for (const k of manor.keys) if (!k.taken) drawIfExplored(k.x, k.y, 'key');
    for (const c of manor.candles) if (!c.taken) drawIfExplored(c.x, c.y, 'candle');
    for (const r of manor.relics) if (!r.taken) drawIfExplored(r.x, r.y, 'relic');
    drawIfExplored(manor.exit.x, manor.exit.y, 'exit');

    // --- entities ---
    const pp = toScreen(Math.floor(player.x), Math.floor(player.y));
    // smooth position: player.x/y are already floats; draw at exact position
    const px = player.x * TILE_SIZE - camX;
    const py = player.y * TILE_SIZE - camY;
    drawGlyph('player', px, py, time);
    if (explored[Math.floor(warden.y) * manor.width + Math.floor(warden.x)]) {
      const wx = warden.x * TILE_SIZE - camX;
      const wy = warden.y * TILE_SIZE - camY;
      const glow = ctx.createRadialGradient(wx, wy, 2, wx, wy, 46);
      glow.addColorStop(0, 'rgba(160,180,255,0.25)');
      glow.addColorStop(1, 'rgba(160,180,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(wx - 46, wy - 46, 92, 92);
      drawGlyph('warden', wx, wy, time);
    }

    // --- relic channel progress ring ---
    if (state.channel?.active) {
      ctx.strokeStyle = '#ffd76a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(px, py - 18, 12, -Math.PI / 2, -Math.PI / 2 + state.channel.progress * Math.PI * 2);
      ctx.stroke();
    }

    // --- candlelight / darkness overlay ---
    const grad = ctx.createRadialGradient(px, py, 8, px, py, lightR * 1.9);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.45, 'rgba(0,0,0,0.25)');
    grad.addColorStop(0.75, 'rgba(0,0,0,0.82)');
    grad.addColorStop(1, 'rgba(0,0,0,0.96)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, viewW, viewH);

    // --- dust motes inside the light ---
    if (!state.reducedMotion) {
      for (const m of motes) {
        const mx = px + (m.x - 0.5) * lightR * 1.6;
        const my = py + (m.y - 0.5) * lightR * 1.6;
        ctx.globalAlpha = m.a * (0.6 + 0.4 * Math.sin(time * m.s * 10 + m.x * 20));
        ctx.fillStyle = '#ffe9b0';
        ctx.beginPath();
        ctx.arc(mx, my, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // --- scare flash ---
    if (state.flash > 0 && !state.reducedMotion) {
      ctx.fillStyle = `rgba(180,10,10,${state.flash * 0.22})`;
      ctx.fillRect(0, 0, viewW, viewH);
    }

    drawMinimap(state, viewW, viewH);
    void pp;
  }

  function drawMinimap(state, viewW, viewH) {
    const { manor, explored, player, warden } = state;
    const s = 5;
    const mw = manor.width * s;
    const mh = manor.height * s;
    const ox = viewW - mw - 14;
    const oy = 14;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(5,4,3,0.85)';
    ctx.fillRect(ox - 5, oy - 5, mw + 10, mh + 10);
    ctx.strokeStyle = '#5a3a3a';
    ctx.strokeRect(ox - 5.5, oy - 5.5, mw + 11, mh + 11);
    for (let y = 0; y < manor.height; y++) {
      for (let x = 0; x < manor.width; x++) {
        const i = y * manor.width + x;
        if (!explored[i]) continue;
        const t = manor.grid[i];
        ctx.fillStyle = t === TILE.WALL ? '#241a14' : '#6b5a44';
        ctx.fillRect(ox + x * s, oy + y * s, s - 1, s - 1);
      }
    }
    for (const r of manor.relics) {
      if (r.taken) continue;
      ctx.fillStyle = '#ffd76a';
      ctx.fillRect(ox + r.x * s - 1, oy + r.y * s - 1, s + 1, s + 1);
    }
    ctx.fillStyle = '#8affc1';
    ctx.fillRect(ox + manor.exit.x * s - 1, oy + manor.exit.y * s - 1, s + 1, s + 1);
    if (explored[Math.floor(warden.y) * manor.width + Math.floor(warden.x)]) {
      ctx.fillStyle = '#aebaff';
      ctx.beginPath();
      ctx.arc(ox + warden.x * s, oy + warden.y * s, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ox + player.x * s, oy + player.y * s, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return { render, resize };
}
