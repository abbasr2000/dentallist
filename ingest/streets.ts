/**
 * Where each street the register names actually is.
 *
 * The register gives a practice a street and no city. Its search matches the
 * city a dentist registered in, which is where they live, not where they work,
 * so a practice comes back under every city any of its dentists registered in
 * — 124 Edward Street in downtown Toronto came back under twenty-six of them.
 * Measured against the clinics that also appear in OpenStreetMap with real
 * coordinates, the city was wrong 42% of the time.
 *
 * Guessing from those candidates does not fix it. Taking the city the most
 * dentists named gets 69%; taking the one nearest the practice's area code
 * gets 72%. Both fail the same way, because dentists commute and Ontario's
 * area codes cover half a province each.
 *
 * The street is the one thing in the record that says where the practice is.
 * There is exactly one Carling Avenue, and it is not in Bradford. So this asks
 * OpenStreetMap where each of the 1,938 street names in the register's
 * addresses can be found, and writes them out as points a practice can be
 * placed against.
 *
 * It asks only for the names we need, about eighty per query, rather than
 * pulling Ontario's road network — a few dozen requests instead of gigabytes.
 *
 * Run: npx tsx ingest/streets.ts
 */

import { politeFetch, withRetry, writeJson, readJson, distanceMetres, type SourceRecord } from "./lib";
import { osmStreetName } from "./streetname";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const OUT_PATH = "ingest/out/streets.json";
const RCDSO_PATH = "ingest/out/rcdso.json";

/** Names per Overpass query. Large enough to be few requests, small enough
 *  that one timing out costs little. */
const BATCH = 80;

/**
 * How finely a street is cut into stretches.
 *
 * This is not "how far apart two streets of the same name are" — it is how
 * precisely a practice on that street can be placed. A cluster is stored as
 * its centre, so the centre of a 30 km road is up to 15 km from any address on
 * it, and in the GTA that crosses two municipal boundaries. Britannia Road
 * runs continuously from Mississauga through Milton; collapsed to one point it
 * put every practice on it in Milton.
 *
 * Measured: at 12 km the median placement error was 2.1 km and 111 of the 195
 * misses were the right road at the wrong stretch. Two kilometres cuts a long
 * road into stretches a city can be told apart by, and the practice's own
 * dentists pick which stretch.
 */
const CLUSTER_KM = 2;

/** Roads that carry addresses. Service roads and tracks do not. */
const ROAD_TYPES =
  "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian";

export interface StreetPlace {
  /** Centre of one run of road carrying this name. */
  lat: number;
  lng: number;
  /** How many ways made up this cluster — a proxy for how long the street is. */
  ways: number;
}

export type StreetIndex = Record<string, StreetPlace[]>;

interface OverpassElement {
  type: string;
  id: number;
  center?: { lat: number; lon: number };
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

/** Every street name the register's addresses mention, most common first. */
export function streetNamesFrom(records: SourceRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const name = osmStreetName(record.address);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/** Overpass regex alternation is literal, so anything special has to go. */
function escapeForRegex(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryFor(names: string[]): string {
  const alternation = names.map(escapeForRegex).join("|");
  return `
[out:json][timeout:300];
area["boundary"="administrative"]["admin_level"="4"]["name"="Ontario"]->.ontario;
way["highway"~"^(${ROAD_TYPES})$"]["name"~"^(${alternation})$"](area.ontario);
out center tags;
`.trim();
}

/**
 * Collapse a street's ways into the distinct places it runs.
 *
 * A long road is hundreds of ways; a name that repeats across the province is
 * several separate roads. Both matter: the first should be one point, the
 * second should stay several, or a practice on the Hamilton Main Street gets
 * placed on the Ottawa one.
 */
export function clusterPoints(
  points: Array<{ lat: number; lng: number }>,
  maxKm = CLUSTER_KM,
): StreetPlace[] {
  const clusters: Array<{ lat: number; lng: number; ways: number }> = [];

  for (const point of points) {
    let joined = false;
    for (const cluster of clusters) {
      if (distanceMetres(point, cluster) / 1000 <= maxKm) {
        // Running mean, so a cluster's centre reflects all of its ways.
        cluster.lat = (cluster.lat * cluster.ways + point.lat) / (cluster.ways + 1);
        cluster.lng = (cluster.lng * cluster.ways + point.lng) / (cluster.ways + 1);
        cluster.ways += 1;
        joined = true;
        break;
      }
    }
    if (!joined) clusters.push({ lat: point.lat, lng: point.lng, ways: 1 });
  }

  return clusters
    .sort((a, b) => b.ways - a.ways)
    .map((c) => ({
      lat: Number(c.lat.toFixed(5)),
      lng: Number(c.lng.toFixed(5)),
      ways: c.ways,
    }));
}

async function runQuery(query: string): Promise<OverpassElement[]> {
  let lastError: unknown;
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await withRetry(
        async () => {
          const res = await politeFetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ data: query }).toString(),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          if (!text.trimStart().startsWith("{")) {
            throw new Error(`non-JSON response: ${text.slice(0, 120)}`);
          }
          return JSON.parse(text) as { elements: OverpassElement[] };
        },
        { label: "overpass-streets", baseMs: 5000 },
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
  const records = readJson<SourceRecord[]>(RCDSO_PATH);
  if (!records) {
    console.error(`No ${RCDSO_PATH}. Run ingest/rcdso.ts first.`);
    process.exit(1);
  }

  const names = streetNamesFrom(records);
  console.log(`${names.length} distinct street names in ${records.length} register records`);

  // Resume: a street already looked up is not looked up again. --refresh
  // starts over, which is what a change to the clustering needs.
  const refresh = process.argv.includes("--refresh");
  const index: StreetIndex = refresh ? {} : (readJson<StreetIndex>(OUT_PATH) ?? {});
  const todo = names.filter((n) => !(n in index));
  console.log(`  ${names.length - todo.length} already known, ${todo.length} to look up`);

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const elements = await runQuery(queryFor(batch));

    const points = new Map<string, Array<{ lat: number; lng: number }>>();
    for (const el of elements) {
      const name = el.tags?.name;
      const lat = el.center?.lat ?? el.lat;
      const lng = el.center?.lon ?? el.lon;
      if (!name || lat == null || lng == null) continue;
      const list = points.get(name) ?? [];
      list.push({ lat, lng });
      points.set(name, list);
    }

    // A name with no ways is recorded as empty, so the next run does not ask
    // again for a street OpenStreetMap does not have.
    for (const name of batch) index[name] = clusterPoints(points.get(name) ?? []);

    const found = batch.filter((n) => index[n].length > 0).length;
    console.log(
      `  ${Math.min(i + BATCH, todo.length)}/${todo.length} — ${found}/${batch.length} found`,
    );
    writeJson(OUT_PATH, index);
  }

  const placed = Object.values(index).filter((v) => v.length > 0).length;
  const ambiguous = Object.values(index).filter((v) => v.length > 1).length;
  console.log(`${placed}/${Object.keys(index).length} street names located`);
  console.log(`  ${ambiguous} run in more than one place in Ontario`);
  writeJson(OUT_PATH, index);
  console.log(`Wrote ${OUT_PATH}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
