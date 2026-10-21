import { el } from '../util/dom.js';

const ACTION_LABELS = {
  tap: 'Tap',
  'long-press': 'Long press',
  scroll: 'Scroll',
  swipe: 'Swipe',
};

function humanize(value) {
  const label = String(value || 'Action')
    .replace(/[-_]+/g, ' ')
    .trim();
  return label ? `${label[0].toUpperCase()}${label.slice(1)}` : 'Action';
}

export function routeActionLabel(action, separator = '→') {
  const match = /^.*?\[([^\]]+)\](?::(.*))?$/.exec(String(action || ''));
  if (!match) {
    const simple = /^([a-z][a-z0-9-]*):(.*)$/i.exec(String(action || ''));
    if (simple && ACTION_LABELS[simple[1].toLowerCase()]) {
      const target = simple[2].trim();
      return target
        ? `${ACTION_LABELS[simple[1].toLowerCase()]} ${separator} ${target}`
        : ACTION_LABELS[simple[1].toLowerCase()];
    }
    return humanize(action || 'Action');
  }
  const interaction = ACTION_LABELS[match[1]] || humanize(match[1]);
  const control = match[2] || '';
  const delimiterIndex = control.indexOf(':');
  const target = delimiterIndex >= 0 ? control.slice(delimiterIndex + 1) : control;
  return target ? `${interaction} ${separator} ${target}` : interaction;
}

function metric(label, value) {
  return el('span', { class: 'route-metric' },
    el('span', { class: 'route-metric-label', text: label }),
    el('span', { class: 'route-metric-value' }, value));
}

function compactStateName(name) {
  return String(name || '').replace(/\s*·\s*/g, '·');
}

export function routeStepLabel(step, index) {
  const action = humanize(step.verb || step.action_id || 'Action');
  const params = Object.entries(step.paramsObj || {});
  const duration = params.find(([key]) => key === 'duration_ms')?.[1];
  if (action.toLowerCase() === 'wait' && duration !== undefined)
    return `${index + 1}. ${action} · ${duration} ms`;
  const formattedParams = params
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
  const target = step.target || formattedParams;
  return `${index + 1}. ${action}${target ? ` · ${target}` : ''}`;
}

export function routeOptionContent(edge, destination, status = null) {
  const steps = edge.steps || [];
  const sourceName = compactStateName(edge.srcRendition?.name || edge.src);
  const destinationName = compactStateName(edge.dstRendition?.name || destination || edge.dst);
  const staysOnState = edge.src === edge.dst || sourceName === destinationName;
  return [
    el('span', { class: 'route-main' },
      el('span', {
        class: 'route-action',
        'data-tip': edge.action || null,
        text: routeActionLabel(edge.action, staysOnState ? '·' : '→'),
      }),
      el('span', { class: 'route-transition' },
        el('span', {
          class: staysOnState ? 'route-state route-name' : 'route-state',
          text: sourceName,
        }),
        staysOnState ? null : [
          ' → ',
          el('span', { class: 'route-name', text: destinationName }),
        ])),
    el('span', { class: 'route-metrics' },
      metric('steps', String(steps.length)),
      metric('ms', edge.timed ? String(edge.measured_ms) : '—'),
      status),
    steps.length > 1
      ? el('span', { class: 'route-steps' },
        steps.map((step, index) => el('span', {
          class: 'route-step',
          text: routeStepLabel(step, index),
        })))
      : null,
  ];
}

export function routeOptions(edges, hrefForEdge = () => null) {
  return el('div', {
    class: 'element-route-options',
    role: 'list',
    'aria-label': 'Recorded route options',
  }, edges.map(edge => {
    const href = hrefForEdge(edge);
    return el(href ? 'a' : 'div', {
      class: 'element-route-option',
      role: 'listitem',
      ...(href ? {
        href,
        'aria-label': `Open destination state ${compactStateName(
          edge.dstRendition?.name || edge.dst,
        )}`,
      } : {}),
    }, routeOptionContent(edge, edge.dstRendition?.name || edge.dst));
  }));
}
