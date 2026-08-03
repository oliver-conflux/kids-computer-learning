# Development Journey

I built these games for my own kids, almost entirely through AI-assisted
development using Claude Code.

The original was two commits on a single day in November 2025 — essentially the
result of typing "make a kids typing game." My kids played that version for the
next eight months. What's here now is what happened when I came back to it at the
end of July 2026 and rebuilt it properly: about 163 commits in a week. This is an
account of how that went and what I learned.

**The most interesting engineering is the spelling game's audio pipeline**, and
the strangest thing about it is that most of that work was done autonomously by
Claude — which cannot hear anything — by editing pronunciations. It wasn't
unsupervised. I had to point at specific words that sounded wrong. But from there
Claude worked out the fix, and then worked out how to *test* the fix, and it went
from a handful of words that weren't quite right to nearly a thousand that are all
close to perfect. That was a genuinely strange experience to watch.

The reason it's possible is worth naming, because I think it generalises: the
pipeline never treats audio as audio. Every check runs against the phoneme string
the model reports having rendered — which is text, and comparable to other text. A
deaf collaborator can debug pronunciation if you hand it a representation it can
actually read. Finding that representation is most of the trick.

**The other interesting part is the agentic tooling**, and specifically the early
research. Getting the "whys" and the pedagogy loaded into context *before* any
code got designed is the biggest single difference between this and the earlier
prototype.

Two more things I'd flag before you read on, because both surprised me:

- **Almost none of the real defects were bad code.** The agents implemented what
  they were told, faithfully. It was the *plans* that were wrong — confidently,
  specifically wrong, in ways an agent will reproduce with high fidelity.
- **There are 807 passing tests and they caught almost none of the bugs that
  mattered.** Every interesting failure was found by an agent explaining its
  reasoning, a reviewer running mutations, or a kid playing the game. That doesn't mean that the tests are worthless though. You can't easily count how many regressions there *would* have been without the tests. 

---

## Where this started

The first thing in this repo was a very simple typing game, and it was the result
of a few prompts amounting to "make a kids typing game." It worked. My kids played
it for a few months. But it wasn't structured, and it looked like every free
typing game online: a few random easy words, no idea what it was teaching or in
what order.

The version that's here now came from doing it backwards — researching how typing
is actually supposed to be taught, and *then* building the game around that. Claude
did the research; I asked the questions, and then we asked each other a lot of
questions. Some of that ran through the `superpowers:brainstorming` skill.

That research turned out to be the most valuable time I spent on the whole
project. It's also the part that's easiest to skip, because it doesn't produce
anything you can run. We looked at a variety of word lists and tested them. Fry's
top 1,000 came out on top, partly because it's organized in bands of 100 that
loosely correlate with difficulty — which meant the ordering could carry real
information instead of being an arbitrary sequence.

The same thing applied to small design details that turned out not to be small:
when a word should flash on screen, how the word should be progressively revealed,
how fast that reveal should go. Having the full design conversation up front is
what made the original specs any good — and then having the design conversation
again at every iteration, until I was actually happy with it.

Going in with an open mind and starting by asking questions, rather than by asking
for code, is the single biggest difference between the first typing game and this
one.

---

## The method

The workflow was **brainstorm → spec → plan → agent team**, and each game got its
own spec and plan pair under `<game>/docs/superpowers/`.

The division of labour between the two is strict. Every plan opens by refusing to
repeat its spec:

> **Read the spec first.** It holds the record shapes, the rules, and the
> reasoning. This plan does not repeat them.

The specs are substantial — 350 to 730 lines. The plans vary wildly, and *how*
they vary turned out to be the lesson. The typing game's plan is 3,593 lines and
stuffed with prewritten test code. The activity timer's, written a week later, is
417 lines with almost no code in it at all. The short one produced a working
feature in twenty-five minutes of agent wall-clock.

By the time I got to the spelling game, the position had settled:

> **On code samples:** this plan deliberately contains almost none. Implementers
> are capable engineers who do not need to be taught to write JavaScript. What
> they cannot infer is **interfaces** and **house conventions**.
>
> **On discovering patterns:** the single biggest risk in a multi-agent build is
> three agents inventing three different idioms for the same thing in three files.

