#!/usr/bin/env node
// The Merriam-Webster ingest — run by hand, never at play time.
//
// This fills two caches that the game reads and never writes:
//   data/audio/<word>.mp3    the pronunciation the drill plays
//   data/words/<word>.json   the short definition and usage sentence learn mode shows
//
// Both are gitignored. M-W's terms forbid duplicating or redistributing their
// data, so committing a cache to a repo with a public origin would be
// redistribution. We ship this script; each clone brings its own key and builds
// its own cache. The game is fully playable with neither — spelling-game/js/audio.js
// falls back to the browser's own speech synthesis (spec §5).
//
// THE AUDIO BASENAME IS NOT DERIVABLE FROM THE WORD. It comes back in the API
// response as `prs[].sound.audio` and diverges from the spelling for homographs
// and multi-entry words. The open CDN therefore does not enable scraping: it is
// a keyless fetch that only becomes possible AFTER the authenticated lookup. The
// subdirectory is then chosen by a rule on that basename, not on the word — see
// `audioSubdir`. Getting that rule wrong fails as a silent 404, which is why it
// is a pure exported function with its own tests.
//
// RESUMABLE BY DESIGN. The spine is ~1050 words against a cap of 1000 queries
// per day per reference, so a full ingest is a two-evening job and an interrupted
// run is the normal case, not the exceptional one. A word whose JSON is already
// on disk costs no API call at all.
//
// This is a Node script and is deliberately not part of spelling-game/js/. It may
// read argv, the environment, the network and the filesystem — everything the
// pure modules may not.
//
// Usage:
//   MW_KEY=... node tools/fetch-words.js [--limit=N] [--words=a,b,c] [--dry-run]

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

/**
 * Every quantity and every endpoint, in one table.
 *
 * The two reference codes are the one thing here most likely to need changing:
 * M-W issues a separate key per registered reference, so `sd2` (Elementary,
 * grades 3–5) and `sd3` (Intermediate, grades 6–8) are two products with two
 * keys. `MW_KEY` alone is enough to run — the intermediate pass is simply
 * skipped unless its own key is present — which keeps the documented one-variable
 * setup working while allowing the doubled 2000/day budget for anyone who
 * registers both (spec §5).
 */
const CONFIG = {
  references: [
    { name: 'elementary', code: 'sd2', keyEnv: 'MW_KEY' },
    { name: 'intermediate', code: 'sd3', keyEnv: 'MW_KEY_INTERMEDIATE' },
  ],
  apiBase: 'https://www.dictionaryapi.com/api/v3/references',
  audioBase: 'https://media.merriam-webster.com/audio/prons/en/us/mp3',
  // Sequential requests with a gap between them. Nothing here is in a hurry —
  // this is an overnight job against someone else's free tier.
  requestDelayMs: 250,
  wordsDir: join(REPO_ROOT, 'data', 'words'),
  audioDir: join(REPO_ROOT, 'data', 'audio'),
  spineModule: '../spelling-game/js/spine.js',
  // A word reaches the filesystem as a filename, so it is checked against this
  // rather than trusted. The spine contract already promises lowercase a–z with
  // no spaces or punctuation; this is the guard that makes the promise binding.
  safeWord: /^[a-z]+$/,
};

const USAGE = [
  'Usage: MW_KEY=<key> node tools/fetch-words.js [options]',
  '',
  '  --limit=N        stop after N words are newly fetched (the daily cap is 1000)',
  '  --words=a,b,c    fetch only these words, ignoring the spine',
  '  --dry-run        say what would be fetched; make no requests and write nothing',
  '  --help           this message',
  '',
  'Reads the word list from spelling-game/js/spine.js and writes',
  'data/words/<word>.json and data/audio/<word>.mp3. Both are gitignored.',
  '',
  'Already-cached words are skipped, so re-running after an interruption or a',
  'rate limit resumes where it stopped and costs no API calls for what it has.',
  '',
  'Get a free key at https://dictionaryapi.com/register/index — this project ships',
  'no key and every clone brings its own. Set MW_KEY_INTERMEDIATE as well if you',
  'registered the Intermediate dictionary too; it is used as a fallback.',
].join('\n');

// --- pure rules -----------------------------------------------------------
// Everything below this line to the next banner is a pure function of its
// arguments. These are the parts that fail silently when wrong — a bad
// subdirectory is a 404, a bad headword match is the wrong word's audio — so
// they are exported and tested rather than buried in the fetch loop.

