// The scheduler for the math game: which fact comes next.
//
// All of the logic lives in core/scheduler.js and is shared with the spelling
// game. This file is the binding: it supplies math's item-space adapter, keeps
// the four positional parameters this game's callers already use, and hands back
// a Fact rather than the id the core deals in.
//
// Read core/scheduler.js for the rules — the three constraints, their order, and
// the four relaxation passes. None of that is restated here.
//
// Math passes neither of the core's two optional dials. `candidates` defaults to
// the whole fact space, which is what this game has always sampled; `itemWeight`
// defaults to 1, because a multiplication fact carries no difficulty beyond the
// bucket the kid has earned on it. Both exist for the spelling game, where a
// word's typing difficulty is a second, independent dial.
//
// Pure module: no DOM, no network, no clock, no randomness of its own.

import { pickNext as pickCoreNext } from '../../core/scheduler.js';
import { mathSpace } from './space.js';

/**
 * Pick the next fact to serve.
 *
 * The core returns an id, because the id is what the log, the history and both
 * derived maps are keyed by. This game's callers want the Fact, and they get a
 * FRESH one rather than the model's own, so a caller that mutates what it gets
 * back cannot corrupt the derived model.
 *
 * @param {{byId: Map<string, object>, confusions: Map<string, Set<number>>}} model
 * @param {string[]} history FactIds served this session, most recent LAST
 * @param {{weights: object, noRepeatWithin: number, governorWindow: number, governorFloor: number}} config
 * @param {() => number} rng injected source in [0,1) — the only nondeterminism here
 * @returns {{op: string, a: number, b: number}}
 */
export function pickNext(model, history, config, rng) {
  const id = pickCoreNext({ model, history, config, rng, space: mathSpace });
  return { ...model.byId.get(id).fact };
}
