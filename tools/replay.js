#!/usr/bin/env node
// Offline replay of a game's scheduler against real collected history.
//
// The whole system is shaped so this file can exist: `mastery`, `scheduler` and
// `placement` are pure functions over the log and `rng` is injected, so history
// already in hand can be re-run under a DIFFERENT tunables table without
// shipping that table to a child first (math spec §12). The question answered
// here is not "what does the log say" — it is "if I retune the weights or the
// thresholds, what would actually have happened differently".
//
// So the output is built for COMPARISON, not description:
//
//   - every item in the space gets a line, in space order, whether or not it was
//     served. Two runs then differ only in the numbers that changed, and
//     `diff a.txt b.txt` reads as a list of effects rather than a list of
//     insertions.
//   - each line also carries what the log RECORDED, so a single run already
//     answers "would have been served 14x instead of 6x".
//   - the header echoes the game, the seed, the build filter and the overrides,
//     so a diff of two runs states its own experiment.
//
// WHAT IS BEING COUNTERFACTUALISED. At every point where a problem was really
// served, the model and the session history are reconstructed as they stood at
// that moment, and the scheduler is asked what IT would have served under the
// replay config. That pick is counted; then the RECORDED attempt is folded in
// and the walk moves on. It has to work this way round: a fully divergent
// simulation would immediately be picking items for which the log holds no
// outcome, so the model could not advance and every number after the first
// divergence would be invented rather than measured.
//
// TWO GAMES, TWO WALKS, ONE TOOL. The parameterisation that matters is which
// log, which tunables table, which item space and which report — that is what
// `GAMES` holds. The walks themselves are deliberately NOT merged: math asks one
// question per problem, spelling interleaves probes against a placement model it
// re-derives after every word, and a single hook-riddled loop covering both
// would hide exactly the difference a replay exists to measure.
//
// THE TRAP THIS TOOL MUST NOT FALL INTO — read `spelling-game/js/playable-hash.js`.
// The spelling game draws from `PLAYABLE`, which is derived from which mp3s are
// sitting in the audio cache ON DISK. That is not a function of the log. 401
// words had no recording in August and have one now, so a replay run today
// reconstructs a word list the kid never played against, silently. Session
// events carry `playableCount` and `playableHash` so this is detectable, and the
// spelling report checks them and shouts when they do not agree. Events written
// before that existed (build `s1`) carry no hash at all, and the report says
// "unknown", never "matched".
//
// This is a Node script and is deliberately NOT part of any game's js/. It may
// read argv and the filesystem. It never writes anything, and it never mutates
// an imported CONFIG — the replay table is a deep copy.
//
// Usage:
//   node tools/replay.js [logPath] [--game=G] [--build=TAG] [--seed=N]
//                        [--items=playable|spine] [--config=k=v,...]

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, resolve } from 'node:path';

import { compareTimestamps } from '../core/mastery.js';
// The SAME generator the scheduler suite uses. Two independently written PRNGs
// would make a replay result unreproducible from the tests that validated the
// scheduler, and the divergence would be silent.
import { mulberry32 } from '../math-game/js/rng.js';

import { CONFIG as MATH_CONFIG } from '../math-game/js/config.js';
import { allFacts, factId } from '../math-game/js/facts.js';
import { deriveMastery as deriveMathMastery } from '../math-game/js/mastery.js';
import { pickNext as pickNextFact } from '../math-game/js/scheduler.js';

import { CONFIG as SPELLING_CONFIG } from '../spelling-game/js/config.js';
import { SPINE, playableSpine } from '../spelling-game/js/spine.js';
import { spellingSpace } from '../spelling-game/js/space.js';
import { derivePlacement } from '../spelling-game/js/placement.js';
import { hasHomophone } from '../spelling-game/js/homophones.js';
import { playableHash } from '../spelling-game/js/playable-hash.js';
import { deriveMastery as deriveCoreMastery } from '../core/mastery.js';
import { pickNext as pickNextItem } from '../core/scheduler.js';
import { typingCost, KEYMAP } from '../core/typing-cost.js';

const DEFAULT_SEED = 1;
const BUCKETS = ['cold', 'warm', 'hot'];
const LABEL_WIDTH = 16;
const LEARN_MODE = 'learn';

// The audio cache, as the running game sees it through /api/audio: a live
// directory read rather than a manifest, and the same lowercase-a–z filter the
// server applies. Read here rather than passed in because the whole point is to
// reconstruct what the game WOULD build today — a hand-supplied list would be a
// different question, and a less honest one.
const AUDIO_DIR = fileURLToPath(new URL('../data/audio', import.meta.url));
const SAFE_WORD = /^[a-z]+$/;
const MP3 = '.mp3';

/**
 * The two games, and everything about them a replay needs before it knows which
 * walk to run. `detect` reads one attempt event: math events name `op/a/b`,
 * spelling events name `word`, and neither carries the other's fields.
 */
