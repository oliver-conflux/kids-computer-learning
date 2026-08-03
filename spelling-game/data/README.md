# Committed source data

The spelling curriculum's word order comes from two published lists. Both were
licence-checked before adoption, and both are committed rather than fetched —
the game runs with no connectivity and no API key.

`tools/build-fry.js` reads both files and emits `spelling-game/js/fry.js`.
Nothing here is read at play time.

## fry-1000.txt

**Fry's 1000 Instant Words**, Dr. Edward Fry. Fry first published a list of
Instant Words in 1957 and expanded it to 1000 in 1996, building on Dolch's
earlier work. The ordering is frequency-derived from corpus analysis: the first
100 words account for roughly half of all written English, and the first 10 for
about a quarter.

**The order is the data.** Line N is Fry rank N. Nothing else in the project
carries that information, and `js/fry.js` records the published rank rather than
an array index precisely so that dropping untypable words cannot shift everything
after each gap into the wrong hundred.

Widely reproduced; representative institutional copies:

- <https://www.csusb.edu/sites/default/files/Frys1000InstantWordsquickchecklist%20(1).pdf>
- <https://hwespacers.org/pdf/Fry_s-Word-List.pdf>
- <https://nesc.k12.sd.us/resources/Fry%20Word%20Lists.pdf>

**This file is a faithful transcription, not a cleaned one.** It still contains
`I`, `America`, `don't`, `it's`, `can't`, `English` and the rest. That is
deliberate. An earlier version of this file was a normalised copy with
apostrophes stripped and everything lowercased, which put `dont` and `didnt` in
as though they were words and silently collided `we'll` into `well`. The a-z
constraint belongs to the game engine, not to the source data, so the filtering
happens in `tools/build-fry.js` and 28 untypable words are dropped there with
their ranks preserved.

Verified 2026-08-02: positions 1–104 match the published order exactly, including
the run across the hundred boundary (`… may part over new sound take only`),
which is where a reshuffled copy drifts first. No duplicates.

## dolch.txt

**Dolch sight words**, Edward William Dolch, from his 1936 basic sight
vocabulary. 163 words, alphabetical — membership only, no ordering.

Every word in this file also appears in `fry-1000.txt`; it is a subset, and which
sub-selection of Dolch's original list it represents is not recorded here.

Note that `js/fry.js` writes a `dolch` flag onto every spine entry and **nothing
currently reads it.** Either give it a consumer or drop it.

## Licence

Both are word-frequency compilations — factual orderings, published for teaching
use and reproduced freely by school districts and universities. That is the whole
reason for choosing them over a commercial graded list: the word list travels
with the repo, and every clone gets an identical, playable spine.

This is the deliberate opposite of the Merriam-Webster cache in `data/words/` and
`data/audio-mw/`, which is gitignored because it is not ours to redistribute.
**The line between the two is licence, not convenience, and it should stay
visible in the file layout.**
