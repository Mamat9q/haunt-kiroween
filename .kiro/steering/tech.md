# Steering — Tech

- **Stack:** plain HTML/CSS/JS. No framework, no build step, no bundler, no backend, no paid services.
- **Runtime targets:** modern desktop browsers first (Chrome/Firefox/Safari), mobile layout second. Must work from `file://` and from GitHub Pages.
- **Modules:** ES modules in `js/`, one responsibility per file (see design.md). Shared code must be importable in Node for tests (no bare `window`/`document` at module top level — guard browser-only code).
- **Tests:** `node --test` (Node built-in runner). Property tests for the generator; a scripted playtest harness for full runs. `npm test` runs everything.
- **Determinism:** all randomness flows from a seeded PRNG (`rng.js`). Never call `Math.random()` in game logic — only for cosmetic effects (fog drift, flicker) where determinism does not matter.
- **API keys:** never bundled, never committed. The optional OpenRouter key lives only in the player's localStorage. Any API failure falls back silently to the offline narration engine.
- **Performance:** 60fps target on a modest laptop; canvas 2D only; no per-frame allocations in the hot loop.
- **Accessibility:** keyboard-first (WASD/arrows), visible focus states, mute toggle always reachable, reduced-motion respect (`prefers-reduced-motion` disables fog drift/flash).
