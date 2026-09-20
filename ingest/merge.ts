/**
 * Merge RCDSO and OpenStreetMap records into clinics.
 *
 * The hard part is deciding when two records are the same practice. Getting it
 * wrong in one direction lists a clinic twice; wrong in the other silently
 * merges two neighbours into one listing and attributes a specialist to the
 * wrong practice. So matching is conservative: strong identifiers first,
 * fuzzy geography only as a last resort, and anything ambiguous is kept apart
 * and flagged for review rather than guessed at.
 *
 * Run: npx tsx ingest/merge.ts
 */

import {
  addressKey,
  distanceMetres,
  formatPhone,
  readJson,
  slugify,
  writeJson,
  type SourceRecord,
} from "./lib";
import { resolveCity } from "./places";
import { buildExchangeAnchors, locate, placeIndex, stretchesOf } from "./locate";
import type { StreetIndex } from "./streets";
import type { GazetteerPlace } from "./gazetteer";

interface MergedClinic {
  slug: string;
  name: string;
  citySlug: string;
  cityName?: string;
  municipality?: string;
  /** How far the clinic is from the centroid we assigned it to, in km. */
  cityDistanceKm?: number;
  address?: string;
  postalCode?: string;
  phone?: string;
  website?: string;
  lat?: number;
  lng?: number;
  practitioners: Array<{ fullName: string; registrationNumber?: string; specialty?: string }>;
  permits: { sedation: boolean; cbct: boolean };
  sources: Array<{ source: string; sourceId: string }>;
  /** Set when the match was not certain. These get looked at by hand. */
  reviewReason?: string;
}

/** Same phone number is the strongest signal two records share a practice. */
function phoneKey(r: SourceRecord): string | undefined {
  return r.phone;
}

/** Same street address in the same postal code is the next strongest. */
function addressPostalKey(r: SourceRecord): string | undefined {
  const addr = addressKey(r.address);
  return addr && r.postalCode ? `${addr}|${r.postalCode}` : undefined;
}

/**
 * Street address plus city, for the many records that have no postal code.
 *
 * The register carries no coordinates, so a register record can only meet its
 * map record on a phone number or an address. OpenStreetMap has a postal code
 * for 17% of Ontario practices and a phone for 39%; without this key, most of
 * the register's 500-odd cities would arrive as duplicates of clinics already
 * on the map.
 *
 * The suite number is dropped, because one source records it and the other
 * usually does not. That makes the key a *building*, not a practice — and a
 * building is emphatically not a practice: 1580 Merivale Road in Nepean holds
 * five different ones, 10 Green Street in Barrhaven four. So an address match
 * is only accepted alongside a compatible name, or this key would delete real
 * clinics from the directory rather than deduplicate them.
 */
