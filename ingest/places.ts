/**
 * Assigning a city to a clinic from its coordinates.
 *
 * OpenStreetMap tags `addr:city` on only about a fifth of Ontario dental
 * practices, but it gives coordinates for essentially all of them. Since city
 * pages are the spine of the site, a clinic with no city is a clinic that
 * cannot be listed — so the city is derived from the point instead.
 *
 * Nearest-centroid against the list below, with a distance ceiling. It is not
 * a boundary lookup and it will occasionally put a clinic in the neighbouring
 * municipality along a border; that is acceptable for a listing and fixable
 * per-clinic. What it must not do is invent a city for a point nowhere near
 * one, hence MAX_ASSIGN_KM.
 *
 * Toronto is deliberately broken into its former boroughs and a few
 * well-known districts. People search "dentist in Scarborough", not "dentist
 * in Toronto M1G", and the whole point of the site is matching how people
 * actually look.
 */

import { distanceMetres, slugify } from "./lib";

export interface Place {
  name: string;
  lat: number;
  lng: number;
  /** Formal municipality where it differs from the searched name. */
  municipality?: string;
}

/** Beyond this from every known centroid, we decline to guess. */
export const MAX_ASSIGN_KM = 25;

/** Toronto's districts get a tighter radius so they don't swallow neighbours. */
const TORONTO_DISTRICT_MAX_KM = 8;

