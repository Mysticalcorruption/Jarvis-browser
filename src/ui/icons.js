window.JarvisIcons = {
  file: '<path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', square: '<rect x="6" y="6" width="12" height="12" rx="1"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  'arrow-left': '<path d="M19 12H5m7-7-7 7 7 7"/>', 'arrow-right': '<path d="M5 12h14m-7-7 7 7-7 7"/>', 'arrow-up': '<path d="M12 19V5m-7 7 7-7 7 7"/>', 'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>',
  'chevron-up': '<path d="m6 15 6-6 6 6"/>', 'chevron-down': '<path d="m6 9 6 6 6-6"/>', chevrons: '<path d="m8 8 4-4 4 4m-8 8 4 4 4-4"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>', shield: '<path d="m12 3 8 3v5c0 5-8 10-8 10S4 16 4 11V6l8-3Z"/><path d="m8.5 11.5 2.5 2.5 4.5-5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>', bookmark: '<path d="M6 4h12v17l-6-4-6 4V4Z"/>',
  home: '<path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9"/>', history: '<path d="M3 4v5h5M3 9a9 9 0 1 1 0 7M12 7v5l3 2"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  settings: '<path d="m10 3-.7 2.2-2 .9L5 5.5 3 9l1.6 1.7v2.6L3 15l2 3.5 2.3-.6 2 .9.7 2.2h4l.7-2.2 2-.9 2.3.6 2-3.5-1.6-1.7v-2.6L21 9l-2-3.5-2.3.6-2-.9L14 3h-4Z"/><circle cx="12" cy="12" r="3"/>',
  sparkles: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3ZM20 2v4m-2-2h4"/>',
  scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8M8 12h8M8 16h5"/>', globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="11" ry="5" transform="rotate(-35 12 12)"/><path d="m5 4 1 1m12 14 1 1"/>', bulb: '<path d="M9 18h6M9 21h6M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z"/>',
  'message-plus': '<path d="M21 11V4H3v16l4-4h8M19 15v6m-3-3h6M7 8h9M7 12h5"/>', link: '<path d="m10 13 4-4M8 15l-2 2a3.5 3.5 0 0 1-5-5l5-5a3.5 3.5 0 0 1 5 0m2 2 2-2a3.5 3.5 0 0 1 5 5l-5 5a3.5 3.5 0 0 1-5 0" transform="translate(1 -1)"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>', volume: '<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  command: '<path d="M8 8h8v8H8V8Zm0 0H5a3 3 0 1 1 3-3v3Zm8 0V5a3 3 0 1 1 3 3h-3Zm0 8h3a3 3 0 1 1-3 3v-3Zm-8 0v3a3 3 0 1 1-3-3h3Z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>', check: '<path d="m5 12 4 4L19 6"/>', folder: '<path d="M3 6h7l2 2h9v12H3V6Z"/>', trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
};
window.icon = (name, cls = '') => `<svg class="icon ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${window.JarvisIcons[name] || window.JarvisIcons.globe}</svg>`;
window.renderIcons = (root = document) => root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = window.icon(el.dataset.icon); });
