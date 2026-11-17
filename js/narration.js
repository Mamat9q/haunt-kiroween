// narration.js — the Warden's voice for HAUNT.
// Offline templated engine is the DEFAULT experience (fully playable, no key).
// Optional OpenRouter path: user-supplied key from localStorage only, 6s timeout,
// one in-flight request max, silent fallback to offline. Never blocks gameplay.

import { createRng } from './rng.js';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_MODEL = 'meta-llama/llama-3.1-8b-instruct:free';
export const NARRATION_TIMEOUT_MS = 6000;
export const STORAGE_KEY = 'haunt.openrouter.key';

const SYSTEM_PROMPT = 'You are the Warden, a cruel ghost haunting an old manor. '
  + 'Speak in second person, present tense, gothic and menacing. '
  + 'One or two sentences only. Never break character. Never mention being an AI.';

// --- Offline template banks: every bank has >= 6 variants. ---
// {room} and {relic} placeholders are filled from context.

export const ENTER_ROOM_LINES = {
  Foyer: [
    'You stand in the foyer, and the front door seals itself behind you with a sigh.',
    'Dust hangs in the foyer air like held breath. Something here has been waiting for you.',
    'The foyer chandelier sways, though there is no wind. It knows your name now.',
    'Your footsteps echo twice in the foyer. The second echo is not yours.',
    'Portraits line the foyer walls, and every painted eye has turned to watch you enter.',
    'The foyer smells of rain and old roses. The manor exhales, and the candles bow.',
    'You cross the foyer threshold, and the house quietly locks the world out behind you.',
  ],
  Library: [
    'The library breathes paper and mildew. A book slams shut somewhere in the dark.',
    'Shelves tower over you in the library, and one spine slides out — then back in — as if tasting the air.',
    'You hear pages turning in the library, though no hand touches them. The books are reading you.',
    'The library lamps burn a sickly green. The marginalia in every book is your name.',
    'A whisper threads between the library stacks: stay, stay, stay.',
    'The library floor is littered with torn pages. Each one describes the moment you are living now.',
    'In the library, the card catalogue drawer slides open by itself. Your name is filed under D — for doomed.',
  ],
  Kitchen: [
    'The kitchen reeks of cold grease and something older. The knives hum in their block.',
    'A pot lid rattles in the kitchen, though the stove has been dead for decades.',
    'You step into the kitchen, and the hanging pans begin to swing, one by one, like a slow applause.',
    'The kitchen table is set for a feast no one ate. Your chair is already pulled out.',
    'Flies circle the kitchen in a perfect ring, though there is nothing here to eat.',
    'The kitchen tap drips red, then clear, then red again. The house is deciding.',
    'In the kitchen, a chair scrapes back across the floor. Nobody sits — but the seat is warm.',
  ],
  Chapel: [
    'The chapel air is thick with incense and dread. The pews face you, not the altar.',
    'Candles gutter in the chapel as you enter, and the hymn board spells out your sins.',
    'You kneel — no, you do not kneel. Something in the chapel wishes you would.',
    'The chapel bell tolls once, though its rope hangs still. It tolls for you.',
    'A choir you cannot see hums a single low note in the chapel. It follows your heartbeat.',
    'The chapel windows weep black rain. The saint in the glass has your face tonight.',
    'In the chapel, the altar cloth ripples like water. Something beneath it is breathing.',
  ],
  Cellar: [
    'The cellar swallows your light. The dark down here is older than the house.',
    'You descend into the cellar, and the steps behind you forget how to be steps.',
    'Wine barrels rot in the cellar, and something in the dark is drinking.',
    'The cellar floor is damp. The footprints in it are yours — but they walk away from you.',
    'A cold hand of air closes around your ankle in the cellar. It lets go. It is only playing.',
    'In the cellar, the jars on the shelves tap their glass, one after another, like a countdown.',
    'The cellar smells of earth and pennies. The manor keeps its secrets down here.',
  ],
  Bedroom: [
    'The bedroom is frozen mid-dream. The bed is made, the pillow still holds a head-shaped hollow.',
    'You enter the bedroom, and the wardrobe door creaks open an inch. An inch is enough.',
    'A music box plays in the bedroom, slow and out of tune, though its lid is shut.',
    'The bedroom mirror shows the room behind you — and someone standing where you stand.',
    'Dust sheets the bedroom furniture like shrouds. One sheet has been lifted, and set down again.',
    'In the bedroom, the rocking chair rocks. It has not stopped since 1911.',
    'The bedroom wallpaper peels in the shape of reaching hands. Do not touch it.',
  ],
  Gallery: [
    'The gallery stretches before you, portraits leaning from their frames to follow your steps.',
    'You walk the gallery, and the painted faces age as you pass, year by year.',
    'A frame in the gallery hangs empty. The canvas is on the floor, face down, breathing.',
    'The gallery floorboards tick like a clock counting down your remaining courage.',
    'In the gallery, a statue turns its head — just a fraction — as you look away.',
    'The gallery portraits all share one face now. It is a face you almost recognise.',
    'Your reflection in the gallery glass walks half a second behind you.',
  ],
  Study: [
    'The study desk is covered in letters, all addressed to you, all unopened, all dated tomorrow.',
    'You enter the study, and the quill on the desk begins to write — in your handwriting.',
    'The study fire is cold, but the chair before it is warm, and it is turned to face you.',
    'A globe spins slowly in the study. Every country on it is this house.',
    'In the study, the clock has stopped at the minute you were born.',
    'The study curtains billow, though the windows are nailed shut. The house is dreaming.',
    'You lift the study ledger. Your name is already written in it — in the column marked departed.',
  ],
};

