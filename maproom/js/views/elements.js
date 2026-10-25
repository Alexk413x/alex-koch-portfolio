/* Pair raw UI-tree nodes with screenshot bounds in their XML paint order. */

import { el, setChildren, svgEl } from '../util/dom.js';
import { icon } from '../util/icons.js';
import { iconToggle, segmentedGroup } from '../util/segmented.js';
import { formatDateTime } from '../util/date.js';
import { routeOptions } from './route-options.js';

const TYPE_LABELS = {
  view: 'View',
};
const TYPE_COLOR_REFERENCE_HUES = [8, 35, 157, 206]; // --fail, --warn, --pass and --accent in tokens.css
const TYPE_COLOR_REFERENCE_GAP = 28;
const DEFAULT_TYPE_COLOR = 'hsl(275 14% 56%)';
const LAYOUT_VIEW_TYPES = [
  'view', 'viewgroup', 'adapterview', 'recyclerview', 'listview', 'gridview',
  'scrollview', 'horizontalscrollview', 'framelayout', 'linearlayout', 'relativelayout',
  'constraintlayout', 'tablelayout', 'tablerow', 'absolutelayout', 'drawerlayout',
  'coordinatorlayout', 'appbarlayout', 'toolbar', 'textinputlayout',
];
const LAYOUT_TYPE_COLORS = new Map(LAYOUT_VIEW_TYPES.map((type, index) => [
  type,
  type === 'view'
    ? 'hsl(80 65% 47%)'
    : `hsl(${255 + index * 4} ${68 + Math.floor(index / 6) * 8}% ${46 + (index % 6) * 4}%)`,
]));
const INTERACTIVE_TYPE_COLORS = new Map([
  ['button', 'hsl(220 88% 53%)'],
  ['imagebutton', 'hsl(225 78% 45%)'],
  ['materialbutton', 'hsl(243 76% 52%)'],
  ['edittext', 'hsl(230 90% 63%)'],
  ['textinputedittext', 'hsl(235 75% 50%)'],
  ['autocompletetextview', 'hsl(215 75% 60%)'],
  ['multiautocompletetextview', 'hsl(240 84% 55%)'],
  ['checkbox', 'hsl(218 70% 48%)'],
  ['switch', 'hsl(225 92% 61%)'],
  ['switchcompat', 'hsl(232 80% 43%)'],
  ['radiobutton', 'hsl(238 70% 58%)'],
  ['togglebutton', 'hsl(212 88% 50%)'],
  ['seekbar', 'hsl(228 68% 67%)'],
  ['ratingbar', 'hsl(236 90% 47%)'],
  ['spinner', 'hsl(216 80% 55%)'],
]);
const KNOWN_VIEW_TYPES = new Set([
  'view', 'viewgroup', 'textview', 'checkedtextview', 'button', 'imagebutton', 'edittext',
  'autocompletetextview', 'multiautocompletetextview', 'imageview', 'checkbox', 'switch',
  'switchcompat', 'radiobutton', 'togglebutton', 'seekbar', 'ratingbar', 'progressbar',
  'spinner', 'adapterview', 'recyclerview', 'listview', 'gridview', 'scrollview',
  'horizontalscrollview', 'webview', 'framelayout', 'linearlayout', 'relativelayout',
  'constraintlayout', 'tablelayout', 'tablerow', 'absolutelayout', 'drawerlayout',
  'coordinatorlayout', 'appbarlayout', 'toolbar', 'materialbutton', 'textinputlayout',
  'textinputedittext',
].map(type => type.toLowerCase()));
const ELEMENT_RAIL_START = 6;
const ELEMENT_RAIL_STEP = 8;
const ELEMENT_TEXT_GAP = 6;

function typeHash(type, seed = 2166136261) {
  let hash = seed;
  for (const character of type) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return hash;
}

function hueDistance(left, right) {
  const difference = Math.abs(left - right) % 360;
  return Math.min(difference, 360 - difference);
}

export function typeColorMap(types) {
  const colors = new Map();
  for (const rawType of types) {
    const type = String(rawType || 'view').toLowerCase();
    if (colors.has(type)) continue;
    if (!KNOWN_VIEW_TYPES.has(type)) {
      colors.set(type, DEFAULT_TYPE_COLOR);
      continue;
    }
    if (LAYOUT_TYPE_COLORS.has(type)) {
      colors.set(type, LAYOUT_TYPE_COLORS.get(type));
      continue;
    }
    if (type === 'textview') {
      colors.set(type, 'hsl(25 88% 55%)');
      continue;
    }
    if (INTERACTIVE_TYPE_COLORS.has(type)) {
      colors.set(type, INTERACTIVE_TYPE_COLORS.get(type));
      continue;
    }
    const hueSeed = typeHash(type);
    let hue = hueSeed % 360;
    for (let offset = 0; offset < 360; offset += 1) {
      const candidate = (hueSeed + offset) % 360;
      const statusDistance = Math.min(...TYPE_COLOR_REFERENCE_HUES
        .map(reference => hueDistance(candidate, reference)));
      if (statusDistance >= TYPE_COLOR_REFERENCE_GAP) {
        hue = candidate;
        break;
      }
    }
    const saturation = 56 + typeHash(type, 0x811c9dc5) % 13;
    const lightness = 47 + typeHash(type, 0x9747b28c) % 13;
    colors.set(type, `hsl(${hue} ${saturation}% ${lightness}%)`);
  }
  return colors;
}

function typeInfo(type, colors) {
  const labelSource = String(type || 'view');
  const normalized = labelSource.toLowerCase();
  const label = TYPE_LABELS[normalized]
    || labelSource.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, character => character.toUpperCase());
  return { label, color: colors.get(normalized) };
}

function primaryLabel(node) {
  return node.text || node.description || node.resourceId.split('/').pop() || node.className || 'Unnamed element';
}

function elementHierarchy(elements) {
  const parents = new Map();
  const children = new Map();
  const stack = [];
  elements.forEach(node => {
    while (stack.length && stack[stack.length - 1].depth >= node.depth) stack.pop();
    const parent = stack[stack.length - 1] || null;
    parents.set(node.id, parent);
    if (parent) {
      const siblings = children.get(parent.id) || [];
      siblings.push(node);
      children.set(parent.id, siblings);
    }
    stack.push(node);
  });
  return { parents, children };
}

function elementSubtreeCounts(elements) {
  const counts = new Map();
  const stack = [];
  const finish = () => {
    const current = stack.pop();
    counts.set(current.node.id, current.count);
    if (stack.length) stack[stack.length - 1].count += current.count;
  };
  elements.forEach(node => {
    while (stack.length && stack[stack.length - 1].node.depth >= node.depth) finish();
    stack.push({ node, count: 1 });
  });
  while (stack.length) finish();
  return counts;
}

function attributesOf(node) {
  return new Map((node?.attributes || []).map(({ key, value }) => [key, value]));
}

function detailsGroup(label, entries) {
  return el('section', { class: 'element-details-group', 'aria-label': label },
    el('h4', { class: 'element-details-heading', text: label }),
    entries.length
      ? el('dl', { class: 'element-attribute-list' },
        entries.flatMap(([key, value]) => [
          el('dt', { text: key }),
          el('dd', {}, value instanceof Node ? value : elementDetailValue(key, value)),
        ]))
      : el('p', { class: 'element-details-empty', text: 'No recorded attributes.' }));
}