/**
 * The subdirectory a pronunciation file lives in, from its basename.
 *
 * M-W's own rule, verified against their documentation (spec §5): `bix` and `gg`
 * are carve-outs that predate the alphabetical scheme, anything not starting
 * with a letter is bucketed under `number`, and everything else goes under its
 * own first letter. The rule reads the BASENAME, never the word — `friend` and
 * `bass:2` do not necessarily agree on their first character.
 *
 * @param {unknown} basename the `prs[].sound.audio` value from the API
 * @returns {string | null} null when there is nothing usable to derive from
 */
export function audioSubdir(basename) {
  if (typeof basename !== 'string' || basename.length === 0) {
    return null;
  }
  if (basename.startsWith('bix')) {
    return 'bix';
  }
  if (basename.startsWith('gg')) {
    return 'gg';
  }
  const first = basename[0];
  if (!/[a-zA-Z]/.test(first)) {
    return 'number';
  }
  return first.toLowerCase();
}

/**
 * The full CDN URL for a pronunciation basename.
 *
 * No key is involved: the audio files are open. The key bought us the basename,
 * one step earlier.
 *
 * @param {unknown} basename
 * @param {{audioBase: string}} [config]
 * @returns {string | null} null when the basename is unusable
 */
export function audioUrlFor(basename, config = CONFIG) {
  const subdir = audioSubdir(basename);
  if (subdir === null) {
    return null;
  }
  return `${config.audioBase}/${subdir}/${basename}.mp3`;
}

/**
 * The lookup URL for one word against one reference.
 *
 * The key is a query parameter, so this string must never be logged, echoed or
 * written to a file. Nothing in this script does — errors report the status and
 * the reference name, never the URL.
 *
 * @param {string} word
 * @param {string} referenceCode e.g. 'sd2'
 * @param {string} key
 * @param {{apiBase: string}} [config]
 * @returns {string}
 */
export function apiUrlFor(word, referenceCode, key, config = CONFIG) {
  return (
    `${config.apiBase}/${referenceCode}/json/${encodeURIComponent(word)}` +
    `?key=${encodeURIComponent(key)}`
  );
}

/**
 * Is this word safe to use as a filename?
 *
 * @param {unknown} word
 * @param {{safeWord: RegExp}} [config]
 * @returns {boolean}
 */
export function isSafeWord(word, config = CONFIG) {
  return typeof word === 'string' && config.safeWord.test(word);
}

/**
 * The entry that is actually about this word.
 *
 * Two shapes have to be handled. A miss returns an ARRAY OF STRINGS — M-W's
 * spelling suggestions — which is easy to mistake for a list of entries and
 * would then be read as an entry object with no fields. A hit returns entries
 * for every headword that matched, including derived ones: asking for `friend`
 * can return `friendly` alongside it, and asking for `read` returns `read:1` and
 * `read:2`. Taking entries[0] blindly is how the wrong word's audio ends up
 * cached under the right word's name.
 *
 * The homograph number after the colon is dropped deliberately: `read:1` and
 * `read:2` are both the word, and the first one listed is M-W's own primary
 * sense.
 *
 * @param {unknown} body the parsed API response
 * @param {string} word
 * @returns {object | null}
 */
export function selectEntry(body, word) {
  if (!Array.isArray(body)) {
    return null;
  }
  for (const entry of body) {
    if (entry === null || typeof entry !== 'object') {
      continue; // a suggestion string, not an entry
    }
    const id = typeof entry.meta?.id === 'string' ? entry.meta.id.split(':')[0] : null;
    // `hwi.hw` carries syllable dots — `fri*end` — which are display markup.
    const headword =
      typeof entry.hwi?.hw === 'string' ? entry.hwi.hw.replaceAll('*', '') : null;
    if (id?.toLowerCase() === word || headword?.toLowerCase() === word) {
      return entry;
    }
  }
  return null;
}

/**
 * The pronunciation basename for an entry, or null when it has none.
 *
 * Only the headword's own pronunciation counts. A recursive search of the whole
 * entry would happily return the audio for an inflected form or a variant
 * spelling buried in a sense — `friends` cached as `friend` — and the failure
 * would be inaudible in review because it still plays something plausible.
 *
 * @param {object | null} entry
 * @returns {string | null}
 */
