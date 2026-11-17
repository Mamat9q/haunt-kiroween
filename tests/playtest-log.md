# HAUNT — playtest log

Generated: 2026-11-17T05:49:40.385Z (local run, Node v24.22.1).
Harness: `node tests/playtest.js` — solver policy BFS to nearest objective (key → relic → exit).
Mode: **A — real js/game.js Game class** (Game class OK (probe state=playing, player @19,11))
Solver: dt=0.05s/tick, tick cap 30000, stuck threshold 160 ticks, relic channel = stand still 1s via interact(). Riddle doors are answered from the exposed riddle object (game.riddle.answer) — the harness proves the door CAN be opened; a human player reads the riddle.

## Summary

- Seeds played: 20
- Won: **20/20** (gate: ≥ 15) — PASS
- Lost: 0
- Errors (exceptions): **0** (gate: 0) — PASS
- Fallback narration with no API key: PASS (via Narrator.line (offline engine); 7 distinct enter_room/Library lines over 40 seeds; deterministic per seed: true; 0 fetch calls)
- Network calls during whole run: 0 (gate: 0) — PASS
- **Overall: PASS**

## Per-seed results

| seed | result | ticks | game time (s) | sanity at end | oil at end | min sanity | relics | riddles | warden contacts | wall (ms) | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| haunt-play-00 | won | 198 | 9.8 | 89.4 | 100 | 83.7 | 3/3 | 0 | 1 | 163 |  |
| haunt-play-01 | won | 177 | 8.7 | 85.8 | 93.2 | 84.9 | 3/3 | 0 | 1 | 95 |  |
| haunt-play-02 | won | 278 | 13.8 | 100 | 96.2 | 100 | 3/3 | 0 | 0 | 74 |  |
| haunt-play-03 | won | 298 | 14.8 | 100 | 92.2 | 84.8 | 3/3 | 0 | 1 | 98 |  |
| haunt-play-04 | won | 258 | 12.7 | 92 | 100 | 80.8 | 3/3 | 1 | 2 | 47 |  |
| haunt-play-05 | won | 173 | 8.5 | 95 | 97.5 | 95 | 3/3 | 0 | 0 | 32 |  |
| haunt-play-06 | won | 265 | 13.1 | 93.6 | 97.6 | 82 | 3/3 | 0 | 1 | 77 |  |
| haunt-play-07 | won | 305 | 15 | 81.1 | 85 | 70.6 | 3/3 | 1 | 1 | 81 |  |
| haunt-play-08 | won | 205 | 10 | 99.2 | 90 | 95 | 3/3 | 1 | 0 | 100 |  |
| haunt-play-09 | won | 212 | 10.4 | 100 | 95 | 100 | 3/3 | 1 | 0 | 53 |  |
| haunt-play-10 | won | 275 | 13.6 | 95 | 100 | 95 | 3/3 | 0 | 0 | 48 |  |
| haunt-play-11 | won | 278 | 13.7 | 86.4 | 86.4 | 84.7 | 3/3 | 1 | 2 | 45 |  |
| haunt-play-12 | won | 184 | 9 | 82.5 | 91.7 | 82.5 | 3/3 | 0 | 1 | 61 |  |
| haunt-play-13 | won | 348 | 17.3 | 100 | 99.8 | 77.5 | 3/3 | 0 | 2 | 100 |  |
| haunt-play-14 | won | 329 | 16.3 | 89.8 | 100 | 79.4 | 3/3 | 0 | 1 | 50 |  |
| haunt-play-15 | won | 258 | 12.8 | 99.4 | 97 | 84.4 | 3/3 | 0 | 1 | 31 |  |
| haunt-play-16 | won | 275 | 13.5 | 100 | 86.5 | 100 | 3/3 | 1 | 0 | 31 |  |
| haunt-play-17 | won | 236 | 11.7 | 97.6 | 100 | 95 | 3/3 | 0 | 0 | 23 |  |
| haunt-play-18 | won | 380 | 18.9 | 95.8 | 83.6 | 69.5 | 3/3 | 0 | 2 | 53 |  |
| haunt-play-19 | won | 235 | 11.6 | 88.2 | 100 | 88.2 | 3/3 | 0 | 0 | 32 |  |

## Fallback narration sample (no key set)

- **start**: “Cold air. Candle smoke. Somewhere, a door you did not open stands open.”
- **enter_room**: “Portraits line the foyer walls, and every painted eye has turned to watch you enter.”
- **relic_found**: “The Obsidian Mirror is yours now. Somewhere below, the Warden screams without a mouth.”
- **key_found**: “You take the Brass Key. Somewhere, a lock sighs with relief — or dread.”
- **door_locked**: “The door will not open. Behind it, something patient is smiling.”
- **riddle_wrong**: “The door rejects your answer with a cold sigh. Think, little guest. Think.”
- **riddle_right**: “The lock clicks, the door sighs, and the dark beyond steps aside for you.”
- **warden_spotted**: “The Warden sees you. RUN.”
- **sanity_low**: “You cannot remember why you came here. That is the house, taking its tithe.”
- **oil_low**: “Your light is dying. The manor notices. The manor always notices.”
- **candle_found**: “Light, at last. Your lantern drinks it greedily.”
- **escape**: “The door to the world waits. Three relics hum in your pockets. Go.”
- **victory**: “Cold air, grey light, your own heartbeat — you made it out of the manor alive.”

## Notes / gaps

- Mode A ran: win/lose verdicts come from the real Game instance (movement, collision, sanity/oil, Warden, riddle/key doors, relic channels, win/lose states).
- Warden contact penalties ARE exercised in Mode A (game.update runs the Warden; contacts counted above).
- Riddle doors in Mode A are answered correctly from game.riddle.answer; wrong-answer sanity cost (-5) is not exercised by the solver.
