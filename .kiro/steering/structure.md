# Steering — Structure

```
haunt-kiroween/
├── index.html                  — game shell, HUD, menus
├── css/haunt.css               — all styling
├── js/
│   ├── rng.js                  — seeded PRNG + seed hash
│   ├── manor.js                — procedural manor generator + solvability check
│   ├── warden.js               — Warden patrol AI
│   ├── narration.js            — offline narration engine + OpenRouter client
│   ├── audio.js                — WebAudio ambience
│   ├── render.js               — canvas rendering, fog of war, light
│   └── game.js                 — game loop, input, state, win/lose, leaderboard
├── tests/
│   ├── manor.property.test.js  — generator property tests (node --test)
│   └── playtest.js             — scripted playthrough harness (20 seeds)
├── docs/
│   ├── screenshots/            — README + Devpost screenshots
│   └── DEMO-VIDEO-SCRIPT.md    — demo video script
├── .kiro/
│   ├── specs/haunt/            — requirements.md, design.md, tasks.md
│   ├── steering/               — product.md, tech.md, structure.md
│   ├── agents/                 — spooky-ux.md, playtester.md
│   ├── hooks/                  — test-on-save.json
│   └── settings/mcp.json       — MCP servers (fetch, playwright)
├── README.md
├── LICENSE                     — MIT
└── .gitignore                  — MUST NOT exclude .kiro/
```

**Rules:**
- New game logic goes in `js/` as a focused module with a matching test in `tests/`.
- No file over ~600 lines; split before growing.
- No external assets (images/audio/fonts files) — all visuals are canvas/CSS, all audio is WebAudio-synthesized, fonts are Google Fonts with system fallback. The game must work fully offline except the optional narration API.
- `.kiro/` is committed at the repo root and is never gitignored.
