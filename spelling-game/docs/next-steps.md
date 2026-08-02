# Spelling game — next steps

Written 2026-08-02, after the first real play sessions on branch
`spelling-game`.

Each item says what it is, **why we think so**, and where to start. Items backed
by real play or by a measurement are marked — they are worth more than the ones
that came from reasoning, because on this project reasoning is what produced the
bugs and playing is what found them.

---

## 1. Eight homophone sets are unanswerable — **measured, live now**

**The bug.** The game plays a sound and asks for a spelling. For a homophone
that is not a question. The kid can be completely right and be marked wrong.

Already in the shipped list, both words playable today:

```
to / too / two      see / sea       hear / here     their / there
know / no           right / write   for / four      read / red
```

Eight live sets. `our / are` is dormant only because `are` has no audio.

**Nothing is broken in the code.** The engine compares typed letters to the
target and does so correctly. The PROMPT is insufficient: audio alone cannot say
which homophone is wanted. No amount of better audio fixes it — a perfect
recording of /siː/ still does not distinguish `see` from `sea`.

**Three ways out, all raised by Oliver, in increasing cost:**

1. **Flash the word once while it is said.** Cheapest by far, and it needs no new
   content — the word already exists on screen in learn mode. Show it for a beat
   at the start of the problem, then hide it and let her spell. Turns drill into
   something between recall and copying, which is a real cost; possibly right as
   a *homophone-only* behaviour rather than a global one.
2. **A sentence.** "I swam in the **sea**." Unambiguous, and it is what a
   classroom spelling test actually does. Cost is content: a sentence per
   homophone, hand-written, plus audio for it — and the audio problem gets worse,
   because now a whole sentence has to be spoken.
3. **A graphic.** Strongest for a young kid and needs no reading at all, which
   matters when the whole point is that she cannot yet spell. Cost is an image
   per word and a licensing question the rest of this project has carefully
   avoided.

**Worth noticing:** 1 is a change to the word screen, 2 and 3 are changes to the
CONTENT MODEL — a word gains a sentence or a picture, so `spine.js` entries stop
being `{word, rank, dolch}`. That is the decision to make first, because it also
governs whether homophones can ever be added deliberately rather than tolerated
accidentally.

**Interim option, cheap:** drop one of each colliding pair from the spine until
this is solved. It costs eight words and removes eight guaranteed-unfair
problems. Not obviously right — `their/there` is exactly the pair a kid most
needs — but it is honest, whereas shipping them today is not.

---

## 2. Twenty-eight words have no audio — **measured**

`sat ran had got fed is was are words were said these has been did made came
does went men thought saw those children feet began took later`

Merriam-Webster files inflections under the base headword, so these return an
entry with no pronunciation of its own. Verified against BOTH references;
Intermediate rescued only `the`, `have` and `found`.

Currently handled by trimming: `GET /api/audio` lists what is on disk and the
game never serves anything else, so nothing is unanswerable — the words simply
do not appear. Full reasoning in `docs/audio-sourcing.md`.

That is a holding position, not a fix. They are high-frequency words a
seven-year-old needs.

---

## 3. Morphology is the next content, and TTS gates it — **measured**

**The gap.** Every pattern tag in the game today is a rime, a digraph, a blend,
or `irregular`. **There is not one suffix.** `-ing` matches only `thing`,
`something`, `being`; `-ed` only `need`; `-est` nothing at all.

So the game teaches spelling by ANALOGY (rime families) and by MEMORISATION (the
`irregular` bucket), and never by RULE.

**Why suffixes are the right next step.** The list already holds **75 CVC roots**
— `hop mop top get let wet big dig pig`. Suffixing them yields roughly 225 words
built from roots the kid can already spell, and each one teaches a generative
rule rather than one more item:

| Rule | Example |
| --- | --- |
| doubling | `hop → hopping`, `stop → stopped` |
| drop-e | `hope → hoping`, `make → making` |
| y → i | `happy → happier`, `try → tried` |

`hopping` against `hoping` is a real discrimination. More Fry words would just be
more four-letter words — frequency is not difficulty, and "it is all easy" is the
actual complaint.

It should also shrink item 4.

**The blocker, checked rather than assumed.** Queried both references for
`hopping stopped running hopped cats wishes biggest happier`: **not one exists in
either**, and mostly as "no entry" rather than "no audio". So the neural-TTS
pipeline sketched in `docs/audio-sourcing.md` is a PREREQUISITE for this
expansion, not a quality upgrade alongside it.

