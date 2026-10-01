/* The shared bootstrap and the bar every page carries.

   Markup here mirrors docs/report-design/Main.dc.html: `.root` wraps a `.bar` and
   then the page's own content. The nav tabs exist only once a survey is open --
   on the health screen the bar is the brand and the cog and nothing else. */

import { el, fill, svgEl } from './util/dom.js';
import { icon, platformIcon } from './util/icons.js';
import { armPress } from './util/press.js';
import { armTips } from './util/tip.js';
import { listSources, readManifest, captureIndex, platformOf } from './data/sources.js';
import { loadBaseline, SUPPORTED_SCHEMA } from './data/baseline.js';

/* The tabs, in the canvas's reading order.
   `perf` and `a11y` are declared because the design has them, and marked off
   because nothing writes their artifacts into this layout yet -- an absent tab
   would say the feature does not exist, which is a different claim. */
const NAV = [
  { file: 'map.html', label: 'map' },
  { file: 'runs.html', label: 'runs' },
  { file: 'coverage.html', label: 'coverage' },
  { file: 'perf.html', label: 'perf', off: 'No perf data' },
  { file: 'a11y.html', label: 'a11y', off: 'No a11y data' },
];

export function param(name) {
  return new URLSearchParams(location.search).get(name) || '';
}

/* A link to another page, carrying the current source. */
export function href(file, extra = {}) {
  const q = new URLSearchParams({ src: param('src'), ...extra });
  return `${file}?${q}`;
}

/* A whole-page message, used for loading, empty configuration and failure. */
export function message(title, body, detail) {
  return el('div', { class: 'index' },
    el('div', { class: 'h1', text: title }),
    body && el('p', { class: 'p', text: body }),
    detail && el('p', { class: 'p mono', text: detail }));
}

/* The site theme, applied before anything is drawn.
   Three states: an explicit light or dark choice, or following the system. */
function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
  else document.documentElement.removeAttribute('data-theme');
  try {
    localStorage.setItem('cartographer-theme', mode);
  } catch { /* private mode */ }
}

const THEMES = ['auto', 'light', 'dark'];

function storedTheme() {
  try {
    const v = localStorage.getItem('cartographer-theme');
    return THEMES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/* The cog, holding the site theme: auto follows the system's light or dark setting.
   The capture tone lives in the map toolbar instead, because it is a property of the
   screenshots and not of this site. */
function gear() {
  const menu = el('div', { class: 'menu' },
    el('div', { class: 'theme', 'data-scope': 'group' },
      ...[['auto', 'auto', 'Auto, as the system'], ['sun', 'light', 'Light'], ['moon', 'dark', 'Dark']]
        .map(([ic, mode, title]) => {
          const b = el('button', {
            class: storedTheme() === mode ? 'on' : '',
            'data-tip': title,
            'aria-pressed': String(storedTheme() === mode),
            onclick: () => {
              applyTheme(mode);
              for (const sib of b.parentNode.children) {
                sib.className = sib === b ? 'on' : '';
                sib.setAttribute('aria-pressed', String(sib === b));
              }
            },
          }, icon(ic, 13));
          return b;
        })));
  menu.hidden = true;

  const button = el('button', {
    'data-tip': 'Settings',
    onclick: () => {
      menu.hidden = !menu.hidden;
      button.className = menu.hidden ? '' : 'on';
    },
  }, icon('gear', 14));
  return el('div', { class: 'gear' }, button, menu);
}

/* The bar. `current` is the page's own file name, or '' on the health screen
   where no tabs are shown. */
function bar(state, current) {
  const kids = [el('button', { class: 'brand', onclick: () => { location.href = 'index.html'; } }, 'cartographer')];

  if (state.source) {
    kids.push(el('span', { class: 'appname', text: state.source.name }));
    kids.push(el('div', { class: 'tabs', 'data-scope': 'group' }, NAV.map(n => n.off
      ? el('span', { class: 'tab off', 'data-tip': n.off, text: n.label })
      : el('a', { class: `tab${n.file === current ? ' on' : ''}`, href: href(n.file), text: n.label }))));
    kids.push(el('span', { class: 'src' }, icon(platformIcon(platformOf(state.profile)), 14), state.model ? state.model.meta.app || '' : ''));
  }
  kids.push(gear());
  return el('header', { class: 'bar' }, kids);
}

/* Load everything a page needs, then hand it to `render`. */
export async function page({ current, needsBaseline = true, needsModel = true, render }) {
  applyTheme(storedTheme());
  // Armed once on the document, capturing, so every page gets the hover wash
  // and press pulse without each view wiring its own controls.
  armPress(document);
  // The site's own tooltip, for every `data-tip` on every page.
  armTips(document);
  const root = el('div', { class: 'root' });
  const host = document.getElementById('app');
  fill(host, root);

  const state = { sources: [], source: null, manifest: null, profile: null, captures: new Map(), model: null };
  const show = (...kids) => fill(root, bar(state, current), ...kids);

  /* `render` may be async, so it is always awaited before it is drawn.
     A failed draw reports itself and rethrows, so the console keeps the stack. */
  const draw = async () => {
    try {
      show(await render(state));
    } catch (err) {
      show(message('This page failed to draw', String(err.message || err)));
      throw err;
    }
  };

  try {
    state.sources = await listSources();
  } catch (err) {
    show(message('Could not read /sources.json', String(err.message || err),
      'Serve this folder with `python serve.py`; a file:// URL cannot fetch.'));
    return;
  }

  if (!needsBaseline) {
    await draw();
    return;
  }

  const wanted = param('src');
  state.source = state.sources.find(s => s.id === wanted)
    || (state.sources.length === 1 ? state.sources[0] : null);

  if (!state.source) {
    show(message(wanted ? 'Unknown source' : 'No source chosen',
      wanted ? `No configured source has the id "${wanted}".` : 'Pick one from the index.'));
    return;
  }

  show(message('Reading the map', state.source.path));

  try {
    state.manifest = await readManifest(state.source);
    state.profile = (state.manifest.profiles || [])[0] || null;
    state.captures = state.profile
      ? captureIndex(state.profile, `${state.source.url}baselines/${state.profile.key}/`)
      : new Map();
    if (state.manifest.graph) {
      state.model = await loadBaseline(state.source.url + state.manifest.graph);
    }
  } catch (err) {
    show(message('Could not read the map', String(err.message || err), state.source.path));
    return;
  }

  if (!state.model) {
    // A project records runs before any baseline exists, so the runs page opens without one.
    if (needsModel) {
      show(message('No baseline yet', 'This project has no baselines/baseline.db. Its runs are on the runs page.',
        state.source.path));
      return;
    }
    await draw();
    return;
  }

  if (!state.model.schemaOk) {
    show(message('Map schema not supported', `This app reads schema v${SUPPORTED_SCHEMA.join(' and v')}.`,
      `schema_version = ${state.model.schema || '(absent)'}`));
    return;
  }

  await draw();
}

export { svgEl };