export function pronunciationOf(entry) {
  const lists = [entry?.hwi?.prs, entry?.hwi?.altprs];
  for (const list of lists) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const pronunciation of list) {
      const basename = pronunciation?.sound?.audio;
      if (typeof basename === 'string' && basename.length > 0) {
        return basename;
      }
    }
  }
  return null;
}

/**
 * Plain text from one of M-W's marked-up strings.
 *
 * Their text carries formatting and cross-reference tokens in braces. A usage
 * sentence rendered raw reads `{it}friend{/it}` to a six-year-old, so the markup
 * is resolved here rather than in a screen.
 *
 * Link tokens are pipe-separated and their display text is not always in the
 * same position: `{d_link|display|id}` shows the first argument, while
 * `{sx|target|id|display}` shows the third if it is present. Cross-reference
 * blocks are dropped whole — they point at other entries and mean nothing
 * without them.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function stripTokens(text) {
  if (typeof text !== 'string') {
    return '';
  }
  return text
    // Whole blocks that only make sense as links to other entries.
    .replaceAll(/\{dx\}.*?\{\/dx\}/gs, '')
    .replaceAll(/\{ma\}.*?\{\/ma\}/gs, '')
    .replaceAll(/\{dx_ety\}.*?\{\/dx_ety\}/gs, '')
    // `{bc}` is M-W's "bold colon" — the divider before a definition.
    .replaceAll('{bc}', ': ')
    .replaceAll('{ldquo}', '“')
    .replaceAll('{rdquo}', '”')
    // Link tokens, replaced by whatever they display.
    .replaceAll(/\{(sx|dxt|dx_def)\|([^}]*)\}/g, (_match, _token, args) => {
      const parts = args.split('|');
      return parts[2] || parts[0] || '';
    })
    .replaceAll(/\{(a_link|d_link|i_link|et_link|mat)\|([^}]*)\}/g, (_match, _token, args) => {
      return args.split('|')[0] || '';
    })
    // Anything left is a formatting tag with no text of its own.
    .replaceAll(/\{[^}]*\}/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/**
 * The first usage sentence in an entry, or null.
 *
 * `vis` — "verbal illustration" — is nested at an unpredictable depth inside
 * `def[].sseq`, because senses nest inside sense sequences inside divided
 * senses. Walking for the first `['vis', [...]]` pair is robust to that
 * structure changing shape between entries, which it does constantly.
 *
 * @param {object | null} entry
 * @returns {string | null}
 */
export function firstUsage(entry) {
  const raw = findVisText(entry?.def ?? null);
  if (raw === null) {
    return null;
  }
  const text = stripTokens(raw);
  return text.length > 0 ? text : null;
}

/**
 * Depth-first search for the first verbal-illustration text.
 *
 * @param {unknown} node
 * @returns {string | null}
 */
