/* The info a screenshot carries on the map: the name of what it shows along the top and the number
   of states it stands for in the centre, both clear until the picture is hovered or focused.

   Every card that draws a screenshot (a screen's, a substate's, the group outside the app) uses
   `shotSurface` for its picture, activation and info. One rule in app.css shows
   the info while the picture or its substate footer is hovered or focused, and the info takes no
   press, so the picture keeps its own click. */
import { el } from '../util/dom.js';

const statesText = n => `${n} ${n === 1 ? 'state' : 'states'}`;

export function shotLabel(name, count) {
  return `${name}, ${statesText(count)}`;
}

export function setShotChildren(picture, content) {
  picture.replaceChildren(content, picture.querySelector('.shot-border'));
}

export function shotSurface(kind, name, count, press) {
  const picture = el('div', { class: `${kind} map-shot` });
  const border = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  border.setAttribute('class', 'shot-border');
  border.setAttribute('aria-hidden', 'true');
  const outline = document.createElementNS(border.namespaceURI, 'rect');
  outline.setAttribute('width', '100%');
  outline.setAttribute('height', '100%');
  outline.setAttribute('pathLength', '1');
  border.append(outline);
  picture.append(border);
  shotFocus(picture, shotLabel(name, count), press);
  picture.addEventListener('click', e => {
    e.stopPropagation();
    press();
  });
  return { picture, info: shotInfo(name, count) };
}

export function shotInfo(name, count) {
  return el('span', { class: 'sinfo', 'aria-hidden': 'true' },
    el('span', { class: 'sname', text: name }),
    el('span', { class: 'scount', text: String(count) }));
}

export function setShotInfo(info, name, count) {
  info.querySelector('.sname').textContent = name;
  info.querySelector('.scount').textContent = String(count);
}

/* Make a picture element reachable by keyboard: Tab focuses it, which shows its info, and Enter or
   Space presses it. */
export function shotFocus(picture, label, press) {
  picture.setAttribute('tabindex', '0');
  picture.setAttribute('role', 'button');
  picture.setAttribute('aria-label', label);
  picture.addEventListener('keydown', (e) => {
    if (e.target !== picture || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    press();
  });
}