export const PLACES: Place[] = [
  // Toronto proper, seeded across the pre-amalgamation city.
  //
  // One downtown centroid is not enough: nearest-centroid then hands the west
  // end to York and the east end to East York, because those borough centroids
  // sit closer to midtown than City Hall does. Several points all named
  // "Toronto" keep the old city together without needing real boundaries.
  { name: "Toronto", lat: 43.6532, lng: -79.3832 }, // downtown
  { name: "Toronto", lat: 43.7040, lng: -79.3980 }, // midtown / Yonge-Eglinton
  { name: "Toronto", lat: 43.6700, lng: -79.4050 }, // the Annex
  { name: "Toronto", lat: 43.6520, lng: -79.4520 }, // Bloor West / High Park
  { name: "Toronto", lat: 43.6400, lng: -79.4230 }, // Parkdale / Liberty Village
  { name: "Toronto", lat: 43.6650, lng: -79.3330 }, // Leslieville / Riverdale
  { name: "Toronto", lat: 43.6780, lng: -79.3490 }, // the Danforth
  { name: "Toronto", lat: 43.6710, lng: -79.3930 }, // Yorkville
  { name: "Toronto", lat: 43.6390, lng: -79.3810 }, // Harbourfront
  { name: "Scarborough", lat: 43.7764, lng: -79.2318, municipality: "Toronto" },
  { name: "North York", lat: 43.7615, lng: -79.4111, municipality: "Toronto" },
  { name: "Etobicoke", lat: 43.6205, lng: -79.5132, municipality: "Toronto" },
  { name: "East York", lat: 43.6896, lng: -79.3276, municipality: "Toronto" },
  { name: "York", lat: 43.6896, lng: -79.4772, municipality: "Toronto" },
  { name: "Downsview", lat: 43.7407, lng: -79.4788, municipality: "Toronto" },
  { name: "Willowdale", lat: 43.7709, lng: -79.4085, municipality: "Toronto" },
  { name: "Agincourt", lat: 43.7854, lng: -79.2789, municipality: "Toronto" },

  // Greater Toronto Area
  { name: "Mississauga", lat: 43.589, lng: -79.6441 },
  { name: "Brampton", lat: 43.7315, lng: -79.7624 },
  { name: "Markham", lat: 43.8561, lng: -79.337 },
  { name: "Vaughan", lat: 43.8361, lng: -79.4983 },
  { name: "Maple", lat: 43.8563, lng: -79.5085, municipality: "Vaughan" },
  { name: "Woodbridge", lat: 43.7801, lng: -79.5966, municipality: "Vaughan" },
  { name: "Thornhill", lat: 43.8156, lng: -79.4241 },
  { name: "Richmond Hill", lat: 43.8828, lng: -79.4403 },
  { name: "Aurora", lat: 44.0065, lng: -79.4504 },
  { name: "Newmarket", lat: 44.0592, lng: -79.4613 },
  { name: "Pickering", lat: 43.8384, lng: -79.0868 },
  { name: "Ajax", lat: 43.8509, lng: -79.0204 },
  { name: "Whitby", lat: 43.8975, lng: -78.9429 },
  { name: "Oshawa", lat: 43.8971, lng: -78.8658 },
  { name: "Oakville", lat: 43.4675, lng: -79.6877 },
  { name: "Burlington", lat: 43.3255, lng: -79.799 },
  { name: "Milton", lat: 43.5183, lng: -79.8774 },
  { name: "Georgetown", lat: 43.6501, lng: -79.9204 },
  { name: "Caledon", lat: 43.8668, lng: -79.8663 },
  { name: "King City", lat: 43.9264, lng: -79.5285 },
  { name: "Stouffville", lat: 43.9709, lng: -79.2445 },
  { name: "Uxbridge", lat: 44.1092, lng: -79.1225 },
  { name: "Bolton", lat: 43.8768, lng: -79.7357 },

  // Golden Horseshoe and Niagara
  { name: "Hamilton", lat: 43.2557, lng: -79.8711 },
  { name: "Ancaster", lat: 43.2184, lng: -79.9867, municipality: "Hamilton" },
  { name: "Dundas", lat: 43.2665, lng: -79.9553, municipality: "Hamilton" },
  { name: "Stoney Creek", lat: 43.2168, lng: -79.7624, municipality: "Hamilton" },
  { name: "St. Catharines", lat: 43.1594, lng: -79.2469 },
  { name: "Niagara Falls", lat: 43.1063, lng: -79.0665 },
  { name: "Welland", lat: 42.9921, lng: -79.2484 },
  { name: "Fort Erie", lat: 42.9069, lng: -78.9377 },
  { name: "Grimsby", lat: 43.2001, lng: -79.5606 },

  // Southwestern Ontario
  { name: "Kitchener", lat: 43.4516, lng: -80.4925 },
  { name: "Waterloo", lat: 43.4643, lng: -80.5204 },
  { name: "Cambridge", lat: 43.3616, lng: -80.3144 },
  { name: "Guelph", lat: 43.5448, lng: -80.2482 },
  { name: "London", lat: 42.9849, lng: -81.2453 },
  { name: "Windsor", lat: 42.3149, lng: -83.0364 },
  { name: "LaSalle", lat: 42.2286, lng: -83.0563 },
  { name: "Tecumseh", lat: 42.3126, lng: -82.8754 },
  { name: "Chatham", lat: 42.4048, lng: -82.191 },
  { name: "Sarnia", lat: 42.9745, lng: -82.4066 },
  { name: "Brantford", lat: 43.1394, lng: -80.2644 },
  { name: "Woodstock", lat: 43.1306, lng: -80.7467 },
  { name: "Stratford", lat: 43.3701, lng: -80.9821 },
  { name: "St. Thomas", lat: 42.7787, lng: -81.1829 },
  { name: "Simcoe", lat: 42.8375, lng: -80.3018 },
  { name: "Leamington", lat: 42.0534, lng: -82.5994 },
  { name: "Owen Sound", lat: 44.5669, lng: -80.9433 },
  { name: "Goderich", lat: 43.7452, lng: -81.7165 },
  { name: "Listowel", lat: 43.7368, lng: -80.9527 },
  { name: "Tillsonburg", lat: 42.8626, lng: -80.7269 },
  { name: "Ingersoll", lat: 43.0389, lng: -80.8836 },
  { name: "Fergus", lat: 43.7059, lng: -80.3776 },
  { name: "Orangeville", lat: 43.9194, lng: -80.0942 },

  // Central Ontario and cottage country
  { name: "Barrie", lat: 44.3894, lng: -79.6903 },
  { name: "Innisfil", lat: 44.3, lng: -79.5833 },
  { name: "Orillia", lat: 44.6083, lng: -79.4194 },
  { name: "Midland", lat: 44.7501, lng: -79.8897 },
  { name: "Collingwood", lat: 44.5009, lng: -80.2169 },
  { name: "Wasaga Beach", lat: 44.5206, lng: -80.0164 },
  { name: "Bradford", lat: 44.1147, lng: -79.5636 },
  { name: "Alliston", lat: 44.1526, lng: -79.8665 },
  { name: "Huntsville", lat: 45.3268, lng: -79.2168 },
  { name: "Bracebridge", lat: 45.0375, lng: -79.3106 },
  { name: "Gravenhurst", lat: 44.9186, lng: -79.3686 },
  { name: "Parry Sound", lat: 45.3475, lng: -80.038 },

  // Eastern Ontario
  { name: "Ottawa", lat: 45.4215, lng: -75.6972 },
  { name: "Nepean", lat: 45.3212, lng: -75.7335, municipality: "Ottawa" },
  { name: "Kanata", lat: 45.3088, lng: -75.8987, municipality: "Ottawa" },
  { name: "Orleans", lat: 45.4658, lng: -75.5236, municipality: "Ottawa" },
  { name: "Gloucester", lat: 45.3428, lng: -75.5993, municipality: "Ottawa" },
  { name: "Barrhaven", lat: 45.2733, lng: -75.7398, municipality: "Ottawa" },
  { name: "Kingston", lat: 44.2312, lng: -76.486 },
  { name: "Belleville", lat: 44.1628, lng: -77.3832 },
  { name: "Peterborough", lat: 44.3091, lng: -78.3197 },
  { name: "Cornwall", lat: 45.0212, lng: -74.7301 },
  { name: "Brockville", lat: 44.5895, lng: -75.6843 },
  { name: "Pembroke", lat: 45.8267, lng: -77.1103 },
  { name: "Trenton", lat: 44.1001, lng: -77.5766 },
  { name: "Cobourg", lat: 43.9593, lng: -78.1677 },
  { name: "Port Hope", lat: 43.9515, lng: -78.2928 },
  { name: "Lindsay", lat: 44.3573, lng: -78.7371 },
  { name: "Napanee", lat: 44.2501, lng: -76.9503 },
  { name: "Smiths Falls", lat: 44.9026, lng: -76.0221 },
  { name: "Arnprior", lat: 45.4337, lng: -76.3556 },
  { name: "Carleton Place", lat: 45.1401, lng: -76.1424 },
  { name: "Renfrew", lat: 45.4718, lng: -76.6827 },
  { name: "Hawkesbury", lat: 45.6084, lng: -74.6049 },
  { name: "Rockland", lat: 45.5468, lng: -75.2896 },
  { name: "Bowmanville", lat: 43.9124, lng: -78.6881 },

  // Northern Ontario
  { name: "Sudbury", lat: 46.4917, lng: -80.993 },
  { name: "Thunder Bay", lat: 48.3809, lng: -89.2477 },
  { name: "Sault Ste. Marie", lat: 46.5136, lng: -84.3358 },
  { name: "North Bay", lat: 46.3091, lng: -79.4608 },
  { name: "Timmins", lat: 48.4758, lng: -81.3305 },
  { name: "Kenora", lat: 49.767, lng: -94.4894 },
  { name: "Kapuskasing", lat: 49.4167, lng: -82.4333 },
  { name: "Elliot Lake", lat: 46.3833, lng: -82.6333 },
  { name: "Dryden", lat: 49.7802, lng: -92.8374 },
  { name: "Fort Frances", lat: 48.6106, lng: -93.4008 },
  { name: "Cochrane", lat: 49.0667, lng: -81.0167 },
  { name: "Espanola", lat: 46.2554, lng: -81.7692 },
  { name: "New Liskeard", lat: 47.5093, lng: -79.6684 },
];