const GAMES = {
  math: {
    defaultLog: 'data/math-log.jsonl',
    config: MATH_CONFIG,
    detect: (event) =>
      typeof event.op === 'string' && Number.isFinite(event.a) && Number.isFinite(event.b),
  },
  spelling: {
    defaultLog: 'data/spelling-log.jsonl',
    config: SPELLING_CONFIG,
    detect: (event) => typeof event.word === 'string' && event.word !== '',
  },
};

const GAME_NAMES = Object.keys(GAMES);

/** Which item spaces the spelling replay can be run against. See `--items`. */
const ITEM_SPACES = ['playable', 'spine'];

const USAGE = [
  'Usage: node tools/replay.js [logPath] [--game=G] [--build=TAG] [--seed=N]',
  '                            [--items=playable|spine] [--config=key=value,...]',
  '',
  '  logPath          JSONL event log; defaults to the chosen game\'s log',
  `  --game=G         ${GAME_NAMES.join(' | ')}; inferred from the log if omitted`,
  '  --build=TAG      replay only events carrying this build tag',
  `  --seed=N         seed for the replay generator; defaults to ${DEFAULT_SEED}`,
  '  --items=WHICH    SPELLING ONLY. Which item space to replay against:',
  '                   `playable` (default) is the words with an mp3 in the audio',
  '                   cache right now — what the game would build today.',
  '                   `spine` is the whole catalogue, ignoring the cache.',
  '  --config=...     comma-separated CONFIG overrides for this replay only,',
  '                   e.g. --config=probeMargin=0,drillCap=10,hotMs=6000',
  '',
  'Output is one line per item in a stable order, so two runs can be compared',
  'with diff. Nothing is ever written to disk.',
].join('\n');


/**
 * Parse argv into replay options. Throws on anything it does not recognise —
 * a mistyped flag that silently did nothing would make a comparison report a
 * change that was never applied, which is worse than no tool at all.
 *
 * `logPath` and `game` both come back possibly null: which log to read depends
 * on the game, and which game it is depends on the log. `replay` resolves that
 * knot, in that order.
 *
 * @param {string[]} argv arguments after the script name
 * @returns {{logPath: string|null, game: string|null, items: string|null,
 *            build: string|null, seed: number, overrides: string[], help: boolean}}
 */
export function parseArgs(argv) {
  let logPath = null;
  let game = null;
  let items = null;
  let build = null;
  let seed = DEFAULT_SEED;
  let overrides = [];
  let help = false;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg.startsWith('--game=')) {
      game = arg.slice('--game='.length);
      if (!Object.hasOwn(GAMES, game)) {
        throw new Error(`--game must be one of ${GAME_NAMES.join(', ')}; got: ${game}`);
      }
    } else if (arg.startsWith('--items=')) {
      items = arg.slice('--items='.length);
      if (!ITEM_SPACES.includes(items)) {
        throw new Error(`--items must be one of ${ITEM_SPACES.join(', ')}; got: ${items}`);
      }
    } else if (arg.startsWith('--build=')) {
      build = arg.slice('--build='.length);
    } else if (arg.startsWith('--seed=')) {
      const value = Number(arg.slice('--seed='.length));
      if (!Number.isFinite(value)) {
        throw new Error(`--seed must be a number, got: ${arg.slice('--seed='.length)}`);
      }
      seed = value;
    } else if (arg.startsWith('--config=')) {
      overrides = arg
        .slice('--config='.length)
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (logPath === null) {
      logPath = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }

  return { logPath, game, items, build, seed, overrides, help };
}

/**
 * Which game a log belongs to, from the events themselves.
 *
 * The LOG is the authority, not the filename: a log copied to a temp directory
 * for an experiment is still the log it always was, and a replay that guessed
 * from the path would run the wrong walk over it and report confident numbers.
 * The filename is consulted only when there is nothing to read — an empty or
 * all-garbage file — where it is the only evidence there is.
 *
 * A log whose events name BOTH games is refused rather than resolved. That means
 * two logs have been concatenated, and every number a replay drew from it would
 * be a blend of two different item spaces.
 *
 * @param {object[]} events
 * @param {string} logPath used only for the fallback and the error message
 * @returns {string} a key of GAMES
 */
export function detectGame(events, logPath) {
  const votes = new Set();
  for (const event of events) {
    if (event.type !== 'attempt') {
      continue;
    }
    for (const name of GAME_NAMES) {
      if (GAMES[name].detect(event)) {
        votes.add(name);
      }
    }
  }

  if (votes.size === 1) {
    return [...votes][0];
  }
  if (votes.size > 1) {
    throw new Error(
      `${logPath} holds attempts from more than one game (${[...votes].sort().join(', ')}). ` +
        'Two logs have been concatenated; replay them separately.',
    );
  }

  const name = basename(logPath);
  const hinted = GAME_NAMES.filter((game) => name.includes(game));
  if (hinted.length === 1) {
    return hinted[0];
  }
  throw new Error(
    `Cannot tell which game ${logPath} belongs to — it holds no readable attempts. ` +
      `Pass --game=${GAME_NAMES.join(' or --game=')}.`,
  );
}

