// typing-game/js/content/top.js
//
// Rungs 2-6. Task 13 fills top-ru through top-qp; top-ei is seeded here as the
// worked example.
//
// Every sentence is lowercase and unpunctuated. Capitals arrive at shift-caps
// and the period at bot-x-period, so writing "The lad slid." here would be
// wrong even though it reads better. See content.js.

export const TOP = {
  'top-ei': {
    drills: [
      'did die kid', 'fed lea sid', 'ei ei ei', 'de de de', 'ki ki ki',
      'kid lid did', 'fie die lie', 'held field',
    ],
    words: [
      'slide', 'field', 'said', 'slid', 'held', 'shed', 'lied', 'died',
      'ideal', 'shield', 'defies', 'jailed',
    ],
    // No 't' in these — it does not arrive until top-ty, so "the" is off limits
    // for three more rungs. This is the constraint that makes early sentences
    // hard to write and is exactly what the validator checks.
    sentences: [
      'she had a field',
      'he did like his kid',
      'his lad slid',
      'she has a shield',
      'he held his flag',
      'a sad file',
      'she likes his dad',
      'she fed his kid',
    ],
  },
};
