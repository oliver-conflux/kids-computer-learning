# Where the spoken words come from

The game says each word out loud. In drill mode the sound **is** the question —
the screen is a row of empty boxes — so a word we cannot pronounce is not a
degraded word, it is an unanswerable one.

This is the record of what we tried, what it cost, and what is left.

## Today: Merriam-Webster, trimmed

`tools/fetch-words.js` caches a pronunciation per word into `data/audio/<word>.mp3`
from the Merriam-Webster Elementary dictionary (`sd2`), falling through to
Intermediate (`sd3`) when Elementary has no recording.

Coverage as of 2026-08-02: **310 of 338 spine words.**

The 28 without audio:

```
sat ran had got fed is was are words were said these has been did made
came does went men thought saw those children feet began took later
```

They are almost all irregular inflections. M-W puts the recording on the base
headword, so `sat` returns an entry that cross-references `sit` and carries no
pronunciation of its own. `selectEntry`'s headword guard refuses to file `sit`'s
audio under `sat`, and that guard is correct — playing "sit" to a child asked to
spell "sat" is worse than silence, and it fails *inaudibly*, because it still
sounds like a working game.

Checked directly against both references before concluding this: Intermediate has
audio for exactly three of the 31 originally missing (`the`, `have`, `found`,
now cached) and genuinely none for the other 28.

**The trim.** `GET /api/audio` lists the words with a file on disk; the game
intersects that with the spine at startup (`playableSpine` in `js/spine.js`) and
only ever serves the intersection. A live directory read rather than a manifest,
so dropping new mp3s in is all it takes.

Two cases deliberately fall open and return the spine **whole**: the lookup
failed, or nothing overlaps. Both exist so a lookup problem cannot present as an
empty game. A fresh clone with no cache is fully playable — every word spoken by
`speechSynthesis` — which is the spec's position and stays true.

The missing words remain in `spine.js` on purpose. They are not bad words; they
are words we cannot currently say. When audio arrives they come back with no code
change, and old log events naming them still resolve because `space.allItems` is
never trimmed.

## Why not speechSynthesis for the gap

It is already the fallback, and on this machine it does not work. Measured in
Chrome 2026-08-02, foregrounded, after a browser restart:

```
voices: 199 (180 local, 19 remote)
speechSynthesis.speak(u)  ->  speaking: true, pending: true, NO start/error event
```

The queue wedges and stays wedged. `cancel()`, `resume()` and an explicit voice
all made no difference. Nothing in our code causes it and nothing in our code can
reliably clear it — `js/audio.js` therefore reports `'silent'` rather than
claiming a success it never observed, and the game shows a warning after two
silent words in a row.

Two further reasons not to lean on it even when healthy:

- **The default voice was `Karen`, en-AU.** We never select a voice, so the
  browser picks. Australian vowels differ exactly where English spelling is
  hardest. For a game whose entire task is mapping a sound to letters, that is
  not cosmetic.
- **19 of the voices are remote.** Using one would mean network egress during
  play, which the design forbids.

## Option A: macOS `say`, offline

Available now, no new dependency. Verified working on this machine, with
`Samantha` (en_US) installed and both `ffmpeg` and `lame` on PATH:

```bash
say -v Samantha -r 145 -o word.aiff "said"
ffmpeg -loglevel error -y -i word.aiff -codec:a libmp3lame -qscale:a 4 \
       -ar 22050 -ac 1 data/audio/word.mp3
```

Output lands at roughly 4 KB, comparable to the M-W files, and `/api/audio` picks
it up on the next page load with no code change.

Trade-offs: clearly synthetic, macOS-only, and it commits the whole word list to
one voice's pronunciation choices. Good enough to close the gap; not obviously
better than leaving those 28 out.

**Not done.** The 28 missing words being missing is itself a signal — they are
inflected forms, and a list that leans on words the source treats as derived is
worth noticing rather than papering over.

## Option B: generate the whole dictionary with a neural TTS model

The direction worth taking. Instead of patching 28 gaps, generate **every** word
from one modern TTS model, and treat Merriam-Webster as the thing we compare
against rather than the thing we depend on.

What it buys:

- One voice across the entire list, chosen deliberately, instead of a blend of
  M-W's recordings and whatever fills the holes.
- No coverage gap at all, so `playableSpine` becomes a safety net rather than a
  load-bearing trim, and the spine can grow without an ingest that might not have
  the word.
- No API key, no per-day quota, no terms forbidding redistribution of the cache —
  though whether the generated files may be committed depends on the model's own
  licence, and `data/audio/` stays gitignored until that is checked.
- Control over rate and emphasis, which matters here: a pronunciation for
  spelling wants to be slower and cleaner than conversational speech.

Shape of the work, roughly in order:

1. Pick the model and check its licence for redistributing generated audio.
2. `tools/generate-words.js` — same output contract as `fetch-words.js`
   (`data/audio/<word>.mp3`, `isSafeWord` guard, resumable, skips what exists),
   so nothing downstream changes. `/api/audio` and the trim already work.
3. Listen to the confusable sets before trusting it: `pan`/`pen`, `sat`/`set`,
   `bad`/`bed`, `pin`/`pen`, and the 28 above. A model that blurs those is worse
   than no audio, and it fails silently.
4. Keep M-W as a spot-check: where both exist, they should be the same word.

Open question worth settling first: whether a synthesized voice is good enough
for the *phonemic discrimination* this game asks for. M-W's recordings are human
and unambiguous. That is the bar.
