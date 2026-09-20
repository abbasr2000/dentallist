/**
 * Reading a street out of a register address, and writing it the way
 * OpenStreetMap does.
 *
 * The register prints a practice's street and nothing else — no city, no
 * postal code. That street is the only thing in the record that says where the
 * practice actually is, so getting it out cleanly is what stands between the
 * directory and a city page full of clinics from somewhere else.
 *
 * The two sides spell streets differently. The register abbreviates the way a
 * person writing an envelope does ("Dundas St W"); OpenStreetMap writes them
 * out ("Dundas Street West"). Matching needs one form, and the expanded one is
 * the one that is unambiguous.
 */

/** Suite, unit and floor markers, which come before or after the street. */
const UNIT_MARKER =
  /\b(?:unit|units|suite|ste|apt|apartment|bldg|building|floor|flr|fl|rm|room|office|po box|box)\b/i;

const ABBREVIATIONS: Record<string, string> = {
  st: "Street",
  str: "Street",
  ave: "Avenue",
  av: "Avenue",
  rd: "Road",
  dr: "Drive",
  blvd: "Boulevard",
  blv: "Boulevard",
  cres: "Crescent",
  cr: "Crescent",
  crt: "Court",
  ct: "Court",
  pl: "Place",
  pkwy: "Parkway",
  pky: "Parkway",
  pwy: "Parkway",
  hwy: "Highway",
  ln: "Lane",
  ter: "Terrace",
  terr: "Terrace",
  cir: "Circle",
  sq: "Square",
  trl: "Trail",
  gdns: "Gardens",
  gdn: "Garden",
  hts: "Heights",
  mt: "Mount",
  gr: "Grove",
  grv: "Grove",
  way: "Way",
  cl: "Close",
  cmn: "Common",
  cir_: "Circle",
};

const DIRECTIONS: Record<string, string> = {
  n: "North",
  s: "South",
  e: "East",
  w: "West",
  ne: "Northeast",
  nw: "Northwest",
  se: "Southeast",
  sw: "Southwest",
};

/**
 * The street part of a register address, with the house number, the unit and
 * any trailing building name removed.
 *
 * "Unit-4 1295 Carling Ave" → "Carling Ave"
 * "124 Edward St #356B" → "Edward St"
 * "550 King St N Conestoga Mall" → "King St N Conestoga Mall" is wrong, so a
 *   trailing run of words after a direction is cut.
 */
export function streetFrom(address: string | undefined): string | undefined {
  if (!address) return undefined;

  // Only the first comma-separated part can be the street; the rest is unit
  // or building detail.
  let s = address.split(",")[0];

  // Anything from a unit marker or a hash onward is not the street.
  const marker = s.search(UNIT_MARKER);
  if (marker > 0) s = s.slice(0, marker);
  s = s.split("#")[0];

  // A leading "Unit-4 " or "B-100 " before the house number.
  s = s.replace(/^\s*[A-Za-z]{0,6}\s*-\s*\d+[A-Za-z]?\s+/, "");

  // The house number, including ranges like "12-14".
  s = s.replace(/^\s*\d+[A-Za-z]?(?:\s*-\s*\d+[A-Za-z]?)?\s+/, "");

  // A trailing unit number with nothing marking it: "7010 Warden Ave 19".
  s = s.replace(/\s+\d+[A-Za-z]?$/, "");

  s = s.replace(/\s+/g, " ").trim().replace(/[.,;]+$/, "");

  // Some rows put the building first: "Radiology Clinic 124 Edward St." The
  // street begins at the house number wherever it happens to sit.
  const embedded = s.match(/\b\d+[A-Za-z]?\s+(\D.*)$/);
  if (embedded?.[1]) s = embedded[1].trim();

  return s || undefined;
}

/**
 * The same street written as OpenStreetMap writes it.
 *
 * Also the point at which a trailing building name is dropped: a street ends
 * at its type ("Street", "Road") plus an optional direction, so anything after
 * that is something else. "King St N Conestoga Mall" → "King Street North".
 */
export function expandStreet(street: string | undefined): string | undefined {
  if (!street) return undefined;

  const words = street.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let typeAt = -1;

  for (const word of words) {
    const bare = word.replace(/\.$/, "").toLowerCase();
    const expanded = ABBREVIATIONS[bare];
    if (expanded) {
      out.push(expanded);
      typeAt = out.length - 1;
      continue;
    }
    // A word already written out is the type too.
    if (Object.values(ABBREVIATIONS).some((v) => v.toLowerCase() === bare)) {
      out.push(word.replace(/\.$/, ""));
      typeAt = out.length - 1;
      continue;
    }
    // A direction belongs to the street when it follows the type, and also
    // when the street has no type at all — "Queensway W" is a real name.
    const direction = DIRECTIONS[bare];
    if (direction && (out.length === typeAt + 1 || (typeAt < 0 && out.length > 0))) {
      out.push(direction);
      if (typeAt < 0) typeAt = out.length - 2;
      continue;
    }
    if (Object.values(DIRECTIONS).some((v) => v.toLowerCase() === bare) && typeAt >= 0) {
      out.push(word);
      continue;
    }
    // Past the type and not a direction: a building name, not the street.
    if (typeAt >= 0) break;
    out.push(word);
  }

  const name = out.join(" ").trim();
  if (!name) return undefined;
  // A street with no type at all ("Lakeshore") is still worth looking up.
  return name;
}

/** The register's street, in OpenStreetMap's spelling. */
export function osmStreetName(address: string | undefined): string | undefined {
  return expandStreet(streetFrom(address));
}
