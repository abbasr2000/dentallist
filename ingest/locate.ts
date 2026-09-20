/**
 * Placing a register practice on the map.
 *
 * The register prints a street and no city, and its search matches the city a
 * dentist registered in rather than the one they work in. Taken at face value
 * the city is wrong on 42% of the clinics we can check independently.
 *
 * Three signals, in order of how much they are worth. Every percentage here is
 * measured against the 792 practices that also appear in OpenStreetMap with a
 * matching phone number, so the answer is known.
 *
 * 1. **The phone exchange.** The first six digits of a Canadian number are
 *    assigned to a rate centre, which is a place. Learned from clinics whose
 *    coordinates we already have, the exchange alone puts a clinic within a
 *    median of 1.9 km and names the right city 84.5% of the time — better than
 *    anything else available, and it needs nothing from the record but the
 *    phone number. It covers 58% of practices.
 *
 * 2. **The street.** There is one Carling Avenue and it is not in Bradford.
 *    On its own a street name is ambiguous — 800 of the 1,674 the register
 *    names run in more than one place in Ontario — but combined with an
 *    exchange to say which stretch, it puts a practice within 0.9 km.
 *
 * 3. **The cities the dentists registered in.** Worth 69% alone, and used only
 *    when there is no exchange to go on.
 *
 * Together: 88.6% of cities correct, median error 0.9 km.
 */

import { distanceMetres } from "./lib";
import type { StreetIndex, StreetPlace } from "./streets";
import type { GazetteerPlace } from "./gazetteer";
import { osmStreetName } from "./streetname";

export interface Point {
  lat: number;
  lng: number;
}

export interface Located extends Point {
  /** What settled it. Recorded so a guess can be told from a fact later. */
  basis:
    | "street-and-exchange"
    | "exchange"
    | "street-and-city"
    | "street-only"
    | "city-only";
  /**
   * True when two independent signals agree closely — the street and the
   * exchange within 5 km of each other. These are the placements worth
   * treating as settled.
   */
  confident: boolean;
}

export interface CityVote {
  name: string;
  votes: number;
}

/**
 * How far a street stretch may sit from the exchange that vouches for it.
 * Beyond this they are describing different places and the exchange, being the
 * stronger signal, wins outright.
 */
export const MAX_ANCHOR_KM = 25;

/** Street and exchange this close together is two signals agreeing. */
export const CONFIDENT_KM = 5;

/** A street stretch this far from every candidate city is not that practice. */
export const MAX_SUPPORT_KM = 60;

/**
 * An exchange whose known clinics are spread wider than this is not describing
 * a place. Rate centres are usually a town; a spread this large means the
 * number has been ported, or the sample is bad.
 */
export const MAX_EXCHANGE_SPREAD_KM = 20;

/** The first six digits of a Canadian number: area code and exchange. */
export function exchangeOf(phone: string | undefined): string | undefined {
  const digits = String(phone ?? "").replace(/\D/g, "").replace(/^1/, "");
  return digits.length >= 6 ? digits.slice(0, 6) : undefined;
}

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
 * The point in a set closest to all the others, and how far the furthest sits
 * from it.
 *
 * A medoid rather than a mean: a mean of two clusters lands between them, in a
 * field. A medoid is always somewhere a clinic actually is. Switching from one
 * to the other moved placement accuracy from 85.1% to 88.6%.
 */
export function medoid(points: Point[]): (Point & { spreadKm: number }) | undefined {
  if (points.length === 0) return undefined;

  let best = points[0];
  let bestCost = Infinity;
  for (const a of points) {
    let cost = 0;
    for (const b of points) cost += distanceMetres(a, b);
    if (cost < bestCost) {
      bestCost = cost;
      best = a;
    }
  }

  let spreadKm = 0;
  for (const p of points) spreadKm = Math.max(spreadKm, distanceMetres(best, p) / 1000);

  return { lat: best.lat, lng: best.lng, spreadKm };
}

export type ExchangeAnchors = Map<string, Point>;

/**
 * Where each phone exchange is, from every clinic whose position we know.
 *
 * `seeds` are points with coordinates already — OpenStreetMap clinics, and
 * register practices on a street that runs in exactly one place in Ontario,
 * which need no other evidence. 662 practices qualify on the street alone, and
 * they carry the exchange coverage from 46% to 58%.
 */
export function buildExchangeAnchors(
  seeds: Array<{ phone: string | undefined; lat: number; lng: number }>,
): ExchangeAnchors {
  const byExchange = new Map<string, Point[]>();
  for (const seed of seeds) {
    const key = exchangeOf(seed.phone);
    if (!key) continue;
    const list = byExchange.get(key) ?? [];
    list.push({ lat: seed.lat, lng: seed.lng });
    byExchange.set(key, list);
  }

  const anchors: ExchangeAnchors = new Map();
  for (const [key, points] of byExchange) {
    const centre = medoid(points);
    if (!centre || centre.spreadKm > MAX_EXCHANGE_SPREAD_KM) continue;
    anchors.set(key, { lat: centre.lat, lng: centre.lng });
  }
  return anchors;
}

