// Safety behaviour only — this is a spike. No exhaustive MIME coverage.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  start,
  createServer,
  mimeTypeFor,
  audioDirFor,
  HOST,
  DEFAULT_TAIL,
  resolveSafe,
  logPathFor,
  LOG_PATHS,
  REPO_ROOT,
  DEFAULT_GAME,
} from '../../server/serve.js';

/** Raw request so `..` segments survive — fetch() would normalise them away. */
function request(port, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port, ...options }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function withServer(logLines, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'math-server-'));
  const root = path.join(dir, 'root');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'games-menu.html'), '<h1>menu</h1>');
  fs.writeFileSync(path.join(dir, 'outside-secret.txt'), 'do not serve me');

  const logPath = path.join(dir, 'math-log.jsonl');
  fs.writeFileSync(logPath, logLines === null ? '' : logLines);

  const server = await start({ port: 0, root, logPath });
  const { port } = server.address();
  try {
    await run({ port, logPath, root, dir });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** An empty temp directory, used as both the static root and the log directory. */
function freshTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'game-server-'));
}

/** Listen on an ephemeral port and return the base URL. */
function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, HOST, () => resolve(`http://${HOST}:${server.address().port}`));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('binds 127.0.0.1 only, never 0.0.0.0', async () => {
  await withServer(null, async () => {});
  const server = await start({ port: 0 });
  try {
    assert.equal(server.address().address, '127.0.0.1');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('rejects a ../../etc/passwd-style path with 403', async () => {
  await withServer(null, async ({ port }) => {
    const res = await request(port, { method: 'GET', path: '/../../etc/passwd' });
    assert.equal(res.status, 403);
    assert.ok(!res.text.includes('root:'));
  });
});

test('rejects traversal that would reach a real file just outside the root', async () => {
  await withServer(null, async ({ port }) => {
    const res = await request(port, { method: 'GET', path: '/../outside-secret.txt' });
    assert.equal(res.status, 403);
    assert.ok(!res.text.includes('do not serve me'));
  });
});

test('rejects percent-encoded traversal', async () => {
  await withServer(null, async ({ port }) => {
    const res = await request(port, { method: 'GET', path: '/%2e%2e/%2e%2e/etc/passwd' });
    assert.equal(res.status, 403);
  });
});

test('serves a file inside the root', async () => {
  await withServer(null, async ({ port }) => {
    const res = await request(port, { method: 'GET', path: '/games-menu.html' });
    assert.equal(res.status, 200);
    assert.equal(res.text, '<h1>menu</h1>');
  });
});

test('resolveSafe returns null for escapes and a path for children', () => {
  const root = path.resolve('/tmp/some-root');
  assert.equal(resolveSafe(root, '/../../etc/passwd'), null);
  assert.equal(resolveSafe(root, '/a/../../b'), null);
  assert.equal(resolveSafe(root, '/nested/file.js'), path.join(root, 'nested', 'file.js'));
  // A sibling directory sharing a name prefix is not inside the root.
  assert.equal(resolveSafe(root, '/../some-root-evil/x'), null);
});

test('POST /api/log appends exactly one line and returns 204', async () => {
  await withServer('', async ({ port, logPath }) => {
    const event = {
      type: 'attempt',
      t: '2026-08-01T15:04:05.123Z',
      build: 'm1',
      session: 's_9f2c',
      op: '*',
      a: 6,
      b: 7,
      ms: 4820,
      stage: 'strategy',
      typed: ['4', '48', '4', '42'],
      wrong: [48],
    };
    const res = await request(
      port,
      { method: 'POST', path: '/api/log', headers: { 'content-type': 'application/json' } },
      JSON.stringify(event),
    );
    assert.equal(res.status, 204);

    const raw = fs.readFileSync(logPath, 'utf8');
    assert.equal(raw.endsWith('\n'), true);
    const lines = raw.split('\n').filter((l) => l !== '');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), event);
  });
});

test('POST with a multi-line JSON body still writes exactly one line', async () => {
  await withServer('', async ({ port, logPath }) => {
    const body = JSON.stringify({ type: 'session', session: 's_0001', items: 20 }, null, 2);
    assert.ok(body.includes('\n'));
    const res = await request(port, { method: 'POST', path: '/api/log' }, body);
    assert.equal(res.status, 204);
    assert.equal(fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length, 1);
  });
});

test('POST rejects a non-JSON body with 400 and writes nothing', async () => {
  await withServer('', async ({ port, logPath }) => {
    const res = await request(port, { method: 'POST', path: '/api/log' }, 'not json at all');
    assert.equal(res.status, 400);
    assert.equal(fs.readFileSync(logPath, 'utf8'), '');
  });
});

test('POST rejects valid JSON without a type field with 400', async () => {
  await withServer('', async ({ port, logPath }) => {
    for (const body of ['{"a":1}', '[1,2,3]', 'null', '"hello"', '{"type":42}']) {
      const res = await request(port, { method: 'POST', path: '/api/log' }, body);
      assert.equal(res.status, 400, `expected 400 for ${body}`);
    }
    assert.equal(fs.readFileSync(logPath, 'utf8'), '');
  });
});

test('GET /api/log?tail=N returns the last N events', async () => {
  const lines = Array.from({ length: 10 }, (_, i) =>
    JSON.stringify({ type: 'attempt', n: i }),
  ).join('\n') + '\n';

  await withServer(lines, async ({ port }) => {
    const res = await request(port, { method: 'GET', path: '/api/log?tail=3' });
    assert.equal(res.status, 200);
    const { events } = JSON.parse(res.text);
    assert.deepEqual(events.map((e) => e.n), [7, 8, 9]);
  });
});

test('GET /api/log skips a malformed line mid-file without throwing', async () => {
  const lines = [
    JSON.stringify({ type: 'attempt', n: 0 }),
    '{"type":"attempt","n":1',            // truncated write
    'this is not json at all',
    '',                                    // blank line
    JSON.stringify({ type: 'attempt', n: 2 }),
    JSON.stringify({ type: 'session', n: 3 }),
  ].join('\n') + '\n';

  await withServer(lines, async ({ port }) => {
    const res = await request(port, { method: 'GET', path: '/api/log?tail=10' });
    assert.equal(res.status, 200);
    const { events } = JSON.parse(res.text);
    assert.deepEqual(events.map((e) => e.n), [0, 2, 3]);
  });
});

test('tail counts well-formed events, not raw lines', async () => {
  const lines = [
    JSON.stringify({ n: 0, type: 'attempt' }),
    'CORRUPT',
    JSON.stringify({ n: 1, type: 'attempt' }),
    JSON.stringify({ n: 2, type: 'attempt' }),
  ].join('\n') + '\n';

  await withServer(lines, async ({ port }) => {
    const { events } = JSON.parse(
      (await request(port, { method: 'GET', path: '/api/log?tail=2' })).text,
    );
    assert.deepEqual(events.map((e) => e.n), [1, 2]);
  });
});

test('tail defaults to 2000 and a bad tail falls back to the default', async () => {
  assert.equal(DEFAULT_TAIL, 2000);
  const lines = Array.from({ length: 5 }, (_, i) =>
    JSON.stringify({ type: 'attempt', n: i }),
  ).join('\n') + '\n';

  await withServer(lines, async ({ port }) => {
    for (const query of ['', '?tail=abc', '?tail=0', '?tail=-4', '?tail=2000']) {
      const { events } = JSON.parse(
        (await request(port, { method: 'GET', path: `/api/log${query}` })).text,
      );
      assert.equal(events.length, 5, `unexpected count for "${query}"`);
    }
  });
});

test('GET /api/log on a missing log file returns an empty list', async () => {
  await withServer('', async ({ port, logPath }) => {
    fs.rmSync(logPath);
    const res = await request(port, { method: 'GET', path: '/api/log' });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.text), { events: [] });
  });
});

