/* The ways an app can be driven, and which of them this map has evidence for.

   The five modes are ported from `mcp/src/cartographer/modes.py#MODES`, which
   takes them from android-driver's own per-action `modes:` declarations. They
   are not invented here: a mode this list knows about but the driver cannot
   drive would report coverage for routes nothing can execute.

   The distinction this file exists to keep is UNMEASURED versus UNREACHABLE.
   A mode nobody has driven is not a mode with no problems -- an unresearched
   gap that reads as a settled one stops anybody looking again. */

/* `label` is the short name a control shows; `note` is the long explanation,
   which belongs on the coverage page and not in a tooltip. */
export const MODES = [
  {
    name: 'touch', label: 'Touch', screenReader: false, focusDriven: false,
    note: 'points at a control; activation IS the tap, so there is nothing to focus first and this is the cheapest mode by construction',
  },
  {
    name: 'keyboard', label: 'Keyboard', screenReader: false, focusDriven: true,
    note: 'tab moves input focus, enter activates. Shift-tab is unbound, so reversing wraps forward',
  },
  {
    name: 'tb-touch', label: 'TalkBack Touch', screenReader: true, focusDriven: true,
    note: 'TalkBack driven by explore-by-touch: swipe right/left moves accessibility focus, double-tap activates',
  },
  {
    name: 'tb-gesture', label: 'TalkBack Gesture', screenReader: true, focusDriven: true,
    note: 'TalkBack driven by its own gesture set. The mode most screen-reader users are actually in',
  },
  {
    name: 'tb-keyboard', label: 'TalkBack Keyboard', screenReader: true, focusDriven: true,
    note: 'TalkBack with a physical keyboard. Shift-tab is unbound, so reversing wraps forward',
  },
];

/* A route is expensive when it costs a lot MORE than the same screen costs by
   touch -- a ratio, not an absolute, with a floor so a small jump stays quiet
   and a ceiling for when touch is bad too. Ported from `modes.py#Budget`. */
export const BUDGET = { ratio: 4, floor: 12, ceiling: 40 };

/* Which mode an edge requires, from its `requires` column.

   An empty `requires` means the route works in any configuration -- which for
   `nav` means the route predates the mode model and nothing recorded which
   modality walked it. Such a route counts as reachable but is credited to no
   mode, so it must not be read as evidence about one. */
export function modeOf(edge) {
  const m = /(?:^|;)\s*nav=([^;]+)/.exec(edge.requires || '');
  return m ? m[1].trim() : null;
}

/* Cheapest cost from the launch screen to every screen, over the routes one
   mode can actually walk. Dijkstra over `edge.cost`, which is the number of
   steps unless a run has timed the route. */
function reach(model, start, usable) {
  const best = new Map();
  if (!start) return best;
  best.set(start, 0);
  const seen = new Set();
  while (true) {
    let here = null;
    for (const [id, c] of best) if (!seen.has(id) && (here === null || c < best.get(here))) here = id;
    if (here === null) break;
    seen.add(here);
    for (const e of model.edges) {
      if (!usable(e)) continue;
      const from = e.srcRendition && e.srcRendition.screen;
      const to = e.dstRendition && e.dstRendition.screen;
      if (!from || !to || from.id !== here) continue;
      const next = best.get(here) + (e.cost || 1);
      if (!best.has(to.id) || next < best.get(to.id)) best.set(to.id, next);
    }
  }
  return best;
}

/* The (screen x mode) matrix this map supports, and what each cell means.

   `unmeasured` — no route has ever been recorded under this mode.
   `unreachable` — the mode has been driven, but nothing recorded reaches here.
   `expensive` — reachable, but dear against the same screen's touch cost.
   `reached` — reachable within budget. */
export function modeCoverage(model, startId) {
  const anyMode = new Set();
  for (const e of model.edges) {
    const m = modeOf(e);
    if (m) anyMode.add(m);
  }

  // Touch is the yardstick every other mode is measured against.
  const touchCost = reach(model, startId, e => {
    const m = modeOf(e);
    return m === 'touch' || m === null;
  });

  const rows = MODES.map(mode => {
    const measured = anyMode.has(mode.name);
    // A route with no declared mode is credited to none, so it cannot make an
    // undriven mode look driven.
    const costs = measured
      ? reach(model, startId, e => modeOf(e) === mode.name)
      : new Map();

    const cells = model.appScreens.map(s => {
      if (!measured) return { screen: s.id, status: 'unmeasured' };
      if (!costs.has(s.id)) {
        return { screen: s.id, status: 'unreachable', why: 'no recorded route reaches it under this mode' };
      }
      const cost = costs.get(s.id);
      const touch = touchCost.get(s.id);
      const ratio = touch ? cost / touch : null;
      const dear = (BUDGET.ceiling != null && cost > BUDGET.ceiling)
        || (cost >= BUDGET.floor && ratio !== null && ratio >= BUDGET.ratio);
      return {
        screen: s.id,
        status: dear ? 'expensive' : 'reached',
        cost,
        touch,
        why: dear
          ? `${cost} steps against ${touch} by touch${ratio ? `, ${ratio.toFixed(1)}× the touch cost` : ''}`
          : '',
      };
    });

    const count = (k) => cells.filter(c => c.status === k).length;
    return {
      mode,
      measured,
      cells,
      reached: count('reached'),
      expensive: count('expensive'),
      unreachable: count('unreachable'),
      total: measured ? cells.length : 0,
    };
  });

  return { rows, measured: [...anyMode].sort(), budget: BUDGET };
}
