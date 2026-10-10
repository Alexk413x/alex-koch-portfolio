/* Entry point for index.html: the health screen.

   Each source's manifest is read here rather than in the view, because the row
   figures come from the folder tree and a row cannot be drawn before its
   folder has been walked. A source whose manifest fails is still listed. */
import { page } from '../page.js';
import { readManifest } from '../data/sources.js';
import { renderSources } from '../views/sources.js';

page({
  current: '',
  needsBaseline: false,
  render: async state => {
    const manifests = new Map();
    await Promise.all(state.sources.map(async s => {
      try {
        manifests.set(s.id, await readManifest(s));
      } catch {
        manifests.set(s.id, null);
      }
    }));
    return renderSources(state, manifests);
  },
});
