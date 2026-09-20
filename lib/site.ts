/**
 * Site-wide configuration.
 *
 * `SITE_URL` is read from the environment so the domain can be decided later
 * without touching page code. Everything that needs an absolute URL —
 * canonicals, sitemaps, JSON-LD, llms.txt — goes through `absolute()`.
 */
export const SITE = {
  name: "Ontario Dental Directory",
  shortName: "OntarioDental",
  tagline: "Find a dentist by what they actually do",
  description:
    "Every dental clinic in Ontario, ranked by verifiable evidence of what they treat — registered specialists, sedation permits and published services.",
  region: "Ontario",
  regionSlug: "ontario",
  locale: "en-CA",
} as const;

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.invalid"
).replace(/\/$/, "");

export function absolute(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/* ------------------------------------------------------------------ paths */

export const paths = {
  home: () => "/",
  region: () => `/${SITE.regionSlug}/`,
  city: (city: string) => `/${SITE.regionSlug}/${city}/`,
  // Province-wide, e.g. /ontario/orthodontics/. "Orthodontist in Ontario" has
  // to land somewhere, and it is the one procedure URL certain to clear the
  // data floor.
  procedureInRegion: (procedure: string) => `/${SITE.regionSlug}/${procedure}/`,
  procedureInCity: (city: string, procedure: string) =>
    `/${SITE.regionSlug}/${city}/${procedure}/`,
  clinic: (city: string, slug: string) => `/clinic/${city}/${slug}/`,
  methodology: () => "/methodology/",
  sources: () => "/sources/",
  addClinic: () => "/add-clinic/",
};

/**
 * The floor a generated page has to clear to get its own indexable URL.
 *
 * Programmatic SEO gets penalised when it ships thousands of near-empty pages.
 * A procedure page for a city with two clinics is not worth landing on, so it
 * canonicals to the city page instead of competing as its own URL.
 */
export const INDEX_FLOOR = {
  clinicsPerProcedurePage: 5,
  clinicsPerCityPage: 3,
} as const;
