/* One screen: the capture on the left, everything about it on the right.

   Markup follows docs/report-design/Main.dc.html's detail page: `.page` > `.phead` +
   `.pgrid`, with a `.viewer` (`.vtools` dropdowns over the state's `.vgrid`)
   in the first column, and Conditions / Routes in / Routes out / Runs as
   `.psec` blocks in the second.

   Nothing on this page states the same fact twice: the head is the back arrow,
   the id, a stamp and the summary only, because each section header prints its
   own count. */

import { el, setChildren } from '../util/dom.js';
import { icon } from '../util/icons.js';
import { href, param } from '../page.js';
import { platformOf, variants, localesOf, unplaced, firstCapture, provenance } from '../data/sources.js';
import { variantGrid, variantStrip, stateLabel } from './variants.js';

/* A dropdown: a button carrying the current value, and a menu under it.
   The `.k` prefix inside the button says what is being chosen, which is how a
   control with a self-evident option set avoids carrying a separate label. */
function dropdown(label, options, current, onPick) {
  const drop = el('div', { class: 'drop', 'data-scope': 'group' },
    options.map(o => el('div', {
      class: o.value === current ? 'on' : '',
      onclick: () => onPick(o.value),
    }, o.label, o.note ? el('span', { text: o.note }) : null)));
  drop.hidden = true;

  const dd = el('div', { class: 'dd' });
  const button = el('button', {
    title: label,
    onclick: () => {
      drop.hidden = !drop.hidden;
      dd.className = drop.hidden ? 'dd' : 'dd open';
    },
  }, el('span', { class: 'k', text: label }),
    (options.find(o => o.value === current) || options[0] || {}).label || '',
    icon('caret', 12));
  dd.append(button, drop);
  return dd;
}

function leafFiles(capture) {
  if (!capture) return el('p', { class: 'empty', text: 'No capture folder on disk for this state.' });
  return capture.leaves.map(leaf => el('div', { class: 'rfiles' },
    el('span', { text: `${leaf.orientation}/${leaf.locale}` }),
    leaf.files.filter(f => !f.endsWith('.png')).map(f => el('a', {
      href: leaf.url + f, target: '_blank', rel: 'noopener', text: f,
    }))));
}

/* A routes table, each route followed by its ordered steps.
   A route with one step is one line; a longer one gets its head line and then
   an indented line per action. */
function routeTable(title, edges, far) {
  const head = el('div', { class: 'psec-h' },
    el('span', { class: 'h2', text: title }),
    el('span', { class: 'cap', text: String(edges.length) }));

  if (!edges.length) {
    return el('div', { class: 'psec' }, head,
      el('div', { class: 'runs' }, el('p', { class: 'empty', text: 'None recorded.' })));
  }

  const rows = [];
  for (const e of edges) {
    const other = far(e);
    const screen = other.split('@')[0];
    rows.push(
      el('div', { class: 'rn', onclick: () => { location.href = href('screen.html', { id: screen }); } }, other),
      el('div', { class: 'verb', 'data-tip': e.action || null, text: e.action || '(no action)' }),
      // Blank rather than 0: nothing has timed this route, which is a different
      // fact from a route that takes no time.
      el('div', { class: 'ms', text: e.measured_ms ? String(e.measured_ms) : '—' }),
      el('div', { class: 'n', text: String(e.steps.length) }),
      el('div', { class: 'n' }, el('span', {
        class: 'stamp',
        style: `--c: var(--${e.status === 'candidate' ? 'warn' : 'pass'})`,
        text: e.status,
      })));
    if (e.steps.length > 1) {
      for (const s of e.steps) {
        const params = Object.entries(s.paramsObj || {})
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
        rows.push(
          el('div', { class: 'verb s', text: `${s.verb}${params ? `  ${params}` : ''}` }),
          el('div', { class: 's' }), el('div', { class: 's' }),
          el('div', { class: 's' }), el('div', { class: 's' }));
      }
    }
  }

  return el('div', { class: 'psec' }, head,
    el('div', { class: 'rtbl' },
      el('div', { class: 'th', text: title.endsWith('in') ? 'from' : 'to' }),
      el('div', { class: 'th', text: 'action' }),
      el('div', { class: 'th', text: 'ms' }),
      el('div', { class: 'th', text: 'steps' }),
      el('div', { class: 'th', text: 'status' }),
      rows));
}

/* The baseline's leaf of a screen outside the app (PROMO-56), else the newest run's screenshot of
   it, with the run it came from. */
function outsideCard(state, screen) {
  const own = firstCapture(state, screen);
  const shot = own ? null : ((state.manifest && state.manifest.external_captures) || {})[screen.id];
  return el('div', { class: 'xcard' },
    el('span', { class: 'bx-k', text: 'outside the app' }),
    el('span', { class: 'bx-p', text: screen.package }),
    el('p', { text: `A screen of another app, reached by leaving this one. The map records the routes into and out of it and keeps ${own ? 'one capture of it, the first a run took' : 'no capture of it'}.` }),
    own ? el('figure', { class: 'xshot' },
      el('a', { href: own.url, target: '_blank' },
        el('img', { src: own.url, alt: `${screen.package}, as the baseline holds it`, loading: 'lazy' })),
      el('figcaption', { text: `Stored in the baseline: ${provenance(own.leaf, own.appearance)}.` })) : null,
    shot ? el('figure', { class: 'xshot' },
      el('a', { href: state.source.url + shot.screen, target: '_blank' },
        el('img', { src: state.source.url + shot.screen, alt: `${screen.package}, as run ${shot.run} captured it`, loading: 'lazy' })),
      el('figcaption', {}, 'From run ', el('a', { href: href('runs.html', { id: shot.run }), text: shot.run }),
        `, step ${shot.step}. Not stored in the baseline.`)) : null);
}

