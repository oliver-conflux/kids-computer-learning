// Dependency-free localhost server for the kids-computer-learning games.
// Serves static files from the repo root and owns the per-game logs in data/.
//
// Three hygiene rules, all tested in math-game/tests/server.test.js:
//   1. binds 127.0.0.1 only, never 0.0.0.0 — this does not go on the network
//   2. every requested path is resolved and checked to be inside the repo root
//   3. ?game= names a log through an allowlist; an unknown game is a 400

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 8777;
export const REPO_ROOT = path.resolve(HERE, '..');
export const DEFAULT_GAME = 'math';

/** The ONLY log files this server will ever touch, keyed by `?game=`. */
export const LOG_PATHS = {
  math: path.join(REPO_ROOT, 'data', 'math-log.jsonl'),
  typing: path.join(REPO_ROOT, 'data', 'typing-log.jsonl'),
  spelling: path.join(REPO_ROOT, 'data', 'spelling-log.jsonl'),
  geography: path.join(REPO_ROOT, 'data', 'geography-log.jsonl'),
  activity: path.join(REPO_ROOT, 'data', 'activity-log.jsonl'),
};

export const DEFAULT_LOG_PATH = LOG_PATHS.math;
export const DEFAULT_TAIL = 2000;

/**
 * Where tools/fetch-words.js writes cached pronunciations, relative to the
 * server's root. Derived from `root` rather than from REPO_ROOT so that a server
 * given a different root reads that root's cache — which is what makes it
 * testable, and what stops a test from reporting on the developer's real cache.
 *
 * @param {string} root
 * @returns {string}
 */
export function audioDirFor(root) {
  return path.join(root, 'data', 'audio');
}

/** The spine's word contract, and therefore the cache's filename contract. */
export const SAFE_WORD = /^[a-z]+$/;

/**
 * Resolve `?game=` to a log path through an ALLOWLIST.
 *
 * This value reaches the filesystem, so it is never interpolated into a path.
 * hasOwnProperty rather than `in` or a truthiness check, so inherited keys like
 * '__proto__' cannot name a path. An unknown game is a 400, not a fallback —
 * falling back would turn a typo into silent writes to the wrong game's history.
 *
 * @param {Record<string, string>} paths
 * @param {string | null} game
 * @returns {string | null} null if the game is unknown
 */
export function logPathFor(paths, game) {
  const key = game === null || game === undefined ? DEFAULT_GAME : game;
  return Object.prototype.hasOwnProperty.call(paths, key) ? paths[key] : null;
}

const MAX_BODY_BYTES = 1024 * 1024;

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  // The spelling game's cached Merriam-Webster pronunciations. Without this the
  // fallback is application/octet-stream, and while browsers will often sniff an
  // mp3 anyway, "often" is not a thing to rest a kid's only clue on: in drill
  // mode the audio IS the question, and a refused decode looks exactly like a
  // working game with empty boxes.
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

export function mimeTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve a URL pathname to an absolute file path inside `root`.
 * Returns null when the path escapes the root or is otherwise unsafe.
 */
export function resolveSafe(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null;

  const rootAbs = path.resolve(root);
  // Join, not resolve-from-cwd: a leading '/' in `decoded` is a URL root, not a
  // filesystem root. path.join normalises '..' segments so the check below sees
  // the real target.
  const target = path.resolve(path.join(rootAbs, decoded));
  if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) return null;
  return target;
}

/** Read the last `tail` well-formed JSON lines of the log. Malformed lines are skipped. */
export function readLog(logPath, tail = DEFAULT_TAIL) {
  let raw;
  try {
    raw = fs.readFileSync(logPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const events = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') events.push(parsed);
    } catch {
      // a corrupt line must never break a session — skip it
    }
  }
  return tail >= events.length ? events : events.slice(events.length - tail);
}

/** Append one event as exactly one line. */
export function appendEvent(logPath, event) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(event) + '\n');
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { 'content-type': MIME_TYPES['.json'] });
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseTail(value) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TAIL;
}

function serveStatic(root, pathname, res) {
  const target = resolveSafe(root, pathname);
  if (target === null) {
    send(res, 403, 'Forbidden', { 'content-type': MIME_TYPES['.txt'] });
    return;
  }

  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    send(res, 404, 'Not Found', { 'content-type': MIME_TYPES['.txt'] });
    return;
  }

  let file = target;
  if (stat.isDirectory()) {
    file = path.join(target, 'index.html');
    if (!fs.existsSync(file)) {
      send(res, 404, 'Not Found', { 'content-type': MIME_TYPES['.txt'] });
      return;
    }
  }

  try {
    const body = fs.readFileSync(file);
    send(res, 200, body, { 'content-type': mimeTypeFor(file) });
  } catch {
    send(res, 404, 'Not Found', { 'content-type': MIME_TYPES['.txt'] });
  }
}

