/**
 * What the merged data actually looks like, in the terms that decide whether
 * the site is worth publishing.
 *
 * A record count tells you a run finished. It does not tell you the run was
 * any good: a merge key that collapses distinct practices produces a smaller,
 * tidier-looking file, and a specialty that stops matching produces a file of
 * exactly the same size. So this reports the things that would be wrong if
 * something were wrong — how many clinics carry a specialist, how many cities
 * clear the floor a procedure page needs, and whether any one "clinic" has
 * absorbed a number of dentists no single practice has.
 *
 * Run: npx tsx ingest/report.ts
 */
import { readJson } from "./lib";
import { INDEX_FLOOR } from "../lib/site";
import { proceduresForSpecialty } from "../lib/procedures";

interface Clinic {
  slug: string;
  name: string;
  citySlug: string;
  cityName?: string;
  address?: string;
  phone?: string;
  website?: string;
  practitioners: Array<{ fullName: string; registrationNumber?: string; specialty?: string }>;
  sources: Array<{ source: string; sourceId: string }>;
  reviewReason?: string;
}

/**
 * Ontario's largest dental groups run to a few dozen dentists at one address.
 * Past that, a single merged record is far more likely to be a merge fault
 * than a real practice, so it is worth a human look either way.
 */
const IMPLAUSIBLE_PRACTITIONERS = 40;

function tally<T>(items: T[], key: (item: T) => string | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function sorted(map: Map<string, number>): Array<[string, number]> {
  return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function main() {
  const clinics = readJson<Clinic[]>("ingest/out/clinics.json");
  if (!clinics) {
    console.error("No ingest/out/clinics.json. Run ingest/merge.ts first.");
    process.exit(1);
  }

  const lines: string[] = [];
  const say = (s = "") => {
    lines.push(s);
    console.log(s);
  };

  const bySource = tally(
    clinics.flatMap((c) => [...new Set(c.sources.map((s) => s.source))]),
    (s) => s,
  );
  const both = clinics.filter(
    (c) => new Set(c.sources.map((s) => s.source)).size > 1,
  ).length;

  say("## Coverage");
  say();
  say(`- **${clinics.length}** clinics`);
  for (const [source, count] of sorted(bySource)) {
    say(`- ${count} seen by ${source}`);
  }
  say(`- ${both} confirmed by more than one source`);
  say(`- ${clinics.filter((c) => c.address).length} with a street address`);
  say(`- ${clinics.filter((c) => c.phone).length} with a phone number`);
  say(`- ${clinics.filter((c) => c.website).length} with a website`);
  say(`- ${clinics.filter((c) => c.reviewReason).length} matched loosely, flagged for review`);

  const unassigned = clinics.filter((c) => c.citySlug === "unassigned").length;
  const cities = tally(clinics, (c) => (c.citySlug === "unassigned" ? undefined : c.citySlug));
  say();
  say("## Places");
  say();
  say(`- ${cities.size} cities, ${unassigned} clinics not placed in one`);
  const topCities = sorted(cities).slice(0, 10);
  say(`- Largest: ${topCities.map(([slug, n]) => `${slug} (${n})`).join(", ")}`);

  /* ---------------------------------------------------------- specialists */

  const specialists = clinics.filter((c) => c.practitioners.some((p) => p.specialty));
  const bySpecialty = tally(
    clinics.flatMap((c) => c.practitioners),
    (p) => p.specialty,
  );

  say();
  say("## Registered specialists");
  say();
  say(`- **${specialists.length}** clinics have at least one registered specialist`);
  if (bySpecialty.size === 0) {
    say("- **No specialty registrations at all.** Every procedure page will be empty.");
  }
  for (const [specialty, count] of sorted(bySpecialty)) {
    const procedures = proceduresForSpecialty(specialty).map((p) => p.key);
    const maps = procedures.length > 0 ? procedures.join(", ") : "**maps to no procedure**";
    say(`- ${count} × ${specialty} → ${maps}`);
  }

  /* ------------------------------------------------- pages this will build */

  const perCityProcedure = new Map<string, number>();
  const perProcedure = new Map<string, number>();
  for (const clinic of clinics) {
    if (clinic.citySlug === "unassigned") continue;
    const keys = new Set(
      clinic.practitioners
        .flatMap((p) => (p.specialty ? proceduresForSpecialty(p.specialty) : []))
        .map((p) => p.key),
    );
    for (const key of keys) {
      perProcedure.set(key, (perProcedure.get(key) ?? 0) + 1);
      const pair = `${clinic.citySlug}/${key}`;
      perCityProcedure.set(pair, (perCityProcedure.get(pair) ?? 0) + 1);
    }
  }

  const floor = INDEX_FLOOR.clinicsPerProcedurePage;
  const indexable = [...perCityProcedure.values()].filter((n) => n >= floor).length;

  say();
  say("## Pages with something on them");
  say();
  say(`- ${perProcedure.size} province-wide procedure pages`);
  for (const [key, count] of sorted(perProcedure)) {
    say(`  - /${key}/ — ${count} clinics`);
  }
  say(
    `- ${indexable} procedure-by-city pages clear the floor of ${floor} clinics ` +
      `(of ${perCityProcedure.size} city/procedure pairs with any clinic at all)`,
  );

  /* ------------------------------------------------------ merge sanity */

  const oversized = clinics
    .filter((c) => c.practitioners.length >= IMPLAUSIBLE_PRACTITIONERS)
    .sort((a, b) => b.practitioners.length - a.practitioners.length);

  say();
  say("## Merge sanity");
  say();
  if (oversized.length === 0) {
    say(`- No clinic has ${IMPLAUSIBLE_PRACTITIONERS} or more dentists at one record.`);
  } else {
    say(
      `- **${oversized.length} clinics carry ${IMPLAUSIBLE_PRACTITIONERS}+ dentists.** ` +
        "Ontario's largest practices run to a few dozen, so check these are real " +
        "before trusting the merge:",
    );
    for (const clinic of oversized.slice(0, 15)) {
      say(
        `  - ${clinic.practitioners.length} — ${clinic.name}, ` +
          `${clinic.address ?? "no address"}, ${clinic.cityName ?? clinic.citySlug}`,
      );
    }
  }

  const nameless = clinics.filter((c) => !c.name.trim()).length;
  if (nameless > 0) say(`- **${nameless} clinics have no name.**`);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const fs = require("node:fs") as typeof import("node:fs");
    fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`);
  }
}

if (require.main === module) main();
