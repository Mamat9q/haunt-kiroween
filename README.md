# HAUNT 👻 — an AI-narrated haunted-house escape game

**Kiroween 2026 entry (Costume Contest) — built with AWS Kiro.**

You wake in a procedurally generated haunted manor. Collect the **3 relics**, avoid the Warden's patrol, and escape before your sanity runs out. The Warden — an AI ghost — narrates every room, taunts you, and reacts to your choices.

▶️ **Play it now:** https://mamat9q.github.io/haunt-kiroween/ *(live once GitHub Pages is enabled)*

## How to play

| Key | Action |
|-----|--------|
| WASD / Arrow keys | Move |
| L | Toggle lantern (saves oil, but darkness drains sanity) |
| M | Mute / unmute sound |
| P / Esc | Pause |

- **Sanity** drains in darkness and near the Warden. Candle-lit rooms restore it.
- **Lantern oil** is scarce — candles found in rooms refill it.
- **Locked doors** need keys; **riddle doors** need the right answer (wrong answers cost sanity).
- Collect all **3 relics**, then reach the **exit door** to escape. Your best time per manor is saved locally.

**Modes:** every manor is generated from a seed — share a seed (`?seed=...`) to challenge a friend with the same manor. The **Daily Manor** uses today's date as the seed. Difficulty: Normal / Hard.

## The AI Ghost (optional key, fully playable without one)

The Warden narrates via OpenRouter free models when you supply your own key in the settings panel (stored only in your browser's localStorage, never sent anywhere else). **No key? No problem** — a built-in offline narration engine tells the same gothic story, so the game is fully playable with zero setup. If the API fails or times out, the game falls back silently to offline narration.

## How it was built with Kiro

- **Spec-driven development:** the whole game was specified first in `.kiro/specs/haunt/` (`requirements.md` → `design.md` → `tasks.md`), then implemented task by task with Kiro CLI.
- **Steering:** `.kiro/steering/` holds the product, tech, and structure rules every change must follow (one core loop, static zero-backend, determinism via seeded PRNG).
- **Custom agents:** `.kiro/agents/spooky-ux.md` (atmosphere director — the spooky UI must enhance function) and `.kiro/agents/playtester.md` (ruthless judge — proves winnability, hunts soft-locks).
- **Hooks:** `.kiro/hooks/test-on-save.json` runs the full test suite on every JS save.
- **MCP:** `fetch` and `playwright` MCP servers configured in `.kiro/settings/mcp.json` and used for research and browser playtesting.
- **Property-based tests:** the manor generator is verified with `node --test` — determinism, connectivity, and solvability across many seeds. The playtest harness runs 20 scripted playthroughs with 0 errors.

See `.kiro/specs/haunt/` for the full spec.

## Run locally

```bash
# No build step. Just serve the folder (or open index.html directly):
python3 -m http.server 8000
# then open http://localhost:8000
```

```bash
# Tests
npm test
```

## License

MIT — see [LICENSE](LICENSE).
