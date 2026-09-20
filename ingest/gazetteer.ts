/**
 * Every named place in Ontario, with coordinates, from OpenStreetMap.
 *
 * Two things need this.
 *
 * The register's city list is not an Ontario city list. It is the list of
 * cities its registrants gave, which includes Buffalo, Detroit, Montreal,
 * Winnipeg, Calgary and Dubai — dentists who hold an Ontario registration and
 * practise elsewhere. An Ontario directory with a Dubai page is not a small
 * cosmetic problem; it is the kind of thing that tells a reader, correctly,
 * that nobody checked. A hand-written list of the places we happen to know
 * cannot settle this, because the register also names Stittsville, Embrun,
 * Beamsville and three hundred other real Ontario towns that any such list
 * would miss — and small-town coverage is the whole point.
 *
 * The second is placing a practice. The register's search matches a dentist's
 * registered city, not the address it prints, so a practice comes back under
 * every city its dentists registered in — 124 Edward Street in Toronto is
 * returned under twenty-six of them. Choosing between those candidates needs
 * to know where they are, and 121 hand-listed places is not enough to know.
 *
 * Run: npx tsx ingest/gazetteer.ts
 */

import { politeFetch, withRetry, writeJson, slugify } from "./lib";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const OUT_PATH = "ingest/out/gazetteer.json";

/**
 * `place` covers the whole settlement hierarchy. We want it all: a register
 * address in Unionville or Stittsville is as real as one in Toronto, and those
 * are tagged suburb and village respectively, not city.
 */
const QUERY = `
[out:json][timeout:600];
area["boundary"="administrative"]["admin_level"="4"]["name"="Ontario"]->.ontario;
(
  node["place"~"^(city|town|village|hamlet|suburb|neighbourhood|borough|quarter)$"](area.ontario);
  way["place"~"^(city|town|village|hamlet|suburb|neighbourhood|borough|quarter)$"](area.ontario);
  relation["place"~"^(city|town|village|hamlet|suburb|neighbourhood|borough|quarter)$"](area.ontario);
);
out center tags;
`.trim();

export interface GazetteerPlace {
  name: string;
  slug: string;
  kind: string;
  lat: number;
  lng: number;
  /** OSM's own population tag where it has one. Used only to break ties. */
  population?: number;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function toPlace(el: OverpassElement): GazetteerPlace | undefined {
  const tags = el.tags ?? {};
  const name = (tags.name ?? tags["name:en"])?.trim();
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!name || lat == null || lng == null) return undefined;

  const population = Number.parseInt(tags.population ?? "", 10);

  return {
    name,
    slug: slugify(name),
    kind: tags.place ?? "place",
    lat,
    lng,
    population: Number.isFinite(population) ? population : undefined,
  };
}

/**
 * Keep the most significant entry for a name. Ontario has several Richmonds
 * and a great many Main Streets' worth of repeated village names; where two
 * share a name we want the one a person writing an address most likely meant,
 * which is the larger and higher in the hierarchy.
 */
const RANK: Record<string, number> = {
  city: 6,
  borough: 5,
  town: 4,
  suburb: 3,
  village: 2,
  quarter: 1,
  neighbourhood: 1,
  hamlet: 0,
};

function dedupe(places: GazetteerPlace[]): GazetteerPlace[] {
  const best = new Map<string, GazetteerPlace>();
  for (const place of places) {
    const held = best.get(place.slug);
    if (!held) {
      best.set(place.slug, place);
      continue;
    }
    const better =
      (RANK[place.kind] ?? 0) !== (RANK[held.kind] ?? 0)
        ? (RANK[place.kind] ?? 0) > (RANK[held.kind] ?? 0)
        : (place.population ?? 0) > (held.population ?? 0);
    if (better) best.set(place.slug, place);
  }
  return [...best.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

async function fetchOverpass(): Promise<OverpassElement[]> {
  let lastError: unknown;
  for (const endpoint of ENDPOINTS) {
    try {
      console.log(`Querying ${new URL(endpoint).host}…`);
      const response = await withRetry(
        async () => {
          const res = await politeFetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ data: QUERY }).toString(),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          if (!text.trimStart().startsWith("{")) {
            throw new Error(`non-JSON response: ${text.slice(0, 120)}`);
          }
          return JSON.parse(text) as { elements: OverpassElement[] };
        },
        { label: "overpass-places", baseMs: 5000 },
      );
      return response.elements;
    } catch (error) {
      console.warn(`  ${new URL(endpoint).host} failed: ${String(error)}`);
      lastError = error;
    }
  }
  throw lastError ?? new Error("all Overpass endpoints failed");
}

async function main() {
  const elements = await fetchOverpass();
  console.log(`Overpass returned ${elements.length} elements`);

  const places = dedupe(
    elements.map(toPlace).filter((p): p is GazetteerPlace => p !== undefined),
  );

  const byKind = new Map<string, number>();
  for (const place of places) byKind.set(place.kind, (byKind.get(place.kind) ?? 0) + 1);

  console.log(`  ${places.length} distinct Ontario place names`);
  for (const [kind, count] of [...byKind].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${count} ${kind}`);
  }

  writeJson(OUT_PATH, places);
  console.log(`Wrote ${OUT_PATH}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