test('a POST is visible to the next GET', async () => {
  await withServer('', async ({ port }) => {
    await request(port, { method: 'POST', path: '/api/log' }, JSON.stringify({ type: 'session', k: 1 }));
    await request(port, { method: 'POST', path: '/api/log' }, JSON.stringify({ type: 'attempt', k: 2 }));
    const { events } = JSON.parse((await request(port, { method: 'GET', path: '/api/log' })).text);
    assert.deepEqual(events.map((e) => e.k), [1, 2]);
  });
});

// --- ?game= routes the log through an allowlist -----------------------------

test('GET /api/log?game=typing reads the typing log', async () => {
  const dir = freshTempDir();
  const typingLog = path.join(dir, 'typing-log.jsonl');
  fs.writeFileSync(typingLog, JSON.stringify({ type: 'round', lesson: 'top-ei' }) + '\n');

  const server = createServer({
    root: dir,
    logPaths: { math: path.join(dir, 'math-log.jsonl'), typing: typingLog },
  });
  const base = await listen(server);

  const res = await fetch(`${base}/api/log?game=typing&tail=10`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].lesson, 'top-ei');

  await close(server);
});

test('POST /api/log?game=typing appends to the typing log only', async () => {
  const dir = freshTempDir();
  const mathLog = path.join(dir, 'math-log.jsonl');
  const typingLog = path.join(dir, 'typing-log.jsonl');

  const server = createServer({ root: dir, logPaths: { math: mathLog, typing: typingLog } });
  const base = await listen(server);

  const res = await fetch(`${base}/api/log?game=typing`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'round', lesson: 'top-ei', accuracy: 0.96 }),
  });
  assert.equal(res.status, 204);
  assert.ok(fs.readFileSync(typingLog, 'utf8').includes('top-ei'));
  assert.equal(fs.existsSync(mathLog), false, 'the math log must be untouched');

  await close(server);
});

