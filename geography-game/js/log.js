// The geography game's log client. The whole implementation — outbox, failure
// model, serverIsUp — lives in core/log.js; this file only says which game we
// are.
//
// The ONE impure module under geography-game/js/ that reaches the network or
// storage. main.js is impure for a different reason: it owns the clock and the
// randomness. Nothing else in this game touches either.
//
// `kct.geography.outbox.v1` is a persistence key in a real kid's browser. Do not
// change it: events queued under the old key would be stranded, and a kid would
// silently lose rounds they actually played.

import { CONFIG } from './config.js';
import { createLogClient } from '../../core/log.js';

const client = createLogClient({
  game: 'geography',
  outboxKey: 'kct.geography.outbox.v1',
  defaultTail: CONFIG.logTail,
});

export const { serverIsUp, loadEvents, record, flushOutbox } = client;
