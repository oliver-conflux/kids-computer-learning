# Kids Computer Learning

A small suite of learning games I built for my own kids. They run in a browser
on a real computer, from a server on that computer, and nothing they record ever
leaves the machine.

They are deliberately **keyboard-centric**. There are plenty of tablet games;
this is meant to feel like using a computer — typing, thinking, and eventually
programming.

They were built almost entirely through AI-assisted development.
**[DEVELOPMENT-JOURNEY.md](DEVELOPMENT-JOURNEY.md)** is the honest account of how
that went — what the agents got wrong, what 807 passing tests failed to catch, and
what only a child playing the game ever found.

## The games

| Game | What it does |
|---|---|
| **Typing** (`typing-game/`) | Touch typing from scratch — letters, numbers, all ten fingers. Twenty-three lessons on two parallel ladders, plus a practice mode that is never locked. |
| **Learn Numbers** (`math-game/?mode=learn`) | Shows a way to *work out* each tricky times table, one at a time, untimed. |
| **Drill Numbers** (`math-game/?mode=drill`) | Practices facts she already has a strategy for, and shows a grid of which ones are known by heart. |
| **Learn Spelling** (`spelling-game/?mode=learn`) | Takes a family of words that all work the same way — light, night, right — and shows the pattern. Untimed. |
| **Drill Spelling** (`spelling-game/?mode=drill`) | Hear a word, spell it. The ones she is still getting wrong come round more often. Audio is generated and phoneme-checked (see below). |
| **Name the Country** (`geography-game/`) | A country lights up on a map, or its flag appears. Type its name. |
| **Timer** (`activity-log/`) | Clock in and out of an activity and see how long it took. |

## Running it

You need **Node 22 or newer**. Nothing else — there is no `npm install`, because
there is nothing to install.

**macOS** — double-click `play.command`. It starts the server and opens the menu,
and closing the Terminal window stops the server.

**Anything else** — from the repo root:

```
node server/serve.js
```

then open <http://localhost:8777/games-menu.html>.

Opening `games-menu.html` directly from the filesystem will not work, and the
page says so rather than letting you find out one click later. The games need
the server in order to remember how you did.

## What it stores, and where

Every game writes an append-only event log to `data/<game>-log.jsonl` on your own
machine. Those files are gitignored — your kid's practice history is not
something to commit.

There are **no accounts, no analytics, no telemetry, and no ads**, and there
never will be. The server binds `127.0.0.1` only, so it is not reachable from
your network. Nothing here talks to the internet at play time; even the
geography data and flags are committed rather than fetched, so the games work
with no connectivity at all.

The one thing worth backing up is `data/`. The logs are not a record of what
happened so much as the thing that makes the games work — see below.

## How it is built

Zero dependencies. Vanilla ES modules, no build step, no bundler, no framework.
`server/serve.js` imports nothing but the Node standard library.

```
core/      shared logic — the log client, mastery, the frontier, scheduling
server/    a dependency-free localhost file server that owns the logs
data/      the generated word audio, and your own event logs
tools/     build-time scripts: word list, audio generation, country data
```

Tests run with the built-in runner:

```
node --test
```

**The event log is the source of truth, and mastery is derived from it.**
`core/mastery.js` stores nothing — buckets, counts, and intervals are recomputed
from the log on every read. That is what lets a threshold change re-read the
whole history instead of having to re-collect it. It is the most important
property in the codebase and the easiest one to accidentally optimize away.

Logic is tested thoroughly; UI is not tested at all. That is a deliberate split,
not an oversight.

## About the word list

The spelling curriculum is 995 words in a fixed order, and that order comes from
**Fry's 1000 Instant Words** (Dr. Edward Fry, 1996), with **Dolch sight words**
flagged alongside. Both are public, frequency-derived teaching lists, which is
why the word list can travel with the repo — every clone gets an identical,
playable spine with nothing to download.

The first fifty-odd words are not Fry's, though. They are hand-authored and
ordered by phonics instead, because no frequency list makes a good first lesson:
frequency gives you `the`, `of`, `and` — three different irregular spellings in a
row that teach no pattern at all. A kid's first ten words should rhyme, so that
spelling the second is a deduction from the first. After that, frequency takes
over and behaves well.

Sources, transcription notes, and what is still unresolved are documented in
[`spelling-game/data/README.md`](spelling-game/data/README.md).

## About the audio

The spelling game's 995 word recordings in `data/audio/` are generated with
[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0) and committed, so a
fresh clone plays with sound immediately — no API key, no setup.

They are checked rather than trusted. Every file is audited against the phonemes
it was supposed to render, and a failed audit refuses the whole run. Separately,
the files are round-tripped through speech recognition — not as a correctness
check, which it is bad at, but as a **homophone detector**: a word it hears
differently is a word whose rival spelling a child could also have typed, and
would have been marked wrong for. Several real bugs were found that way. See
`spelling-game/docs/audio-sourcing.md`, and
[DEVELOPMENT-JOURNEY.md](DEVELOPMENT-JOURNEY.md) for the longer story.

Merriam-Webster recordings are used only as a local reference for checking these,
are licensed material, and are **not** distributed here — `data/audio-mw/` is
gitignored. If you want that reference locally, `.env.example` explains the free
API keys; nothing in the games requires them.

## License

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0).

Use it with your kids. Use it in your classroom — the license covers educational
institutions and charities explicitly, regardless of funding. You just cannot
sell it or build a commercial product on it.

This is source-available rather than open source, since the OSI definition does
not permit a noncommercial restriction. Two vendored directories keep their own
licenses (flag-icons is MIT, the Natural Earth data is public domain); see
`LICENSE` and `geography-game/data/README.md`.

## A note on what this is

A personal project, shared because it might be useful. I am not running it as a
service and there is nothing to sign up for. Issues and forks are welcome; I make
no promises about responding to either.
