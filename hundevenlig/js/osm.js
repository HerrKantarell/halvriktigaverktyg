// Delad mellan webbläsaren och scripts/fetch-places.mjs.
// Hämtar matställen i Köpenhamn från OpenStreetMap (Overpass) och bantar dem.

export const BBOX = [55.6, 12.45, 55.74, 12.67]; // syd, väst, nord, öst

export const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const QUERY = `[out:json][timeout:90];
nwr["amenity"~"^(restaurant|cafe|bar|pub|fast_food|ice_cream)$"]["name"](${BBOX.join(',')});
out center tags;`;

const clip = (s, n) => (s && s.length > n ? s.slice(0, n) : s);

/** Overpass-element → kompakt post. Tomma fält utelämnas. */
export function slim(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null || !t.name) return null;
  const addr = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  const out = {
    id: el.type[0] + el.id, // n123 / w123 / r123
    n: clip(t.name, 80),
    t: t.amenity,
    lat: +lat.toFixed(5),
    lon: +lon.toFixed(5),
  };
  const dog = (t.dog || '').toLowerCase();
  if (['yes', 'no', 'leashed', 'outside'].includes(dog)) out.d = dog;
  if (addr) out.a = addr;
  if (t.cuisine) out.c = clip(t.cuisine.split(';')[0].replace(/_/g, ' '), 30);
  if (t.opening_hours) out.oh = clip(t.opening_hours, 120);
  const web = t.website || t['contact:website'];
  if (web && /^https?:\/\//i.test(web)) out.w = clip(web, 160);
  if (t.outdoor_seating === 'yes') out.os = 1;
  return out;
}

export async function fetchPlaces(fetchImpl = fetch) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(QUERY),
      });
      if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
      const json = await res.json();
      const places = json.elements.map(slim).filter(Boolean);
      if (!places.length) throw new Error(url + ' → tomt svar');
      return places;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
