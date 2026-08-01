#!/usr/bin/env node
// Offline replay of the scheduler against real collected history.
//
// The whole system is shaped so this file can exist: `mastery` and `scheduler`
// are pure functions over the log and `rng` is injected, so history already in
// hand can be re-run under a DIFFERENT tunables table without shipping that
// table to a child first (spec §12). The question answered here is not "what
// does the log say" — it is "if I retune the weights or the thresholds, what
// would actually have happened differently".
//
// So the output is built for COMPARISON, not description:
//
//   - every one of the 121 facts gets a line, in `allFacts()` order, whether or
//     not it was served. Two runs then differ only in the numbers that changed,
//     and `diff a.txt b.txt` reads as a list of effects rather than a list of
//     insertions.
//   - each line also carries what the log RECORDED, so a single run already
//     answers "would have been served 14x instead of 6x".
//   - the header echoes the seed, the build filter and the overrides, so a diff
//     of two runs states its own experiment.
//
// WHAT IS BEING COUNTERFACTUALISED. At every point where a problem was really
// served, the model and the session history are reconstructed as they stood at
// that moment, and the scheduler is asked what IT would have served under the
// replay config. That pick is counted; then the RECORDED attempt is folded in
// and the walk moves on. It has to work this way round: a fully divergent
// simulation would immediately be picking facts for which the log holds no
// outcome, so the model could not advance and every number after the first
// divergence would be invented rather than measured.
//
// This is a Node script and is deliberately NOT part of math-game/js/. It may
// read argv and the filesystem. It never writes anything, and it never mutates
// the imported CONFIG — the replay table is a deep copy.
//
// Usage:
//   node tools/replay.js [logPath] [--build=m1] [--seed=N] [--config=k=v,...]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { CONFIG } from '../math-game/js/config.js';
import { allFacts, factId } from '../math-game/js/facts.js';
import { deriveMastery } from '../math-game/js/mastery.js';
import { pickNext } from '../math-game/js/scheduler.js';
// The SAME generator the scheduler suite uses. Two independently written PRNGs
// would make a replay result unreproducible from the tests that validated the
// scheduler, and the divergence would be silent.
import { mulberry32 } from '../math-game/js/rng.js';

const DEFAULT_LOG = 'data/math-log.jsonl';
const DEFAULT_SEED = 1;
const BUCKETS = ['cold', 'warm', 'hot'];
const LABEL_WIDTH = 16;

const USAGE = [
  'Usage: node tools/replay.js [logPath] [--build=TAG] [--seed=N] [--config=key=value,...]',
  '',
  `  logPath          JSONL event log; defaults to ${DEFAULT_LOG}`,
  '  --build=TAG      replay only events carrying this build tag',
  `  --seed=N         seed for the replay generator; defaults to ${DEFAULT_SEED}`,
  '  --config=...     comma-separated CONFIG overrides for this replay only,',
  '                   e.g. --config=hotMs=1200,noRepeatWithin=6,weights.cold=8',
  '',
  'Output is one line per fact in a stable order, so two runs can be compared',
  'with diff. Nothing is ever written to disk.',
].join('\n');

// Enough of ISO 8601 to know the value is orderable as a plain string. Mirrors
// mastery.js, which is not merely a coincidence to be tidied away: the replay
// must walk the log in exactly the order the model derives it in, or the model
// handed to a decision is not the model that stood at that moment.
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Order two log timestamps, oldest first. Undatable events sort to the front,
 * the oldest slot, where they cannot displace a real attempt out of a window.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {number}
 */
function compareTimestamps(left, right) {
  const leftOk = typeof left === 'string' && ISO_TIMESTAMP_PATTERN.test(left);
  const rightOk = typeof right === 'string' && ISO_TIMESTAMP_PATTERN.test(right);
  if (!leftOk && !rightOk) {
    return 0;
  }
  if (!leftOk) {
    return -1;
  }
  if (!rightOk) {
    return 1;
  }
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/**
 * Parse argv into replay options. Throws on anything it does not recognise —
 * a mistyped flag that silently did nothing would make a comparison report a
 * change that was never applied, which is worse than no tool at all.
 *
 * @param {string[]} argv arguments after the script name
 * @returns {{logPath: string, build: string|null, seed: number, overrides: string[], help: boolean}}
 */
export function parseArgs(argv) {
  let logPath = null;
  let build = null;
  let seed = DEFAULT_SEED;
  let overrides = [];
  let help = false;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      help = true;
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

  return { logPath: logPath ?? DEFAULT_LOG, build, seed, overrides, help };
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
 * A deep copy of CONFIG with the given `key=value` overrides applied. The
 * imported CONFIG is never touched — every other module in the process shares
 * that object, and a replay that mutated it would change the meaning of its own
 * later comparisons.
 *
 * Dotted paths reach nested tables: `weights.cold=8`, `delays.hot=7000`.
 * An unknown key is an error, never a silent no-op.
 *
 * @param {string[]} overrides
 * @returns {object}
 */
export function configWithOverrides(overrides) {
  const config = structuredClone(CONFIG);

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
  let model = deriveMastery([], config);

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

    model = deriveMastery(past.concat(sessionEvents), config);

    // The counterfactual: what would this config have served here?
    const picked = factId(pickNext(model, history, config, rng));
    replayCounts.set(picked, replayCounts.get(picked) + 1);
    servedMix[model.byId.get(picked).bucket] += 1;
    decisions += 1;

    // Then advance on what actually happened.
    recordedCounts.set(id, recordedCounts.get(id) + 1);
    sessionEvents.push(event);
    history.push(id);
  }

  // The final picture, after every event in the log.
  model = deriveMastery(
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

/**
 * Run a replay and render the report. Returns the exact text the CLI prints, so
 * a test can assert byte-identity across two runs without spawning a process.
 *
 * @param {{logPath: string, build?: string|null, seed?: number, overrides?: string[]}} options
 * @returns {{text: string, code: number}}
 */
export function replay(options) {
  const { logPath } = options;
  const build = options.build ?? null;
  const seed = options.seed ?? DEFAULT_SEED;
  const overrides = options.overrides ?? [];

  const config = configWithOverrides(overrides);
  const log = readLog(logPath);

  if (log.missing) {
    return {
      text: `No log at ${logPath} — nothing to replay. That is a first run, not an error.`,
      code: 0,
    };
  }

  const filtered = build === null ? log.events : log.events.filter((e) => e.build === build);
  const attempts = filtered.filter((e) => e.type === 'attempt');

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

  const rng = mulberry32(seed);
  const result = replayDecisions(filtered, config, rng);

  const bucketTotals = { cold: 0, warm: 0, hot: 0 };
  for (const stats of result.model.byId.values()) {
    bucketTotals[stats.bucket] += 1;
  }

  const lines = [];
  lines.push('# replay');
  lines.push(row('log', logPath));
  lines.push(row('lines', `${log.lines} read, ${log.malformed} malformed skipped`));
  lines.push(row('build', build === null ? '(all)' : build));
  lines.push(row('seed', seed));
  lines.push(row('config', overrides.length === 0 ? '(defaults)' : [...overrides].sort().join(' ')));
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
