# Spelling game — next steps

Written 2026-08-02, after the first real play sessions on branch
`spelling-game`.

Each item says what it is, **why we think so**, and where to start. Items backed
by real play or by a measurement are marked — they are worth more than the ones
that came from reasoning, because on this project reasoning is what produced the
bugs and playing is what found them.

---

## 1. Homophones — **closed; re-run the detector after any spine growth**

**The bug.** The game plays a sound and asks for a spelling. For a homophone
that is not a question. The kid can be completely right and be marked wrong.

**The fix.** Drill mode flashes the word once while saying it (commit
`fde89da`), which makes the question answerable without turning every word into
copying. It is gated on membership in `homophones.js`, so a set that is missing
is a word that silently gets no flash.

**The list was incomplete, and the cheap way to find the rest worked.** Whisper
round-tripping all 995 generated mp3s surfaced 43 words it spelled differently
from the target. 16 were already covered. These 17 were real, typable rival
words and were missing:

```
which / witch     been / bin        piece / peace     passed / past
week / weak       base / bass       meet / meat       whether / weather
sail / sale       hole / whole      wrote / rote      plains / planes
cents / sense     board / bored     tied / tide       weight / wait
led / lead
```

**All 17 are now in `homophones.js`, which holds 42 sets.** That took the number
of spine words that flash from 40 to 64 — 24 words that a kid could previously
have heard correctly, spelled correctly, and been marked wrong on.

**This item is not finished so much as current.** The detector is the durable
part: re-run `speech-transcribe --expect` after any spine growth, because every
word added is a word whose rival spelling has never been checked.

**Deliberately excluded from that list**, and the reasons are the criteria to
apply next time:

- **Proper nouns** — `mat/Matt`, `carry/Carrie`, `check/Czech`, `main/Maine`.
  Not words she would write here.
- **Letter names** — `are/r`, `why/y`, `eye/i`, `oh/o`. Typable, but not words,
  and the existing rule is that the rival spelling must be a real typable word.
- **`except/accept`** — commonly confused, not actually homophones. A different
  problem with a different fix.

**Why this is worth doing rather than leaving.** The `than`/`then` bug found
during the TTS work was this exact failure with the flash *not* firing: the audio
was wrong, so she would have been marked wrong for hearing correctly. For a true
homophone the audio is *right* and she is still marked wrong — which is worse,
because nothing is broken and nothing would ever show up in a log as a defect.

**Nothing is broken in the code**, and that is the point. The engine compares
typed letters to the target and does so correctly. The PROMPT is insufficient:
audio alone cannot say which homophone is wanted, and no amount of better audio
fixes it — a perfect recording of /siː/ still does not distinguish `see` from
`sea`. Generating our own audio did not help here and never could have.

**The three ways out, in increasing cost. The first one shipped:**

1. ~~**Flash the word once while it is said.**~~ **Done.** Homophone-only rather
   than global, so ordinary drill words stay recall rather than copying. That
   scoping was the right call and should hold as the list grows.
2. **A sentence.** "I swam in the **sea**." Unambiguous, and what a classroom
   spelling test actually does. **Cheaper than it was** — the audio objection
   ("a whole sentence has to be spoken") is gone now that we generate our own,
   and `say.py` takes arbitrary text, not just words. What remains is the
   content cost: a hand-written sentence per homophone.
3. **A graphic.** Strongest for a young kid and needs no reading at all, which
   matters when the whole point is that she cannot yet spell. Cost is an image
   per word plus a licensing question the rest of this project has avoided.

**Worth noticing:** 1 was a change to the word screen; 2 and 3 change the CONTENT
MODEL — a word gains a sentence or a picture, so `spine.js` entries stop being
`{word, rank, dolch}`. That is still the decision to make before any deliberate
homophone teaching, as opposed to the tolerating we do now.

The old interim suggestion — drop one of each colliding pair from the spine — is
**withdrawn**. The flash makes those words answerable, and `their`/`there` is
exactly the pair a kid most needs.

---

## 2. ~~Twenty-eight words have no audio~~ — **DONE 2026-08-02**

Solved by leaving Merriam-Webster and generating every word ourselves with
Kokoro-82M (commit `2da52f3`). Coverage went from 594 of 995 playable to **995
of 995**, and the words recovered are exactly the ones this item was about:
`is was said had has did got were been`.

`playableSpine` still exists and now trims nothing — it is the guard against a
partial cache rather than a load-bearing filter. Full account, including the
three audits and the `than` → "then" bug that only the phoneme check caught, is
in `docs/audio-sourcing.md`.

---

## 3. Morphology is the next content — **measured; no longer blocked**

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

**The blocker is gone as of 2026-08-02.** It used to be that M-W had no entry at
all for `hopping stopped running hopped cats wishes biggest happier` — checked,
not assumed — which made a TTS pipeline a PREREQUISITE for this expansion rather
than a quality upgrade alongside it.

We now generate our own audio, so **any word we can spell we can say**. This item
is no longer gated on anything external; it is purely a content decision about
which suffixed forms to add and in what order.

One caution carried over from the TTS work: new words must go through
`tools/gen-audio.js` and pass its audits before they are playable, and a suffixed
form is exactly where a mispronunciation would hide — `hopping` and `hoping`
differ by one phoneme, and the whole point of adding them is that discrimination.
Listen to those pairs specifically rather than trusting the audit alone.

---

## 4. `irregular` is 232 words and is not a family

23% of the list carries the tag, making it by far the largest group. A
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

## 5. A kid who already knows the words is stuck proving it — **observed, not diagnosed**

