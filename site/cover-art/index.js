/* index.js — the seventeen covers, keyed by the id of the record each one belongs to.
 *
 * KEYED BY PRODUCT, NOT BY DOMAIN. One wireframe motif per domain hands three products the same picture.
 * Every product has its own drawing, so the key is the product's own record id — the same `pf-*` the spine's
 * aria-controls points at. A cover and its record cannot drift apart, because there is only one name for the
 * pair.
 *
 * The lockup is NOT here. Kicker, title, tagline, company and years are HTML over the top of this, so the title
 * stays selectable and reflows at blade size. See buildCover in catalog.js.
 *
 * THESE MODULES ARE THE SOURCE. They were first derived mechanically from the hand-authored SVG in the design
 * artifact, but they have been edited since — self.js and rexel.js draw their grids from a table now, which the
 * derivation cannot produce. Re-deriving would silently undo that. Art direction still happens in the artifact;
 * bringing a change across is a hand edit to the one module, not a regeneration of all seventeen.
 */

import { node, rect, pt } from './kit.js';

import qaai from './qaai.js';
import mail from './mail.js';
import sc from './sc.js';
import myday from './myday.js';
import self from './self.js';
import pick from './pick.js';
import isu from './isu.js';
import oro from './oro.js';
import merch from './merch.js';
import fv from './fv.js';
import team from './team.js';
import tab from './tab.js';
import house from './house.js';
import rexel from './rexel.js';
import calling123 from './calling123.js';
import kiosk from './kiosk.js';
import ink from './ink.js';

export const COVERS = {
  'pf-qaai': qaai,
  'pf-mail': mail,
  'pf-sc': sc,
  'pf-myday': myday,
  'pf-self': self,
  'pf-pick': pick,
  'pf-isu': isu,
  'pf-oro': oro,
  'pf-merch': merch,
  'pf-fv': fv,
  'pf-team': team,
  'pf-tab': tab,
  'pf-house': house,
  'pf-rexel': rexel,
  'pf-123': calling123,
  'pf-kiosk': kiosk,
  'pf-ink': ink
};

/* THE ARTWORK'S FRAME IS THE BOX'S FRAME. Every cover is composed on 300x400 with the art centerd on y=237 —
   the midpoint between the tagline's ink and the foot text — so the covers line up as a set only if they are
   all drawn into the same box at the same scale. preserveAspectRatio stays at the default: letterboxing one
   cover to fit a differently-proportioned face would move its center and break the set.
   Returns null for an unknown id so a record without a cover degrades to no art rather than to a broken box. */
export function coverArt(id) {
  const draw = COVERS[id];
  if (!draw) return null;
  const svg = node('svg', {
    viewBox: '0 0 300 400',
    class: 'cover-art',
    'aria-hidden': 'true',
    focusable: 'false'
  });
  const g = node('g', {});
  /* THE BOX'S OWN FACE. A cover is print on --ink-deep, not a drawing floating on whatever is behind it: the
     display case is see-through by design, and without a ground the back face's copy reads through the art. */
  rect(g, 0, 0, 300, 400, pt('knock'));
  draw(g);
  svg.appendChild(g);
  return svg;
}
