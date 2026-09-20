import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { City, Clinic, Evidence, OpeningHours, Practitioner, Provenance } from "@/lib/types";
import { buildOffering } from "@/lib/strength";
import { PROCEDURES, type ProcedureKey } from "@/lib/procedures";

/**
 * The real dataset, read at build time from the ingest output.
 *
 * The site is statically generated, so the JSON that ingest/merge.ts commits
 * is the production database until Supabase is in place. That keeps the
 * published site and the reviewable diff in the repo the same thing: if a
 * clinic's details change on the site, the commit that changed them is there.
 *
 * Everything here is a projection, never an invention. A field the sources did
 * not give us stays undefined and the template says so.
 */

const OUT = join(process.cwd(), "ingest", "out", "clinics.json");

interface MergedClinic {
  slug: string;
  name: string;
  citySlug?: string;
  cityName?: string;
  municipality?: string;
  address?: string;
  postalCode?: string;
  phone?: string;
  website?: string;
  email?: string;
  lat: number;
  lng: number;
  hours?: OpeningHours[];
  languages?: string[];
  practitioners?: Array<{ fullName: string; registrationNumber?: string; specialty?: string }>;
  permits?: { sedation?: boolean; cbct?: boolean };
  wheelchair?: boolean;
  sources: Array<{ source: string; sourceId: string; url?: string }>;
  lastSeen?: string;
}

function load(): MergedClinic[] {
  if (!existsSync(OUT)) return [];
  try {
    const parsed = JSON.parse(readFileSync(OUT, "utf8"));
    return Array.isArray(parsed) ? (parsed as MergedClinic[]) : [];
  } catch {
    return [];
  }
}

const CHECKED = new Date().toISOString().slice(0, 10);

function provenanceFor(record: MergedClinic): Provenance[] {
  const seen = new Set<string>();
  const out: Provenance[] = [];
  for (const s of record.sources ?? []) {
    if (seen.has(s.source)) continue;
    seen.add(s.source);
    out.push({
      source: s.source === "rcdso" ? "rcdso" : "osm",
      url:
        s.source === "osm" && s.sourceId
          ? `https://www.openstreetmap.org/${s.sourceId}`
          : s.url,
      checkedAt: record.lastSeen ?? CHECKED,
    } as Provenance);
  }
  return out;
}

/**
 * Register facts become evidence; nothing else does.
 *
 * OpenStreetMap tells us a practice exists and where it is. It does not tell us
 * what the practice is good at, so an OSM-only clinic gets a page and no
 * procedure claims. That is the honest reading of the data we have, and it is
 * what keeps the procedure pages meaningful.
 */
function evidenceFor(record: MergedClinic): Map<ProcedureKey, Evidence[]> {
  const byProcedure = new Map<ProcedureKey, Evidence[]>();
  const add = (key: ProcedureKey, evidence: Evidence) => {
    const list = byProcedure.get(key) ?? [];
    list.push(evidence);
    byProcedure.set(key, list);
  };

  const registerSource: Provenance = {
    source: "rcdso",
    url: "https://www.rcdso.org/en-ca/find-a-dentist",
    checkedAt: record.lastSeen ?? CHECKED,
  };

  for (const person of record.practitioners ?? []) {
    if (!person.specialty) continue;
    for (const procedure of PROCEDURES) {
      if (!procedure.relatedSpecialties?.includes(person.specialty)) continue;
      add(procedure.key, {
        kind: "rcdso-specialist",
        detail: `${person.fullName} is registered with the RCDSO as a specialist in ${person.specialty.toLowerCase()}.`,
        provenance: registerSource,
      });
    }
  }

  if (record.permits?.sedation) {
    for (const key of ["sedation-dentistry", "wisdom-teeth", "oral-surgery", "extractions"] as ProcedureKey[]) {
      add(key, {
        kind: "rcdso-sedation-permit",
        detail: "Holds an RCDSO facility permit for sedation.",
        provenance: registerSource,
      });
    }
  }

  if (record.permits?.cbct) {
    for (const key of ["dental-implants", "wisdom-teeth", "oral-surgery", "root-canal"] as ProcedureKey[]) {
      add(key, {
        kind: "rcdso-cbct-permit",
        detail: "Holds an RCDSO permit to operate a CT scanner on site.",
        provenance: registerSource,
      });
    }
  }

  return byProcedure;
}