**The complaint, from playing it.** It does not reach ahead. A speller who is
getting the early words right stays on the early words far longer than feels
right.

**Not yet diagnosed, deliberately.** What follows is the mechanism as written and
a set of candidate fixes, recorded while it was fresh. Do the measurement before
building any of it.

**One hypothesis ruled out already.** It is tempting to think there is a
first-playthrough placement round that a kid who had already played would have
missed. There isn't. The code says so twice, on purpose — `core/frontier.js`:
*"no placement test — the log is the placement test"*, and `ui/results.js`:
*"There is no stored level in this game and no placement test."* Nothing was
missed. The fast path was never built.

**The arithmetic that probably explains the feel.** The frontier exposes
`windowSize: 20` not-yet-hot words. A word goes hot at three clean attempts with
a median under `hotMs`. So clearing a window costs a minimum of **60 correct
answers**, and new words only trickle in as individual words graduate. For a kid
who genuinely knows all twenty, that is sixty keystroke-heavy repetitions to earn
ground she already held. The window is a filter rather than a slice, so it does
advance — just at three-reps-per-word, always, no matter how obvious the word is.

**The shape of the fix: make the cost of proof proportional to the doubt.**
Three candidates, roughly increasing in ambition.

**(a) Asymmetric first attempt.** If a word is answered clean the very first time
it is ever seen, count it learned then — one rep, not three. Miss it first time
and it reverts to the full three. The first attempt is the most informative one
in the whole system: it is the only attempt with no practice effect behind it.
This is the cheapest of the three and probably the highest value per line.

**(b) Confidence at the band, not the word.** Fry's bands of 100 are the unit the
list is actually organised around. If ~90% of band 1 is coming back clean, stop
demanding full proof on the rest of band 1 — the evidence is no longer about the
individual word. Note this needs a floor: "she is good at this band" must not
silently skip the one word in it she cannot spell.

**(c) Bleed the next band in.** Rather than advancing a window, mix band 2 words
into a band-1 session as band 1 goes well, then band 3 as band 2 does. The
frontier already blends cold and hot words by weight, so the machinery for
mixing exists; what is new is making band membership a term in the weighting.
This is the most appealing of the three and the largest change.

**Where it touches the existing design.** Any of these adjusts what counts as
mastered, which is `core/mastery.js`'s bucket rule and is shared with the math
and geography games. It should be a config-level or space-adapter change, not a
special case inside `mastery.js` — that module's whole point is not knowing what
kind of item it holds. `hotMs: 4000` is also still the original guess and is
itself a candidate cause: a threshold set too tight keeps a fluent speller
permanently warm and stalls the window on words she owns. `tools/replay.js` can
retune it against real history before anything is built.

**This is the same complaint as §3, from the other end.** That item records "more
Fry words would just be more four-letter words — frequency is not difficulty, and
'it is all easy' is the actual complaint." Morphology answers it by making the
content harder. This item answers it by getting through the easy content faster.
They are worth designing together, because doing only one of them leaves the
other half of the problem standing.

---

## 6. One unexplained divergence — open

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

## 7. Unfinished from the build plan

- ~~**No spelling card in `games-menu.html`.**~~ **DONE** in commit `a88be4b`,
  which added two — "Learn Spelling" and "Drill Spelling", pointing at
  `?mode=learn` and `?mode=drill`. The "verified: zero matches" above was true
  the day it was written and stale within days, which is the hazard of pinning a
  claim to a grep in a document nobody re-runs.
- **`tools/replay.js` is math-only.** It imports `../math-game/js/config.js`
  directly. The spelling game now has the harder scheduling questions and no way
  to test a config change against a real log. Wave 4 Task 4.2.
- **The drill results screen has never been seen.** Learn results have been
  rendered in front of a human; drill's has not.

---

## 8. Carried forward from the Gate B review

The first three concern `fetch-words.js`, which **no longer runs** — the game
left Merriam-Webster on 2026-08-02 (item 2). The file is kept as the record of
that path. Fix these only if it is ever revived; none of them can affect play.

- **`fetch-words.js` re-fetches M-W-missing words forever.** A word absent from
  both references writes no file, so every subsequent run asks again. With 37
  such words that is 37 wasted calls per run against a 1000/day cap. Fix: write a
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

## 9. Housekeeping

- ~~**Branch `spelling-game` is not merged.**~~ Merged since. `master` is well
  past `56367e4` — as of 2026-08-03 it carries the probe-and-release work. The
  local `spelling-game` branch still exists and can go.
- **Shared CSS is now duplicated three ways.** `base.css`, `layout.css` and
  `results.css` exist in all three games. This was "overdue" at two copies. The
  theme tokens are the part that actually wants sharing.
- **`data/` is fully gitignored now** — logs, audio cache and word JSON.

  **CORRECTION, 2026-08-03: the spelling log is NOT the kid's play data.** All
  543 events are Oliver testing the game, and the 209 in the typing log likewise.
  This matters more than it sounds. An adult types at roughly 250ms a keystroke
  and a seven-year-old hunt-and-pecks at 500–800, so every latency figure the log
  yields describes the wrong hands. Measuring `hotMs` against it produced a
  confident, entirely wrong conclusion — that 4000ms was non-binding, because 0
  of 314 clean attempts exceeded it — which is exactly backwards for the kid it
  is set for.

  So it is a fine fixture for shape, ordering and crash-safety, and worthless for
  anything timing-shaped. Treat the first real session from the kid as the start
  of the baseline, not this.
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
