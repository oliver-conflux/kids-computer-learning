// typing-game/js/practice.js
//
// Practice mode content. Deliberately NOT restricted to taught keys (spec §4) —
// this is where the kids go to play, so the content-validation test skips it.
// Capitals, question marks, quotes, apostrophes and dashes are all fair game
// here, and should be: a kid who has only ever typed 'she had a field' deserves
// somewhere that sentences look like sentences.
//
// The `math` tier is the bridge to the math game: real arithmetic worth typing.
//
// Word tiers are by length — short 3-5, medium 6-8, long 9+ — because that is
// the only ordering that means anything once the alphabet is unrestricted.
//
// Roughly a third of the sentences carry the literal token {name}; withName()
// swaps in the kid's own name at runtime. No real name is ever hardcoded here.
//
// Pure module: no DOM, no network, no clock, no randomness.

export const PRACTICE = {
  words: {
    short: [
      'cat', 'dog', 'frog', 'moon', 'star', 'jump', 'milk', 'sock',
      'bird', 'rock', 'tree', 'fish', 'hand', 'wind', 'snow', 'cake',
      'bike', 'farm', 'gold', 'lamp', 'nest', 'pond', 'ship', 'wolf',
      'zoom',
    ],
    medium: [
      'rocket', 'planet', 'dragon', 'monkey', 'jungle', 'zipper',
      'pumpkin', 'blanket', 'thunder', 'whistle', 'penguin', 'cabbage',
      'giraffe', 'hamster', 'muffins', 'sandbox', 'tadpole', 'volcano',
      'wizards', 'balloon', 'cricket', 'dolphin', 'compass', 'library',
      'octopus',
    ],
    long: [
      'butterfly', 'telescope', 'astronaut', 'crocodile', 'adventure',
      'chocolate', 'submarine', 'waterfall', 'wonderful', 'invisible',
      'spaceship', 'kangaroos', 'playground', 'skateboard', 'lighthouse',
      'watermelon', 'helicopter', 'rhinoceros', 'strawberry', 'understand',
      'everything', 'trampoline', 'caterpillar', 'marshmallow', 'grasshopper',
    ],
  },

  sentences: {
    // Plain declarative sentences. One clause, no interior punctuation.
    short: [
      'The cat sat on my hat.',
      '{name} can jump over a log.',
      'A frog sings all night long.',
      'The moon is made of old rock.',
      'My dog ate a whole sock.',
      'Birds build their nests in trees.',
      '{name} likes warm socks best.',
      'The rocket went up very fast.',
      'Snow fell on the roof.',
      'A fish blew one big bubble.',
      '{name} waited a long time for the bus.',
      '{name} found a shiny green rock.',
      'Bees like yellow flowers.',
      'The wind blew my hat away.',
      'A duck sat on my bike.',
      'Stars come out after dark.',
      '{name} drew a purple cow.',
      'The cake was still warm.',
      '{name} lost a tooth today.',
      'Ants can lift very heavy things.',
      'The pond was full of frogs.',
      '{name} built a tall tower of blocks.',
      'An owl hooted twice and then stopped.',
      '{name} rode the train into town.',
      'Goats will eat almost anything.',
      'My boots are full of mud.',
      '{name} has a very loud laugh.',
      'The kite got stuck in a tree.',
      'A whale is bigger than a bus.',
      '{name} heard rain on the window.',
    ],

    // Two or more clauses, and lists. The comma is the whole point.
    commas: [
      'When the sun came up, the rooster shouted.',
      '{name} packed a snack, a map, and a flashlight.',
      'If you feed one seagull, it will tell all its friends.',
      'The dog barked, the cat ran, and the bird laughed.',
      'Before school, {name} walks the dog around the block.',
      '{name} wanted pancakes, but we were out of eggs.',
      'After the rain stopped, the worms came out to visit.',
      'We packed apples, cheese, crackers, and grapes.',
      'The moon, which is very old, has no wind at all.',
      '{name} looked under the bed, but the sock was gone.',
      'While the soup cooked, we played a card game.',
      'My brother, who is six, can whistle through his teeth.',
      'If a penguin could fly, it would still choose to swim.',
      'We saw a fox, a deer, and two very rude squirrels.',
      '{name} tried, failed, tried again, and finally did it.',
      'Once the snow melted, the garden turned into a swamp.',
      'The robot beeped, blinked, and rolled straight into a wall.',
      'Since nobody was looking, the dog took the toast.',
      '{name} counted the stars, but kept losing the place.',
      'The map was old, torn, and mostly wrong.',
      'When you hum to a bee, it does not hum back.',
      'We built a fort, a moat, and one very small bridge.',
      '{name} said hello, and the parrot said it right back.',
      'The cake sank, the icing slid off, and we ate it anyway.',
      'After lunch, {name} ran three laps around the field.',
      'If you stay quiet, the deer will come closer.',
      '{name} wore boots, a scarf, and exactly one green mitten.',
      'The kitten climbed the curtain, then could not get down.',
      'We waited, watched, and finally saw the comet.',
      '{name} laughed, snorted, and woke up the dog.',
    ],

    // The full range: question marks, quotes, apostrophes, colons, semicolons,
    // dashes, and the occasional shout.
    mixed: [
      'Why do cats knock things off tables?',
      '"Watch this!" said {name}, and then fell over.',
      'The sign said: no swimming, no shouting, no llamas.',
      "It's raining, but the dog doesn't care.",
      'How many marshmallows fit in one mouth?',
      '{name} shouted, "I found it!" from under the couch.',
      'Here is the plan: run fast, jump high, land softly.',
      "Don't wake the baby dragon; she had a long night.",
      'Is a hot dog a sandwich? Nobody can agree.',
      '{name} asked, "Can worms hear music?"',
      'The parrot learned three new words - all of them rude.',
      "We're going to the moon; pack a warm coat.",
      'What has four legs, a tail, and terrible manners?',
      '{name} whispered, "The floor is lava," and everyone froze.',
      'Wow, {name}! That is the biggest pumpkin I have ever seen.',
      "The cat's plan was simple: sit on the keyboard.",
      'Can a snail win a race? Only against another snail.',
      '{name} said it was fine; it was not fine.',
      '"Who ate the last cookie?" asked Mom, already knowing.',
      'Rule one: never argue with a goose.',
      "Isn't it strange that Tuesday sounds like a sneeze?",
      '{name} counted to ten, then shouted, "Ready or not!"',
      'The recipe said "a pinch of salt," so we used a whole cup.',
      'Space is quiet - no air means no sound at all.',
      "That's my sandwich! Well, it was my sandwich.",
      '{name} wondered: do fish ever get thirsty?',
      'The book was called "Ten Ways to Trick a Cat."',
      'Hurry up! The bus does not wait for anyone.',
      "{name}'s robot can dance, but it can't stop.",
      'Ready? Set? Wait - {name}, tie your shoe first.',
    ],
  },

  // Notation and prose, mixed on purpose: the kids meet both forms in the math
  // game, and '=' and 'x' are keys the number track just taught.
  math: [
    '6 x 7 = 42',
    '9 x 9 = 81',
    '8 x 8 = 64',
    '7 x 8 = 56',
    '5 x 5 = 25',
    '11 x 11 = 121',
    '3 x 4 x 5 = 60',
    '12 + 19 = 31',
    '45 + 55 = 100',
    '100 - 45 = 55',
    '90 - 30 = 60',
    '24 divided by 4 is 6',
    '1000 divided by 10 is 100',
    '56 divided by 8 is 7',
    'half of 100 is 50',
    'half of 50 is 25',
    'double 25 and you get 50',
    'a quarter of 20 is 5',
    'the sum of 10 and 15 is 25',
    'if you have 3 packs of 8, you have 24',
    '6 x 6 = 36, and 6 + 6 = 12',
    'zero times anything at all is still zero',
    'there are 60 seconds in a minute',
    'there are 60 minutes in an hour',
    'there are 24 hours in a day',
    'there are 7 days in a week',
    'there are 52 weeks in a year',
    '365 days make one whole year',
    'there are 12 inches in a foot',
    'a dozen eggs is 12 eggs',
    'a triangle has 3 sides and an octagon has 8',
    '2 + 2 = 4 every single time',
  ],
};

/**
 * Practice sentences with the kid's name injected where a sentence has a slot.
 *
 * @param {string[]} pool
 * @param {string | null} name
 * @returns {string[]}
 */
export function withName(pool, name) {
  const who = name ?? 'Someone';
  return pool.map((s) => s.replace('{name}', who));
}
