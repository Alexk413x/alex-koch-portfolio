/* Entry point for coverage.html: axis values by screen. */
import { page } from '../page.js';
import { renderCoverage } from '../views/coverage.js';

page({ current: 'coverage.html', render: renderCoverage });