function toClinic(record: MergedClinic): Clinic | undefined {
  if (!record.citySlug || !record.slug || !record.name) return undefined;

  const evidence = evidenceFor(record);
  const practitioners: Practitioner[] = (record.practitioners ?? []).map((person) => ({
    name: person.fullName,
    registrationNumber: person.registrationNumber,
    specialty: person.specialty,
    provenance: {
      source: "rcdso",
      url: "https://www.rcdso.org/en-ca/find-a-dentist",
      checkedAt: record.lastSeen ?? CHECKED,
    },
  }));

  return {
    slug: record.slug,
    name: record.name,
    citySlug: record.citySlug,
    address: record.address,
    postalCode: record.postalCode,
    lat: record.lat,
    lng: record.lng,
    phone: record.phone,
    website: record.website,
    email: record.email,
    hours: record.hours ?? [],
    languages: {
      value: record.languages ?? [],
      provenance: { source: "osm", checkedAt: record.lastSeen ?? CHECKED },
    },
    procedures: [...evidence.entries()].map(([procedure, list]) => buildOffering(procedure, list)),
    practitioners,
    accessibility:
      record.wheelchair === undefined
        ? {}
        : {
            wheelchairAccessible: {
              value: record.wheelchair,
              provenance: { source: "osm", checkedAt: record.lastSeen ?? CHECKED },
            },
          },
    payment: {},
    availability: {},
    tier: "unclaimed",
    sources: provenanceFor(record),
    lastUpdated: record.lastSeen ?? CHECKED,
  };
}

const RECORDS = load();

export const INGESTED_CLINICS: Clinic[] = RECORDS
  .map(toClinic)
  .filter((c): c is Clinic => Boolean(c));

/**
 * Cities are derived from the clinics rather than kept in a separate list, so a
 * city page can never exist without the clinics that justify it. The centre is
 * the mean of its clinics' coordinates, which is what a map should centre on.
 */
export const INGESTED_CITIES: City[] = (() => {
  const grouped = new Map<string, { name: string; municipality?: string; clinics: Clinic[] }>();
  for (const record of RECORDS) {
    if (!record.citySlug || !record.cityName) continue;
    const entry = grouped.get(record.citySlug) ?? {
      name: record.cityName,
      municipality: record.municipality,
      clinics: [],
    };
    grouped.set(record.citySlug, entry);
  }
  for (const clinic of INGESTED_CLINICS) {
    grouped.get(clinic.citySlug)?.clinics.push(clinic);
  }

  return [...grouped.entries()]
    .map(([slug, entry]) => {
      const n = entry.clinics.length || 1;
      return {
        slug,
        name: entry.name,
        municipality: entry.municipality === entry.name ? undefined : entry.municipality,
        region: "Ontario",
        lat: entry.clinics.reduce((sum, c) => sum + c.lat, 0) / n,
        lng: entry.clinics.reduce((sum, c) => sum + c.lng, 0) / n,
        blurb: blurbFor(entry.name, entry.municipality, entry.clinics.length),
        neighbourhoods: [],
      } satisfies City;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
})();

/**
 * A city blurb states what the page actually contains. It is deliberately dull:
 * a sentence claiming a city is "home to excellent dentists" is both unverified
 * and the kind of superlative the RCDSO's advertising guidelines prohibit.
 */
function blurbFor(name: string, municipality: string | undefined, count: number): string {
  const where = municipality && municipality !== name ? ` in ${municipality}` : "";
  return count === 1
    ? `One dental practice listed${where ? ` in ${name},${where.slice(4)}` : ` in ${name}`}, with its location, contact details and the sources behind them.`
    : `${count} dental practices listed in ${name}${where ? `,${where.slice(3)}` : ""}, with locations, contact details and the sources behind them.`;
}
