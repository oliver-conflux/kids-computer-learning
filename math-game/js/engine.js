// The math game's binding of the shared problem engine — see core/engine.js for
// the state machine itself, and for why there is no submit key.
//
// This file is a binding shim and holds no logic. It supplies math's item space
// and re-exports the six transitions under the names math's callers already use.
//
// The state field is bound to `fact` rather than the core's default `item`,
// because that is what `ui/problem.js` reads and what this game's tests assert
// on. That binding is declared on `mathSpace` itself, not here — see
// core/space.js. Every transition below is the core function ITSELF, unwrapped,
// because the no-op paths return their input BY REFERENCE and `main.js` and the
// renderer's pulse guard compare identity to detect that nothing happened. A
// wrapper would hand back a fresh object each time and break both, silently —
// the game would keep working and merely re-run the shake animation every frame.
//
// `typeDigit` keeps its old name here. The core calls it `typeChar` because a
// spelling entry is not made of digits; renaming math's callers would be churn
// with no reader on the other end.
//
// Pure module: no DOM, no network, no clock, no randomness.

import { createEngine } from '../../core/engine.js';
import { mathSpace } from './space.js';

const engine = createEngine(mathSpace);

export const startProblem = engine.startProblem;
export const typeDigit = engine.typeChar;
export const backspace = engine.backspace;
export const tick = engine.tick;
export const revealAnswer = engine.revealAnswer;
export const toAttemptEvent = engine.toAttemptEvent;
