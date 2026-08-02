// The route a word takes — its spelling patterns.
//
// The math game's hard-won lesson, from learn-and-drill-modes-design.md: the
// answer must always arrive with its derivation attached. Showing `friend` for
// two seconds and hiding it is copy practice — it exercises a visual buffer that
// survives about ten seconds and teaches nothing about why the word looks like
// that. The route for a word is its PATTERN, and this file is the table of them.
//
// `patternsFor` is TOTAL. Every word gets at least one tag, and a word matching
// no rule is tagged `irregular`. That guarantee is what lets learn mode assume a
// family exists for anything the frontier hands it, and it is the property most
// worth protecting when a rule is added or removed.
//
// A word carrying several tags is expected and correct. `snake` is an `-ake`
// word AND a silent-e word AND starts with a blend; all three are true and each
// is a different thing to notice about it. Learn mode picks ONE of them to build
// a session around (see learn.js) — it does not need this file to choose.
//
// Two rules of construction run through the whole table:
//
//   1. A RIME IS A SYLLABLE, NOT A SUFFIX. Every closed-syllable rime is written
//      `/^[^aeiou]*RIME$/` — the onset must be consonants only. Without that,
//      `-at` catches `eat`, `heat`, `seat` and `great`, none of which rhyme with
//      `cat`, and a learn session built on that family teaches a kid something
//      false. The regex form is the rule; the individual rimes are just data.
//
//   2. AN R-CONTROLLED VOWEL IS ONE VOWEL, NOT TWO. `ar`/`er`/`ir`/`or`/`ur` are
//      guarded with `(^|[^aeiou])`, so `year`, `hear`, `deer`, `poor`, `our` and
//      `four` are not mislabelled — in all of those the r attaches to a vowel
//      TEAM and the sound is nothing like `car` or `her`.
//
// The rule count came out around forty-five rather than the spec's "roughly 25",
// almost entirely in the CVC rime block. The spine opens with ~50 hand-authored
// CVC words grouped in families from the very first word, and a missing rime
// there is not a missing tag — it is a four-year-old's first learn session being
// a set of unrelated `irregular` words. Each rime is one line and trimming is
// cheap if the count turns out to matter more than the coverage.
//
// Pure module: no DOM, no network, no clock, no randomness. It takes a string
// and returns strings, which is what lets it be re-run over two-month-old log
// lines offline. Note that the log denormalises the tags onto each attempt event
// deliberately, so history records which tag was in force AT THE TIME rather
// than what today's table would say — this file is expected to change.

/** The tag a word gets when no rule fires, and the tag no rule may produce. */
export const IRREGULAR = 'irregular';

/**
 * Words whose letters do not predict their sound.
 *
 * The criterion is narrow and worth stating, because "hard to spell" is not it:
 * a word belongs here when a surface rule WOULD fire and WOULD LIE. `said`
 * contains `ai` and is not an `ai` word; `friend` starts with the `fr` blend and
 * ends with the `nd` blend and is not built from either; `could` ends in the
 * `ld` blend and has no `l` sound at all. Teaching those under a pattern is
 * worse than teaching them as what they are.
 *
 * Membership is EXCLUSIVE — a word in this set is tagged `irregular` and
 * nothing else. A `friend` that also carried `blend-start` could be drawn into
 * a blends family by learn mode, which is precisely the pretence the tag exists
 * to avoid.
 *
 * A few members (`one`, `two`, `eye`) match no rule anyway and would reach
 * `irregular` by fallback. They are listed regardless, so the tag stays stable
 * if a later rule is added that happens to catch them.
 *
 * This list is editorial and expected to grow. It is not a family — see
 * `pickLearnFamily`, which frames these honestly as a set of unrelated words
 * rather than pretending they rhyme.
 */
const IRREGULARS = new Set([
  // Sight words: the first hundred words of English are the worst-behaved.
  'of', 'to', 'do', 'you', 'your', 'one', 'two', 'once', 'said', 'says',
  'are', 'was', 'were', 'they', 'their', 'there', 'here', 'where',
  'what', 'want', 'watch', 'water', 'wash', 'who', 'whose', 'whom', 'whole',

  // The o-says-u family — a spelling pattern with no sound to hang it on.
  'come', 'some', 'done', 'none', 'gone', 'love', 'above', 'move', 'prove',
  'other', 'another', 'mother', 'brother', 'front', 'month', 'money', 'honey',
  'young', 'touch', 'country', 'couple', 'double', 'trouble', 'cousin',
  'blood', 'flood',

  // ould, and the silent-l crowd.
  'could', 'should', 'would', 'half', 'talk', 'walk', 'chalk',

  // Silent letters at the front or the back.
  'know', 'knew', 'known', 'knee', 'knife', 'knock', 'knot',
  'wrap', 'write', 'wrote', 'written', 'wrong',
  'comb', 'climb', 'lamb', 'thumb', 'doubt', 'ghost', 'honest', 'hour',
  'island', 'iron', 'sign', 'sword', 'answer', 'castle', 'listen', 'often',
  'science', 'ocean', 'women', 'woman',

  // gh, which says f, or nothing, or something else again.
  'laugh', 'enough', 'though', 'through', 'thought', 'bought', 'brought',
  'ought', 'caught', 'taught', 'daughter', 'eight', 'weight', 'height',

  // ea and ei doing something other than what the vowel-team rule says.
  'great', 'break', 'bear', 'pear', 'wear', 'tear', 'heart', 'learn', 'earth',
  'early', 'been',

  // w and r bending the vowel before them.
  'work', 'word', 'world', 'worse', 'worth', 'worry', 'warm', 'war', 'warn',
  'toward', 'four', 'door', 'floor', 'poor',

  // u that is silent, or is not there at all.
  'build', 'built', 'buy', 'busy', 'guess', 'guest', 'guard', 'guide',

  // The rest: each one lies about something.
  'have', 'give', 'live', 'friend', 'friends', 'people', 'many', 'any',
  'again', 'against', 'eye', 'eyes', 'sure', 'put', 'push', 'pull', 'full',
]);