test('omitting ?game keeps the existing math behaviour', async () => {
  const dir = freshTempDir();
  const mathLog = path.join(dir, 'math-log.jsonl');
  const server = createServer({ root: dir, logPaths: { math: mathLog, typing: path.join(dir, 't.jsonl') } });
  const base = await listen(server);

  const res = await fetch(`${base}/api/log`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'attempt', op: '*', a: 6, b: 7 }),
  });
  assert.equal(res.status, 204);
  assert.ok(fs.readFileSync(mathLog, 'utf8').includes('"a":6'));

  await close(server);
});

test('an unknown game is rejected, not resolved to a path', async () => {
  const dir = freshTempDir();
  const server = createServer({ root: dir });
  const base = await listen(server);

  for (const game of ['nope', '../secrets', 'math-log', '__proto__', '']) {
    const res = await fetch(`${base}/api/log?game=${encodeURIComponent(game)}`);
    assert.equal(res.status, 400, `game=${game} must be rejected`);
  }

  await close(server);
});

test('an unknown game is rejected on POST too, and writes nothing', async () => {
  const dir = freshTempDir();
  const server = createServer({ root: dir });
  const base = await listen(server);

  const res = await fetch(`${base}/api/log?game=../../etc/passwd`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'round' }),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(fs.readdirSync(dir), []);

  await close(server);
});

// --- the spelling game joins the allowlist ----------------------------------

test('LOG_PATHS names a spelling log, and every log path stays inside the repo root', () => {
  assert.equal(LOG_PATHS.spelling, path.join(REPO_ROOT, 'data', 'spelling-log.jsonl'));
  for (const [game, file] of Object.entries(LOG_PATHS)) {
    assert.equal(path.resolve(file), file, `${game} is not an absolute resolved path`);
    assert.ok(file.startsWith(REPO_ROOT + path.sep), `${game} escapes the repo root`);
  }
});

test('GET and POST ?game=spelling touch the spelling log and nothing else', async () => {
  const dir = freshTempDir();
  const mathLog = path.join(dir, 'math-log.jsonl');
  const typingLog = path.join(dir, 'typing-log.jsonl');
  const spellingLog = path.join(dir, 'spelling-log.jsonl');

  const server = createServer({
    root: dir,
    logPaths: { math: mathLog, typing: typingLog, spelling: spellingLog },
  });
  const base = await listen(server);

  const post = await fetch(`${base}/api/log?game=spelling`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'attempt', word: 'friend', stage: 'clean', revealed: 0 }),
  });
  assert.equal(post.status, 204);
  assert.ok(fs.readFileSync(spellingLog, 'utf8').includes('friend'));
  assert.equal(fs.existsSync(mathLog), false, 'the math log must be untouched');
  assert.equal(fs.existsSync(typingLog), false, 'the typing log must be untouched');

  const body = await (await fetch(`${base}/api/log?game=spelling&tail=10`)).json();
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].word, 'friend');

  await close(server);
});

test('logPathFor resolves allowlisted games only — inherited keys name nothing', () => {
  // The HTTP-level tests above prove the status code. This proves the reason for
  // it: the lookup itself returns null rather than resolving to some path that a
  // later change might start honouring.
  const paths = { math: '/m', typing: '/t', spelling: '/s' };

  assert.equal(logPathFor(paths, 'spelling'), '/s');
  assert.equal(logPathFor(paths, 'math'), '/m');
  assert.equal(logPathFor(paths, 'typing'), '/t');

  // An absent ?game= is the one and only fallback, and it is to the default game.
  assert.equal(logPathFor(paths, null), paths[DEFAULT_GAME]);
  assert.equal(logPathFor(paths, undefined), paths[DEFAULT_GAME]);

  // Everything Object.prototype carries is reachable with `in` or a truthiness
  // check and must not be reachable here.
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(logPathFor(paths, key), null, `${key} must not name a path`);
  }
  for (const key of ['', 'spelling ', 'Spelling', 'spell', '../secrets', 'spelling-log']) {
    assert.equal(logPathFor(paths, key), null, `${key} must not name a path`);
  }
});