So plans stopped carrying implementations and started carrying *contracts*. The
timer's plan freezes nineteen DOM ids and says "treat these ids as frozen" — which
is exactly what let one agent write the markup while another wrote the wiring,
neither of them ever seeing the other's code.

For orchestration I went back to a pattern I liked better than the one superpowers
imposes: work organised in **waves**, not tasks.

> Tasks inside a wave may run in parallel across a team. **Review happens at wave
> boundaries, not per task.**
>
> **Escalate rather than comply.** If a task as written is wrong, stop and report.
> Do not make your own task pass by damaging someone else's.

Claude's agent teams feature supports working this way; the superpowers model
largely overrode it, which is why I ended up replacing that piece. That last
instruction — escalate rather than comply — earned its keep, and I'll come back to
it.

---

## What I actually think of superpowers

Part of this whole exercise, for me as the vibe coder, was testing out superpowers.
I was somewhat impressed with it. What I disliked was its agent orchestration — I
preferred Claude's built-in agent teams to the way superpowers was orchestrating,
which is platform-independent by design and meant to work across Codex, Claude,
Gemini, whatever. That generality costs something. 

Most of what I'd tried before was Beads, or my own modifications of it, and I
wanted to build this repo on a different plugin stack specifically to compare. The
useful finding is that they solve *different* problems rather than the same one
differently.

Beads is strong for longer-duration projects with complex documentation, and good
at agent orchestration. Superpowers enforces the two-layer spec-and-plan document
scheme, which I ended up liking with some modifications. What I didn't like was
its orchestration, which I overrode after only a couple of runs. On my next
project I want to combine the two — Beads' orchestration under superpowers'
document discipline.

The two changes I made to the vanilla superpowers prompts both amount to *doing
less*.

**Review less.** Superpowers wants an adversarial review after every task. I opted
for a review after every wave instead — except for critical waves that established
contracts which would be expensive to undo later. Those still got reviewed
individually.

**Test less.** Superpowers pushed for more tests than I cared for. I went with
little to no frontend testing. A lot of the tests weren't that useful, and the
more of them there were, the more expensive it got to change anything. Now that
things are more stable I might go back and write regression tests. If I ever ship
this as a hosted SaaS product it should certainly have a much bigger regression
suite. But as a spike-level fun game for kids that I want to keep messing with,
keeping the testing burden light was more token-efficient and more time-efficient.

Based purely on vibes — and I can't prove this easily — the overall error rate was
very low. The games that didn't work quite right were mostly cases where the
*design* hadn't been worked out. There was very little rework caused by bad code —
especially once the orchestration was right, with contracts established early and
specified explicitly enough that different agents weren't each reinventing the
same wheel.

The reviews caught surprisingly little. But I'd still keep them, because what they
did catch was consistently worth having. Low hit rate, high value per hit, which
is a different thing from being a waste of time.

### The one place I have numbers

A separate project of mine ran an actual A/B comparison of two ways to drive
agents, and it's what pushed this project toward waves. Run A was serial
spec-driven development — one implementing agent per task, one reviewing agent
after each. Run B was batched worktrees with a single review at the end.

|                        | A: serial | B: batched |
| ---------------------- | --------- | ---------- |
| Agents spawned         | 29        | **10**     |
| Orchestrator turns     | 847       | **192**    |
| Cost per 100 net lines | $10.89    | **$4.00**  |
| Rework commits         | 55%       | **11%**    |
| Test : source ratio    | **2.09**  | 0.47       |

**The headline isn't the one you'd guess.** It wasn't parallelism:

> **What actually caused the win. Not parallelism.** The worktrees bought
> wall-clock concurrency (peak 3), but wall-clock throughput barely moved: 529 vs
> 469 lines/hour.
>
> **Call count.** The mechanism is the per-task review loop: every review report
> and every agent message came back into the orchestrator's context and stayed
> there, so Run A's context grew 293k → 628k.

The expensive thing wasn't doing the work. It was *reporting on* the work, over
and over, into a context that never forgets.

