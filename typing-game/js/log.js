// The log client — one of exactly two impure modules in the project (the other
// is main.js). It is the only place in typing-game/js/ that touches `fetch` or
// `localStorage`.
//
// The log file on disk is the single source of truth. localStorage holds ONE
// thing: an outbox of events the server has not acknowledged yet. It is a
// buffer, not a second store — never derive game state from it.
//
// Failure model, matching server/serve.js exactly:
//   204            success (empty body — never call .json() on a POST response)
//   4xx            PERMANENT. The server rejected the event itself (not JSON, no
//                  `type`, body over 1 MiB). Retrying can only fail again, so
//                  the event is dropped rather than looping the outbox forever.
//   5xx / network  TRANSIENT. Queue and retry on the next load.

const LOG_URL = '/api/log?game=typing';
const OUTBOX_KEY = 'kct.typing.outbox.v1';

// How many events to ask for by default. The typing game has no config module,
// so the tail lives here.
const DEFAULT_TAIL = 2000;

// A safety valve, not a policy: a long offline session should not grow the
// outbox without bound. Oldest events are shed first.
const OUTBOX_MAX = 500;

// --- outbox storage -------------------------------------------------------

// localStorage is absent in node and can throw outright in some privacy modes,
// so every access is guarded. No storage simply means no outbox.
function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readOutbox() {
  const store = storage();
  if (store === null) return [];
  let raw;
  try {
    raw = store.getItem(OUTBOX_KEY);
  } catch {
    return [];
  }
  if (raw === null || raw === undefined || raw === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A corrupt outbox must never break a session. Same rule as a corrupt log.
    return [];
  }
}

function writeOutbox(events) {
  const store = storage();
  if (store === null) return;
  try {
    if (events.length === 0) store.removeItem(OUTBOX_KEY);
    else store.setItem(OUTBOX_KEY, JSON.stringify(events));
  } catch {
    // Quota exceeded or storage disabled. Losing a queued event is strictly
    // better than throwing into the game loop.
  }
}

function queue(event) {
  const pending = readOutbox();
  pending.push(event);
  writeOutbox(pending.length > OUTBOX_MAX ? pending.slice(pending.length - OUTBOX_MAX) : pending);
}

// --- transport ------------------------------------------------------------

/**
 * POST one event. Never rejects.
 * @returns {Promise<'ok' | 'permanent' | 'transient'>}
 */
async function post(event) {
  let body;
  try {
    body = JSON.stringify(event);
  } catch {
    return 'permanent'; // unserialisable — the server would 400 it anyway
  }

  let res;
  try {
    res = await fetch(LOG_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  } catch {
    return 'transient'; // server down, page unloading, network gone
  }

  if (res.status === 204 || res.ok) return 'ok';
  if (res.status >= 400 && res.status < 500) return 'permanent';
  return 'transient';
}

// --- public API -----------------------------------------------------------

/**
 * Whether the log endpoint is actually reachable.
 *
 * This exists because loadEvents() deliberately cannot answer the question: it
 * returns [] both for "server is down" and for "first run on a new machine",
 * and conflating those is right for it but wrong at boot. Without this, a game
 * served without its API plays perfectly and quietly banks every round into an
 * outbox that may never flush — the kid sees their stars, and then does not.
 *
 * @returns {Promise<boolean>}
 */
export async function serverIsUp() {
  try {
    const res = await fetch(`${LOG_URL}&tail=1`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Read the tail of the log. Resolves to [] on any failure — a missing log is a
 * first run, not an error, and the game must start on a machine that has never
 * played.
 * @param {number} [tail]
 * @returns {Promise<object[]>}
 */
export async function loadEvents(tail = DEFAULT_TAIL) {
  try {
    // `&`, not `?` — LOG_URL already carries the game query parameter.
    const res = await fetch(`${LOG_URL}&tail=${encodeURIComponent(tail)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body?.events) ? body.events : [];
  } catch {
    return [];
  }
}

/**
 * Fire one event at the server without awaiting it. The caller never blocks —
 * the kid must never wait on I/O between problems. On a transient failure the
 * event lands in the outbox; on a permanent rejection it is dropped.
 * @param {object} event
 * @returns {void}
 */
export function record(event) {
  post(event).then((outcome) => {
    if (outcome === 'transient') queue(event);
  });
}

/**
 * Re-post queued events oldest-first, clearing each on success. Called once at
 * startup. Stops at the first transient failure so ordering is preserved and a
 * dead server is not hammered once per queued event.
 * @returns {Promise<void>}
 */
export async function flushOutbox() {
  const pending = readOutbox();
  if (pending.length === 0) return;

  const remaining = [];
  let serverIsDown = false;

  for (const event of pending) {
    if (serverIsDown) {
      remaining.push(event);
      continue;
    }
    const outcome = await post(event);
    if (outcome === 'transient') {
      remaining.push(event);
      serverIsDown = true;
    }
    // 'ok' and 'permanent' both leave the event out of `remaining`: acknowledged
    // or unacceptable, either way it never comes back.
  }

  writeOutbox(remaining);
}
