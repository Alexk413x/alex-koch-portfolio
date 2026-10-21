import { el } from '../util/dom.js';
import { icon, phoneIcon } from '../util/icons.js';
import { APPEARANCES, ORIENTATIONS, fillHint, portraitAspect, provenance } from '../data/sources.js';
import { alignElementOverlayToImage, elementOverlay } from './elements.js';

const TONE_ICON = { light: 'sun', dark: 'moon' };

let captionIds = 0;

export function stateLabel(rendition) {
  return rendition.name || (rendition.isCore ? 'core' : rendition.axes);
}

function cellFor(cells, orientation, appearance) {
  return cells.find(c => c.orientation === orientation && c.appearance === appearance);
}

function frame(c, screen, rendition, ratio, inspection = {}, trees = new Map()) {
  const aspect = c.orientation === 'landscape' ? 1 / ratio : ratio;
  if (!c.url) {
    return el('figure', { class: `vcell none ${c.orientation}`, style: `aspect-ratio:${aspect}` },
      el('figcaption', { text: fillHint(c.appearance, c.orientation) }));
  }
  const hasTree = Boolean(c.leaf && c.leaf.files.includes('state.raw.xml'));
  const treeResult = c.leaf && trees.get(c.leaf.path);
  const overlay = treeResult && treeResult.tree
    ? elementOverlay(treeResult.tree, {
      filter: inspection.showBoxes === false ? null : 'all',
      interactive: false,
      className: 'element-overlay-inline',
    })
    : null;
  const id = `vcap${captionIds += 1}`;
  const img = el('img', {
    src: c.url,
    alt: `${screen.id}, ${stateLabel(rendition)}, ${c.appearance} appearance, ${c.orientation}`,
  });
  if (overlay) alignElementOverlayToImage(overlay, img);
  const figure = el('figure', { class: `vcell ${c.orientation}`, style: `aspect-ratio:${aspect}` },
    el('a', {
      href: c.url,
      target: '_blank',
      rel: 'noopener',
      'data-tip': provenance(c.leaf, c.appearance),
      'aria-describedby': id,
      onclick: event => {
        if (!hasTree || !inspection.onInspect) return;
        event.preventDefault();
        inspection.onInspect(c);
      },
    }, img),
    overlay,
    el('figcaption', { class: 'sr', id, text: provenance(c.leaf, c.appearance) }));
  img.addEventListener('load', () => {
    if (img.naturalWidth && img.naturalHeight) figure.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
  });
  return figure;
}

export function variantGrid({ screen, rendition, cells, profile, platform, unplaced = [],
  inspection = {}, trees = new Map() }) {
  const ratio = portraitAspect(profile);
  const grid = el('div', {
    class: 'vgrid',
    role: 'group',
    'aria-label': `${screen.id}, ${stateLabel(rendition)}: captures by appearance and orientation`,
  },
    el('span', {}),
    APPEARANCES.map(a => el('div', { class: 'vg-h' }, icon(TONE_ICON[a], 14), el('span', { class: 'cap', text: a }))),
    ORIENTATIONS.map(o => [
      el('div', { class: 'vg-r' }, icon(phoneIcon(platform), 14, '', o === 'landscape'), el('span', { class: 'cap', text: o })),
      APPEARANCES.map(a => frame(cellFor(cells, o, a), screen, rendition, ratio, inspection, trees)),
    ]));
  if (!unplaced.length) return grid;
  return el('div', { class: 'vgwrap' }, grid,
    el('p', { class: 'vg-note' }, 'Appearance not recorded: ',
      unplaced.map(u => el('a', { href: u.url, target: '_blank', rel: 'noopener', 'data-tip': provenance(u.leaf, 'default') },
        `default.png, ${u.orientation}`))));
}

export function variantStrip(cells) {
  const have = cells.filter(c => c.url);
  const name = c => `${c.appearance} ${c.orientation}`;
  const missing = cells.filter(c => !c.url);
  const said = [
    have.length ? `Captured: ${have.map(name).join(', ')}.` : 'Nothing captured.',
    missing.length ? `Missing: ${missing.map(name).join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  return el('span', {
    class: 'vstrip',
    role: 'img',
    'aria-label': `${have.length} of ${cells.length} captures. ${said}`,
    'data-tip': said,
  },
    el('span', { class: 'vdots' }, cells.map(c => el('i', { class: `${c.orientation}${c.url ? ' on' : ''}` }))),
    el('span', {
      class: 'vn',
      style: `--c: var(--${have.length === cells.length ? 'pass' : 'warn'})`,
      text: `${have.length}/${cells.length}`,
    }));
}
