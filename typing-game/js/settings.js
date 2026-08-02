// Device preferences — the ONE exception to "the log is the source of truth"
// (spec §9a). These are not observations, and they are needed synchronously at
// boot, before any fetch resolves; routing them through the event stream would
// mean rendering the first frame without knowing what to render.
//
// Every access is guarded. localStorage is absent in node and can throw outright
// in some privacy modes, and a kid must always be able to play: a corrupt value
// and a first run are treated identically.

const KEY = 'kct.typing.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  name: null,
  // Distinguishes "skipped the name prompt" from "not yet asked". Without it a
  // kid who skipped gets asked again on every launch (spec §5).
  hasAskedName: false,
  blockOnError: true,
  guidance: 3,
  accent: '#7b6bd6',
  skin: '#e8b7ac',
  lastLesson: null,
});

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Per-field validation. An invalid field falls back alone, not the whole object. */
function clean(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (typeof raw.name === 'string' && raw.name.length > 0) out.name = raw.name;
  if (typeof raw.hasAskedName === 'boolean') out.hasAskedName = raw.hasAskedName;
  if (typeof raw.blockOnError === 'boolean') out.blockOnError = raw.blockOnError;
  if (Number.isInteger(raw.guidance) && raw.guidance >= 0 && raw.guidance <= 3) {
    out.guidance = raw.guidance;
  }
  if (typeof raw.accent === 'string') out.accent = raw.accent;
  if (typeof raw.skin === 'string') out.skin = raw.skin;
  if (typeof raw.lastLesson === 'string') out.lastLesson = raw.lastLesson;
  return out;
}

/**
 * @returns {object} settings, always complete and always valid
 */
export function loadSettings() {
  const store = storage();
  if (store === null) return { ...DEFAULT_SETTINGS };

  let raw;
  try {
    raw = store.getItem(KEY);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (raw === null || raw === undefined || raw === '') return { ...DEFAULT_SETTINGS };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...DEFAULT_SETTINGS };
  }
  return clean(parsed);
}

/**
 * @param {object} settings
 * @returns {void}
 */
export function saveSettings(settings) {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(KEY, JSON.stringify(clean(settings)));
  } catch {
    // Quota exceeded or storage disabled. Losing a preference is strictly
    // better than throwing into the game loop.
  }
}
