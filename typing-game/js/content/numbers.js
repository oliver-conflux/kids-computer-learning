// typing-game/js/content/numbers.js
//
// The number track (spec §2a). A separate ladder, not rungs 14-18 of the letter
// one — see the header of curriculum.js for why.
//
// Digits and space ONLY. There are no sentences here and there never will be:
// digits alone cannot make one, and reaching for a letter to prop one up would
// break the track's alphabet. Math-flavoured mixed items live in practice.js,
// which is exempt from the validator.
//
// "words" on this track means a realistic number string — an age, a year, a
// house number, a math answer. The early rungs have two or four digits to work
// with, so their numbers are necessarily repetitive; that is the reach drill
// doing its job, not a gap to be padded with something clever.
//
// The laptops have no numpad. Every one of these is the top row.

export const NUMBERS = {
  // 3 8 — middle fingers, two rows up from d and k.
  'num-38': {
    drills: [
      '33 88', '38 38', '83 83', '333 888', '38 83',
      '3 8 3 8', '8 3 8 3', '88 33 88', '33 88 33', '383 838',
      '338 883', '3838', '8383', '88 38 83', '333 383 338',
      '888 838 883', '3 33 333', '8 88 888', '38 388 3888', '83 833 8333',
    ],
    words: [
      '38', '83', '33', '88', '383', '838', '833', '388',
      '888', '333', '3388', '8833', '3883', '8338', '38383',
    ],
    sentences: [],
  },

  // 4 7 — index fingers, straight up from f and j.
  'num-47': {
    drills: [
      '44 77', '47 47', '74 74', '444 777', '47 74',
      '4 7 4 7', '7 4 7 4', '34 87', '43 78', '48 73',
      '84 37', '447 774', '474 747', '4747', '7474',
      '3 4 7 8', '8 7 4 3', '44 33 77 88', '347 874', '4 44 444',
    ],
    words: [
      '47', '74', '44', '77', '747', '474', '3478', '8743',
      '4747', '7788', '3344', '478', '734', '843', '377',
    ],
    sentences: [],
  },

  // 5 6 — index fingers up and inward. The hardest reach on the board.
  'num-56': {
    drills: [
      '55 66', '56 56', '65 65', '555 666', '56 65',
      '5 6 5 6', '6 5 6 5', '45 76', '54 67', '35 86',
      '53 68', '556 665', '565 656', '5656', '6565',
      '4 5 6 7', '7 6 5 4', '55 44 66 77', '345 678', '5 55 555',
    ],
    words: [
      '56', '65', '55', '66', '365', '456', '567', '654',
      '3456', '5678', '7654', '5566', '4356', '8765', '666',
    ],
    sentences: [],
  },

  // 2 9 — ring fingers, two rows up from s and l.
  'num-29': {
    drills: [
      '22 99', '29 29', '92 92', '222 999', '29 92',
      '2 9 2 9', '9 2 9 2', '24 97', '42 79', '23 98',
      '32 89', '229 992', '292 929', '2929', '9292',
      '2 3 4 5', '9 8 7 6', '22 33 99 88', '234 987', '2 22 222',
    ],
    words: [
      '29', '92', '22', '99', '229', '992', '2345', '9876',
      '2468', '3579', '6789', '9432', '747', '5628', '9292',
    ],
    sentences: [],
  },

  // 1 0 - = ! — pinkies. The exclamation mark is shift-1, and it is the whole
  // reason a kid will put up with the pinky reach at all.
  'num-10': {
    drills: [
      '11 00', '10 01', '111 000', '1 0 1 0', '0 1 0 1',
      '110 001', '101 010', '1010', '0101', '1 2 3 4 5',
      '6 7 8 9 0', '100 010 001', '1 11 111', '1234567890', '-- == --',
      '1 - 0 = 1', '10 - 1 = 9', '5 - 4 = 1', '100 - 10 = 90', '10! 100! 1000!',
    ],
    words: [
      '10', '100', '1000', '10000', '2026', '911', '747', '365',
      '60', '24', '12', '50', '25', '101', '1000000',
    ],
    sentences: [],
  },
};
