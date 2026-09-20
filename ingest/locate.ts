/**
 * Placing a register practice on the map.
 *
 * The register prints a street and no city, and its search matches the city a
 * dentist registered in rather than the one they work in. So every practice
 * arrives with a street and a list of cities its dentists live in, one of
 * which is usually — but not reliably — the right one.
 *
 * Neither half is enough alone. The street name can repeat across Ontario:
 * there is a Main Street in Hamilton and another in Ottawa. The candidate
 * cities are noisy: dentists commute, and taking the most popular one is right
 * only 69% of the time. Together they settle it — the candidates say roughly
 * where to look, and the street says exactly where.
 */

import { distanceMetres } from "./lib";
import type { StreetIndex, StreetPlace } from "./streets";
import type { GazetteerPlace } from "./gazetteer";
import { osmStreetName } from "./streetname";

export interface Located {
  lat: number;
  lng: number;
  /** Which part of the record settled it, for the review file. */
  basis: "street-only" | "street-and-city" | "city-only";
  /** Distance from the chosen street to the nearest supporting city, in km. */
  supportKm?: number;
}

/**
 * A candidate city, and how many of the practice's dentists named it.
 *
 * The count matters: one dentist who lives in Orangeville should not outweigh
 * four who live around Ottawa.
 */
export interface CityVote {
  name: string;
  votes: number;
}

/**
 * How far a street cluster can sit from every city its dentists named before
 * we stop believing it is the same practice. Ontario cities are large and a
 * gazetteer point is a centre, not a boundary, so this is generous.
 */
export const MAX_SUPPORT_KM = 60;

export function tally(cities: Array<string | undefined>): CityVote[] {
  const counts = new Map<string, number>();
  for (const city of cities) {
    const name = city?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, votes]) => ({ name, votes }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
}

/**
 * Score a street cluster by how well the practice's cities support it.
 *
 * Every candidate city pulls on every cluster, with a weight that falls off
 * with distance, so a cluster near several of them beats one near a single
 * outlier. Dividing rather than thresholding means a city 5 km away and a city
 * 50 km away both count, in proportion.
 */
function support(cluster: StreetPlace, votes: CityVote[], places: Map<string, GazetteerPlace>) {
  let score = 0;
  let nearestKm = Infinity;

  for (const vote of votes) {
    const place = places.get(vote.name.toLowerCase());
    if (!place) continue;
    const km = distanceMetres(cluster, place) / 1000;
    if (km < nearestKm) nearestKm = km;
    score += vote.votes / (1 + km);
  }

  return { score, nearestKm };
}

/**
 * Where a practice is, from its address and the cities its dentists named.
 *
 * Returns nothing rather than a guess when the street is unknown and no
 * candidate city can be resolved — an unplaced clinic is honest, a clinic on
 * the wrong city page is not.
 */
export function locate(
  address: string | undefined,
  cities: Array<string | undefined>,
  streets: StreetIndex,
  places: Map<string, GazetteerPlace>,
): Located | undefined {
  const votes = tally(cities);
  const street = osmStreetName(address);
  const clusters = street ? (streets[street] ?? []) : [];

  if (clusters.length > 0) {
    // One place of that name, and nothing to weigh it against: take it.
    if (clusters.length === 1 && votes.length === 0) {
      return { lat: clusters[0].lat, lng: clusters[0].lng, basis: "street-only" };
    }

    let best: { cluster: StreetPlace; score: number; nearestKm: number } | undefined;
    for (const cluster of clusters) {
      const { score, nearestKm } = support(cluster, votes, places);
      if (!best || score > best.score) best = { cluster, score, nearestKm };
    }

    if (best && best.score > 0 && best.nearestKm <= MAX_SUPPORT_KM) {
      return {
        lat: best.cluster.lat,
        lng: best.cluster.lng,
        basis: "street-and-city",
        supportKm: Number(best.nearestKm.toFixed(1)),
      };
    }

    // No city vouches for any of them. The longest road of that name is the
    // best remaining guess, and only when there is just one.
    if (clusters.length === 1) {
      return { lat: clusters[0].lat, lng: clusters[0].lng, basis: "street-only" };
    }
  }

  // No usable street. Fall back to the city the most dentists named, which is
  // right about two times in three — better than nothing, and recorded as
  // such so it can be told apart later.
  for (const vote of votes) {
    const place = places.get(vote.name.toLowerCase());
    if (place) return { lat: place.lat, lng: place.lng, basis: "city-only" };
  }

  return undefined;
}

/** Index a gazetteer for lookup by name. */
export function placeIndex(places: GazetteerPlace[]): Map<string, GazetteerPlace> {
  const map = new Map<string, GazetteerPlace>();
  for (const place of places) {
    const key = place.name.toLowerCase();
    if (!map.has(key)) map.set(key, place);
  }
  return map;
}
