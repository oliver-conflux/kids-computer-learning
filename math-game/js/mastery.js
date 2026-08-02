// Mastery derivation for the math game.
//
// All of the logic lives in core/mastery.js and is shared with the spelling
// game. This file is the binding: it supplies math's item-space adapter, which
// is also what tells the core to call the item `fact` rather than `item`, so
// nothing on this side of the seam had to learn a new word.
//
// Read core/mastery.js for the rules — the three windows, the retain window, the
// `maxPlausibleMs` outlier guard, and why learn attempts are not mastery
// evidence. None of that is restated here, because a second copy of an
// explanation is a second thing to get out of date.
//
// Pure module: no DOM, no network, no clock, no randomness. Config arrives as a
// parameter so the same log can be replayed under a different tunables table.

import { deriveMastery as deriveCoreMastery } from '../../core/mastery.js';
import { mathSpace } from './space.js';

export { compareTimestamps } from '../../core/mastery.js';

/**
 * @typedef {{ ms: number, stage: string, wrong: number[] }} Attempt
 * @typedef {{
 *   id: string,
 *   fact: {op: string, a: number, b: number},
 *   bucket: 'cold' | 'warm' | 'hot',
 *   attempts: Attempt[],
 *   cleanCount: number,
 *   medianCleanMs: number | null,
 *   taught: boolean,
 * }} FactStats
 * @typedef {{ byId: Map<string, FactStats>, confusions: Map<string, Set<number>> }} MasteryModel
 */

/**
 * Derive the mastery model from a list of log events.
 *
 * @param {object[]} events
 * @param {{retain: number, hotMs: number, maxPlausibleMs: number}} config
 * @returns {MasteryModel}
 */
export function deriveMastery(events, config) {
  return deriveCoreMastery(events, config, mathSpace);
}
