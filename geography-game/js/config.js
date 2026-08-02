// The single tunables table for the geography game.
//
// Everything about the KID lives here; nothing about the keyboard does — see
// core/typing-cost.js, which takes its tables from the keymap and only its dial
// from this file.
//
// Every magic number in this game lives here and nowhere else. Modules take
// `config` as a parameter rather than importing this, so the same log can be
// replayed under a different table offline.
//
// WHICH KEYS THE SHARED CORE READS — the same grouping the math and spelling
// tables document. Do not rename one without grepping the module beside it.
//
//   core/mastery.js   retain, hotMs, maxPlausibleMs
//   core/scheduler.js weights, noRepeatWithin, governorWindow, governorFloor
//   core/engine.js    build
//   core/typing-cost.js typingWeightFloor
//   game-only         sessionLength, windowSize, logTail, and the map framing

export const CONFIG = {
  // Stamped on every logged event. Bump it whenever weights, delays or
  // thresholds change, so a before/after comparison across the log is a filter
  // rather than a guess.
  build: 'g1',

  // --- read by the shared core ---
  weights: { cold: 6, warm: 3, hot: 1 },
  noRepeatWithin: 4,
  governorWindow: 10,
  governorFloor: 0.6,
  retain: 5,
  maxPlausibleMs: 60_000,

  // Spelling's 4000, not math's 1500, and for spelling's exact reason: a
  // multiplication answer is one or two keystrokes, and a country name is seven
  // on the median. Sharing math's threshold would report a fluent kid as
  // permanently warm and stop the frontier ever advancing.
  //
  // A GUESS, expected to be wrong, and one line to retune against real history.
  hotMs: 4000,

  // --- game only ---
  sessionLength: 20,
  windowSize: 12,
  typingWeightFloor: 0.25,
  logTail: 2000,

  // The map prompt's context, in projected units where the world is 2000 wide.
  //
  // contextFactor is the multiple of the country's larger dimension the view
  // shows. 4 is enough to put Belize among its neighbours, which is the entire
  // pedagogical content of the prompt: Central America with one country lit is
  // an answerable question, and Belize alone on white is not.
  //
  // The floor stops a tiny island filling the frame; the ceiling stops Russia
  // dragging the view out to the whole world. Both are judgement calls that only
  // real play can settle -- see the spec's open questions.
  contextFactor: 4,
  minContextSpan: 120,
  maxContextSpan: 900,
};