/**
 * Coerce an override's text to the type the existing config field already has,
 * so `--config=hotMs=1200` yields a number and not the string "1200" that would
 * compare wrong against a median.
 *
 * @param {string} text
 * @param {unknown} existing
 * @param {string} key for the error message
 * @returns {number|boolean|string}
 */
function coerceValue(text, existing, key) {
  if (typeof existing === 'number') {
    const value = Number(text);
    if (!Number.isFinite(value)) {
      throw new Error(`Config key ${key} is numeric; got: ${text}`);
    }
    return value;
  }
  if (typeof existing === 'boolean') {
    if (text !== 'true' && text !== 'false') {
      throw new Error(`Config key ${key} is a boolean; got: ${text}`);
    }
    return text === 'true';
  }
  return text;
}

/**
 * A deep copy of `base` with the given `key=value` overrides applied. The
 * imported CONFIG is never touched — every other module in the process shares
 * that object, and a replay that mutated it would change the meaning of its own
 * later comparisons.
 *
 * Dotted paths reach nested tables: `weights.cold=8`, `delays.hot=7000`.
 * An unknown key is an error, never a silent no-op.
 *
 * @param {string[]} overrides
 * @param {object} base the game's shipped tunables table
 * @returns {object}
 */
export function configWithOverrides(overrides, base) {
  const config = structuredClone(base);

  for (const override of overrides) {
    const separator = override.indexOf('=');
    if (separator <= 0) {
      throw new Error(`Config override must be key=value, got: ${override}`);
    }
    const key = override.slice(0, separator).trim();
    const text = override.slice(separator + 1).trim();

    const path = key.split('.');
    let target = config;
    for (let index = 0; index < path.length - 1; index += 1) {
      const step = target[path[index]];
      if (step === null || typeof step !== 'object') {
        throw new Error(`Unknown config key: ${key}`);
      }
      target = step;
    }
    const leaf = path[path.length - 1];
    if (!Object.hasOwn(target, leaf)) {
      throw new Error(`Unknown config key: ${key}`);
    }
    target[leaf] = coerceValue(text, target[leaf], key);
  }

  return config;
}

/**
 * Read a JSONL log into events. A corrupt line is counted and dropped — the log
 * is append-only and written by a browser that can be closed mid-write, so a
 * truncated last line is normal, not exceptional. Nothing here throws on
 * content.
 *
 * @param {string} logPath
 * @returns {{missing: boolean, events: object[], lines: number, malformed: number}}
 */
export function readLog(logPath) {
  let text;
  try {
    text = readFileSync(logPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { missing: true, events: [], lines: 0, malformed: 0 };
    }
    throw error;
  }

  const events = [];
  let lines = 0;
  let malformed = 0;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    lines += 1;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      malformed += 1;
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      malformed += 1;
      continue;
    }
    events.push(parsed);
  }

  return { missing: false, events, lines, malformed };
}

/**
 * Left-labelled header line, so the header column is stable across runs and a
 * diff lines up.
 *
 * @param {string} label
 * @param {string|number} value
 * @returns {string}
 */
function row(label, value) {
  return `${label.padEnd(LABEL_WIDTH)}${value}`;
}

// ---------------------------------------------------------------------------
// the item space, and whether it is the one the kid played against
// ---------------------------------------------------------------------------

/**
 * The words with a pronunciation in the audio cache, as /api/audio would list
 * them. A missing cache directory reads as an empty list rather than throwing,
 * which is the state of a fresh clone and not an error.
 *
 * @param {string} [dir]
 * @returns {string[]}
 */
export function audioWordsOnDisk(dir = AUDIO_DIR) {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(MP3))
      .map((name) => name.slice(0, -MP3.length))
      .filter((word) => SAFE_WORD.test(word))
      .sort();
  } catch {
    return [];
  }
}

/**
 * The spelling item space to replay against, and its fingerprint.
 *
 * `playable` reconstructs what the game would build TODAY, by the same route:
 * the audio cache filtered through `playableSpine`. That reconstruction is the
 * best available and is still not necessarily the historical one — which is
 * precisely why the hash comes back with it.
 *
 * @param {string} which one of ITEM_SPACES
 * @param {string} [dir] the audio cache
 * @returns {{which: string, source: string, spine: object[], hash: string, trimmed: number}}
 */
export function spellingItemSpace(which, dir = AUDIO_DIR) {
  const spine = which === 'spine' ? SPINE : playableSpine(SPINE, audioWordsOnDisk(dir));
  return {
    which,
    source: which === 'spine' ? 'the whole catalogue (spine.js)' : `the audio cache at ${dir}`,
    spine,
    hash: playableHash(spine.map((entry) => entry.word)),
    trimmed: SPINE.length - spine.length,
  };
}

