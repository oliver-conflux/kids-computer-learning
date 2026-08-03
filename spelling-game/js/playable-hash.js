// A fingerprint of the item space a session was actually played against.
//
// The problem this exists to solve: the spelling game builds its word window
// from `PLAYABLE`, and `PLAYABLE` is derived from which mp3 files happen to be
// sitting in the audio cache on disk. It is NOT a function of the log, and the
// log does not record it. So replaying an old log today rebuilds the window from
// whatever the cache holds *now*, silently, with no signal that anything moved.
//
// That is not hypothetical. 401 words had no recording in August and do have one
// now, so a replay of an August session reconstructs a window that word-for-word
// disagrees with the one the kid actually saw — which is the leading suspect for
// the unexplained divergence recorded in `docs/next-steps.md` item 6, where a
// replay insisted `-at` should have been picked and its window did not even
// contain the words the game really served.
//
// Stamping this hash into every session event does not fix the divergence. It
// makes it *visible*: a replay can compare the hash it computes against the one
// on file and say "the item space changed under you" instead of quietly
// producing a wrong answer that looks right.
//
// Pure module: no DOM, no network, no clock, no randomness, no dependencies.

// FNV-1a 32-bit. Chosen over node:crypto because this is not a security
// boundary — a collision here only means a replay fails to notice a change, and
// there is a second guard against that below — and because the project has zero
// dependencies and this browser-side module cannot reach for node:crypto anyway.
// FNV-1a is a dozen lines, has no platform-dependent behaviour, and is fast
// enough to run on a 600-word list in every session event without being noticed.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// The words are joined with a character that cannot occur inside a word. Without
// a separator, ['ab', 'c'] and ['a', 'bc'] hash identically — two different item
// spaces claiming to be the same one, which is the exact failure this module is
// supposed to catch.
const SEPARATOR = '\n';

/**
 * FNV-1a over a string's UTF-16 code units, one byte at a time so the result
 * does not depend on how the platform happens to encode the string.
 *
 * @param {string} text
 * @returns {number} an unsigned 32-bit integer
 */
function fnv1a(text) {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    // Low byte then high byte. Every word here is ASCII, so the high byte is
    // almost always zero; mixing it in anyway means a word list that one day
    // carries an accented character still hashes distinctly.
    hash ^= code & 0xff;
    // The multiply is done in 32-bit-safe pieces. `hash * FNV_PRIME` overflows
    // the 53-bit float mantissa and would silently lose low bits — which are the
    // bits FNV relies on for avalanche. Math.imul does the wrapping multiply.
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= (code >>> 8) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A short, stable fingerprint of a word list.
 *
 * The list is hashed **sorted**. This is the load-bearing property and it is
 * worth being blunt about: the playable list is built from a directory listing,
 * and directory listings come back in whatever order the filesystem feels like.
 * An order-sensitive hash would change between two runs over an identical cache,
 * which is strictly worse than having no hash at all — it would report that the
 * item space kept changing when nothing had moved, and a signal that cries wolf
 * gets ignored right up until the run where it was telling the truth.
 *
 * The word count is appended in the clear, not folded into the hash. A 32-bit
 * hash can collide; a count cannot. The change actually observed in this project
 * was a change in *size* (401 words appearing at once), so the most likely real
 * divergence is the one a collision can never hide. It also means a human
 * skimming the log sees `...ff3a1c.232` and `...4b90de.633` and knows what
 * happened without running anything.
 *
 * Duplicates are not removed. A list that has grown a duplicate entry is a
 * different item space than one that has not, and hiding that would be the
 * module working against its own purpose.
 *
 * @param {string[]} words the playable word list; not mutated
 * @returns {string} e.g. `'0a3f91c7.232'` — stable across runs and machines
 */
export function playableHash(words) {
  // Sort a copy: the caller passes the live PLAYABLE list, and reordering the
  // list the game draws from as a side effect of describing it would be a
  // spectacular way to cause the very divergence this is meant to detect.
  //
  // Default sort order compares UTF-16 code units, which is the same everywhere.
  // Deliberately NOT localeCompare — that depends on the machine's locale and
  // ICU build, so two machines could disagree about the hash of the same list.
  const sorted = [...words].sort();
  const digest = fnv1a(sorted.join(SEPARATOR));
  // Zero-padded so the string is always the same width, which keeps a column of
  // these readable when scanning the log by eye.
  return `${digest.toString(16).padStart(8, '0')}.${sorted.length}`;
}
