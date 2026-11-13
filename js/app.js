import { fetchPlaces, BBOX } from './osm.js';

/* ── Inställningar ─────────────────────────────────────── */
const CONFIG = {
  repo: 'HerrKantarell/halvriktigaverktyg', // tips skickas hit som GitHub-issue
  center: [55.678, 12.568],
  zoom: 14,
  listMax: 80,
  cacheDays: 7,
  // CARTO kräver nyckel sedan september 2026 (gratis: carto.com/basemaps/apikey).
  // Tom = OpenStreetMaps egna kartbilder, som inte kräver nyckel.
  cartoKey: '',
};

/* ── Text ──────────────────────────────────────────────── */
const T = {
  da: {
    title: 'Må hunden med? · København',
    verdict: { yes: 'Hund velkommen', outside: 'Hund kun udenfor', no: 'Ingen hund', unknown: 'Uvist' },
    src: { osm: 'OpenStreetMap', pack: 'tip fra flokken', mine: 'dit tip' },
    type: { restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', pub: 'Pub', fast_food: 'Fastfood', ice_cream: 'Is' },
    bark: {
      idle: 'Snus rundt.', yes: 'Vov! Der må jeg med.', no: 'Suk. Jeg venter udenfor.',
      unknown: 'Aner det ikke. Gør du?', sniff: 'Denne vej.', none: 'Ingen sjove steder i nærheden.',
    },
    meter: (k, n) => `Sixten har snuset til ${k} af ${n} steder.`,
    updated: (d) => `Data: OpenStreetMap · opdateret ${d}`,
    live: 'Data: OpenStreetMap · hentet live',
    fail: 'Kunne ikke hente steder. Prøv igen.',
    open: 'Åbent', web: 'Hjemmeside', share: 'Del', copied: 'Link kopieret', tip: 'Giv et tip', fix: 'Ret',
    more: (n) => `+ ${n} til. Zoom ind.`,
  },
  en: {
    title: 'Can the dog come? · Copenhagen',
    verdict: { yes: 'Dogs welcome', outside: 'Dogs outside only', no: 'No dogs', unknown: 'Unknown' },
    src: { osm: 'OpenStreetMap', pack: 'tip from the pack', mine: 'your tip' },
    type: { restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', pub: 'Pub', fast_food: 'Fast food', ice_cream: 'Ice cream' },
    bark: {
      idle: 'Sniff around.', yes: "Woof! I'm allowed in.", no: "Sigh. I'll wait outside.",
      unknown: 'No idea. Do you?', sniff: 'This way.', none: 'No fun places nearby.',
    },
    meter: (k, n) => `Sixten has sniffed ${k} of ${n} places.`,
    updated: (d) => `Data: OpenStreetMap · updated ${d}`,
    live: 'Data: OpenStreetMap · fetched live',
    fail: "Couldn't fetch places. Try again.",
    open: 'Open', web: 'Website', share: 'Share', copied: 'Link copied', tip: 'Add a tip', fix: 'Correct',
    more: (n) => `+ ${n} more. Zoom in.`,
  },
};

const $ = (s) => document.querySelector(s);
const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* fullt eller avstängt */ } },
};

let lang = store.get('hv.lang') || (/^(da|sv|nb|no)/i.test(navigator.language) ? 'da' : 'en');
let t = T[lang];
const places = new Map();   // id → plats
const markers = new Map();  // id → Leaflet-lager
let community = {};         // id → { s, note, date }
let tips = store.get('hv.tips', {}); // egna tips, bara i den här webbläsaren
let dataNote = '';
let loaded = false;

/** DOM-byggare. All extern text går in som textnoder – aldrig innerHTML. */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...kids.filter((k) => k != null && k !== false));
  return el;
}
const icon = (name) => h('i', { class: 'ph ph-' + name, 'aria-hidden': 'true' });