/**
 * Compare the item space this replay is about to use against the one each
 * session was really played against.
 *
 * THIS IS THE POINT OF THE SPELLING REPLAY, not a nicety on the side. Without
 * it the tool answers "what would this config have done to a word list the kid
 * never saw" in exactly the same confident tone as the real question, and
 * `docs/next-steps.md` item 6 is the record of someone believing it.
 *
 * Three outcomes and they are kept apart on purpose. `matched` is evidence.
 * `mismatched` is a known-wrong replay. `unknown` — a session event written
 * before playable-hash.js existed, which is every `s1` event in the log today —
 * is NOT a match: it is the absence of evidence, and reporting it as agreement
 * would be the original bug with a checkmark on it.
 *
 * `unrecorded` is a fourth case and a quieter one: a session that served
 * problems and never wrote a session event, because the kid walked away or the
 * tab closed. Its attempts are in the log and are replayed; nothing anywhere
 * says what word list they were served from. The count is reported rather than
 * folded into `unknown`, because the fix is different — `unknown` needs the log
 * to age past build `s1`, this needs the session to have been finished.
 *
 * @param {object[]} events the build-filtered log
 * @param {string} hash of the item space this replay will use
 * @returns {{matched: object[], mismatched: object[], unknown: object[],
 *            unrecorded: unknown[], sessions: number}}
 */
export function checkItemSpace(events, hash) {
  const matched = [];
  const mismatched = [];
  const unknown = [];
  const attemptSessions = new Set();
  const closed = new Set();

  for (const event of events) {
    if (event.type === 'attempt') {
      attemptSessions.add(event.session);
      continue;
    }
    if (event.type !== 'session') {
      continue;
    }
    closed.add(event.session);
    const entry = {
      session: event.session,
      t: event.t,
      build: event.build,
      recorded: event.playableHash,
      count: event.playableCount,
    };
    if (typeof event.playableHash !== 'string' || event.playableHash === '') {
      unknown.push(entry);
    } else if (event.playableHash === hash) {
      matched.push(entry);
    } else {
      mismatched.push(entry);
    }
  }

  const unrecorded = [...attemptSessions].filter((session) => !closed.has(session));

  return {
    matched,
    mismatched,
    unknown,
    unrecorded,
    sessions: matched.length + mismatched.length + unknown.length,
  };
}

/** How many mismatched sessions are named individually before the list is cut. */
const MISMATCH_DETAIL_LIMIT = 8;

/**
 * Render the item-space verdict, loudly when it needs to be.
 *
 * The `!!` prefix is deliberate and is the only place in this tool's output that
 * uses one: it survives being skimmed, it survives being pasted into a message,
 * and it sorts to the top of a diff of two runs.
 *
 * Exported so the rescue advice and the two banners can be pinned without
 * needing an audio cache on disk that disagrees with the spine.
 *
 * @param {{which: string, source: string, spine: object[], hash: string, trimmed: number}} space
 * @param {ReturnType<typeof checkItemSpace>} check
 * @param {Map<string, string>} alternatives hash -> the `--items` value producing it
 * @returns {string[]}
 */
export function itemSpaceLines(space, check, alternatives) {
  const lines = [];
  lines.push('# item space');
  lines.push(row('items', space.which));
  lines.push(row('source', space.source));
  lines.push(row('words', `${space.spine.length} of ${SPINE.length} spine words`));
  lines.push(row('hash', space.hash));
  lines.push(
    row(
      'session events',
      `${check.matched.length} matched, ${check.mismatched.length} mismatched, ` +
        `${check.unknown.length} recorded no hash`,
    ),
  );
  if (check.unrecorded.length > 0) {
    lines.push(
      row('unrecorded', `${check.unrecorded.length} sessions served problems and never closed`),
    );
  }

  if (check.mismatched.length > 0) {
    lines.push('');
    lines.push(
      `!! ITEM SPACE MISMATCH — ${check.mismatched.length} of ${check.sessions} sessions were`,
    );
    lines.push('!! played against a DIFFERENT word list than this replay reconstructed. Every');
    lines.push('!! number below is a counterfactual against a game the kid never played.');
    for (const entry of check.mismatched.slice(0, MISMATCH_DETAIL_LIMIT)) {
      const rescue = alternatives.get(entry.recorded);
      const advice = rescue === undefined ? '' : ` — matches --items=${rescue}`;
      lines.push(`!!   ${String(entry.session).padEnd(10)} recorded ${entry.recorded}${advice}`);
    }
    if (check.mismatched.length > MISMATCH_DETAIL_LIMIT) {
      lines.push(`!!   ... and ${check.mismatched.length - MISMATCH_DETAIL_LIMIT} more`);
    }
  }

  if (check.unknown.length > 0) {
    const builds = [...new Set(check.unknown.map((entry) => entry.build ?? '(none)'))].sort();
    lines.push('');
    lines.push(
      `!! ITEM SPACE UNKNOWN for ${check.unknown.length} of ${check.sessions} sessions ` +
        `(build ${builds.join(', ')}).`,
    );
    lines.push('!! Those events predate playable-hash.js, so what word list they were played');
    lines.push('!! against was never recorded and cannot be recovered. This is NOT a match:');
    lines.push('!! the audio cache grew by 401 words on 2026-08-02, so a replay of anything');
    lines.push('!! older than that is probably running against a word list the kid never saw.');
  }

  if (check.sessions === 0) {
    lines.push('');
    lines.push('!! NO SESSION EVENTS in this log, so the item space could not be checked at');
    lines.push('!! all. The word list below is the one on this disk today, and nothing says');
    lines.push('!! it is the one that was played.');
  }

  return lines;
}

