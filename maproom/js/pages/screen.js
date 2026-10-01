/* Entry point for screen.html: one screen, named by the `id` query parameter. */
import { page, param, message } from '../page.js';
import { renderScreen } from '../views/screen.js';

page({
  current: 'map.html',
  render: state => {
    const id = param('id');
    if (!id) return message('No screen chosen', 'Open one from the map.');
    return renderScreen(state, id);
  },
});