/* ── Dom: eget tips > flockens tips > OSM ──────────────── */
function verdict(p) {
  const pick = tips[p.id] ? [tips[p.id], 'mine'] : community[p.id] ? [community[p.id], 'pack'] : null;
  if (pick) return { s: pick[0].s, src: pick[1], note: pick[0].note };
  if (p.d) return { s: p.d === 'leashed' ? 'yes' : p.d, src: 'osm' };
  return { s: 'unknown' };
}
const cat = (s) => (s === 'outside' ? 'yes' : s);
const shown = (c) => $('#f-' + c).checked;

/* ── Karta ─────────────────────────────────────────────── */
const map = L.map('map', {
  center: CONFIG.center, zoom: CONFIG.zoom, minZoom: 11,
  maxBounds: [[BBOX[0] - 0.08, BBOX[1] - 0.15], [BBOX[2] + 0.08, BBOX[3] + 0.15]],
});
const dark = matchMedia('(prefers-color-scheme: dark)');
let tiles;
function setTiles() {
  tiles?.remove();
  const osm = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  tiles = CONFIG.cartoKey
    ? L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark.matches ? 'dark_all' : 'rastertiles/voyager'}/{z}/{x}/{y}{r}.png?key=${CONFIG.cartoKey}`, {
        attribution: osm + ' © <a href="https://carto.com/attributions">CARTO</a>', subdomains: 'abcd', maxZoom: 20,
      })
    : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: osm, maxZoom: 19, className: 'osm-tiles' });
  tiles.addTo(map);
}
setTiles();
dark.addEventListener('change', () => { setTiles(); if (loaded) rebuild(); });

const canvas = L.canvas({ padding: 0.3, tolerance: 6 });
const layers = { yes: L.layerGroup(), no: L.layerGroup(), unknown: L.layerGroup() };

const PAW = '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="15.5" rx="4.2" ry="3.4"/><circle cx="7" cy="10.5" r="1.7"/><circle cx="10.3" cy="7.5" r="1.8"/><circle cx="13.7" cy="7.5" r="1.8"/><circle cx="17" cy="10.5" r="1.7"/></svg>';
const BAR = '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="3" rx="1.5"/></svg>';
const pin = (v) => {
  const size = v.s === 'no' ? 20 : 26;
  const cls = ['pin', cat(v.s), v.s === 'outside' && 'outside', v.src === 'mine' && 'mine'].filter(Boolean).join(' ');
  return L.divIcon({
    html: `<div class="${cls}" style="width:${size}px;height:${size}px">${v.s === 'no' ? BAR : PAW}</div>`,
    className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
  });
};
const dotRadius = () => { const z = map.getZoom(); return z <= 12 ? 1.5 : z === 13 ? 2 : z === 14 ? 3 : 5; };

function rebuild() {
  Object.values(layers).forEach((l) => l.clearLayers());
  markers.clear();
  const r = dotRadius();
  for (const p of places.values()) {
    const v = verdict(p);
    const c = cat(v.s);
    const m = c === 'unknown'
      ? L.circleMarker([p.lat, p.lon], { renderer: canvas, radius: r, weight: 1, color: dark.matches ? '#9DB0A5' : '#5F7268', fillColor: dark.matches ? '#183227' : '#fff', fillOpacity: 0.9 })
      : L.marker([p.lat, p.lon], { icon: pin(v), title: p.n, alt: `${p.n} – ${t.verdict[v.s]}`, zIndexOffset: c === 'yes' ? 500 : 0 });
    m.bindPopup(() => popup(p), { maxWidth: 280 });
    m.on('mouseover', () => setMood(c)).on('mouseout', () => setMood(map._popup ? null : 'idle'));
    m.on('popupopen', () => { setMood(c); history.replaceState(null, '', '#' + p.id); });
    m.addTo(layers[c]);
    markers.set(p.id, m);
  }
  syncLayers();
  counts();
}

function syncLayers() {
  for (const [c, layer] of Object.entries(layers)) shown(c) ? layer.addTo(map) : layer.remove();
  renderList();
}

map.on('zoomend', () => { const r = dotRadius(); layers.unknown.eachLayer((l) => l.setRadius(r)); });
map.on('moveend', renderList);
map.on('popupclose', () => { setMood('idle'); history.replaceState(null, '', location.pathname + location.search); });

/* ── Popup ─────────────────────────────────────────────── */
function popup(p) {
  const v = verdict(p);
  const meta = [t.type[p.t], p.c, p.a].filter(Boolean).join(' · ');
  const gmaps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(`${p.n} ${p.a || ''} København`);
  return h('div', { class: 'pop' },
    h('h3', {}, p.n),
    meta && h('p', { class: 'meta' }, meta),
    h('p', { class: 'verdict-line', 'data-s': cat(v.s) }, h('span', { class: 'dot' }), t.verdict[v.s]),
    v.src && h('p', { class: 'meta' }, t.src[v.src] + (v.note ? ` · “${v.note}”` : '')),
    p.oh && h('p', { class: 'meta' }, `${t.open}: ${p.oh}`),
    h('p', { class: 'links' },
      p.w && h('a', { href: p.w, target: '_blank', rel: 'noopener' }, t.web),
      h('a', { href: gmaps, target: '_blank', rel: 'noopener' }, 'Google Maps'),
      h('button', { class: 'link', type: 'button', onclick: (e) => share(p, e.currentTarget) }, t.share)),
    h('button', { class: v.s === 'unknown' ? 'btn' : 'btn-ghost', type: 'button', onclick: () => openTip(p) },
      icon(v.s === 'unknown' ? 'plus' : 'pencil-simple'), v.s === 'unknown' ? t.tip : t.fix));
}

async function share(p, btn) {
  const url = location.origin + location.pathname + '#' + p.id;
  try {
    if (navigator.share) await navigator.share({ title: p.n, text: `${p.n}: ${t.verdict[verdict(p).s]}`, url });
    else { await navigator.clipboard.writeText(url); btn.textContent = t.copied; }
  } catch { /* avbrutet */ }
}

function openPlace(id, zoom = 17) {
  const p = places.get(id);
  const m = markers.get(id);
  if (!p || !m) return false;
  const box = $('#f-' + cat(verdict(p).s));
  if (!box.checked) { box.checked = true; syncLayers(); }
  map.closePopup();
  map.setView([p.lat, p.lon], Math.max(map.getZoom(), zoom), { animate: false });
  m.openPopup();
  return true;
}

/* ── Lista: det som syns på kartan, sjovast först ──────── */
const ORDER = { yes: 0, no: 1, unknown: 2 };
function renderList() {
  if (!loaded) return;
  const b = map.getBounds();
  const c = map.getCenter();
  const rows = [];
  for (const p of places.values()) {
    if (!b.contains([p.lat, p.lon])) continue;
    const v = verdict(p);
    if (!shown(cat(v.s))) continue;
    rows.push({ p, v, k: ORDER[cat(v.s)], dist: (p.lat - c.lat) ** 2 + ((p.lon - c.lng) * 0.56) ** 2 });
  }
  rows.sort((a, z) => a.k - z.k || a.dist - z.dist);
  const list = $('#list');
  list.replaceChildren(...rows.slice(0, CONFIG.listMax).map(({ p, v }) =>
    h('li', { class: 'place', 'data-s': cat(v.s), 'data-id': p.id },
      h('span', { class: 'dot' }),
      h('button', { type: 'button' }, p.n),
      h('span', { class: 'tag' + (v.src === 'mine' ? ' mine' : '') }, v.src === 'mine' ? t.src.mine : v.s === 'outside' ? t.verdict.outside : ''),
      h('span', { class: 'meta' }, [t.type[p.t], p.a].filter(Boolean).join(' · ')))));
  if (rows.length > CONFIG.listMax) list.append(h('li', { class: 'meta', style: 'padding:12px 0' }, t.more(rows.length - CONFIG.listMax)));
  $('#empty').hidden = rows.length > 0;
}
$('#list').addEventListener('click', (e) => {
  const li = e.target.closest('.place');
  if (li) openPlace(li.dataset.id);
});
$('#list').addEventListener('pointerover', (e) => {
  const li = e.target.closest('.place');
  if (li) bark(li.dataset.s);
});
$('#list').addEventListener('pointerleave', () => bark(document.body.dataset.mood));

function counts() {
  const n = { yes: 0, no: 0, unknown: 0 };
  for (const p of places.values()) n[cat(verdict(p).s)]++;
  for (const c in n) $('#n-' + c).value = n[c];
  const total = places.size;
  const meter = $('#meter');
  meter.max = total || 1;
  meter.value = n.yes + n.no;
  $('#meter-text').textContent = total ? t.meter(n.yes + n.no, total) : '';
  $('#data-meta').textContent = dataNote === 'live' ? t.live : dataNote ? t.updated(dataNote) : '';
}

/* ── Sixten ────────────────────────────────────────────── */
function bark(key) { $('#bark').value = t.bark[key] || t.bark.idle; }
function setMood(mood) {
  if (!mood) return;
  document.body.dataset.mood = mood;
  bark(mood);
}

/* ── Filter, sök ───────────────────────────────────────── */
document.querySelectorAll('.filters input').forEach((i) => i.addEventListener('change', syncLayers));

function suggest(input) {
  const q = input.value.trim().toLowerCase();
  const out = [];
  if (q.length >= 2) {
    const seen = new Set();
    for (const p of places.values()) {
      const n = p.n.toLowerCase();
      if (!n.includes(q) || seen.has(n)) continue;
      seen.add(n);
      out.push(h('option', { value: p.n }, p.a || ''));
      if (out.length >= 12) break;
    }
  }
  $('#names').replaceChildren(...out);
}
function findByName(name) {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  const c = map.getCenter();
  let best = null;
  for (const p of places.values()) {
    const n = p.n.toLowerCase();
    const exact = n === q;
    if (!exact && !n.startsWith(q)) continue;
    const dist = (p.lat - c.lat) ** 2 + ((p.lon - c.lng) * 0.56) ** 2;
    if (!best || (exact && !best.exact) || (exact === best.exact && dist < best.dist)) best = { p, exact, dist };
  }
  return best;
}
$('#q').addEventListener('input', (e) => suggest(e.target));
$('#q').addEventListener('change', (e) => { const hit = findByName(e.target.value); if (hit) openPlace(hit.p.id); });
$('#tip-name').addEventListener('input', (e) => suggest(e.target));

/* ── Snus: närmaste sjova ställe ───────────────────────── */
$('#sniff').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.classList.add('busy');
  let from = map.getCenter();
  try {
    const pos = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { timeout: 6000, maximumAge: 60000 }));
    const { latitude: la, longitude: lo } = pos.coords;
    if (la > BBOX[0] && la < BBOX[2] && lo > BBOX[1] && lo < BBOX[3]) from = L.latLng(la, lo);
  } catch { /* ingen position – utgå från kartans mitt */ }
  btn.classList.remove('busy');
  let best = null;
  for (const p of places.values()) {
    if (cat(verdict(p).s) !== 'yes') continue;
    const d = from.distanceTo([p.lat, p.lon]);
    if (!best || d < best.d) best = { p, d };
  }
  if (!best) return bark('none');
  openPlace(best.p.id);
  bark('sniff');
});

/* ── Tips ──────────────────────────────────────────────── */
const dlg = $('#tip');
const form = $('#tip-form');
let tipPlace = null;   // platsen tipset gäller
let pending = null;    // tips som väntar på en kartklick (nytt ställe)

function openTip(p = null) {
  tipPlace = p;
  form.reset();
  form.hidden = false;
  $('#tip-sent').hidden = true;
  const name = $('#tip-name');
  name.value = p ? p.n : '';
  name.readOnly = !!p;
  dlg.showModal();
  if (p) form.querySelector('input[name=s]').focus(); else name.focus();
}
$('#open-tip').addEventListener('click', () => openTip());
$('#tip-close').addEventListener('click', () => dlg.close());
$('#sent-close').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // klick utanför

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(form);
  const tip = { s: f.get('s'), note: f.get('note').trim() || undefined, date: new Date().toISOString().slice(0, 10) };
  const place = tipPlace || findByName(f.get('name'))?.p;
  if (place && (tipPlace || place.n.toLowerCase() === f.get('name').trim().toLowerCase())) return saveTip(place, tip);
  // Okänt namn → be användaren peka ut stället på kartan
  pending = { tip, name: f.get('name').trim() };
  dlg.close();
  document.body.classList.add('pinning');
  $('#pin-hint').hidden = false;
});

function stopPinning() {
  pending = null;
  document.body.classList.remove('pinning');
  $('#pin-hint').hidden = true;
}
$('#pin-cancel').addEventListener('click', stopPinning);
map.on('click', (e) => {
  if (!pending) return;
  const { tip, name } = pending;
  const place = { id: 'x' + Date.now().toString(36), n: name, t: 'restaurant', lat: +e.latlng.lat.toFixed(5), lon: +e.latlng.lng.toFixed(5) };
  stopPinning();
  places.set(place.id, place);
  saveTip(place, { ...tip, n: place.n, lat: place.lat, lon: place.lon });
});

function saveTip(place, tip) {
  tips[place.id] = tip;
  store.set('hv.tips', tips);
  rebuild();
  // Färdig rad för data/community.json följer med i ärendet
  const row = JSON.stringify({ id: place.id, ...tip });
  const body = [
    `**${place.n}**${place.a ? ', ' + place.a : ''}`,
    `Hund: **${T.da.verdict[tip.s]}**`,
    tip.note ? `Kilde: ${tip.note}` : '',
    `Kort: https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=19/${place.lat}/${place.lon}`,
    '', '```json', row, '```',
  ].filter((l) => l !== '').join('\n');
  $('#tip-send').href = `https://github.com/${CONFIG.repo}/issues/new?` +
    new URLSearchParams({ title: `Hundetip: ${place.n} – ${T.da.verdict[tip.s]}`, body });
  form.hidden = true;
  $('#tip-sent').hidden = false;
  if (!dlg.open) dlg.showModal();
  dlg.addEventListener('close', () => openPlace(place.id), { once: true });
}

