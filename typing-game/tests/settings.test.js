// typing-game/tests/settings.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../js/settings.js';

/** A minimal localStorage stand-in; node has none. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

test('defaults match the spec: block mode on, guidance at full', () => {
  assert.equal(DEFAULT_SETTINGS.blockOnError, true);
  assert.equal(DEFAULT_SETTINGS.guidance, 3);
  assert.equal(DEFAULT_SETTINGS.name, null);
  assert.equal(DEFAULT_SETTINGS.accent, '#7b6bd6');
  assert.equal(DEFAULT_SETTINGS.skin, '#e8b7ac');
});

test('a first run with no storage returns the defaults', () => {
  globalThis.localStorage = fakeStorage();
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('no localStorage at all is a first run, not a crash', () => {
  delete globalThis.localStorage;
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  assert.doesNotThrow(() => saveSettings({ ...DEFAULT_SETTINGS, name: 'Petra' }));
});

test('saved settings round-trip', () => {
  globalThis.localStorage = fakeStorage();
  saveSettings({ ...DEFAULT_SETTINGS, name: 'Petra', guidance: 1 });
  const loaded = loadSettings();
  assert.equal(loaded.name, 'Petra');
  assert.equal(loaded.guidance, 1);
  assert.equal(loaded.blockOnError, true, 'untouched keys keep their defaults');
});

test('corrupt JSON falls back to defaults silently', () => {
  globalThis.localStorage = fakeStorage({ 'kct.typing.settings.v1': '{not json' });
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('a non-object stored value falls back to defaults', () => {
  for (const raw of ['null', '42', '"hello"', '[1,2]']) {
    globalThis.localStorage = fakeStorage({ 'kct.typing.settings.v1': raw });
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS, raw);
  }
});

test('unknown keys in storage are dropped, not passed through', () => {
  globalThis.localStorage = fakeStorage({
    'kct.typing.settings.v1': JSON.stringify({ name: 'Petra', nonsense: true }),
  });
  assert.equal(loadSettings().nonsense, undefined);
});

test('a guidance level outside 0..3 falls back to the default', () => {
  for (const bad of [-1, 4, 'high', null]) {
    globalThis.localStorage = fakeStorage({
      'kct.typing.settings.v1': JSON.stringify({ guidance: bad }),
    });
    assert.equal(loadSettings().guidance, 3, String(bad));
  }
});

test('a storage that throws on write does not throw into the caller', () => {
  globalThis.localStorage = {
    getItem: () => { throw new Error('disabled'); },
    setItem: () => { throw new Error('quota'); },
    removeItem: () => {},
  };
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  assert.doesNotThrow(() => saveSettings(DEFAULT_SETTINGS));
});