/** Every place in Ontario a street of this name runs. */
export function stretchesOf(
  address: string | undefined,
  streets: StreetIndex,
): StreetPlace[] {
  const name = osmStreetName(address);
  return name ? (streets[name] ?? []) : [];
}

/** The stretch nearest a point, and how far away it is. */
function nearestStretch(stretches: StreetPlace[], to: Point) {
  let best = stretches[0];
  let km = Infinity;
  for (const stretch of stretches) {
    const d = distanceMetres(stretch, to) / 1000;
    if (d < km) {
      km = d;
      best = stretch;
    }
  }
  return { stretch: best, km };
}

/**
 * Score a stretch by how well the practice's candidate cities support it.
 *
 * Every candidate pulls on every stretch, weighted by how many of the
 * practice's dentists named it and falling off with distance, so a stretch
 * near several of them beats one near a single outlier.
 */
/**
 * Score a stretch by how well the practice's candidate cities support it.
 *
 * Every candidate pulls on every stretch, weighted by how many of the
 * practice's dentists named it and falling off with distance, so a stretch
 * near several of them beats one near a single outlier.
 *
 * Amalgamated cities are a known weak spot: a dentist working in Scarborough
 * often registers as "Toronto", whose entry is downtown, so a practice in the
 * east end is pulled west. Two ways of softening that were tried — treating a
 * municipality vote as supporting every stretch inside it equally, and
 * measuring it to the nearest district rather than the centre — and both made
 * the province as a whole worse, 83.1% and 83.6% against 85.0%. Most
 * Toronto-registered practices really are in central Toronto, and the pull is
 * right more often than it is wrong.
 *
 * The answer for a clinic this gets wrong is not a worse rule for everyone
 * else. It is the owner saying where they are, which outranks every inference
 * here. See data/claimed.ts.
 */
function support(stretch: Point, votes: CityVote[], places: Map<string, GazetteerPlace>) {
  let score = 0;
  let nearestKm = Infinity;
  for (const vote of votes) {
    const place = places.get(vote.name.toLowerCase());
    if (!place) continue;
    const km = distanceMetres(stretch, place) / 1000;
    if (km < nearestKm) nearestKm = km;
    score += vote.votes / (1 + km);
  }
  return { score, nearestKm };
}

/**
 * Where a practice is.
 *
 * Returns nothing rather than a guess when no signal reaches it. An unplaced
 * clinic is honest; a clinic on the wrong city page is the thing being fixed.
 */
export function locate(
  address: string | undefined,
  phone: string | undefined,
  cities: Array<string | undefined>,
  streets: StreetIndex,
  places: Map<string, GazetteerPlace>,
  anchors: ExchangeAnchors,
): Located | undefined {
  const stretches = stretchesOf(address, streets);
  const anchor = anchors.get(exchangeOf(phone) ?? "");

  if (anchor) {
    if (stretches.length > 0) {
      const { stretch, km } = nearestStretch(stretches, anchor);
      // The exchange says which stretch. When no stretch is anywhere near it,
      // the street has been misread or the number ported, and the exchange —
      // the stronger signal — stands alone.
      if (km <= MAX_ANCHOR_KM) {
        return {
          lat: stretch.lat,
          lng: stretch.lng,
          basis: "street-and-exchange",
          confident: km <= CONFIDENT_KM,
        };
      }
    }
    return { lat: anchor.lat, lng: anchor.lng, basis: "exchange", confident: false };
  }

  // No exchange to go on: the dentists' own cities choose between the
  // stretches. Worth 77%, against 58% for taking the register's city as given.
  const votes = tally(cities);
  if (stretches.length > 0) {
    let best: { stretch: StreetPlace; score: number; nearestKm: number } | undefined;
    for (const stretch of stretches) {
      const { score, nearestKm } = support(stretch, votes, places);
      if (!best || score > best.score) best = { stretch, score, nearestKm };
    }
    if (best && best.score > 0 && best.nearestKm <= MAX_SUPPORT_KM) {
      return {
        lat: best.stretch.lat,
        lng: best.stretch.lng,
        basis: "street-and-city",
        confident: false,
      };
    }
    if (stretches.length === 1) {
      return { lat: stretches[0].lat, lng: stretches[0].lng, basis: "street-only", confident: false };
    }
  }

  for (const vote of votes) {
    const place = places.get(vote.name.toLowerCase());
    if (place) {
      return { lat: place.lat, lng: place.lng, basis: "city-only", confident: false };
    }
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