test('an unknown ?game= is a 400 rather than a fallback to a real log', async () => {
  const dir = freshTempDir();
  const spellingLog = path.join(dir, 'spelling-log.jsonl');
  const server = createServer({ root: dir, logPaths: { spelling: spellingLog } });
  const base = await listen(server);

  // The known game works on this very server, so a 400 below is the allowlist
  // rejecting the name, not the endpoint being broken.
  const ok = await fetch(`${base}/api/log?game=spelling`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'attempt', word: 'cat' }),
  });
  assert.equal(ok.status, 204);
  const beforeSize = fs.statSync(spellingLog).size;

  for (const game of ['__proto__', 'constructor', 'nope', 'spelling-log', '', 'math']) {
    const get = await fetch(`${base}/api/log?game=${encodeURIComponent(game)}`);
    assert.equal(get.status, 400, `GET game=${game} must be rejected`);

    const post = await fetch(`${base}/api/log?game=${encodeURIComponent(game)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'attempt', word: 'sneaky' }),
    });
    assert.equal(post.status, 400, `POST game=${game} must be rejected`);
  }

  assert.equal(fs.statSync(spellingLog).size, beforeSize, 'a rejected game wrote somewhere');
  assert.deepEqual(fs.readdirSync(dir), ['spelling-log.jsonl']);

  await close(server);
});

// The header above says no exhaustive MIME coverage, and this is not that — it
// is one type, pinned because it is the one whose absence is INAUDIBLE. Served
// as application/octet-stream an mp3 may still play, because browsers sniff; it
// may also be refused, and which one you get depends on the browser. In drill
// mode the pronunciation IS the question, so a refused decode leaves a child
// staring at empty boxes with no way to know what was asked. Everything else in
// the table announces itself when wrong: a mistyped .css is an unstyled page.
test('cached pronunciations are served as audio/mpeg, not octet-stream', () => {
  assert.equal(mimeTypeFor('/data/audio/bat.mp3'), 'audio/mpeg');
  assert.equal(mimeTypeFor('/data/audio/BAT.MP3'), 'audio/mpeg', 'extension match is case-insensitive');
  assert.equal(mimeTypeFor('/data/words/bat.json'), 'application/json; charset=utf-8');
  assert.equal(mimeTypeFor('/data/audio/bat.wav'), 'application/octet-stream', 'only what we cache is claimed');
});

// /api/audio tells the spelling game which words it can pronounce. Safety-shaped
// like the rest of this file: the concern is that a directory read never emits a
// name that could not already be requested as /data/audio/<word>.mp3.
test('/api/audio lists cached words and refuses anything that is not one', async () => {
  const dir = freshTempDir();
  const audioDir = path.join(dir, 'data', 'audio');
  fs.mkdirSync(audioDir, { recursive: true });
  for (const name of [
    'bat.mp3',
    'at.mp3',
    'friend.mp3',
    'notes.txt',            // not audio
    'bat.mp3.bak',          // not audio
    'UPPER.mp3',            // not the lowercase-a-z contract
    'two words.mp3',        // ditto
    'nine9.mp3',            // ditto
    '..evil.mp3',           // must never be echoed back as a word
  ]) {
    fs.writeFileSync(path.join(audioDir, name), 'x');
  }

  const server = createServer({ root: dir, logPaths: { math: path.join(dir, 'math.jsonl') } });
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/api/audio`);
    assert.equal(res.status, 200);
    const { words } = await res.json();
    assert.deepEqual(words, ['at', 'bat', 'friend'], 'sorted, .mp3 only, lowercase a-z only');

    const post = await fetch(`${base}/api/audio`, { method: 'POST' });
    assert.equal(post.status, 405);
  } finally {
    await close(server);
  }
});

test('/api/audio answers [] when there is no cache directory at all', async () => {
  // The state of a fresh clone. It is not an error, and the game reads it as
  // "trim nothing" rather than "no words".
  const dir = freshTempDir();
  const server = createServer({ root: dir, logPaths: { math: path.join(dir, 'math.jsonl') } });
  const base = await listen(server);
  try {
    const res = await fetch(`${base}/api/audio`);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).words, []);
  } finally {
    await close(server);
  }
});

test('audioDirFor stays under the root it is given', () => {
  assert.equal(audioDirFor('/tmp/some-root'), path.join('/tmp/some-root', 'data', 'audio'));
});
