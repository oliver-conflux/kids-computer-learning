#!/usr/bin/env node
// Score a word list on every metric we can compute, and sort by any of them.
//
// THIS TOOL DECIDES NOTHING. It measures, prints, and stops. Which metrics
// matter and how they combine is a curriculum question, and the point of
// separating them is that the weighting can be argued about — and changed —
// without re-deriving anything. Every column here is a fact about the word; the
// policy lives in the game.
//
// Usage:
//   node tools/word-metrics.js                        the shipped spine
//   node tools/word-metrics.js --list=path/to/words    one word per line, in rank order
//   node tools/word-metrics.js --sort=syllables,letters
//   node tools/word-metrics.js --band=4                only the fourth hundred
//   node tools/word-metrics.js --format=tsv            for a spreadsheet
//
// A Node script, deliberately not part of spelling-game/js/. It may read argv,
// the filesystem and the clock; the game's modules may not.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

import { patternsFor, IRREGULAR } from '../spelling-game/js/patterns.js';
import { CONFIG } from '../spelling-game/js/config.js';
import { typingCost, KEYMAP } from '../core/typing-cost.js';

// Piping into `head` or `less` closes stdout early, and Node's default is to
// throw EPIPE and print a stack trace over the output you were reading. For a
// tool whose whole job is to print a thousand rows you will want to page, that
// is the normal case, not an error.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const USAGE = [
  'Usage: node tools/word-metrics.js [options]',
  '',
  '  --list=PATH     word list, one per line in rank order (default: the shipped spine)',
  '  --sort=A,B,C    sort by these columns, first key wins (default: rank)',
  '  --desc          sort descending',
  '  --band=N        only words in the Nth hundred',
  '  --limit=N       print at most N rows',
  '  --format=FMT    table (default) | tsv | json',
  '  --summary       per-band aggregates instead of per-word rows',
  '  --help',
  '',
  'Columns: rank band letters syllables doubles irregular patterns typing',
].join('\n');

/**
 * Syllable count, by vowel groups with a silent-e correction.
 *
 * APPROXIMATE AND KNOWN TO BE. English syllabification needs a pronunciation
 * dictionary to do properly — `every` is two syllables in speech and three by
 * this rule, `fire` is arguable to a linguist and settled to a seven-year-old.
 * It is here because it is the cheapest signal that separates `cat` from
 * `sometimes`, which is the distinction that matters for banding, and it is
 * WRONG IN THE SAME DIRECTION for every word, so comparisons hold even where
 * absolute counts do not.
 *
 * If this ever needs to be right rather than consistent, the M-W record already
 * fetched has the respelling — see docs/next-steps.md.
 *
 * @param {string} word
 * @returns {number} at least 1
 */
export function syllablesIn(word) {
  const groups = word.match(/[aeiouy]+/g);
  let count = groups === null ? 0 : groups.length;
  // A final `e` after a consonant is silent: `make`, `time`, `come`.
  if (count > 1 && /[^aeiou]e$/.test(word)) {
    count -= 1;
  }
  return Math.max(count, 1);
}

/**
 * Does the word contain a doubled letter?
 *
 * A real spelling trap and a cheap one to measure. `letter`, `little`, `off`,
 * `will` — knowing that a consonant doubles is a decision the speller has to
 * make and cannot hear, which is exactly the kind of difficulty that audio
 * prompting does nothing to help with.
 *
 * @param {string} word
 * @returns {boolean}
 */
export function hasDoubleLetter(word) {
  return /(.)\1/.test(word);
}

/**
 * Every metric for one word.
 *
 * `rank` is the position in the list as given, and `band` is its hundred —
 * `ceil(rank / 100)`. The band is the load-bearing one: measured against our
 * independently-written spine, exact Fry ranks agreed 6% of the time and bands
 * agreed 98%, so the hundred is signal and the position inside it is noise.
 *
 * @param {string} word
 * @param {number} rank 1-based
 * @returns {object}
 */
export function metricsFor(word, rank) {
  const patterns = patternsFor(word);
  return {
    word,
    rank,
    band: Math.ceil(rank / 100),
    letters: word.length,
    syllables: syllablesIn(word),
    doubles: hasDoubleLetter(word) ? 1 : 0,
    irregular: patterns.includes(IRREGULAR) ? 1 : 0,
    patterns: patterns.join('|'),
    // The existing keyboard dial, reused rather than reinvented: it already
    // knows about hand alternation, row travel and finger repeats.
    typing: Number(typingCost(word, KEYMAP, CONFIG).toFixed(3)),
  };
}

