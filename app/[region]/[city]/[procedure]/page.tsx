import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SITE, paths } from "@/lib/site";
import {
  getCity,
  indexableProcedurePages,
  procedurePageIsIndexable,
  rankedForProcedure,
} from "@/lib/data";
import { getProcedure } from "@/lib/procedures";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ClinicRow } from "@/components/ClinicRow";
import { JsonLd } from "@/components/JsonLd";
import { Faq } from "@/components/Faq";
import * as S from "@/lib/schema";

/**
 * Procedure-by-city pages.
 *
 * This is the gap dentistlist.org leaves open — they render procedures as
 * sections inside a city page and 404 on the dedicated URL, so the highest
 * intent queries in the vertical have nothing to land on.
 *
 * Pages below the data floor still render (a link should not 404) but carry a
 * canonical to the city page and stay out of the sitemap, so we never ship a
 * near-empty URL as an indexable page.
 */

export function generateStaticParams() {
  return indexableProcedurePages().map(({ city, procedure }) => ({
    region: SITE.regionSlug,
    city,
    procedure,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; procedure: string }>;
}): Promise<Metadata> {
  const { city: citySlug, procedure: procKey } = await params;
  const city = getCity(citySlug);
  const proc = getProcedure(procKey);
  if (!city || !proc) return {};

  const clinics = rankedForProcedure(citySlug, proc.key);
  const indexable = procedurePageIsIndexable(citySlug, proc.key);

  return {
    title: `${proc.label} in ${city.name} — ${clinics.length} ${clinics.length === 1 ? "clinic" : "clinics"}`,
    description: `Dental clinics in ${city.name} offering ${proc.label.toLowerCase()}, ordered by verifiable evidence. ${proc.whatMatters}`,
    alternates: {
      canonical: indexable
        ? paths.procedureInCity(citySlug, proc.key)
        : paths.city(citySlug),
    },
    robots: indexable ? undefined : { index: false, follow: true },
  };
}

export default async function ProcedurePage({
  params,
}: {
  params: Promise<{ region: string; city: string; procedure: string }>;
}) {
  const { region, city: citySlug, procedure: procKey } = await params;
  if (region !== SITE.regionSlug) notFound();

  const city = getCity(citySlug);
  const proc = getProcedure(procKey);
  if (!city || !proc) notFound();

  const clinics = rankedForProcedure(citySlug, proc.key);
  if (clinics.length === 0) notFound();

  const withRegisterEvidence = clinics.filter((c) =>
    c.procedures
      .find((p) => p.procedure === proc.key)
      ?.evidence.some((e) => e.kind.startsWith("rcdso-")),
  ).length;

  const trail = [
    { name: "Home", path: paths.home() },
    { name: SITE.region, path: paths.region() },
    { name: city.name, path: paths.city(citySlug) },
    { name: proc.label, path: paths.procedureInCity(citySlug, proc.key) },
  ];

  const faq = [
    {
      question: `Who does ${proc.label.toLowerCase()} in ${city.name}?`,
      answer: `${clinics.length} clinic${clinics.length === 1 ? "" : "s"} in ${city.name} offer${clinics.length === 1 ? "s" : ""} ${proc.label.toLowerCase()}${withRegisterEvidence > 0 ? `, and ${withRegisterEvidence} of those have evidence on the RCDSO public register — a registered specialist, a sedation permit or a CT scanner permit` : ""}.`,
    },
    {
      question: `What should I look for in a ${proc.label.toLowerCase()} provider?`,
      answer: proc.whatMatters,
    },
    {
      question: `What is ${proc.label.toLowerCase()}?`,
      answer: proc.blurb,
    },
  ];

  return (
    <>
      <JsonLd
        json={S.graph(
          S.procedurePage(city, proc.key, clinics),
          S.breadcrumbs(trail),
          S.faqPage(faq),
        )}
      />

      <div className="wrap" style={{ paddingBlock: "32px 40px" }}>
        <Breadcrumbs trail={trail} />

        <h1 style={{ fontSize: "clamp(1.8rem, 4.5vw, 2.4rem)", marginBottom: 14 }}>
          {proc.label} in {city.name}
        </h1>

        <p style={{ fontSize: "1.05rem", color: "var(--color-ink-soft)", maxWidth: "62ch", marginBottom: 10 }}>
          {proc.blurb}
        </p>
        <p style={{ fontSize: "1.05rem", color: "var(--color-ink-soft)", maxWidth: "62ch", marginBottom: 24 }}>
          {clinics.length} clinic{clinics.length === 1 ? "" : "s"} in {city.name} offer
          {clinics.length === 1 ? "s" : ""} it
          {withRegisterEvidence > 0 &&
            `, ${withRegisterEvidence} with evidence on the RCDSO public register`}
          .
        </p>

        {/* Synonyms, because these are separate queries and separate words
            people use with their own dentist. */}
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

        <h2 style={{ fontSize: "1.2rem", marginBottom: 4 }}>
          Clinics, strongest evidence first
        </h2>
        <p style={{ fontSize: 14, color: "var(--color-ink-faint)", marginBottom: 8 }}>
          Ordered by what kind of evidence sits behind the service. A specialty
          registration or a facility permit on the RCDSO register outranks a
          service listed on a clinic&rsquo;s own website.{" "}
          <a href={paths.methodology()} className="inline-link">How this works</a>
        </p>
        <ul>
          {clinics.map((clinic) => (
            <ClinicRow key={clinic.slug} clinic={clinic} highlight={proc.key} />
          ))}
        </ul>

        <Faq items={faq} />

        <p style={{ marginTop: 36, fontSize: 14.5 }}>
          <a href={paths.city(citySlug)} className="inline-link">
            All dental clinics in {city.name}
          </a>
        </p>
      </div>
    </>
  );
}
