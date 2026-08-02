// typing-game/js/content/home.js
//
// Rungs 0-5. See content.js for the two authoring rules; the validator in
// tests/content.test.js enforces both.
//
// Six rungs on nine keys, because this is where a kid spends the longest on the
// fewest keys and two rungs made it a grind. `home-base`, `home-words` and
// `home-stretch-words` teach no new key — they are siblings, differing only in
// what they ask the kid to type.
//
// SPELLING-SPINE WORDS GET REPS. These fourteen are the only words in
// spelling-game/js/spine.js typeable on the home row, so they appear in every
// rung whose keys allow them rather than once each:
//
//   asdfjkl;  a  as  add  ask  all  sad  dad  fall
//   + g h     had  has  gas  half  glass  shall
//
// Nothing enforces this — if you thin these pools, keep those words. The rest
// is ordinary English and standard finger drills.
//
// There are about two dozen real home-row words in total. Do not pad to hit a
// target; the drills carry the early rungs.

export const HOME = {
  'home-left': {
    drills: [
      'asdf asdf', 'fdsa fdsa', 'ff dd ss aa', 'af af af', 'sd sd sd',
      'fa da sa', 'asdf fdsa', 'aa ss dd ff', 'ad ad ad', 'fs fs fs',
      'sad fad ads', 'dad add ads',
    ],
    words: [
      'a', 'as', 'ad', 'add', 'adds', 'ads',
      'sad', 'dad', 'dads', 'fad', 'fads',
    ],
    sentences: [],
  },

  'home-right': {
    drills: [
      'jkl; jkl;', ';lkj ;lkj', 'jj kk ll ;;', 'jk jk jk', 'l; l; l;',
      'kl kl kl', 'j; j; j;', 'jkl; ;lkj', 'fj dk sl a;', 'jj ff kk dd',
      'ask all ads', 'lad lads all',
    ],
    words: [
      'all', 'ask', 'asks', 'fall', 'falls', 'lad', 'lads',
      'flask', 'alas', 'salad', 'a', 'as', 'sad', 'dad',
    ],
    sentences: [],
  },

  'home-base': {
    drills: [
      'asdf jkl;', 'fj fj fj', 'dk dk dk', 'sl sl sl', 'a; a; a;',
      'fjdk slas', 'jf kd ls ;a', 'ff jj dd kk', 'as df jk l;',
      'lad sad fad', 'ask all add', 'dad lad fads',
    ],
    words: [
      'a', 'as', 'add', 'ask', 'all', 'sad', 'dad', 'fad',
      'lad', 'fall', 'asks', 'ads', 'lads', 'salad',
    ],
    sentences: [],
  },

  'home-words': {
    drills: [
      'a as add', 'ask all adds', 'sad lad fad', 'dad adds salad',
      'falls flask', 'lads ads fads',
    ],
    words: [
      'a', 'as', 'ad', 'add', 'adds', 'ads', 'ask', 'asks', 'all',
      'fall', 'falls', 'sad', 'dad', 'dads', 'fad', 'fads', 'lad',
      'lads', 'salad', 'flask', 'alas', 'lass',
    ],
    sentences: [],
  },

  'home-stretch': {
    drills: [
      'gh gh gh', 'fg fg fg', 'jh jh jh', 'gg hh gg', 'fgh jhg',
      'gas has had', 'lash gash dash', 'flag glad half',
      'gash hash sash', 'glass half hall',
    ],
    words: [
      'gas', 'has', 'had', 'hall', 'half', 'glass', 'shall',
      'flag', 'glad', 'gash', 'lash', 'dash', 'hash', 'flash',
      'shag', 'gala',
    ],
    sentences: [],
  },

  'home-stretch-words': {
    drills: [
      'had has half', 'glass shall gas', 'flag glad flash',
      'a as add ask', 'gash lash dash', 'all fall halls',
    ],
    words: [
      'had', 'has', 'gas', 'half', 'glass', 'shall',
      'a', 'as', 'add', 'ask', 'all', 'sad', 'dad', 'fall',
      'hall', 'halls', 'flag', 'flags', 'glad', 'flash',
      'gash', 'lash', 'dash', 'hash', 'sash', 'shag', 'gala',
      'salad', 'flask',
    ],
    sentences: [],
  },
};
