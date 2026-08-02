// typing-game/js/content/home.js
//
// Rungs 0-1. See content.js for the two authoring rules; the validator in
// tests/content.test.js enforces both.
//
// home-base has only asdfjkl; to work with, which is about a dozen real English
// words in total. Do not pad it with non-words to hit a target — the drills
// carry this rung.

export const HOME = {
  'home-base': {
    drills: [
      'asdf jkl;', 'fj fj fj', 'dk dk dk', 'sl sl sl', 'a; a; a;',
      'fjdk slas', 'jf kd ls ;a', 'ff jj dd kk', 'as df jk l;',
      'lad sad fad', 'ask all add', 'dad lad fads',
    ],
    words: [
      'ask', 'sad', 'lad', 'dad', 'fad', 'all', 'fall', 'flask',
      'salad', 'alas', 'falls', 'asks',
    ],
    sentences: [],
  },

  'home-stretch': {
    drills: [
      'gh gh gh', 'fg fg fg', 'jh jh jh', 'gg hh gg', 'fgh jhg',
      'gas has had', 'lash gash dash', 'flag glad half',
    ],
    words: [
      'gas', 'has', 'had', 'hall', 'half', 'flag', 'glad', 'gash',
      'lash', 'dash', 'shall', 'flash', 'shag', 'gala',
    ],
    sentences: [],
  },
};
