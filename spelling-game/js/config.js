// The single tunables table for the spelling game.
//
// Every magic number in this game lives here and nowhere else. Modules take
// `config` as a parameter rather than importing this, so the same log can be
// replayed under a different table offline (tools/replay.js).
//
// `build` is stamped on every logged event. Bump it whenever weights, delays or
// thresholds change, so a before/after comparison across the log is a filter
// rather than a guess.
//
// WHICH KEYS THE SHARED CORE READS — the same grouping math's table documents,
// and the reason that grouping exists. The core needs every key in the first
// four groups; this game is free to give them different values, and does.
//
//   core/mastery.js   retain, hotMs, maxPlausibleMs
//   core/scheduler.js weights, noRepeatWithin, governorWindow, governorFloor
//   core/engine.js    build
//   core/log.js       logTail
//   game-only         mode, sessionLength, learnWords, learnPasses, windowSize,
//                     delays, letterStepMs, typingWeightFloor

export const CONFIG = {
  build: 's1',

  // Which mode a session runs in when the URL carries no ?mode= parameter. The
  // menu links to ?mode=learn and ?mode=drill, so this is a fallback for opening
  // index.html directly, not the primary mechanism.
  mode: 'drill',

  sessionLength: 20,

  // Learn mode: one word family, cycled. Blocked and repetitive where drill is
  // broad and interleaved — blocked practice is right for ACQUISITION, because a
  // pattern needs consecutive reps before it is a pattern, and wrong for
  // retention. That opposition is the whole design, not an accident of tuning.
  //
  // `learnPasses` is a FLOOR, not a fixed count: a short family raises it so the
  // session holds roughly `learnWords * learnPasses` items however many words the
  // family happens to have. A kid should not get a six-item session because
  // -ought only has four members.
  learnWords: 4,
  learnPasses: 3,

  // How many non-hot words the frontier exposes at once. The kid's level is
  // never stored — it is derived from the log every session — and this is the
  // only number controlling how wide that derived window is.
  windowSize: 20,

  retain: 5,

  // NOT math's 1500ms, and this is the single most important difference between
  // the two tables. A multiplication answer is one or two keystrokes; a word is
  // five or six, and typing "friend" takes longer than 1500ms even when the kid
  // knows the spelling cold. Sharing math's threshold would report a fluent
  // speller as permanently warm, which would then keep the frontier from ever
  // advancing past words she already owns.
  //
  // 4000 is a GUESS and is expected to be wrong. It is one line, and
  // tools/replay.js can retune it against collected history rather than against
  // an argument.
  hotMs: 4000,

  // Above this, an attempt is not evidence of retrieval — it is evidence the kid
  // left the room. Only affects derivation, so changing it re-reads all history
  // rather than losing anything.
  maxPlausibleMs: 60_000,

  // Drill's RETRIEVAL WINDOW: how long before the FIRST letter greys into its
  // slot. THE DELAY GROWS WITH MASTERY — it does not shrink. A brand-new word is
  // rescued soonest, which keeps acquisition errorless; a nearly-mastered one is
  // made to work for it, because retrieval effort is the point at that stage.
  // This looks backwards and is not.
  delays: { cold: 4000, warm: 6000, hot: 8000 },

  // Each subsequent letter after the first. Spelling reveals one letter at a
  // time rather than the whole word: a word handed over whole is copied, and a
  // word handed over letter by letter is still partly retrieved.
  letterStepMs: 1200,

  // How long a homophone is shown before the kid has to spell it.
  //
  // THIS IS PROMPT TIME, NOT HELP TIME. For `sea` the sound alone is not a
  // question — `see` is an equally correct reading of everything she was told —
  // so the word on screen IS the question, and this is how long she gets to read
  // it. Only words in js/homophones.js are flashed, and only in drill; learn
  // already has the word on screen throughout.
  //
  // 1500ms: long enough to read a short word twice at seven years old, and long
  // enough to cover the ~500ms pronunciation so the sound and the spelling are
  // seen together, which is the association worth building. Short enough that
  // the word is gone well before she finishes typing, so this stays spelling
  // rather than copying.
  //
  // The problem's clock starts AFTER this, so it costs her nothing against
  // `hotMs` — see runProblem.
  homophoneFlashMs: 1500,

  weights: { cold: 6, warm: 3, hot: 1 },

  // The floor on the typing-difficulty dial. An awkward word is served about a
  // quarter as often as a comfortable one — less, but never effectively never.
  // Typing difficulty is a reason to defer a word, not to abandon it.
  typingWeightFloor: 0.25,

  noRepeatWithin: 4,
  governorWindow: 8,
  governorFloor: 0.8,

  logTail: 2000,
};
