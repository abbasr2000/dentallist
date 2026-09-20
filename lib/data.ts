import { CITIES, CLINICS } from "@/data/seed";
import { PROCEDURES, type ProcedureKey } from "./procedures";
import { completeness, type CompletenessInput } from "./strength";
import { INDEX_FLOOR } from "./site";
import type { City, Clinic } from "./types";

/**
 * Read layer.
 *
 * Every page goes through these functions rather than touching the data source
 * directly, so swapping the development seed for Supabase is one file's worth
 * of change. Sorting and the indexability floor live here too, because a page
 * and its sitemap entry must agree on both.
 */

export function allCities(): City[] {
  return CITIES;
}

export function getCity(slug: string): City | undefined {
  return CITIES.find((c) => c.slug === slug);
}

export function clinicsInCity(citySlug: string): Clinic[] {
  return CLINICS.filter((c) => c.citySlug === citySlug);
}

export function getClinic(citySlug: string, slug: string): Clinic | undefined {
  return CLINICS.find((c) => c.citySlug === citySlug && c.slug === slug);
}

export function allClinics(): Clinic[] {
  return CLINICS;
}

/* ------------------------------------------------------------- derived */

export function completenessInput(clinic: Clinic): CompletenessInput {
  return {
    hasPhone: Boolean(clinic.phone),
    hasWebsite: Boolean(clinic.website),
    hasHours: clinic.hours.length > 0,
    hasProcedures: clinic.procedures.length > 0,
    hasLanguages: clinic.languages.value.length > 0,
    hasPractitioners: clinic.practitioners.length > 0,
    hasAccessibility: Object.keys(clinic.accessibility).length > 0,
    hasPaymentInfo: Object.keys(clinic.payment).length > 0,
    hasAvailability: Object.keys(clinic.availability).length > 0,
    hasFees: Boolean(clinic.payment.publishedFees?.value.length),
    hasPhotos: Boolean(clinic.photos?.length),
    isClaimed: clinic.tier !== "unclaimed",
  };
}

export function clinicCompleteness(clinic: Clinic): number {
  return completeness(completenessInput(clinic));
}

export function strengthFor(clinic: Clinic, procedure: ProcedureKey): number {
  return clinic.procedures.find((p) => p.procedure === procedure)?.strength ?? 0;
}

export function offeringFor(clinic: Clinic, procedure: ProcedureKey) {
  return clinic.procedures.find((p) => p.procedure === procedure);
}

/* ------------------------------------------------------------- ordering */

/**
 * Default city-page order: completeness, then name.
 *
 * Featured listings are NOT mixed into this order. They render in a separate,
 * labelled block above it — RCDSO advertising guidelines prohibit superlatives
 * and implied superiority for Ontario registrants, so paid placement has to be
 * visibly paid placement rather than an unexplained position at the top.
 */
export function rankedForCity(citySlug: string): Clinic[] {
  return clinicsInCity(citySlug)
    .filter((c) => c.tier !== "featured")
    .sort(
      (a, b) =>
        clinicCompleteness(b) - clinicCompleteness(a) ||
        a.name.localeCompare(b.name),
    );
}

export function featuredForCity(citySlug: string): Clinic[] {
  return clinicsInCity(citySlug).filter((c) => c.tier === "featured");
}

/** Clinics that offer a procedure, strongest evidence first. */
export function rankedForProcedure(
  citySlug: string,
  procedure: ProcedureKey,
): Clinic[] {
  return clinicsInCity(citySlug)
    .filter((c) => strengthFor(c, procedure) > 0)
    .sort(
      (a, b) =>
        strengthFor(b, procedure) - strengthFor(a, procedure) ||
        clinicCompleteness(b) - clinicCompleteness(a) ||
        a.name.localeCompare(b.name),
    );
}

export function clinicsInNeighbourhood(
  citySlug: string,
  neighbourhoodSlug: string,
): Clinic[] {
  return clinicsInCity(citySlug).filter(
    (c) => c.neighbourhoodSlug === neighbourhoodSlug,
  );
}

/* ------------------------------------------------------- indexability */

/**
 * Whether a procedure page for this city deserves its own indexable URL.
 *
 * Below the floor the page still renders (someone following a link should see
 * something useful) but carries a canonical to the city page and stays out of
 * the sitemap. This is the guard against shipping thousands of near-empty
 * pages, which is how programmatic SEO earns a manual action.
 */
export function procedurePageIsIndexable(
  citySlug: string,
  procedure: ProcedureKey,
): boolean {
  return (
    rankedForProcedure(citySlug, procedure).length >=
    INDEX_FLOOR.clinicsPerProcedurePage
  );
}

export function cityPageIsIndexable(citySlug: string): boolean {
  return clinicsInCity(citySlug).length >= INDEX_FLOOR.clinicsPerCityPage;
}

/** Every (city, procedure) pair worth building a page for. */
export function indexableProcedurePages(): Array<{
  city: string;
  procedure: ProcedureKey;
}> {
  const out: Array<{ city: string; procedure: ProcedureKey }> = [];
  for (const city of CITIES) {
    for (const proc of PROCEDURES) {
      if (procedurePageIsIndexable(city.slug, proc.key)) {
        out.push({ city: city.slug, procedure: proc.key });
      }
    }
  }
  return out;
}

/* ----------------------------------------------------------- counting */

/** The counted facts that go in page copy, headings and llms.txt. */
export interface CityStats {
  clinics: number;
  acceptingNewPatients: number;
  sameDayEmergency: number;
  directBilling: number;
  cdcp: number;
  wheelchairAccessible: number;
  withPublishedFees: number;
  languages: string[];
  specialists: number;
  openSaturday: number;
}

export function cityStats(citySlug: string): CityStats {
  const clinics = clinicsInCity(citySlug);
  const languages = new Set<string>();
  for (const c of clinics) for (const l of c.languages.value) languages.add(l);

  const count = (fn: (c: Clinic) => boolean) => clinics.filter(fn).length;

  return {
    clinics: clinics.length,
    acceptingNewPatients: count((c) => c.availability.acceptingNewPatients?.value === true),
    sameDayEmergency: count((c) => c.availability.sameDayEmergency?.value === true),
    directBilling: count((c) => c.payment.directBilling?.value === true),
    cdcp: count((c) => c.payment.cdcp?.value === true),
    wheelchairAccessible: count((c) => c.accessibility.wheelchairAccessible?.value === true),
    withPublishedFees: count((c) => Boolean(c.payment.publishedFees?.value.length)),
    languages: [...languages].sort(),
    specialists: count((c) => c.practitioners.some((p) => p.specialty)),
    openSaturday: count((c) => c.hours.some((h) => h.day === 6)),
  };
}

export function procedureCountsForCity(
  citySlug: string,
): Array<{ procedure: ProcedureKey; count: number }> {
  return PROCEDURES.map((p) => ({
    procedure: p.key,
    count: rankedForProcedure(citySlug, p.key).length,
  })).filter((r) => r.count > 0);
}