Two caveats I want to keep attached to those numbers. That benchmark measured a
different codebase, and it says so itself — three variables changed at once and
"this data cannot separate them." And **escaped defects were never measured**,
which the benchmark's own text calls "the number that decides whether B's saving
was real or borrowed." The one metric that moved *against* the cheaper method was
test density, which no gate was watching. Given that I then deliberately cut
testing further, that's a fair thing to hold against me.

It's also worth saying what B gave up. Run A's 55% rework figure looks bad until
you read what it was: several of those were the orchestrator fixing its own *plan*
after an agent pushed back and said "you're right and I was wrong." That's not
waste. That's the quality mechanism working, and it's the thing the cheaper method
buys less of.

---

## The finding that kept repeating

Across five games and roughly forty documented defects, one pattern didn't vary:

**Almost none of the memorable failures were "the agent wrote bad code."**

The agents implemented faithfully. The *specifications* were wrong. From the
typing game's post-build notes:

> **Four real defects were found, and none by the test suite.**
>
> - the `Shift` sentinel never expanded to capitals, so the validator rejected
>   every capital on the one rung whose entire purpose is capitals
> - the wrong-key flash was added and removed within the same task and never
>   painted
> - guidance was applied per lesson rather than per item, so a new-key drill lit
>   keys on an invisible keyboard
> - `onAgain` crashed on practice rounds, and Again is the only button a practice
>   round offers
>
> **Three of those were bugs in the plan, not in anyone's implementation** — they
> were faithfully implemented and still wrong. **A plan is not a spec; it can be
> confidently, specifically incorrect, and an agent following it exactly will
> reproduce the error with high fidelity.**

More of the same, each its own commit:

- A plan asked a verifier to stop the server and confirm the app refuses to start.
  **That outcome cannot exist** — the server that would serve the page is the one
  that's down, so the browser shows `ERR_CONNECTION_REFUSED` and none of the app's
  code ever runs.
- Every task's definition-of-done cited `node --test <dir>`, which fails on Node 22
  because positional args are globs. An agent hitting that on task one "sees 0
  passing and 3 failing and **reasonably concludes the repo is broken**, when 640
  tests pass."
- The geography plan omitted `build` from its config table, and the engine reads
  it — so every logged event would have been stamped `undefined`, silently,
  forever.
- The geography plan "skipped capped countries entirely in the containment test,
  **and that skip is what hid the antimeridian bug.**"

If there's one transferable lesson here, that's it: **the plan is the most
dangerous artifact in the pipeline.** It's detailed enough to be followed exactly
and confident enough not to be questioned.

What worked against it was keeping plans and specs light on code samples, and
encouraging cooperation and double-checking between agents — specifically, giving
them standing permission to refuse:

> The one that found the `Shift` bug could have stripped the capitals from its own
> content to make its task pass, and its task would have looked complete. It said
> "this is a bug in a file I don't own" and stopped. **That rung would have
> shipped gutted.**

---

## Silent failure

This is the dominant category. Roughly a dozen commits are about a failure that
produced no error, no red test, and no visible symptom.

- **`speak()` returned success for audio that never played.** Chrome queues an
  utterance in a background tab and declines to start it — and
  `speechSynthesis.speaking` reads `true` the whole time. Measured: speaking true,
  pending false, and after 3.4 seconds neither a `start` nor an `error` event. The
  code "returned `'tts'` into that silence."
- **The server had no `.mp3` MIME type**, so pronunciations went out as
  `application/octet-stream` and Chrome refused them. In drill mode the audio *is*
  the question, so "a refused decode looks exactly like a working game with empty
  boxes."
- **`dont`** — a contraction with the apostrophe stripped to satisfy an a-z
  constraint. The game showed four slots and would have **marked a misspelling
  correct**.
- **A raw NUL byte in a test file** made git treat all 5.8KB as binary, so the file
  never appeared in a diff. "In a plan reviewed wave-by-wave from the diff, one
  test file was structurally invisible."
- **A tautological test.** The assertion re-derived the value using the production
  formula, so "it would have passed even if both were wrong the same way."