/* ── Språk ─────────────────────────────────────────────── */
function applyLang() {
  t = T[lang];
  document.documentElement.lang = lang;
  document.title = t.title;
  document.querySelectorAll('[data-ph-da]').forEach((el) => { el.placeholder = el.dataset['ph' + lang[0].toUpperCase() + lang[1]]; });
  bark(document.body.dataset.mood);
  if (loaded) { map.closePopup(); rebuild(); }
}
$('#lang').addEventListener('click', () => {
  lang = lang === 'da' ? 'en' : 'da';
  store.set('hv.lang', lang);
  document.startViewTransition ? document.startViewTransition(applyLang) : applyLang();
});
applyLang();

/* ── Data ──────────────────────────────────────────────── */
async function loadPlaces() {
  // 1. Färdig fil från GitHub Actions (snabbast)
  try {
    const res = await fetch('data/places.json', { cache: 'no-cache' });
    if (res.ok) {
      const json = await res.json();
      if (json.places?.length) { dataNote = json.updated; return json.places; }
    }
  } catch { /* finns inte än */ }
  // 2. Egen cache, 3. live från Overpass
  const cached = store.get('hv.places');
  if (cached && Date.now() - cached.at < CONFIG.cacheDays * 864e5) { dataNote = 'live'; return cached.places; }
  const live = await fetchPlaces();
  store.set('hv.places', { at: Date.now(), places: live });
  dataNote = 'live';
  return live;
}

async function init() {
  try {
    const [list, comm] = await Promise.all([
      loadPlaces(),
      fetch('data/community.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    for (const p of list) places.set(p.id, p);
    // Nya ställen (id börjar på x) bär med sig namn och position
    for (const [id, c] of [...comm.map((c) => [c.id, c]), ...Object.entries(tips)]) {
      if (!places.has(id) && c.n && c.lat && c.lon) places.set(id, { id, n: c.n, t: 'restaurant', lat: c.lat, lon: c.lon });
    }
    community = Object.fromEntries(comm.map((c) => [c.id, c]));
    loaded = true;
    $('#status').hidden = true;
    rebuild();
    const id = location.hash.slice(1);
    if (id) openPlace(id);
  } catch (err) {
    console.error(err);
    $('#status').replaceChildren(t.fail + ' ', h('button', { class: 'link', type: 'button', onclick: () => location.reload() }, '↻'));
  }
}
init();
