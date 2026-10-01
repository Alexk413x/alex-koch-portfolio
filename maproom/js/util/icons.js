/* The icon set: Material Symbols Rounded, loaded as a variable font.

   Every icon is a NAME, not a path. That is the point of the change -- a mark
   that reads badly is swapped by editing one string here, and no icon in this
   app is ever hand-drawn again.

   One fixed set of axes, applied in `.msym` in app.css and never varied per
   call: Rounded to match the round caps the rest of the design uses, FILL 0 for
   outlines, wght 400 against Red Hat Text's own weight, GRAD 0, opsz 24.

   `docs/report-design/Foundations.dc.html` still holds the old hand-drawn library.
   Until it is moved to the same font the canvas and this app draw different
   marks for the same name -- see the note at the end of this file. */

const NAMES = {
  // Chrome and navigation.
  gear: 'settings',
  search: 'search',
  close: 'close',
  plus: 'add',
  minus: 'remove',
  chevron: 'chevron_right',
  caret: 'expand_more',
  back: 'arrow_back',

  // Site theme.
  auto: 'contrast',
  sun: 'light_mode',
  moon: 'dark_mode',

  // The map's own controls.
  brightness: 'filter_center_focus',
  fit: 'fit_screen',

  // Subjects. `screen` is the generic phone, used where no device is in hand.
  screen: 'smartphone',
  route: 'route',

  // The platform's own handset, for the orientation pair: one glyph at two
  // angles rather than a portrait and a landscape mark.
  'phone-android': 'phone_android',
  'phone-ios': 'phone_iphone',
  'phone-web': 'computer',

  // The five driving modes, from `data/modes.js`. Material has no three-way
  // TalkBack distinction either, so the trio differs by how TalkBack is being
  // DRIVEN and the tooltip carries the screen reader. Swap any of these five
  // strings for another Material Symbols name to change the mark.
  touch: 'touch_app',
  keyboard: 'keyboard',
  // A pointing finger with a double tap, not a generic hand: explore-by-touch
  // moves focus by swiping and ACTIVATES with a double-tap, so this is the
  // mechanic rather than a picture of a hand.
  'tb-touch': 'touch_double',
  'tb-gesture': 'swipe_right',
  'tb-keyboard': 'keyboard_alt',
};

/* The three platform brands, which Material deliberately does not carry:
   `apple` and `chrome` are trademarks Google excludes, and there is no
   substitute that reads as the platform. These are the canvas library's own
   marks, copied from Foundations.dc.html unchanged -- same 16-unit grid, 1.6
   stroke, round caps, no fills. They are the ONLY hand-drawn icons left, and
   nothing may be added here that Material already has a name for. */
const BRANDS = {
  android: '<path d="M3.5 10a4.5 4.5 0 0 1 9 0v3.5h-9z"/><path d="M5.2 6.2L4 4.3M10.8 6.2L12 4.3"/><path d="M6.4 9h.01M9.6 9h.01"/>',
  apple: '<path d="M12.6 6.1c-.9-1.2-2.1-1.3-2.5-1.3-1.1 0-2 .6-2.4.6-.5 0-1.3-.6-2.2-.6C3.9 4.9 2.6 6.3 2.6 8.6c0 2.6 1.9 5.2 3.1 5.2.6 0 1.2-.5 2.1-.5.9 0 1.3.5 2.1.5 1.3 0 2.6-2.4 2.9-3.2-1.2-.5-1.9-1.5-1.9-2.7 0-1.1.6-1.7 1.7-1.8z"/><path d="M9.7 3.8c.5-.6.8-1.3.7-2-.7.1-1.4.5-1.8 1-.4.5-.8 1.2-.7 1.9.7 0 1.4-.4 1.8-.9z"/>',
  chrome: '<circle cx="8" cy="8" r="6.5"/><circle cx="8" cy="8" r="2.6"/><path d="M8 5.4h6.2M5.8 9.3L2.7 4M10.2 9.3l-3.1 5.4"/>',
};

/* One icon, sized in px.
   `title` becomes a tooltip, which is how a control with no label says what it
   does -- the standing rule is no labels on controls whose options are
   self-evident. A mode filter is the exception the tooltip exists for. */
export function icon(name, size = 16, title = '', rot = false) {
  if (BRANDS[name]) return brandIcon(name, size, title, rot);
  const glyph = NAMES[name];
  if (!glyph) throw new Error(`no icon named ${name}`);
  const node = document.createElement('span');
  node.className = rot ? 'msym rot' : 'msym';
  // The ligature name is the glyph. It must be the element's only text, with
  // no whitespace around it, or the font renders the fallback letters instead.
  node.textContent = glyph;
  node.style.fontSize = `${size}px`;
  node.setAttribute('aria-hidden', 'true');
  if (title) node.setAttribute('title', title);
  return node;
}

/* A brand mark as SVG, matching what `icon` returns for every other name.
   `createElement('path')` yields an HTMLUnknownElement that draws nothing, so
   the body is set through `innerHTML` in the SVG namespace. */
function brandIcon(name, size, title, rot) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', rot ? 'brand rot' : 'brand');
  svg.innerHTML = BRANDS[name];
  if (title) svg.setAttribute('title', title);
  return svg;
}

/* The phone to draw for a device profile's platform.
   An unrecorded platform gets the generic handset rather than Android's: a
   guess that happens to be right most of the time is still a guess. */
export function platformIcon(platform) {
  const p = String(platform || '').toLowerCase();
  if (p === 'ios' || p === 'iphone' || p === 'ipados') return 'apple';
  if (p === 'android') return 'android';
  if (p === 'web' || p === 'chrome') return 'chrome';
  return 'screen';
}

/* The handset for a platform, which is a different question from its brand:
   the orientation pair draws a device, the platform filter draws a logo. */
export function phoneIcon(platform) {
  const p = String(platform || '').toLowerCase();
  if (p === 'apple' || p === 'ios') return 'phone-ios';
  if (p === 'chrome' || p === 'web') return 'phone-web';
  if (p === 'android') return 'phone-android';
  return 'screen';
}
