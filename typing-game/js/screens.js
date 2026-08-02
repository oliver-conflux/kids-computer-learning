// typing-game/js/screens.js
//
// The first-run name prompt and the lesson menu (spec §4, §5).
//
// The name is asked ONCE and is always skippable — nothing may stand between a
// kid and playing. There is no profile picker: each kid has their own computer.
//
// DOM-facing: verified by playing it, not by unit tests.

import { lessonsForTrack } from './curriculum.js';
import { PRACTICE, withName } from './practice.js';

const PRACTICE_TABS = [
  { id: 'words', label: 'Words' },
  { id: 'sentences', label: 'Sentences' },
  { id: 'math', label: 'Math' },
  { id: 'name', label: 'My Name' },
];

/**
 * Ask for the kid's name. Calls back with the name, or null if skipped.
 *
 * @param {(name: string | null) => void} onDone
 * @returns {void}
 */
export function showNamePrompt(onDone) {
  const overlay = document.getElementById('name-prompt');
  const input = document.getElementById('name-input');
  overlay.classList.remove('hidden');
  input.focus();

  const finish = (name) => {
    overlay.classList.add('hidden');
    onDone(name);
  };
  document.getElementById('name-skip').addEventListener('click', () => finish(null));
  document.getElementById('name-save').addEventListener('click', () => {
    const value = input.value.trim();
    finish(value.length > 0 ? value : null);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('name-save').click();
  });
}

function rungButton(lesson, progress, onLesson) {
  const button = document.createElement('button');
  button.className = 'rung';
  const p = progress[lesson.id] ?? { stars: 0, handsOff: false };
  const stars = '★'.repeat(p.stars) + '☆'.repeat(3 - p.stars);
  button.appendChild(Object.assign(document.createElement('span'),
    { className: 'rung-title', textContent: lesson.title }));
  button.appendChild(Object.assign(document.createElement('span'),
    { className: 'rung-stars', textContent: stars + (p.handsOff ? ' ✋' : '') }));
  button.addEventListener('click', () => onLesson(lesson.id));
  return button;
}

/**
 * The menu. Every rung is clickable — the ladder is a soft gate and nothing is
 * ever locked (spec §9). Stars are the pull to come back, not a wall.
 *
 * @param {Record<string, object>} progress from progress.allProgress
 * @param {{onLesson: (id: string) => void, onPractice: (tab: string) => void}} handlers
 * @returns {void}
 */
export function showMenu(progress, handlers) {
  document.getElementById('menu').classList.remove('hidden');

  for (const track of ['letters', 'numbers']) {
    const host = document.getElementById(`track-${track}`);
    host.textContent = '';
    for (const lesson of lessonsForTrack(track)) {
      host.appendChild(rungButton(lesson, progress, handlers.onLesson));
    }
  }

  const tabs = document.getElementById('practice-tabs');
  tabs.textContent = '';
  for (const tab of PRACTICE_TABS) {
    const button = document.createElement('button');
    button.className = 'rung';
    button.textContent = tab.label;
    button.addEventListener('click', () => handlers.onPractice(tab.id));
    tabs.appendChild(button);
  }
}

/** @returns {void} */
export function hideMenu() {
  document.getElementById('menu').classList.add('hidden');
}

/** Draw `count` distinct items from `pool`. */
function sample(pool, count, rng) {
  const remaining = [...pool];
  const picked = [];
  for (let i = 0; i < count && remaining.length > 0; i += 1) {
    const index = Math.floor(rng() * remaining.length) % remaining.length;
    picked.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return picked;
}

/**
 * A 10-item practice round. Practice content is NOT key-restricted (spec §4).
 *
 * The "name" tab is the kid's own name repeated — the single best motivation
 * for learning shift, which is why it lives here, ungated, rather than behind
 * rung 12. A kid who skipped the name prompt gets the sentences tab instead.
 *
 * @param {string} tab one of 'words' | 'sentences' | 'math' | 'name'
 * @param {string | null} name
 * @param {() => number} rng
 * @returns {string[]}
 */
export function practiceItems(tab, name, rng) {
  if (tab === 'name') {
    if (name === null) return practiceItems('sentences', null, rng);
    return Array.from({ length: 10 }, () => name);
  }
  if (tab === 'math') return sample(PRACTICE.math, 10, rng);
  if (tab === 'words') {
    const all = [...PRACTICE.words.short, ...PRACTICE.words.medium, ...PRACTICE.words.long];
    return sample(all, 10, rng);
  }
  const all = [
    ...PRACTICE.sentences.short, ...PRACTICE.sentences.commas, ...PRACTICE.sentences.mixed,
  ];
  return withName(sample(all, 10, rng), name);
}