function elementDetailValue(label, value) {
  if (label === 'Bounds' || label === 'Size')
    return value || el('span', { text: '-' });
  return el('span', { text: value || '-' });
}

const ACCESSIBILITY_ACTIONS = new Map([
  ['1', 'Focus'],
  ['2', 'Clear focus'],
  ['4', 'Select'],
  ['8', 'Clear selection'],
  ['16', 'Click'],
  ['32', 'Long click'],
  ['64', 'Take accessibility focus'],
  ['128', 'Clear accessibility focus'],
  ['256', 'Move to next'],
  ['512', 'Move to previous'],
  ['1024', 'Move to next HTML element'],
  ['2048', 'Move to previous HTML element'],
  ['4096', 'Scroll forward'],
  ['8192', 'Scroll backward'],
  ['16384', 'Copy'],
  ['32768', 'Paste'],
  ['65536', 'Cut'],
  ['131072', 'Set text selection'],
  ['262144', 'Expand'],
  ['524288', 'Collapse'],
  ['1048576', 'Dismiss'],
  ['2097152', 'Set text'],
  ['16908342', 'Show on screen'],
  ['16908343', 'Scroll to position'],
  ['16908344', 'Scroll up'],
  ['16908345', 'Scroll left'],
  ['16908346', 'Scroll down'],
  ['16908347', 'Scroll right'],
  ['16908348', 'Context click'],
  ['16908349', 'Set progress'],
  ['16908354', 'Move window'],
  ['16908356', 'Show tooltip'],
  ['16908357', 'Hide tooltip'],
  ['16908358', 'Page up'],
  ['16908359', 'Page down'],
  ['16908360', 'Page left'],
  ['16908361', 'Page right'],
  ['16908362', 'Press and hold'],
  ['16908372', 'Enter'],
  ['16908373', 'Start drag'],
  ['16908374', 'Drop'],
  ['16908375', 'Cancel drag'],
]);

function accessibilityInteractions(node) {
  const actionIds = attributesOf(node).get('action-ids') || '';
  return actionIds.split(',')
    .map(id => id.trim())
    .filter(Boolean)
    .map(id => ACCESSIBILITY_ACTIONS.get(id) || `Action ${id}`);
}

function routeTargetsElement(edge, node) {
  const attributes = attributesOf(node);
  const values = [
    node.text,
    node.description,
    node.resourceId,
    attributes.get('resource-id'),
    attributes.get('text'),
    attributes.get('content-desc'),
  ].filter(Boolean).map(value => String(value).trim());
  const matches = value => values.includes(String(value || '').trim());

  if (edge.steps.some(step => {
    const params = step.paramsObj || {};
    return [
      params.label,
      params['long-clickable-text'],
      params['scrollable-text'],
      params.desc,
      params.id,
      params.field,
      params.name,
      step.action_id === 'type-text-into-field' ? '' : params.text,
    ].some(matches);
  })) return true;

  const actionLabel = String(edge.action || '').slice(String(edge.action || '').lastIndexOf(':') + 1);
  return matches(actionLabel);
}

