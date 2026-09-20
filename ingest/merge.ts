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

interface MergedClinic {
  slug: string;
  name: string;
  citySlug: string;
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

function nameKey(r: SourceRecord): string {
  return slugify(r.name)
    .replace(/-(dental|dentistry|clinic|centre|center|office|group|associates)$/g, "");
}

export function mergeRecords(records: SourceRecord[]): MergedClinic[] {
  const byPhone = new Map<string, MergedClinic>();
  const byAddress = new Map<string, MergedClinic>();
  const clinics: MergedClinic[] = [];

  const blank = (r: SourceRecord): MergedClinic => ({
    slug: "",
    name: r.name,
    citySlug: slugify(r.city ?? "unknown"),
    address: r.address,
    postalCode: r.postalCode,
    phone: r.phone,
    website: r.website,
    lat: r.lat,
    lng: r.lng,
    practitioners: [],
    permits: { sedation: false, cbct: false },
    sources: [],
  });

  const absorb = (target: MergedClinic, r: SourceRecord) => {
    // Prefer the value we already have; only fill gaps. A source that arrives
    // second should not overwrite a field the first source got right.
    target.address ??= r.address;
    target.postalCode ??= r.postalCode;
    target.phone ??= r.phone;
    target.website ??= r.website;
    target.lat ??= r.lat;
    target.lng ??= r.lng;

    // The RCDSO name is the registered one; prefer it for display.
    if (r.source === "rcdso") target.name = r.name;

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

    let match = (pk && byPhone.get(pk)) || (ak && byAddress.get(ak)) || undefined;

    // Last resort: same-ish name within 150 m. Tight enough that two different
    // practices in one medical building do not collapse together.
    if (!match && record.lat && record.lng) {
      const nk = nameKey(record);
      match = clinics.find(
        (c) =>
          c.lat != null &&
          c.lng != null &&
          nameKey({ name: c.name } as SourceRecord) === nk &&
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
    }

    absorb(match, record);
    if (pk) byPhone.set(pk, match);
    if (ak) byAddress.set(ak, match);
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

function main() {
  const rcdso = readJson<SourceRecord[]>("ingest/out/rcdso.json") ?? [];
  const osm = readJson<SourceRecord[]>("ingest/out/osm.json") ?? [];

  if (rcdso.length === 0 && osm.length === 0) {
    console.error("No input. Run ingest/rcdso.ts and ingest/osm.ts first.");
    process.exit(1);
  }

  console.log(`Merging ${rcdso.length} RCDSO + ${osm.length} OSM records`);
  const clinics = mergeRecords([...rcdso, ...osm]);

  const bothSources = clinics.filter(
    (c) => new Set(c.sources.map((s) => s.source)).size > 1,
  ).length;
  const needsReview = clinics.filter((c) => c.reviewReason).length;
  const withSite = clinics.filter((c) => c.website).length;

  console.log(`  ${clinics.length} distinct clinics`);
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
