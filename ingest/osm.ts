/**
 * OpenStreetMap ingest, via the Overpass API.
 *
 * Free, permissively licensed (ODbL, attribution required — we credit it on
 * /sources/), and the fastest way to get coordinates and a first pass at
 * contact details for every dental practice in Ontario.
 *
 * Run: npx tsx ingest/osm.ts
 */

import { politeFetch, withRetry, writeJson, normalizePhone, normalizePostal, type SourceRecord } from "./lib";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/**
 * Ontario as an OSM administrative area, then every dentist inside it.
 *
 * `nwr` covers nodes, ways and relations — a clinic in a medical building is
 * often mapped as a building way rather than a point, and querying only nodes
 * silently loses those. `out center` gives every result a single coordinate.
 */
const QUERY = `
[out:json][timeout:600];
area["boundary"="administrative"]["admin_level"="4"]["name"="Ontario"]->.ontario;
(
  nwr["amenity"="dentist"](area.ontario);
  nwr["healthcare"="dentist"](area.ontario);
);
out center tags;
`.trim();

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function toRecord(el: OverpassElement): SourceRecord | undefined {
  const tags = el.tags ?? {};
  const name = tags.name ?? tags["name:en"] ?? tags.operator;
  if (!name) return undefined; // An unnamed point is not a listing.

  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;

  const streetParts = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean);
  const address = streetParts.length ? streetParts.join(" ") : undefined;

  return {
    source: "osm",
    sourceId: `${el.type}/${el.id}`,
    name: name.trim(),
    address,
    city: tags["addr:city"],
    postalCode: normalizePostal(tags["addr:postcode"]),
    phone: normalizePhone(tags.phone ?? tags["contact:phone"]),
    website: tags.website ?? tags["contact:website"],
    lat,
    lng,
    raw: {
      openingHours: tags.opening_hours,
      wheelchair: tags.wheelchair,
      speciality: tags["healthcare:speciality"],
      email: tags.email ?? tags["contact:email"],
      operator: tags.operator,
    },
  };
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
          // Overpass answers 200 with an HTML error page when it is busy.
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          if (!text.trimStart().startsWith("{")) {
            throw new Error(`non-JSON response: ${text.slice(0, 120)}`);
          }
          return JSON.parse(text) as { elements: OverpassElement[] };
        },
        { label: "overpass", baseMs: 5000 },
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

  const records = elements
    .map(toRecord)
    .filter((r): r is SourceRecord => r !== undefined);

  const withCoords = records.filter((r) => r.lat && r.lng).length;
  const withPhone = records.filter((r) => r.phone).length;
  const withSite = records.filter((r) => r.website).length;

  console.log(`  ${records.length} named practices`);
  console.log(`  ${withCoords} with coordinates`);
  console.log(`  ${withPhone} with a phone number`);
  console.log(`  ${withSite} with a website`);
  console.log(`  ${records.length - withSite} without a website (nothing to crawl for those)`);

  writeJson("ingest/out/osm.json", records);
  console.log("Wrote ingest/out/osm.json");
}

// Guarded so that importing this module (for its exported parsers, or from a
// test) does not launch a browser or hit the network.
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