function findVisText(node) {
  if (Array.isArray(node)) {
    if (node.length === 2 && node[0] === 'vis' && Array.isArray(node[1])) {
      for (const illustration of node[1]) {
        if (typeof illustration?.t === 'string' && illustration.t.length > 0) {
          return illustration.t;
        }
      }
    }
    for (const child of node) {
      const found = findVisText(child);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) {
      const found = findVisText(value);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

/**
 * The cache record for one word, built from one API entry.
 *
 * Note what is NOT stored: the lookup URL, because it carries the key. The
 * audio URL that IS stored is the open CDN one.
 *
 * @param {string} word
 * @param {object} entry
 * @param {string} referenceName
 * @param {string} fetchedAt ISO 8601 UTC
 * @param {object} [config]
 * @returns {object}
 */
export function buildRecord(word, entry, referenceName, fetchedAt, config = CONFIG) {
  const audio = pronunciationOf(entry);
  return {
    word,
    reference: referenceName,
    audio,
    audioUrl: audio === null ? null : audioUrlFor(audio, config),
    shortdef: Array.isArray(entry.shortdef)
      ? entry.shortdef.map((definition) => stripTokens(definition)).filter((d) => d.length > 0)
      : [],
    usage: firstUsage(entry),
    fetchedAt,
  };
}

// --- the run --------------------------------------------------------------
// Below here the script talks to the environment, the network and the disk.

/**
 * Parse argv. An unrecognised flag is an error, never a silent no-op — a
 * mistyped `--limit` that quietly fetched the whole spine would burn the day's
 * quota before anyone noticed.
 *
 * @param {string[]} argv arguments after the script name
 * @returns {{limit: number, words: string[] | null, dryRun: boolean, help: boolean}}
 */
export function parseArgs(argv) {
  let limit = Infinity;
  let words = null;
  let dryRun = false;
  let help = false;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`--limit must be a positive whole number, got: ${arg.slice(8)}`);
      }
      limit = value;
    } else if (arg.startsWith('--words=')) {
      words = arg
        .slice('--words='.length)
        .split(',')
        .map((word) => word.trim().toLowerCase())
        .filter((word) => word.length > 0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { limit, words, dryRun, help };
}

/**
 * The word list, from the spine.
 *
 * Imported dynamically rather than at module load so that the pure rules above
 * stay importable — and testable — whether or not the spine exists yet.
 *
 * @returns {Promise<string[]>}
 */
async function loadSpine() {
  let module;
  try {
    module = await import(CONFIG.spineModule);
  } catch (error) {
    throw new Error(
      `Could not read the word spine from ${CONFIG.spineModule}: ${error.message}`,
    );
  }
  if (!Array.isArray(module.SPINE)) {
    throw new Error(`${CONFIG.spineModule} does not export a SPINE array`);
  }
  return module.SPINE.map((entry) => entry.word);
}

function wordPath(word) {
  return join(CONFIG.wordsDir, `${word}.json`);
}

function audioPath(word) {
  return join(CONFIG.audioDir, `${word}.mp3`);
}

/**
 * What still needs doing for one word.
 *
 * Three states, and the middle one is what makes an interrupted run cheap to
 * resume: a word whose JSON is cached never costs another API call, even if its
 * mp3 download is the thing that failed. A word M-W has no audio for is recorded
 * as `audio: null` and is then permanently done, rather than being retried on
 * every future run.
 *
 * @param {string} word
 * @returns {'done' | 'audio-only' | 'all'}
 */
function workFor(word) {
  if (!existsSync(wordPath(word))) {
    return 'all';
  }
  let record;
  try {
    record = JSON.parse(readFileSync(wordPath(word), 'utf8'));
  } catch {
    return 'all'; // a truncated write from an interrupted run — do it again
  }
  if (record.audio === null || record.audio === undefined) {
    return 'done';
  }
  return existsSync(audioPath(word)) ? 'done' : 'audio-only';
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Raised when the account is out of quota or the key is refused. It stops the
 * whole run rather than the current word: with 1000 requests a day, continuing
 * past the first refusal would burn the rest of the list on identical failures
 * and make the next run's resume point wrong.
 */
class QuotaError extends Error {}

/**
 * Look one word up in one reference.
 *
 * @param {string} word
 * @param {{code: string, name: string, key: string}} reference
 * @returns {Promise<object | null>} the matching entry, or null for a miss
 */
async function lookup(word, reference) {
  const response = await fetch(apiUrlFor(word, reference.code, reference.key));

  if (response.status === 429) {
    throw new QuotaError(
      `The ${reference.name} reference is rate limited (429). The cap is 1000 queries ` +
        'per day per reference — stop here and re-run tomorrow. Everything fetched so ' +
        'far is cached and will be skipped.',
    );
  }
  if (response.status === 403 || response.status === 401) {
    throw new QuotaError(
      `The ${reference.name} reference refused the key (${response.status}). That is ` +
        'either a wrong key or a day\'s quota already spent. Check the key at ' +
        'https://dictionaryapi.com/account/my-keys.',
    );
  }
  if (!response.ok) {
    // A one-off server-side failure. Report it and move on; the word simply
    // stays uncached and the next run picks it up.
    process.stderr.write(`  ${word}: ${reference.name} returned ${response.status}\n`);
    return null;
  }

  let body;
  try {
    body = await response.json();
  } catch {
    process.stderr.write(`  ${word}: ${reference.name} returned a non-JSON body\n`);
    return null;
  }

  return selectEntry(body, word);
}

/**
 * Download one pronunciation into the audio cache.
 *
 * @param {string} url
 * @param {string} word
 * @returns {Promise<boolean>} whether a file was written
 */
async function downloadAudio(url, word) {
  const response = await fetch(url);
  if (!response.ok) {
    // The commonest cause is the subdirectory rule having been applied wrongly,
    // which is exactly why it is a tested pure function. Say the URL out loud so
    // a 404 is diagnosable rather than merely counted.
    process.stderr.write(`  ${word}: audio ${response.status} for ${url}\n`);
    return false;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(audioPath(word), bytes);
  return true;
}

/**
 * Fetch one word: look it up, cache the record, then cache the audio.
 *
 * @param {string} word
 * @param {{code: string, name: string, key: string}[]} references
 * @param {'all' | 'audio-only'} work
 * @returns {Promise<{record: object | null, audio: boolean}>}
 */
async function fetchWord(word, references, work) {
  if (work === 'audio-only') {
    const record = JSON.parse(readFileSync(wordPath(word), 'utf8'));
    const url = record.audioUrl ?? audioUrlFor(record.audio);
    const audio = url === null ? false : await downloadAudio(url, word);
    return { record, audio };
  }

  // Elementary first, Intermediate only if Elementary does not have the word.
  // The older kid drifting past Elementary's ceiling is the case this exists for.
  for (const reference of references) {
    const entry = await lookup(word, reference);
    if (entry === null) {
      await sleep(CONFIG.requestDelayMs);
      continue;
    }
    const record = buildRecord(word, entry, reference.name, new Date().toISOString());
    writeFileSync(wordPath(word), `${JSON.stringify(record, null, 2)}\n`);
    const audio = record.audioUrl === null ? false : await downloadAudio(record.audioUrl, word);
    return { record, audio };
  }

  return { record: null, audio: false };
}

/**
 * The references that actually have a key. Elementary is required; Intermediate
 * is a bonus for anyone who registered it (see CONFIG).
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{code: string, name: string, key: string}[]}
 */
export function referencesFrom(env) {
  const available = [];
  for (const reference of CONFIG.references) {
    const key = env[reference.keyEnv];
    if (typeof key === 'string' && key.trim().length > 0) {
      available.push({ code: reference.code, name: reference.name, key: key.trim() });
    }
  }
  return available;
}

async function main(argv, env) {
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

  const references = referencesFrom(env);
  if (references.length === 0) {
    process.stderr.write(
      'No MW_KEY in the environment.\n\n' +
        'This project ships no API key and never will — it is open source, and every\n' +
        'clone brings its own. Register a free key for the Elementary Dictionary at\n' +
        'https://dictionaryapi.com/register/index and then:\n\n' +
        '  MW_KEY=your-key node tools/fetch-words.js\n\n' +
        'You do not need one to play. Without a cache the game speaks each word with\n' +
        "the browser's own voice, which is the default experience and works today.\n",
    );
    return 1;
  }

  let words;
  try {
    words = options.words ?? (await loadSpine());
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }

  const unsafe = words.filter((word) => !isSafeWord(word));
  if (unsafe.length > 0) {
    process.stderr.write(
      `Refusing to run: these are not lowercase a–z and would name a file — ${unsafe.join(', ')}\n`,
    );
    return 1;
  }

  const pending = words.filter((word) => workFor(word) !== 'done');
  const todo = pending.slice(0, options.limit);

  process.stdout.write(
    `${words.length} words in the list, ${words.length - pending.length} already cached, ` +
      `${todo.length} to fetch now.\n` +
      `References: ${references.map((r) => r.name).join(', ')}.\n`,
  );

  if (options.dryRun) {
    process.stdout.write(`Dry run — nothing fetched, nothing written.\n`);
    return 0;
  }
  if (todo.length === 0) {
    return 0;
  }

  mkdirSync(CONFIG.wordsDir, { recursive: true });
  mkdirSync(CONFIG.audioDir, { recursive: true });

  let cached = 0;
  let withAudio = 0;
  let missing = 0;

  for (const word of todo) {
    let result;
    try {
      result = await fetchWord(word, references, workFor(word));
    } catch (error) {
      if (error instanceof QuotaError) {
        process.stderr.write(`\n${error.message}\n`);
        break;
      }
      // A dropped connection mid-run. Report and continue: the word stays
      // uncached and the next run collects it.
      process.stderr.write(`  ${word}: ${error.message}\n`);
      await sleep(CONFIG.requestDelayMs);
      continue;
    }

    if (result.record === null) {
      missing += 1;
      process.stdout.write(`  ${word}: not in either reference\n`);
    } else {
      cached += 1;
      if (result.audio) {
        withAudio += 1;
      }
    }

    await sleep(CONFIG.requestDelayMs);
  }

  process.stdout.write(
    `\nCached ${cached} words, ${withAudio} with audio. ${missing} not found.\n` +
      'Re-run to continue; anything already cached is skipped.\n',
  );
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
