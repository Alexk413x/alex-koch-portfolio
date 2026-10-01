/* Entry point for runs.html: one run at a time, picked from the dropdown.

   `?id=<run>` selects it, so a reload and a shared link both land on the same
   run. The artboard has one runs page with a dropdown rather than a list and a
   detail page, so there is no separate run.html. */
import { page, param } from '../page.js';
import { renderRuns } from '../views/runs.js';

page({ current: 'runs.html', needsModel: false, render: state => renderRuns(state, param('id')) });
