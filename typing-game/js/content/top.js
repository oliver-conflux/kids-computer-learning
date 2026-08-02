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

  // Still no 't', so still no "the". This is the tightest rung in the game:
  // "he", "she", "his", "her", "is", "a" and "read" carry every sentence.
  'top-ru': {
    drills: [
      'fr fr fr', 'ju ju ju', 'fr ju fr ju', 'ru ru ru', 'ir ir ir',
      'us us us', 'ur ur ur', 'rue rue rue', 'rug jug hug', 'red her sir',
      'rid rug rush', 'fur far fir', 'sure sure sure', 'urge huge urge',
      'dear hear rear',
    ],
    words: [
      'red', 'her', 'rug', 'jug', 'hug', 'rush', 'ride', 'rule', 'ruler',
      'sure', 'fire', 'hair', 'hard', 'guide', 'judge', 'fridge', 'argue',
      'sugar', 'laugh', 'shark',
    ],
    sentences: [
      'she said her guide is a giraffe',
      'he read all his rules',
      'her dad is a fair judge',
      'a huge shark is real',
      'she juggles jugs',
      'his kid slid ahead',
      'he hid all his sugar',
      'her fries are hard',
      'she had a fresh idea',
      'his hair is red',
    ],
  },

  // The big unlock: 't' arrives, so "the", "that" and "they" become typable and
  // sentences stop fighting for a verb.
  'top-ty': {
    drills: [
      'ft ft ft', 'jy jy jy', 'ft jy ft jy', 'ty ty ty', 'thy thy thy',
      'the the the', 'tie tie tie', 'yet yet yet', 'try try try',
      'sty sky shy', 'day say lay', 'the that they', 'eat ate tea',
      'at it is', 'yak yell yes',
    ],
    words: [
      'the', 'they', 'that', 'this', 'tidy', 'yes', 'yet', 'yak', 'day',
      'duty', 'study', 'tasty', 'dirty', 'thirty', 'jelly', 'silly', 'turtle',
      'kettle', 'guitar', 'flute',
    ],
    sentences: [
      'the yeti had a tidy little hut',
      'that turtle is really fast',
      'they left the flute there',
      'she still likes that dusty guitar',
      'they say the yak is silly',
      'the truth is she likes jelly',
      'thirty turtles trailed the raft',
      'she filled the kettle',
      'the tall lad ate all the treats',
      'is that frilly hat hers',
    ],
  },

  // 'o' and 'w' land together, which buys "you", "would" and "who". Still no
  // 'n', so "and", "on" and "not" are as far out of reach as ever.
  'top-wo': {
    drills: [
      'sw sw sw', 'lo lo lo', 'sw lo sw lo', 'wo wo wo', 'ow ow ow',
      'ow wo ow wo', 'how who why', 'low row sow', 'old owl out',
      'we was were', 'so go do', 'word work world', 'wow wow wow',
      'you your yours', 'told hold gold',
    ],
    words: [
      'who', 'how', 'low', 'slow', 'glow', 'show', 'throw', 'world', 'word',
      'would', 'you', 'your', 'four', 'wood', 'good', 'look', 'gold',
      'yellow', 'story', 'owl',
    ],
    sentences: [
      'the owl worried it would fall',
      'a slow otter followed the yellow raft',
      'we would show you the whole world',
      'who took all the gold',
      'that goldfish is far too old',
      'she told us a silly story',
      'how do you throw it so far',
      'the wide world is full of wild dogs',
      'a wild owl sat there all day',
      'you look tired today',
    ],
  },

  // The last two top-row keys. The whole home and top rows are now available,
  // and 'q' is only ever useful with the 'u' from top-ru.
  'top-qp': {
    drills: [
      'aq aq aq', ';p ;p ;p', 'aq ;p aq ;p', 'qu qu qu', 'sq sq sq',
      'pu pu pu', 'ap ap ap', 'up up up', 'pa pe pi', 'pop pip pup',
      'que qui quo', 'top tip tap', 'quit quilt quiet', 'quay quad quart',
      'help hope hop',
    ],
    words: [
      'quit', 'quiet', 'quilt', 'queue', 'quail', 'squid', 'squash', 'square',
      'liquid', 'quality', 'apple', 'happy', 'puppy', 'purple', 'please',
      'people', 'paper', 'pirate', 'parrot', 'hippo',
    ],
    sentences: [
      'a purple squid put the apple up there',
      'please help the sleepy puppy',
      'that pirate parrot is quite loud',
      'she pulled the quilt up to her ears',
      'we are quite happy to help you',
      'the hippo squashed our paper hat',
      'that squirrel stole your last pear',
      'do you like apple pie',
      'people queue up for a free puppy',
      'the quiet spider slept up here',
    ],
  },
};
