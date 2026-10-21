/* Every baseline page reads the same capture configuration. Run maps keep their own. */
import { captureIndex, platformOf, variants } from './sources.js';
import { modeOf } from './modes.js';
import { mapHealth } from './health.js';

const storageKey = state => `maproom.health:${state.source.id}`;

export function openingTone(captures) {
  let light = 0, dark = 0;
  for (const capture of captures.values()) for (const leaf of capture.leaves) {
    if (leaf.shots.light) light++;
    if (leaf.shots.dark) dark++;
  }
  return light > dark ? 'light' : 'dark';
}

export function healthContext(state, { remember = true } = {}) {
  let saved = {};
  if (remember) {
    try {
      saved = JSON.parse(localStorage.getItem(storageKey(state)) || '{}') || {};
    } catch {
      // Storage can be unavailable or contain an obsolete value.
    }
  }
  const profile = (state.manifest.profiles || []).find(p => p.key === saved.profile)
    || state.profile || state.manifest.profiles?.[0] || null;
  const captures = profile && profile !== state.profile
    ? captureIndex(profile, `${state.source.url}baselines/${profile.key}/`) : state.captures;
  const locales = [...new Set([...captures.values()]
    .flatMap(c => c.leaves.map(l => l.locale)).filter(Boolean))].sort();
  const driven = [...new Set(state.model.edges.map(modeOf).filter(Boolean))];
  const scope = {
    profile: profile?.key || '',
    orientation: ['portrait', 'landscape'].includes(saved.orientation) ? saved.orientation : 'portrait',
    appearance: ['light', 'dark'].includes(saved.appearance) ? saved.appearance : openingTone(captures),
    locale: locales.includes(saved.locale) ? saved.locale : locales[0] || '',
    modes: Array.isArray(saved.modes) ? saved.modes.filter(m => driven.includes(m)) : driven,
  };
  const inScope = r => r && (r.screen?.isExternal || variants(captures.get(r.id), profile, scope.locale)
    .some(c => c.orientation === scope.orientation && c.appearance === scope.appearance && c.url));
  const modes = new Set(scope.modes);
  const edges = state.model.edges.filter(e => inScope(e.srcRendition) && inScope(e.dstRendition)
    && (!modeOf(e) || modes.has(modeOf(e))));
  const health = mapHealth({
    model: state.model, states: state.model.appRenditions.filter(inScope), edges, captures,
    runs: state.manifest.runs, ...scope, modes, profile, platform: platformOf(profile),
  });
  return { scope, health, profile, captures };
}

export function rememberHealthScope(state, scope) {
  try {
    localStorage.setItem(storageKey(state), JSON.stringify(scope));
  } catch {
    console.warn('Maproom cannot remember the health configuration between pages.');
  }
}
