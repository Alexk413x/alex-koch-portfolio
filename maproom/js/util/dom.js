/* Element construction, kept to one function so views read as their own markup. */

/* Build an element from a tag, a props object and children.
   `class`, `text` and `on<Event>` are handled by name; anything else is set as
   an attribute, so a view can write `data-press` without a helper.

   There is deliberately no `html` prop. Every string this app renders comes out
   of a device's accessibility tree or an app's own resources -- labels, summaries,
   step params -- and none of it is trusted markup. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  // Fully flattened: a view that maps a list to [dt, dd] pairs produces nested
  // arrays, and a single-level flat leaves them to stringify as [object Object].
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/* Replace an element's children, dropping the empties.

   `Node.replaceChildren(null)` does NOT skip the null -- it stringifies it and
   inserts a text node reading "null". Views build children with conditionals
   that yield null all the time, so every replace goes through here. */
export function setChildren(node, ...children) {
  node.replaceChildren(...children.flat(Infinity)
    .filter(c => c !== null && c !== undefined && c !== false)
    .map(c => (c instanceof Node ? c : document.createTextNode(String(c)))));
  return node;
}

/* Replace an element's children in one operation. */
export function fill(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false));
  return node;
}

/* An SVG element, which `el` cannot build.
   SVG lives in its own namespace: `document.createElement('path')` produces an
   HTMLUnknownElement that renders nothing at all, with no error to say why. */
export function svgEl(tag, props = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