/**
 * Build the server. Nothing listens until you call .listen().
 * `logPath` is the older single-log form: it overrides the default game's path
 * and leaves the rest of the allowlist alone.
 * @param {{ root?: string, logPath?: string, logPaths?: Record<string, string> }} [options]
 */
export function createServer(options = {}) {
  const root = path.resolve(options.root ?? REPO_ROOT);
  const logPaths =
    options.logPaths ??
    (options.logPath === undefined
      ? LOG_PATHS
      : { ...LOG_PATHS, [DEFAULT_GAME]: options.logPath });

  return http.createServer(async (req, res) => {
    // Base is a placeholder: only pathname and search are ever used.
    const url = new URL(req.url, 'http://127.0.0.1');
    // The WHATWG parser collapses '..' segments, which would silently turn a
    // traversal attempt into a plain 404. Keep the raw path so we can answer 403.
    const rawPathname = req.url.split(/[?#]/, 1)[0];

    if (url.pathname === '/api/log') {
      const logPath = logPathFor(logPaths, url.searchParams.get('game'));
      if (logPath === null) {
        sendJson(res, 400, { error: 'unknown game' });
        return;
      }
      if (req.method === 'GET') {
        try {
          const events = readLog(logPath, parseTail(url.searchParams.get('tail')));
          sendJson(res, 200, { events });
        } catch {
          sendJson(res, 500, { error: 'log read failed' });
        }
        return;
      }
      if (req.method === 'POST') {
        let raw;
        try {
          raw = await readBody(req);
        } catch {
          sendJson(res, 400, { error: 'body too large' });
          return;
        }
        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          sendJson(res, 400, { error: 'body is not JSON' });
          return;
        }
        if (event === null || typeof event !== 'object' || Array.isArray(event) ||
            typeof event.type !== 'string' || event.type === '') {
          sendJson(res, 400, { error: 'event needs a type' });
          return;
        }
        try {
          appendEvent(logPath, event);
        } catch {
          sendJson(res, 500, { error: 'log write failed' });
          return;
        }
        send(res, 204, '');
        return;
      }
      send(res, 405, 'Method Not Allowed', { 'content-type': MIME_TYPES['.txt'] });
      return;
    }

    // Which words actually have a pronunciation on disk.
    //
    // The spelling game trims its word list to this, because a word with no
    // audio is unanswerable in drill mode — the kid is shown empty boxes and
    // asked to spell something she was never told. Merriam-Webster has no
    // recording for irregular inflections (`said`, `went`, `feet`), so without
    // this the game serves words it cannot pronounce.
    //
    // A LIVE DIRECTORY READ, not a manifest file, so that dropping new mp3s in
    // is all it takes — no regeneration step to forget. That matters because the
    // gap words are expected to arrive later from a different voice source (see
    // spelling-game/docs/audio-sourcing.md).
    //
    // Read-only, no parameters, one fixed directory that never leaves the repo:
    // there is no user input here to smuggle a path through. Names are filtered
    // to the same lowercase-a–z contract the spine and the cache filenames use,
    // so nothing that could not already be requested as /data/audio/<word>.mp3
    // is ever named.
    if (url.pathname === '/api/audio') {
      if (req.method !== 'GET') {
        send(res, 405, 'Method Not Allowed', { 'content-type': MIME_TYPES['.txt'] });
        return;
      }
      let words = [];
      try {
        words = fs
          .readdirSync(audioDirFor(root))
          .filter((name) => name.endsWith('.mp3'))
          .map((name) => name.slice(0, -'.mp3'.length))
          .filter((word) => SAFE_WORD.test(word))
          .sort();
      } catch {
        // No cache directory at all is the expected state of a fresh clone, and
        // it is not an error: an empty list tells the game to trim nothing.
        words = [];
      }
      sendJson(res, 200, { words });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method Not Allowed', { 'content-type': MIME_TYPES['.txt'] });
      return;
    }

    serveStatic(root, rawPathname, res);
  });
}

/**
 * Start listening on 127.0.0.1. Pass port 0 for an ephemeral port.
 * @returns {Promise<import('node:http').Server>}
 */
export function start({ port = DEFAULT_PORT, root, logPath, logPaths } = {}) {
  const server = createServer({ root, logPath, logPaths });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolve(server));
  });
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const port = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT;
  start({ port })
    .then(() => {
      console.log(`Serving ${REPO_ROOT} at http://localhost:${port}/`);
      for (const [game, file] of Object.entries(LOG_PATHS)) {
        console.log(`Log (${game}): ${file}`);
      }
      console.log('Close this window to stop the server.');
    })
    .catch((err) => {
      console.error(`Could not start server on port ${port}: ${err.message}`);
      process.exit(1);
    });
}
