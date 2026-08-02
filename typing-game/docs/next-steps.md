# Typing game — next steps

Written 2026-08-02, after the redesign landed on `master`.

Same format as `math-game/docs/next-steps.md`: what it is, **why we think so**,
and where to start. Items backed by real play are marked — but note that almost
nothing here is, yet. The game has been played through by agents and once by a
human, and every defect below came from reading the code rather than from
watching a kid use it. Treat the whole list as provisional until the kids have
had a few sittings.

---

## 1. There is no way to change any setting after the first run

**The gap.** `settings.js` stores six things. Exactly two can ever be changed
from inside the game, and one of those only in one direction:

| Setting | Changeable in game? |
|---|---|
| `guidance` | **Down only** — via the step-down offer after a 3-star round |
| `name` | Once, at first run |
| `lastLesson` | Written automatically — **and read by nothing** |
| `blockOnError` | **Never** |
| `accent`, `skin` | **Never — and nothing reads them at all** |

**Why it matters.** Three separate promises in the spec are unkept by this:

- §1 says the guidance level is "always manually overridable in both directions,
  so a struggling kid can be put back to Full without ceremony." A kid who steps
  down to level 1 and finds it too hard has no way back up — the only route is
  editing localStorage in devtools. This is the worst of the three, because the
  whole guidance design is framed as a reward the kid controls, and it currently
  only ratchets one way.
- §6 says block mode "is the default; flip a kid to pass-through when they're
  ready." There is no flip.
- §5 asks for the name once. A kid who skips it, or typos it, is stuck — and the
  name is load-bearing for the My Name drill, which is the whole motivation for
  learning shift.

**Where to start.** One settings panel reachable from the menu, covering
guidance (0–3, both directions), block vs pass-through, and the name. The menu
already exists (`screens.js`, `showMenu`) and is the natural home — a gear on
the menu rather than anything reachable mid-round. Guidance already has a
working write path in `main.js` (`onStepDown`); it needs an up as well as a
down, and a home that is not the results screen.

**While you are there — three fields are written and never read.**

`accent` and `skin` are dead schema: `base.css` hardcodes `--accent: #7b6bd6`
and `--skin: #e8b7ac`, and nothing consults the stored values. Either wire them
to the CSS custom properties — the design file documents four alternates of
each, and letting a kid pick their own hand colour is a cheap bit of ownership —
or delete them. A setting that silently does nothing is the worse option.

