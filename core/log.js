// The shared log client — an IMPURE module by design. It is the one place in
// the whole project that touches `fetch` or `localStorage`, and each game's
// js/log.js is now a two-line shim over it.
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
//
// Every client is built by the factory, so nothing about a game lives at module
// scope: two clients in one process share this file's code and none of its
// state. That matters because the outbox key is the one value that must never
// leak from one game into another — a shared outbox would replay math events
// into the spelling log.

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

/**
 * Build a log client bound to one game.
 *
 * @param {{ game: string, outboxKey: string, defaultTail: number }} options
 *   `outboxKey` is a persistence key in a real kid's browser: changing it
 *   strands whatever is already queued under the old one, and those events are
 *   unreachable forever.
 * @returns {{
 *   serverIsUp: () => Promise<boolean>,
 *   loadEvents: (tail?: number) => Promise<object[]>,
 *   record: (event: object) => void,
 *   flushOutbox: () => Promise<void>,
 * }}
 */
export function createLogClient({ game, outboxKey, defaultTail }) {
  const logUrl = `/api/log?game=${encodeURIComponent(game)}`;

  function readOutbox() {
    const store = storage();
    if (store === null) return [];
    let raw;
    try {
      raw = store.getItem(outboxKey);
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
      if (events.length === 0) store.removeItem(outboxKey);
      else store.setItem(outboxKey, JSON.stringify(events));
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

  // --- transport ----------------------------------------------------------

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
      res = await fetch(logUrl, {
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

  // --- public API ---------------------------------------------------------

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
  async function serverIsUp() {
    try {
      // `&`, not `?` — logUrl already carries the game query parameter.
      const res = await fetch(`${logUrl}&tail=1`, {
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
  async function loadEvents(tail = defaultTail) {
    try {
      // `&`, not `?` — logUrl already carries the game query parameter.
      const res = await fetch(`${logUrl}&tail=${encodeURIComponent(tail)}`, {
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
  function record(event) {
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
  async function flushOutbox() {
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

  return { serverIsUp, loadEvents, record, flushOutbox };
}
