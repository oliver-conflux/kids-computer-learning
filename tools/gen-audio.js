#!/usr/bin/env node
// Regenerate data/audio/ — every spine word, spoken, from our own TTS.
//
// WHY THIS EXISTS AND fetch-words.js NO LONGER RUNS. The game used to speak with
// Merriam-Webster recordings. They are human and good, but M-W has no recording
// for irregular inflections — it files pronunciation on the base headword — so
// `is`, `was`, `said`, `had`, `been` and 32 others came back with an entry and
// no audio. Those are among the most frequent words in English, and in drill
// mode a word we cannot say is not a degraded word, it is an unanswerable one.
// The API was also rate-limited, keyed, and its output could not be committed.
//
// Generating our own removes all four problems at once: full coverage, one
// consistent voice, no key, and audio we are allowed to redistribute — which is
// why data/audio/ is now tracked. See spelling-game/docs/audio-sourcing.md.
//
// WHERE THE WORK HAPPENS. Kokoro-82M runs on the GPU box, not here; this script
// is the orchestration. The remote setup is documented in ~/speech/README.md on
// that machine — two venvs, phoneme pinning, citation-form promotion, and why
// each of those is load-bearing.
//
// Usage:
//   node tools/gen-audio.js                 regenerate everything
//   node tools/gen-audio.js --dry-run       show what would run
//   SPEECH_HOST=otherbox node tools/gen-audio.js
//
// A Node script, deliberately not part of spelling-game/js/. It may read argv,
// the filesystem, the network and the clock; the game's modules may not.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

import { SPINE } from '../spelling-game/js/spine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const AUDIO_DIR = join(REPO_ROOT, 'data', 'audio');

const HOST = process.env.SPEECH_HOST ?? 'msibox';
const REMOTE = '~/speech';
const VOICE = process.env.SPEECH_VOICE ?? 'af_heart';

const dryRun = process.argv.includes('--dry-run');

function run(command, args, { capture = false } = {}) {
  if (dryRun) {
    process.stdout.write(`would run: ${command} ${args.join(' ')}\n`);
    return '';
  }
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Check a manifest the way the remote README says to.
 *
 * Two invariants, and BOTH are things no human ear would catch at 995 words:
 *
 *   - nothing drifted: what the carrier actually said, minus the carrier itself,
 *     is what we pinned. Kokoro normalises text before phonemising it, and the
 *     carrier gives it context to normalise wrongly — "Spell the word. am." once
 *     came out as the time abbreviation, ˌAˈɛm.
 *   - nothing is still reduced: every pinned form carries primary stress.
 *     English reduces function words, so `is`, `was`, `had` render swallowed;
 *     correct for conversation, wrong when a child is asked to spell them.
 *
 * A THIRD CHECK, AND IT EXISTS BECAUSE THE SECOND ONE WAS NOT ENOUGH. `than`
 * passed the stress check as ðˈən and was still wrong: stress promotion adds the
 * mark, it cannot restore the vowel, so a reduced word comes out STRESSED and
 * still reduced. English does not put primary stress on a schwa, so ˈə or ˈɐ is
 * a reliable tell. Whisper heard that file as "then" — which is itself a spine
 * word, so a child spelling what she heard would have been marked wrong.
 *
 * @param {object[]} manifest
 * @returns {{drift: object[], reduced: object[], schwa: object[], short: object[], promoted: number}}
 */
export function auditManifest(manifest) {
  const CARRIER_PHONEMES = /^spˈɛl ðə wˈɜɹd\./;
  const spoken = (entry) =>
    String(entry.phonemes ?? '').trim().replace(CARRIER_PHONEMES, '').trim().replace(/\.$/, '').trim();

  return {
    drift: manifest.filter((entry) => spoken(entry) !== (entry.pin_phonemes ?? '')),
    reduced: manifest.filter((entry) => !String(entry.pin_phonemes ?? '').includes('ˈ')),
    schwa: manifest.filter((entry) => /ˈ[əɐ]/.test(entry.pin_phonemes ?? '')),
    short: manifest.filter((entry) => !entry.seconds || entry.seconds < 0.6),
    promoted: manifest.filter((entry) => entry.stress_promoted).length,
  };
}

function main() {
  const words = SPINE.map((entry) => entry.word);
  const listPath = join(REPO_ROOT, 'data', 'spine-words.txt');
  mkdirSync(join(REPO_ROOT, 'data'), { recursive: true });
  if (!dryRun) {
    writeFileSync(listPath, words.join('\n') + '\n');
  }
  process.stdout.write(`${words.length} spine words -> ${HOST}\n`);

  run('scp', ['-q', listPath, `${HOST}:${REMOTE}/spine-words.txt`]);
  run('ssh', [HOST,
    `export PATH=$HOME/speech/bin:$HOME/.local/bin:$PATH; ` +
    `rm -rf ${REMOTE}/out/spine && mkdir -p ${REMOTE}/out/spine && ` +
    `speech-say --words-file ${REMOTE}/spine-words.txt --carrier --voice ${VOICE} ` +
    `--out ${REMOTE}/out/spine --format mp3 >/dev/null`,
  ]);

  mkdirSync(AUDIO_DIR, { recursive: true });
  run('rsync', ['-q', '-e', 'ssh', `${HOST}:${REMOTE}/out/spine/*.mp3`, AUDIO_DIR + '/']);

  const manifestPath = join(REPO_ROOT, 'data', 'audio-manifest.json');
  run('scp', ['-q', `${HOST}:${REMOTE}/out/spine/manifest.json`, manifestPath]);
  if (dryRun) {
    return 0;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const { drift, reduced, schwa, short, promoted } = auditManifest(manifest);
  const have = new Set(
    readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.mp3')).map((f) => f.replace(/\.mp3$/, '')),
  );
  const missing = words.filter((word) => !have.has(word));

  process.stdout.write(
    `\n${have.size} mp3s in data/audio\n` +
      `  stress promoted:    ${promoted}\n` +
      `  carrier drift:      ${drift.length}${drift.length ? ' -> ' + drift.map((d) => d.word).join(' ') : ' ok'}\n` +
      `  still reduced:      ${reduced.length}${reduced.length ? ' -> ' + reduced.map((d) => d.word).join(' ') : ' ok'}\n` +
      `  stressed schwa:     ${schwa.length}${schwa.length ? ' -> ' + schwa.map((d) => d.word).join(' ') : ' ok'}\n` +
      `  suspiciously short: ${short.length}${short.length ? ' -> ' + short.map((d) => d.word).join(' ') : ' ok'}\n` +
      `  spine words unsaid: ${missing.length}${missing.length ? ' -> ' + missing.join(' ') : ' ok'}\n`,
  );

  const failed = drift.length + reduced.length + schwa.length + short.length + missing.length;
  if (failed > 0) {
    process.stderr.write('\nAudit failed. Do not commit this run.\n');
  }
  return failed > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