export const EVENT_LINES = {
  start: [
    'You wake on cold floorboards, and the manor is already watching you.',
    'Darkness. Dust. A whisper curls around your name. You are awake — and you are not alone.',
    'Your eyes open in the foyer. The house has been waiting a long, long time for a guest.',
    'Cold air. Candle smoke. Somewhere, a door you did not open stands open.',
    'You wake with the taste of grave dirt on your tongue. The manor smiles.',
    'The dark presses close, then releases you. Find the relics. Leave, if you can.',
  ],
  relic_found: [
    'The {relic} burns cold in your hands. The manor shudders — it felt that.',
    'You claim the {relic}, and every candle in the house flares, then dies.',
    'The {relic} is yours now. Somewhere below, the Warden screams without a mouth.',
    'As your fingers close on the {relic}, the walls whisper: thief, thief, thief.',
    'The {relic} hums against your palm like a trapped heart. One less chain on the door.',
    'You hold the {relic} aloft, and the dark recoils a step. It will not forget this.',
  ],
  key_found: [
    'The {key} is cold, heavy, and eager. It wants to be used.',
    'You take the {key}. Somewhere, a lock sighs with relief — or dread.',
    'The {key} fits a door you have not found yet. The house knows which one.',
    'Cold metal, warm promise: the {key} hums faintly in your pocket.',
    'You pocket the {key}, and a corridor you have never seen unlocks itself in your mind.',
    'The {key} is yours. The manor hates giving up its secrets.',
  ],
  door_locked: [
    'Locked. The door rattles its handle like a chained dog. It wants a key.',
    'The door will not open. Behind it, something patient is smiling.',
    'You pull, you push — the lock holds. A key is hiding somewhere in this house.',
    'Locked tight. The keyhole watches you back, unblinking.',
    'The door groans but does not yield. Find the key, little thief.',
    'That door is sealed by old iron and older spite. The key is out there. Somewhere.',
  ],
  riddle_wrong: [
    'Wrong. The door laughs in a voice like grinding teeth, and your courage thins.',
    'The wrong answer. The manor drinks a little of your sanity and asks for more.',
    'No. The riddle door shudders, disappointed — or delighted. Hard to tell.',
    'Wrong again. The candles dim, as if the house itself is shaking its head.',
    'The door rejects your answer with a cold sigh. Think, little guest. Think.',
    'Incorrect. Something in the walls giggles, and your hands will not stop shaking.',
  ],
  riddle_right: [
    'Correct. The riddle door swings open, almost respectfully. Almost.',
    'The lock clicks, the door sighs, and the dark beyond steps aside for you.',
    'Well answered. Even the Warden pauses — a guest with a mind. How rare.',
    'The riddle unwinds like a held breath. The way is open. For now.',
    'Correct. The door opens with a groan that sounds almost like applause.',
    'The right words, at last. The manor concedes this one small victory.',
  ],
  warden_spotted: [
    'The Warden sees you. RUN.',
    'Cold light, hollow eyes — it has found you. Do not let it touch you.',
    'It turns, and the dark turns with it. It is coming for you now.',
    'You feel its gaze like ice water down your spine. MOVE.',
    'The Warden shrieks — a sound like tearing silk — and gives chase.',
    'Its eyes find you in the dark. The hunt begins. Again.',
  ],
  sanity_low: [
    'Your mind frays at the edges. The walls are breathing. Are they? They are.',
    'Sanity slips through your fingers like smoke. Find candlelight. Quickly.',
    'Your thoughts scatter like startled birds. The dark is getting inside you.',
    'You cannot remember why you came here. That is the house, taking its tithe.',
    'The floor tilts. The whispers get louder. Hold on to yourself, little guest.',
    'Your hands shake, your breath shortens. The manor can taste your fear now.',
  ],
  oil_low: [
    'Your lantern sputters. The oil is almost gone, and the dark is patient.',
    'The flame gutters, gasping. Find a candle, or learn to love the dark.',
    'Oil runs low. The light shrinks, and the shadows lean closer to listen.',
    'The lantern coughs, dims, begs. Feed it, or walk blind.',
    'Your light is dying. The manor notices. The manor always notices.',
    'Almost out of oil. Every shadow in the house is smiling now.',
  ],
  candle_found: [
    'A candle! Its flame steadies your hands — and your mind.',
    'You find a candle, and the dark retreats a polite step.',
    'Wax and wick and small brave light. The manor hates it. You love it.',
    'The candle flares as you take it, as if glad to be found.',
    'Light, at last. Your lantern drinks it greedily.',
    'A candle guttering in the gloom — a small mercy. Take it. Quickly.',
  ],
  escape: [
    'The exit stands before you, and beyond it — morning, air, life. If you dare.',
    'The door to the world waits. Three relics hum in your pockets. Go.',
    'Freedom is one door away. The manor holds its breath.',
    'The exit. Dawn is out there somewhere, waiting to forgive you.',
    'You can smell rain and freedom through the cracks. Run for it.',
    'The last door. The house screams behind you — but the night air is yours.',
  ],
  victory: [
    'You burst into the cold morning air, and the manor slams its door behind you. You lived.',
    'Dawn breaks as you stumble free. The Warden’s scream fades behind the walls. You escaped.',
    'You are out. The relics are yours, the night is over, and the house will wait for the next fool.',
    'Cold air, grey light, your own heartbeat — you made it out of the manor alive.',
    'The manor releases you, reluctantly, into the morning. Never come back.',
    'You escape, breathless and laughing and alive. The Warden will remember your name.',
  ],
};

