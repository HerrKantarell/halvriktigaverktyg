// Kör: node hundevenlig/scripts/fetch-places.mjs
// Skriver hundevenlig/data/places.json. Körs veckovis av GitHub Actions.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchPlaces } from '../js/osm.js';

const target = fileURLToPath(new URL('../data/places.json', import.meta.url));
const places = (await fetchPlaces({
  rounds: 5,
  pauseMs: 30_000,
  headers: { 'User-Agent': 'hundevenlig/1.0 (github.com/HerrKantarell/halvriktigaverktyg)' },
  log: console.warn,
})).sort((a, b) => a.id.localeCompare(b.id));

if (places.length < 500) {
  throw new Error(`Bara ${places.length} ställen – misstänkt lite, skriver inte över.`);
}

await writeFile(
  target,
  JSON.stringify({ updated: new Date().toISOString().slice(0, 10), source: 'OpenStreetMap', places }) + '\n'
);
const tagged = places.filter((p) => p.d).length;
console.log(`${places.length} ställen, ${tagged} med hundtagg → ${target}`);
