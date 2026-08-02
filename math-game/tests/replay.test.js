// Replay tool tests — light, per the plan. This is a spike tool, not core logic.
//
// The one property that has to hold is determinism: a comparison between two
// configs is only evidence if the two runs differ ONLY by the config. If the
// same log, seed and config could produce two different reports, every "6x7
// would have been served 14x instead of 6x" conclusion drawn from this tool is
// noise wearing a number.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { replay, configWithOverrides, parseArgs } from '../../tools/replay.js';
import { CONFIG } from '../js/config.js';

const TOOL = fileURLToPath(new URL('../../tools/replay.js', import.meta.url));

/** A temp directory that cleans itself up. Nothing is ever written to data/. */
function withTempDir(body) {
  const dir = mkdtempSync(join(tmpdir(), 'replay-test-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One AttemptEvent line, fields exactly per the shared contract. */
function attempt({ a, b, ms, stage, wrong = [], session = 's_0001', t, build = 'm1' }) {
  return {
    type: 'attempt',
    t,
    build,
    session,
    op: '*',
    a,
    b,
    ms,
    stage,
    typed: [],
    wrong,
  };
}

/**
 * A synthetic log with enough shape to exercise the scheduler: two sessions,
 * a spread of latencies so facts land in all three buckets, and some wrong
 * answers so the confusion guard has something to bite on.
 */
function syntheticEvents(count = 40) {
  const events = [];
  for (let index = 0; index < count; index += 1) {
    const a = (index * 3) % 11;
    const b = (index * 7) % 11;
    const session = index < count / 2 ? 's_0001' : 's_0002';
    const minute = String(index).padStart(2, '0');
    events.push(
      attempt({
        a,
        b,
        ms: 500 + (index % 5) * 900,
        stage: index % 4 === 0 ? 'strategy' : 'clean',
        wrong: index % 5 === 0 ? [a * b + 1] : [],
        session,
        t: `2026-07-${index < 20 ? '30' : '31'}T10:${minute}:00.000Z`,
      }),
    );
  }
  return events;
}

function writeLog(dir, events, extraLines = []) {
  const path = join(dir, 'log.jsonl');
  const lines = events.map((event) => JSON.stringify(event)).concat(extraLines);
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

// --- the essential one -----------------------------------------------------

test('replay is byte-identical for the same log, seed and config', () => {
  withTempDir((dir) => {
    const path = writeLog(dir, syntheticEvents());
    const options = { logPath: path, seed: 7 };

    const first = replay(options);
    const second = replay(options);

    assert.equal(first.code, 0);
    assert.equal(first.text, second.text);
    assert.ok(first.text.includes('# replay'), 'report should carry its header');
    assert.ok(first.text.includes('*:6x7'), 'every fact should get a line');
  });
});

test('a different seed is what makes the report differ, not chance', () => {
  withTempDir((dir) => {
    const path = writeLog(dir, syntheticEvents());
    const a = replay({ logPath: path, seed: 1 }).text;
    const b = replay({ logPath: path, seed: 2 }).text;
    assert.notEqual(a, b);
  });
});

// --- a corrupt log must never throw ---------------------------------------

test('malformed lines are skipped, not thrown on', () => {
  withTempDir((dir) => {
    const path = writeLog(dir, syntheticEvents(), [
      '{ not json at all',
      '',
      'null',
      '[1,2,3]',
      '{"type":"attempt","a":99,"b":4,"op":"*","ms":100,"stage":"clean"}',
      '{"type":"attempt","op":"*","a":2,"b":3,"ms":"slow","stage":"clean"}',
    ]);

    const result = replay({ logPath: path, seed: 3 });

    assert.equal(result.code, 0);
    assert.match(result.text, /malformed skipped/);
    assert.match(result.text, /skipped as unusable/);
  });
});

test('a log of nothing but garbage still reports rather than throwing', () => {
  withTempDir((dir) => {
    const path = join(dir, 'log.jsonl');
    writeFileSync(path, 'garbage\n{oops\n', 'utf8');
    const result = replay({ logPath: path, seed: 1 });
    assert.equal(result.code, 0);
    assert.match(result.text, /nothing to replay/);
  });
});

// --- first run is not an error --------------------------------------------

test('an empty log exits 0 and says so', () => {
  withTempDir((dir) => {
    const path = join(dir, 'log.jsonl');
    writeFileSync(path, '', 'utf8');

    const result = replay({ logPath: path });
    assert.equal(result.code, 0);
    assert.match(result.text, /nothing to replay/);
    assert.match(result.text, /not an error/);
  });
});

test('a missing log exits 0 from the CLI', () => {
  withTempDir((dir) => {
    const path = join(dir, 'never-written.jsonl');
    const output = execFileSync(process.execPath, [TOOL, path], { encoding: 'utf8' });
    assert.match(output, /nothing to replay/);
  });
});

// --- the overrides have to actually apply ---------------------------------

test('a config override changes the replay and never touches CONFIG', () => {
  withTempDir((dir) => {
    const path = writeLog(dir, syntheticEvents());
    const before = JSON.stringify(CONFIG);

    const base = replay({ logPath: path, seed: 5 }).text;
    const tuned = replay({ logPath: path, seed: 5, overrides: ['hotMs=6000', 'weights.cold=20'] }).text;

    assert.notEqual(base, tuned);
    assert.equal(JSON.stringify(CONFIG), before, 'CONFIG must not be mutated');
  });
});

test('an unknown config key is an error, not a silent no-op', () => {
  assert.throws(() => configWithOverrides(['notAKey=3']), /Unknown config key/);
  assert.throws(() => configWithOverrides(['weights.tepid=3']), /Unknown config key/);
  assert.throws(() => configWithOverrides(['hotMs=fast']), /numeric/);
});

test('overrides are typed like the field they replace', () => {
  const config = configWithOverrides(['hotMs=1200', 'weights.cold=8', 'build=m2']);
  assert.equal(config.hotMs, 1200);
  assert.equal(config.weights.cold, 8);
  assert.equal(config.build, 'm2');
});

// --- build filtering, which is how before/after comparison works ----------

test('--build filters events to one build tag', () => {
  withTempDir((dir) => {
    const events = syntheticEvents().map((event, index) =>
      index % 2 === 0 ? event : { ...event, build: 'm2' },
    );
    const path = writeLog(dir, events);

    const all = replay({ logPath: path, seed: 1 }).text;
    const m1 = replay({ logPath: path, seed: 1, build: 'm1' }).text;

    assert.notEqual(all, m1);
    assert.match(m1, /^build\s+m1$/m);
  });
});

test('argv parsing covers the documented usage', () => {
  const options = parseArgs(['data/math-log.jsonl', '--build=m1', '--seed=9', '--config=hotMs=1200,noRepeatWithin=6']);
  assert.equal(options.logPath, 'data/math-log.jsonl');
  assert.equal(options.build, 'm1');
  assert.equal(options.seed, 9);
  assert.deepEqual(options.overrides, ['hotMs=1200', 'noRepeatWithin=6']);
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
});
