/* The health screen: one row per configured knowledge folder.

   Markup follows docs/report-design/Main.dc.html's index: `.index` > `.lede` +
   `.apps` > `.app`, each row carrying a platform icon whose tooltip holds the
   device, the name, two figures with meters, and a chevron. Pressing a row
   reads that map and lands on it.

   The meters and counts are read from the folder's own manifest, so this page
   states what is on disk without opening a database. */

import { el } from '../util/dom.js';
import { icon, platformIcon, phoneIcon } from '../util/icons.js';
import { platformOf } from '../data/sources.js';

/* A count bar. Each segment is a share of the whole, and `r` takes the rest --
   which is what makes "nothing has been captured" visibly different from
   "nothing has been surveyed". */
function meter(parts) {
  const total = parts.reduce((n, p) => n + p.n, 0) || 1;
  return el('div', { class: 'meter' },
    parts.filter(p => p.n).map(p => el('i', { class: p.cls, style: `width:${(p.n / total) * 100}%` })),
    el('i', { class: 'r' }));
}

/* One figure: an icon, the split, and the total. */
function figure(name, title, parts, total) {
  return el('b', {},
    icon(name, 16, title),
    el('span', { class: 'vs' }, parts.map(p => el('span', { class: `v ${p.cls}`, text: String(p.n) }))),
    el('span', { class: 'ftot', text: String(total) }));
}

/* What a source's manifest says, without opening its database.
   Screens are counted from the capture tree and runs from the run folders,
   because both are directories the server has already walked. */
function summarise(manifest) {
  const profiles = manifest.profiles || [];
  const screensOf = p => new Set((p.renditions || []).map(r => r.screen));
  const screens = profiles.reduce((n, p) => n + screensOf(p).size, 0);
  // Screens holding at least one shot, not the number of shots. A screen is
  // captured in several conditions, so counting files put the split above its
  // own total and left the meter's "uncaptured" share permanently at zero.
  const captures = profiles.reduce((n, p) => n + new Set((p.renditions || [])
    .filter(r => r.leaves.some(l => Object.keys(l.shots).length)).map(r => r.screen)).size, 0);
  const runs = manifest.runs || [];
  return { profiles, screens, captures, runs, strays: manifest.strays || [] };
}

/* The device a profile records, as the platform icon's tooltip.
   A profile that cannot say what it ran on cannot be reproduced, so the tooltip
   says so rather than showing an empty label. */
function deviceTip(profile) {
  if (!profile) return 'No device profile recorded.';
  const p = { ...((profile.device && profile.device.profile) || {}), ...(profile.device || {}) };
  return [p.make && p.model && `${p.make} ${p.model}`, p.os && `Android ${p.os}`,
    p.resolution, p.density && `${p.density}dpi`, p.kind || (p.emulator === '1' ? 'emulator' : '')].filter(Boolean).join(' · ')
    || profile.name || profile.key;
}

export function renderSources(state, manifests) {
  const rows = state.sources.map(source => {
    const manifest = manifests.get(source.id);
    const open = () => { location.href = `map.html?src=${encodeURIComponent(source.id)}`; };

    if (!source.has_graph || !manifest) {
      // Listed rather than dropped: a configured folder with no map is usually
      // a survey nobody has run, and hiding it would look like a typo.
      return el('div', { class: 'app', style: 'cursor:default' },
        el('div', { class: 'app-n', text: source.name }),
        el('span', { class: 'app-pf', title: source.path }, icon('screen', 16)),
        el('div', { class: 'app-end' }, el('span', { class: 'stamp', style: '--c: var(--warn)', text: 'no map' })),
        el('div', { class: 'app-f', text: 'baselines/baseline.db' }));
    }

    const s = summarise(manifest);
    const uncaptured = Math.max(0, s.screens - s.captures);

    return el('div', { class: 'app', 'data-press': true, onclick: open, title: source.path },
      el('div', { class: 'app-n', text: source.name }),
      el('span', { class: 'app-pf', title: deviceTip(s.profiles[0]) }, icon(platformIcon(platformOf(s.profiles[0])), 16)),
      el('div', { class: 'fbar s' }, meter([{ cls: 'p', n: s.captures }, { cls: 'w', n: uncaptured }])),
      el('div', { class: 'fcnt s' }, figure(phoneIcon(platformIcon(platformOf(s.profiles[0]))), 'screens',
        [{ cls: 'v-p', n: s.captures }, { cls: 'v-w', n: uncaptured }], s.screens)),
      el('div', { class: 'fbar r' }, meter([{ cls: 'p', n: s.runs.length }])),
      el('div', { class: 'fcnt r' }, figure('route', 'runs',
        [{ cls: 'v-r', n: s.runs.length }], s.runs.length)),
      el('div', { class: 'app-end' },
        el('span', { class: 'stamp', style: `--c: var(--${s.runs.length ? 'pass' : 'skip'})`, text: s.runs.length ? 'surveyed' : 'no runs' })),
      el('div', {
        class: 'app-f',
        'data-tip': s.strays.length ? `Not a profile: ${s.strays.join(', ')}` : null,
        text: s.profiles[0] ? s.profiles[0].name || s.profiles[0].key : 'no profile',
      }),
      el('span', { class: 'app-go' }, icon('chevron', 14)),
      el('span', { class: 'app-bar' }));
  });

  return el('div', { class: 'index' },
    el('div', { class: 'lede' },
      el('div', { class: 'h1', text: 'Surveys' }),
      el('button', { class: 'btn ghost', 'data-tip': 'serve.py --add <path>' },
        icon('plus', 14), 'add a survey')),
    el('p', { class: 'p', text: 'Every cartographer folder this server can read, mounted read-only. Pressing one opens its map.' }),
    rows.length ? el('div', { class: 'apps' }, rows)
      : el('p', { class: 'empty', text: 'No folders configured. Add one to sources.json, or pass --add <path> to serve.py.' }));
}