// ---------------------------------------------------------------------------
// the math walk
// ---------------------------------------------------------------------------

/**
 * Walk the log and ask the scheduler, at every point a problem was really
 * served, what it would have served under `config`.
 *
 * The model is rebuilt at every step from the events that preceded that step,
 * exactly as the live game re-derives after each completed problem. A single
 * session-start model would not merely blind the success governor — it would
 * score it against the WRONG evidence, so the replay would reproduce a
 * scheduler that never ran.
 *
 * Session history resets on a change of `session`, because the live scheduler's
 * `history` is this session's serves and nothing older.
 *
 * @param {object[]} events already build-filtered, any order
 * @param {object} config the replay table
 * @param {() => number} rng seeded; consumed exactly once per decision
 * @returns {{replayCounts: Map<string, number>, recordedCounts: Map<string, number>,
 *            servedMix: object, decisions: number, sessions: number,
 *            usable: number, unusable: number, model: object}}
 */
export function replayDecisions(events, config, rng) {
  const known = new Set(allFacts().map(factId));

  // The same usability rule mastery.js applies. An event it would drop must not
  // reach `history` either: the scheduler indexes `model.byId` by history id and
  // the contract promises that map is total over exactly these 121 facts.
  const usable = [];
  let unusable = 0;
  for (const event of events) {
    if (event.type !== 'attempt') {
      continue;
    }
    const id = factId({ op: event.op, a: event.a, b: event.b });
    if (!known.has(id) || !Number.isFinite(event.ms)) {
      unusable += 1;
      continue;
    }
    usable.push({ id, event });
  }

  // Stable sort, matching the model's own ordering.
  usable.sort((left, right) => compareTimestamps(left.event.t, right.event.t));

  const replayCounts = new Map();
  const recordedCounts = new Map();
  const servedMix = { cold: 0, warm: 0, hot: 0 };
  for (const id of known) {
    replayCounts.set(id, 0);
    recordedCounts.set(id, 0);
  }

  /** Events from sessions already finished — what the live game loads at start. */
  let past = [];
  /** This session's attempts so far, appended to `past` for each derivation. */
  let sessionEvents = [];
  let history = [];
  let currentSession = null;
  let sessions = 0;
  let decisions = 0;
  let model = deriveMathMastery([], config);

  for (const { id, event } of usable) {
    if (sessions === 0 || event.session !== currentSession) {
      // The live game loads only the tail at session start; matching that keeps
      // the replay faithful on a long log instead of handing the model more
      // history than the running game ever had.
      past = past.concat(sessionEvents);
      if (past.length > config.logTail) {
        past = past.slice(past.length - config.logTail);
      }
      sessionEvents = [];
      history = [];
      currentSession = event.session;
      sessions += 1;
    }

    model = deriveMathMastery(past.concat(sessionEvents), config);

    // The counterfactual: what would this config have served here?
    const picked = factId(pickNextFact(model, history, config, rng));
    replayCounts.set(picked, replayCounts.get(picked) + 1);
    servedMix[model.byId.get(picked).bucket] += 1;
    decisions += 1;

    // Then advance on what actually happened.
    recordedCounts.set(id, recordedCounts.get(id) + 1);
    sessionEvents.push(event);
    history.push(id);
  }

  // The final picture, after every event in the log.
  model = deriveMathMastery(
    usable.map((entry) => entry.event),
    config,
  );

  return {
    replayCounts,
    recordedCounts,
    servedMix,
    decisions,
    sessions,
    usable: usable.length,
    unusable,
    model,
  };
}

// ---------------------------------------------------------------------------
// the spelling walk
// ---------------------------------------------------------------------------

/**
 * Walk a spelling log and ask, at every drill problem really served, what this
 * config would have served instead.
 *
 * The decision procedure is main.js's, restated: a probe every
 * `sessionLength / probesPerSession` problems (and always when the drill set is
 * empty), drawn uniformly from `probePool`; otherwise the core scheduler over
 * the drill set, weighted by typing cost. It is restated rather than imported
 * because main.js is the impure wiring — it owns the DOM, the clock and the
 * network — and the day that changes shape, this walk failing to follow is a
 * visible divergence rather than a silent one.
 *
 * LEARN ATTEMPTS ARE FOLDED IN BUT NOT DECIDED. A learn session's word order
 * comes from `pickLearnFamily`, not from the scheduler, so asking "what would
 * the scheduler have served here" of a learn attempt invents a decision that was
 * never taken. The events still advance the model — `taught` is real evidence —
 * and they still consume no rng, which keeps the drill sequence reproducible
 * whatever mix of modes a sitting held. They join `history` like any other
 * serve, which costs nothing: `history` resets at every session boundary and a
 * session runs in one mode, so a learn attempt never reaches a drill decision.
 *
 * `spine` is the item space, passed in rather than imported for the reason
 * placement.js takes one: the caller has already decided which reconstruction it
 * is defending, and has already said so in the report.
 *
 * @param {object[]} events already build-filtered, any order
 * @param {object} config the replay table
 * @param {() => number} rng seeded; the only nondeterminism
 * @param {object[]} spine the item space to serve from
 * @returns {object}
 */
