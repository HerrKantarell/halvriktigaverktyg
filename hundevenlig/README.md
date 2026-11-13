# Må hunden med?

Karta över Köpenhamns restauranger och caféer – de som släpper in hund, de som inte gör det, och alla vi inte vet något om än. Danska och engelska. Ingen build, inget ramverk.

Live (efter merge): https://herrkantarell.github.io/halvriktigaverktyg/hundevenlig/

## Så hänger det ihop

| Fil | Gör |
|---|---|
| `index.html` | All markup och all statisk text, på båda språken |
| `css/style.css` | Allt utseende. Variablerna överst styr färg, typsnitt, radier |
| `js/app.js` | Karta, lista, filter, sök, tips, språkbyte |
| `js/osm.js` | Hämtar och bantar data från OpenStreetMap (delas med skriptet nedan) |
| `scripts/fetch-places.mjs` | Skriver `data/places.json`. Körs varje måndag av GitHub Actions |
| `data/community.json` | Godkända tips från besökare |

## Data

- **Ställen** kommer från OpenStreetMap: alla namngivna restauranger, caféer, barer, pubar, fastfood och glassställen i Köpenhamn.
- **Hundregeln** kommer från OSM-taggen `dog` (`yes`, `leashed`, `outside`, `no`). De flesta ställen saknar taggen – de visas som "Uvist" och är själva poängen med tipsfunktionen.
- **Rangordning:** eget tips > `community.json` > OSM.
- **Google/Yelp:** varje ställe länkar till Google Maps. Att hämta data därifrån kräver API-nyckel med betalkort, och Googles villkor förbjuder att spara svaren eller visa dem på en annan karta än deras egen. Places API har ett fält `allowsDogs` om vi vill gå den vägen senare.

## Tips från besökare

1. Besökaren fyller i formuläret. Tipset sparas direkt i den egna webbläsaren.
2. "Send til flokken" öppnar ett förifyllt GitHub-ärende med en färdig JSON-rad.
3. Klistra in raden i `data/community.json` → tipset syns för alla.

Det kräver GitHub-konto av den som tipsar. Det duger för test, inte för lansering – då behövs en riktig mottagare (t.ex. Supabase eller en Cloudflare Worker). Bytet sker på ett ställe: `saveTip()` i `js/app.js`.

## Till dig som ska formge

- **Nuvarande utseende är tillfälligt** – gräddvitt, mörkgrönt, tennisbollsgult. Riv det gärna.
- **Färg och typsnitt:** variablerna i `:root` överst i `css/style.css`. Mörkt läge direkt under.
- **Sixten:** är en platshållare. Sök på `SIXTEN` i `index.html` och byt SVG:n. Behåll klasserna `.tail` och `.ear` om svansen ska vifta och öronen hänga. Humöret (`yes` / `no` / `unknown` / `idle`) sätts som `data-mood` på `<body>`.
- **Sixtens repliker:** `bark` i `T` överst i `js/app.js`.
- **Kartnålar:** `.pin` i CSS, tass-SVG:n `PAW` i `js/app.js`.
- **Text:** sök på `lang="da"` i `index.html`. Varje textbit står två gånger, en per språk.

## Köra lokalt

```
python3 -m http.server
```

Öppna `http://localhost:8000/hundevenlig/`. Finns ingen `data/places.json` hämtar sidan själv från OpenStreetMap.
