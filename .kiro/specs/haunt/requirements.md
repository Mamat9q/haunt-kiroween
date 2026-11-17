# HAUNT — Requirements

**Project:** HAUNT — an AI-narrated haunted-house escape game (static web app, zero backend, free only).
**Contest:** Kiroween 2026 (Devpost, AWS Kiro), category: **Costume Contest** — "Build any app but show us a haunting UI that's polished and unforgettable; spooky design must enhance the app's function".
**Entrant:** Mat Lail Pajri (GitHub: Mamat9q), solo. **Deadline:** Fri 4 Dec 2026 14:00 PT (Sat 5 Dec 05:00 WIB). Internal target: submit by 3 Dec 2026.
**Stack:** plain HTML/CSS/JS, no build step, no backend, no paid services. Deployed on GitHub Pages.

## 1. Core loop (the one thing that must be excellent)

1. The player wakes in a procedurally generated haunted manor (seeded layout: rooms, corridors, locked doors, keys, relics).
2. Explore the manor, solve small puzzles (riddles, find keys, avoid the Warden's patrol), collect **3 relics**, reach the exit door, escape.
3. **Sanity meter:** drains in darkness and on scare events; restored slightly by candlelight/safe rooms. Sanity 0 = the Warden claims you (game over).
4. **Lantern oil / candles:** a consumable resource that extends your light radius. Running out of oil in the dark drains sanity fast.
5. **The Warden:** a patrolling ghost. If it catches you in its line of sight at close range, you lose sanity and are pushed back; if sanity is low, it ends the run.

## 2. The AI Ghost (the Warden) — narration

- The Warden narrates each room the player enters, taunts the player, and reacts to events (finding a relic, losing sanity, being spotted).
- **Primary path:** OpenRouter free models (e.g. `meta-llama/llama-3.1-8b-instruct:free` or similar free tier). The API key is **optional and user-supplied in the app UI** (stored only in localStorage, never sent anywhere else). No key is ever bundled in the repo.
- **Fallback path (mandatory):** a built-in offline narration engine with templated spooky prose that varies by room type, event, and relic. The game must be **fully playable and atmospheric with no key at all** — judges must be able to play it with zero setup.
- Narration must never block gameplay: if the API call fails or times out (>6s), fall back silently to the offline engine.

## 3. Presentation (Costume Contest — the UI IS the costume)

- Top-down 2D canvas with **fog of war** and a **candlelight radius** around the player (darkness is a mechanic, not just decoration).
- Spooky, polished UI: drifting fog, candle flicker, blood-red + bone-white palette, custom display typography (Google Fonts, system fallback if offline), animated title screen.
- WebAudio ambient sound (wind, distant creaks, heartbeat when the Warden is near) with a **mute toggle**. Audio starts only after user interaction (browser autoplay policy).
- Responsive: playable on desktop (WASD/arrows) and mobile (on-screen D-pad + tap-to-move optional). Desktop is the primary target for judges.

## 4. Modes & sharing

- **Seeded manors:** every manor is generated from a seed string. Same seed = same manor (deterministic). "Challenge a friend with the same manor" — copy/share seed link (`?seed=...`).
- **Daily manor:** seed = current date (YYYY-MM-DD), one shared manor per day.
- **Local leaderboard:** best escape time per seed, stored in localStorage.
- **Difficulty:** at least Normal and Hard (Hard: less oil, faster Warden, faster sanity drain).

## 5. Quality gates (non-negotiable)

- At least **20 scripted playthroughs, 0 errors** (automated harness driving the game headlessly or via DOM simulation).
- Full escape path **proven winnable** for multiple seeds (solver/BFS check on generated manors: exit reachable, all 3 relics reachable, keys reachable before their doors).
- Fallback narration **proven with no API key**.
- Seeded manor **proven solvable** for ≥20 seeds (property tests).
- No console errors on a full playthrough. No external paid dependency. Game loads and is playable from `file://` and from GitHub Pages.

## 6. Non-goals (scope discipline)

- No multiplayer, no accounts, no server, no leaderboard server, no in-app purchases.
- No feature hub / no mini-game collection. One excellent core loop.
- No paid AI: the OpenRouter key is optional; the offline engine is the default experience.

## 7. Submission requirements (Devpost)

- Public GitHub repo (Mamat9q/haunt-kiroween) with MIT license visible in About, `/.kiro` directory at repo root (specs, hooks, steering) and **NOT in .gitignore**.
- Working app URL (GitHub Pages).
- Text description + demo video <3 min, public on YouTube.
- Write-up on how Kiro was used (IDE/CLI/Web/Crew, custom agents, hooks, spec-driven dev, steering, MCP, property-based testing, Kiro powers).
