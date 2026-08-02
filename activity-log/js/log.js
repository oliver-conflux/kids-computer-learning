// The timeclock's log client. The whole implementation — outbox, failure model,
// serverIsUp — lives in core/log.js; this file only says which game we are.
//
// One of exactly two impure modules under activity-log/js/ (the other is
// main.js, which owns the clock, the randomness and the DOM), and the only one
// that reaches the network or storage.
//
// `kct.activity.outbox.v1` is a persistence key in a real kid's browser. Do not
// change it. Events queued under the old key would still be sitting in
// localStorage, unreachable, and no code would ever look for them again — so a
// clock-in typed while the server was down would vanish, and the session it
// belongs to would never appear in the log. That is not hypothetical here: the
// timeclock is the one app in this repo she is expected to use *before* she has
// started anything else, which is exactly when a laptop is most likely to be
// offline.
//
// The key is also what keeps this outbox separate from math's and spelling's.
// Sharing one would replay this game's events into another game's log.

import { CONFIG } from './config.js';
import { createLogClient } from '../../core/log.js';

const client = createLogClient({
  game: 'activity',
  outboxKey: 'kct.activity.outbox.v1',
  defaultTail: CONFIG.logTail,
});

export const { serverIsUp, loadEvents, record, flushOutbox } = client;
