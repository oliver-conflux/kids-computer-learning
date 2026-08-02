// typing-game/js/content/bottom.js
// Rungs 7-11. Authored in Task 13.
//
// The bottom row is where the ladder stops fighting the author. By bot-vm the
// whole home and top rows are available, so real sentences are easy; the
// remaining constraints are the *missing* letters (b c n x z at bot-vm, then
// fewer each rung) and the fact that punctuation has not arrived yet.
//
// bot-vm and bot-nb still have no comma and no period, so their sentences end
// bare. bot-c-comma is the first rung that can join two clauses; bot-x-period
// is the first that can close a sentence properly, and from there on every
// sentence does. Capitals are still illegal everywhere in this file — Shift is
// the next rung up, in shift.js.

export const BOTTOM = {
  // No b, c, n, x or z yet. Losing 'n' is the one that hurts: no "and", "in",
  // "on", "not", "can", "one", "then", "when". Sentences here lean on "my",
  // "the", "a", "is" and verbs that happen to dodge it.
  'bot-vm': {
    drills: [
      'vm vm vm', 'fv fv fv', 'jm jm jm', 'fv jm fv jm', 'vf mj vf mj',
      'vvv mmm', 'av am av am', 've me ve me', 'vi mi vi mi', 'vo mo vo mo',
      'mm vv mm vv', 'vmv mvm vmv', 'ram rev ram rev', 'vim mid vim mid',
    ],
    words: [
      'move', 'movie', 'my', 'made', 'mask', 'mud', 'mule', 'meal', 'mouse',
      'maple', 'very', 'every', 'vote', 'video', 'vase', 'avoid', 'arrive',
      'give', 'love', 'remove', 'hammer', 'summer',
    ],
    sentences: [
      'my mule ate my homework',
      'the mouse asked me for more jam',
      'a very old goat lives up here',
      'my hamster is a movie star',
      'i saw a purple mouse today',
      'my dog swallowed a whole waffle',
      'the vet gave my mule a lollipop',
      'that video made me giggle',
      'every yeti loves marmalade',
    ],
  },

  // 'n' arrives, which quietly hands back half of English. Still no comma or
  // period, and still no c, x or z.
  'bot-nb': {
    drills: [
      'nb nb nb', 'jn jn jn', 'fb fb fb', 'jn fb jn fb', 'nnn bbb',
      'an an an', 'ab ab ab', 'bn nb bn nb', 'bun bun bun', 'nub bun nub',
      'ban ben bin', 'in on an', 'nab nib nub', 'bnb nbn bnb',
    ],
    words: [
      'bring', 'number', 'ribbon', 'banana', 'bunny', 'thumb', 'jumbo',
      'brain', 'rainbow', 'bubble', 'nibble', 'humble', 'robin', 'begin',
      'button', 'bandit', 'blanket', 'never', 'ninja', 'bought',
    ],
    sentences: [
      'my brother built a robot for the bath',
      'the banana bandit is on the loose',
      'i think my thumb is broken',
      'nine ninjas nibble on toast',
      'never let a bunny drive a bus',
      'the robin brought me a button',
      'a jumbo jet landed in my garden',
      'my brain is on a break',
      'that bubble is bigger than my head',
      'we hid under a blanket the whole night',
    ],
  },

  // The comma arrives. This is the first rung where a sentence can have two
  // halves, so the sentences here are built out of lists and clauses on
  // purpose — that is the new thing the kid is practising.
  'bot-c-comma': {
    drills: [
      'dc dc dc', 'k, k, k,', 'dc k, dc k,', 'cd ,k cd ,k', 'ccc ,,,',
      'ac ac ac', 'ic oc ic oc', 'cc ,, cc ,,', 'cat, cot, cut',
      'yes, no, yes', 'red, green, gold', 'ice, ace, ache', 'one, two, ten',
      'c, c, c,',
    ],
    words: [
      'carrot', 'cheese', 'chocolate', 'chicken', 'circus', 'castle',
      'cricket', 'clock', 'cabbage', 'cactus', 'candle', 'comic', 'cocoa',
      'crunch', 'picnic', 'jacket', 'bicycle', 'magic', 'second', 'dancing',
    ],
    sentences: [
      'my cat can juggle, but he never catches anything',
      'i can hear a cricket, a clock, and a chicken',
      'the circus came to town, and so did the rain',
      'grab a jacket, a carrot, and a comic',
      'if you like cheese, come to my picnic',
      'the crocodile smiled, which is not a good sign',
      'my bicycle has a bell, a basket, and one flat tire',
      'first the cocoa, then the marshmallows',
      'when the clock chimes, the cactus dances',
      'we ate cake, ice cream, and second helpings',
    ],
  },

  // THE PERIOD. Every sentence from here down closes properly, and it is worth
  // making that obvious to the kid on the very first round.
  'bot-x-period': {
    drills: [
      'sx sx sx', 'l. l. l.', 'sx l. sx l.', 'xs .l xs .l', 'xxx ...',
      'ax ax ax', 'ox ex ox ex', 'x. x. x.', 'fox. box. fix.',
      'six. mix. wax.', 'xx .. xx ..', 'exit. exam.', 'next. text. taxi.',
      'axe oxen apex.',
    ],
    words: [
      'fox', 'box', 'six', 'mix', 'fix', 'next', 'exit', 'extra', 'taxi',
      'exam', 'boxes', 'foxes', 'index', 'expert', 'explain', 'excited',
      'relax', 'oxygen', 'sixty', 'textbook',
    ],
    sentences: [
      'the fox found a box of extra socks.',
      'six foxes took a taxi to the exam.',
      'my next trick will explain everything.',
      'relax, the exit is right behind you.',
      'the expert said my textbook was upside down.',
      'sixty ducks marched past the exit.',
      'do not open that box, it is full of foxes.',
      'my dad is an expert at extra long naps.',
      'a taxi full of chickens pulled up outside.',
      'i mixed orange juice into my cocoa, and it was a mistake.',
    ],
  },

  // z and / complete the alphabet. The slash has no natural home in a
  // sentence, so it earns its keep in the drills and gets one outing below.
  'bot-z-slash': {
    drills: [
      'az az az', ';/ ;/ ;/', 'az ;/ az ;/', 'za /; za /;', 'zzz ///',
      'zip zap zoom', 'oz iz oz iz', 'z/ z/ z/', 'zz // zz //',
      'buzz fuzz jazz', 'and/or yes/no', 'up/down in/out', 'zed zag zig',
      'stop/go on/off',
    ],
    words: [
      'zebra', 'zigzag', 'puzzle', 'pizza', 'buzz', 'fizz', 'jazz', 'lazy',
      'dozen', 'frozen', 'amazing', 'quiz', 'prize', 'zone', 'blizzard',
      'crazy', 'magazine', 'wizard', 'zoom', 'size',
    ],
    sentences: [
      'the lazy zebra ate a whole frozen pizza.',
      'a wizard turned my homework into jazz.',
      'a dozen bees buzz around the quiz table.',
      'my puzzle has one piece missing, and i blame the dog.',
      'we zigzagged up the hill and won the prize.',
      'a blizzard is just snow in a hurry.',
      'do not feed the zebra pizza, it makes him crazy.',
      'the fizzy drink exploded all over my magazine.',
      'the sign said stop/go, so we did both.',
      'my cat can zoom from the sofa to the fridge in one second.',
    ],
  },
};