export function replaySpellingDecisions(events, config, rng, spine) {
  // The FULL space, not `spine`. deriveMastery is keyed by the whole catalogue
  // on purpose — a log written when `said` had no recording still contains
  // attempts on `said`, and narrowing the space here would drop real history the
  // kid earned rather than merely declining to serve the word.
  const known = new Set(spellingSpace.allItems().map((item) => spellingSpace.itemId(item)));
  const servable = new Set(spine.map((entry) => spellingSpace.itemId(entry)));

  const usable = [];
  let unusable = 0;
  for (const event of events) {
    if (event.type !== 'attempt') {
      continue;
    }
    const id = spellingSpace.idFromEvent(event);
    if (id === null || !known.has(id) || !Number.isFinite(event.ms)) {
      unusable += 1;
      continue;
    }
    usable.push({ id, event });
  }

  usable.sort((left, right) => compareTimestamps(left.event.t, right.event.t));

  const replayCounts = new Map();
  const recordedCounts = new Map();
  for (const id of known) {
    replayCounts.set(id, 0);
    recordedCounts.set(id, 0);
  }

  const servedMix = { cold: 0, warm: 0, hot: 0 };

  // As main.js derives it: what matters is the RATIO, and storing both the ratio
  // and the interval is two numbers that can disagree.
  const probeEvery = Math.max(1, Math.round(config.sessionLength / config.probesPerSession));

  let past = [];
  let sessionEvents = [];
  let history = [];
  let currentSession = null;
  let sessions = 0;
  /** Problems served so far in this session — the `index` main.js counts probes by. */
  let indexInSession = 0;
  let probes = 0;
  let drillPicks = 0;
  let learnAttempts = 0;
  /** Decisions where the kid had finished everything and the game would have stopped. */
  let exhausted = 0;

  let model = deriveCoreMastery([], config, spellingSpace);
  let placement = derivePlacement(model, spine, config, hasHomophone);

  for (const { id, event } of usable) {
    if (sessions === 0 || event.session !== currentSession) {
      past = past.concat(sessionEvents);
      if (past.length > config.logTail) {
        past = past.slice(past.length - config.logTail);
      }
      sessionEvents = [];
      history = [];
      currentSession = event.session;
      indexInSession = 0;
      sessions += 1;
    }

    model = deriveCoreMastery(past.concat(sessionEvents), config, spellingSpace);

    if (event.mode === LEARN_MODE) {
      learnAttempts += 1;
    } else {
      placement = derivePlacement(model, spine, config, hasHomophone);

      // `pending` as a fallback for the same reason main.js reads it: a later
      // change to how `drillCap` is applied must not turn into an empty-candidate
      // throw halfway through a session.
      const candidates = placement.drill.length > 0 ? placement.drill : placement.pending;
      const wantsProbe = indexInSession % probeEvery === 0 || candidates.length === 0;

      if (wantsProbe && placement.probePool.length > 0) {
        const picked = placement.probePool[Math.floor(rng() * placement.probePool.length)];
        replayCounts.set(picked, replayCounts.get(picked) + 1);
        servedMix[model.byId.get(picked).bucket] += 1;
        probes += 1;
      } else if (candidates.length > 0) {
        const picked = pickNextItem({
          model,
          history,
          config,
          rng,
          space: spellingSpace,
          candidates,
          itemWeight: (candidateId) =>
            typingCost(model.byId.get(candidateId).item.word, KEYMAP, config),
        });
        replayCounts.set(picked, replayCounts.get(picked) + 1);
        servedMix[model.byId.get(picked).bucket] += 1;
        drillPicks += 1;
      } else {
        // Nothing to drill and nothing to probe: under this config she had
        // finished the catalogue and the live game would have stopped the
        // session. Counted rather than picked, because inventing a serve here
        // would be inventing the one number this tool exists to measure.
        exhausted += 1;
      }
      indexInSession += 1;
    }

    recordedCounts.set(id, recordedCounts.get(id) + 1);
    sessionEvents.push(event);
    history.push(id);
  }

  const allEvents = usable.map((entry) => entry.event);
  model = deriveCoreMastery(allEvents, config, spellingSpace);
  placement = derivePlacement(model, spine, config, hasHomophone);

  return {
    replayCounts,
    recordedCounts,
    servedMix,
    servable,
    probes,
    drillPicks,
    learnAttempts,
    exhausted,
    decisions: probes + drillPicks,
    sessions,
    usable: usable.length,
    unusable,
    model,
    placement,
  };
}

