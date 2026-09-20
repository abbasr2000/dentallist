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

/**
 * The host every absolute URL is built from, in order of preference:
 *
 * 1. `NEXT_PUBLIC_SITE_URL` — set this once a real domain exists. It wins
 *    everywhere, including on Vercel.
 * 2. `VERCEL_PROJECT_PRODUCTION_URL` — Vercel sets this at build time to the
 *    project's stable production host. Preview deployments get it too, so a
 *    preview's canonicals point at production rather than at a build-specific
 *    URL that will not exist next week. That is what canonicals are for.
 * 3. A placeholder, so a local build still produces well-formed URLs.
 *
 * The placeholder must never reach production: a sitemap full of
 * example.invalid is worse than no sitemap, so the build fails instead.
 */
export function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit;

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return vercel.startsWith("http") ? vercel : `https://${vercel}`;

  if (process.env.VERCEL) {
    throw new Error(
      "Building on Vercel with no host. Expected VERCEL_PROJECT_PRODUCTION_URL " +
        "or NEXT_PUBLIC_SITE_URL; shipping canonicals and a sitemap pointing at " +
        "example.invalid would be worse than shipping neither.",
    );
  }

  return "https://example.invalid";
}

export const SITE_URL = resolveSiteUrl().replace(/\/$/, "");

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
