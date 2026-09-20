import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SITE, paths } from "@/lib/site";
import {
  allCities,
  cityStats,
  clinicsInNeighbourhood,
  featuredForCity,
  getCity,
  procedureCountsForCity,
  procedurePageIsIndexable,
  rankedForCity,
  rankedForProcedureInRegion,
} from "@/lib/data";
import { getProcedure, PROCEDURES } from "@/lib/procedures";
import { RegionProcedure, regionProcedureMetadata } from "@/components/RegionProcedure";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ClinicRow } from "@/components/ClinicRow";
import { JsonLd } from "@/components/JsonLd";
import { Faq } from "@/components/Faq";
import * as S from "@/lib/schema";

/**
 * This route serves two kinds of page, because /ontario/toronto/ and
 * /ontario/orthodontics/ are the same shape and Next cannot tell two dynamic
 * segments apart at one level. The alternative was /ontario/procedure/… , and
 * the shorter URL is the one that competes.
 *
 * It is only safe because the two namespaces cannot collide: no Ontario
 * municipality is named after a dental procedure. `assertNoSlugCollision`
 * fails the build rather than trusting that, since a collision would silently
 * hide one page behind the other.
 */
function assertNoSlugCollision(): void {
  const cities = new Set(allCities().map((c) => c.slug));
  const clashes = PROCEDURES.map((p) => p.key).filter((key) => cities.has(key));
  if (clashes.length > 0) {
    throw new Error(
      `A city slug and a procedure key collide: ${clashes.join(", ")}. ` +
        "One of the two pages would be unreachable — rename the procedure key.",
    );
  }
}

export function generateStaticParams() {
  assertNoSlugCollision();
  return [
    ...allCities().map((c) => ({ region: SITE.regionSlug, city: c.slug })),
    ...PROCEDURES
      .filter((proc) => rankedForProcedureInRegion(proc.key).length > 0)
      .map((proc) => ({ region: SITE.regionSlug, city: proc.key })),
  ];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city: citySlug } = await params;

  const asProcedure = regionProcedureMetadata(citySlug);
  if (asProcedure) return asProcedure;

  const city = getCity(citySlug);
  if (!city) return {};
  const stats = cityStats(citySlug);
  return {
    title: `Dentists in ${city.name} — ${stats.clinics} clinics compared`,
    description: `Compare ${stats.clinics} dental clinics in ${city.name} by what they treat, hours, languages and whether they are accepting new patients.`,
    alternates: { canonical: paths.city(citySlug) },
  };
}