function fill(template, ctx) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] !== undefined ? ctx[k] : `{${k}}`));
}

/** Pick an offline line for an event. `rng` must expose nextInt(min, max). */
export function offlineLine(event, roomType, rng, ctx = {}) {
  let bank = null;
  if (event === 'enter_room') bank = ENTER_ROOM_LINES[roomType] || ENTER_ROOM_LINES.Foyer;
  else bank = EVENT_LINES[event];
  if (!bank || !bank.length) bank = EVENT_LINES.start;
  return fill(bank[rng.nextInt(0, bank.length)], ctx);
}

// --- localStorage helpers (guarded: safe in Node, where localStorage is absent) ---
export function loadStoredKey() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) || '' : '';
  } catch {
    return '';
  }
}
export function saveStoredKey(key) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, key);
  } catch { /* storage unavailable — key simply is not persisted */ }
}
export function clearStoredKey() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

/** The Warden narrator: deterministic offline lines + optional OpenRouter lines. */
export class Narrator {
  constructor(seedString) {
    this.rng = createRng(`${seedString}::narrate`);
    this.apiKey = loadStoredKey();
    this.inFlight = null; // current fetch promise, at most one
    this.pending = null; // latest event waiting while a request is in flight
  }

  setApiKey(key) {
    this.apiKey = (key || '').trim();
    if (this.apiKey) saveStoredKey(this.apiKey);
    else clearStoredKey();
  }

  /** Deterministic offline line, always available. */
  line(event, ctx = {}) {
    return offlineLine(event, ctx.roomType, this.rng, ctx);
  }

  /**
   * Non-blocking narration: returns the offline line immediately for display.
   * If a key is set, an AI line is fetched in the background and delivered via
   * `onAi(line)` to replace it. Any failure falls back silently (no callback).
   */
  narrate(event, ctx = {}, onAi) {
    const offline = this.line(event, ctx);
    if (!this.apiKey || typeof fetch === 'undefined' || typeof onAi !== 'function') return offline;
    if (this.inFlight) {
      this.pending = { event, ctx, onAi }; // latest event wins
      return offline;
    }
    this.inFlight = this.fetchAiLine(event, ctx)
      .then((aiLine) => {
        this.inFlight = null;
        if (aiLine) onAi(aiLine);
        if (this.pending) {
          const p = this.pending;
          this.pending = null;
          this.narrate(p.event, p.ctx, p.onAi);
        }
      })
      .catch(() => { this.inFlight = null; });
    return offline;
  }

  async fetchAiLine(event, ctx) {
    const userLine = this.line(event, ctx);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), NARRATION_TIMEOUT_MS);
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Event: ${event}. The player is in a ${ctx.roomType || 'dark room'} of a haunted manor. `
                + `They have ${ctx.relics ?? 0} of 3 relics, sanity ${ctx.sanity ?? 100}, oil ${ctx.oil ?? 100}. `
                + `Offline draft (rewrite in your own words, keep it gothic): "${userLine}"`,
            },
          ],
          max_tokens: 80,
          temperature: 0.9,
        }),
        signal: controller?.signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (!text) return null;
      return text.replace(/^["“]|["”]$/g, '').slice(0, 300);
    } catch {
      return null; // timeout / network error / abort — silent fallback
    } finally {
      clearTimeout(timer);
    }
  }
}
