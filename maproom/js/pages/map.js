/* Entry point for map.html: the screen-flow map, of the baseline or, with `?run=<id>`,
   of one run's built map aligned to the baseline. A run draws with no baseline at all. */
import { page, param, message } from '../page.js';
import { renderMap } from '../views/map.js';
import { loadRunMap } from '../data/runmap.js';

const run = param('run');

page({
  current: run ? 'runs.html' : 'map.html',
  needsModel: !run,
  render: async (state) => {
    if (!run) return renderMap(state);
    const loaded = await loadRunMap(state, run);
    if (!loaded.model) {
      return message('This run has no built map', (loaded.view.basis || {}).note || '', run);
    }
    return renderMap({ ...state, model: loaded.model, captures: loaded.captures,
      run: { id: run, view: loaded.view } });
  },
});
