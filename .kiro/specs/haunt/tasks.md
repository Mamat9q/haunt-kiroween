# HAUNT — Tasks

Status markers: `[ ]` todo, `[~]` in progress, `[x]` done. Update as work lands.

## Phase 1 — Foundation
- [x] Kiro CLI installed (3.4.0) on VM
- [ ] Kiro CLI signed in (device flow — parent completing; code HRRL-NRLF)
- [x] Spec skeleton: requirements.md, design.md, tasks.md
- [ ] Steering files: product.md, tech.md, structure.md
- [ ] Custom agents: spooky-ux, playtester
- [ ] Agent hook: test-on-save (runs `node --test` + lint on JS save)
- [ ] MCP config: fetch + playwright (local/free) wired and used
- [ ] Repo skeleton: index.html shell, css, js module stubs, LICENSE (MIT), .gitignore (must NOT exclude .kiro)
- [ ] GitHub repo created via browser (parent): Mamat9q/haunt-kiroween, public

## Phase 2 — Core game
- [x] rng.js: mulberry32 + xmur3 seed hash (unit-tested)
- [x] manor.js: generator (rooms, corridors, doors, keys, relics, exit) + BFS solvability check
- [x] render.js: canvas, fog of war, candlelight, entities, particles
- [x] game.js: loop, input (WASD/arrows + mobile D-pad), collision, sanity/oil, win/lose
- [x] warden.js: patrol AI, line-of-sight, chase, contact penalty
- [x] Puzzles: riddle doors (3-choice), key doors, relic pedestals
- [x] HUD + menus: title screen, pause, game over, victory, seed entry, daily manor, difficulty
- [x] Local leaderboard (best escape time per seed, localStorage)

## Phase 3 — Narration & audio
- [x] narration.js: offline templated engine (≥6 variants per room-type × event)
- [x] OpenRouter client: optional user key (localStorage only), 6s timeout, silent fallback
- [x] audio.js: WebAudio wind/creaks/heartbeat, mute toggle, starts on first interaction

## Phase 4 — Verification (gates)
- [x] Property tests: determinism, connectivity, solvability, relic placement, door/key ordering (≥20 seeds) — 36 seeds, 218 tests, `npm test` green 17 Nov 2026
- [x] Playtest harness: 20 scripted playthroughs, 0 errors, win proven on multiple seeds — 20/20 won in Mode A (real Game class), `node tests/playtest.js` green 17 Nov 2026
- [x] Fallback narration proven with no API key — Narrator offline engine, 0 fetch calls, deterministic per seed, bank depth ≥6 verified
- [ ] Manual playtest: full escape on desktop + mobile layout check
- [ ] GitHub Pages live, game playable from the public URL

## Phase 5 — Submission
- [ ] Demo video <3 min (script + screen capture of real gameplay)
- [ ] Devpost submission draft: description + Kiro usage write-up + Costume Contest category
- [ ] Screenshots for README + Devpost
- [ ] Social Blitz post draft (#KiroweenHackathon26) + blog post draft
- [ ] Kiro credit request filed (4,000 credits, by 1 Dec 12:00 PT) — needs Kiro user ID
- [ ] Submit on Devpost by 3 Dec 2026 (internal target)
