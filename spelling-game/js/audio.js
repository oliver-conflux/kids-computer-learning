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

  // How long to wait for a `start` event before calling the speech attempt
  // silent. Chrome queues an utterance indefinitely in a background or unfocused
  // tab and fires NO event either way, while reporting `speaking: true` — so
  // without this the game waits forever on a sound that will never play. A
  // second is far longer than a real engine takes to begin and short enough that
  // a kid is not left staring at empty boxes wondering.
  ttsStartTimeoutMs: 1000,
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
   * Speak the word with the browser's voice, and WAIT TO SEE IF IT ACTUALLY
   * STARTED.
   *
   * This used to call `speech.speak()` and return 'tts' on the next line. That
   * is wrong, and wrong in the way that matters most in this particular game.
   *
   * `speechSynthesis.speak()` is fire-and-forget and reports nothing. Chrome
   * queues the utterance and declines to start it in a background or unfocused
   * tab, and — this is the part that makes it dangerous — `speechSynthesis
   * .speaking` reads TRUE the whole time. Measured here: `speaking: true`,
   * `pending: false`, `paused: false`, and after 3.4 seconds neither `start` nor
   * `error` had fired. Nothing throws, nothing logs, no request is made. The old
   * code returned 'tts' into that silence.
   *
   * In the math game a missed sound would be a nicety. Here the sound IS the
   * question: with no audio the kid is looking at a row of empty boxes with
   * literally no way to know which word is being asked for. Reporting success we
   * have not observed is how that reaches a child as "the game is broken".
   *
   * So: resolve on `start`, on `error`, or on a timeout, whichever comes first.
   *
   * @param {string} word
   * @returns {Promise<'tts' | 'silent'>}
   */
  function speak(word) {
    if (speech === null || typeof speech.speak !== 'function') {
      return Promise.resolve('silent'); // no engine — the game still plays, quietly
    }
    return new Promise((resolve) => {
      let settled = false;
      const settle = (outcome) => {
        if (!settled) {
          settled = true;
          resolve(outcome);
        }
      };

      try {
        // Cancel first: an unfinished utterance from the previous word would
        // otherwise queue behind it and the kid would hear the wrong word.
        speech.cancel?.();
        const utterance = makeUtterance(word);
        utterance.rate = config.ttsRate;
        utterance.pitch = config.ttsPitch;
        utterance.lang = config.ttsLang;

        // `start` is the only honest evidence that a sound was produced.
        utterance.addEventListener?.('start', () => settle('tts'), { once: true });
        utterance.addEventListener?.('error', () => settle('silent'), { once: true });

        speech.speak(utterance);

        // The queued-forever case, which is the common one and fires no event at
        // all. Resolving 'silent' does NOT cancel the utterance — if it starts
        // late the kid still hears it; we simply stop claiming it worked.
        setTimeout(() => settle('silent'), config.ttsStartTimeoutMs);
      } catch {
        settle('silent');
      }
    });
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
        // is subject to the same policy and may be silent too — which is NOT
        // fine here and must not be swallowed. Drill mode asks "spell the word
        // you just heard"; a kid who heard nothing is looking at empty boxes
        // with no way to know what is wanted. `speak` reports honestly and the
        // caller is expected to act on 'silent'.
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