export default async function CityPage({
  params,
}: {
  params: Promise<{ region: string; city: string }>;
}) {
  const { region, city: citySlug } = await params;
  if (region !== SITE.regionSlug) notFound();

  // A procedure key here means the province-wide page for that procedure.
  if (getProcedure(citySlug)) return <RegionProcedure procedureKey={citySlug} />;

  const city = getCity(citySlug);
  if (!city) notFound();

  const stats = cityStats(citySlug);
  const featured = featuredForCity(citySlug);
  const ranked = rankedForCity(citySlug);
  const procedureCounts = procedureCountsForCity(citySlug);

  const trail = [
    { name: "Home", path: paths.home() },
    { name: SITE.region, path: paths.region() },
    { name: city.name, path: paths.city(citySlug) },
  ];

  const emergencyProc = getProcedure("emergency-dentistry");

  const faq = [
    {
      question: `How many dental clinics are there in ${city.name}?`,
      answer: `${stats.clinics} clinic${stats.clinics === 1 ? " is" : "s are"} listed in ${city.name}${stats.specialists > 0 ? `, ${stats.specialists} of which have a dentist registered in a specialty with the RCDSO` : ""}.`,
    },
    {
      question: `Which dentists in ${city.name} see emergencies the same day?`,
      answer:
        stats.sameDayEmergency > 0
          ? `${stats.sameDayEmergency} clinic${stats.sameDayEmergency === 1 ? " holds" : "s hold"} same-day emergency appointments. ${emergencyProc?.whatMatters ?? ""}`
          : `No clinic in ${city.name} currently lists same-day emergency appointments in this directory. Call ahead — many practices keep slots they do not advertise.`,
    },
    {
      question: `Are any ${city.name} dentists taking new patients?`,
      answer:
        stats.acceptingNewPatients > 0
          ? `${stats.acceptingNewPatients} clinic${stats.acceptingNewPatients === 1 ? " lists" : "s list"} themselves as accepting new patients. This changes often, so confirm when you call.`
          : `No clinic in ${city.name} currently states whether it is accepting new patients. It is worth calling to ask.`,
    },
    {
      question: `Which ${city.name} clinics speak languages other than English?`,
      answer:
        stats.languages.length > 0
          ? `Languages listed across ${city.name} clinics: ${stats.languages.join(", ")}.`
          : `No clinic in ${city.name} has listed additional languages yet.`,
    },
  ];

  return (
    <>
      <JsonLd
        json={S.graph(
          S.collectionPage(
            paths.city(citySlug),
            `Dental clinics in ${city.name}`,
            `Dental clinics in ${city.name}, ${SITE.region}.`,
            S.clinicList([...featured, ...ranked], `Clinics in ${city.name}`),
          ),
          S.breadcrumbs(trail),
          S.faqPage(faq),
        )}
      />

      <div className="wrap" style={{ paddingBlock: "32px 40px" }}>
        <Breadcrumbs trail={trail} />

        <h1 style={{ fontSize: "clamp(1.8rem, 4.5vw, 2.4rem)", marginBottom: 14 }}>
          Dentists in {city.name}
        </h1>
        <p style={{ fontSize: "1.05rem", color: "var(--color-ink-soft)", maxWidth: "62ch", marginBottom: 12 }}>
          {city.blurb}
        </p>
        <p style={{ fontSize: "1.05rem", color: "var(--color-ink-soft)", maxWidth: "62ch", marginBottom: 26 }}>
          {stats.clinics} clinic{stats.clinics === 1 ? "" : "s"} listed, ordered by how
          complete the listing is. Every claim links to where it came from.
        </p>

        <div className="stats" style={{ marginBottom: 36 }}>
          <div><b>{stats.clinics}</b><span>Clinics</span></div>
          {stats.specialists > 0 && <div><b>{stats.specialists}</b><span>With a registered specialist</span></div>}
          {stats.sameDayEmergency > 0 && <div><b>{stats.sameDayEmergency}</b><span>Same-day emergency</span></div>}
          {stats.acceptingNewPatients > 0 && <div><b>{stats.acceptingNewPatients}</b><span>Accepting new patients</span></div>}
          {stats.cdcp > 0 && <div><b>{stats.cdcp}</b><span>Accept CDCP</span></div>}
          {stats.openSaturday > 0 && <div><b>{stats.openSaturday}</b><span>Open Saturday</span></div>}
        </div>

        {/* Procedure entry points. Only linked where the page clears the
            indexability floor — below it the page would be too thin to be
            worth landing on. */}
        {procedureCounts.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: "1.2rem", marginBottom: 10 }}>
              What clinics in {city.name} treat
            </h2>
            <ul style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {procedureCounts.map(({ procedure, count }) => {
                const proc = getProcedure(procedure);
                const indexable = procedurePageIsIndexable(citySlug, procedure);
                const body = `${proc?.label ?? procedure} · ${count}`;
                return (
                  <li key={procedure}>
                    {indexable ? (
                      <a
                        href={paths.procedureInCity(citySlug, procedure)}
                        className="chip chip--accent"
                      >
                        {body}
                      </a>
                    ) : (
                      <span className="chip">{body}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {city.neighbourhoods.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: "1.2rem", marginBottom: 10 }}>By neighbourhood</h2>
            <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
              {city.neighbourhoods.map((n) => {
                const count = clinicsInNeighbourhood(citySlug, n.slug).length;
                return (
                  <li key={n.slug} className="tile-link">
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>{n.name}</div>
                    <div style={{ fontSize: 13.5, color: "var(--color-ink-faint)", marginTop: 3 }}>
                      {count} clinic{count === 1 ? "" : "s"} · {n.blurb}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {featured.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            {/* Paid placement is labelled as paid placement, with no claim
                about quality attached to it. */}
            <p className="label" style={{ marginBottom: 10 }}>Sponsored listing</p>
            <div className="panel panel--sponsored">
              <ul>
                {featured.map((c) => (
                  <ClinicRow key={c.slug} clinic={c} />
                ))}
              </ul>
            </div>
          </section>
        )}

        <section>
          <h2 style={{ fontSize: "1.2rem", marginBottom: 4 }}>
            All clinics in {city.name}
          </h2>
          <p style={{ fontSize: 14, color: "var(--color-ink-faint)", marginBottom: 8 }}>
            Ordered by listing completeness.{" "}
            <a href={paths.methodology()} className="inline-link">How this works</a>
          </p>
          <ul>
            {ranked.map((clinic) => (
              <ClinicRow key={clinic.slug} clinic={clinic} />
            ))}
          </ul>
        </section>

        <Faq items={faq} />
      </div>
    </>
  );
}