export function renderScreen(state, screenId) {
  const model = state.model;
  const screen = model.byScreen.get(screenId);
  if (!screen) {
    return el('div', { class: 'page' },
      el('div', { class: 'h1', text: 'Unknown screen' }),
      el('p', { class: 'p', text: `No screen with the id "${screenId}" in this map.` }));
  }

  const platform = platformOf(state.profile);
  const wanted = model.byRendition.get(param('state'));
  let current = (wanted && wanted.screen === screen ? wanted : null)
    || screen.renditions.find(r => r.isCore) || screen.renditions[0] || null;
  let locale = '';

  const grid = el('div', { class: 'vgstage' });
  const vtools = el('div', { class: 'vtools' });
  const rend = el('div', { class: 'rend' });
  const files = el('div', {});

  function paint() {
    const capture = current ? state.captures.get(current.id) : null;
    const locales = localesOf(capture);
    if (!locales.includes(locale)) locale = locales[0] || '';
    const cells = variants(capture, state.profile, locale);

    setChildren(grid, current
      ? variantGrid({ screen, rendition: current, cells, profile: state.profile, platform,
        unplaced: unplaced(capture, state.profile, locale) })
      : el('p', { class: 'empty', text: 'This screen has no states.' }));

    setChildren(vtools,
      dropdown('show', screen.renditions.map(r => ({
        value: r.id,
        label: stateLabel(r),
        note: r.status,
      })), current && current.id, id => { pick(model.byRendition.get(id)); }),
      locales.length > 1
        ? dropdown('locale', locales.map(l => ({ value: l, label: l })), locale, l => { locale = l; paint(); })
        : null);

    setChildren(files, leafFiles(capture));

    for (const card of rend.children) {
      card.className = card.getAttribute('data-rid') === (current && current.id) ? 'rcard cur' : 'rcard';
    }
  }

  function pick(r) {
    current = r;
    history.replaceState(null, '', href('screen.html', { id: screen.id, state: r.id }));
    paint();
  }

  const outside = screen.isExternal;
  setChildren(rend, outside ? [] : screen.renditions.map(r => {
    const cells = variants(state.captures.get(r.id), state.profile);
    const thumb = cells.find(c => c.url && c.orientation === 'portrait' && c.appearance === 'dark')
      || cells.find(c => c.url);
    return el('div', {
      class: 'rcard',
      'data-rid': r.id,
      'data-press': true,
      'data-tip': r.note || r.axes || 'Core condition',
      tabindex: 0,
      role: 'button',
      onclick: () => pick(r),
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(r); }
      },
    },
      el('div', { class: 'rshot' }, thumb
        ? el('img', {
          src: thumb.url,
          alt: '',
          style: 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:top',
        })
        : el('div', { class: 'none', text: 'no capture' })),
      el('div', { class: 'rmeta', style: `--c: var(--${r.status === 'draft' ? 'warn' : 'pass'})` },
        el('b', { text: r.status }),
        el('span', { text: stateLabel(r) }),
        variantStrip(cells)),
      el('div', { class: 'rfiles' },
        el('span', { text: `${r.shapeLabels.length} affordances` }),
        r.truncated ? el('span', { text: 'truncated' }) : null,
        el('span', { text: r.observed })));
  }));

  if (!outside) paint();

  // Runs are listed by folder rather than opened: a run database carries its
  // screenshots as blobs, and this page must not fetch 33 MB to say one exists.
  const runs = state.manifest.runs || [];

  return el('div', { class: 'page' },
    el('div', { class: 'phead' },
      el('div', { class: 'phead-top' },
        el('button', { class: 'x', 'data-tip': 'Back to Map', onclick: () => { location.href = href('map.html'); } }, icon('back', 14)),
        el('h1', { text: screen.name || screen.id }),
        el('span', { class: 'stamp', style: '--c: var(--skip)', text: outside ? 'outside the app' : screen.kind })),
      el('p', { text: screen.summary || 'No summary recorded for this screen.' })),

    el('div', { class: 'pgrid' },
      el('div', { class: 'pcol' }, outside
        ? outsideCard(state, screen)
        : [el('div', { class: 'viewer' }, vtools, grid), files]),
      el('div', { class: 'pcol' },
        outside ? null : el('div', { class: 'psec' },
          el('div', { class: 'psec-h' },
            el('span', { class: 'h2', text: 'Conditions' }),
            el('span', { class: 'cap', text: String(screen.renditions.length) })),
          rend),
        routeTable('Routes in', screen.routesIn, e => e.src),
        routeTable('Routes out', screen.routesOut, e => e.dst),
        el('div', { class: 'psec' },
          el('div', { class: 'psec-h' },
            el('span', { class: 'h2', text: 'Runs' }),
            el('span', { class: 'cap', text: String(runs.length) })),
          el('div', { class: 'runs' }, runs.length
            ? runs.map(r => el('div', { class: 'visit' },
              el('div', { class: 'vt' },
                el('span', { class: 'stamp', style: '--c: var(--skip)', text: 'not read' }),
                el('span', { text: r.id })),
              el('p', { text: `${r.steps} screenshots. Open it from the runs page; nothing here reads a run database.` })))
            : el('p', { class: 'empty', text: 'No run has reached this screen. Nothing here has a verdict.' }))))));
}
