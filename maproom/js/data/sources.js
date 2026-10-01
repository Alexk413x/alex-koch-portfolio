/* The configured cartographer folders and what each one holds on disk.

   Both answers come from the server, not from derivation. `/sources.json`
   lists the mounts; `/k/<id>/index.json` walks the baseline tree and the run
   folders. A browser cannot list a directory, and the file names come from the
   writer's slug and stem rules -- reimplementing those here is what let the
   older viewer drift out of step with the tool that wrote the files. */

/* Fetch and parse JSON, naming the URL when it fails.
   A bare "Unexpected token <" tells a reader nothing about which mount 404'd. */
async function getJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/* Every configured source, each with `url`, `graph` and `has_graph`. */
export async function listSources() {
  const doc = await getJson('../sources.json');
  return doc.sources || [];
}

/* One source's on-disk manifest: baseline profiles and their capture files,
   plus the run folders with their sizes. */
export async function readManifest(source) {
  return getJson(`${source.url}index.json`);
}

function deviceField(profile, key) {
  const device = (profile && profile.device) || {};
  return device[key] || (device.profile || {})[key] || '';
}

export function platformOf(profile) {
  return deviceField(profile, 'platform');
}

export const ORIENTATIONS = ['portrait', 'landscape'];
export const APPEARANCES = ['light', 'dark'];

// `base` is the profile folder's URL: the server lists leaf paths relative to it.
export function captureIndex(profile, base) {
  const out = new Map();
  for (const r of profile.renditions || []) {
    out.set(r.id, {
      ...r,
      leaves: r.leaves.map(leaf => ({
        ...leaf,
        url: `${base}${leaf.path}/`,
        shots: Object.fromEntries(Object.entries(leaf.shots)
          .map(([appearance, file]) => [appearance, `${base}${leaf.path}/${file}`])),
      })),
    });
  }
  return out;
}

export function localesOf(capture) {
  return [...new Set((capture ? capture.leaves : []).map(l => l.locale))].sort();
}

/* A `default` orientation folder fills portrait only when no portrait one exists.
   `default.png` fills the appearance `device.json` declares, and nothing otherwise. */
export function variants(capture, profile, locale) {
  const leaves = (capture ? capture.leaves : []).filter(l => !locale || l.locale === locale);
  const declared = deviceField(profile, 'appearance');
  const leafFor = orientation => leaves.find(l => l.orientation === orientation)
    || (orientation === 'portrait' ? leaves.find(l => l.orientation === 'default') : null)
    || null;
  const cells = [];
  for (const orientation of ORIENTATIONS) {
    const leaf = leafFor(orientation);
    for (const appearance of APPEARANCES) {
      const url = leaf && (leaf.shots[appearance]
        || (declared === appearance ? leaf.shots.default : null));
      cells.push({ orientation, appearance, url: url || null, leaf: url ? leaf : null });
    }
  }
  return cells;
}

export function hasOrientation(capture, orientation) {
  return (capture ? capture.leaves : []).some(l => l.orientation === orientation
    || (orientation === 'portrait' && l.orientation === 'default'));
}

export function unplaced(capture, profile, locale) {
  if (deviceField(profile, 'appearance')) return [];
  return (capture ? capture.leaves : [])
    .filter(l => (!locale || l.locale === locale) && l.shots.default)
    .map(l => ({ orientation: l.orientation, url: l.shots.default, leaf: l }));
}

export function portraitAspect(profile) {
  const [w, h] = String(deviceField(profile, 'resolution')).split('x').map(Number);
  if (!w || !h) return 1080 / 2400;
  return Math.min(w, h) / Math.max(w, h);
}

const SOURCES = {
  map_axis_sweep: 'axis sweep',
  map_record_rendition: 'record_rendition',
  map_promote_run: 'promote',
};

export function provenance(leaf, stem) {
  const c = (leaf && ((leaf.shot_captures || {})[stem] || leaf.capture)) || {};
  return [
    c.run_id ? `run ${c.run_id}` : 'no run',
    SOURCES[c.source] || c.source || 'source not recorded',
    c.captured_at ? c.captured_at.replace('T', ' ').replace(/Z$/, ' UTC') : 'time not recorded',
  ].join(' · ');
}

export function fillHint(appearance, orientation) {
  return `No ${appearance} ${orientation} capture. Run an explore or map_axis_sweep with `
    + `appearance=${appearance}, orientation=${orientation}.`;
}

/* The capture a screen's map box shows: the core rendition's when it has this
   cell, else the first rendition that does. */
export function screenCapture(state, screen, orientation, appearance) {
  const ordered = [...screen.renditions].sort((a, b) => Number(b.isCore) - Number(a.isCore));
  let oriented = false;
  for (const r of ordered) {
    const cells = variants(state.captures.get(r.id), state.profile).filter(c => c.orientation === orientation);
    const cell = cells.find(c => c.appearance === appearance);
    if (cell.url) return { url: cell.url, rendition: r };
    oriented = oriented || cells.some(c => c.url);
  }
  return { url: null, missing: oriented ? `no ${appearance} capture` : `no ${orientation} capture` };
}
