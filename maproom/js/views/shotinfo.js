/* The info a screenshot carries on the map: the name of what it shows along the top and the number
   of states it stands for in the centre, both clear until the picture is hovered or focused.

   Every card that draws a screenshot (a screen's, a substate's, the group outside the app) places
   `shotInfo` right after its picture element and gives that element `shotFocus`. One rule in
   app.css shows the info for `<picture>:hover + .sinfo` and `<picture>:focus-visible + .sinfo`, and
   the info takes no press, so the picture keeps its own click. */
import { el } from '../util/dom.js';

const statesText = n => `${n} ${n === 1 ? 'state' : 'states'}`;

export function shotLabel(name, count) {
  return `${name}, ${statesText(count)}`;
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
