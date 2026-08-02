// Tests for the audio module.
//
// NOTHING HERE TOUCHES THE NETWORK, and nothing here needs a DOM. `fetch` is
// replaced below with a function that throws, for the whole file — which also
// pins the module's central promise: a session makes no request that leaves the
// machine, and the Merriam-Webster CDN is never reached at play time.
//
// The Audio element and the speech engine are injected, so the case that matters
// most — no MW_KEY, empty cache, the default experience for anyone cloning this
// repo — is a first-class test rather than something only real play would find.

import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.fetch = () => {
  throw new Error('a test in this file tried to use the network');
};

import { createAudio, cachedUrlFor } from '../js/audio.js';

/**
 * A stand-in for an HTMLAudioElement.
 *
 * @param {{load?: 'ready' | 'error' | 'never', play?: 'ok' | 'blocked'}} [behaviour]
 */
function fakeElement(behaviour = {}) {
  const listeners = new Map();
  return {
    src: null,
    preload: null,
    currentTime: null,
    played: 0,
    paused: false,
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
    load() {
      const outcome = behaviour.load ?? 'ready';
      if (outcome === 'never') return;
      const handler = listeners.get(outcome === 'ready' ? 'canplaythrough' : 'error');
      if (handler !== undefined) queueMicrotask(handler);
    },
    play() {
      this.played += 1;
      return behaviour.play === 'blocked'
        ? Promise.reject(new Error('autoplay blocked'))
        : Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
  };
}

function fakeSpeech() {
  return {
    spoken: [],
    cancels: 0,
    speak(utterance) {
      this.spoken.push(utterance);
    },
    cancel() {
      this.cancels += 1;
    },
  };
}

const makeUtterance = (text) => ({ text });

/**
 * A player wired to fakes. `load` decides whether the cache "contains" the word.
 */
function playerWith(behaviour = {}, extra = {}) {
  const speech = fakeSpeech();
  const elements = [];
  const audio = createAudio({
    makeAudio(src) {
      const element = fakeElement(behaviour);
      element.src = src;
      elements.push(element);
      return element;
    },
    speech,
    makeUtterance,
    // Short enough that the timeout test does not slow the suite down.
    config: { loadTimeoutMs: 50, ...extra },
  });
  return { audio, speech, elements };
}

// --- the cache URL --------------------------------------------------------

test('cachedUrlFor: server-root-relative, so it resolves from any page', () => {
  assert.equal(cachedUrlFor('friend'), '/data/audio/friend.mp3');
});

test('cachedUrlFor: only a spine-shaped word can name a file', () => {
  // The guard is what makes "never requests anything but a local mp3"
  // structural: nothing that could redirect the request past the cache
  // directory ever reaches a URL.
  assert.equal(cachedUrlFor('../../etc/passwd'), null);
  assert.equal(cachedUrlFor('http://example.com/x'), null);
  assert.equal(cachedUrlFor('Friend'), null);
  assert.equal(cachedUrlFor(''), null);
  assert.equal(cachedUrlFor(null), null);
});

// --- the cached mp3 -------------------------------------------------------

test('play: uses the cached mp3 when there is one', async () => {
  const { audio, speech, elements } = playerWith({ load: 'ready' });

  assert.equal(await audio.play('friend'), 'mp3');
  assert.equal(elements[0].src, '/data/audio/friend.mp3');
  assert.equal(elements[0].played, 1);
  assert.equal(speech.spoken.length, 0);
});

test('play: rewinds, so pressing space replays from the start', async () => {
  const { audio, elements } = playerWith({ load: 'ready' });

  await audio.play('friend');
  elements[0].currentTime = 0.4;
  await audio.play('friend');

  assert.equal(elements[0].currentTime, 0);
  assert.equal(elements[0].played, 2);
});

test('play: one element per word, however many times it is played', async () => {
  const { audio, elements } = playerWith({ load: 'ready' });

  await audio.play('friend');
  await audio.play('friend');
  await audio.play('friend');

  // A miss re-probed once per repetition would put a 404 in the console for
  // every rep of every uncached word.
  assert.equal(elements.length, 1);
});

// --- the fallback, which is the default experience ------------------------

test('play: an empty cache falls back to speech', async () => {
  const { audio, speech } = playerWith({ load: 'error' });

  assert.equal(await audio.play('friend'), 'tts');
  assert.deepEqual(
    speech.spoken.map((utterance) => utterance.text),
    ['friend'],
  );
});

test('play: the whole game is playable with nothing cached at all', async () => {
  // The case anyone cloning this repo is in: no MW_KEY, no cache, no ingest run.
  const { audio, speech } = playerWith({ load: 'error' });

  for (const word of ['cat', 'hat', 'friend', 'because']) {
    assert.equal(await audio.play(word), 'tts');
  }
  assert.deepEqual(
    speech.spoken.map((utterance) => utterance.text),
    ['cat', 'hat', 'friend', 'because'],
  );
});

test('play: speech gets a slower rate than conversation', async () => {
  const { audio, speech } = playerWith({ load: 'error' });

  await audio.play('friend');
  const utterance = speech.spoken[0];
  assert.ok(utterance.rate < 1, `expected a rate below 1, got ${utterance.rate}`);
  assert.equal(utterance.lang, 'en-US');
});

test('play: a blocked mp3 still reaches speech rather than going silent', async () => {
  const { audio, speech } = playerWith({ load: 'ready', play: 'blocked' });

  assert.equal(await audio.play('friend'), 'tts');
  assert.equal(speech.spoken.length, 1);
});

test('play: a file that never becomes ready does not leave a child in silence', async () => {
  const { audio, speech } = playerWith({ load: 'never' });

  assert.equal(await audio.play('friend'), 'tts');
  assert.equal(speech.spoken.length, 1);
});

test('play: no Audio constructor at all', async () => {
  const speech = fakeSpeech();
  const audio = createAudio({
    makeAudio() {
      throw new TypeError('Audio is not defined');
    },
    speech,
    makeUtterance,
  });

  assert.equal(await audio.play('friend'), 'tts');
  assert.equal(speech.spoken.length, 1);
});

test('play: no speech engine either is silent, never an exception', async () => {
  const audio = createAudio({
    makeAudio: () => fakeElement({ load: 'error' }),
    speech: null,
    makeUtterance,
    config: { loadTimeoutMs: 50 },
  });

  assert.equal(await audio.play('friend'), 'silent');
});

test('play: a speech engine that throws is silent, never an exception', async () => {
  const audio = createAudio({
    makeAudio: () => fakeElement({ load: 'error' }),
    speech: {
      speak() {
        throw new Error('speech synthesis unavailable');
      },
      cancel() {},
    },
    makeUtterance,
    config: { loadTimeoutMs: 50 },
  });

  assert.equal(await audio.play('silent'), 'silent');
});

test('play: a word that cannot name a cached file goes straight to speech', async () => {
  const { audio, speech, elements } = playerWith({ load: 'ready' });

  assert.equal(await audio.play('../secret'), 'tts');
  assert.equal(elements.length, 0);
  assert.equal(speech.spoken.length, 1);
});

// --- not talking over itself ---------------------------------------------

test('play: the previous word is silenced before the next one starts', async () => {
  const { audio, speech, elements } = playerWith({ load: 'ready' });

  await audio.play('cat');
  await audio.play('hat');

  assert.equal(elements[0].paused, true);
  assert.ok(speech.cancels > 0);
});

test('stop: silences both sources', async () => {
  const { audio, speech, elements } = playerWith({ load: 'ready' });

  await audio.play('friend');
  const before = speech.cancels;
  audio.stop();

  assert.equal(elements[0].paused, true);
  assert.equal(speech.cancels, before + 1);
});

test('stop: safe before anything has played', () => {
  const { audio } = playerWith();
  assert.doesNotThrow(() => audio.stop());
});

// --- preload --------------------------------------------------------------

test('preload: warms a word without playing it', async () => {
  const { audio, speech, elements } = playerWith({ load: 'ready' });

  audio.preload('friend');
  assert.equal(elements.length, 1);
  assert.equal(elements[0].played, 0);
  assert.equal(speech.spoken.length, 0);

  // And the warmed element is the one that then plays.
  assert.equal(await audio.play('friend'), 'mp3');
  assert.equal(elements.length, 1);
  assert.equal(elements[0].played, 1);
});

test('preload: an unplayable word is not an error', () => {
  const { audio } = playerWith({ load: 'ready' });
  assert.doesNotThrow(() => audio.preload(''));
});
