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

test('defaults match the spec: block mode on', () => {
  assert.equal(DEFAULT_SETTINGS.blockOnError, true);
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
  saveSettings({ ...DEFAULT_SETTINGS, name: 'Petra', blockOnError: false });
  const loaded = loadSettings();
  assert.equal(loaded.name, 'Petra');
  assert.equal(loaded.blockOnError, false);
  assert.equal(loaded.accent, DEFAULT_SETTINGS.accent, 'untouched keys keep their defaults');
});

test('hasAskedName defaults false and round-trips, so a skip is remembered', () => {
  globalThis.localStorage = fakeStorage();
  assert.equal(DEFAULT_SETTINGS.hasAskedName, false);
  saveSettings({ ...DEFAULT_SETTINGS, name: null, hasAskedName: true });
  const loaded = loadSettings();
  assert.equal(loaded.hasAskedName, true, 'a kid who skipped must not be asked again');
  assert.equal(loaded.name, null);
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

// A REAL KID'S BROWSER STILL HOLDS `guidance: 2`. The setting is gone and the
// hands are always shown, so a stored value must be dropped rather than carried
// forward — otherwise the field that no longer does anything would still be
// sitting there, waiting to confuse whoever finds it next.
test('a stored guidance level is dropped, not preserved', () => {
  globalThis.localStorage = fakeStorage({
    'kct.typing.settings.v1': JSON.stringify({ name: 'Petra', guidance: 2 }),
  });
  const loaded = loadSettings();
  assert.equal(loaded.guidance, undefined);
  assert.equal(loaded.name, 'Petra', 'the rest of the object still loads');
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
