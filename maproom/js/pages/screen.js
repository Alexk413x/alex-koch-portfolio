/* Entry point for screen.html: one screen, named by the `id` query parameter. */
import { page, param } from '../page.js';
import { renderScreen } from '../views/screen.js';

page({
  current: 'map.html',
  showHealth: false,
  render: state => renderScreen(state, param('id')),
});