const TORONTO_DISTRICTS = new Set(
  PLACES.filter((p) => p.municipality === "Toronto").map((p) => p.name),
);

export interface Assignment {
  citySlug: string;
  cityName: string;
  municipality?: string;
  distanceKm: number;
}

/**
 * Nearest place to a point, or undefined if nothing is close enough.
 *
 * Toronto's districts are checked at a tighter radius than municipalities so
 * that, for example, the Scarborough centroid does not claim a clinic in Ajax.
 */
export function assignPlace(lat: number, lng: number): Assignment | undefined {
  let best: { place: Place; km: number } | undefined;

  for (const place of PLACES) {
    const km = distanceMetres({ lat, lng }, { lat: place.lat, lng: place.lng }) / 1000;
    const ceiling = TORONTO_DISTRICTS.has(place.name)
      ? TORONTO_DISTRICT_MAX_KM
      : MAX_ASSIGN_KM;
    if (km > ceiling) continue;
    if (!best || km < best.km) best = { place, km };
  }

  if (!best) return undefined;
  return {
    citySlug: slugify(best.place.name),
    cityName: best.place.name,
    municipality: best.place.municipality,
    distanceKm: Number(best.km.toFixed(2)),
  };
}

/**
 * Trust an explicit city tag when we have one and it matches a known place;
 * otherwise fall back to the coordinates. An OSM `addr:city` of "Toronto" on a
 * clinic that is plainly in Scarborough is still improved by the coordinates,
 * so a district assignment wins over a bare municipality tag.
 */
export function resolveCity(
  taggedCity: string | undefined,
  lat: number | undefined,
  lng: number | undefined,
): Assignment | undefined {
  const fromPoint = lat != null && lng != null ? assignPlace(lat, lng) : undefined;
  if (fromPoint) return fromPoint;

  if (taggedCity) {
    const known = PLACES.find(
      (p) => p.name.toLowerCase() === taggedCity.trim().toLowerCase(),
    );
    if (known) {
      return {
        citySlug: slugify(known.name),
        cityName: known.name,
        municipality: known.municipality,
        distanceKm: 0,
      };
    }
    // An unrecognised but present tag is still better than nothing.
    return { citySlug: slugify(taggedCity), cityName: taggedCity.trim(), distanceKm: 0 };
  }

  return undefined;
}