- **Orphaned writes.** `settings.lastLesson` was written every round and read by
  nobody, because a later task had replaced its only reader. Stated as a general
  law: "**task N+1 replaces task N's entry point, and the orphaned bookkeeping
  keeps running because nothing fails when it does.**"

And the one that best explains why this category needs its own name — a commit
titled *"Finish the job the last commit claimed to have finished"*:

> `9b96943` said a format change was now one edit. **It was not.** The hazard did
> not close — **it moved**, into the one function that decides which screen she
> sees.
>
> **That is worse than where it started.** … a child is accused of forgetting to
> clock out on a timer she started an hour ago, with no way to close it but to
> throw it away.

---

## Green tests are not evidence

There are 807 tests. They pass. They caught almost none of the above.

I've already said I deliberately kept testing light, and I stand by that for a
project at this stage. But the empirical result is starker than my policy, and
it's the strongest evidence I have for the choice:

> **Every DOM-layer bug was invisible to 96 passing tests.**

What actually worked was making agents play the thing, and specifically:

> naming the specific things to confirm, and adding that **an honest "not verified"
> was more useful than an assumed pass** — one agent then volunteered that its log
> check had not been tight enough to catch the `misses` bug, which was true and
> useful.

That produced commits like *"Gate C: both modes played, one item honestly
unverified"* — recording a gap instead of assuming a pass.

So: **don't treat a green test suite as evidence.** On this project every real
defect came from an agent explaining its reasoning, a reviewer running mutations,
or a kid playing the game.

There's an escape hatch, and it gets used precisely. A MIME-type test was added to
a file whose header said it covered safety only:

> That boundary is right and stays: every other type in the table announces itself
> when wrong (a mistyped `.css` is a visibly unstyled page). **This one is
> inaudible, so it earns a test.**

"Inaudible" is doing the work in that sentence. That's the criterion — not "is
this important" but "would anyone find out."

---

## The audio pipeline

The most interesting engineering in the project, and it started as a failure.

The spelling game originally spoke with Merriam-Webster recordings — human, good,
and licensed. The problem turned out to be structural rather than accidental:

> M-W has no recording for irregular inflections — it files pronunciation on the
> base headword — so `is`, `was`, `said`, `had`, `been` and 32 others came back
> with an entry and no audio. Those are among the most frequent words in English,
> and **in drill mode a word we cannot say is not a degraded word, it is an
> unanswerable one.**

The interim fix was to trim those words out of play, with an appropriate note of
alarm: "a trim is invisible on screen — the game just quietly never offers `said`."
Coverage sat at 594 of 995.

The real fix was generating every word locally with Kokoro-82M, an Apache-2.0
model. Coverage went to **995 of 995**, and "the words recovered are exactly the
ones this item was about: `is was said had has did got were been`."

Four problems closed at once: the coverage gap, the API quota, the redistribution
ban, and a voice that changed word to word because M-W's recordings are studio
takes by different speakers.

There was a fifth thing I didn't expect. My kids were actually *annoyed* by the
Webster readers. After tuning, I found the Kokoro voices more appealing and
genuinely easier to understand — which is not what I would have predicted going
in, given I was replacing real human recordings with a synthetic voice. 

### Three rendering decisions, each from listening rather than reasoning

**A carrier phrase — "Spell the word. \_\_\_."** Neural TTS is trained on
sentences; fed a bare word it sometimes clips the onset or ends on a rising
question intonation.

**Phonemes pinned to the isolated rendering.** The carrier gave the normaliser
context to normalise *wrongly*: `Spell the word. am.` came out as "a.m." — the
letter names, the time abbreviation. Punctuation didn't fix it. So each word is
rendered alone first, and *that* reading is pinned into the carrier. The result is
a structural guarantee rather than a blocklist: "A word in isolation has no
context to mislead the normaliser, which makes the carrier **structurally
incapable** of changing a pronunciation. No exception list: the next `am` fixes
itself."

**Reduced function words promoted to citation form.** English swallows function
words, so Kokoro rendered `is` as `ɪz` and `been` as `bˌɪn` — right for
conversation, wrong when a child is being asked to spell them. It fires on 64 of
995 words, and the overlap is the point:

> the reduced words are very nearly the same set M-W had no recording for — both
> are consequences of being high-frequency function words — **so the words most
> needing synthesis are the ones the model most wants to swallow.**

### Pronounciation:

Stress promotion adds a stress *mark*. It cannot restore a *vowel*. So `than` came
out `ðˈən` — stressed, and still reduced — passing the stress check while being
wrong. Whisper heard that file as "then," which is itself a word in the spelling
list. **A child spelling exactly what she heard would have been marked wrong.**

The fix is a third audit, and it's one regex:

> English does not put primary stress on a schwa, so `ˈə` or `ˈɐ` is a reliable
> tell.

*(This next bit is my reading, not something the docs claim:)* what makes that work
is that it uses a linguistic invariant as a type check. No rule can derive the
correct vowel from a schwa — that information is gone. But there *is* a rule
saying a particular combination cannot occur in English at all. So you assert its
absence. That turns an undecidable question ("is this vowel right?") into a
decidable one ("is this phoneme string well-formed English?"). Across 995 words it
flags exactly two: `than` and `the`.

### Whisper, and the inversion

Round-tripping the generated audio through speech recognition looks like a
correctness check. It's a bad one — it *passed* the `am` → "a.m." bug, because a
speech recognizer is a language model and will happily correct a bad rendering
back into the word it expected.

What it's good at is the opposite thing:

> **Whisper is a poor correctness check — but its mismatches are precisely the
> words whose rival spelling a child could also type.**

Run against all 995 files, it flagged 43 words. 16 were already known. **17 were
real, typable rival spellings nobody had listed**: `which/witch`, `piece/peace`,
`passed/past`, `weight/wait`, `led/lead`, and a dozen more.

Which leads to the most important sentence in the spelling game's notes, about the
class of bug that better audio *cannot* fix:

> **Nothing is broken in the code**, and that is the point. The PROMPT is
> insufficient: **a perfect recording of /siː/ still does not distinguish `see`
> from `sea`. Generating our own audio did not help here and never could have.**

And the framing that carries the whole project's ethic, from `homophones.js`:

> **THIS IS NOT A DIFFICULTY LIST. It exists because of a hole in the QUESTION,
> not a hole in the kid.**

### The property that made any of this possible

*(Also my inference:)* every check above depends on Kokoro reporting the phoneme
string it actually rendered. That's not a property of TTS in general. A black-box
cloud API would have handed back the audio and none of the evidence — I'd have had
the same bugs with no way to see them. The strongest argument for a local
open-weights model here isn't cost or privacy. It's that the pipeline is
*inspectable*.

That's also the answer to the thing I flagged at the top — how an agent that
cannot hear did most of the work on an audio pipeline. It never had to hear
anything. The carrier bug is a string mismatch. The reduced-vowel bug is a missing
`ˈ`. The `than` bug is a regex hit. Whisper's disagreements come back as words. At
no point does the fix require perceiving sound, because the whole problem was
moved into a representation that can be read.

What I had to supply was the part that genuinely needs ears: *this one sounds
wrong.* Four words, in my case. Everything downstream of that — diagnosing why,
fixing it, and building the check that stops it recurring across 995 files — was
work that could be done in text. **If you want an agent to work on something it
can't perceive, the useful question isn't how to describe it. It's which
representation makes it readable.**

---

## The word list, and being wrong by 94%

The spelling curriculum is 995 words in a fixed order, and how they got there is a
good small story about the difference between knowing something and checking it.

The first version was written from memory, and admitted it in its own commit
message:

> These ranks were written from knowledge rather than transcribed from the
> published list, and confidence falls off past the first few hundred. **An
> invented ordering is worse than a short one:** it silently teaches the wrong
> words first and nothing in the game would ever surface the error.

Then it got measured against the actual sourced list:

> exact ranks agreed **6%** of the time and bands agreed **98%**. Band is signal;
> position inside it is noise. Do not sort by array index.

