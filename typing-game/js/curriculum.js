// typing-game/js/curriculum.js
//
// The two curriculum tracks (spec §2 and §2a).
//
// LETTERS is ordered by English letter frequency first, then ergonomics, then
// finger strength, then mirrored pairs. Top row before bottom row is not
// arbitrary: the top row is ~51% of English text and the bottom ~15%.
//
// NUMBERS is a SEPARATE, UNGATED track, not rungs 14-18 of the letter ladder.
// Digits are rarer in prose than any bottom-row letter, so folding them into a
// frequency-ordered ladder would break its own ordering rule — but the kids type
// digits daily in the math game, so gating them behind `z /` is worse. A
// parallel track keeps both honest. availableKeys therefore accumulates WITHIN
// a track and never across.
//
// Pure module: no DOM, no network, no clock, no randomness.

// A rung with `newKeys: []` teaches no key. It is a SIBLING of the rung above
// it — same availableKeys, different content — and it exists because the home
// row is where a kid spends the longest on the fewest keys. Six short rungs on
// nine keys beat two long ones, and each sibling carries its own stars, which
// is the whole pull to play it.
const LETTER_RUNGS = [
  { id: 'home-left',     title: 'Left hand',       newKeys: [...'asdf', ' '],
    hint: 'Left fingers on a s d f. Feel the bump on f. Thumbs on the space bar.',
    mix: { drills: 8, words: 2, sentences: 0 } },
  { id: 'home-right',    title: 'Right hand',      newKeys: [...'jkl;'],
    hint: 'Right fingers on j k l semicolon. Feel the bump on j.',
    mix: { drills: 7, words: 3, sentences: 0 } },
  { id: 'home-base',     title: 'Home row',        newKeys: [],
    hint: 'Both hands now. All eight fingers rest on the home row.',
    mix: { drills: 5, words: 5, sentences: 0 } },
  { id: 'home-words',    title: 'Home row words',  newKeys: [],
    hint: 'Real words this time. Bring your fingers home between each one.',
    mix: { drills: 2, words: 8, sentences: 0 } },
  { id: 'home-stretch',  title: 'Home stretch',    newKeys: [...'gh'],
    hint: 'Stretch your index finger inward, then bring it straight back.',
    mix: { drills: 5, words: 5, sentences: 0 } },
  { id: 'home-stretch-words', title: 'Home stretch words', newKeys: [],
    hint: 'More words, now that g and h are yours.',
    mix: { drills: 2, words: 8, sentences: 0 } },
  { id: 'top-ei',        title: 'Top row: e i',    newKeys: [...'ei'],
    hint: 'Middle fingers reach straight up.',
    mix: { drills: 4, words: 4, sentences: 2 } },
  { id: 'top-ru',        title: 'Top row: r u',    newKeys: [...'ru'],
    hint: 'Index fingers reach straight up.',
    mix: { drills: 4, words: 4, sentences: 2 } },
  { id: 'top-ty',        title: 'Top row: t y',    newKeys: [...'ty'],
    hint: 'Index fingers reach up and inward. This one is a stretch.',
    mix: { drills: 4, words: 4, sentences: 2 } },
  { id: 'top-wo',        title: 'Top row: w o',    newKeys: [...'wo'],
    hint: 'Ring fingers reach straight up.',
    mix: { drills: 3, words: 4, sentences: 3 } },
  { id: 'top-qp',        title: 'Top row: q p',    newKeys: [...'qp'],
    hint: 'Pinkies reach up. Q is the rarest letter in English.',
    mix: { drills: 3, words: 4, sentences: 3 } },
  { id: 'bot-vm',        title: 'Bottom row: v m', newKeys: [...'vm'],
    hint: 'Index fingers curl straight down.',
    mix: { drills: 3, words: 4, sentences: 3 } },
  { id: 'bot-nb',        title: 'Bottom row: n b', newKeys: [...'nb'],
    hint: 'Index fingers curl down and inward.',
    mix: { drills: 3, words: 4, sentences: 3 } },
  { id: 'bot-c-comma',   title: 'Bottom row: c ,', newKeys: [...'c,'],
    hint: 'Middle fingers curl down.',
    mix: { drills: 3, words: 4, sentences: 3 } },
  { id: 'bot-x-period',  title: 'Bottom row: x .', newKeys: [...'x.'],
    hint: 'Ring fingers curl down. Now sentences can end properly.',
    mix: { drills: 3, words: 4, sentences: 3 } },
  { id: 'bot-z-slash',   title: 'Bottom row: z /', newKeys: [...'z/'],
    hint: 'Pinkies curl down. That is the whole alphabet.',
    mix: { drills: 3, words: 3, sentences: 4 } },
  { id: 'shift-caps',    title: 'Shift & capitals', newKeys: ['Shift'],
    hint: 'Use the shift on the OPPOSITE hand from the letter.',
    mix: { drills: 3, words: 3, sentences: 4 } },
  { id: 'punctuation',   title: 'Punctuation',     newKeys: [...`?'":`],
    hint: 'Pinkies again, mostly with shift.',
    mix: { drills: 3, words: 3, sentences: 4 } },
];

