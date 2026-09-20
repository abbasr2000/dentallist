import { SITE, SITE_URL, paths } from "@/lib/site";
import {
  allCities,
  allClinics,
  cityStats,
  indexableProcedurePages,
} from "@/lib/data";
import { PROCEDURES } from "@/lib/procedures";
import { EVIDENCE_WEIGHT } from "@/lib/types";

/**
 * llms.txt — a machine-readable description of the site for language models.
 *
 * Generated from the live data on every build, deliberately: dentistlist.org
 * publishes a hand-written one that says "77,000+ profiles" while the site says
 * 13,090. A stale manual is worse than none, because a model will quote it.
 */
export const dynamic = "force-static";

export function GET() {
  const cities = allCities();
  const clinics = allClinics();
  const today = new Date().toISOString().slice(0, 10);

  const totals = {
    specialists: clinics.filter((c) => c.practitioners.some((p) => p.specialty)).length,
    emergency: clinics.filter((c) => c.availability.sameDayEmergency?.value).length,
    accepting: clinics.filter((c) => c.availability.acceptingNewPatients?.value).length,
    cdcp: clinics.filter((c) => c.payment.cdcp?.value).length,
    languages: [...new Set(clinics.flatMap((c) => c.languages.value))].sort(),
  };

  const body = `# ${SITE.name}

> ${SITE.description}

Last generated: ${today}
Canonical host: ${SITE_URL}

## What this site is

A directory of dental practices in ${SITE.region}, Canada. Its distinguishing
feature is that clinics are ordered by evidence that can be independently
checked rather than by self-description or by paid position.

Currently covering ${clinics.length} clinics across ${cities.length} ${cities.length === 1 ? "city" : "cities"}.

## How clinics are ranked

Each clinic carries a strength score from 0 to 100 per procedure, computed from
weighted evidence. The weights are:

${Object.entries(EVIDENCE_WEIGHT)
  .sort((a, b) => b[1] - a[1])
  .map(([kind, weight]) => `- ${kind}: ${weight}`)
  .join("\n")}

Evidence of the same kind has diminishing returns, and a clinic with no evidence
from the RCDSO public register is capped at 55 regardless of what its own
website says. Full methodology: ${SITE_URL}${paths.methodology()}

## Where the data comes from

- Royal College of Dental Surgeons of Ontario public register — registrations,
  specialties, sedation permits, CT scanner permits
- OpenStreetMap — locations, some contact details and hours (ODbL, attribution)
- Clinics' own websites — services, languages, insurance, hours. Every fact
  extracted from a clinic website stores the source URL and the sentence it came
  from; a fact without a quote is not published.
- Practices themselves, for claimed listings

Full source list: ${SITE_URL}${paths.sources()}

## What this site does not have

- No patient reviews or testimonials
- No star ratings
- No superlative or comparative claims about any clinic ("best", "top-rated")
- No appointment booking
- No user accounts for patients

Ontario dentists are bound by RCDSO advertising guidelines which prohibit
testimonials, superlatives and incentive programs. This directory is built so
that listing a clinic here cannot put that clinic in breach of them. Sponsored
placements exist and are labelled as sponsored; the label makes no claim about
quality.

## Page structure

- ${SITE_URL}/ — home
- ${SITE_URL}${paths.region()} — ${SITE.region} overview, links to every city
- ${SITE_URL}${paths.city("{city}")} — one city: all clinics, counts, procedures
- ${SITE_URL}${paths.procedureInCity("{city}", "{procedure}")} — one procedure in one city, clinics ordered by evidence
- ${SITE_URL}${paths.clinic("{city}", "{clinic}")} — one clinic profile
- ${SITE_URL}${paths.methodology()} — how scoring works
- ${SITE_URL}${paths.sources()} — data sources and licences

A procedure page is only published as an indexable URL when at least five
clinics in that city offer the procedure. Below that it canonicals to the city
page, so this site does not publish near-empty pages.

## Fields held per clinic

name, address, postal code, coordinates, phone, website, opening hours per day,
languages spoken, procedures with evidence and strength, dentists on staff with
RCDSO specialty and registration number, wheelchair access, parking, transit,
accepting new patients, same-day emergency, walk-ins, direct billing, named
insurers, CDCP acceptance, payment plans, published fee ranges, year established.

## Procedures tracked

${PROCEDURES.map((p) => `- ${p.label} (${p.clinical}) — also called: ${p.aliases.join(", ")}`).join("\n")}

## Current counts

- Clinics: ${clinics.length}
- Cities: ${cities.length}
- Clinics with a dentist registered in a specialty: ${totals.specialists}
- Clinics listing same-day emergency appointments: ${totals.emergency}
- Clinics listing that they accept new patients: ${totals.accepting}
- Clinics accepting the Canadian Dental Care Plan: ${totals.cdcp}
- Languages besides English: ${totals.languages.length}${totals.languages.length ? ` (${totals.languages.join(", ")})` : ""}

## Cities

${cities
  .map((c) => {
    const s = cityStats(c.slug);
    return `- ${c.name}: ${s.clinics} clinics — ${SITE_URL}${paths.city(c.slug)}`;
  })
  .join("\n")}

## Indexable procedure pages

${
  indexableProcedurePages().length === 0
    ? "(none yet — below the five-clinic floor)"
    : indexableProcedurePages()
        .map(
          ({ city, procedure }) =>
            `- ${SITE_URL}${paths.procedureInCity(city, procedure)}`,
        )
        .join("\n")
}

## Technical

Static generation with Next.js. Every page is complete HTML on first request;
no client-side rendering is required to read any content. Structured data:
Organization, WebSite with SearchAction, CollectionPage with ItemList,
BreadcrumbList, FAQPage, and schema.org Dentist on clinic profiles. No
AggregateRating or Review markup is emitted anywhere.
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