Convenient ordering, at least: the TTS work fixes item 2 retroactively and
unlocks item 3.

---

## 4. `irregular` is 87 words and is not a family

28% of the playable list carries the tag, making it by far the largest group. A
learn session on `irregular` samples four words that share nothing but the
absence of a rule — `of`, `a`, `they`, `his` in one lesson.

It competes fairly for selection and the screen is honest about what it is
(spec §6, "this one you just have to remember"), so nothing is wrong. But
"learn the pattern" is not what happens.

**Where to start.** Split it. Dolch sight words are a different thing from
genuinely irregular spellings, and `dolch` is already on every spine entry (see
item 8). Possibly also by shape — `-ould` (`could would should`) is a real family
hiding inside the bucket.

---

## 5. One unexplained divergence — open

Real play produced four consecutive learn sessions on `in pin win tin`
(`s_c578 s_c447 s_3f31 s_1322`, 2026-08-02 14:48–14:57). The structural cause was
found and fixed — see the rotation commits — but **replaying that exact log
through the code does not reproduce it**. The replay says `-at` should have been
picked, and its window did not even contain `pin`, `win` or `tin`.

`deriveMastery` takes no clock, so a replay of the same prefix should be
deterministic. File order was verified chronological. The divergence means the
running game's model differed from the one a replay builds, and the reason is
unknown.

Possibly harmless. Possibly a second bug in how `sittingEvents` accumulates
across sessions without a page reload. Worth an hour with a fresh log and
deliberate reloads between sessions.

---

## 6. Unfinished from the build plan

- **No spelling card in `games-menu.html`.** Verified: zero matches for
  "spelling". The game is reachable only by typing the URL. This was Wave 4
  Task 4.1 and is the smallest high-value item on this list.
- **`tools/replay.js` is math-only.** It imports `../math-game/js/config.js`
  directly. The spelling game now has the harder scheduling questions and no way
  to test a config change against a real log. Wave 4 Task 4.2.
- **The drill results screen has never been seen.** Learn results have been
  rendered in front of a human; drill's has not.

---

## 7. Carried forward from the Gate B review

- **`fetch-words.js` re-fetches M-W-missing words forever.** A word absent from
  both references writes no file, so every subsequent run asks again. With 28
  such words that is 28 wasted calls per run against a 1000/day cap. Fix: write a
  negative-cache record rather than nothing.
- **`--limit` counts WORDS, not API calls.** A word can cost two calls now that
  the fallthrough is on missing audio (fixed 2026-08-02), so `--limit=500` can
  spend up to 1000. Rename or re-count.
- **`workFor` (the resume logic) has no test.** It decides whether a cached word
  needs a full fetch, audio only, or nothing — the whole resumability story — and
  nothing pins it.
- **Fry rank drift past ~150.** The published orderings disagree below the first
  150 or so, and `rank` is only used for ordering, so a drift is invisible.
- **`dolch` is written and never read.** Every spine entry carries it; nothing
  consumes it. Either use it (item 4 is the obvious consumer) or drop it.

---

## 8. Housekeeping

- **Branch `spelling-game` is not merged.** `master` is still at `56367e4`.
- **Shared CSS is now duplicated three ways.** `base.css`, `layout.css` and
  `results.css` exist in all three games. This was "overdue" at two copies. The
  theme tokens are the part that actually wants sharing.
- **`data/` is fully gitignored now** — logs, audio cache and word JSON. The
  spelling log is real play data and is the only record of the sessions cited
  above, so do not clear it; it is the before/after baseline for every scheduling
  change on this list.
- **Keys live in `.env`**, gitignored, with `.env.example` tracked as the
  template. They must be carried to the kid's machine by hand — that
  inconvenience is deliberate, because this repo has a public origin.

---

## What real play caught that reasoning did not

The pattern from the math game held exactly:

- `speak()` returned `'tts'` on the line after calling `speak()`, so the game
  reported success for audio Chrome never played. Every test passed.
- The server had no `.mp3` MIME type and served pronunciations as
  `application/octet-stream`. Chrome refused them. The play button did nothing.
- Learn mode taught one family forever, because `taught` is a boolean and a
  boolean can demote a family exactly once.
- Then twice more, after that was "fixed": a bounded-score tie handed the same
  family back on the very next click, and a family bigger than `learnWords` was
  scored on words its session would never teach.

None of these went red in the suite. All were found by playing, or by Oliver
asking a precise question about behaviour — "does it show the same lesson twice
in a row?" — and the answer being checked rather than assumed.
