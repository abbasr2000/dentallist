import type { MetadataRoute } from "next";
import { SITE, absolute, paths } from "@/lib/site";
import {
  allCities,
  allClinics,
  cityPageIsIndexable,
  indexableProcedurePages,
  rankedForProcedureInRegion,
} from "@/lib/data";
import { PROCEDURES } from "@/lib/procedures";

/**
 * Only indexable URLs go in here.
 *
 * A procedure page below the data floor renders but is excluded, and its
 * canonical points at the city page. Sitemap and canonical have to agree —
 * listing a page you have canonicalled away is a contradictory signal.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: absolute(paths.home()), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: absolute(paths.region()), lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: absolute(paths.methodology()), lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: absolute(paths.sources()), lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];

  const cities: MetadataRoute.Sitemap = allCities()
    .filter((c) => cityPageIsIndexable(c.slug))
    .map((c) => ({
      url: absolute(paths.city(c.slug)),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));

  // Province-wide procedure pages rank above the city ones and always have
  // enough behind them, so they carry a higher priority.
  const regionProcedures: MetadataRoute.Sitemap = PROCEDURES
    .filter((proc) => rankedForProcedureInRegion(proc.key).length > 0)
    .map((proc) => ({
      url: absolute(paths.procedureInRegion(proc.key)),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.85,
    }));

  const procedures: MetadataRoute.Sitemap = indexableProcedurePages().map(
    ({ city, procedure }) => ({
      url: absolute(paths.procedureInCity(city, procedure)),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }),
  );

  const clinics: MetadataRoute.Sitemap = allClinics().map((c) => ({
    url: absolute(paths.clinic(c.citySlug, c.slug)),
    lastModified: new Date(c.lastUpdated),
    changeFrequency: "monthly" as const,
    priority: c.tier === "unclaimed" ? 0.5 : 0.6,
  }));

  return [...staticPages, ...regionProcedures, ...cities, ...procedures, ...clinics];
}
