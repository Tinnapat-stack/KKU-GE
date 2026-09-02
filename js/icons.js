// Line icons drawn on a 24 unit grid with a 2 unit stroke, round caps and joins.
// They inherit colour through currentColor, so the existing active and inactive
// tab rules keep working without extra CSS.
//
// Drawn here rather than pulled from an icon library: no dependency, no build
// step, no licence to carry, and the whole set stays visually consistent.

const svg = (paths, { size = 24, fill = 'none' } = {}) =>
  `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" ` +
  `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
  `aria-hidden="true" focusable="false">${paths}</svg>`;

export const ICONS = {
  // House with a chimney-free roofline, kept simple so it reads at 18px.
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-5.5h5V20"/>'),

  // Wallet carrying a plus, so the entry tab reads as "add a record" rather than
  // duplicating the plain wallet icon used in the account summary.
  entry: svg('<path d="M3 8A2.5 2.5 0 0 1 5.5 5.5h11V8"/><path d="M3 8v9.5A2.5 2.5 0 0 0 5.5 20h13a2.5 2.5 0 0 0 2.5-2.5V13"/><path d="M17.5 5v6"/><path d="M14.5 8h6"/>'),

  // Ascending bars for the statistics page.
  analytics: svg('<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8.5 20v-6"/><path d="M13 20V9.5"/><path d="M17.5 20v-9"/>'),

  // Concentric target for savings goals and budgets.
  plan: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>'),

  // Brand mark: a coin carrying the baht stroke.
  brand: svg('<circle cx="12" cy="12" r="9"/><path d="M10 7.5v9"/><path d="M10 7.5h3a2.25 2.25 0 0 1 0 4.5h-3"/><path d="M10 12h3.4a2.25 2.25 0 0 1 0 4.5H10"/><path d="M12 5.5v13"/>'),

  // Supporting icons used on the Home page and in alerts.
  wallet: svg('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M16.5 14.5h1.5"/>'),
  gauge: svg('<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-4.5"/>'),
  file: svg('<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5Z"/><path d="M13.5 3v5.5H19"/>'),
  flame: svg('<path d="M12 3s5 4.2 5 9a5 5 0 0 1-10 0c0-1.7.8-3.2 1.6-4.2.3 1 1 1.9 1.9 2.2C11 8.4 11.4 5.6 12 3Z"/>'),
  alert: svg('<path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/>'),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.7 2.7L16 9.5"/>'),
};

// Drops an icon into every element carrying data-icon="<name>".
export function renderIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    const markup = ICONS[el.dataset.icon];
    if (markup) el.innerHTML = markup;
  }
}
