// Safety behaviour only — this is a spike. No exhaustive MIME coverage.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { start, HOST, DEFAULT_TAIL, resolveSafe } from '../../server/serve.js';

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
