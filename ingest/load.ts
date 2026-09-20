/**
 * Load merged clinics into Supabase.
 *
 * Idempotent: re-running upserts rather than duplicating, so the monthly
 * refresh is safe to run as often as you like. Cities are created on demand
 * from whatever the sources reported, with a placeholder blurb — city copy is
 * editorial and gets written by hand, not generated.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The service role key
 * bypasses row-level security, so this script is for CI and local operator
 * use only; it must never ship to the browser.
 *
 * Run: npx tsx ingest/load.ts [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { readJson, slugify } from "./lib";

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
}

/** Procedures a facility permit is evidence for. */
const PERMIT_EVIDENCE: Record<"sedation" | "cbct", string[]> = {
  sedation: ["sedation-dentistry", "wisdom-teeth", "oral-surgery", "extractions"],
  cbct: ["dental-implants", "root-canal", "wisdom-teeth"],
};

/** RCDSO specialty → the procedures it is evidence of competence in. */
const SPECIALTY_EVIDENCE: Record<string, string[]> = {
  Endodontics: ["root-canal"],
  Periodontics: ["gum-disease", "dental-implants"],
  Prosthodontics: ["dentures", "crowns-and-bridges", "dental-implants", "cosmetic-dentistry"],
  "Oral and Maxillofacial Surgery": ["oral-surgery", "wisdom-teeth", "extractions", "dental-implants"],
  "Orthodontics and Dentofacial Orthopedics": ["orthodontics", "invisalign"],
  "Pediatric Dentistry": ["pediatric-dentistry"],
  "Dental Anaesthesia": ["sedation-dentistry"],
};

function titleCase(slug: string): string {
  return slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun && (!url || !key)) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --dry-run.");
    process.exit(1);
  }

  const clinics = readJson<MergedClinic[]>("ingest/out/clinics.json");
  if (!clinics) {
    console.error("No ingest/out/clinics.json. Run ingest/merge.ts first.");
    process.exit(1);
  }

  // Build everything in memory first so a dry run shows exactly what would be
  // written, and so the real run is a handful of bulk upserts rather than
  // thousands of round trips.
  const cities = new Map<string, { slug: string; name: string; region: string }>();
  const clinicRows: Array<Record<string, unknown>> = [];
  const evidenceRows: Array<Record<string, unknown>> = [];
  const practitionerRows: Array<Record<string, unknown>> = [];

  for (const clinic of clinics) {
    const citySlug = clinic.citySlug || "unknown";
    if (!cities.has(citySlug)) {
      cities.set(citySlug, { slug: citySlug, name: titleCase(citySlug), region: "Ontario" });
    }

    clinicRows.push({
      slug: clinic.slug,
      name: clinic.name,
      city_slug: citySlug,
      address: clinic.address ?? null,
      postal_code: clinic.postalCode ?? null,
      phone: clinic.phone ?? null,
      website: clinic.website ?? null,
      location:
        clinic.lat != null && clinic.lng != null
          ? `SRID=4326;POINT(${clinic.lng} ${clinic.lat})`
          : null,
      last_updated: new Date().toISOString(),
    });

    for (const person of clinic.practitioners) {
      practitionerRows.push({
        full_name: person.fullName,
        registration_number: person.registrationNumber ?? null,
        specialty: person.specialty ?? null,
      });

      for (const procedure of SPECIALTY_EVIDENCE[person.specialty ?? ""] ?? []) {
        evidenceRows.push({
          clinic_slug: clinic.slug,
          city_slug: citySlug,
          procedure_key: procedure,
          kind: "rcdso-specialist",
          detail: `${person.specialty} registered at this practice — ${person.fullName}`,
        });
      }
    }

    for (const permit of ["sedation", "cbct"] as const) {
      if (!clinic.permits[permit]) continue;
      const detail =
        permit === "sedation"
          ? "Facility sedation permit on the RCDSO register"
          : "Facility CT scanner permit on the RCDSO register";
      for (const procedure of PERMIT_EVIDENCE[permit]) {
        evidenceRows.push({
          clinic_slug: clinic.slug,
          city_slug: citySlug,
          procedure_key: procedure,
          kind: permit === "sedation" ? "rcdso-sedation-permit" : "rcdso-cbct-permit",
          detail,
        });
      }
    }
  }

  console.log(`Prepared:`);
  console.log(`  ${cities.size} cities`);
  console.log(`  ${clinicRows.length} clinics`);
  console.log(`  ${practitionerRows.length} practitioner records`);
  console.log(`  ${evidenceRows.length} pieces of register-backed evidence`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written. Sample clinic row:");
    console.log(JSON.stringify(clinicRows[0], null, 2));
    return;
  }

  const db = createClient(url!, key!, { auth: { persistSession: false } });

  console.log("\nWriting…");
  const { error: cityError } = await db
    .from("city")
    .upsert([...cities.values()], { onConflict: "slug" });
  if (cityError) throw cityError;
  console.log(`  cities ok`);

  // Chunked: a few thousand rows in one request will time out.
  for (let i = 0; i < clinicRows.length; i += 500) {
    const chunk = clinicRows.slice(i, i + 500);
    const { error } = await db
      .from("clinic")
      .upsert(chunk, { onConflict: "city_slug,slug" });
    if (error) throw error;
    console.log(`  clinics ${Math.min(i + 500, clinicRows.length)}/${clinicRows.length}`);
  }

  console.log("\nDone. Evidence rows need clinic ids, which the SQL side resolves:");
  console.log("  see supabase/migrations/0002_link_evidence.sql");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
