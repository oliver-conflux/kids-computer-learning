// The core log client's failure model is pinned by math-game/tests/log.test.js,
// which exercises it through math's shim. This file covers only what became
// possible when one module started serving two games: that two clients built in
// the same process share code and nothing else.
//
// The mutation this guards against is a one-word one — hoisting `outboxKey` or
// `logUrl` back out to module scope, which is exactly where they lived in both
// original clients. Every existing test would still pass, and a kid's queued
// math events would replay into the typing log.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLogClient } from '../log.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()],
  };
}

/** Install stubs and return a teardown. Records every request seen. */
function withStubs(respond) {
  const previousFetch = globalThis.fetch;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const requests = [];

  globalThis.localStorage = fakeStorage();
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url, method: init.method, body: init.body });
    return respond();
  };

  return {
    requests,
    outbox(key) {
      const raw = globalThis.localStorage.getItem(key);
      return raw === null ? [] : JSON.parse(raw);
    },
    keys: () => globalThis.localStorage.keys(),
    restore() {
      globalThis.fetch = previousFetch;
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
      else delete globalThis.localStorage;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('two clients in one process keep separate outboxes', async () => {
  const stubs = withStubs(() => { throw new TypeError('Failed to fetch'); });
  const alpha = createLogClient({ game: 'math', outboxKey: 'k.alpha', defaultTail: 10 });
  const beta = createLogClient({ game: 'typing', outboxKey: 'k.beta', defaultTail: 10 });

  try {
    alpha.record({ type: 'attempt', from: 'alpha' });
    beta.record({ type: 'attempt', from: 'beta' });
    await settle();

    assert.deepEqual(stubs.outbox('k.alpha').map((e) => e.from), ['alpha']);
    assert.deepEqual(stubs.outbox('k.beta').map((e) => e.from), ['beta']);
    assert.deepEqual(stubs.keys().sort(), ['k.alpha', 'k.beta']);
  } finally {
    stubs.restore();
  }
});

test('one client flushing does not drain the other', async () => {
  let alive = false;
  const stubs = withStubs(() => {
    if (!alive) throw new TypeError('Failed to fetch');
    return { ok: true, status: 204 };
  });
  const alpha = createLogClient({ game: 'math', outboxKey: 'k.alpha', defaultTail: 10 });
  const beta = createLogClient({ game: 'typing', outboxKey: 'k.beta', defaultTail: 10 });

  try {
    alpha.record({ type: 'attempt', from: 'alpha' });
    beta.record({ type: 'attempt', from: 'beta' });
    await settle();

    alive = true;
    await alpha.flushOutbox();

    assert.deepEqual(stubs.outbox('k.alpha'), [], 'alpha drains');
    assert.deepEqual(
      stubs.outbox('k.beta').map((e) => e.from),
      ['beta'],
      'beta is untouched — a shared outbox would have replayed it into math',
    );
  } finally {
    stubs.restore();
  }
});

test('each client addresses its own game on every request', async () => {
  const stubs = withStubs(() => ({ ok: true, status: 200, json: async () => ({ events: [] }) }));
  const alpha = createLogClient({ game: 'math', outboxKey: 'k.alpha', defaultTail: 10 });
  const beta = createLogClient({ game: 'typing', outboxKey: 'k.beta', defaultTail: 10 });

  try {
    alpha.record({ type: 'attempt' });
    beta.record({ type: 'attempt' });
    await settle();
    await alpha.loadEvents();
    await beta.loadEvents(5);
    await alpha.serverIsUp();

    assert.deepEqual(stubs.requests.map((r) => r.url), [
      '/api/log?game=math',
      '/api/log?game=typing',
      // `&`, not `?` — the game parameter is already on the URL. A `?` here
      // makes `tail` part of the game name and the server answers 400.
      '/api/log?game=math&tail=10',
      '/api/log?game=typing&tail=5',
      '/api/log?game=math&tail=1',
    ]);
  } finally {
    stubs.restore();
  }
});

test('the shipped clients still use the exact outbox keys kids have on disk', async () => {
  // Byte-for-byte. A rename here strands whatever is queued in a real browser:
  // the events are unreachable forever and the kid silently loses rounds they
  // actually played.
  const stubs = withStubs(() => { throw new TypeError('Failed to fetch'); });
  try {
    const math = await import('../../math-game/js/log.js');
    const typing = await import('../../typing-game/js/log.js');
    math.record({ type: 'attempt' });
    typing.record({ type: 'round' });
    await settle();

    assert.deepEqual(stubs.keys().sort(), ['kct.math.outbox.v1', 'kct.typing.outbox.v1']);
  } finally {
    stubs.restore();
  }
});
