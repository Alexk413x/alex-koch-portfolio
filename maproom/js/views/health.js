/* One labeled summary and evidence disclosure for every page. */
import { el, setChildren } from '../util/dom.js';
import { findingCount } from '../data/health.js';
import { MODES } from '../data/modes.js';

let instance = 0;

export function renderHealth(state, initial, { title = 'Baseline health', configure = true, compact = false } = {}) {
  const labels = { mapped: 'States', warnings: 'Warnings', failures: 'Failures' };
  const compactTips = { mapped: 'Passed', warnings: 'Warning', failures: 'Error' };
  const tips = {
    mapped: 'Recorded app states in this capture configuration. This is not a test pass count.',
    warnings: 'Recorded accessibility, performance and other review findings. Draft status is not a warning.',
    failures: 'Recorded failed or mismatched routes and failed tests. Self-loops and unrun tests are not failures.',
  };
  const link = (file, extra = {}) => `${file}?${new URLSearchParams({ src: state.source.id, ...extra })}`;
  const details = el('div', { class: 'health-details', id: `map-health-details-${++instance}`, hidden: true });
  const scopeText = el('p', { class: 'health-scope' });
  const buttons = new Map();
  let current = initial;
  let open = null;
  function paintDetails() {
    details.hidden = !open;
    for (const [key, button] of buttons) button.setAttribute('aria-expanded', String(key === open));
    if (!open) return;
    const { health } = current;
    const items = open === 'mapped'
      ? health.mapped.map(r => ({ text: r.name, state: r.id, count: 1 })) : health[open];
    const note = open === 'mapped'
      ? 'Recorded states, not passed tests. Warning and failure counts are findings and can overlap these states.'
      : open === 'warnings'
        ? 'Known findings only. Accessibility totals marked whole capture run are not per-state results. Raw timings alone are not warnings.'
        : 'Recorded route failures and failed tests only. Not reached, not run and missing test evidence do not establish an app failure.';
    setChildren(details,
      el('p', { class: 'health-note', text: note }),
      el('p', { class: 'health-note', text: `${health.tests} recorded test results; ${health.audits} completed accessibility audits from these captures. No results does not mean passed.` }),
      items.length ? el('ul', {}, items.map(item => {
        const r = state.model.byRendition.get(item.state);
        const dest = item.run ? link('runs.html', { id: item.run })
          : r ? link('screen.html', { id: r.screen_id, state: r.id }) : null;
        return el('li', {}, dest
          ? el('a', { href: dest, text: `${item.count > 1 ? `${item.count} · ` : ''}${item.text}` })
          : el('span', { text: item.text }));
      })) : el('p', { class: 'health-note', text: `No recorded ${labels[open].toLowerCase()} in this view.` }));
  }
  const tally = el('div', { class: 'tally', role: 'group', 'aria-label': 'Map evidence' },
    ...Object.entries(labels).map(([key, label], i) => {
      const button = el('button', {
        type: 'button', style: `--c: var(--${['pass', 'warn', 'fail'][i]})`,
        'data-health': key, 'data-label': label, 'data-tip': compact ? compactTips[key] : `${label}: ${tips[key]}`, 'aria-expanded': 'false', 'aria-controls': details.id,
        onclick: () => { open = open === key ? null : key; paintDetails(); },
      }, el('b', { text: '0' }), compact ? null : el('span', { text: label }));
      buttons.set(key, button);
      return button;
    }));
  const root = el('section', { class: `health-summary${compact ? ' health-compact' : ''}`, 'aria-label': title },
    compact ? null : el('div', { class: 'health-heading' }, el('h2', { text: title }),
      configure ? el('a', { href: link('map.html'), text: 'Change configuration on map' }) : null),
    compact ? null : scopeText, tally, details);
  root.update = next => {
    current = next;
    const { health, scope } = current;
    const modes = MODES.filter(m => scope.modes.includes(m.name)).map(m => m.label).join(', ') || 'No navigation modes';
    scopeText.textContent = [scope.profile || 'No device profile', scope.orientation,
      scope.appearance, scope.locale || 'No locale', modes].join(' · ');
    root.dataset.healthScope = scopeText.textContent;
    for (const [key, button] of buttons) {
      const count = key === 'mapped' ? health.mapped.length : findingCount(health[key]);
      button.querySelector('b').textContent = String(count);
      button.setAttribute('aria-label', `${count} ${labels[key].toLowerCase()}. Show evidence`);
    }
    paintDetails();
  };
  root.update(initial);
  return root;
}
