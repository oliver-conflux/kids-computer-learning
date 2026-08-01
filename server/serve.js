// Dependency-free localhost server for the kids-computer-learning games.
// Serves static files from the repo root and owns data/math-log.jsonl.
//
// Two hygiene rules, both tested in math-game/tests/server.test.js:
//   1. binds 127.0.0.1 only, never 0.0.0.0 — this does not go on the network
//   2. every requested path is resolved and checked to be inside the repo root

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 8777;
export const REPO_ROOT = path.resolve(HERE, '..');
export const DEFAULT_LOG_PATH = path.join(REPO_ROOT, 'data', 'math-log.jsonl');
export const DEFAULT_TAIL = 2000;

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
 * @param {{ root?: string, logPath?: string }} [options]
 */
export function createServer(options = {}) {
  const root = path.resolve(options.root ?? REPO_ROOT);
  const logPath = options.logPath ?? DEFAULT_LOG_PATH;

  return http.createServer(async (req, res) => {
    // Base is a placeholder: only pathname and search are ever used.
    const url = new URL(req.url, 'http://127.0.0.1');
    // The WHATWG parser collapses '..' segments, which would silently turn a
    // traversal attempt into a plain 404. Keep the raw path so we can answer 403.
    const rawPathname = req.url.split(/[?#]/, 1)[0];

    if (url.pathname === '/api/log') {
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
export function start({ port = DEFAULT_PORT, root, logPath } = {}) {
  const server = createServer({ root, logPath });
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
      console.log(`Log: ${DEFAULT_LOG_PATH}`);
      console.log('Close this window to stop the server.');
    })
    .catch((err) => {
      console.error(`Could not start server on port ${port}: ${err.message}`);
      process.exit(1);
    });
}
