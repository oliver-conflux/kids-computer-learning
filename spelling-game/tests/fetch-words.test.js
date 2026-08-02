// Tests for the Merriam-Webster ingest's pure rules.
//
// NOTHING HERE TOUCHES THE NETWORK. `fetch` is replaced below with a function
// that throws, for the whole file, so a test that reached for it would fail
// loudly rather than quietly depending on someone's API key, someone's quota and
// someone's internet connection. The rules being tested are exactly the ones
// that fail silently in production — a wrong subdirectory is a 404, a wrong
// headword match caches the wrong word's voice — so they are the ones worth
// pinning offline.

import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.fetch = () => {
  throw new Error('a test in this file tried to use the network');
};

import {
  audioSubdir,
  audioUrlFor,
  apiUrlFor,
  isSafeWord,
  selectEntry,
  pronunciationOf,
  stripTokens,
  firstUsage,
  buildRecord,
  parseArgs,
  referencesFrom,
} from '../../tools/fetch-words.js';

const AUDIO_BASE = 'https://media.merriam-webster.com/audio/prons/en/us/mp3';

// --- the subdirectory rule ------------------------------------------------

test('audioSubdir: an ordinary basename goes under its first letter', () => {
  assert.equal(audioSubdir('friend'), 'f');
  assert.equal(audioSubdir('cat'), 'c');
  assert.equal(audioSubdir('zebra01'), 'z');
});

test('audioSubdir: bix and gg are carve-outs that beat the first letter', () => {
  assert.equal(audioSubdir('bixby'), 'bix');
  assert.equal(audioSubdir('bix001'), 'bix');
  assert.equal(audioSubdir('gg001'), 'gg');
  assert.equal(audioSubdir('gguard'), 'gg');
  // The prefix must be checked before the first letter, not after: both of
  // these would otherwise land under 'b' and 'g' and 404.
  assert.notEqual(audioSubdir('bixby'), 'b');
  assert.notEqual(audioSubdir('gg001'), 'g');
});

test('audioSubdir: a leading number or punctuation goes under number', () => {
  assert.equal(audioSubdir('3d001'), 'number');
  assert.equal(audioSubdir('007'), 'number');
  assert.equal(audioSubdir('_test'), 'number');
  assert.equal(audioSubdir("'tis"), 'number');
});

test('audioSubdir: the directory is lowercase whatever the basename is', () => {
  assert.equal(audioSubdir('Friend'), 'f');
});

test('audioSubdir: nothing usable yields null rather than throwing', () => {
  assert.equal(audioSubdir(''), null);
  assert.equal(audioSubdir(null), null);
  assert.equal(audioSubdir(undefined), null);
  assert.equal(audioSubdir(42), null);
});

// --- the URL --------------------------------------------------------------

test('audioUrlFor: builds the full CDN path from the basename', () => {
  assert.equal(audioUrlFor('friend'), `${AUDIO_BASE}/f/friend.mp3`);
  assert.equal(audioUrlFor('bixby'), `${AUDIO_BASE}/bix/bixby.mp3`);
  assert.equal(audioUrlFor('gg001'), `${AUDIO_BASE}/gg/gg001.mp3`);
  assert.equal(audioUrlFor('3d001'), `${AUDIO_BASE}/number/3d001.mp3`);
});

test('audioUrlFor: the basename is used verbatim, not the word', () => {
  // This is the whole point of the rule. M-W's basename for a homograph carries
  // a suffix the word does not have, and deriving the URL from the word instead
  // would 404 on exactly the words most worth having audio for.
  assert.equal(audioUrlFor('read01'), `${AUDIO_BASE}/r/read01.mp3`);
});

test('audioUrlFor: an unusable basename yields null', () => {
  assert.equal(audioUrlFor(''), null);
  assert.equal(audioUrlFor(null), null);
});