Both halves matter. The memory was almost entirely wrong about specifics and
almost entirely right about the shape. The useful move wasn't "throw it out" — it
was "find the resolution at which it was right, then encode that." Which is also
why Fry's list suited this project in the first place: those bands of 100 are
where the real information lives.

The same replacement caught a data-corruption near-miss. A normalised copy of the
source had stripped apostrophes and lowercased everything, which "put `dont`,
`didnt`, `america` and `washington` in as if they were words, and silently
collided `we'll` into `well`."

The ordering itself is two principles deliberately spliced together:

> The opener is ordered by PHONICS. It is hand-authored because **no frequency
> list produces a good first lesson** — frequency gives you `the`, `of`, `and`,
> which are three different irregular spellings in a row and teach no pattern at
> all. **A kid's first ten words should rhyme, so that spelling the second one is
> a deduction from the first.**

After about fifty words, raw frequency takes over and behaves well.

There's no difficulty setting anywhere in the game. A *frontier* — the first N
words in list order that aren't yet mastered — does that job, "which is what lets
a four-year-old and a ten-year-old run identical code and land in completely
different regions of the same spine." And it's a filter, never a contiguous slice,
for one specific reason: "one stubborn item cannot block the window… that is the
failure mode that makes a kid quit."

---

## Two dials, and a module that earned promotion

One finding from the early research shaped a lot of the design:

> **Typing difficulty is orthogonal to spelling difficulty.** `rhythm` is a hard
> spell and an easy type; `pizzazz` is the reverse. Two dials, not one.

So `typingCost` computes keyboard awkwardness as a separate axis: pinky penalties,
row distance, same-finger bigrams — *averaged* rather than summed, because length
is already the other dial. It's "a MULTIPLIER, NOT A GATE — an awkward word is
served less often, never excluded."

It started in the spelling game. The geography game needed it too, because
"Kyrgyzstan, Liechtenstein" carry a typing burden that isn't geography knowledge.
Promoting it into `core/` was a six-line diff, and the commit explains why it was
that cheap:

> **Three consumers is where a module stops belonging to one game.** It already
> imported its finger and row tables from the typing game rather than copying
> them, and already took its one pedagogical dial from config, so nothing here was
> spelling-shaped.

That's the pattern worth copying. The module wasn't *designed* for reuse. It was
written with honest seams, so reuse was cheap when it turned up.

---

## Derive, don't store

The rule that runs through every game: the event log is the source of truth, and
everything else is recomputed on read. No stored mastery, no saved bookmark, no
"current lesson" pointer.

> **This is the rule that makes questions we have not thought of yet answerable
> against history we have already collected** — a per-key accuracy heatmap becomes
> a query over data already on disk rather than a feature to build and then wait
> months to populate.

It also means a rule change applies retroactively: adjust a star threshold and all
history re-scores, with no migration.

The concept the whole model rests on is what counts as evidence:

> a "clean" attempt is one where the correct answer landed before any hint fired.
> That is the ONLY evidence of retrieval. **An item answered correctly a hundred
> times but always after a hint has never been retrieved from memory, and it stays
> cold.**

That definition turned out to be load-bearing in a way I hadn't planned. Real play
showed a kid typing "jamacia" five times for Jamaica — she knew the country and
couldn't spell it, and was buying the reveal one wrong answer at a time, because
*a wrong answer was the only thing that advanced the ladder*. The fix was an "I
don't know" button. And the mastery model needed no change at all to accommodate
it, because "clean" had been defined as *before any help arrived* rather than
*without a wrong answer*. Giving up costs nothing and buys nothing, which is
exactly the right incentive.

---

## What real play caught that reasoning did not

Every game's notes carry a version of the same idea:

> Items backed by real play are marked — they are worth more than the ones that
> came from reasoning, **because on this project reasoning is what produced the
> bugs and playing is what found them.**

A sample:

- **Learn mode taught one word family forever**, because "taught" was a boolean and
  a boolean can demote a family exactly once. Real play got `in pin win tin` four
  sessions running. It then took *three* commits to actually kill — twice declared
  fixed and wasn't.
