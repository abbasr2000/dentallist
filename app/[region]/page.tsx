import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SITE, paths } from "@/lib/site";
import { allCities, allClinics, cityStats } from "@/lib/data";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { Faq } from "@/components/Faq";
import * as S from "@/lib/schema";

export function generateStaticParams() {
  return [{ region: SITE.regionSlug }];
}

export const metadata: Metadata = {
  title: `Dental clinics in ${SITE.region}`,
  description: `Compare dental clinics across ${SITE.region} by what they treat, with sources for every claim.`,
};

export default async function RegionPage({
  params,
}: {
  params: Promise<{ region: string }>;
}) {
  const { region } = await params;
  if (region !== SITE.regionSlug) notFound();

  const cities = allCities();
  const clinics = allClinics();

  // Counted facts. These are what language models quote, so they are computed
  // from the data on every build rather than written by hand and left to rot.
  const totals = {
    clinics: clinics.length,
    emergency: clinics.filter((c) => c.availability.sameDayEmergency?.value).length,
    accepting: clinics.filter((c) => c.availability.acceptingNewPatients?.value).length,
    cdcp: clinics.filter((c) => c.payment.cdcp?.value).length,
    specialists: clinics.filter((c) => c.practitioners.some((p) => p.specialty)).length,
    languages: new Set(clinics.flatMap((c) => c.languages.value)).size,
  };

  const trail = [
    { name: "Home", path: paths.home() },
    { name: SITE.region, path: paths.region() },
  ];

  const faq = [
    {
      question: `How many dental clinics are there in ${SITE.region}?`,
      answer: `This directory currently lists ${totals.clinics} clinics across ${cities.length} ${cities.length === 1 ? "city" : "cities"}, compiled from the RCDSO public register and OpenStreetMap.`,
    },
    {
      question: "Which clinics accept the Canadian Dental Care Plan?",
      answer: `${totals.cdcp} of the clinics listed indicate they accept CDCP patients. Confirm with the clinic before booking, as participation changes.`,
    },
  ];

  return (
    <>
      <JsonLd
        json={S.graph(
          S.collectionPage(
            paths.region(),
            `Dental clinics in ${SITE.region}`,
            `Dental clinics across ${SITE.region}, ranked by verifiable evidence of what they treat.`,
            S.clinicList(clinics, `Clinics in ${SITE.region}`),
          ),
          S.breadcrumbs(trail),
          S.faqPage(faq),
        )}
      />

      <div className="wrap" style={{ paddingBlock: "32px 40px" }}>
        <Breadcrumbs trail={trail} />

        <h1 style={{ fontSize: "clamp(1.8rem, 4.5vw, 2.5rem)", marginBottom: 14 }}>
          Dental clinics in {SITE.region}
        </h1>
        <p style={{ fontSize: "1.05rem", color: "var(--color-ink-soft)", maxWidth: "62ch", marginBottom: 26 }}>
          Compare clinics across {cities.length} {cities.length === 1 ? "city" : "cities"} by
          what they treat, who is on staff, and the practical details — hours,
          languages, direct billing and whether they are taking new patients.
        </p>

        <div className="stats" style={{ marginBottom: 40 }}>
          <div><b>{totals.clinics}</b><span>Clinics</span></div>
          <div><b>{cities.length}</b><span>Cities</span></div>
          <div><b>{totals.specialists}</b><span>With a registered specialist</span></div>
          <div><b>{totals.emergency}</b><span>Same-day emergency</span></div>
          <div><b>{totals.accepting}</b><span>Accepting new patients</span></div>
          <div><b>{totals.languages}</b><span>Languages besides English</span></div>
        </div>

        <h2 style={{ fontSize: "1.3rem", marginBottom: 16 }}>Cities</h2>
        <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
          {cities.map((city) => {
            const stats = cityStats(city.slug);
            return (
              <li key={city.slug}>
                <a href={paths.city(city.slug)} className="tile-link">
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.05rem" }}>
                    {city.name}
                  </div>
                  <div style={{ fontSize: 13.5, color: "var(--color-ink-faint)", marginTop: 4, display: "grid", gap: 2 }}>
                    <span>{stats.clinics} clinic{stats.clinics === 1 ? "" : "s"}</span>
                    {stats.specialists > 0 && <span>{stats.specialists} with a registered specialist</span>}
                    {stats.languages.length > 0 && <span>{stats.languages.length} languages besides English</span>}
                  </div>
                </a>
              </li>
            );
          })}
        </ul>

        <Faq items={faq} />
      </div>
    </>
  );
}
