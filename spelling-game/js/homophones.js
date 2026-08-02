// Words that sound like other words, and therefore cannot be asked for by sound
// alone.
//
// THIS IS NOT A DIFFICULTY LIST. It exists because of a hole in the QUESTION,
// not a hole in the kid. Drill plays a sound and shows empty boxes; for `sea`
// that is not a question, because `see` is an equally correct reading of
// everything she was told. She can be entirely right and be marked wrong, and no
// improvement to the audio can fix it — a perfect recording of /siː/ still does
// not choose between the spellings.
//
// The game's answer is to flash the word once, while it is spoken, and only for
// these words (spec: docs/next-steps.md item 1). That makes the prompt specific.
// It is deliberately the cheapest of the three options considered — a sentence or
// a picture would also work and would change what a spine entry is — and it is
// chosen because this is a learning tool, not an invigilated test.
//
// WHAT COUNTS AS A HOMOPHONE HERE is narrower than the dictionary's answer, in
// one way that matters: THE OTHER SPELLING MUST BE TYPABLE. The engine accepts
// a-z only, so `it's`, `you're` and `they're` cannot be entered even by a kid who
// wants to. `its` and `your` are therefore NOT ambiguous inside this game and are
// not listed; `their`/`there` is, and `they're` is simply absent from its set.
// Listing an untypable twin would flash a word that was never at risk, spending
// recall practice to solve a problem that does not exist here.
//
// Sets are kept even when only one member is in the spine today — `hour`, `bee`,
// `buy` and `won` are not in the list yet. A kid who hears /aʊər/ can still type
// `hour`, so the ambiguity is a property of the WORD, not of our word list, and
// the moment the spine grows the set is already right.
//
// Pure module: no DOM, no network, no clock, no randomness.

/**
 * Homophone sets. Every member sounds like every other member.
 *
 * Ordered loosely by how early the words appear, which matters to nobody at
 * runtime and helps whoever edits this next.
 *
 * @type {string[][]}
 */
export const HOMOPHONE_SETS = [
  ['to', 'too', 'two'],
  ['see', 'sea'],
  ['hear', 'here'],
  ['their', 'there'], // `they're` omitted on purpose — an apostrophe is untypable
  ['know', 'no'],
  ['right', 'write'],
  ['for', 'four'],
  ['read', 'red'], // the past tense of `read`, which is where the collision is
  ['our', 'hour'],
  ['be', 'bee'],
  ['by', 'buy', 'bye'],
  ['one', 'won'],
  ['new', 'knew'],
  ['made', 'maid'],
  ['would', 'wood'],
  ['so', 'sew'],
  ['son', 'sun'],
  ['high', 'hi'],
  ['way', 'weigh'],
  ['not', 'knot'],
  ['some', 'sum'],
  ['through', 'threw'],
  ['where', 'wear'],
  ['night', 'knight'],
  ['great', 'grate'],
];

/**
 * word -> the set it belongs to. Built once; the sets are static.
 *
 * A Map rather than a scan, because this is asked once per problem and the
 * answer decides whether the kid gets a flash — a lookup that silently got
 * slower would be a lookup someone was tempted to cache somewhere worse.
 *
 * @type {Map<string, string[]>}
 */
const SET_BY_WORD = new Map();
for (const set of HOMOPHONE_SETS) {
  for (const word of set) {
    SET_BY_WORD.set(word, set);
  }
}

/**
 * Does this word sound like a different word?
 *
 * The one question the game asks. True means the prompt is ambiguous by sound
 * and the word must be shown as well as said.
 *
 * @param {unknown} word
 * @returns {boolean}
 */
export function hasHomophone(word) {
  return typeof word === 'string' && SET_BY_WORD.has(word);
}

/**
 * The OTHER spellings that sound the same, or [] for an unambiguous word.
 *
 * Not used by the game loop today. It exists for the results screen and for
 * whoever adds sentence prompts later, and it is exported so that the "which
 * words sound alike" question has exactly one answer in this codebase — the
 * duplicated-table failure has bitten this project twice.
 *
 * @param {unknown} word
 * @returns {string[]}
 */
export function homophonesOf(word) {
  const set = typeof word === 'string' ? SET_BY_WORD.get(word) : undefined;
  return set === undefined ? [] : set.filter((other) => other !== word);
}
