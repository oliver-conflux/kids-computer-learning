// Replay tool tests, spelling half. The math half lives in
// math-game/tests/replay.test.js and pins determinism and the override
// mechanism; nothing here restates those.
//
// What this file exists for is the trap in docs/next-steps.md item 6. The
// spelling game's word list is built from the mp3s in the audio cache, which is
// not a function of the log, so a replay run today can reconstruct a word list
// the kid never played against — silently, and 401 words wrong. The report has
// to notice and say so. A replay that quietly assumed today's cache is the
// failure this tool was ported to close, so the tests that matter most below are
// the ones asserting the tool refuses to be confident.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  replay,
  parseArgs,
  detectGame,
  checkItemSpace,
  itemSpaceLines,
  audioWordsOnDisk,
  spellingItemSpace,
  configWithOverrides,
} from '../../tools/replay.js';
import { CONFIG } from '../js/config.js';
import { SPINE } from '../js/spine.js';
import { playableHash } from '../js/playable-hash.js';

/** A temp directory that cleans itself up. Nothing is ever written to data/. */
function withTempDir(body) {
  const dir = mkdtempSync(join(tmpdir(), 'replay-spelling-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One spelling AttemptEvent, fields per the shared contract. */
function attempt({ word, ms = 2000, stage = 'clean', session = 's_0001', t, mode = 'drill', build = 's2' }) {
  return {
    type: 'attempt',
    t,
    build,
    session,
    word,
    patterns: [],
    ms,
    stage,
    typed: [],
    wrong: [],
    mode,
  };
}

function sessionEvent({ session = 's_0001', t, build = 's2', hash, count }) {
  const event = { type: 'session', t, build, session, mode: 'drill', items: 20, cleanRate: 1 };
  if (hash !== undefined) {
    event.playableHash = hash;
    event.playableCount = count ?? 995;
  }
  return event;
}

function writeLog(dir, events, name = 'spelling-log.jsonl') {
  const path = join(dir, name);
  writeFileSync(path, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
  return path;
}

/** A minute-spaced clock, so events sort the way they were written. */
function clock() {
  let minute = 0;
  return () => `2026-08-03T10:${String(minute++).padStart(2, '0')}:00.000Z`;
}

/** Enough of a session to make the walk do all three things it can do. */
function syntheticEvents(count = 24) {
  const at = clock();
  const events = [];
  for (let index = 0; index < count; index += 1) {
    events.push(
      attempt({
        word: SPINE[index % 40].word,
        ms: 1500 + (index % 4) * 1200,
        stage: index % 3 === 0 ? 'r1' : 'clean',
        session: index < count / 2 ? 's_0001' : 's_0002',
        t: at(),
      }),
    );
  }
  return events;
}

// --- the trap ---------------------------------------------------------------

test('a session recorded against a different word list is reported loudly', () => {
  withTempDir((dir) => {
    const at = clock();
    const path = writeLog(dir, [
      ...syntheticEvents(6),
      sessionEvent({ session: 's_0001', t: at(), hash: 'deadbeef.594' }),
      sessionEvent({ session: 's_0002', t: at(), hash: 'deadbeef.594' }),
    ]);

    const text = replay({ logPath: path }).text;

    assert.match(text, /ITEM SPACE MISMATCH/);
    assert.match(text, /2 of 2 sessions/);
    assert.match(text, /deadbeef\.594/, 'the recorded hash is named, not just counted');
    assert.match(text, /^session events\s+0 matched, 2 mismatched/m);
  });
});

test('a session that recorded no hash reads as unknown, never as agreement', () => {
  // Every event in the real log today is build s1 and predates playable-hash.js.
  // "0 matched" is the honest answer; anything that looked like a tick here would
  // be the original bug wearing a checkmark.
  withTempDir((dir) => {
    const at = clock();
    const path = writeLog(dir, [
      ...syntheticEvents(6),
      sessionEvent({ session: 's_0001', t: at(), build: 's1' }),
      sessionEvent({ session: 's_0002', t: at(), build: 's1' }),
    ]);

    const text = replay({ logPath: path }).text;

    assert.match(text, /ITEM SPACE UNKNOWN for 2 of 2 sessions \(build s1\)/);
    assert.match(text, /^session events\s+0 matched, 0 mismatched, 2 recorded no hash$/m);
    assert.doesNotMatch(text, /ITEM SPACE MISMATCH/);
  });
});

test('a session recorded against the list this replay reconstructed is a match', () => {
  withTempDir((dir) => {
    const at = clock();
    const hash = spellingItemSpace('playable').hash;
    const path = writeLog(dir, [
      ...syntheticEvents(6),
      sessionEvent({ session: 's_0001', t: at(), hash }),
      sessionEvent({ session: 's_0002', t: at(), hash }),
    ]);

    const text = replay({ logPath: path }).text;

    assert.match(text, /^session events\s+2 matched, 0 mismatched, 0 recorded no hash$/m);
    assert.doesNotMatch(text, /^!!/m, 'a fully matched replay has nothing to shout about');
  });
});

test('a log with no session events at all cannot be checked, and says so', () => {
  withTempDir((dir) => {
    const path = writeLog(dir, syntheticEvents(6));
    const text = replay({ logPath: path }).text;
    assert.match(text, /NO SESSION EVENTS/);
  });
});

test('checkItemSpace keeps matched, mismatched, unknown and unrecorded apart', () => {
  const events = [
    { type: 'attempt', session: 's_1', word: 'at' },
    { type: 'attempt', session: 's_4', word: 'cat' },
    { type: 'session', session: 's_1', playableHash: 'aaaa.10' },
    { type: 'session', session: 's_2', playableHash: 'bbbb.20' },
    { type: 'session', session: 's_3', build: 's1' },
  ];

  const check = checkItemSpace(events, 'aaaa.10');

  assert.deepEqual(check.matched.map((e) => e.session), ['s_1']);
  assert.deepEqual(check.mismatched.map((e) => e.session), ['s_2']);
  assert.deepEqual(check.unknown.map((e) => e.session), ['s_3']);
  // s_4 served problems and never closed, so nothing anywhere records its list.
  assert.deepEqual(check.unrecorded, ['s_4']);
  assert.equal(check.sessions, 3);
});

test('an empty-string hash is unknown, not a mismatch', () => {
  const check = checkItemSpace([{ type: 'session', session: 's_1', playableHash: '' }], 'aaaa.10');
  assert.equal(check.unknown.length, 1);
  assert.equal(check.mismatched.length, 0);
});

test('a mismatch names the item space that would have matched instead', () => {
  const space = { which: 'playable', source: 'a cache', spine: [], hash: 'aaaa.10', trimmed: 0 };
  const check = checkItemSpace(
    [{ type: 'session', session: 's_1', playableHash: 'bbbb.20' }],
    space.hash,
  );

  const lines = itemSpaceLines(space, check, new Map([['bbbb.20', 'spine']])).join('\n');
  assert.match(lines, /matches --items=spine/);

  // With no reconstruction to offer, it must not invent one.
  const bare = itemSpaceLines(space, check, new Map()).join('\n');
  assert.match(bare, /ITEM SPACE MISMATCH/);
  assert.doesNotMatch(bare, /matches --items=/);
});

// --- the item space itself --------------------------------------------------

test('the item space is the audio cache filtered through playableSpine', () => {
  withTempDir((dir) => {
    for (const name of ['at.mp3', 'cat.mp3', 'NOTAWORD.mp3', 'readme.txt', 'hat.mp3']) {
      writeFileSync(join(dir, name), '', 'utf8');
    }
    assert.deepEqual(audioWordsOnDisk(dir), ['at', 'cat', 'hat']);

    const space = spellingItemSpace('playable', dir);
    assert.deepEqual(space.spine.map((entry) => entry.word), ['at', 'cat', 'hat']);
    assert.equal(space.hash, playableHash(['at', 'cat', 'hat']));
    assert.equal(space.trimmed, SPINE.length - 3);
  });
});

test('a missing audio cache reads as empty rather than throwing', () => {
  assert.deepEqual(audioWordsOnDisk(join(tmpdir(), 'no-such-cache-8f3a')), []);
});

test('--items=spine is the whole catalogue, cache or no cache', () => {
  const space = spellingItemSpace('spine');
  assert.equal(space.spine.length, SPINE.length);
  assert.equal(space.hash, playableHash(SPINE.map((entry) => entry.word)));
  assert.equal(space.trimmed, 0);
});

// --- which game a log belongs to -------------------------------------------

test('the log says which game it is, not the filename', () => {
  const spelling = [{ type: 'attempt', word: 'cat', ms: 1 }];
  const math = [{ type: 'attempt', op: '*', a: 6, b: 7, ms: 1 }];

  // A log copied somewhere for an experiment is still the log it always was.
  assert.equal(detectGame(spelling, '/tmp/scratch.jsonl'), 'spelling');
  assert.equal(detectGame(math, '/tmp/scratch.jsonl'), 'math');
  assert.equal(detectGame(spelling, 'data/math-log.jsonl'), 'spelling');
});

test('the filename is consulted only when there is nothing to read', () => {
  assert.equal(detectGame([], 'data/spelling-log.jsonl'), 'spelling');
  assert.equal(detectGame([{ type: 'session' }], 'data/math-log.jsonl'), 'math');
  assert.throws(() => detectGame([], '/tmp/mystery.jsonl'), /Cannot tell which game/);
});

test('two logs concatenated is refused rather than resolved', () => {
  const mixed = [
    { type: 'attempt', word: 'cat', ms: 1 },
    { type: 'attempt', op: '*', a: 6, b: 7, ms: 1 },
  ];
  assert.throws(() => detectGame(mixed, 'data/spelling-log.jsonl'), /more than one game/);
});

test('a spelling log replays without being told which game it is', () => {
  withTempDir((dir) => {
    const path = writeLog(dir, syntheticEvents());
    const text = replay({ logPath: path }).text;
    assert.match(text, /^game\s+spelling$/m);
    assert.match(text, /^# placement after the whole log/m);
  });
});

// --- arguments --------------------------------------------------------------

test('argv parsing covers the spelling usage', () => {
  const options = parseArgs([
    'data/spelling-log.jsonl',
    '--game=spelling',
    '--items=spine',
    '--seed=9',
    '--config=probeMargin=0,drillCap=10',
  ]);
  assert.equal(options.logPath, 'data/spelling-log.jsonl');
  assert.equal(options.game, 'spelling');
  assert.equal(options.items, 'spine');
  assert.equal(options.seed, 9);
  assert.deepEqual(options.overrides, ['probeMargin=0', 'drillCap=10']);
});

test('an unknown game or item space is an error, not a silent default', () => {
  assert.throws(() => parseArgs(['--game=geography']), /--game must be one of/);
  assert.throws(() => parseArgs(['--items=everything']), /--items must be one of/);
});

test('no log path at all leaves the default to be resolved from the game', () => {
  const options = parseArgs([]);
  assert.equal(options.logPath, null);
  assert.equal(options.game, null);
  assert.equal(options.items, null);
});

test('--items is refused on a math log rather than quietly ignored', () => {
  withTempDir((dir) => {
    const path = writeLog(dir, [
      { type: 'attempt', t: '2026-08-03T10:00:00.000Z', op: '*', a: 6, b: 7, ms: 900, stage: 'clean', session: 's_1' },
    ]);
    assert.throws(() => replay({ logPath: path, items: 'spine' }), /spelling replay only/);
  });
});

// --- the config is the spelling table ---------------------------------------

test('overrides are checked against the spelling table, not math\'s', () => {
  const config = configWithOverrides(['probeMargin=0', 'drillCap=10'], CONFIG);
  assert.equal(config.probeMargin, 0);
  assert.equal(config.drillCap, 10);
  assert.equal(CONFIG.probeMargin, 60, 'the shipped table must not be mutated');

  // `probeMargin` exists in no math table, and a key that exists in neither is
  // an error either way.
  assert.throws(() => configWithOverrides(['windowSize=20'], CONFIG), /Unknown config key/);
});

test('probeMargin is answerable against a log, which is the point of the port', () => {
  // A clean answer at position 0 leaves the cursor at 0; a miss 300 words past it
  // is out of reach. At the shipped margin that word is released; widen the margin
  // and it becomes a drill word. That difference is the measurement this tool was
  // ported to make.
  withTempDir((dir) => {
    const at = clock();
    const far = SPINE[300].word;
    const path = writeLog(dir, [
      attempt({ word: SPINE[0].word, stage: 'clean', t: at() }),
      attempt({ word: far, stage: 'r2', t: at() }),
      sessionEvent({ t: at(), hash: spellingItemSpace('playable').hash }),
    ]);

    const shipped = replay({ logPath: path, seed: 4 }).text;
    const wide = replay({ logPath: path, seed: 4, overrides: ['probeMargin=400'] }).text;

    assert.match(shipped, /^deferred\s+1$/m);
    assert.match(shipped, /^drill\s+0$/m);
    assert.match(wide, /^deferred\s+0$/m);
    assert.match(wide, /^drill\s+1$/m);
    assert.match(wide, /^config\s+probeMargin=400$/m, 'the report states its own experiment');
  });
});

// --- the walk ---------------------------------------------------------------

test('the report is byte-identical for the same log, seed and config', () => {
  withTempDir((dir) => {
    const path = writeLog(dir, syntheticEvents());
    const options = { logPath: path, seed: 7 };
    assert.equal(replay(options).text, replay(options).text);
  });
});

test('a different seed is what makes the report differ, not chance', () => {
  withTempDir((dir) => {
    const path = writeLog(dir, syntheticEvents());
    assert.notEqual(replay({ logPath: path, seed: 1 }).text, replay({ logPath: path, seed: 2 }).text);
  });
});

test('learn attempts advance the model and are not replayed as decisions', () => {
  withTempDir((dir) => {
    const at = clock();
    const events = [];
    for (let index = 0; index < 8; index += 1) {
      events.push(
        attempt({ word: SPINE[index].word, t: at(), mode: index < 4 ? 'learn' : 'drill' }),
      );
    }
    const text = replay({ logPath: writeLog(dir, events), seed: 3 }).text;

    assert.match(text, /^events\s+8 usable attempts/m);
    assert.match(text, /^learn\s+4 attempts folded in, not replayed as decisions$/m);
    assert.match(text, /^decisions\s+4 /m);
  });
});

test('every word in the item space gets a line, served or not', () => {
  withTempDir((dir) => {
    const path = writeLog(dir, syntheticEvents(4));
    const text = replay({ logPath: path }).text;

    const table = text.slice(text.indexOf('# word / replayed serves'));
    assert.equal(table.trim().split('\n').length - 1, spellingItemSpace('playable').spine.length);
    // A word nowhere near the log still reports its zero, so a diff of two runs
    // is a list of effects rather than a list of insertions.
    assert.match(text, /^necessary\s+0\s+0\s+\+0/m);
  });
});

test('the five placement sets still partition the item space after a replay', () => {
  withTempDir((dir) => {
    const path = writeLog(dir, syntheticEvents(30));
    const text = replay({ logPath: path, seed: 11 }).text;
    const total = spellingItemSpace('playable').spine.length;

    assert.match(text, new RegExp(`^accounted for\\s+${total} of ${total}$`, 'm'));
    assert.doesNotMatch(text, /no longer partition/);
    assert.doesNotMatch(text, /LOST$/m, 'a word in none of the five sets is a placement bug');
  });
});

test('an unusable attempt is counted rather than dropped in silence', () => {
  withTempDir((dir) => {
    const at = clock();
    const path = writeLog(dir, [
      ...syntheticEvents(4),
      attempt({ word: 'notaspinewordatall', t: at() }),
      { type: 'attempt', t: at(), session: 's_0001', word: 'cat', ms: 'slow', stage: 'clean' },
    ]);
    assert.match(replay({ logPath: path }).text, /^events\s+4 usable attempts, 2 skipped as unusable$/m);
  });
});

test('an empty spelling log is a first run, not an error', () => {
  withTempDir((dir) => {
    const path = writeLog(dir, [sessionEvent({ t: '2026-08-03T10:00:00.000Z' })]);
    const result = replay({ logPath: path, game: 'spelling' });
    assert.equal(result.code, 0);
    assert.match(result.text, /nothing to replay/);
  });
});