const NUMBER_RUNGS = [
  { id: 'num-38', title: 'Numbers: 3 8', newKeys: [...'38', ' '],
    hint: 'Middle fingers reach two rows up.',
    mix: { drills: 7, words: 3, sentences: 0 } },
  { id: 'num-47', title: 'Numbers: 4 7', newKeys: [...'47'],
    hint: 'Index fingers reach two rows up.',
    mix: { drills: 7, words: 3, sentences: 0 } },
  { id: 'num-56', title: 'Numbers: 5 6', newKeys: [...'56'],
    hint: 'Index fingers reach up and inward. The hardest reach on the board.',
    mix: { drills: 7, words: 3, sentences: 0 } },
  { id: 'num-29', title: 'Numbers: 2 9', newKeys: [...'29'],
    hint: 'Ring fingers reach two rows up.',
    mix: { drills: 6, words: 4, sentences: 0 } },
  { id: 'num-10', title: 'Numbers: 1 0', newKeys: [...'10-=!'],
    hint: 'Pinkies. The exclamation mark is shift-1.',
    mix: { drills: 6, words: 4, sentences: 0 } },
];

/**
 * Accumulate availableKeys down a track, so it can never drift from newKeys.
 *
 * 'Shift' is a sentinel rather than a literal key: what it actually unlocks is
 * the uppercase form of every letter taught so far. Expanding it here is what
 * lets the shift-caps rung's content contain capitals at all — without the
 * expansion, the validator rejects every capital on the one rung whose entire
 * purpose is capitals.
 */
function buildTrack(rungs, track) {
  const seen = [];
  return rungs.map((rung) => {
    for (const key of rung.newKeys) {
      if (key === 'Shift') {
        for (const taught of [...seen]) {
          const upper = taught.toUpperCase();
          if (upper !== taught && !seen.includes(upper)) seen.push(upper);
        }
      } else if (!seen.includes(key)) {
        seen.push(key);
      }
    }
    return { ...rung, track, availableKeys: [...seen] };
  });
}

export const LESSONS = [
  ...buildTrack(LETTER_RUNGS, 'letters'),
  ...buildTrack(NUMBER_RUNGS, 'numbers'),
];

/**
 * @param {string} id
 * @returns {object | null} the lesson, or null if the id is unknown
 */
export function lessonById(id) {
  return LESSONS.find((l) => l.id === id) ?? null;
}

/**
 * @param {string} track 'letters' or 'numbers'
 * @returns {object[]} that track's lessons, in order
 */
export function lessonsForTrack(track) {
  return LESSONS.filter((l) => l.track === track);
}

/**
 * The next lesson in the SAME track. Tracks do not run into one another.
 *
 * @param {string} id
 * @returns {object | null} null at the end of a track or for an unknown id
 */
export function nextLesson(id) {
  const lesson = lessonById(id);
  if (lesson === null) return null;
  const siblings = lessonsForTrack(lesson.track);
  const index = siblings.findIndex((l) => l.id === id);
  return siblings[index + 1] ?? null;
}