`lastLesson` is different: it *was* read. The original `boot()` resumed
`settings.lastLesson ?? 'home-base'`, but the menu replaced that flow and the
write outlived the read. So either restore the behaviour (a "carry on where you
left off" default on the menu is genuinely nice for a kid who plays daily) or
drop the field. This is a small instance of a general risk in staged builds:
task N+1 replaces task N's entry point, and the now-orphaned bookkeeping keeps
running because nothing fails when it does.

---

## 2. The log is write-mostly — the loop is open

**The gap, stated plainly.** This game took the math game's storage model but
not its feedback loop. It writes a rich log and reads almost none of it back.

| | Math game | Typing game |
|---|---|---|
| Modules that read the log | `mastery.js`, `scheduler.js`, `main.js` | `progress.js` only |
| What reading it produces | mastery buckets, confusion pairs, the next problem | stars, best accuracy, best wpm |
| History influences what is served next | **yes** | **no** |
| Replay tool for config changes | `tools/replay.js` | none |

Item selection is `itemsFor(lessonId, Math.random)` — a uniform sample from the
lesson's pool. **History is not an input at all.** A kid who has missed `q`
eleven times gets exactly as much `q` as a kid who has never missed it.

And every `item` event carries a `misses` array — what the kid meant, what they
hit, and where:

```json
"misses": [ {"expected":"d","actual":"x","pos":2},
            {"expected":"k","actual":"q","pos":6} ]
```

**Nothing reads it.** It is written on every item and consumed by no code path.

**Why this matters more than it looks.** The math game's entire thesis is that
the facts a kid lacks are a *small set*, worth finding and targeting — that is
what mastery derivation and the scheduler exist for. Typing has exactly the same
shape: the keys a kid cannot hit are a small set, and we are already recording
precisely which ones. We built the observation half and stopped.

**The honest counter-argument.** The typing curriculum is deliberately
*sequential* — rungs run in a fixed, defensible order, so there is no
equivalent of the scheduler choosing among 121 facts. That is a real difference
and it is why this was not built. But it only argues against adaptive
*ordering of rungs*. It says nothing about the two places history obviously
belongs:

- **Item sampling within a rung.** Weight the pool toward items containing keys
  this kid has missed. `itemsFor` already takes an injected rng, so the seam is
  there — it would take a weights argument rather than a new architecture.
- **Practice mode**, which is entirely unconstrained and currently entirely
  random. It is the natural home for targeted review, and it is already ungated.

**Where to start, cheapest first.**

1. **A per-key error rate in `progress.js`.** Pure, easily tested, and it is the
   input every other idea here needs. Fold `misses` across item events into a
   per-character rate. The interesting output is not "which keys are bad" but
   **which confusions are systematic**: `d`→`x` repeatedly is a finger-assignment
   problem, `d`→`f` is a neighbour slip, and those want different fixes. That is
   the argument for having logged `actual` and not just `expected`.
2. **Weight item sampling by it.** Smallest change with real effect on practice.
3. **A "practise these" prompt**, or a parent-facing heatmap. Do not show a kid
   a keyboard covered in red.
4. **A replay tool**, mirroring `tools/replay.js`. The math notes point out that
   theirs "has not yet been used in anger" — worth seeing whether it earns its
   keep there before duplicating it here.

Spec §14 deferred the heatmap because it "needs real usage data before it's
worth building." That data is now being collected from the first session, so the
question has changed from *whether* to *when*.

**First real signal — from one adult session, so treat it as a shape not a
finding.** 16 rounds, 97 misses. The most-missed expected characters were:

```
space x14    o x12    i x11    s x7    O x7    A x7    l x5    p x5
```

Space leading is the interesting one, and it is not what the curriculum is
built to expect: every rung teaches letters, and space is introduced once, in
passing, on rung 0 as a thumb key. If that pattern holds up with the kids —
words being run together rather than individual letters being missed — it
argues for space drills, which currently do not exist as a category. It is also
exactly the kind of thing nobody would have thought to look for, which is the
argument for item 2 above.

**Worth knowing:** the `misses` data very nearly did not exist. It was
originally derived by the caller as `entries.filter(e => !e.ok)`, but in block
mode — the default — a wrong press appends no entry at all, so it was silently
`[]` for every kid. Caught only by playing a round and reading the log. Had any
of the above been built six months from now, it would have been built against
nothing.

---

## 3. Content is thin at the bottom of the letter ladder

**The constraint.** `home-base` has twelve words because `asdfjkl;` yields about
twelve real English words. `home-stretch` has fourteen. Both have zero
sentences, because you cannot write one. Everything from `top-ei` onward has 20
words and 10 sentences.

This is not a gap to be padded — inventing non-words to hit a number would make
the first thing a kid ever types be nonsense. But it does mean the first two
rungs are drill-heavy in a way the later ones are not, and drills are the least
rewarding item type.

**Watch for:** whether a kid stalls on rung 0 or 1 out of boredom rather than
difficulty. If so, the fix is probably to shorten those rungs (fewer items per
round) rather than to add content that does not exist.

---

## 4. Open questions needing a human, not a fix

- **The cheers and prompts.** Carried straight from the spec's §14 and still
  unexamined: "Howdy Petra!", "Nice! Try the other shift next time." Whether
  they land or grate is not something a test answers.
- **Do the guidance levels strip away at the right pace?** The step-down is
  offered after any 3-star round. That may come too fast — three stars is 95%
  accuracy on ten items, which a kid can hit on a lucky round without being
  ready to lose the hands.
- **Is the drill/word/sentence mix right per rung?** The numbers in
  `curriculum.js` were reasoned, not observed.
- **The `startup-notice` copy**, shown when the server is not running. Written
  for a kid to read; may not sound like you.
- **Should practice sentences be tagged by theme** (animals, space, jokes) on
  top of difficulty tiers? Spec §14 deferred this pending evidence of
  monotony. Still no evidence either way.
- **One progress screen for both tracks, or separate ladder views?** Currently
  one menu listing both. Depends on how the kids actually navigate.

---

## 5. Deferred by design

- **Numbers row symbols** — `~ @ # $ % ^ &` and the bracket cluster remain out
  of scope. `!` is taught (it is shift-1, on `num-10`), which makes the boundary
  less obvious than it was; revisit if punctuation starts feeling arbitrary.
- **Multi-kid profiles.** One kid per machine, same as the math game. The name
  prompt has no profile picker deliberately.
- **Timed tests.** Never. WPM is shown only on the results screen and gates
  nothing, and that should stay true — a kid pushed on speed invents
  hunt-and-peck and keeps it for thirty years.
- **A shared theme file across both games.** The palette is duplicated between
  `typing-game/css/base.css` and the math game's styles. Worth unifying only if
  a third game appears.

---

## 6. Housekeeping

- **`data/typing-log.jsonl` is gitignored**, unlike the math log which is
  committed. It records the kid's name alongside their keystroke errors, and
  this repo has an `origin`. Flip it only if that remote is private and you want
  the history versioned — the reasoning is in `.gitignore` beside the entry.
- **Being gitignored, the log does not travel between worktrees**, and this bit
  us immediately: the first real play session (2026-08-02, 16 rounds across 13
  lessons) was played from the `typing-game-redesign` worktree and lives only
  there. The main checkout's log starts empty. If that worktree is removed, the
  session goes with it. This is the practical cost of not committing the log,
  and it is worth knowing before assuming a baseline exists.
- **The math log is committed and holds three sessions as a deliberate
  before/after baseline.** The typing log has no equivalent and, being ignored,
  never will accumulate one across machines. If before/after comparison across a
  `build` bump turns out to matter here the way it does for math, that decision
  needs revisiting — perhaps committing an anonymised log with the name field
  stripped.
- **The game requires the server.** It cannot run from `file://` — ES modules
  are blocked at that origin, and progress lives behind `/api/log`. Both
  `typing-game/index.html` and `games-menu.html` carry a classic inline script
  that catches this and says so. The `file://` guard is **verified by inspection
  only**; browser automation refuses `file://` URLs, so nobody has watched it
  fire. Double-click the HTML once to confirm.
- **`typing-game/design/`** holds the Claude Design mockup and its README. Kept
  as the source of truth for the palette, key geometry, and the hand paths —
  `keymap.js` and `hands.js` are transcriptions of it and were verified
  byte-identical. Do not delete without moving those values somewhere.
- **`build` is `t1`** on every event. Bump it when the curriculum, mixes, or
  star thresholds change, so before/after comparison is a filter rather than a
  guess.

---

## What this build taught about process

The math game's notes end with the same section, and the lesson here is a
variation on it rather than a repeat.

**Four real defects were found, and none by the test suite.** All four were
found by an agent refusing to paper over something and escalating instead:

- the `Shift` sentinel never expanded to capitals, so the validator rejected
  every capital on the one rung whose entire purpose is capitals
- the wrong-key flash was added and removed within the same task and never
  painted — proved with a MutationObserver
- guidance was applied per lesson rather than per item, so a new-key drill lit
  keys on an invisible keyboard
- `onAgain` crashed on practice rounds, and Again is the only button a practice
  round offers

Three of those were bugs in the **plan**, not in anyone's implementation — they
were faithfully implemented and still wrong. A plan is not a spec; it can be
confidently, specifically incorrect, and an agent following it exactly will
reproduce the error with high fidelity.

**The two habits that caught them:**

1. **Agents given permission to escalate rather than comply.** The one that
   found the `Shift` bug could have stripped the capitals from its own content
   to make its task pass, and its task would have looked complete. It said "this
   is a bug in a file I don't own" and stopped. That rung would have shipped
   gutted.
2. **Making agents actually play the thing.** Every DOM-layer bug was invisible
   to 96 passing tests. The instruction that worked was naming the specific
   things to confirm and adding that an honest "not verified" was more useful
   than an assumed pass — one agent then volunteered that its log check had not
   been tight enough to catch the `misses` bug, which was true and useful.

**And one thing that went wrong twice:** an agent finished, went idle, and never
reported — its findings sat in plain text that never reached the lead. Both
times the work was fine and the report was lost. If a subagent's output matters,
say explicitly how to send it.
