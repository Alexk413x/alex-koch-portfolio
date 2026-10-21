/* A screen's captures lead; a state carousel selects which capture set to view.
   The remaining data stays in one column of disclosures. */

import { el, setChildren, svgEl } from '../util/dom.js';
import { icon } from '../util/icons.js';
import { segmentedGroup } from '../util/segmented.js';
import { picker } from '../util/picker.js';
import { href, param } from '../page.js';
import {
  APPEARANCES, ORIENTATIONS, variants, localesOf, unplaced, firstCapture, provenance,
} from '../data/sources.js';
import { formatDateTime, runDateTime } from '../util/date.js';
import { variantStrip, stateLabel } from './variants.js';
import { displayChildren, treeDiff } from '../data/substates.js';
import { matchStateElements, parseUiTree } from '../data/uistate.js';
import { routeOptionContent } from './route-options.js';
import {
  alignElementOverlayToImage,
  elementInspector,
  elementMatchesFilter,
  elementOverlay,
  restackElementOverlay,
  updateActiveOutline,
} from './elements.js';

/* Each route links to its far screen and keeps its summary and steps in one
   keyboard-accessible target. */
function routeTable(title, edges, far) {
  if (!edges.length) {
    return el('p', { class: 'empty', text: 'None recorded.' });
  }

  return el('div', { class: 'rtbl', role: 'list', 'aria-label': title },
    edges.map(e => {
      const other = far(e);
      const destination = e.dstRendition?.id || e.dst;
      const screen = destination.split('@')[0];
      const status = el('span', {
        class: 'stamp',
        style: '--c: var(--skip)',
        text: e.status,
      });
      return el('div', { class: 'route-item', role: 'listitem' },
        el('a', {
          class: 'route-row',
          href: href('screen.html', {
            id: screen,
            ...(destination.includes('@') ? { state: destination } : {}),
          }),
          'aria-label': `Open ${other}. ${e.action || 'No action recorded'}. ${e.steps.length} steps. ${e.status}.`,
        },
          ...routeOptionContent(e, other, status)));
    }));
}

function pageDisclosure(title, count, content, className = '') {
  return el('details', { class: `page-disclosure ${className}`.trim() },
    el('summary', { class: 'page-disclosure-h' },
      el('span', { class: 'h2', text: title }),
      count === null ? null : el('span', { class: 'cap', text: String(count) }),
      icon('chevron', 13)),
    el('div', { class: 'page-disclosure-b' }, content));
}

/* The baseline's leaf of a screen outside the app (PROMO-56), else the newest run's screenshot of
   it, with the run it came from. */
function outsideCard(state, screen, openCapture) {
  const own = firstCapture(state, screen);
  const shot = own ? null : ((state.manifest && state.manifest.external_captures) || {})[screen.id];
  return el('div', { class: 'xcard' },
    el('span', { class: 'bx-k', text: 'outside the app' }),
    el('span', { class: 'bx-p', text: screen.package }),
    el('p', { text: `A screen of another app, reached by leaving this one. The map records the routes into and out of it and keeps ${own ? 'one capture of it, the first a run took' : 'no capture of it'}.` }),
    own ? el('figure', { class: 'xshot' },
      el('button', {
        class: 'capture-link',
        type: 'button',
        'aria-label': `Open ${screen.package} baseline screenshot`,
        onclick: () => openCapture(own.url, `${screen.package}, as the baseline holds it`,
          'Stored in the baseline', own.leaf, own.appearance),
      }, el('img', { src: own.url, alt: '', loading: 'lazy' })),
      el('figcaption', { text: `Stored in the baseline: ${provenance(own.leaf, own.appearance)}.` })) : null,
    shot ? el('figure', { class: 'xshot' },
      el('button', {
        class: 'capture-link',
        type: 'button',
        'aria-label': `Open ${screen.package} screenshot from run ${shot.run}`,
        onclick: () => openCapture(state.source.url + shot.screen,
          `${screen.package}, as run ${shot.run} captured it`, `Run ${shot.run} · step ${shot.step}`),
      }, el('img', { src: state.source.url + shot.screen, alt: '', loading: 'lazy' })),
      el('figcaption', {}, 'From run ', el('a', { href: href('runs.html', { id: shot.run }), text: shot.run }),
        `, step ${shot.step}. Not stored in the baseline.`)) : null);
}

const CHILD_DIFF_MAX = 40;
const CHILD_DIFF = {
  added: { sign: '+', ink: 'accent-text', label: 'added' },
  changed: { sign: '~', ink: 'warn', label: 'changed' },
  removed: { sign: '−', ink: 'skip', label: 'removed' },
};