test('apiUrlFor: the key is a query parameter and the word is encoded', () => {
  assert.equal(
    apiUrlFor('friend', 'sd2', 'abc-123'),
    'https://www.dictionaryapi.com/api/v3/references/sd2/json/friend?key=abc-123',
  );
  assert.match(apiUrlFor('friend', 'sd3', 'k'), /\/sd3\/json\//);
});

// --- the filename guard ---------------------------------------------------

test('isSafeWord: only lowercase a-z may name a file', () => {
  assert.equal(isSafeWord('friend'), true);
  assert.equal(isSafeWord('../etc/passwd'), false);
  assert.equal(isSafeWord('Friend'), false);
  assert.equal(isSafeWord('ice cream'), false);
  assert.equal(isSafeWord("don't"), false);
  assert.equal(isSafeWord(''), false);
  assert.equal(isSafeWord(null), false);
});

// --- picking the right entry ----------------------------------------------

test('selectEntry: a miss returns suggestion strings, not entries', () => {
  assert.equal(selectEntry(['freind', 'friends', 'fried'], 'friend'), null);
  assert.equal(selectEntry([], 'friend'), null);
  assert.equal(selectEntry(null, 'friend'), null);
});

test('selectEntry: skips entries for other headwords', () => {
  const body = [
    { meta: { id: 'friendly' }, hwi: { hw: 'friend*ly' } },
    { meta: { id: 'friend' }, hwi: { hw: 'friend' } },
  ];
  assert.equal(selectEntry(body, 'friend').meta.id, 'friend');
});

test('selectEntry: takes the first homograph of the word', () => {
  const body = [
    { meta: { id: 'read:1' }, hwi: { hw: 'read' } },
    { meta: { id: 'read:2' }, hwi: { hw: 'read' } },
  ];
  assert.equal(selectEntry(body, 'read').meta.id, 'read:1');
});

test('selectEntry: matches on the syllable-dotted headword when there is no id', () => {
  const body = [{ hwi: { hw: 'ele*phant' } }];
  assert.equal(selectEntry(body, 'elephant').hwi.hw, 'ele*phant');
});

test('selectEntry: no entry is about this word', () => {
  const body = [{ meta: { id: 'cat' }, hwi: { hw: 'cat' } }];
  assert.equal(selectEntry(body, 'dog'), null);
});

// --- pronunciations -------------------------------------------------------

test('pronunciationOf: reads the headword pronunciation', () => {
  const entry = { hwi: { prs: [{ sound: { audio: 'friend' } }] } };
  assert.equal(pronunciationOf(entry), 'friend');
});

test('pronunciationOf: falls back to altprs', () => {
  const entry = { hwi: { altprs: [{ sound: { audio: 'ration02' } }] } };
  assert.equal(pronunciationOf(entry), 'ration02');
});

test('pronunciationOf: skips pronunciation records that carry no sound', () => {
  const entry = { hwi: { prs: [{ mw: 'ˈfrend' }, { sound: { audio: 'friend' } }] } };
  assert.equal(pronunciationOf(entry), 'friend');
});

test('pronunciationOf: ignores audio buried in senses and variants', () => {
  // A recursive search would find `friends01` here and cache it as the
  // pronunciation of `friend`. It still plays a real word, which is why this
  // has to be a test rather than something review would notice.
  const entry = {
    hwi: { hw: 'friend' },
    def: [{ sseq: [[['sense', { prs: [{ sound: { audio: 'friends01' } }] }]]] }],
  };
  assert.equal(pronunciationOf(entry), null);
});

test('pronunciationOf: a word with no audio at all', () => {
  assert.equal(pronunciationOf({ hwi: { hw: 'the' } }), null);
  assert.equal(pronunciationOf(null), null);
});

// --- text ----------------------------------------------------------------

test('stripTokens: formatting tags leave only their text', () => {
  assert.equal(stripTokens('a {it}friend{/it} of mine'), 'a friend of mine');
  assert.equal(stripTokens('{wi}friend{/wi}ly'), 'friendly');
});

test('stripTokens: bold colon becomes a colon', () => {
  assert.equal(stripTokens('{bc}a person you like'), ': a person you like');
});

test('stripTokens: link tokens leave what they display', () => {
  assert.equal(stripTokens('see {d_link|elephant|elephant:1}'), 'see elephant');
  assert.equal(stripTokens('{sx|comrade||}'), 'comrade');
  assert.equal(stripTokens('{sx|comrade|comrade:1|buddy}'), 'buddy');
  assert.equal(stripTokens('{a_link|friendly}'), 'friendly');
});

test('stripTokens: cross-reference blocks are dropped whole', () => {
  assert.equal(stripTokens('a pal {dx}see also {dxt|chum||}{/dx}').trim(), 'a pal');
});

test('stripTokens: quotes and whitespace', () => {
  assert.equal(stripTokens('{ldquo}hi{rdquo}'), '“hi”');
  assert.equal(stripTokens('  a   b  '), 'a b');
  assert.equal(stripTokens(null), '');
});

test('firstUsage: finds the illustration wherever it is nested', () => {
  const entry = {
    def: [
      {
        sseq: [
          [
            [
              'sense',
              {
                dt: [
                  ['text', '{bc}a person you like'],
                  ['vis', [{ t: 'She is my best {it}friend{/it}.' }]],
                ],
              },
            ],
          ],
        ],
      },
    ],
  };
  assert.equal(firstUsage(entry), 'She is my best friend.');
});

test('firstUsage: no illustration is null, not an empty string', () => {
  assert.equal(firstUsage({ def: [{ sseq: [[['sense', { dt: [['text', 'a thing']] }]]] }] }), null);
  assert.equal(firstUsage({}), null);
  assert.equal(firstUsage(null), null);
});

// --- the cache record -----------------------------------------------------

test('buildRecord: assembles what the game reads and nothing else', () => {
  const entry = {
    meta: { id: 'friend' },
    hwi: { hw: 'friend', prs: [{ sound: { audio: 'friend' } }] },
    shortdef: ['a person who you like and enjoy being with'],
    def: [{ sseq: [[['sense', { dt: [['vis', [{ t: 'my best {it}friend{/it}' }]]] }]]] }],
  };
  const record = buildRecord('friend', entry, 'elementary', '2026-08-02T12:00:00.000Z');

  assert.deepEqual(record, {
    word: 'friend',
    reference: 'elementary',
    audio: 'friend',
    audioUrl: `${AUDIO_BASE}/f/friend.mp3`,
    shortdef: ['a person who you like and enjoy being with'],
    usage: 'my best friend',
    fetchedAt: '2026-08-02T12:00:00.000Z',
  });
});

test('buildRecord: never writes a key into the cache', () => {
  const entry = { hwi: { prs: [{ sound: { audio: 'friend' } }] }, shortdef: ['x'] };
  const record = buildRecord('friend', entry, 'elementary', '2026-08-02T12:00:00.000Z');
  assert.equal(JSON.stringify(record).includes('key='), false);
});

test('buildRecord: a word with no audio records null and stays resumable', () => {
  // `audio: null` is what tells a later run this word is finished rather than
  // half-done, so it is never looked up twice.
  const entry = { meta: { id: 'the' }, hwi: { hw: 'the' }, shortdef: [] };
  const record = buildRecord('the', entry, 'elementary', '2026-08-02T12:00:00.000Z');
  assert.equal(record.audio, null);
  assert.equal(record.audioUrl, null);
});

// --- the CLI --------------------------------------------------------------

test('parseArgs: defaults', () => {
  assert.deepEqual(parseArgs([]), { limit: Infinity, words: null, dryRun: false, help: false });
});

test('parseArgs: flags', () => {
  assert.equal(parseArgs(['--limit=20']).limit, 20);
  assert.deepEqual(parseArgs(['--words=cat,dog']).words, ['cat', 'dog']);
  assert.equal(parseArgs(['--dry-run']).dryRun, true);
  assert.equal(parseArgs(['--help']).help, true);
});

test('parseArgs: a mistyped flag is an error, never a silent no-op', () => {
  assert.throws(() => parseArgs(['--limits=20']), /Unknown option/);
  assert.throws(() => parseArgs(['--limit=0']), /positive whole number/);
  assert.throws(() => parseArgs(['--limit=abc']), /positive whole number/);
});

test('referencesFrom: MW_KEY alone is enough to run', () => {
  const references = referencesFrom({ MW_KEY: 'k1' });
  assert.equal(references.length, 1);
  assert.equal(references[0].name, 'elementary');
  assert.equal(references[0].code, 'sd2');
});

test('referencesFrom: the intermediate key adds a fallback, in that order', () => {
  const references = referencesFrom({ MW_KEY: 'k1', MW_KEY_INTERMEDIATE: 'k2' });
  assert.deepEqual(
    references.map((reference) => reference.name),
    ['elementary', 'intermediate'],
  );
});

test('referencesFrom: no key means no references, which is how the run refuses', () => {
  assert.deepEqual(referencesFrom({}), []);
  assert.deepEqual(referencesFrom({ MW_KEY: '   ' }), []);
});
