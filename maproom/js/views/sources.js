/* Compact survey rows share the map's health calculation, not its disclosure UI. */

import { el } from '../util/dom.js';
import { icon, platformIcon } from '../util/icons.js';
import { platformOf, captureIndex } from '../data/sources.js';
import { healthContext } from '../data/health-scope.js';
import { findingCount } from '../data/health.js';
import { MODES } from '../data/modes.js';

function meter(parts, label) {
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  return el('div', { class: 'meter', role: 'img', 'aria-label': label },
    parts.filter(part => part.count).map(part => el('i', {
      class: part.ink, style: `width:${100 * part.count / total}%`,
    })));
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

export function renderSources(state, manifests, models, errors) {
  const rows = state.sources.map(source => {
    const manifest = manifests.get(source.id);
    const mapUrl = `map.html?src=${encodeURIComponent(source.id)}`;
    const model = models.get(source.id);

    if (!source.has_graph || !manifest || !model) {
      // Listed rather than dropped: a configured folder with no map is usually
      // a survey nobody has run, and hiding it would look like a typo.
      return el('a', { class: 'app health-row', href: mapUrl, 'data-source': source.id },
        el('span', { class: 'app-n', text: source.name }),
        el('span', { class: 'app-f', text: errors.get(source.id)
          ? `Health unavailable: ${errors.get(source.id)}`
          : 'No baseline map. Health counts are unavailable.' }),
        el('span', { class: 'app-go' }, icon('chevron', 14)));
    }

    const profile = manifest.profiles?.[0] || null;
    const context = { source, manifest, model, profile,
      captures: profile ? captureIndex(profile, `${source.url}baselines/${profile.key}/`) : new Map() };
    const { health, scope, profile: selected } = healthContext(context);
    const mapped = health.mapped.length;
    const warnings = findingCount(health.warnings);
    const failures = findingCount(health.failures);
    const scopeLabel = [scope.profile, scope.orientation, scope.appearance, scope.locale,
      MODES.filter(m => scope.modes.includes(m.name)).map(m => m.label).join(', ')
        || 'No navigation modes'].filter(Boolean).join(' · ');
    const count = (key, value, label, ink) => el('span', {
      class: `health-count ${ink}`, 'data-health': key,
    }, el('b', { text: String(value) }), el('span', { text: label }));
    return el('a', {
      class: 'app health-row', href: mapUrl, 'data-source': source.id,
      'data-health-scope': scopeLabel,
      'aria-label': `Open ${source.name} map. ${mapped} mapped states, ${warnings} warnings, ${failures} failures.`,
    },
      el('span', { class: 'app-n', text: source.name }),
      el('span', { class: 'app-pf', 'data-tip': `${deviceTip(selected)} · ${scopeLabel}` },
        icon(platformIcon(platformOf(selected)), 16)),
      el('div', { class: 'fbar health-bar' }, meter([
        { ink: 'p', count: mapped },
        { ink: 'w', count: warnings }, { ink: 'f', count: failures },
      ], `${mapped} mapped states, ${warnings} warnings, ${failures} failures. Counts of states and findings, not a test pass rate.`)),
      el('div', { class: 'fcnt health-counts' },
        count('mapped', mapped, 'States', 'mapped'),
        count('warnings', warnings, 'Warnings', 'warnings'),
        count('failures', failures, 'Failures', 'failures')),
      el('span', { class: 'app-go' }, icon('chevron', 14)));
  });

  return el('div', { class: 'index' },
    el('div', { class: 'lede' },
      el('div', { class: 'h1', text: 'Surveys' }),
      el('button', { class: 'btn ghost', disabled: true,
        'data-tip': 'Add surveys with serve.py --add <path>. Adding from this page is unavailable.' },
        icon('plus', 14), 'add a survey')),
    el('p', { class: 'p', text: 'Every cartographer folder this server can read, mounted read-only. Pressing one opens its map.' }),
    rows.length ? el('div', { class: 'apps' }, rows)
      : el('p', { class: 'empty', text: 'No folders configured. Add one to sources.json, or pass --add <path> to serve.py.' }));
}