/**
 * Name, per word, which of the five placement sets it landed in.
 *
 * Every word in the item space is in exactly one — that is placement.js's
 * stated invariant, and both bugs found during Wave 1 were words falling
 * through the gaps between sets that did not quite cover. A replay over the
 * whole spine is the cheapest place to see that happen again, so a word in no
 * set is labelled `LOST` rather than left blank.
 *
 * Built as one map rather than asked question by question: `probePool` is most
 * of the spine, and `includes` inside a loop over the spine is the shape that
 * turns a 995-word list into a million comparisons.
 *
 * @param {object} placement
 * @returns {Map<string, string>}
 */
function placementSets(placement) {
  const sets = new Map();
  for (const id of placement.probePool) sets.set(id, 'probe');
  for (const id of placement.pending) sets.set(id, 'pending');
  for (const id of placement.drill) sets.set(id, 'drill');
  for (const id of placement.deferred) sets.set(id, 'deferred');
  for (const id of placement.marked) sets.set(id, 'marked');
  return sets;
}

// ---------------------------------------------------------------------------
// the reports
// ---------------------------------------------------------------------------

/**
 * The header both reports share, so a spelling run and a math run state their
 * experiment in the same shape and in the same column.
 *
 * @param {object} context
 * @returns {string[]}
 */
function headerLines({ game, logPath, log, build, seed, overrides }) {
  return [
    '# replay',
    row('game', game),
    row('log', logPath),
    row('lines', `${log.lines} read, ${log.malformed} malformed skipped`),
    row('build', build === null ? '(all)' : build),
    row('seed', seed),
    row('config', overrides.length === 0 ? '(defaults)' : [...overrides].sort().join(' ')),
  ];
}

/**
 * @param {object[]} filtered build-filtered events
 * @param {object} config
 * @param {() => number} rng
 * @param {object} context for the header
 * @returns {string[]}
 */
function mathReport(filtered, config, rng, context) {
  const result = replayDecisions(filtered, config, rng);

  const bucketTotals = { cold: 0, warm: 0, hot: 0 };
  for (const stats of result.model.byId.values()) {
    bucketTotals[stats.bucket] += 1;
  }

  const lines = headerLines(context);
  lines.push(
    row('events', `${result.usable} usable attempts, ${result.unusable} skipped as unusable`),
  );
  lines.push(row('sessions', result.sessions));
  lines.push(row('decisions', result.decisions));

  lines.push('');
  lines.push('# final bucket distribution (121 facts)');
  for (const bucket of BUCKETS) {
    lines.push(row(bucket, bucketTotals[bucket]));
  }

  lines.push('');
  lines.push('# replayed serve mix, by the bucket the fact held when it was picked');
  for (const bucket of BUCKETS) {
    lines.push(row(bucket, result.servedMix[bucket]));
  }

  lines.push('');
  lines.push('# fact / replayed serves / recorded serves / delta / final bucket');
  for (const fact of allFacts()) {
    const id = factId(fact);
    const replayed = result.replayCounts.get(id);
    const recorded = result.recordedCounts.get(id);
    const delta = replayed - recorded;
    lines.push(
      [
        id.padEnd(10),
        String(replayed).padStart(6),
        String(recorded).padStart(6),
        `${delta >= 0 ? '+' : ''}${delta}`.padStart(6),
        `  ${result.model.byId.get(id).bucket}`,
      ].join(''),
    );
  }

  return lines;
}

/** Column width for a spelling word. The longest spine word is well inside this. */
const WORD_WIDTH = 16;

/**
 * @param {object[]} filtered build-filtered events
 * @param {object} config
 * @param {() => number} rng
 * @param {object} context for the header
 * @param {string|null} items the --items value, or null for the default
 * @returns {string[]}
 */