- The first attempted fix made lessons a secondary sort key. "**A TIE-BREAK IS NOT
  ENOUGH, and this is the part worth remembering.** It only fires when two families
  score exactly equal — on real data they almost never do." Measured against a real
  log: 1.50 against 1.60, never tied, tie-break never consulted.
- **Learn mode taught `6×7`, `7×6` and `7×7` together** — two of which are 42. "The
  mode whose entire job is careful instruction is actively creating the confusion
  the rest of the system is built to detect."
- **The spelling game shipped with no menu card** and nobody noticed, "because the
  way anyone tested it was by opening its URL directly. A kid opening the menu
  could not reach it at all."
- The typing log's most-missed character was **space**, by a wide margin — and
  space is taught once, in passing, as a thumb key on rung zero. "It is exactly the
  kind of thing nobody would have thought to look for."
- That miss data "very nearly did not exist": it was originally derived by
  filtering log entries, "but in block mode — the default — a wrong press appends
  no entry at all, so it was silently `[]` for every kid. **Had any of the above
  been built six months from now, it would have been built against nothing.**"

---

## Still open, honestly

- **Every word added to the list is a word whose rival spelling has never been
  checked.** The 17 homophones Whisper found are now in `homophones.js` — that took
  the words that flash from 40 to 64 — but the detector has to be re-run after any
  growth, and nothing enforces that. It's a manual step on a machine that isn't
  this repo.
- **The typing game has never been tested by a child.** One adult session, sixteen
  rounds. Its notes say so up front: "almost nothing here is [backed by real play],
  yet."
- **`auditManifest` has no test** — pure, exported, load-bearing logic, in the part
  of the codebase where I *do* think tests belong.
- **The audio pipeline isn't reproducible by a cloner.** The audio ships; the
  generation code lives on a GPU box and is documented in a README that isn't in
  this repo.
- **`dolch` is written on every word and read by nothing.**
- **There is no morphology.** Not one suffix among the pattern tags. And the
  complaint that surfaced it is a good one: "More frequent words would just be more
  four-letter words — **frequency is not difficulty**, and 'it is all easy' is the
  actual complaint."

---

## If you're doing this too

1. **Do the research before you ask for code.** The gap between the first typing
   game and this one isn't better prompting. It's that the second one was built on
   a long conversation about "how is typing actually taught?" It's been 35 years
   since I learned, and I had no memory of it — and I assume the teaching has moved
   on since. So I asked a lot of questions. Same with spelling. We didn't
   incorporate everything that turned up, and there's more to do there, like deeper
   spelling lessons. But using agents to research teaching methods, and then storing
   that context, grounded three things at once: my own understanding, the agents',
   and the plan documents.
2. **Suspect the plan before the implementation.** Agents follow instructions with
   high fidelity, including wrong ones. Three of four real defects in one build
   were faithfully-implemented plan errors.
3. **Give agents permission to refuse.** The most valuable instruction in this
   project was "escalate rather than comply." An agent that makes its own task pass
   by damaging a neighbour's produces a green board and a broken product.
4. **Ask for honest non-verification.** "I could not check this" is worth more than
   an assumed pass, and agents will say it if you make it safe to.
5. **Play the thing.** Every DOM bug here was invisible to a full green suite.
6. **Batch your reviews.** The measured cost of per-task review loops wasn't the
   reviewing — it was every report accumulating in the orchestrator's context
   forever.
7. **Tell subagents how to report.** Twice in this project an agent finished, went
   idle, and its findings sat in plain text that never reached anyone. The work was
   fine both times; the report was lost. *(While compiling this document, four
   research agents did exactly the same thing. The lesson was already written down
   in this repo and got re-learned anyway.)*
8. **Write commit messages for the next person.** The most durable design knowledge
   in this repo isn't in the specs. It's in commit bodies explaining why something
   is the way it is — the `Map` insertion-order tie, the NUL byte, the
   fire-and-forget `speak()`. None of that appears in any spec. And the agents read
   them: a good commit history is context they can pick up without being handed it.

---

*Corrections welcome. Everything here is checkable against the repo, and if
something in it is wrong, that's exactly the kind of finding this document is
about.*
