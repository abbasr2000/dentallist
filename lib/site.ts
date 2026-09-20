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
 *    project's stable production host. Preview builds get it too, which is
 *    what canonicals want: a preview should point at production, not at a
 *    build-specific URL that stops existing next week.
 * 3. `VERCEL_URL` — the deployment's own host. A poor canonical, because it is
 *    unique per deployment, but a real resolvable host and therefore far
 *    better than the placeholder. Only reached if Vercel stops setting the
 *    variable above.
 * 4. A placeholder, for local builds.
 *
 * The placeholder must never reach production. A sitemap of 3,000 URLs on a
 * domain that cannot resolve tells a crawler the site does not know where it
 * lives, so on Vercel we take any real host over it and say so in the log.
 */
export function resolveSiteUrl(): string {
  const withScheme = (host: string) =>
    host.startsWith("http") ? host : `https://${host}`;

  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return withScheme(explicit);

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return withScheme(production);

  const deployment = process.env.VERCEL_URL?.trim();
  if (deployment) {
    console.warn(
      "[site] VERCEL_PROJECT_PRODUCTION_URL is unset; canonicals will point at " +
        "this deployment's own URL. Set NEXT_PUBLIC_SITE_URL to the real domain.",
    );
    return withScheme(deployment);
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
