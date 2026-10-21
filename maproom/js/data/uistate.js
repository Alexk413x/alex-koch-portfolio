/* Read Android's raw UI hierarchy in paint order and keep its coordinate space. */

function boundsOf(value) {
  const match = /^\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]$/.exec(value || '');
  if (!match) return null;
  const bounds = match.slice(1).map(Number);
  return bounds[2] > bounds[0] && bounds[3] > bounds[1] ? bounds : null;
}

function orderedChildren(element) {
  const children = [...element.children].filter(child => child.localName === 'node');
  if (!children.every(child => {
    const value = child.getAttribute('drawing-order');
    return value !== null && value.trim() !== '' && Number.isFinite(Number(value));
  })) {
    return children;
  }
  return children
    .map((child, index) => ({ child, index, order: Number(child.getAttribute('drawing-order')) }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(entry => entry.child);
}

function viewportOf(roots, elements) {
  const bounds = roots.map(root => boundsOf(root.getAttribute('bounds'))).find(Boolean);
  if (bounds) return bounds;
  const placed = elements.filter(node => node.bounds).map(node => node.bounds);
  if (!placed.length) return null;
  return [
    Math.min(...placed.map(box => box[0])),
    Math.min(...placed.map(box => box[1])),
    Math.max(...placed.map(box => box[2])),
    Math.max(...placed.map(box => box[3])),
  ];
}

function simpleClassName(element) {
  return (element.getAttribute('class') || '').split('.').pop().trim() || 'view';
}

export function parseUiTree(source) {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The raw UI tree is not valid XML.');

  const container = document.documentElement;
  const roots = container.localName === 'node'
    ? [container]
    : [...container.children].filter(child => child.localName === 'node');
  const elements = [];
  const nodesByElement = new Map();

  function visit(element, depth) {
    const order = elements.length;
    const flag = name => element.getAttribute(name) === 'true';
    const className = element.getAttribute('class') || '';
    const simpleClass = simpleClassName(element);
    const interactiveClass = /(?:button|checkbox|switch|radiobutton|togglebutton|edittext|autocompletetextview|textinput)$/i
      .test(simpleClass);
    const text = element.getAttribute('text') || '';
    const description = element.getAttribute('content-desc') || '';
    const stateDescription = element.getAttribute('state-desc') || '';
    const node = {
      id: String(order),
      order,
      depth,
      index: element.getAttribute('index') || '',
      className: element.getAttribute('class') || '',
      attributes: [...element.attributes].map(attribute => ({
        key: attribute.name,
        value: attribute.value,
      })),
      resourceId: element.getAttribute('resource-id') || '',
      text,
      description,
      stateDescription,
      interactive: interactiveClass
        || ['clickable', 'long-clickable', 'focusable', 'checkable', 'editable', 'scrollable']
          .some(flag),
      inState: null,
      bounds: boundsOf(element.getAttribute('bounds')),
      type: simpleClass,
    };
    elements.push(node);
    nodesByElement.set(element, node);
    for (const child of orderedChildren(element)) visit(child, depth + 1);
  }

  for (const root of roots) visit(root, 0);

  const identityElements = [];
  function recordIdentityOrder(element, parentId = null) {
    const node = nodesByElement.get(element);
    node.parentId = parentId;
    node.identityOrder = identityElements.length;
    identityElements.push(node);
    const children = [...element.children].filter(child => child.localName === 'node');
    node.identityChildren = children.map(child => nodesByElement.get(child).id);
    children.forEach(child => recordIdentityOrder(child, node.id));
  }
  roots.forEach(root => recordIdentityOrder(root));

  return { elements, identityElements, viewport: viewportOf(roots, elements) };
}

function nodeAttributes(node) {
  return new Map(node.attributes.map(({ key, value }) => [key, value]));
}

function isCollection(node, attrs) {
  return Boolean((attrs.get('collection-rows') || '').trim()
    || (attrs.get('collection-cols') || '').trim()
    || attrs.get('scrollable') === 'true');
}

function simpleClass(node) {
  return (node.className || '').split('.').pop().trim();
}

function normalizedNodes(source) {
  const result = [];
  const stack = [];
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (indent % 2) return null;
    const body = line.trim();
    const depth = indent / 2;
    if (/^(?:check|selected)\s/.test(body)) {
      const parent = stack[stack.length - 1];
      if (!parent || depth !== parent.depth + 1) return null;
      const check = /^check desc="(.*)" (on|off)$/.exec(body);
      const selected = /^selected desc="(.*)"$/.exec(body);
      if (!check && !selected) return null;
      result[parent.index].choices.push(check
        ? { kind: 'check', label: check[1], value: check[2] }
        : { kind: 'selected', label: selected[1], value: '' });
      continue;
    }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const first = body.split(/\s+/, 1)[0];
    const className = /^(?:desc|text|hint)=|^(?:clickable|long-clickable|focusable|checkable|editable|password)\b|^state:/.test(first)
      ? ''
      : first.split('.').pop();
    const index = result.length;
    result.push({
      depth,
      className,
      parentIndex: stack.length ? stack[stack.length - 1].index : null,
      choices: [],
    });
    stack.push({ depth, index });
  }
  return result;
}

function progressExclusions(tree) {
  const byId = new Map(tree.identityElements.map(node => [node.id, node]));
  const excluded = new Set();
  const operable = ['clickable', 'long-clickable', 'checkable', 'scrollable', 'focusable'];
  const chromeIds = new Set(['android:id/navigationBarBackground', 'android:id/statusBarBackground']);

  const markSubtree = node => {
    excluded.add(node.id);
    node.identityChildren.forEach(id => markSubtree(byId.get(id)));
  };

  function visit(node) {
    const attrs = nodeAttributes(node);
    const children = node.identityChildren.map(id => byId.get(id));
    if (chromeIds.has((attrs.get('resource-id') || '').trim())) {
      markSubtree(node);
      return false;
    }
    const isProgress = simpleClass(node) === 'ProgressBar'
      && !operable.some(name => attrs.get(name) === 'true');
    if (isProgress) {
      markSubtree(node);
      return true;
    }
    const childrenGone = children.map(visit);
    const holder = children.length > 0 && childrenGone.every(Boolean)
      && !['text', 'content-desc', 'hint'].some(name => (attrs.get(name) || '').trim())
      && !operable.some(name => attrs.get(name) === 'true')
      && !['checked', 'selected'].some(name => attrs.get(name) === 'true');
    if (holder) excluded.add(node.id);
    return holder;
  }

  tree.identityElements.filter(node => node.parentId === null).forEach(visit);
  return excluded;
}

function collectionChoices(node, byId, choices, inState) {
  const candidates = [];
  const labelOf = item => {
    const attrs = nodeAttributes(item);
    const own = ['content-desc', 'text', 'hint']
      .map(name => (attrs.get(name) || '').trim())
      .find(Boolean);
    if (own) return own.replace(/\s+/g, ' ');
    for (const childId of item.identityChildren) {
      const label = labelOf(byId.get(childId));
      if (label) return label;
    }
    return '';
  };
  const isChoice = item => simpleClass(item) === 'RadioButton'
    || item.identityChildren.some(id => isChoice(byId.get(id)));

  function walk(item) {
    const attrs = nodeAttributes(item);
    const children = item.identityChildren.map(id => byId.get(id));
    const checkable = attrs.get('checkable') === 'true';
    const selected = attrs.get('selected') === 'true';
    if (selected || (checkable && (attrs.get('checked') === 'true' || !isChoice(item)))) {
      candidates.push({
        id: item.id,
        kind: checkable ? 'check' : 'selected',
        label: labelOf(item),
        value: checkable ? (attrs.get('checked') === 'true' ? 'on' : 'off') : '',
      });
    }
    children.forEach(walk);
  }
  node.identityChildren.forEach(id => walk(byId.get(id)));

  const unmatched = [...candidates];
  for (const choice of choices) {
    const index = unmatched.findIndex(candidate => candidate.kind === choice.kind
      && candidate.value === choice.value
      && (choice.label === '<volatile>' || candidate.label === choice.label));
    if (index < 0) return false;
    inState.add(unmatched[index].id);
    unmatched.splice(index, 1);
  }
  return unmatched.length === 0;
}

export function matchStateElements(tree, normalizedText) {
  // The normalized text keeps class and hierarchy, so align raw nodes by parent and sibling order.
  const descriptors = normalizedNodes(normalizedText);
  if (!descriptors?.length) {
    tree.stateMatchAvailable = false;
    tree.stateMatchError = 'The normalized UI state has no matchable elements.';
    return false;
  }

  const byId = new Map(tree.identityElements.map(node => [node.id, node]));
  const excluded = progressExclusions(tree);
  const included = new Set();
  const matched = new Map();
  const siblingCursors = new Map();
  const roots = tree.identityElements.filter(node => node.parentId === null);
  for (const [index, descriptor] of descriptors.entries()) {
    const parent = descriptor.parentIndex === null
      ? null
      : byId.get(matched.get(descriptor.parentIndex));
    if (descriptor.parentIndex !== null && !parent) {
      tree.stateMatchAvailable = false;
      tree.stateMatchError = 'The normalized UI state does not match the raw tree hierarchy.';
      return false;
    }
    const siblingKey = parent ? parent.id : 'root';
    const siblings = parent
      ? parent.identityChildren.map(id => byId.get(id))
      : roots;
    let cursor = siblingCursors.get(siblingKey) || 0;
    let match = null;
    while (cursor < siblings.length) {
      const candidate = siblings[cursor++];
      if (excluded.has(candidate.id)) continue;
      if (candidate.depth === descriptor.depth && simpleClass(candidate) === descriptor.className) {
        match = candidate;
        break;
      }
    }
    siblingCursors.set(siblingKey, cursor);
    if (!match) {
      tree.stateMatchAvailable = false;
      tree.stateMatchError = 'The normalized UI state does not match the raw tree hierarchy.';
      return false;
    }
    matched.set(index, match.id);
    included.add(match.id);
    if (isCollection(match, nodeAttributes(match))) {
      if (!collectionChoices(match, byId, descriptor.choices, included)) {
        tree.stateMatchAvailable = false;
        tree.stateMatchError = 'The normalized collection state does not match the raw tree.';
        return false;
      }
    } else if (descriptor.choices.length) {
      tree.stateMatchAvailable = false;
      tree.stateMatchError = 'The normalized collection state does not match the raw tree.';
      return false;
    }
  }

  for (const node of tree.elements) node.inState = included.has(node.id);
  tree.stateMatchAvailable = true;
  tree.stateMatchError = '';
  return true;
}