function parseArgs(argv) {
  const options = {
    list: null, sort: ['rank'], desc: false, band: null,
    limit: Infinity, format: 'table', summary: false, help: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--desc') options.desc = true;
    else if (arg === '--summary') options.summary = true;
    else if (arg.startsWith('--list=')) options.list = arg.slice(7);
    else if (arg.startsWith('--sort=')) options.sort = arg.slice(7).split(',').filter(Boolean);
    else if (arg.startsWith('--band=')) options.band = Number.parseInt(arg.slice(7), 10);
    else if (arg.startsWith('--limit=')) options.limit = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith('--format=')) options.format = arg.slice(9);
    else throw new Error(`Unrecognised option: ${arg}`);
  }
  return options;
}

/** Words in rank order, from a file or from the shipped spine. */
async function loadWords(listPath) {
  if (listPath === null) {
    const { SPINE } = await import('../spelling-game/js/spine.js');
    return SPINE.map((entry) => entry.word);
  }
  const full = resolve(REPO_ROOT, listPath);
  if (!existsSync(full)) {
    throw new Error(`No such list: ${full}`);
  }
  return readFileSync(full, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function printTable(rows) {
  const columns = ['word', 'rank', 'band', 'letters', 'syllables', 'doubles', 'irregular', 'typing', 'patterns'];
  const width = Object.fromEntries(
    columns.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c]).length))]),
  );
  const line = (cells) => cells.map((cell, i) => String(cell).padEnd(width[columns[i]])).join('  ');
  process.stdout.write(line(columns) + '\n');
  process.stdout.write(columns.map((c) => '-'.repeat(width[c])).join('  ') + '\n');
  for (const row of rows) {
    process.stdout.write(line(columns.map((c) => row[c])) + '\n');
  }
}

function printSummary(rows) {
  const bands = new Map();
  for (const row of rows) {
    if (!bands.has(row.band)) bands.set(row.band, []);
    bands.get(row.band).push(row);
  }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  process.stdout.write('band    n   letters  syllables  %doubles  %irregular  typing\n');
  process.stdout.write('----  ---  -------  ---------  --------  ----------  ------\n');
  for (const band of [...bands.keys()].sort((a, b) => a - b)) {
    const group = bands.get(band);
    process.stdout.write(
      String(band).padEnd(4) + '  ' +
      String(group.length).padStart(3) + '  ' +
      mean(group.map((r) => r.letters)).toFixed(2).padStart(7) + '  ' +
      mean(group.map((r) => r.syllables)).toFixed(2).padStart(9) + '  ' +
      (100 * mean(group.map((r) => r.doubles))).toFixed(0).padStart(7) + '%  ' +
      (100 * mean(group.map((r) => r.irregular))).toFixed(0).padStart(9) + '%  ' +
      mean(group.map((r) => r.typing)).toFixed(3).padStart(6) + '\n',
    );
  }
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

  let words;
  try {
    words = loadWordsSync(options.list);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }

  let rows = words.map((word, index) => metricsFor(word, index + 1));
  if (options.band !== null) {
    rows = rows.filter((row) => row.band === options.band);
  }

  rows.sort((left, right) => {
    for (const key of options.sort) {
      const a = left[key];
      const b = right[key];
      if (a === undefined || b === undefined) continue;
      const cmp = typeof a === 'string' ? a.localeCompare(b) : a - b;
      if (cmp !== 0) return options.desc ? -cmp : cmp;
    }
    return left.rank - right.rank;
  });

  if (Number.isFinite(options.limit)) {
    rows = rows.slice(0, options.limit);
  }

  if (options.summary) printSummary(rows);
  else if (options.format === 'json') process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  else if (options.format === 'tsv') {
    const columns = ['word', 'rank', 'band', 'letters', 'syllables', 'doubles', 'irregular', 'typing', 'patterns'];
    process.stdout.write(columns.join('\t') + '\n');
    for (const row of rows) process.stdout.write(columns.map((c) => row[c]).join('\t') + '\n');
  } else printTable(rows);

  return 0;
}

// Loading the spine needs `await`, so resolve it before main runs and hand main
// a synchronous reader. Keeps main a plain function that a test can call.
let loadWordsSync = () => [];
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const listArg = argv.find((a) => a.startsWith('--list='));
  const preloaded = await loadWords(listArg === undefined ? null : listArg.slice(7)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
  loadWordsSync = () => preloaded;
  process.exitCode = main(argv);
}
