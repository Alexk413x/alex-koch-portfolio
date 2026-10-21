import { el } from './dom.js';

export function segmentedGroup(options, {
  isSelected,
  onChange,
  allowNone = false,
  multiple = false,
  label = '',
  className = '',
  buttonClassName = '',
} = {}) {
  const group = el('div', {
    class: ['seg', className].filter(Boolean).join(' '),
    'data-scope': 'group',
    role: label ? 'group' : null,
    'aria-label': label || null,
  });
  const buttons = options.map(option => {
    const button = el('button', {
      class: [
        buttonClassName,
        option.off ? 'off' : '',
        isSelected(option.value) ? 'on' : '',
      ].filter(Boolean).join(' '),
      type: 'button',
      'data-value': String(option.value),
      'data-tip': option.title,
      'aria-label': option.label || option.title,
      'aria-pressed': String(isSelected(option.value)),
      onclick: option.off ? null : () => {
        const selected = isSelected(option.value);
        if (multiple) onChange(option.value, selected);
        else onChange(allowNone && selected ? null : option.value);
        paint();
      },
    }, option.content);
    for (const [name, value] of Object.entries(option.attributes || {})) {
      button.setAttribute(name, value);
    }
    return button;
  });

  function paint() {
    options.forEach((option, index) => {
      const selected = isSelected(option.value);
      buttons[index].classList.toggle('on', selected);
      buttons[index].setAttribute('aria-pressed', String(selected));
    });
  }

  group.append(...buttons);
  return group;
}

export function iconToggle(options, {
  value,
  onChange,
  label = '',
  className = '',
} = {}) {
  const [first, second] = options;
  let selectedValue = value;
  const indicator = el('span', {
    class: 'seg-icon-toggle-indicator',
    'aria-hidden': 'true',
  });
  const button = el('button', {
    class: ['seg', 'seg-icon-toggle', className].filter(Boolean).join(' '),
    type: 'button',
    role: 'switch',
    'aria-label': label,
    onclick: () => {
      selectedValue = selectedValue === first.value ? second.value : first.value;
      paint();
      onChange(selectedValue);
    },
  }, el('span', {
    class: 'seg-icon-toggle-track',
    'aria-hidden': 'true',
  },
  el('span', { class: 'seg-icon-toggle-option' }, first.content),
  el('span', { class: 'seg-icon-toggle-option' }, second.content),
  indicator));

  function paint() {
    const isSecondSelected = selectedValue === second.value;
    button.setAttribute('aria-checked', String(isSecondSelected));
    button.setAttribute('data-value', String(selectedValue));
    button.setAttribute('data-tip', isSecondSelected ? first.title : second.title);
    indicator.classList.toggle('right', isSecondSelected);
  }

  paint();
  return button;
}
