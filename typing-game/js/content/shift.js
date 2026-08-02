// typing-game/js/content/shift.js
// Rungs 12-13. Authored in Task 13.
//
// shift-caps is the payoff rung. Everything below it in the ladder is
// lowercase, which reads wrong on purpose; here capitals become legal and the
// content leans on them as hard as it can bear. The rung exists to make the
// opposite-hand shift rule automatic, so the drills pair each letter with its
// own capital (Aa wants the RIGHT shift, Jj the left) and the words are all
// proper nouns — days, planets, places, names — because a proper noun is a
// capital the kid cannot skip.
//
// punctuation adds ? ' " and :, which is exactly the set that turns flat
// statements into questions and speech. Contractions and quoted dialogue are
// the point of the rung, not decoration.

export const SHIFT = {
  // Drills alternate hands deliberately. 'Aa' is left-pinky A with the right
  // shift; 'Jj' is right-index J with the left. Rows 9-14 stop being mechanical
  // and make the kid shift mid-word, which is where the habit actually forms.
  'shift-caps': {
    drills: [
      'Aa Aa Aa', 'Ss Dd Ff', 'Jj Kk Ll', 'Qq Ww Ee', 'Rr Tt Yy',
      'Uu Ii Oo Pp', 'Zz Xx Cc Vv', 'Bb Nn Mm', 'Ab Cd Ef', 'Go Up Now',
      'Max Ben Zoe', 'AB CD EF', 'The The The', 'It Is It Is',
    ],
    words: [
      'Monday', 'Friday', 'Sunday', 'January', 'March', 'April', 'London',
      'Paris', 'Egypt', 'Mars', 'Jupiter', 'Venus', 'Africa', 'Texas',
      'Emma', 'Jack', 'Zoe', 'Max', 'Oliver', 'Amelia',
    ],
    sentences: [
      'Max and Zoe went to London on Friday.',
      'The biggest planet is Jupiter, and the hottest is Venus.',
      'On Monday Emma taught her cat to play the piano.',
      'We are going to Egypt in April, if the camel is free.',
      'Jack said Mars is red because it is embarrassed.',
      'Amelia found a penguin in the fridge on Sunday.',
      'In January the whole of Texas ran out of hot cocoa.',
      'Oliver, Zoe, and Ben built a raft out of pizza boxes.',
      'The Nile is in Africa, and it is very long.',
      'Every Tuesday Max wears his lucky purple hat.',
    ],
  },

  // ? ' " : — all four are pinky keys and three of them need shift, so this
  // rung is really more shift practice wearing a hat.
  'punctuation': {
    drills: [
      '?? ?? ??', ";' ;' ;'", ':: :: ::', '"" "" ""', 'who? why? how?',
      "it's it's it's", "don't can't won't", 'yes: no: yes:', '?: ?: ?:',
      `'" '" '"`, "I'm I'm I'm", "who's what's where's", 'why? when? where?',
      '?" ?" ?"',
    ],
    words: [
      "don't", "can't", "won't", "it's", "I'm", "we're", "they're", "isn't",
      "didn't", "wasn't", "that's", "there's", "let's", "you're", "he's",
      "she's", "I've", "we'll", "couldn't", "shouldn't",
    ],
    sentences: [
      '"Where is my sandwich?" asked the dog.',
      "It's raining, so let's build a boat.",
      '"I\'m not lost," said Max. "The map is."',
      'Why do we park on a driveway and drive on a parkway?',
      'The sign said: no swimming, no diving, no penguins.',
      '"Who ate the last slice?" Zoe didn\'t answer.',
      "Emma's cat can't spell, but she's very good at napping.",
      "Here's the rule: don't feed the zebra pizza.",
      '"Is that a wizard?" whispered Jack. "No, that\'s Grandad."',
      "If you're happy and you know it, why aren't you smiling?",
    ],
  },
};