function addressCityKey(r: SourceRecord, citySlug: string | undefined): string | undefined {
  const addr = addressKey(r.address);
  if (!addr || !citySlug || citySlug === "unassigned") return undefined;

  const withoutSuite = addr
    .replace(/\s*(#|suite|unit|ste|apt|bsmt)\s*[\w-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // A street number is what makes this specific enough to merge on. Without
  // one, "lawrence ave e" would collapse every practice on the street.
  if (!/^\d+\s+\S/.test(withoutSuite)) return undefined;
  return `${withoutSuite}|${citySlug}`;
}

/**
 * Whether two practice names at one address are plausibly the same practice.
 *
 * Equal, or one a prefix of the other — the register writes the registered
 * name and a mapper writes what is on the door, so "Bay Dental" and "Bay
 * Dental Centre" should meet. Anything looser starts merging the neighbours.
 */
function namesAreCompatible(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  // A prefix only counts on a word boundary, so "smile" does not swallow
  // "smiles-of-parkdale" by accident of spelling. Three characters is enough
  // of a floor given that the two records already share a street address;
  // nameKey strips the trailing "dental"/"centre", so "Bay Dental" reduces to
  // "bay" and has to be allowed to meet "Bay Dental Centre".
  return longer.startsWith(`${shorter}-`) && shorter.length >= 3;
}

function nameKey(r: SourceRecord): string {
  return slugify(r.name)
    .replace(/-(dental|dentistry|clinic|centre|center|office|group|associates)$/g, "");
}

export function mergeRecords(records: SourceRecord[]): MergedClinic[] {
  const byPhone = new Map<string, MergedClinic>();
  const byAddress = new Map<string, MergedClinic>();
  // Only clinics sharing a normalised name can ever match on proximity, so
  // bucket by it. Scanning every clinic for every record was fine at a few
  // thousand; the register takes us to tens of thousands, where it is not.
  const byName = new Map<string, MergedClinic[]>();
  const byAddressCity = new Map<string, MergedClinic[]>();
  const clinics: MergedClinic[] = [];

  const blank = (r: SourceRecord): MergedClinic => {
    // OSM tags addr:city on only about a fifth of Ontario practices, so the
    // city is normally derived from the coordinates. See ingest/places.ts.
    const place = resolveCity(r.city, r.lat, r.lng);
    return {
    slug: "",
    name: r.name,
    citySlug: place?.citySlug ?? "unassigned",
    cityName: place?.cityName,
    municipality: place?.municipality,
    cityDistanceKm: place?.distanceKm,
    address: r.address,
    postalCode: r.postalCode,
    phone: r.phone,
    website: r.website,
    lat: r.lat,
    lng: r.lng,
    practitioners: [],
    permits: { sedation: false, cbct: false },
    sources: [],
    };
  };

  const index = (clinic: MergedClinic, key: string) => {
    const bucket = byName.get(key);
    if (!bucket) byName.set(key, [clinic]);
    else if (!bucket.includes(clinic)) bucket.push(clinic);
  };

  const absorb = (target: MergedClinic, r: SourceRecord) => {
    // Prefer the value we already have; only fill gaps. A source that arrives
    // second should not overwrite a field the first source got right.
    target.address ??= r.address;
    target.postalCode ??= r.postalCode;
    target.phone ??= r.phone;
    target.website ??= r.website;
    target.lat ??= r.lat;
    target.lng ??= r.lng;

    // The RCDSO name is the registered one; prefer it for display. A rename
    // has to be indexed too, or a later record carrying the new name would
    // miss the clinic it belongs to.
    if (r.source === "rcdso" && target.name !== r.name) {
      target.name = r.name;
      index(target, nameKey(r));
    }

    for (const person of r.practitioners ?? []) {
      const already = target.practitioners.some(
        (p) =>
          (person.registrationNumber && p.registrationNumber === person.registrationNumber) ||
          p.fullName.toLowerCase() === person.fullName.toLowerCase(),
      );
      if (!already) target.practitioners.push(person);
    }

    if (r.permits?.sedation) target.permits.sedation = true;
    if (r.permits?.cbct) target.permits.cbct = true;

    target.sources.push({ source: r.source, sourceId: r.sourceId });
  };

  // RCDSO first so its registered names and identifiers seed the index.
  const ordered = [...records].sort((a, b) =>
    a.source === b.source ? 0 : a.source === "rcdso" ? -1 : 1,
  );

  for (const record of ordered) {
    const pk = phoneKey(record);
    const ak = addressPostalKey(record);
    const ck = addressCityKey(record, resolveCity(record.city, record.lat, record.lng)?.citySlug);

    let match =
      (pk && byPhone.get(pk)) ||
      (ak && byAddress.get(ak)) ||
      undefined;

    // Same building AND a compatible name. "Bay Dental" and "Bay Dental Centre"
    // at one address are one practice the two sources spell differently; "Lima
    // Denture" and "Allegra Dental" at one address are two businesses.
    if (!match && ck) {
      const nk = nameKey(record);
      match = (byAddressCity.get(ck) ?? []).find((c) =>
        namesAreCompatible(nk, nameKey({ name: c.name } as SourceRecord)),
      );
    }

    // Last resort: same-ish name within 150 m. Tight enough that two different
    // practices in one medical building do not collapse together.
    if (!match && record.lat && record.lng) {
      match = (byName.get(nameKey(record)) ?? []).find(
        (c) =>
          c.lat != null &&
          c.lng != null &&
          distanceMetres(
            { lat: record.lat!, lng: record.lng! },
            { lat: c.lat, lng: c.lng },
          ) < 150,
      );
      if (match) match.reviewReason = "matched on name and proximity, not on phone or address";
    }

    if (!match) {
      match = blank(record);
      clinics.push(match);
      index(match, nameKey(record));
    }

    absorb(match, record);
    if (pk) byPhone.set(pk, match);
    if (ak) byAddress.set(ak, match);
    if (ck) {
      const bucket = byAddressCity.get(ck);
      if (!bucket) byAddressCity.set(ck, [match]);
      else if (!bucket.includes(match)) bucket.push(match);
    }
  }

  // Slugs last, so they are built from the final chosen name, and uniquely
  // within a city.
  const used = new Set<string>();
  for (const clinic of clinics) {
    let slug = slugify(clinic.name) || "clinic";
    let candidate = `${clinic.citySlug}/${slug}`;
    let n = 2;
    while (used.has(candidate)) candidate = `${clinic.citySlug}/${slug}-${n++}`;
    used.add(candidate);
    clinic.slug = candidate.split("/")[1];
  }

  return clinics;
}

/**
 * Give every register practice coordinates before anything else happens.
 *
 * The register's own city field is where a dentist registered, not where the
 * practice is, and it was wrong on 42% of the clinics we can check. Every
 * record of one practice carries the same street, so they are located together
 * and each one is stamped with the answer.
 *
 * This has to run before the merge and not after. The merge decides whether
 * two records are the same practice partly by city, so while the cities were
 * wrong one practice was being split into one clinic per city it appeared
 * under — the U of T dental school became seven.
 */
function locateRegisterRecords(records: SourceRecord[], osm: SourceRecord[]): void {
  const streets = readJson<StreetIndex>("ingest/out/streets.json");
  const gazetteer = readJson<GazetteerPlace[]>("ingest/out/gazetteer.json");

  if (!streets || !gazetteer) {
    console.warn(
      "  no streets.json or gazetteer.json — practices keep the register's own " +
        "city, which is wrong about two times in five. Run ingest/streets.ts " +
        "and ingest/gazetteer.ts.",
    );
    return;
  }

  const places = placeIndex(gazetteer);

  const groups = new Map<string, SourceRecord[]>();
  for (const record of records) {
    const group = groups.get(record.sourceId) ?? [];
    group.push(record);
    groups.set(record.sourceId, group);
  }

  // Where the phone exchanges are. Seeded from clinics whose position is
  // already known — every mapped clinic, plus every register practice on a
  // street that runs in exactly one place in Ontario, which needs no other
  // evidence. Those 662 practices carry exchange coverage from 46% to 58%.
  const seeds: Array<{ phone: string | undefined; lat: number; lng: number }> = [];
  for (const record of osm) {
    if (record.lat != null && record.lng != null) {
      seeds.push({ phone: record.phone, lat: record.lat, lng: record.lng });
    }
  }
  let unambiguous = 0;
  for (const group of groups.values()) {
    const stretches = stretchesOf(group[0].address, streets);
    if (stretches.length !== 1) continue;
    unambiguous++;
    seeds.push({ phone: group[0].phone, lat: stretches[0].lat, lng: stretches[0].lng });
  }
  const anchors = buildExchangeAnchors(seeds);
  console.log(
    `  ${anchors.size} phone exchanges located (${unambiguous} practices sit on a street that runs in one place only)`,
  );

  const basisCount = new Map<string, number>();
  let placed = 0;
  let confident = 0;

  for (const group of groups.values()) {
    const found = locate(
      group[0].address,
      group[0].phone,
      group.map((r) => r.city),
      streets,
      places,
      anchors,
    );
    if (!found) continue;
    placed++;
    if (found.confident) confident++;
    basisCount.set(found.basis, (basisCount.get(found.basis) ?? 0) + 1);
    for (const record of group) {
      record.lat = found.lat;
      record.lng = found.lng;
    }
  }

  console.log(`  located ${placed}/${groups.size} register practices, ${confident} on two agreeing signals`);
  for (const [basis, count] of [...basisCount].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${count} by ${basis}`);
  }
}

function main() {
  const rcdso = readJson<SourceRecord[]>("ingest/out/rcdso.json") ?? [];
  const osm = readJson<SourceRecord[]>("ingest/out/osm.json") ?? [];

  if (rcdso.length === 0 && osm.length === 0) {
    console.error("No input. Run ingest/rcdso.ts and ingest/osm.ts first.");
    process.exit(1);
  }

  console.log(`Merging ${rcdso.length} RCDSO + ${osm.length} OSM records`);
  locateRegisterRecords(rcdso, osm);
  const clinics = mergeRecords([...rcdso, ...osm]);

  const bothSources = clinics.filter(
    (c) => new Set(c.sources.map((s) => s.source)).size > 1,
  ).length;
  const needsReview = clinics.filter((c) => c.reviewReason).length;
  const withSite = clinics.filter((c) => c.website).length;

  const assigned = clinics.filter((c) => c.citySlug !== "unassigned").length;
  const cityCount = new Set(clinics.map((c) => c.citySlug)).size;

  console.log(`  ${clinics.length} distinct clinics`);
  console.log(`  ${assigned} placed in a city (${cityCount} cities), ${clinics.length - assigned} unassigned`);
  console.log(`  ${bothSources} confirmed by both sources`);
  console.log(`  ${withSite} with a website to crawl`);
  if (needsReview > 0) {
    console.log(`  ${needsReview} matched loosely — review ingest/out/review.json`);
    writeJson("ingest/out/review.json", clinics.filter((c) => c.reviewReason));
  }

  // Display formatting happens here, once, rather than in every page.
  for (const c of clinics) c.phone = formatPhone(c.phone) ?? c.phone;

  writeJson("ingest/out/clinics.json", clinics);
  console.log("Wrote ingest/out/clinics.json");
}

if (require.main === module) main();