/**
 * The rule table. Order here is the order tags come out in, and it is stable:
 * rimes, then structure, then vowel teams, then r-controlled, then affixes.
 * A consumer may rely on that ordering; nothing in this repo needs to, but a
 * shuffled table would churn the `patterns` field of every future log line for
 * no reason.
 *
 * Every entry is `[tag, pattern]` and every pattern is a plain regex, because
 * the whole table has to stay readable by whoever retunes it next.
 */
const RULES = [
  // ---- Rime families -----------------------------------------------------
  // Closed single syllables: consonant onset, then the rime. `/^[^aeiou]*/` is
  // load-bearing — see the header. These carry the CVC opener, which is where a
  // four-year-old starts and where a missing family is most expensive.
  ['-ad', /^[^aeiou]*ad$/],
  ['-ag', /^[^aeiou]*ag$/],
  ['-am', /^[^aeiou]*am$/],
  ['-an', /^[^aeiou]*an$/],
  ['-ap', /^[^aeiou]*ap$/],
  ['-at', /^[^aeiou]*at$/],
  ['-id', /^[^aeiou]*id$/],   // did, hid, lid — added at Gate B, see below
  ['-ack', /^[^aeiou]*ack$/],
  ['-ick', /^[^aeiou]*ick$/],
  ['-ock', /^[^aeiou]*ock$/],
  ['-uck', /^[^aeiou]*uck$/],
  ['-ong', /^[^aeiou]*ong$/],
  ['-ang', /^[^aeiou]*ang$/],
  ['-ing-rime', /^[^aeiou]*ing$/],  // king, thing, bring — the RIME, not the suffix
  ['-ed', /^[^aeiou]*ed$/],   // bed, red, sled — NOT the -ed suffix, see below
  ['-en', /^[^aeiou]*en$/],
  ['-et', /^[^aeiou]*et$/],
  ['-ell', /^[^aeiou]*ell$/],
  ['-ig', /^[^aeiou]*ig$/],
  ['-in', /^[^aeiou]*in$/],
  ['-ip', /^[^aeiou]*ip$/],
  ['-it', /^[^aeiou]*it$/],
  ['-og', /^[^aeiou]*og$/],
  ['-op', /^[^aeiou]*op$/],
  ['-ot', /^[^aeiou]*ot$/],
  ['-ug', /^[^aeiou]*ug$/],
  ['-un', /^[^aeiou]*un$/],
  ['-ut', /^[^aeiou]*ut$/],
  ['-all', /^[^aeiou]*all$/],
  ['-ake', /^[^aeiou]*ake$/],
  // Looser than the rest on purpose. `tonight` is an `-ight` word and `going`
  // is an `-ing` word, and the consonant-onset form would exclude both. The
  // guard on `-ight` still keeps `eight` and `weight` out, where the vowel
  // before `ight` changes the sound completely.
  ['-ight', /(^|[^aeiou])ight$/],
  ['-ing', /.ing$/],

  // ---- Structural --------------------------------------------------------
  // Vowel–consonant–e. `[^aeiouy]` before the final `e` keeps `people`, `table`
  // and `little` out — consonant-le is a different pattern with a different
  // sound, and lumping them in would teach the wrong thing about both.
  ['silent-e', /^.*[aeiou][^aeiouy]e$/],
  // Consonant-le, the pattern silent-e deliberately excludes. `little` and
  // `table` are not silent-e words and would otherwise have nothing at all.
  ['-le', /[^aeiouy]le$/],
  ['double-final', /(ll|ff|ss|zz)$/],
  // One tag per digraph rather than a single `digraph` tag: a learn session
  // saying "these are `sh` words" teaches something, and one saying "these are
  // digraph words" mixing `ship`, `that` and `when` teaches nothing.
  ['ch', /ch/],
  ['sh', /sh/],
  ['th', /th/],
  ['wh', /wh/],
  // Blends, where two consonants each keep their own sound. Three-letter
  // clusters are listed first so the alternation prefers the longer match; it
  // does not change whether the tag fires, only which branch matched.
  ['blend-start', /^(sch|scr|shr|spl|spr|str|thr|bl|br|cl|cr|dr|fl|fr|gl|gr|pl|pr|sc|sk|sl|sm|sn|sp|st|sw|tr|tw)/],
  ['blend-end', /.(ct|ft|ld|lf|lk|lp|lt|mp|nd|nk|nt|pt|sk|sp|st|xt)$/],

  // ---- Vowel teams -------------------------------------------------------
  // Two vowels, one sound. `oo` covers two different sounds (`book`, `soon`)
  // and is kept as one family anyway, because the spelling question — which
  // letters go here — has the same answer for both.
  ['ea', /ea/],
  ['ee', /ee/],
  ['oa', /oa/],
  ['ai', /ai/],
  ['ay', /ay/],
  ['oo', /oo/],
  // Diphthongs. The spec's table names four teams by example; these are the
  // rest of the same category, and leaving them out put `out`, `how`, `day`,
  // `oil`, `boy`, `saw` and `new` on the irregular pile — all of them words a
  // beginner meets early and all of them perfectly regular.
  ['ou', /ou/],
  ['ow', /ow/],
  ['oi', /oi/],
  ['oy', /oy/],
  ['aw', /aw/],
  ['ew', /ew/],

  // ---- R-controlled ------------------------------------------------------
  // The `(^|[^aeiou])` guard is the whole rule — see the header.
  ['ar', /(^|[^aeiou])ar/],
  ['er', /(^|[^aeiou])er/],
  ['ir', /(^|[^aeiou])ir/],
  ['or', /(^|[^aeiou])or/],
  ['ur', /(^|[^aeiou])ur/],

  // ---- Affixes -----------------------------------------------------------
  ['-tion', /.tion$/],
  // A suffix, not the `-ed` rime above. The two cannot collide: this one needs
  // a consonant before `ed` AND a vowel somewhere in front of it, which is
  // exactly what the rime's consonant-only onset forbids. The known cost is
  // that `tried` and `cried` are missed (a vowel sits before the `ed`) and
  // `sacred` is a false positive; both are morphology guessed from a bare
  // string, which is all this table has to work with.
  ['-ed', /^.*[aeiou].*[^aeiouy]ed$/],
  ['-es', /..(s|x|z|ch|sh)es$/],
  // Plural -s. The vowel exclusion before the final `s` is what keeps `this`,
  // `was`, `his`, `has` and `yes` out; they are not plurals and a kid taught
  // them as plurals learns a rule that does not hold.
  ['-s', /..[^aeiousxz]s$/],
];

