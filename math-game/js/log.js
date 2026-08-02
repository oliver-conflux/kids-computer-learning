// Math's log client. The whole implementation — outbox, failure model,
// serverIsUp — lives in core/log.js; this file only says which game we are.
//
// One of exactly two impure modules under math-game/js/ (the other is main.js),
// and the only one that reaches the network, by way of the core client.
//
// `kct.math.outbox.v1` is a persistence key in a real kid's browser. Do not
// change it: events queued under the old key would be stranded, and a kid would
// silently lose rounds they actually played.

import { CONFIG } from './config.js';
import { createLogClient } from '../../core/log.js';

const client = createLogClient({
  game: 'math',
  outboxKey: 'kct.math.outbox.v1',
  defaultTail: CONFIG.logTail,
});

export const { serverIsUp, loadEvents, record, flushOutbox } = client;
