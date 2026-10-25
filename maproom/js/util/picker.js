import { el } from './dom.js';
import { icon } from './icons.js';

let nextId = 0;

/* A single-choice picker shared by capture locales and searchable run lists. */
export function picker(label, options, current, onPick, { search = '' } = {}) {
  const dd = el('div', { class: 'dd' });
  const id = `picker-${++nextId}`;
  let outside = null;
  function close(restoreFocus = false) {
    drop.hidden = true;
    dd.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
    outside?.abort();
    outside = null;
    if (restoreFocus) button.focus();
  }
  const rows = options.map(option => {
    const noteText = typeof option.note === 'string' ? option.note : option.note?.textContent || '';
    const row = el('button', {
      type: 'button', role: 'option', class: `picker-option${option.value === current ? ' on' : ''}`,
      'aria-selected': String(option.value === current),
      'aria-label': option.ariaLabel,
      tabindex: -1,
      onclick: () => {
        close(true);
        onPick(option.value);
      },
    }, el('span', { class: 'picker-option-label', text: option.label }),
    option.note ? el('span', { class: 'picker-option-note' }, option.note) : null);
    row.dataset.find = `${option.label} ${noteText} ${option.searchText || ''}`.toLowerCase();
    return row;
  });
  const none = el('div', { class: 'dnone', role: 'status', text: `No ${label} matches` });
  none.hidden = true;
  const list = el('div', { class: 'dlist', id, role: 'listbox', 'aria-label': label }, rows);
  function focusRow(row) {
    if (!row) return;
    for (const option of rows) option.tabIndex = option === row ? 0 : -1;
    row.focus();
  }
  const find = search ? el('input', {
    class: 'dsearch', type: 'search', placeholder: search, 'aria-label': search,
    'aria-controls': id,
    oninput: () => {
      const query = find.value.trim().toLowerCase();
      for (const row of rows) row.hidden = !row.dataset.find.includes(query);
      none.hidden = rows.some(row => !row.hidden);
      const tabStop = rows.find(row => !row.hidden && row.getAttribute('aria-selected') === 'true')
        || rows.find(row => !row.hidden);
      for (const row of rows) row.tabIndex = row === tabStop ? 0 : -1;
    },
    onkeydown: event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        rows.find(row => !row.hidden)?.click();
      }
    },
  }) : null;
  const drop = el('div', { class: 'drop', 'data-scope': 'group' }, find, list, none);
  drop.hidden = true;
  function open() {
    drop.hidden = false;
    dd.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    if (find) {
      find.value = '';
      find.dispatchEvent(new Event('input'));
    }
    list.scrollTop = 0;
    const selectedRow = rows.find(row => row.getAttribute('aria-selected') === 'true') || rows[0];
    for (const row of rows) row.tabIndex = row === selectedRow ? 0 : -1;
    if (find) find.focus();
    else focusRow(selectedRow);
    outside = new AbortController();
    document.addEventListener('pointerdown', event => {
      if (!dd.contains(event.target)) close();
    }, { signal: outside.signal });
  }
  const selected = options.find(option => option.value === current);
  const button = el('button', {
    type: 'button', 'data-tip': label, 'aria-label': `Choose ${label}: ${selected?.label || current || 'none'}`,
    'aria-haspopup': 'listbox', 'aria-controls': id, 'aria-expanded': 'false',
    onclick: () => drop.hidden ? open() : close(),
  }, el('span', { class: 'k', text: label }), selected?.label || current || 'none', icon('caret', 12));
  dd.append(button, drop);
  dd.addEventListener('focusout', event => {
    if (!dd.contains(event.relatedTarget)) close();
  });
  dd.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !drop.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target === find && !event.key.startsWith('Arrow')) return;
    event.preventDefault();
    if (drop.hidden) { open(); return; }
    const visible = rows.filter(row => !row.hidden);
    if (!visible.length) return;
    const index = visible.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
      : index < 0 ? (event.key === 'ArrowDown' ? 0 : visible.length - 1)
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
    focusRow(visible[next]);
  });
  return dd;
}