function spellingReport(filtered, config, rng, context, items) {
  const space = spellingItemSpace(items ?? ITEM_SPACES[0]);

  // Every reconstruction this tool can offer, so a mismatch can say which one
  // WOULD have matched instead of only that this one did not. Cheap — two hashes
  // over a 995-word list — and it is the difference between "your replay is
  // wrong" and "re-run it with --items=spine".
  const alternatives = new Map(
    ITEM_SPACES.map((which) => [spellingItemSpace(which).hash, which]),
  );

  const check = checkItemSpace(filtered, space.hash);
  const result = replaySpellingDecisions(filtered, config, rng, space.spine);

  const bucketTotals = { cold: 0, warm: 0, hot: 0 };
  for (const id of result.servable) {
    bucketTotals[result.model.byId.get(id).bucket] += 1;
  }

  const lines = headerLines(context);
  lines.push(
    row('events', `${result.usable} usable attempts, ${result.unusable} skipped as unusable`),
  );
  lines.push(row('sessions', result.sessions));
  lines.push(
    row('decisions', `${result.decisions} (${result.drillPicks} drill, ${result.probes} probe)`),
  );
  lines.push(
    row('learn', `${result.learnAttempts} attempts folded in, not replayed as decisions`),
  );
  if (result.exhausted > 0) {
    lines.push(
      row('exhausted', `${result.exhausted} problems with nothing left to drill or probe`),
    );
  }

  lines.push('');
  lines.push(...itemSpaceLines(space, check, alternatives));

  const placement = result.placement;
  const accounted =
    placement.marked.size +
    placement.deferred.size +
    placement.drill.length +
    placement.pending.length +
    placement.probePool.length;

  lines.push('');
  lines.push('# placement after the whole log — the five sets that partition the item space');
  lines.push(row('cursor', placement.cursor));
  lines.push(row('marked', placement.marked.size));
  lines.push(row('drill', placement.drill.length));
  lines.push(row('pending', placement.pending.length));
  lines.push(row('deferred', placement.deferred.size));
  lines.push(row('probePool', placement.probePool.length));
  lines.push(
    row(
      'accounted for',
      `${accounted} of ${space.spine.length}` +
        (accounted === space.spine.length ? '' : '  !! the sets no longer partition the spine'),
    ),
  );

  lines.push('');
  lines.push(`# final bucket distribution (${space.spine.length} playable words)`);
  for (const bucket of BUCKETS) {
    lines.push(row(bucket, bucketTotals[bucket]));
  }

  lines.push('');
  lines.push('# replayed serve mix, by the bucket the word held when it was picked');
  for (const bucket of BUCKETS) {
    lines.push(row(bucket, result.servedMix[bucket]));
  }

  lines.push('');
  lines.push('# word / replayed serves / recorded serves / delta / final bucket / placement');
  const sets = placementSets(placement);
  for (const entry of space.spine) {
    const id = spellingSpace.itemId(entry);
    const replayed = result.replayCounts.get(id);
    const recorded = result.recordedCounts.get(id);
    const delta = replayed - recorded;
    lines.push(
      [
        entry.word.padEnd(WORD_WIDTH),
        String(replayed).padStart(6),
        String(recorded).padStart(6),
        `${delta >= 0 ? '+' : ''}${delta}`.padStart(6),
        `  ${result.model.byId.get(id).bucket.padEnd(6)}`,
        sets.get(id) ?? 'LOST',
      ].join(''),
    );
  }

  return lines;
}

/**
 * Run a replay and render the report. Returns the exact text the CLI prints, so
 * a test can assert byte-identity across two runs without spawning a process.
 *
 * @param {{logPath?: string|null, game?: string|null, items?: string|null,
 *          build?: string|null, seed?: number, overrides?: string[]}} options
 * @returns {{text: string, code: number}}
 */
export function replay(options) {
  const build = options.build ?? null;
  const seed = options.seed ?? DEFAULT_SEED;
  const overrides = options.overrides ?? [];
  const items = options.items ?? null;
  const requestedGame = options.game ?? null;

  // Which log depends on the game; which game depends on the log. The knot is
  // untied in this order: an explicit --game names its own default log, and
  // otherwise the historical default (math) stands so an existing invocation
  // with no arguments at all keeps meaning what it meant.
  const logPath =
    options.logPath ?? GAMES[requestedGame ?? 'math'].defaultLog;

  const log = readLog(logPath);

  if (log.missing) {
    return {
      text: `No log at ${logPath} — nothing to replay. That is a first run, not an error.`,
      code: 0,
    };
  }

  const filtered = build === null ? log.events : log.events.filter((e) => e.build === build);
  const attempts = filtered.filter((e) => e.type === 'attempt');

  // Before the game is worked out, deliberately. A log with nothing readable in
  // it cannot say which game it belongs to, and "which game is this?" is a worse
  // answer to give someone than "there is nothing here yet".
  if (attempts.length === 0) {
    const scope = build === null ? '' : ` for build ${build}`;
    return {
      text:
        `No attempt events${scope} in ${logPath} ` +
        `(${log.lines} line${log.lines === 1 ? '' : 's'} read, ${log.malformed} malformed) — ` +
        'nothing to replay. That is a first run, not an error.',
      code: 0,
    };
  }

  const game = requestedGame ?? detectGame(log.events, logPath);
  if (items !== null && game !== 'spelling') {
    throw new Error(`--items applies to the spelling replay only; this is a ${game} log.`);
  }

  const config = configWithOverrides(overrides, GAMES[game].config);
  const rng = mulberry32(seed);
  const context = { game, logPath, log, build, seed, overrides };
  const lines =
    game === 'spelling'
      ? spellingReport(filtered, config, rng, context, items)
      : mathReport(filtered, config, rng, context);

  return { text: lines.join('\n'), code: 0 };
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    return 1;
  }

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  let result;
  try {
    result = replay(options);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }

  process.stdout.write(`${result.text}\n`);
  return result.code;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
