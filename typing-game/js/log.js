// Typing's log client. The whole implementation — outbox, failure model,
// serverIsUp — lives in core/log.js; this file only says which game we are.
//
// One of exactly two impure modules under typing-game/js/ (the other is
// main.js), and the only one that reaches the network, by way of the core
// client.
//
// `kct.typing.outbox.v1` is a persistence key in a real kid's browser. Do not
// change it: events queued under the old key would be stranded, and a kid would
// silently lose rounds they actually played.

import { createLogClient } from '../../core/log.js';

// How many events to ask for by default. The typing game has no config module,
// so the tail lives here.
const DEFAULT_TAIL = 2000;

const client = createLogClient({
  game: 'typing',
  outboxKey: 'kct.typing.outbox.v1',
  defaultTail: DEFAULT_TAIL,
});

export const { serverIsUp, loadEvents, record, flushOutbox } = client;