const FILTER_ICON_PATHS = {
  all: [
    ['path', { d: 'M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h4v4h-4z' }],
  ],
  interactive: [
    ['path', { d: 'M6.2 14.8 3.5 12a1.2 1.2 0 0 1 1.7-1.7l1.1 1.1V4.3a1.2 1.2 0 0 1 2.4 0v4.1-2.1a1.1 1.1 0 0 1 2.2 0v2.1-1.1a1.1 1.1 0 0 1 2.2 0v1.4-.3a1.1 1.1 0 0 1 2.2 0v2.1a4.3 4.3 0 0 1-4.3 4.3H8a2.5 2.5 0 0 1-1.8-.8z' }],
  ],
  state: [
    ['circle', { cx: 8, cy: 8, r: 4.5 }],
    ['path', { d: 'M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2' }],
    ['path', { d: 'M8 6.5v3M6.5 8h3' }],
  ],
};

function filterIcon(kind) {
  return svgEl('svg', {
    class: 'element-filter-icon',
    viewBox: '0 0 16 16',
    width: 16,
    height: 16,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.4,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, FILTER_ICON_PATHS[kind].map(([tag, attrs]) => svgEl(tag, attrs)));
}

function childTree(state, rendition) {
  if (!rendition) return null;
  const capture = state.captures.get(rendition.id);
  const leaf = capture && (capture.leaves.find(l => l.orientation === 'portrait') || capture.leaves[0]);
  if (!leaf) return null;
  return leaf.fromRun ? (leaf.uistate || leaf.tree || null) : `${leaf.url}state.uistate.txt`;
}

function childShots(state, kid, openCapture) {
  const figure = (rendition, caption) => {
    const capture = rendition && state.captures.get(rendition.id);
    const cell = capture && variants(capture, state.profile).find(c => c.url);
    return el('figure', { class: 'kc-f' },
        cell ? el('button', {
          class: 'capture-link',
          type: 'button',
          'aria-label': `Open ${caption} screenshot`,
          onclick: () => openCapture(cell.url, `${caption} capture`, caption, cell.leaf, cell.appearance),
        }, el('img', { src: cell.url, alt: '', loading: 'lazy' }))
          : el('div', { class: 'kc-none', text: 'No capture stored.' }),
        el('figcaption', { text: caption }));
  };
  return el('div', { class: 'kc-shots' },
    figure(kid.base, kid.base ? `Parent · ${stateLabel(kid.base)}` : 'No parent state'),
    figure(kid.state, kid.name));
}

function childComparison(state, kid, body, openCapture) {
  const list = el('div', { class: 'kd', text: 'Reading the stored trees…' });
  setChildren(body,
    childShots(state, kid, openCapture),
    el('a', {
        class: 'child-open',
        href: href('screen.html', {
          id: kid.state.screen ? kid.state.screen.id : kid.state.screen_id,
          state: kid.state.id,
        }),
        text: 'Open child details',
    }),
    list);

  const before = childTree(state, kid.base);
  const after = childTree(state, kid.state);
  if (!before || !after) {
    setChildren(list, el('p', {
        class: 'kd-note',
        text: `No stored tree for ${before ? 'the child state' : 'the parent state'}.`,
    }));
    return;
  }

  Promise.all([before, after].map(url => {
    if (!treeCache.has(url)) {
        treeCache.set(url, fetch(url, { cache: 'no-cache' }).then(res => {
          if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
          return res.text();
        }));
    }
    return treeCache.get(url);
  })).then(([base, child]) => {
    const diff = treeDiff(base, child);
    if (!diff.rows.length) {
        setChildren(list, el('p', { class: 'kd-note', text: 'The stored trees are the same.' }));
        return;
    }
    const counts = Object.keys(CHILD_DIFF).filter(op => diff[op]).map(op =>
        el('b', { style: `--c: var(--${CHILD_DIFF[op].ink})`, text: `${CHILD_DIFF[op].sign}${diff[op]}` }));
    const rows = diff.rows.slice(0, CHILD_DIFF_MAX).map(row => el('div', {
        class: 'kd-r', style: `--c: var(--${CHILD_DIFF[row.op].ink})`,
    },
    el('b', { 'data-tip': CHILD_DIFF[row.op].label, text: CHILD_DIFF[row.op].sign }),
    el('span', {}, row.from ? el('s', { text: row.from }) : null, el('span', { text: row.text }))));
    const rest = diff.rows.length - rows.length;
    setChildren(list,
        el('p', { class: 'kd-note' }, 'Compared with its parent: ', counts),
        el('details', { class: 'kd-more' },
          el('summary', { text: `Show ${Math.min(diff.rows.length, CHILD_DIFF_MAX)} tree changes` }),
          el('div', { class: 'kd' },
            rows,
            rest ? el('p', { class: 'kd-note', text: `${rest} more` }) : null,
            el('p', { class: 'kd-note' },
              el('a', { href: before, target: '_blank', rel: 'noopener', text: 'Parent tree' }),
              ' · ',
              el('a', { href: after, target: '_blank', rel: 'noopener', text: 'Child tree' })))));
  }, err => setChildren(list, el('p', { class: 'kd-note', text: err.message })));
}

const treeCache = new Map();

function childrenSection(state, screen, openCapture) {
  const children = displayChildren(state.model).get(screen.id) || [];
  if (!children.length) return null;
  const rows = children.map(kid => {
    const details = el('details', { class: 'kc' });
    const body = el('div', { class: 'kc-b' });
    let loaded = false;
    details.addEventListener('toggle', () => {
        if (!details.open) return;
        for (const sibling of details.parentElement.querySelectorAll(':scope > .kc[open]')) {
          if (sibling !== details) sibling.open = false;
        }
        if (!loaded) {
          loaded = true;
          childComparison(state, kid, body, openCapture);
        }
    });
    details.append(
        el('summary', { class: 'kc-h' },
          el('span', { class: 'mono', text: kid.name }),
          el('span', {
            class: 'stamp', style: '--c: var(--skip)', text: kid.role || kid.kind,
          }),
          icon('chevron', 13)),
        body);
    return details;
  });
  return pageDisclosure('State Differences', children.length,
    el('div', { class: 'child-list' },
      rows), 'children-section');
}

export function renderScreen(state, screenId) {
  const model = state.model;
  const screen = model.byScreen.get(screenId);
  if (!screen) {
    return el('div', { class: 'page' },
      el('div', { class: 'h1', text: screenId ? 'Unknown screen' : 'No screen chosen' }),
      el('p', { class: 'p', text: screenId
        ? `No screen with the id "${screenId}" in this map.` : 'Open a screen from the map.' }),
      el('a', { href: href('map.html'), text: 'Back to map' }));
  }

  const wanted = model.byRendition.get(param('state'));
  let current = (wanted && wanted.screen === screen ? wanted : null)
    || screen.renditions.find(r => r.isCore) || screen.renditions[0] || null;
  let locale = '';

  const grid = el('div', { class: 'capture-gallery' });
  const unplacedFiles = el('div', { class: 'capture-unplaced-list' });
  const vtools = el('div', { class: 'vtools' });
  const currentName = el('span', { class: 'capture-state-name' });
  const elementFilterStorageKey = 'cartographer-screen-element-filter';
  const filterOptions = [
    { value: 'all', name: 'All elements' },
    { value: 'interactive', name: 'Interactive elements' },
    { value: 'state', name: 'State elements' },
  ];
  const storedElementFilter = localStorage.getItem(elementFilterStorageKey);
  let elementFilter = filterOptions.some(option => option.value === storedElementFilter)
    ? storedElementFilter
    : null;
  let inspectionFilter = 'all';
  const screenFilterButtonGroups = [];
  const inspectionFilterButtonGroups = [];
  const makeElementFilterGroup = (getFilter, onChange, groups) => {
    const group = segmentedGroup(filterOptions.map(option => ({
      value: option.value,
      title: option.name,
      content: filterIcon(option.value),
      attributes: {
        'data-filter': option.value,
      },
    })), {
      isSelected: value => getFilter() === value,
      onChange,
      allowNone: true,
      label: 'Element outline filters',
      className: 'element-filter-group',
      buttonClassName: 'element-filter-button',
    });
    group.setAttribute('data-tip', 'Filter the element outlines');
    groups.push(group);
    return group;
  };
  const elementFilterGroup = makeElementFilterGroup(
    () => elementFilter,
    setElementFilter,
    screenFilterButtonGroups,
  );
  const elementPopupFilterGroup = makeElementFilterGroup(
    () => inspectionFilter,
    setInspectionFilter,
    inspectionFilterButtonGroups,
  );
  const elementTreeCache = new Map();
  const elementTreeRequests = new Map();
  let inspection = null;
  let inspectionRequest = 0;
  const previewImage = el('img', { class: 'capture-preview-image', alt: '' });
  const previewCaption = el('span', { class: 'capture-preview-caption' });
  const previewMeta = el('div', { class: 'capture-preview-meta', hidden: true });
  const previewElements = el('div', {
    class: 'capture-preview-elements',
    hidden: true,
  });
  let activePreviewCell = null;
  const captureInfoRequests = new Map();
  const previewBody = el('div', {
    class: 'capture-preview-body',
  }, previewImage, previewElements);
  const preview = el('dialog', { class: 'capture-preview', 'aria-label': 'Capture preview' },
    el('div', { class: 'capture-preview-head' },
      el('div', { class: 'capture-preview-title' }, previewCaption, previewMeta),
      el('button', {
        class: 'capture-preview-close',
        type: 'button',
        'aria-label': 'Close preview',
        onclick: () => preview.close(),
      }, icon('close', 18))),
    previewBody);
  preview.addEventListener('click', event => {
    if (event.target === preview) preview.close();
  });
  preview.addEventListener('close', () => {
    if (preview.open) return;
    const inspectedPath = inspection?.cell.leaf?.path;
    if (inspectedPath) {
      const overlays = [...grid.querySelectorAll('.element-overlay-inline')]
        .filter(overlay => overlay.getAttribute('data-capture-path') === inspectedPath);
      overlays.forEach(overlay => {
        overlay.querySelectorAll('[data-element-id]').forEach(node => {
          node.classList.remove('active', 'selected');
          if (node.hasAttribute('aria-pressed')) node.setAttribute('aria-pressed', 'false');
          if (node.hasAttribute('stroke-opacity')) {
            node.setAttribute('stroke-opacity', node.dataset.visible === 'true' ? '0.5' : '0');
          }
        });
        restackElementOverlay(overlay, null, null);
        updateActiveOutline(overlay, null);
      });
    }
    inspectionRequest += 1;
    inspection = null;
    activePreviewCell = null;
  });
  const stateTrack = el('div', {
    class: 'state-track',
    tabindex: 0,
    role: 'group',
    'aria-label': 'Screen States',
  });
  const previousStates = el('button', {
    class: 'state-scroll previous',
    type: 'button',
    'aria-label': 'Scroll to previous states',
    hidden: true,
    onclick: () => scrollToAdjacentState(-1),
  }, icon('chevron', 15));
  const nextStates = el('button', {
    class: 'state-scroll next',
    type: 'button',
    'aria-label': 'Scroll to more states',
    hidden: true,
    onclick: () => scrollToAdjacentState(1),
  }, icon('chevron', 15));
  function updateStateScrollers() {
    const maxScroll = stateTrack.scrollWidth - stateTrack.clientWidth;
    previousStates.hidden = maxScroll <= 1 || stateTrack.scrollLeft <= 1;
    nextStates.hidden = maxScroll <= 1 || stateTrack.scrollLeft >= maxScroll - 1;
  }
  function scrollToAdjacentState(direction) {
    const track = stateTrack.getBoundingClientRect();
    const style = getComputedStyle(stateTrack);
    const left = track.left + stateTrack.clientLeft + parseFloat(style.paddingLeft);
    const right = track.left + stateTrack.clientLeft + stateTrack.clientWidth - parseFloat(style.paddingRight);
    const cards = [...stateTrack.querySelectorAll('.state-card')];
    const candidate = direction > 0
      ? cards.find(card => card.getBoundingClientRect().right > right + 1)
      : [...cards].reverse().find(card => card.getBoundingClientRect().left < left - 1);
    if (!candidate) return;
    const bounds = candidate.getBoundingClientRect();
    const distance = (bounds.left + bounds.right - left - right) / 2;
    stateTrack.scrollTo({
      left: Math.max(0, stateTrack.scrollLeft + distance),
      behavior: 'smooth',
    });
  }
  stateTrack.addEventListener('scroll', updateStateScrollers, { passive: true });
  window.addEventListener('resize', updateStateScrollers);
  const stateCarousel = el('section', { class: 'psec state-carousel' },
    el('div', { class: 'psec-h' },
      el('span', { class: 'h2', text: 'Screen States' }),
      el('span', { class: 'cap', text: String(screen.renditions.length) })),
    el('div', { class: 'state-carousel-row' }, previousStates, stateTrack, nextStates));

  function loadTree(cell, retry = false) {
    const key = cell.leaf.path;
    if (retry) elementTreeCache.delete(key);
    if (elementTreeCache.has(key)) return Promise.resolve(elementTreeCache.get(key));
    if (retry) elementTreeRequests.delete(key);
    if (elementTreeRequests.has(key)) return elementTreeRequests.get(key);
    const xmlUrl = cell.leaf.fromRun ? cell.leaf.tree : `${cell.leaf.url}state.raw.xml`;
    const stateUrl = cell.leaf.fromRun
      ? cell.leaf.uistate
      : cell.leaf.files.includes('state.uistate.txt')
        ? `${cell.leaf.url}state.uistate.txt`
        : null;
    const normalizedRequest = stateUrl
      ? fetch(stateUrl, { cache: 'no-cache' })
        .then(async response => {
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          return { text: await response.text() };
        })
        .catch(error => ({ error: `Could not read ${stateUrl}: ${error.message || error}` }))
      : Promise.resolve({ error: 'No normalized UI state is stored for this capture.' });
    const request = Promise.all([
      fetch(xmlUrl, { cache: 'no-cache' }),
      normalizedRequest,
    ])
      .then(async ([response, normalized]) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const tree = parseUiTree(await response.text());
        if (!tree.elements.length) throw new Error('The raw UI tree contains no elements.');
        if (normalized.text !== undefined) {
          if (!matchStateElements(tree, normalized.text)) {
            tree.stateMatchError = tree.stateMatchError
              || 'The normalized UI state does not match the raw tree hierarchy.';
          }
        } else {
          tree.stateMatchAvailable = false;
          tree.stateMatchError = normalized.error;
        }
        return { tree };
      })
      .catch(error => ({ error: `Could not read ${xmlUrl}: ${error.message || error}` }))
      .then(result => {
        elementTreeCache.set(key, result);
        elementTreeRequests.delete(key);
        return result;
      });
    elementTreeRequests.set(key, request);
    return request;
  }

  function loadCaptureInfo(cell) {
    const leaf = cell && cell.leaf;
    if (!leaf || !leaf.files.includes('capture.json')) return Promise.resolve(null);
    const key = `${leaf.path}\u0000${cell.appearance}`;
    if (captureInfoRequests.has(key)) return captureInfoRequests.get(key);
    const url = `${leaf.url}capture.json`;
    const request = fetch(url, { cache: 'no-cache' })
      .then(async response => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const record = await response.json();
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          throw new Error('The capture metadata must contain a JSON object.');
        }
        const { shots, ...treeCapture } = record;
        const shot = shots && shots[cell.appearance];
        return {
          tree: treeCapture,
          shot: shot && typeof shot === 'object' && !Array.isArray(shot) ? shot : {},
        };
      })
      .catch(error => {
        captureInfoRequests.delete(key);
        throw new Error(`Could not load ${url}: ${error.message || error}`);
      });
    captureInfoRequests.set(key, request);
    return request;
  }

  function loadVisibleTrees(cells) {
    const available = new Map(cells
      .filter(cell => cell.url && cell.leaf && cell.leaf.files.includes('state.raw.xml'))
      .map(cell => [cell.leaf.path, cell]));
    const missing = [...available.values()].filter(cell => !elementTreeCache.has(cell.leaf.path));
    if (missing.length) Promise.all(missing.map(loadTree)).then(() => paint());
  }

  function drawInspection() {
    if (!inspection) {
      setChildren(previewElements);
      return;
    }
    setChildren(previewElements, elementInspector({
      cell: inspection.cell,
      tree: inspection.tree,
      routes: state.model?.edges.filter(edge => edge.src === current?.id) || [],
      routeHref: edge => edge.dstRendition?.screen
        ? href('screen.html', {
          id: edge.dstRendition.screen.id,
          state: edge.dstRendition.id,
        })
        : null,
      loading: inspection.loading,
      error: inspection.error,
      filter: inspectionFilter,
      selected: inspection.selected,
      getSelected: () => inspection?.selected || null,
      filterGroup: elementPopupFilterGroup,
      captureInfo: inspection.captureInfo,
      device: state.profile?.device || {},
      captureInfoLoaded: inspection.captureInfoLoaded,
      captureInfoLoading: inspection.captureInfoLoading,
      captureInfoError: inspection.captureInfoError,
      captureInfoOpen: inspection.captureInfoOpen,
      paneSelection: inspection.paneSelection,
      onPaneSelectionChange: pane => {
        inspection.paneSelection = pane;
      },
      onToggleCaptureInfo: toggleCaptureInfo,
      onRetry: () => inspectCell(inspection.cell, true),
      onSelect: (id, persist = true) => {
        if (!inspection) return;
        if (persist) {
          inspection.selected = id;
          inspection.hovered = null;
        }
        else inspection.hovered = id;
        const active = inspection.hovered ?? inspection.selected;
        const update = root => root.querySelectorAll('[data-element-id]').forEach(node => {
          const elementId = node.getAttribute('data-element-id');
          const isActive = elementId === active;
          const isSelected = elementId === inspection.selected;
          node.classList.toggle('active', isActive);
          node.classList.toggle('selected', isSelected);
          if (node.classList.contains('element-item')) {
            const row = node.closest('.element-list-row');
            row?.classList.toggle('active', isActive);
            row?.classList.toggle('selected', isSelected);
            const entry = row?.closest('.element-list-entry');
            entry?.classList.toggle('active', isActive);
            entry?.classList.toggle('selected', isSelected);
          }
          if (node.hasAttribute('aria-pressed')) node.setAttribute('aria-pressed', String(isSelected));
          if (node.hasAttribute('stroke-opacity')) {
            node.setAttribute(
              'stroke-opacity',
              node.dataset.visible === 'true' ? '0.5' : '0',
            );
          }
        });
        update(previewElements);
        const previewOverlay = previewElements.querySelector('.element-overlay');
        restackElementOverlay(previewOverlay, inspection.selected, inspection.hovered);
        updateActiveOutline(previewOverlay, active);
        const key = inspection.cell.leaf.path;
        grid.querySelectorAll('.element-overlay-inline').forEach(overlay => {
          if (overlay.getAttribute('data-capture-path') === key) {
            update(overlay);
            restackElementOverlay(overlay, inspection.selected, inspection.hovered);
            updateActiveOutline(overlay, active);
          }
        });
      },
    }));
    previewElements.hidden = false;
  }

  function toggleCaptureInfo(open) {
    if (!inspection) return;
    const current = inspection;
    current.captureInfoOpen = open;
    if (open && !current.captureInfoLoaded && !current.captureInfoLoading) {
      current.captureInfoLoading = true;
      current.captureInfoError = '';
      updateCaptureInfoPanel(current);
      loadCaptureInfo(current.cell).then(record => {
        if (inspection !== current) return;
        current.captureInfo = record;
        current.captureInfoLoaded = true;
        current.captureInfoLoading = false;
        current.captureInfoError = '';
        updateCaptureInfoPanel(current);
      }).catch(error => {
        if (inspection !== current) return;
        current.captureInfoError = error.message || String(error);
        current.captureInfoLoading = false;
        updateCaptureInfoPanel(current);
      });
    }
  }

  function updateCaptureInfoPanel(current) {
    const stage = previewElements.querySelector('.element-inspector-stage');
    stage?.dispatchEvent(new CustomEvent('capture-info-update', {
      detail: {
        record: current.captureInfo,
        loaded: current.captureInfoLoaded,
        isLoading: current.captureInfoLoading,
        loadError: current.captureInfoError,
      },
    }));
  }

  function setElementFilter(filter) {
    const previousFilter = elementFilter;
    elementFilter = filter;
    if (filter === null) localStorage.removeItem(elementFilterStorageKey);
    else localStorage.setItem(elementFilterStorageKey, filter);
    for (const group of screenFilterButtonGroups) {
      for (const button of group.querySelectorAll('.element-filter-button')) {
        const selected = elementFilter === button.dataset.filter;
        button.classList.toggle('on', selected);
        button.setAttribute('aria-pressed', String(selected));
      }
    }
    for (const box of grid.querySelectorAll('.element-box')) {
      const visible = elementMatchesFilter(box, elementFilter);
      box.dataset.visible = String(visible);
      box.setAttribute('stroke-opacity', visible ? '0.5' : '0');
    }
    const active = inspection?.hovered || inspection?.selected;
    const key = inspection?.cell.leaf?.path;
    grid.querySelectorAll('.element-overlay-inline').forEach(overlay => {
      if (overlay.getAttribute('data-capture-path') === key) {
        restackElementOverlay(overlay, inspection?.selected, inspection?.hovered);
        updateActiveOutline(overlay, active);
      }
    });
  }

  function setInspectionFilter(filter) {
    const previousFilter = inspectionFilter;
    inspectionFilter = filter;
    for (const group of inspectionFilterButtonGroups) {
      for (const button of group.querySelectorAll('.element-filter-button')) {
        const selected = inspectionFilter === button.dataset.filter;
        button.classList.toggle('on', selected);
        button.setAttribute('aria-pressed', String(selected));
      }
    }
    for (const box of previewElements.querySelectorAll('.element-box')) {
      const visible = elementMatchesFilter(box, inspectionFilter);
      box.dataset.visible = String(visible);
      box.setAttribute('stroke-opacity', visible ? '0.5' : '0');
    }
    const listItems = [...previewElements.querySelectorAll('.element-item')];
    const visibleById = new Map(listItems.map(item => [
      item.dataset.elementId,
      elementMatchesFilter(item, inspectionFilter),
    ]));
    listItems.forEach(item => {
      item.closest('.element-list-row').dataset.visible = String(visibleById.get(item.dataset.elementId));
    });
    previewElements.querySelectorAll('.element-tree-rails path').forEach(path => {
      path.setAttribute(
        'stroke-opacity',
        visibleById.get(path.dataset.railId) ? '1' : '0.3',
      );
    });
    const active = inspection?.hovered || inspection?.selected;
    previewElements.querySelector('.element-inspector-stage')?.dispatchEvent(
      new CustomEvent('element-filter-change', {
        detail: { filter: inspectionFilter, previousFilter },
      }),
    );
    restackElementOverlay(
      previewElements.querySelector('.element-overlay'),
      inspection?.selected,
      inspection?.hovered,
    );
    updateActiveOutline(
      previewElements.querySelector('.element-overlay'),
      active,
    );
  }

  async function inspectCell(cell, retry = false) {
    const request = ++inspectionRequest;
    inspection = {
      cell,
      loading: true,
      selected: null,
      hovered: null,
      captureInfoLoaded: false,
      captureInfoLoading: false,
      captureInfoOpen: false,
      paneSelection: 'elements',
    };
    drawInspection();
    const result = await loadTree(cell, retry);
    if (request !== inspectionRequest) return;
    if (result.error) {
      inspection.error = result.error;
      inspection.loading = false;
      drawInspection();
      return;
    }
    inspection.tree = result.tree;
    inspection.loading = false;
    drawInspection();
  }

  function captureTimes(leaf, appearance) {
    const capture = leaf && ((leaf.shot_captures || {})[appearance] || leaf.capture);
    if (!capture || (!capture.run_id && !capture.promoted_at && capture.source !== 'map_promote_run')) {
      return null;
    }
    return {
      run: runDateTime(capture.run_id),
      promoted: capture.promoted_at || '',
    };
  }

  function timeItem(label, value) {
    const formatted = formatDateTime(value);
    return el('span', { class: 'capture-preview-meta-item' },
      el('span', { class: 'capture-preview-meta-label', text: label }),
      formatted
        ? el('time', { datetime: value, text: formatted })
        : el('span', { text: 'Not recorded' }));
  }

  function openCapture(url, alt, caption, leaf = null, appearance = '', cell = null) {
    setInspectionFilter('all');
    previewImage.src = url;
    previewImage.alt = alt;
    previewCaption.textContent = caption;
    activePreviewCell = cell && cell.leaf && cell.leaf.files.includes('state.raw.xml') ? cell : null;
    const times = captureTimes(leaf, appearance);
    previewMeta.hidden = !times;
    setChildren(previewMeta, times
      ? [timeItem('Run started', times.run), timeItem('Promoted', times.promoted)]
      : []);
    previewImage.hidden = Boolean(activePreviewCell);
    previewElements.hidden = !activePreviewCell;
    if (activePreviewCell) inspectCell(activePreviewCell);
    else setChildren(previewElements);
    if (!preview.open) preview.showModal();
  }

  function captureGrid(cells) {
    return el('div', { class: 'capture-orientations' },
      ORIENTATIONS.map(orientation =>
        el('section', { class: `capture-orientation ${orientation}`, 'aria-label': `${orientation} screenshots` },
          el('div', { class: 'capture-pair' },
            APPEARANCES.map(appearance => {
              const cell = cells.find(c => c.orientation === orientation && c.appearance === appearance);
              if (!cell || !cell.url) {
                return el('div', { class: 'capture-empty', 'aria-label': `No ${appearance} ${orientation} screenshot` },
                  el('span', { text: `${appearance} · not captured` }));
              }
              const hasTree = Boolean(cell.leaf && cell.leaf.files.includes('state.raw.xml'));
              const button = el('button', {
                class: 'capture-thumb',
                type: 'button',
                'aria-label': hasTree
                  ? `Inspect elements in ${appearance} ${orientation} screenshot`
                  : `Open ${appearance} ${orientation} screenshot`,
                onclick: () => openCapture(
                  cell.url,
                  `${screen.name || screen.id}, ${stateLabel(current)}, ${appearance} appearance, ${orientation}`,
                  `${stateLabel(current)} · ${orientation} · ${appearance}`,
                  cell.leaf,
                  appearance,
                  cell,
                ),
              });
              const image = el('img', {
                src: cell.url,
                alt: `${screen.name || screen.id}, ${stateLabel(current)}, ${appearance} appearance, ${orientation}`,
                loading: 'lazy',
              });
              const art = el('span', { class: 'capture-art' },
                image);
              const cached = cell.leaf && elementTreeCache.get(cell.leaf.path);
              const key = cell.leaf && cell.leaf.path;
              const overlay = cached && cached.tree
                ? elementOverlay(cached.tree, {
                  routes: state.model?.edges.filter(edge => edge.src === current?.id) || [],
                  filter: elementFilter,
                  interactive: false,
                  className: 'element-overlay-inline',
                })
                : null;
              if (overlay) alignElementOverlayToImage(overlay, image);
              if (overlay) overlay.setAttribute('data-capture-path', key);
              if (overlay) art.append(overlay);
              const fitImage = () => {
                if (!image.naturalWidth || !image.naturalHeight) return;
                const bounds = button.getBoundingClientRect();
                const scale = Math.min(
                  (bounds.width - 2) / image.naturalWidth,
                  (bounds.height - 2) / image.naturalHeight,
                );
                art.style.width = `${image.naturalWidth * scale}px`;
                art.style.height = `${image.naturalHeight * scale}px`;
              };
              image.addEventListener('load', fitImage);
              new ResizeObserver(fitImage).observe(button);
              button.append(art);
              return el('div', { class: 'capture-cell' }, button);
            })))));
  }

  function paint() {
    const capture = current ? state.captures.get(current.id) : null;
    const locales = localesOf(capture);
    if (!locales.includes(locale)) locale = locales[0] || '';
    const cells = variants(capture, state.profile, locale);
    loadVisibleTrees(cells);

    currentName.textContent = current ? stateLabel(current) : 'No state selected';
    setChildren(grid, current
      ? captureGrid(cells)
      : el('p', { class: 'empty', text: 'This screen has no states.' }));
    setChildren(unplacedFiles,
      unplaced(capture, state.profile, locale).map(u =>
        el('button', {
          class: 'capture-unplaced',
          type: 'button',
          onclick: () => openCapture(u.url,
            `${screen.name || screen.id}, ${stateLabel(current)}, default screenshot, ${u.orientation}`,
            `${stateLabel(current)} · ${u.orientation} · default`, u.leaf, 'default'),
        }, `default.png · ${u.orientation}`)));

    setChildren(vtools,
      elementFilterGroup,
      locales.length > 1
        ? picker('locale', locales.map(l => ({ value: l, label: l })), locale, l => {
          locale = l;
          inspectionRequest += 1;
          inspection = null;
          drawInspection();
          paint();
          vtools.querySelector('.dd > button')?.focus();
        })
        : null);

    for (const card of stateTrack.children) {
      const selected = card.getAttribute('data-rid') === (current && current.id);
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-pressed', String(selected));
    }
  }

  function pick(r) {
    current = r;
    inspectionRequest += 1;
    inspection = null;
    history.replaceState(null, '', href('screen.html', { id: screen.id, state: r.id }));
    drawInspection();
    paint();
  }

  function stateCardTitle(rendition) {
    const label = stateLabel(rendition);
    const prefix = `${screen.id} · `;
    if (label === 'base' || label === 'core' || label === `${prefix}base`) return screen.id;
    return label.startsWith(prefix) ? label.slice(prefix.length) : label;
  }

  const outside = screen.isExternal;
  setChildren(stateTrack, outside ? [] : screen.renditions.map(r => {
    const cells = variants(state.captures.get(r.id), state.profile);
    const portraitThumb = cells.find(c => c.url && c.orientation === 'portrait');
    const thumb = portraitThumb || cells.find(c => c.url);
    const title = stateCardTitle(r);
    const image = thumb
      ? el('img', { src: thumb.url, alt: '', loading: 'lazy' })
      : el('span', { class: 'state-card-empty', text: 'No capture' });
    const thumbnail = el('span', { class: 'state-card-image' }, image);
    const meta = el('span', {
      class: 'state-card-meta',
      style: `--c: var(--${r.status === 'draft' ? 'warn' : 'pass'})`,
    },
      el('b', { text: r.status === 'draft' ? 'Unreviewed' : r.status }),
      variantStrip(cells),
      el('span', { class: 'state-card-foot', text: `Diffs ${r.shapeLabels.length}` }));
    return el('button', {
      class: `state-card${thumb?.orientation === 'landscape' ? ' landscape' : ''}`,
      type: 'button',
      'data-rid': r.id,
      'aria-pressed': String(current && r.id === current.id),
      'aria-label': `Select state ${stateLabel(r)}`,
      onclick: () => pick(r),
    },
      el('span', { class: 'state-card-name', text: title, title }),
      el('span', { class: 'state-card-body' }, meta, thumbnail));
  }));
  requestAnimationFrame(updateStateScrollers);

  if (!outside) paint();

  // Runs are listed by folder rather than opened: a run database carries its
  // screenshots as blobs, and this page must not fetch 33 MB to say one exists.
  const runs = state.manifest.runs || [];
  const sameScreenEdges = model.edges.filter(e =>
    e.srcRendition && e.srcRendition.screen === screen
    && e.dstRendition && e.dstRendition.screen === screen);
  const routesIn = screen.routesIn.filter(e =>
    !e.srcRendition || e.srcRendition.screen !== screen);
  const routesOut = screen.routesOut.filter(e => !e.dstRendition || e.dstRendition.screen !== screen);

  const sections = [
    outside ? null : childrenSection(state, screen, openCapture),
    pageDisclosure('Action States', sameScreenEdges.length,
      routeTable('Action States', sameScreenEdges, e => e.dst)),
    pageDisclosure('Routes In', routesIn.length, routeTable('Routes In', routesIn, e => e.src)),
    pageDisclosure('Routes Out', routesOut.length, routeTable('Routes Out', routesOut, e => e.dst)),
    pageDisclosure('Runs', runs.length,
      el('div', { class: 'runs' }, runs.length
        ? runs.map(r => el('div', { class: 'visit' },
          el('div', { class: 'vt' },
            el('span', { class: 'stamp', style: '--c: var(--skip)', text: 'not read' }),
            el('span', { text: r.id })),
          el('p', { text: `${r.steps} screenshots. Open it from the runs page; nothing here reads a run database.` })))
        : el('p', { class: 'empty', text: 'No run has reached this screen. Nothing here has a verdict.' }))),
  ].filter(Boolean);

  return el('div', { class: 'page' },
    el('div', { class: 'screen-detail' },
      el('div', { class: 'phead' },
        el('div', { class: 'phead-top' },
          el('button', { class: 'x', 'data-tip': 'Back to Map', onclick: () => { location.href = href('map.html'); } }, icon('back', 14)),
          el('h1', { text: screen.name || screen.id }),
          el('span', { class: 'stamp', style: '--c: var(--skip)', text: outside ? 'outside the app' : screen.kind })),
        screen.summary ? el('p', { text: screen.summary }) : null),
      outside ? outsideCard(state, screen, openCapture) : [
        el('div', { class: 'viewer' },
          el('div', { class: 'capture-head' },
            el('h2', {}, el('span', { class: 'cap', text: 'Current state' }), currentName),
            vtools),
            grid,
            unplacedFiles),
        stateCarousel,
      ],
      sections,
      preview));
}
