// Light by design — this is a spike. One outbox round-trip against a stubbed
// fetch, plus the one failure rule that would bite hardest if it regressed:
// a 400 is permanent and must never be requeued.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { record, flushOutbox, loadEvents } from '../js/log.js';

const OUTBOX_KEY = 'kct.math.outbox.v1';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/** Install stubs and return a teardown. Records every POST body seen. */
function withStubs(respond) {
  const previousFetch = globalThis.fetch;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const posted = [];

  globalThis.localStorage = fakeStorage();
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === 'POST') posted.push(JSON.parse(init.body));
    return respond();
  };

  return {
    posted,
    outbox() {
      const raw = globalThis.localStorage.getItem(OUTBOX_KEY);
      return raw === null ? [] : JSON.parse(raw);
    },
    restore() {
      globalThis.fetch = previousFetch;
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
      else delete globalThis.localStorage;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const attempt = (a, b) => ({
  type: 'attempt',
  t: '2026-08-01T15:04:05.123Z',
  build: 'm1',
  session: 's_9f2c',
  op: '*',
  a,
  b,
  ms: 1200,
  stage: 'clean',
  typed: [String(a * b)],
  wrong: [],
});

test('outbox round-trip: a dead server queues, a live server flushes oldest-first', async () => {
  let alive = false;
  const stubs = withStubs(() => {
    if (!alive) throw new TypeError('Failed to fetch');
    return { ok: true, status: 204 };
  });

  try {
    record(attempt(6, 7));
    record(attempt(8, 9));
    await settle();

    assert.deepEqual(
      stubs.outbox().map((e) => [e.a, e.b]),
      [[6, 7], [8, 9]],
      'both events queue while the server is down',
    );

    alive = true;
    await flushOutbox();

    assert.deepEqual(
      stubs.posted.slice(2).map((e) => [e.a, e.b]),
      [[6, 7], [8, 9]],
      'the flush replays oldest-first',
    );
    assert.deepEqual(stubs.outbox(), [], 'the outbox is empty once acknowledged');
  } finally {
    stubs.restore();
  }
});

test('a 400 is permanent: the event is dropped, never requeued', async () => {
  const stubs = withStubs(() => ({ ok: false, status: 400 }));

  try {
    record({ nope: true });
    await settle();
    assert.deepEqual(stubs.outbox(), [], 'record drops a rejected event');

    globalThis.localStorage.setItem(OUTBOX_KEY, JSON.stringify([{ nope: true }]));
    await flushOutbox();
    assert.deepEqual(stubs.outbox(), [], 'flushOutbox drops it rather than looping forever');
  } finally {
    stubs.restore();
  }
});

// --- gaps found by mutation testing (Review-W12 SMALL #2, #3, #4) -----------
//
// Each of these pins a property that a surviving mutation would have broken
// while the whole suite stayed green. The 5xx one is the serious one: flipping
// transient to permanent is silent data loss on every server error.

test('a 5xx is transient and requeues rather than dropping the event', async () => {
  const stubs = withStubs(() => ({ status: 500, ok: false }));
  try {
    record(attempt(6, 7));
    record(attempt(7, 8));
    await settle();
    assert.equal(stubs.outbox().length, 2, 'a server error must not lose events');
    assert.deepEqual(
      stubs.outbox().map((e) => [e.a, e.b]),
      [[6, 7], [7, 8]],
      'requeued events must keep their original order',
    );
  } finally {
    stubs.restore();
  }
});

test('flushOutbox stops at the first 5xx instead of hammering a dead server', async () => {
  const stubs = withStubs(() => ({ status: 503, ok: false }));
  try {
    record(attempt(6, 7));
    record(attempt(7, 8));
    record(attempt(8, 9));
    await settle();
    const postsBefore = stubs.posted.length;
    await flushOutbox();
    assert.equal(
      stubs.posted.length - postsBefore,
      1,
      'one probe post, not one per queued event',
    );
    assert.equal(stubs.outbox().length, 3, 'all three stay queued');
  } finally {
    stubs.restore();
  }
});

test('loadEvents resolves to [] rather than rejecting, on every failure mode', async () => {
  for (const respond of [
    () => { throw new Error('network gone'); },
    () => ({ status: 500, ok: false }),
    () => ({ status: 200, ok: true, json: async () => { throw new Error('not json'); } }),
    () => ({ status: 200, ok: true, json: async () => ({}) }),
    () => ({ status: 200, ok: true, json: async () => ({ events: 'not an array' }) }),
  ]) {
    const stubs = withStubs(respond);
    try {
      // First run must start on a machine that has never played.
      assert.deepEqual(await loadEvents(10), []);
    } finally {
      stubs.restore();
    }
  }
});

test('record returns undefined synchronously and never blocks the caller', () => {
  // Spec §9: the kid must never wait on I/O between problems. Making record
  // async and awaiting the post would satisfy every other test in this file.
  let resolvePost;
  const stubs = withStubs(() => new Promise((r) => { resolvePost = r; }));
  try {
    let returned = 'not-yet-set';
    returned = record(attempt(6, 7));
    assert.equal(returned, undefined, 'record must return undefined, not a promise');
    assert.equal(typeof returned?.then, 'undefined', 'record must not be awaitable');
    resolvePost?.({ status: 204, ok: true });
  } finally {
    stubs.restore();
  }
});
