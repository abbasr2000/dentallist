import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SITE, paths, INDEX_FLOOR } from "@/lib/site";
import {
  citiesWithProcedure,
  rankedForProcedureInRegion,
} from "@/lib/data";
import { getProcedure } from "@/lib/procedures";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ClinicRow } from "@/components/ClinicRow";
import { JsonLd } from "@/components/JsonLd";
import { Faq } from "@/components/Faq";
import * as S from "@/lib/schema";

/**
 * Procedure across the whole province, e.g. /ontario/orthodontics/.
 *
 * Every procedure-by-city page has a data floor to clear, and outside the big
 * cities most will not clear it — Ontario's 431 orthodontists are spread over
 * 500 municipalities. Without this page, "orthodontist in Ontario" has nowhere
 * to land and the city pages that fall below the floor point at nothing.
 *
 * It also does the work a hub page should: it lists which cities have depth in
 * this procedure, so a reader who wants to narrow down can, and the city pages
 * that are worth indexing get linked from somewhere that is.
 */

/** A city page is worth linking only if someone can act on it. */
const CITIES_LISTED = 40;
const CLINICS_LISTED = 60;

/** Metadata for the province-wide page, or undefined if this is not a procedure. */
export function regionProcedureMetadata(procedureKey: string): Metadata | undefined {
  const proc = getProcedure(procedureKey);
  if (!proc) return undefined;

  const clinics = rankedForProcedureInRegion(proc.key);
  if (clinics.length === 0) return undefined;
  const cities = citiesWithProcedure(proc.key);

  return {
    title: `${proc.label} in ${SITE.region} — ${clinics.length} ${clinics.length === 1 ? "clinic" : "clinics"} across ${cities.length} ${cities.length === 1 ? "city" : "cities"}`,
    description: `Dental clinics across ${SITE.region} listed for ${proc.label.toLowerCase()}, ordered by verifiable evidence from the RCDSO public register. ${proc.whatMatters}`,
    alternates: { canonical: paths.procedureInRegion(proc.key) },
  };
}

export function RegionProcedure({ procedureKey }: { procedureKey: string }) {
  const proc = getProcedure(procedureKey);
  if (!proc) notFound();

  const clinics = rankedForProcedureInRegion(proc.key);
  if (clinics.length === 0) notFound();

  const cities = citiesWithProcedure(proc.key);
  const withRegisterEvidence = clinics.filter((c) =>
    c.procedures
      .find((p) => p.procedure === proc.key)
      ?.evidence.some((e) => e.kind.startsWith("rcdso-")),
  ).length;

  const trail = [
    { name: "Home", path: paths.home() },
    { name: SITE.region, path: paths.region() },
    { name: proc.label, path: paths.procedureInRegion(proc.key) },
  ];

  const shown = clinics.slice(0, CLINICS_LISTED);

  const faq = [
    {
      question: `Who does ${proc.label.toLowerCase()} in ${SITE.region}?`,
      answer: `${clinics.length} clinic${clinics.length === 1 ? "" : "s"} across ${cities.length} ${SITE.region} ${cities.length === 1 ? "city" : "cities"}${withRegisterEvidence > 0 ? `, ${withRegisterEvidence} of them with evidence on the RCDSO public register rather than only their own description` : ""}.`,
    },
    {
      question: `What should I look for in a ${proc.label.toLowerCase()} provider?`,
      answer: proc.whatMatters,
    },
    { question: `What is ${proc.label.toLowerCase()}?`, answer: proc.blurb },
  ];

  return (
    <>
      <JsonLd
        json={S.graph(
          S.regionProcedurePage(proc.key, shown),
          S.breadcrumbs(trail),
          S.faqPage(faq),
        )}
      />

      <div className="wrap" style={{ paddingBlock: "32px 40px" }}>
        <Breadcrumbs trail={trail} />

        <h1 style={{ fontSize: "clamp(1.8rem, 4.5vw, 2.4rem)", marginBottom: 14 }}>
          {proc.label} in {SITE.region}
        </h1>

        <p style={{ fontSize: "1.05rem", color: "var(--color-ink-soft)", maxWidth: "62ch", marginBottom: 10 }}>
          {proc.blurb}
        </p>
        <p style={{ fontSize: "1.05rem", color: "var(--color-ink-soft)", maxWidth: "62ch", marginBottom: 24 }}>
          {clinics.length} clinic{clinics.length === 1 ? "" : "s"} across {cities.length}{" "}
          {cities.length === 1 ? "city" : "cities"}
          {withRegisterEvidence > 0 &&
            `, ${withRegisterEvidence} with evidence on the RCDSO public register`}
          .
        </p>

        {proc.aliases.length > 0 && (
          <p style={{ fontSize: 14, color: "var(--color-ink-faint)", marginBottom: 24 }}>
            Also called: {proc.aliases.join(", ")}
          </p>
        )}

        <div className="panel prose-col" style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: "1.05rem", marginBottom: 8 }}>
            What separates a strong {proc.short.toLowerCase()} provider
          </h2>
          <p style={{ margin: 0, fontSize: 15.5, color: "var(--color-ink-soft)" }}>
            {proc.whatMatters}
          </p>
          {proc.relatedSpecialties.length > 0 && (
            <p style={{ margin: "10px 0 0", fontSize: 14.5, color: "var(--color-ink-soft)" }}>
              Relevant RCDSO specialties:{" "}
              <strong>{proc.relatedSpecialties.join(", ")}</strong>
            </p>
          )}
        </div>

        {cities.length > 1 && (
          <section style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: "1.2rem", marginBottom: 4 }}>By city</h2>
            <p style={{ fontSize: 14, color: "var(--color-ink-faint)", marginBottom: 12 }}>
              A city needs {INDEX_FLOOR.clinicsPerProcedurePage} clinics before it
              gets its own {proc.short.toLowerCase()} page. The rest are listed
              here so they are not lost.
            </p>
            <ul style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", fontSize: 15 }}>
              {cities.slice(0, CITIES_LISTED).map(({ city, count, indexable }) => (
                <li key={city.slug}>
                  <a
                    href={indexable ? paths.procedureInCity(city.slug, proc.key) : paths.city(city.slug)}
                    className="inline-link"
                  >
                    {city.name}
                  </a>{" "}
                  <span style={{ color: "var(--color-ink-faint)" }}>({count})</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <h2 style={{ fontSize: "1.2rem", marginBottom: 4 }}>
          Clinics, strongest evidence first
        </h2>
        <p style={{ fontSize: 14, color: "var(--color-ink-faint)", marginBottom: 8 }}>
          Ordered by what kind of evidence sits behind the service. A specialty
          registration on the RCDSO register outranks a service listed on a
          clinic&rsquo;s own website.{" "}
          <a href={paths.methodology()} className="inline-link">How this works</a>
        </p>
        <ul>
          {shown.map((clinic) => (
            <ClinicRow key={`${clinic.citySlug}/${clinic.slug}`} clinic={clinic} highlight={proc.key} />
          ))}
        </ul>

        {clinics.length > shown.length && (
          <p style={{ marginTop: 16, fontSize: 14.5, color: "var(--color-ink-faint)" }}>
            Showing {shown.length} of {clinics.length}. Narrow by city above for
            the rest.
          </p>
        )}

        <Faq items={faq} />

        <p style={{ marginTop: 36, fontSize: 14.5 }}>
          <a href={paths.region()} className="inline-link">
            All dental clinics in {SITE.region}
          </a>
        </p>
      </div>
    </>
  );
}