function tapPointForRoute(edge) {
  if (!/\[tap\]/i.test(String(edge.action || ''))) return null;
  for (const step of edge.steps || []) {
    const params = step.paramsObj || {};
    if (params.x === undefined || params.y === undefined || params.x === '' || params.y === '')
      continue;
    const x = Number(params.x);
    const y = Number(params.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  return null;
}

function hasClickAction(node) {
  return (attributesOf(node).get('action-ids') || '').split(',')
    .some(value => ['16', 'ACTION_CLICK'].includes(value.trim().toUpperCase()));
}

function supportsClick(node) {
  return attributesOf(node).get('clickable') === 'true' || hasClickAction(node);
}

function isIndependentInteraction(node) {
  const attributes = attributesOf(node);
  return supportsClick(node)
    || ['editable', 'long-clickable', 'scrollable']
      .some(name => attributes.get(name) === 'true');
}

function inferInteractionAssociations(tree, routes) {
  const elements = tree?.elements || [];
  const byId = new Map(elements.map(node => [node.id, node]));
  const children = new Map();
  for (const node of elements) {
    if (node.parentId === null || node.parentId === undefined) continue;
    const siblings = children.get(node.parentId) || [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const associations = [];
  for (const edge of routes) {
    if (!/\[tap\]/i.test(String(edge.action || ''))) continue;
    const point = tapPointForRoute(edge);
    const target = point
      ? elements
        .filter(node => node.bounds
          && point.x >= node.bounds[0] && point.x < node.bounds[2]
          && point.y >= node.bounds[1] && point.y < node.bounds[3])
        .sort((left, right) => right.depth - left.depth || right.order - left.order)[0]
      : elements
        .filter(node => routeTargetsElement(edge, node))
        .sort((left, right) => right.depth - left.depth || right.order - left.order)[0];
    if (!target) continue;

    const ancestors = [];
    for (let candidate = target; candidate; candidate = byId.get(candidate.parentId)) {
      ancestors.push(candidate);
    }
    const routeLabelInSubtree = candidate => {
      let matched = false;
      const pending = [candidate];
      while (pending.length && !matched) {
        const current = pending.pop();
        if (routeTargetsElement(edge, current)) matched = true;
        else pending.push(...(children.get(current.id) || []));
      }
      return matched;
    };
    const actionParent = ancestors.find(supportsClick)
      || ancestors.slice(1).find(routeLabelInSubtree);
    if (!actionParent) continue;

    const relatedViews = [];
    if (supportsClick(actionParent)) {
      const pending = [...(children.get(actionParent.id) || [])].reverse();
      while (pending.length) {
        const current = pending.pop();
        if (isIndependentInteraction(current)) continue;
        if (current.id !== target.id) relatedViews.push(current.id);
        const descendants = children.get(current.id) || [];
        for (let index = descendants.length - 1; index >= 0; index -= 1) {
          pending.push(descendants[index]);
        }
      }
    }
    associations.push({
      edge,
      tap_target: target.id,
      action_parent: actionParent.id,
      related_views: relatedViews,
    });
  }
  return associations;
}

function associationsForElement(id, associations) {
  const parents = new Set();
  const targets = new Set();
  for (const association of associations) {
    if (association.action_parent !== id
      && (association.tap_target === id || association.related_views.includes(id))) {
      parents.add(association.action_parent);
    }
    if (association.action_parent === id) {
      [association.tap_target, ...association.related_views]
        .filter(targetId => targetId !== id)
        .forEach(targetId => targets.add(targetId));
    }
  }
  return {
    ...(parents.size ? { 'data-action-parent': [...parents].join(' ') } : {}),
    ...(targets.size ? { 'data-action-targets': [...targets].join(' ') } : {}),
  };
}

function interactionDetails(node, associations, elements) {
  if (!node) return [];
  const byId = new Map(elements.map(item => [item.id, item]));
  const details = [];
  const parents = new Set(associations
    .filter(association => association.action_parent !== node.id
      && (association.tap_target === node.id || association.related_views.includes(node.id)))
    .map(association => association.action_parent));
  const targets = new Set(associations
    .filter(association => association.action_parent === node.id)
    .flatMap(association => [association.tap_target, ...association.related_views])
    .filter(id => id !== node.id));
  if (parents.size) {
    details.push(['Likely control', [...parents].map(id => {
      const control = byId.get(id);
      return control
        ? `Element ${Number(control.order) + 1}: ${primaryLabel(control)} (ID ${control.id})`
        : `Element ID ${id}`;
    }).join('; ')]);
  }
  if (targets.size) {
    details.push(['Related raw views', [...targets].map(id => {
      const target = byId.get(id);
      return target
        ? `Element ${Number(target.order) + 1}: ${primaryLabel(target)} (ID ${target.id})`
        : `Element ID ${id}`;
    }).join('; ')]);
  }
  if (details.length) {
    details.push(['Evidence', 'Inferred from route labels, hierarchy and advertised click support; coordinates and bounds help when recorded. This does not prove the physical touch target or handler dispatch.']);
  }
  return details;
}

function elementDimensions(node) {
  if (!node?.bounds) return { width: '', height: '' };
  const [left, top, right, bottom] = node.bounds;
  return { width: right - left, height: bottom - top };
}

function elementBounds(node) {
  if (!node?.bounds) return '';
  const [left, top, right, bottom] = node.bounds;
  return measurement([
    ['L', String(left)],
    ['T', String(top)],
    ['R', String(right)],
    ['B', String(bottom)],
  ], ' ');
}

function elementSize(dimensions, depth = null, densityDpi = null, includePixels = false, separator = ' ') {
  if (dimensions.width === '' || dimensions.height === '') return '';
  const displayDimension = pixels => {
    if (!densityDpi) return `${pixels} px`;
    const dp = Math.round(pixels * 1600 / densityDpi) / 10;
    const dpValue = `${Number.isInteger(dp) ? dp : dp.toFixed(1)} dp`;
    return includePixels ? `${dpValue} [${pixels} px]` : dpValue;
  };
  const values = [
    ['H', displayDimension(dimensions.height)],
    ['W', displayDimension(dimensions.width)],
  ];
  if (depth !== null && depth !== undefined) values.push(['D', String(depth)]);
  return measurement(values, separator);
}

function measurement(parts, separator) {
  return el('span', { class: 'element-measurement' },
    parts.flatMap(([label, value], index) => [
      index ? el('span', { class: 'element-measurement-separator', text: separator }) : null,
      el('span', { class: 'element-measurement-label', text: label }),
      ' ',
      el('span', { class: 'element-measurement-value', text: value }),
    ]));
}

function deviceAttributeValue(key, value) {
  return ['actions', 'action-ids'].includes(key)
    ? value.replace(/,(?!\s)/g, ', ')
    : value;
}

function interactionList(actions, compact = false) {
  return actions.length
    ? el('ul', {
      class: compact ? 'element-action-list compact' : 'element-action-list',
      'aria-label': 'Interactions',
    },
      actions.map(action => el('li', { text: action })))
    : el('p', { class: 'element-details-empty', text: 'None' });
}

function elementClassValue(info, className) {
  return el('span', { class: 'element-class-value' },
    el('span', { class: 'element-class-type', text: info?.label || '-' }),
    ' ',
    el('span', { class: 'element-class-name', text: className || '-' }));
}

function elementRails(node, ancestors, continues, hasChildren, filter, colors) {
  const lineHeight = 40;
  const currentX = ELEMENT_RAIL_START + node.depth * ELEMENT_RAIL_STEP;
  const paths = ancestors.map((ancestor, index) => {
    const x = ELEMENT_RAIL_START + ancestor.depth * ELEMENT_RAIL_STEP;
    return svgEl('path', {
      d: `M${x} 0V${continues[index] ? lineHeight : lineHeight - 6}`,
      fill: 'none',
      stroke: colors.get(String(ancestor.type || 'view').toLowerCase()),
      'stroke-width': 1.5,
      'stroke-opacity': elementMatchesFilter(ancestor, filter) ? '1' : '0.3',
      'data-rail-depth': String(ancestor.depth),
      'data-rail-id': ancestor.id,
    });
  });
  paths.push(svgEl('path', {
    d: `M${currentX} 6V${hasChildren ? lineHeight : lineHeight - 6}`,
    fill: 'none',
    stroke: colors.get(String(node.type || 'view').toLowerCase()),
    'stroke-width': 1.5,
    'stroke-opacity': elementMatchesFilter(node, filter) ? '1' : '0.3',
    'data-rail-depth': String(node.depth),
    'data-rail-id': node.id,
  }));
  return svgEl('svg', {
    class: 'element-tree-rails',
    width: currentX + 1,
    height: lineHeight,
    viewBox: `0 0 ${currentX + 1} ${lineHeight}`,
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  }, paths);
}

function elementRow(node, selected, onSelect, onCollapse, onCollapsePreview,
  subtreeCounts, hierarchy, collapsed, filter, visibleNodes,
  visibleIds, lastVisibleIndexByAncestor, visibleIndex, colors, interactionAssociations = []) {
  const info = typeInfo(node.type, colors);
  const ancestors = [];
  let parent = hierarchy.parents.get(node.id);
  while (parent) {
    ancestors.unshift(parent);
    parent = hierarchy.parents.get(parent.id);
  }
  const continues = ancestors.map(ancestor =>
    lastVisibleIndexByAncestor.get(ancestor.id) > visibleIndex);
  const children = hierarchy.children.get(node.id) || [];
  const hasChildren = children.length > 0;
  const hasVisibleChildren = children.some(child => visibleIds.has(child.id));
  const isCollapsed = collapsed.has(node.id);
  const selector = el('button', {
    class: `element-item${selected === node.id ? ' selected' : ''}`,
    type: 'button',
    'data-element-id': node.id,
    'data-element-type': node.type,
    'data-interactive': String(node.interactive),
    'data-state': String(node.inState),
    'data-order': String(node.order),
    ...associationsForElement(node.id, interactionAssociations),
    'aria-label': `Element ${node.order + 1}: ${primaryLabel(node)} (${info.label})`,
    'aria-pressed': String(selected === node.id),
    onclick: () => onSelect(node.id),
    onpointerenter: event => {
      onSelect(node.id, false);
    },
    onpointerleave: event => {
      onSelect(null, false);
    },
  },
  el('span', { class: 'element-item-copy' },
    el('span', { class: 'element-item-name', text: primaryLabel(node) }),
    el('span', { class: 'element-item-type', text: info.label })));
  const content = el('div', { class: 'element-row-content' },
    selector,
    hasChildren
      ? el('button', {
        class: 'element-collapse',
        type: 'button',
        'aria-expanded': String(!isCollapsed),
        'aria-label': `${isCollapsed ? 'Expand' : 'Collapse'} ${primaryLabel(node)} children (${subtreeCounts.get(node.id)} elements including this one)`,
        'data-collapse-id': node.id,
        onclick: event => {
          event.stopPropagation();
          onCollapse(node.id);
        },
        onpointerenter: () => onCollapsePreview(node.id, !isCollapsed),
        onpointerleave: () => onCollapsePreview(node.id, false),
      },
      el('span', {
        class: 'element-descendant-count',
        'aria-hidden': 'true',
        text: String(subtreeCounts.get(node.id)),
      }),
      svgEl('svg', {
        class: 'element-collapse-icon',
        viewBox: '0 0 16 16',
        'aria-hidden': 'true',
      }, svgEl('path', {
        d: isCollapsed ? 'M6 3.5 10.5 8 6 12.5' : 'M3.5 6 8 10.5 12.5 6',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.5,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      })))
      : el('span', { class: 'element-collapse-spacer', 'aria-hidden': 'true' }),
    );
  return el('li', {
    class: `element-list-entry${selected === node.id ? ' selected' : ''}`,
  },
    el('div', {
      class: `element-list-row${selected === node.id ? ' selected' : ''}`,
      'data-visible': String(elementMatchesFilter(node, filter)),
    },
      el('div', { class: 'element-row-lines' },
        elementRails(node, ancestors, continues, hasVisibleChildren, filter, colors)),
      content));
}

export function elementMatchesFilter(node, filter) {
  if (filter === null) return false;
  if (filter === 'all') return true;
  const interactive = node.interactive ?? node.dataset?.interactive === 'true';
  const inState = node.inState ?? node.dataset?.state === 'true';
  if (filter === 'interactive') return interactive;
  if (filter === 'state') return inState === true;
  return false;
}

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

export function elementFilterIcon(kind) {
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

function treeWithInteractiveRoutes(tree, routes) {
  if (!tree) return tree;
  return {
    ...tree,
    elements: tree.elements.map(node => ({
      ...node,
      interactive: Boolean(elementMatchesFilter(node, 'interactive')
        || routes.some(edge => routeTargetsElement(edge, node))),
    })),
  };
}

function box(node, viewport, selected, onSelect, interactive, filter, colors, paintOrder,
  interactionAssociations = []) {
  if (!node.bounds || !viewport) return null;
  const [left, top, right, bottom] = node.bounds;
  const info = typeInfo(node.type, colors);
  const visible = elementMatchesFilter(node, filter);
  const attrs = {
    class: `element-box${selected === node.id ? ' selected' : ''}`,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    fill: 'none',
    stroke: info.color,
    'stroke-opacity': visible ? 0.5 : 0,
    'stroke-width': 1,
    'vector-effect': 'non-scaling-stroke',
    'data-element-id': node.id,
    'data-element-type': node.type,
    'data-interactive': String(node.interactive),
    'data-state': String(node.inState),
    'data-visible': String(visible),
    'data-order': String(node.order),
    'data-depth': String(node.depth),
    'data-paint-order': String(paintOrder),
    'data-stack-level': selected === node.id ? '1' : '0',
    ...associationsForElement(node.id, interactionAssociations),
    onpointerenter: () => {
      if (interactive) onSelect(node.id, false);
    },
    onpointerleave: () => {
      if (interactive) onSelect(null, false);
    },
  };
  if (interactive) Object.assign(attrs, {
    tabindex: '0',
    role: 'button',
    'aria-pressed': String(selected === node.id),
    'aria-label': `Element ${node.order + 1}: ${primaryLabel(node)} (${info.label})`,
    onclick: () => onSelect(node.id),
    onfocus: () => onSelect(node.id, false),
    onblur: () => onSelect(null, false),
    onkeydown: event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(node.id);
      }
    },
  });
  return svgEl('rect', attrs);
}

export function elementOverlay(tree, { selected = null, onSelect = () => {}, filter = 'all',
  interactive = true, className = '', preserveAspectRatio = 'none', typeColors = null,
  interactionAssociations = [], routes = [] } = {}) {
  tree = treeWithInteractiveRoutes(tree, routes);
  const { elements, viewport } = tree;
  if (!viewport) return null;
  const colors = typeColors || typeColorMap(elements.map(node => node.type));
  const paintOrder = elements
    .filter(node => node.bounds)
    .sort((a, b) => a.depth - b.depth || a.bounds[1] - b.bounds[1] || a.order - b.order);
  const overlay = svgEl('svg', {
    class: `element-overlay${className ? ` ${className}` : ''}`,
    viewBox: `${viewport[0]} ${viewport[1]} ${viewport[2] - viewport[0]} ${viewport[3] - viewport[1]}`,
    preserveAspectRatio,
    role: 'group',
    'aria-label': 'Accessibility element bounds, ordered by depth and top-to-bottom position',
  }, [
    svgEl('g', { class: 'element-boxes-default' },
      paintOrder.map((node, index) =>
        box(node, viewport, selected, onSelect, interactive, filter, colors, index,
          interactionAssociations))),
    svgEl('g', {
      class: 'element-boxes-selected',
      'aria-hidden': 'true',
      'pointer-events': 'none',
    }),
    svgEl('g', {
      class: 'element-boxes-hovered',
      'aria-hidden': 'true',
      'pointer-events': 'none',
    }),
  ]);
  restackElementOverlay(overlay, selected, null);
  updateActiveOutline(overlay, selected);
  return overlay;
}

export function alignElementOverlayToImage(overlay, image) {
  const align = () => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    overlay.setAttribute('viewBox', `0 0 ${image.naturalWidth} ${image.naturalHeight}`);
  };
  if (image.complete) align();
  else image.addEventListener('load', align, { once: true });
}

export function restackElementOverlay(overlay, selectedId, hoveredId) {
  if (!overlay) return;
  const layers = {
    default: overlay.querySelector('.element-boxes-default'),
    selected: overlay.querySelector('.element-boxes-selected'),
    hovered: overlay.querySelector('.element-boxes-hovered'),
  };
  if (!layers.default || !layers.selected || !layers.hovered) return;

  layers.selected.replaceChildren();
  layers.hovered.replaceChildren();
  [...layers.default.children].forEach(box => {
    const id = box.dataset.elementId;
    const isHovered = hoveredId != null && id === String(hoveredId);
    const isSelected = selectedId != null && id === String(selectedId);
    box.dataset.stackLevel = isHovered ? '2' : isSelected ? '1' : '0';

    if (box.dataset.visible !== 'true') return;
    const addOutline = (layer, className) => {
      const outline = box.cloneNode(false);
      outline.setAttribute('class', `element-outline ${className}`);
      outline.setAttribute('stroke-opacity', '1');
      outline.setAttribute('pointer-events', 'none');
      outline.removeAttribute('tabindex');
      outline.removeAttribute('role');
      outline.removeAttribute('aria-label');
      outline.removeAttribute('aria-pressed');
      outline.removeAttribute('data-tip');
      layer.append(outline);
    };

    if (isSelected) addOutline(layers.selected, 'element-selected-outline');
    if (isHovered) addOutline(layers.hovered, 'element-hover-outline');
  });
}

export function updateActiveOutline(overlay, activeId) {
  if (!overlay) return;
  overlay.querySelectorAll('.element-active-outline').forEach(outline => {
    outline.classList.remove('element-active-outline');
    outline.removeAttribute('data-active-id');
  });
  if (activeId === null || activeId === undefined) return;
  const id = String(activeId);
  const outline = [...overlay.querySelectorAll(
    '.element-boxes-hovered [data-element-id], .element-boxes-selected [data-element-id]',
  )].find(candidate => candidate.dataset.elementId === id);
  if (!outline) return;
  outline.classList.add('element-active-outline');
  outline.setAttribute('data-active-id', id);
}

export function elementInspector({
  cell, tree, filter, selected, onSelect, onRetry, error, loading,
  filterGroup, getSelected = () => selected,
  routes = [],
  routeHref = () => null,
  device = {},
  captureInfo, captureInfoLoaded = false, captureInfoLoading = false, captureInfoError = '',
  captureInfoOpen = false, paneSelection, onPaneSelectionChange = () => {},
  onToggleCaptureInfo = () => {},
}) {
  const inferredAssociations = inferInteractionAssociations(tree, routes);
  tree = treeWithInteractiveRoutes(tree, routes);
  const associationsForFilter = active => active === 'interactive' ? inferredAssociations : [];
  const orientation = cell.orientation === 'landscape'
    || (cell.orientation !== 'portrait' && tree?.viewport
      && tree.viewport[2] - tree.viewport[0] > tree.viewport[3] - tree.viewport[1])
    ? 'landscape'
    : 'portrait';
  const stage = el('div', {
    class: `element-inspector-stage ${orientation}`,
    'aria-label': 'Screenshot and accessibility elements',
  });
  const elements = tree ? tree.elements : [];
  const typeColors = typeColorMap(elements.map(node => node.type));
  const screenshot = el('img', {
    src: cell.url,
    alt: `Selected screenshot for ${cell.orientation}, ${cell.appearance}`,
  });
  let selectElement = onSelect;
  const overlay = tree && tree.viewport
    ? elementOverlay(tree, {
      selected,
      onSelect: (id, persist = true) => selectElement(id, persist),
      filter,
      typeColors,
      preserveAspectRatio: 'xMidYMid meet',
      interactionAssociations: associationsForFilter(filter),
    })
    : null;
  if (overlay) alignElementOverlayToImage(overlay, screenshot);
  const preview = el('div', { class: 'element-preview' },
    screenshot,
    overlay);
  const separator = el('div', {
    class: 'element-splitter',
    role: 'separator',
    tabindex: '0',
    'aria-orientation': orientation === 'landscape' ? 'horizontal' : 'vertical',
    'aria-label': 'Resize screenshot and element list',
    'aria-valuemin': '35',
    'aria-valuemax': '75',
    'aria-valuenow': '62',
    'aria-valuetext': 'Screenshot 62%, element list 38%',
  });
  const hierarchy = elementHierarchy(elements);
  const subtreeCounts = elementSubtreeCounts(elements);
  const collapsed = new Set();
  let activeFilter = filter;
  let filterUpdates = Promise.resolve();
  let showCaptureInfo = captureInfoOpen;
  let hoveredElementId = null;
  let detailsOpen = false;
  const listTitle = el('span', {
    class: 'element-list-title',
    text: 'Capture details',
    hidden: !showCaptureInfo,
  });
  const summaryName = el('strong', { class: 'element-summary-name' },
    el('span', { class: 'element-summary-id', hidden: true }),
    el('span', { class: 'element-summary-name-text', text: '-' }));
  const summaryType = el('span', { class: 'element-summary-type', text: '-' });
  const summaryFields = el('div', { class: 'element-summary-fields' });
  const elementSummary = el('section', {
    class: 'element-summary',
    'aria-label': 'Hovered or selected element summary',
  },
  el('div', { class: 'element-summary-heading' },
    el('div', { class: 'element-summary-identity' }, summaryType, summaryName),
  ),
  summaryFields);
  let selectedPane = paneSelection === undefined
    ? (showCaptureInfo ? 'capture-info' : 'elements')
    : paneSelection;
  const viewToggle = segmentedGroup([
    {
      value: 'elements',
      title: 'Show Details',
      label: 'Elements',
      content: el('span', { text: 'Elements' }),
    },
    {
      value: 'details',
      title: 'Show Elements',
      label: 'Details',
      content: el('span', { text: 'Details' }),
    },
  ], {
    isSelected: value => value === (detailsOpen ? 'details' : 'elements'),
    onChange: value => toggleElementDetails(value === 'details'),
    label: 'Inspector view',
    className: 'element-view-toggle',
  });
  viewToggle.querySelectorAll('button').forEach(button => {
    button.setAttribute('aria-controls', 'element-inspector-content');
  });
  const paneToggle = iconToggle([
    {
      value: 'elements',
      title: 'Show the Elements list',
      content: icon('elements', 12),
    },
    {
      value: 'capture-info',
      title: 'Show Capture details',
      content: icon('tracked', 12),
    },
  ], {
    value: selectedPane,
    label: 'Capture details',
    className: 'element-pane-toggle-group element-pane-toggle',
    onChange: pane => {
      selectedPane = pane;
      onPaneSelectionChange(pane);
      setPane(pane === 'capture-info');
    },
  });
  const controls = el('div', { class: 'element-inspector-controls' },
    filterGroup,
    error
      ? el('button', {
        class: 'element-retry',
        type: 'button',
        onclick: onRetry,
        text: 'Retry',
      })
      : null,
    paneToggle);
  const listBody = el('ul', { class: 'element-list' });
  const detailBody = el('div', { class: 'element-detail-body' });
  const detailView = el('section', {
    class: 'element-detail-view',
    id: 'element-inspector-details',
    'aria-label': 'Element details',
    'aria-hidden': 'true',
    inert: true,
  }, detailBody);
  const listViewport = el('div', {
    class: 'element-list-viewport',
    id: 'element-inspector-content',
    role: 'region',
    'aria-label': 'Elements list',
    'data-details-open': 'false',
  },
  listBody,
  detailView);
  const viewTabs = el('div', {
    class: 'element-list-head',
    role: 'group',
    'aria-label': 'Inspector view',
  },
  viewToggle,
  listTitle);
  const captureInfoPanel = el('div', {
    class: 'capture-info-panel',
    hidden: true,
  });
  const list = el('div', {
    class: 'element-list-pane',
    'aria-label': showCaptureInfo ? 'Capture details' : 'Elements list',
  },
  controls,
  elementSummary,
  viewTabs,
  listViewport,
  captureInfoPanel);
  listViewport.hidden = showCaptureInfo;
  elementSummary.hidden = showCaptureInfo;
  viewTabs.hidden = showCaptureInfo;
  captureInfoPanel.hidden = !showCaptureInfo;
  stage.addEventListener('capture-info-update', event => renderCaptureInfo(event.detail));
  if (showCaptureInfo) renderCaptureInfo();

  function valueText(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }

  function captureDate(record, field) {
    const value = record && (record[`${field}_iso`] || record[field]);
    if (value === null || value === undefined || value === '') return null;
    const date = new Date(typeof value === 'number' ? value
      : /^\d+$/.test(String(value)) ? Number(value) : value);
    if (Number.isNaN(date.getTime())) return null;
    return { datetime: date.toISOString(), text: formatDateTime(date) };
  }

  function captureRow(label, value) {
    return value ? [label, value] : null;
  }

  function dateRow(label, record, field, missing = '') {
    const date = captureDate(record, field);
    return captureRow(label, date
      ? el('time', { datetime: date.datetime, text: date.text })
      : missing);
  }

  function axisRows(value) {
    if (!value) return [];
    const labels = {
      appearance: 'Appearance',
      font_scale: 'Font scale',
      locale: 'Locale',
      nav: 'Navigation',
      orientation: 'Orientation',
      rotation: 'Rotation',
    };
    return String(value).split(';').flatMap(part => {
      const [key, raw] = part.split('=');
      if (!key || raw === undefined || !labels[key]) return [];
      const display = key === 'nav'
        ? ({ back: 'Three-button', gestural: 'Gesture', twobutton: 'Two-button' }[raw] || raw)
        : key === 'appearance' || key === 'orientation'
          ? raw.replace(/\b\w/g, character => character.toUpperCase())
          : raw;
      return [[labels[key], display]];
    });
  }

  function captureInfoSections(record) {
    const tree = record.tree || {};
    const shot = record.shot || {};
    const build = tree.app_build || shot.app_build || {};
    const observed = tree.observed || {};
    const details = device.profile || device;
    const versionName = valueText(build.version_name);
    const versionCode = valueText(build.version_code);
    const appVersion = valueText(tree.app_version || shot.app_version);
    const version = versionName
      ? `${versionName}${versionCode && !versionName.includes(versionCode) ? ` (${versionCode})` : ''}`
      : appVersion || versionCode;
    const deviceName = [details.make, details.model].map(valueText).filter(Boolean).join(' ')
      || valueText(details.avd || details.name);
    const platformValue = valueText(details.platform).toLowerCase();
    const platform = ({ android: 'Android', ios: 'iOS', web: 'Web' }[platformValue])
      || valueText(details.platform);
    const os = [platform, valueText(details.os)].filter(Boolean).join(' ');
    const axes = axisRows(tree.axes);
    const axisLabels = new Set(axes.map(([label]) => label));
    if (!axisLabels.has('Orientation') && cell.orientation) {
      axes.push(['Orientation', cell.orientation.replace(/\b\w/g, character => character.toUpperCase())]);
    }
    if (!axisLabels.has('Appearance') && cell.appearance) {
      axes.push(['Appearance', cell.appearance.replace(/\b\w/g, character => character.toUpperCase())]);
    }
    if (!axisLabels.has('Locale') && cell.leaf?.locale) axes.push(['Locale', cell.leaf.locale]);
    const screenshotDate = captureDate(shot, 'captured_at');
    const treeDate = captureDate(tree, 'captured_at');
    const screenshotAndTreeSame = screenshotDate && treeDate
      && screenshotDate.datetime === treeDate.datetime;
    const screenshotRows = [
      dateRow(screenshotAndTreeSame ? 'Captured at' : 'Screenshot captured', shot, 'captured_at',
        shot.captured_at || tree.captured_at ? '' : 'Not recorded'),
      ...(!screenshotAndTreeSame && treeDate
        ? [dateRow('UI tree read', tree, 'captured_at')]
        : []),
      captureRow('Source', valueText(tree.source || shot.source)),
      captureRow('Window title', valueText(observed.window_text)),
    ].filter(Boolean);
    const apkRows = [
      captureRow('Version', version),
      captureRow('Package', valueText(build.package || observed.package)),
      captureRow('APK SHA-256', valueText(build.apk_sha256)),
      dateRow('APK build time', build, 'build_time', 'Not reported by driver'),
      captureRow('Build time source', valueText(build.build_time_source)),
    ].filter(Boolean);
    const setupRows = [
      captureRow('Device', deviceName),
      captureRow('Operating system', os),
      captureRow('Resolution', valueText(details.resolution)),
      captureRow('Density', details.density ? `${details.density} dpi` : ''),
      ...axes,
      dateRow('First installed', build, 'first_install_time'),
      dateRow('Last updated', build, 'last_update_time'),
    ].filter(Boolean);
    return [
      ['APK', apkRows],
      ['Device setup', setupRows],
      ['Capture details', screenshotRows],
    ].filter(([, rows]) => rows.length);
  }

  function renderCaptureInfo({
    record = captureInfo,
    loaded = captureInfoLoaded,
    isLoading = captureInfoLoading,
    loadError = captureInfoError,
  } = {}) {
    if (loadError) {
      setChildren(captureInfoPanel, el('p', {
        class: 'capture-info-message error',
        role: 'alert',
        text: loadError,
      }));
      return;
    }
    if (isLoading || !loaded) {
      setChildren(captureInfoPanel, el('p', {
        class: 'capture-info-message',
        'aria-live': 'polite',
        text: 'Loading capture info…',
      }));
      return;
    }
    if (!record) {
      setChildren(captureInfoPanel, el('p', {
        class: 'capture-info-message',
        text: 'No capture.json is stored for this screenshot.',
      }));
      return;
    }
    const sections = captureInfoSections(record);
    if (!sections.length) {
      setChildren(captureInfoPanel, el('p', {
        class: 'capture-info-message',
        text: 'No capture metadata is recorded.',
      }));
      return;
    }
    setChildren(captureInfoPanel, sections.map(([title, rows]) =>
      el('section', { class: 'capture-info-section' },
        el('h3', { class: 'capture-info-section-title', text: title }),
        el('dl', { class: 'capture-info-list' },
          rows.map(([label, value]) => [
            el('dt', { text: label }),
            el('dd', {}, value),
          ])))));
  }

  function currentElement() {
    const id = hoveredElementId ?? getSelected();
    return id === null || id === undefined
      ? null
      : elements.find(node => node.id === String(id)) || null;
  }

  function renderElementSummary() {
    const node = currentElement();
    const attributes = attributesOf(node);
    const info = node ? typeInfo(node.type, typeColors) : null;
    const interactionAssociations = associationsForFilter(activeFilter);
    const relatedRoutes = node && activeFilter === 'interactive'
      ? interactionAssociations
        .filter(association => association.tap_target === node.id
          || association.action_parent === node.id
          || association.related_views.includes(node.id))
        .map(association => association.edge)
      : [];
    const elementRoutes = node
      ? [...new Set([
        ...routes.filter(edge => routeTargetsElement(edge, node)),
        ...relatedRoutes,
      ])]
      : [];
    const interactions = accessibilityInteractions(node);
    const deviceDetails = device.profile || device;
    const density = Number(deviceDetails.density);
    const densityDpi = String(deviceDetails.platform || '').toLowerCase() === 'android'
      && Number.isFinite(density) && density > 0
      ? density
      : null;

    const summaryId = summaryName.querySelector('.element-summary-id');
    summaryId.textContent = node?.id || '';
    summaryId.hidden = !node;
    summaryName.querySelector('.element-summary-name-text').textContent =
      node ? primaryLabel(node) : '-';
    summaryType.textContent = info ? info.label : '-';
    summaryType.style.setProperty('--element-type-color', info?.color || 'var(--muted)');
    const dimensions = elementDimensions(node);
    const contentValues = [
      ['T', attributes.get('text')],
      ['CD', attributes.get('content-desc')],
      ['SD', attributes.get('state-desc')],
    ].filter(([, value]) => value);
    const contentValue = contentValues.length
      ? el('span', { class: 'element-summary-content-values' },
        contentValues.flatMap(([label, value], index) => [
          index ? el('span', { class: 'element-summary-field-separator', text: '·' }) : null,
          el('span', { class: 'element-summary-content-part' },
            el('span', { class: 'element-summary-content-kind', text: label }),
            ' ',
            el('span', { class: 'element-summary-field-value', text: value })),
        ]))
      : el('span', { class: 'element-summary-field-value', text: '-' });
    const hasDimensions = dimensions.width !== '' && dimensions.height !== '';
    const interactionValue = interactions.length
      ? interactionList(interactions, true)
      : el('span', { class: 'element-summary-field-value', text: '-' });
    setChildren(summaryFields,
      el('span', { class: 'element-summary-field', 'data-label': 'Content' },
        el('span', { class: 'element-summary-field-label', text: 'Content' }),
        contentValue),
      el('span', { class: 'element-summary-field', 'data-label': 'Size' },
        el('span', { class: 'element-summary-field-label', text: 'Size' }),
        el('span', { class: 'element-summary-field-value' },
          hasDimensions ? elementSize(dimensions, node?.depth, densityDpi) : '-')),
      el('span', { class: 'element-summary-field', 'data-label': 'Interactions' },
        el('span', { class: 'element-summary-field-label', text: 'Interactions' }),
        interactionValue),
      el('span', { class: 'element-summary-field element-summary-actions', 'data-label': 'Actions' },
        el('span', { class: 'element-summary-field-label', text: 'Actions' }),
        elementRoutes.length
          ? routeOptions(elementRoutes, routeHref)
          : el('span', { class: 'element-summary-field-value element-summary-actions-placeholder' },
            el('span', { text: '-' }),
            el('span', { text: '-' }))));
    renderElementDetails(node, attributes, info, densityDpi,
      interactionDetails(node, interactionAssociations, elements));
  }

  function renderElementDetails(node, attributes, info, densityDpi, associationDetails) {
    const elementValues = [
      ['ID', node?.id || ''],
      ['Resource ID', attributes.get('resource-id') || ''],
      ['Class', elementClassValue(info, attributes.get('class'))],
      ['Index', attributes.get('index') || ''],
      ['Normalized', node
        ? (node.inState === null ? 'Unavailable' : node.inState ? 'Yes' : 'No')
        : ''],
      ['Interactions', interactionList(accessibilityInteractions(node))],
    ];
    const dimensions = elementDimensions(node);
    const layoutValues = [
      ['Bounds', elementBounds(node)],
      ['Size', elementSize(dimensions, node?.depth, densityDpi, true)],
    ];
    const groups = [
      detailsGroup('Element', elementValues),
      detailsGroup('Content', [
        ['Text', attributes.get('text') || ''],
        ['Content Description', attributes.get('content-desc') || ''],
        ['State Description', attributes.get('state-desc') || ''],
      ]),
      detailsGroup('Layout', layoutValues),
      detailsGroup('Raw data', (node?.attributes || [])
        .map(({ key, value }) => [key, deviceAttributeValue(key, value)])),
    ];
    if (associationDetails.length) {
      groups.splice(groups.length - 1, 0,
        detailsGroup('Interaction association', associationDetails));
    }
    setChildren(detailBody, groups);
  }

  function toggleElementDetails(open = !detailsOpen) {
    detailsOpen = Boolean(open);
    listViewport.dataset.detailsOpen = String(detailsOpen);
    listBody.setAttribute('aria-hidden', String(detailsOpen));
    listBody.toggleAttribute('inert', detailsOpen);
    detailView.setAttribute('aria-hidden', String(!detailsOpen));
    detailView.toggleAttribute('inert', !detailsOpen);
    if (detailsOpen) renderElementSummary();
  }

  function setPane(visible) {
    showCaptureInfo = visible;
    if (visible && detailsOpen) viewToggle.querySelector('[data-value="elements"]').click();
    elementSummary.hidden = visible;
    viewTabs.hidden = visible;
    listViewport.hidden = visible;
    captureInfoPanel.hidden = !visible;
    list.setAttribute('aria-label', visible ? 'Capture details' : 'Elements list');
    listTitle.hidden = !visible;
    onToggleCaptureInfo(visible);
  }

  function descendantIds(id) {
    const descendants = new Set();
    const collect = parentId => {
      for (const child of hierarchy.children.get(parentId) || []) {
        descendants.add(child.id);
        collect(child.id);
      }
    };
    collect(id);
    return descendants;
  }

  function setCollapsePreview(id, active) {
    list.querySelectorAll('.element-list-row.collapse-preview')
      .forEach(row => row.classList.remove('collapse-preview'));
    if (!active || collapsed.has(id)) return;
    const descendants = descendantIds(id);
    list.querySelectorAll('.element-item').forEach(item => {
      if (descendants.has(item.dataset.elementId)) {
        item.closest('.element-list-row').classList.add('collapse-preview');
      }
    });
  }

  function visibleNodesFor(collapsedState) {
    return elements.filter(node => {
      let parent = hierarchy.parents.get(node.id);
      while (parent) {
        if (collapsedState.has(parent.id)) return false;
        parent = hierarchy.parents.get(parent.id);
      }
      return true;
    });
  }

  function animateEntries(entries, opening) {
    if (!entries.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return Promise.resolve();
    }
    return Promise.all(entries.map(entry => {
      const height = entry.getBoundingClientRect().height;
      entry.style.overflow = 'hidden';
      const frames = opening ? [
        { height: '0px', opacity: 0, transform: 'translateY(-3px)' },
        { height: `${height}px`, opacity: 1, transform: 'translateY(0)' },
      ] : [
        { height: `${height}px`, opacity: 1, transform: 'translateY(0)' },
        { height: '0px', opacity: 0, transform: 'translateY(-3px)' },
      ];
      const timing = opening ? {
        duration: 220,
        easing: 'cubic-bezier(.16, 1, .3, 1)',
      } : {
        duration: 150,
        easing: 'ease-in',
      };
      const animation = entry.animate(frames, timing);
      return opening
        ? animation.finished.finally(() => entry.style.removeProperty('overflow'))
        : animation.finished;
    }));
  }

  function renderElementRows({ animateAdded = new Set() } = {}) {
    const visibleNodes = visibleNodesFor(collapsed);
    const lastVisibleIndexByAncestor = new Map();
    visibleNodes.forEach((node, index) => {
      let parent = hierarchy.parents.get(node.id);
      while (parent) {
        lastVisibleIndexByAncestor.set(parent.id, index);
        parent = hierarchy.parents.get(parent.id);
      }
    });
    const visibleIds = new Set(visibleNodes.map(node => node.id));
    const listBody = list.querySelector('.element-list');
    setChildren(listBody,
      visibleNodes.map((node, index) => elementRow(
        node, getSelected(), selectElement, toggleCollapse, setCollapsePreview, subtreeCounts,
        hierarchy, collapsed, activeFilter, visibleNodes, visibleIds, lastVisibleIndexByAncestor, index,
        typeColors, associationsForFilter(activeFilter))));
    const addedEntries = [...listBody.querySelectorAll('.element-list-entry')]
      .filter(entry => animateAdded.has(entry.querySelector('.element-item').dataset.elementId));
    return animateEntries(addedEntries, true);
  }

  async function toggleCollapse(id) {
    const isCollapsing = !collapsed.has(id);
    const descendants = descendantIds(id);
    const entries = [...list.querySelectorAll('.element-item')]
      .filter(item => descendants.has(item.dataset.elementId))
      .map(item => item.closest('.element-list-entry'));
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (isCollapsing && entries.length && !reduceMotion) {
      list.querySelectorAll('.element-collapse').forEach(control => {
        control.disabled = true;
      });
      await animateEntries(entries, false);
    }
    if (isCollapsing) collapsed.add(id);
    else collapsed.delete(id);
    selectElement(null, false);
    setCollapsePreview(id, false);
    await renderElementRows({ animateAdded: isCollapsing ? new Set() : descendants });
  }

  function revealElement(id) {
    const collapsedAncestors = [];
    let parent = hierarchy.parents.get(id);
    while (parent) {
      if (collapsed.has(parent.id)) {
        collapsed.delete(parent.id);
        collapsedAncestors.push(parent.id);
      }
      parent = hierarchy.parents.get(parent.id);
    }

    if (collapsedAncestors.length) {
      const newlyVisible = new Set();
      collapsedAncestors.forEach(ancestorId => {
        descendantIds(ancestorId).forEach(descendantId => newlyVisible.add(descendantId));
      });
      renderElementRows({ animateAdded: newlyVisible });
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollToItem = () => {
      const item = [...list.querySelectorAll('.element-item')]
        .find(candidate => candidate.dataset.elementId === String(id));
      if (!item) return;
      const listBody = list.querySelector('.element-list');
      const listBounds = listBody.getBoundingClientRect();
      const itemBounds = item.getBoundingClientRect();
      const viewportTop = listBounds.top + listBody.clientTop + 4;
      const viewportBottom = listBounds.top + listBody.clientTop
        + listBody.clientHeight - 4;
      let scrollTop = listBody.scrollTop;
      if (itemBounds.top < viewportTop) scrollTop -= viewportTop - itemBounds.top;
      else if (itemBounds.bottom > viewportBottom) scrollTop += itemBounds.bottom - viewportBottom;
      listBody.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: reduceMotion ? 'instant' : 'smooth',
      });
    };
    if (collapsedAncestors.length && !reduceMotion) {
      window.setTimeout(scrollToItem, 220);
    } else {
      scrollToItem();
    }
  }

  selectElement = (id, persist = true) => {
    if (persist && id !== null && id !== undefined) revealElement(id);
    hoveredElementId = persist || id === null || id === undefined ? null : String(id);
    onSelect(id, persist);
    renderElementSummary();
  };
  renderElementSummary();

  async function applyFilter(nextFilter, previousFilter) {
    activeFilter = nextFilter;
    const previousVisibleIds = new Set(visibleNodesFor(collapsed).map(node => node.id));
    const nextCollapsed = new Set(collapsed);
    if (previousFilter !== null && nextFilter !== null && previousFilter !== nextFilter) {
      nextCollapsed.clear();
      const matchingSubtrees = new Map();
      for (let index = elements.length - 1; index >= 0; index -= 1) {
        const node = elements[index];
        const children = hierarchy.children.get(node.id) || [];
        const hasMatchingChild = children.some(child => matchingSubtrees.get(child.id));
        matchingSubtrees.set(node.id, elementMatchesFilter(node, nextFilter) || hasMatchingChild);
        if (children.length && !hasMatchingChild) nextCollapsed.add(node.id);
      }
    }

    const nextVisibleIds = new Set(visibleNodesFor(nextCollapsed).map(node => node.id));
    const hiddenIds = new Set([...previousVisibleIds]
      .filter(id => !nextVisibleIds.has(id)));
    const addedIds = new Set([...nextVisibleIds]
      .filter(id => !previousVisibleIds.has(id)));
    const hiddenEntries = [...list.querySelectorAll('.element-item')]
      .filter(item => hiddenIds.has(item.dataset.elementId))
      .map(item => item.closest('.element-list-entry'));
    if (hiddenEntries.length && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      list.querySelectorAll('.element-collapse').forEach(control => {
        control.disabled = true;
      });
      await animateEntries(hiddenEntries, false);
    }

    collapsed.clear();
    nextCollapsed.forEach(id => collapsed.add(id));
    list.querySelectorAll('.element-list-row.collapse-preview')
      .forEach(row => row.classList.remove('collapse-preview'));
    await renderElementRows({ animateAdded: addedIds });
    renderElementSummary();
  }

  stage.addEventListener('element-filter-change', event => {
    const { filter: nextFilter, previousFilter } = event.detail;
    filterUpdates = filterUpdates.then(() => applyFilter(nextFilter, previousFilter));
  });

  renderElementRows();

  let minSplit = 0;
  let maxSplit = 0;
  let userResized = false;

  function setSplit(value) {
    const next = Math.max(minSplit, Math.min(maxSplit, value));
    const axisSize = orientation === 'landscape'
      ? stage.clientHeight
      : stage.clientWidth;
    const percent = axisSize ? Math.round(next / axisSize * 100) : 0;
    stage.style.setProperty('--element-split', `${Math.round(next)}px`);
    separator.setAttribute('aria-valuemin', String(Math.round(minSplit / axisSize * 100)));
    separator.setAttribute('aria-valuemax', String(Math.round(maxSplit / axisSize * 100)));
    separator.setAttribute('aria-valuenow', String(percent));
    separator.setAttribute(
      'aria-valuetext',
      `Screenshot ${percent}%, element list ${100 - percent}%`,
    );
  }

  function fitToScreenshot() {
    if (!tree?.viewport || !stage.clientWidth || !stage.clientHeight) return;
    const [left, top, right, bottom] = tree.viewport;
    const aspect = screenshot.naturalWidth && screenshot.naturalHeight
      ? screenshot.naturalWidth / screenshot.naturalHeight
      : (right - left) / (bottom - top);
    const padding = 16;
    const splitterSize = 12;
    const listMinimum = 120;
    const axisSize = orientation === 'landscape'
      ? stage.clientHeight
      : stage.clientWidth;
    const ideal = orientation === 'landscape'
      ? (stage.clientWidth - padding) / aspect + padding
      : (stage.clientHeight - padding) * aspect + padding;
    maxSplit = Math.min(ideal, axisSize - splitterSize - listMinimum);
    minSplit = Math.min(maxSplit, Math.max(48, maxSplit * 0.35));
    if (maxSplit > 0) setSplit(maxSplit);
  }

  function resizeAt(event) {
    const bounds = stage.getBoundingClientRect();
    const position = orientation === 'landscape'
      ? event.clientY - bounds.top
      : event.clientX - bounds.left;
    userResized = true;
    setSplit(position - 6);
  }

  separator.addEventListener('pointerdown', event => {
    event.preventDefault();
    userResized = true;
    separator.focus({ preventScroll: true });
    separator.setPointerCapture(event.pointerId);
    resizeAt(event);
  });
  separator.addEventListener('pointermove', event => {
    if (separator.hasPointerCapture(event.pointerId)) resizeAt(event);
  });
  separator.addEventListener('pointerup', event => {
    if (separator.hasPointerCapture(event.pointerId)) separator.releasePointerCapture(event.pointerId);
  });
  separator.addEventListener('keydown', event => {
    const keys = orientation === 'landscape' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    let next = parseFloat(stage.style.getPropertyValue('--element-split'));
    const step = (orientation === 'landscape' ? stage.clientHeight : stage.clientWidth) * 0.05;
    if (event.key === keys[0]) next -= step;
    else if (event.key === keys[1]) next += step;
    else if (event.key === 'Home') next = minSplit;
    else if (event.key === 'End') next = maxSplit;
    else return;
    event.preventDefault();
    userResized = true;
    setSplit(next);
  });

  stage.append(preview, separator, list);
  screenshot.addEventListener('load', fitToScreenshot, { once: true });
  requestAnimationFrame(fitToScreenshot);
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (!userResized) fitToScreenshot();
    });
    observer.observe(stage);
  }
  const status = loading
    ? el('span', { class: 'element-inspector-status', role: 'status', text: 'Reading element bounds…' })
    : error
      ? el('span', { class: 'element-inspector-status error', role: 'alert', text: error })
      : tree && !tree.viewport
        ? el('span', {
          class: 'element-inspector-status error',
          role: 'alert',
          text: 'This UI tree has no usable screen bounds.',
        })
        : null;

  if (status) stage.append(status);
  return stage;
}