/**
 * The inflections a stem check will look through, longest first so `-ies` and
 * `-es` are tried before the bare `-s`.
 */
const INFLECTIONS = ['ing', 'es', 'ed', 's', 'd'];

/**
 * Is this word an inflected form of a known irregular?
 *
 * `word` is irregular, so `words` is too — and without this, `words` picks up
 * the `or` r-controlled tag and gets taught alongside `for` and `corn`, which
 * is exactly the lie the irregular set exists to prevent. Listing every
 * inflection by hand would work and would be one more thing to forget.
 *
 * Stems are only ever looked UP, never invented: a stripped form that is not
 * itself a known irregular changes nothing, so `looking` and `beds` fall
 * through to the ordinary rules untouched. Doubled-consonant stems (`running`
 * → `runn`) are not reconstructed — no known irregular needs it, and guessing
 * at orthographic doubling here would cost more than it buys.
 *
 * @param {string} word
 * @returns {boolean}
 */
function isInflectedIrregular(word) {
  for (const suffix of INFLECTIONS) {
    if (!word.endsWith(suffix)) {
      continue;
    }
    const stem = word.slice(0, word.length - suffix.length);
    if (stem.length >= 2 && IRREGULARS.has(stem)) {
      return true;
    }
  }
  return false;
}

/**
 * Every spelling pattern this word takes part in, most structural first.
 *
 * TOTAL: the returned array is never empty. A word matching no rule, and every
 * word in the known-irregular set, comes back as exactly `['irregular']`.
 *
 * A non-string, or a string with nothing usable in it, is also `['irregular']`
 * rather than a throw. This runs over log lines as well as over the spine, and
 * a corrupt line must never break a session.
 *
 * A fresh array each call, so a caller sorting or splicing the result cannot
 * reach into another caller's.
 *
 * @param {string} word lowercase a–z, as the spine guarantees
 * @returns {string[]} at least one tag
 */
export function patternsFor(word) {
  if (typeof word !== 'string') {
    return [IRREGULAR];
  }

  const normalised = word.toLowerCase().trim();
  if (normalised.length === 0) {
    return [IRREGULAR];
  }

  if (IRREGULARS.has(normalised) || isInflectedIrregular(normalised)) {
    return [IRREGULAR];
  }

  /** @type {string[]} */
  const tags = [];
  for (const [tag, pattern] of RULES) {
    if (pattern.test(normalised)) {
      tags.push(tag);
    }
  }

  return tags.length > 0 ? tags : [IRREGULAR];
}
