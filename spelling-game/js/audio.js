// Saying the word out loud — an IMPURE module by design, like core/log.js.
//
// Two sources, in preference order:
//   1. the cached Merriam-Webster mp3 at /data/audio/<word>.mp3
//   2. the browser's own speechSynthesis
//
// NOTHING HERE EVER TALKS TO MERRIAM-WEBSTER. The mp3 is a same-origin request
// to our own localhost server for a file tools/fetch-words.js put on disk hours
// or days earlier; the fallback is the operating system's voice, not a live
// lookup. A session makes no request that leaves the machine. That is not an
// optimisation — a kid's game must not phone anyone, and a play-time API call
// would also spend a 1000/day quota on words the ingest already has.
//
// THE FALLBACK IS THE DEFAULT EXPERIENCE, NOT THE DEGRADED ONE. Anyone who
// clones this repo has no MW_KEY and an empty cache, and the game has to be
// fully playable for them — so the TTS path is the one that must always work,
// and the mp3 is the quality tier layered on top (spec §5). Every failure here
// therefore falls forward to speech rather than throwing: a missing file, a
// server that is not serving it, a browser with no speech support at all. The
// worst outcome is silence, never a broken session.
//
// The impurity is deliberately contained: this module touches Audio and
// speechSynthesis so that no screen and no pure module has to. Both are injected
// with defaults, which is what lets the tests exercise every branch with no DOM,
// no network and no speech engine.

/**
 * Everything tunable, in one table.
 *
 * These are not in spelling-game/js/config.js because none of them is a game
 * rule the replay tool would ever want to vary — they are properties of playing
 * a sound, in the one module that plays sounds. Same reasoning as `OUTBOX_MAX`
 * living in core/log.js.
 */
const AUDIO = {
  // Server-root-relative, matching where tools/fetch-words.js writes. The
  // leading slash matters: the game is served from /spelling-game/, and a
  // relative path would look for the cache inside it.
  cacheDir: '/data/audio',

  // Slower than conversational. The kid is not listening for meaning, they are
  // listening for the phonemes they have to spell, and the default rate runs
  // `friend` past them in under half a second.
  ttsRate: 0.8,
  ttsPitch: 1,
  ttsLang: 'en-US',

  // How long to wait for a cached file to become playable before speaking the
  // word instead. A local file that has not reported ready by now is either
  // absent or being served by something too slow to be worth waiting on, and
  // silence while a child stares at empty slots is the worse failure. The load
  // promise is kept, so a slow first play does not cost anything on the second.
  loadTimeoutMs: 2000,

  // The spine contract: lowercase a–z, no spaces, no punctuation. Checked rather
  // than trusted, because this value is interpolated into a URL. It makes "never
  // requests anything but a local mp3" structural instead of a convention.
  playableWord: /^[a-z]+$/,
};

/**
 * The cache URL for a word, or null if the word could not name a cached file.
 *
 * Pure, and exported so the URL shape is pinned by a test rather than by hope —
 * a wrong prefix here is a 404 that silently downgrades every word in the game
 * to speech synthesis, which still sounds like a working game.
 *
 * @param {unknown} word
 * @param {{cacheDir: string, playableWord: RegExp}} [config]
 * @returns {string | null}
 */
export function cachedUrlFor(word, config = AUDIO) {
  if (typeof word !== 'string' || !config.playableWord.test(word)) {
    return null;
  }
  return `${config.cacheDir}/${word}.mp3`;
}

/**
 * Build the audio player.
 *
 * Every dependency has a default that reads the real browser API, so callers
 * write `createAudio()` and tests pass fakes.
 *
 * @param {{
 *   makeAudio?: (src: string) => object,
 *   speech?: object | null,
 *   makeUtterance?: (text: string) => object,
 *   config?: object,
 * }} [options]
 * @returns {{
 *   play: (word: string) => Promise<'mp3' | 'tts' | 'silent'>,
 *   preload: (word: string) => void,
 *   stop: () => void,
 * }}
 */
