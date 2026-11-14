// 界面装饰：不包含盲盒数值。新系列会自动获得配色与包装。
const themes = [
  { key: 'food', tone: '#f5e4db', ink: '#b67961', soft: '#fcece3', label: 'A LITTLE COMFORT' },
  { key: 'animal', tone: '#e9e3f4', ink: '#8974ac', soft: '#f3edf9', label: 'YOUR LITTLE FRIEND' },
  { key: 'appliance', tone: '#e2eee6', ink: '#658d78', soft: '#edf5ef', label: 'SOMETHING UNEXPECTED' },
  { key: 'frog', tone: '#f2edce', ink: '#9e9460', soft: '#faf7e7', label: 'SMALL & LOVELY' },
];
export function hash(text) {
  let value = 2166136261;
  for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}
export function seriesTheme(series, index = 0) {
  const text = `${series.id} ${series.name}`;
  if (/snack|food|食堂/i.test(text)) return themes[0];
  if (/animal|动物/i.test(text)) return themes[1];
  if (/appliance|家电/i.test(text)) return themes[2];
  if (/frog|奶蛙/i.test(text)) return themes[3];
  return themes[(hash(series.id) + index) % themes.length];
}
const shapes = {
  box: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',
  shop: '<path d="M4 10v10h16V10M3 10l2-7h14l2 7M3 10c0 4 4 4 4 0 0 4 5 4 5 0 0 4 5 4 5 0 0 4 4 4 4 0M9 20v-6h6v6"/>',
  storage: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 5V3h8v2M3 11h18M9 15h6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 8.5h-3a2 2 0 0 0 0 4h1a2 2 0 0 1 0 4h-3M12 6.5v12"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  refresh: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  sparkle: '<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5.8-1.5 1.5-1.5 2M12 17h.01"/>',
  trophy: '<path d="M7 3h10v6a5 5 0 0 1-10 0V3ZM7 5H3v3a4 4 0 0 0 5 4M17 5h4v3a4 4 0 0 1-5 4M12 14v5M8 21h8"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
};
export function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.box}</svg>`;
}
function mascot(key) {
  const eyes = '<ellipse cx="-12" cy="0" rx="3" ry="3.6" fill="#465449"/><ellipse cx="12" cy="0" rx="3" ry="3.6" fill="#465449"/><path d="M-4 10q4 5 8 0" fill="none" stroke="#64725e" stroke-width="2" stroke-linecap="round"/>';
  if (key === 'food') return `<path d="M-38 24Q-45 21-36 2l24-35q12-15 24 0L37 2q11 22 1 26-25 11-76-4Z" fill="#fffdf3" stroke="#dfd7bc" stroke-width="2"/><rect x="-14" y="11" width="28" height="24" rx="5" fill="#79917a"/><path d="M-20-3q4 5 8 0M12-3q4 5 8 0" fill="none" stroke="#6b6c5b" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="-24" cy="6" rx="5" ry="3" fill="#f1c6b6"/><ellipse cx="24" cy="6" rx="5" ry="3" fill="#f1c6b6"/><path d="M-3 6q3 4 6 0" fill="none" stroke="#a78f74" stroke-width="2"/>`;
  if (key === 'animal') return `<path d="m-31-9-4-28 24 14q12-3 23 0l24-14-4 29q10 12 2 26-14 23-51 10-20-8-14-27Z" fill="#d6c9e9" stroke="#bcaed0" stroke-width="2"/><path d="m-28-25 12 7-11 5m55-12-12 7 11 5" fill="#edcfc9"/>${eyes}<path d="M-32 3h-10m11 7h-10M32 3h10M31 10h10" stroke="#a58da7" stroke-width="2" stroke-linecap="round"/><path d="M-26 28h52v14h-52Z" fill="#a99ac0"/><path d="m-12 28 12 10 12-10" fill="#fffaf2"/>`;
  if (key === 'appliance') return `<rect x="-39" y="-29" width="78" height="66" rx="17" fill="#d2e1cb" stroke="#aac3a6" stroke-width="2"/><rect x="-30" y="-20" width="46" height="44" rx="10" fill="#fffcec"/><path d="m-15-29-8-15m11 15 10-18" stroke="#9eaf92" stroke-width="3" stroke-linecap="round"/><circle cx="27" cy="-6" r="5" fill="#f3edcf"/><circle cx="27" cy="11" r="5" fill="#f3edcf"/><path d="M-27 38v6m53-6v6" stroke="#8fa689" stroke-width="6" stroke-linecap="round"/><g transform="translate(-6 0)">${eyes}</g>`;
  return `<path d="M-33-10c-13-31 24-41 30-15h6c8-28 42-15 30 15 13 32-6 49-33 48-30 1-47-16-33-48Z" fill="#d6dfad" stroke="#b7c894" stroke-width="2"/><ellipse cx="0" cy="24" rx="21" ry="14" fill="#f8f4d9"/>${eyes}<ellipse cx="-25" cy="11" rx="5.5" ry="3.5" fill="#e9c3ae"/><ellipse cx="25" cy="11" rx="5.5" ry="3.5" fill="#e9c3ae"/>`;
}
export function boxArt(theme, key) {
  const id = 'pack-' + hash(key).toString(36);
  return `<svg class="package-art" viewBox="0 0 360 270" aria-hidden="true"><defs><filter id="${id}-s" x="-40%" y="-50%" width="180%" height="220%"><feGaussianBlur stdDeviation="10"/></filter><linearGradient id="${id}-f" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fffdf8"/><stop offset="1" stop-color="${theme.soft}"/></linearGradient></defs><ellipse cx="186" cy="239" rx="83" ry="11" fill="${theme.ink}" opacity=".17" filter="url(#${id}-s)"/><g transform="rotate(-8 180 142)"><path d="m112 54 26-18h146l-25 18Z" fill="#fffdf7" stroke="#fff" stroke-width="1.5"/><path d="m259 54 25-18v178l-25 21Z" fill="${theme.ink}" opacity=".56"/><rect x="112" y="54" width="147" height="181" rx="4" fill="url(#${id}-f)" stroke="#fff" stroke-width="1.5"/><path d="M112 191q18-12 36 0t36 0 36 0 39-1v41q0 4-4 4H116q-4 0-4-4Z" fill="${theme.tone}"/><text x="127" y="75" fill="${theme.ink}" font-size="8" font-family="monospace" letter-spacing="2">BLIND BOX</text><circle cx="187" cy="139" r="49" fill="${theme.soft}"/><g transform="translate(187 138)">${mascot(theme.key)}</g><path d="m235 88 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="${theme.ink}" opacity=".6"/><text x="128" y="218" fill="${theme.ink}" font-size="7" font-family="monospace" letter-spacing="1.3">A LITTLE SURPRISE</text><path d="M268 183v29m4-31v28m4-31v28" stroke="#fff" opacity=".65" stroke-width="1.5"/></g></svg>`;
}
function itemArtwork(theme, key, label) {
  if (/汉堡/.test(label)) return `<path d="M-37-3c1-34 73-34 74 0Z" fill="#e5bc7c"/><path d="M-37 3h74v11h-74Z" fill="#a4be85"/><path d="m-36 15 20 8 15-7 18 8 20-7v9h-73Z" fill="#e3c475"/><rect x="-35" y="25" width="70" height="12" rx="6" fill="#d7ac70"/><path d="M-10-7v2m20-2v2" stroke="#695c45" stroke-width="4" stroke-linecap="round"/><path d="M-4 4q4 4 8 0" fill="none" stroke="#9d7a50" stroke-width="2"/><path d="m-15-20 2 2m24-4 2 2m-8-7 2 2" stroke="#fff3cf" stroke-width="2" stroke-linecap="round"/>`;
  if (/拉面/.test(label)) return `<path d="M-39-1h78c0 42-78 42-78 0Z" fill="#f9e9d2" stroke="#d9c8af" stroke-width="2"/><ellipse cy="-1" rx="39" ry="10" fill="#e4c78e"/><path d="M-25-5q7-8 15 0t15 0 15 0m-37 5q7-8 15 0t15 0" fill="none" stroke="#fff0c0" stroke-width="3"/><ellipse cx="16" cy="-5" rx="9" ry="6" fill="#fffdf1"/><ellipse cx="16" cy="-5" rx="5" ry="3" fill="#eac770"/><path d="m-17-7 5-32m1 31 5-32" stroke="#b3a085" stroke-width="3" stroke-linecap="round"/><path d="M-12 11v2m24-2v2m-15 8q3 3 6 0" stroke="#9b8d76" stroke-width="3" stroke-linecap="round" fill="none"/>`;
  if (/辣椒/.test(label)) return `<path d="M-20-21q-24 55 12 60 37-4 29-45-2-27-41-15Z" fill="#deb29c"/><path d="M-6-22q-7-16 10-20m-9 21 18-11" stroke="#91ab81" stroke-width="6" stroke-linecap="round"/><path d="M-10-1v2m20-2v2m-14 11q4 5 8 0" stroke="#8c755e" stroke-width="3" stroke-linecap="round" fill="none"/>`;
  if (/寿司/.test(label)) return `<rect x="-33" y="-4" width="66" height="37" rx="13" fill="#fffaf0" stroke="#e3dcc8" stroke-width="2"/><rect x="-38" y="-18" width="76" height="23" rx="10" fill="#e8b19b"/><path d="m-23-17 8 20m8-20 8 20m8-20 8 20" stroke="#f7ddc9" stroke-width="3"/><path d="M-11 12v2m22-2v2m-14 8q3 4 6 0" stroke="#94856d" stroke-width="3" stroke-linecap="round" fill="none"/>`;
  if (/月饼/.test(label)) return `<circle r="33" cy="7" fill="#e4ce98" stroke="#d3ba7e" stroke-width="3"/><path d="m-19-24-4-14 15 8 8-16 8 16 15-8-4 14Z" fill="#d7bd75"/><path d="M-10 4v2m20-2v2m-14 11q4 4 8 0" stroke="#938365" stroke-width="3" stroke-linecap="round" fill="none"/>`;
  if (/饺子/.test(label)) return `<path d="M-39 14q-2-45 39-44t39 44q-37 28-78 0Z" fill="#f3e6d2" stroke="#d9cbb6" stroke-width="2"/><path d="m-22-15 5 8m7-17 3 10m10-10 3 10m10-4 4 9" stroke="#d9cbb6" stroke-width="3" stroke-linecap="round"/><path d="M-11 6v2m22-2v2m-15 10q4 4 8 0" stroke="#a08d6e" stroke-width="3" stroke-linecap="round" fill="none"/>`;
  return mascot(theme.key);
}
export function figureArt(theme, key, locked = false, label = '') {
  return `<svg class="figure-art${locked ? ' figure-art--locked' : ''}" viewBox="0 0 130 120" aria-hidden="true"><ellipse cx="65" cy="103" rx="34" ry="6" fill="${theme.ink}" opacity=".12"/><g transform="translate(65 56)">${itemArtwork(theme, key, label)}</g></svg>`;
}
