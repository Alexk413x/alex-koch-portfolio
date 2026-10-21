/* Entry point for index.html: the health screen.

   Every survey reads its baseline and manifest, so its health uses the same
   evidence and remembered configuration as its map. Failed reads stay visible. */
import { page } from '../page.js';
import { readManifest } from '../data/sources.js';
import { renderSources } from '../views/sources.js';
import { loadBaseline } from '../data/baseline.js';

page({
  current: '',
  needsBaseline: false,
  render: async state => {
    const manifests = new Map();
    const models = new Map();
    const errors = new Map();
    await Promise.all(state.sources.map(async s => {
      try {
        const manifest = await readManifest(s);
        manifests.set(s.id, manifest);
        if (s.has_graph && manifest.graph) {
          const model = await loadBaseline(s.url + manifest.graph);
          if (!model.schemaOk) throw new Error(`Unsupported baseline schema: ${model.schema}`);
          models.set(s.id, model);
        }
      } catch (error) {
        errors.set(s.id, error.message || String(error));
      }
    }));
    return renderSources(state, manifests, models, errors);
  },
});