export function createAudio(options = {}) {
  // Merged, not replaced, so a caller can override one value without having to
  // restate the whole table and silently drop whatever is added to it later.
  const config = { ...AUDIO, ...(options.config ?? {}) };
  const makeAudio = options.makeAudio ?? defaultMakeAudio;
  const makeUtterance = options.makeUtterance ?? defaultMakeUtterance;
  // `null` is a meaningful value here — a caller can disable speech explicitly —
  // so this reads `undefined` rather than using `??` against the global.
  const speech = options.speech !== undefined ? options.speech : defaultSpeech();

  /**
   * word -> Promise<element | null>. Keyed by word and never invalidated: a mp3
   * either exists for the whole session or does not, and re-probing a missing
   * file once per repetition would put a 404 in the console for every rep of
   * every uncached word.
   */
  const loading = new Map();
  let playing = null;

  /**
   * Resolve to a playable element, or null when there is no cached file.
   *
   * Both outcomes are normal. An empty cache is the expected state of a fresh
   * clone, so a missing file is not logged and not retried.
   *
   * @param {string} word
   * @returns {Promise<object | null>}
   */
  function load(word) {
    const existing = loading.get(word);
    if (existing !== undefined) {
      return existing;
    }

    const url = cachedUrlFor(word, config);
    const attempt =
      url === null
        ? Promise.resolve(null)
        : new Promise((settle) => {
            let element;
            try {
              element = makeAudio(url);
            } catch {
              settle(null); // no Audio constructor at all
              return;
            }
            // `loadeddata` as well as `canplaythrough`: the second is the honest
            // signal but browsers withhold it under some preload heuristics, and
            // a pronunciation is under a second long — once there is data there
            // is effectively the whole file.
            const ready = () => settle(element);
            element.addEventListener?.('canplaythrough', ready, { once: true });
            element.addEventListener?.('loadeddata', ready, { once: true });
            element.addEventListener?.('error', () => settle(null), { once: true });
            element.preload = 'auto';
            element.load?.();
          });

    loading.set(word, attempt);
    return attempt;
  }

  /**
   * Speak the word with the browser's voice.
   *
   * @param {string} word
   * @returns {'tts' | 'silent'}
   */
  function speak(word) {
    if (speech === null || typeof speech.speak !== 'function') {
      return 'silent'; // no speech engine — the game still plays, just quietly
    }
    try {
      // Cancel first: an unfinished utterance from the previous word would
      // otherwise queue behind it, and the kid would hear the wrong word.
      speech.cancel?.();
      const utterance = makeUtterance(word);
      utterance.rate = config.ttsRate;
      utterance.pitch = config.ttsPitch;
      utterance.lang = config.ttsLang;
      speech.speak(utterance);
      return 'tts';
    } catch {
      return 'silent';
    }
  }

  /**
   * Say the word. Never throws and never rejects.
   *
   * The return value names the source that was actually used, which is for tests
   * and for a future diagnostics line — no screen should ever branch on it, or
   * the two paths stop being interchangeable.
   *
   * @param {string} word
   * @returns {Promise<'mp3' | 'tts' | 'silent'>}
   */
  async function play(word) {
    stop();

    // Race the load, so a stalled request cannot leave a child in silence. The
    // load promise itself stays in the map and settles on its own time.
    let element = null;
    try {
      element = await withTimeout(load(word), config.loadTimeoutMs);
    } catch {
      element = null;
    }

    if (element !== null) {
      try {
        element.currentTime = 0;
        // In browsers this resolves when playback begins and rejects when it is
        // blocked; awaiting it is what lets a blocked play still reach speech.
        await element.play?.();
        playing = element;
        return 'mp3';
      } catch {
        // Decode failure, or autoplay policy before the first keystroke. Speech
        // is subject to the same policy and may also be silent, which is fine:
        // the game is playable without sound and audible from the next word on.
      }
    }

    return speak(word);
  }

  /**
   * Warm the cache for a word without playing it — call it for the next word
   * while the kid is typing this one, so its audio starts instantly.
   *
   * @param {string} word
   * @returns {void}
   */
  function preload(word) {
    load(word);
  }

  /**
   * Silence whatever is currently sounding. Called before each new word, and
   * available for a screen to call when it unmounts.
   *
   * @returns {void}
   */
  function stop() {
    if (playing !== null) {
      try {
        playing.pause?.();
      } catch {
        // Already ended or detached. Nothing to do.
      }
      playing = null;
    }
    try {
      speech?.cancel?.();
    } catch {
      // Some engines throw when cancelling an empty queue.
    }
  }

  return { play, preload, stop };
}

/**
 * Resolve to `null` if `promise` has not settled within `ms`.
 *
 * The timer is cleared either way. An uncleared timer is invisible in a browser
 * and holds the whole process open in `node --test`, which turns a passing suite
 * into one that hangs for two seconds per call.
 *
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T | null>}
 * @template T
 */
function withTimeout(promise, ms) {
  let timer;
  const expiry = new Promise((settle) => {
    timer = setTimeout(() => settle(null), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

/** @returns {object} a real HTMLAudioElement */
function defaultMakeAudio(src) {
  return new globalThis.Audio(src);
}

/** @returns {object} a real SpeechSynthesisUtterance */
function defaultMakeUtterance(text) {
  return new globalThis.SpeechSynthesisUtterance(text);
}

/**
 * The real speech engine, or null where there is none. Accessing it is guarded
 * because some privacy modes throw on the property rather than omitting it —
 * the same defensive read core/log.js uses for localStorage.
 *
 * @returns {object | null}
 */
function defaultSpeech() {
  try {
    return globalThis.speechSynthesis ?? null;
  } catch {
    return null;
  }
}
