import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SITE, paths } from "@/lib/site";
import {
  allClinics,
  clinicCompleteness,
  completenessInput,
  getCity,
  getClinic,
  rankedForProcedure,
} from "@/lib/data";
import { missingFields } from "@/lib/strength";
import { getProcedure } from "@/lib/procedures";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { Faq } from "@/components/Faq";
import * as S from "@/lib/schema";
import type { City, Clinic, Provenance } from "@/lib/types";

export function generateStaticParams() {
  return allClinics().map((c) => ({ city: c.citySlug, slug: c.slug }));
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SOURCE_LABEL: Record<Provenance["source"], string> = {
  rcdso: "RCDSO public register",
  osm: "OpenStreetMap",
  places: "Google Places",
  "clinic-site": "the clinic's own website",
  owner: "the practice",
  editorial: "our own research",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; slug: string }>;
}): Promise<Metadata> {
  const { city: citySlug, slug } = await params;
  const clinic = getClinic(citySlug, slug);
  const city = getCity(citySlug);
  if (!clinic || !city) return {};

  const top = [...clinic.procedures].sort((a, b) => b.strength - a.strength).slice(0, 3);
  const services = top.map((o) => getProcedure(o.procedure)?.label).filter(Boolean);

  return {
    title: `${clinic.name} — dentist in ${city.name}`,
    description:
      services.length > 0
        ? `${clinic.name}, ${where(clinic, city)}. Listed for ${services.join(", ").toLowerCase()}. Hours, languages and contact details with sources.`
        : `${clinic.name}, ${where(clinic, city)}. Contact details, hours and services with sources.`,
    alternates: { canonical: paths.clinic(citySlug, slug) },
  };
}

/**
 * Where a clinic is, in words. Half of Ontario's practices reach us without a
 * street address, and a description reading "Name, undefined" is worse than
 * one naming only the city.
 */
function where(clinic: Clinic, city: City): string {
  return clinic.address ? `${clinic.address}, ${city.name}` : `${city.name}, Ontario`;
}

/** A small "where this came from" line. The product's credibility rests on it. */
function Receipt({ provenance }: { provenance: Provenance }) {
  const label = SOURCE_LABEL[provenance.source];
  return (
    <span className="receipt">
      from {provenance.url ? (
        <a href={provenance.url} rel="nofollow noopener" target="_blank">{label}</a>
      ) : (
        label
      )}
    </span>
  );
}

export default async function ClinicPage({
  params,
}: {
  params: Promise<{ city: string; slug: string }>;
}) {
  const { city: citySlug, slug } = await params;
  const clinic = getClinic(citySlug, slug);
  const city = getCity(citySlug);
  if (!clinic || !city) notFound();

  const score = clinicCompleteness(clinic);
  const missing = missingFields(completenessInput(clinic));
  const ranked = [...clinic.procedures].sort((a, b) => b.strength - a.strength);
  const registerEvidence = ranked.flatMap((o) =>
    o.evidence.filter((e) => e.kind.startsWith("rcdso-")),
  );

  const trail = [
    { name: "Home", path: paths.home() },
    { name: SITE.region, path: paths.region() },
    { name: city.name, path: paths.city(citySlug) },
    { name: clinic.name, path: paths.clinic(citySlug, slug) },
  ];

  const strongest = ranked[0] ? getProcedure(ranked[0].procedure) : undefined;

  const faq = [
    {
      question: `What does ${clinic.name} treat?`,
      answer:
        ranked.length > 0
          ? `${clinic.name} is listed for ${ranked.map((o) => getProcedure(o.procedure)?.label.toLowerCase()).filter(Boolean).join(", ")}.`
          : `No services are listed for ${clinic.name} yet.`,
    },
    {
      question: `Where is ${clinic.name}?`,
      answer: `${where(clinic, city)}${clinic.postalCode ? ` ${clinic.postalCode}` : ""}${clinic.phone ? `. Phone ${clinic.phone}` : ""}.`,
    },
    ...(clinic.languages.value.length > 0
      ? [{
          question: `What languages are spoken at ${clinic.name}?`,
          answer: `English, plus ${clinic.languages.value.join(", ")}.`,
        }]
      : []),
  ];

  return (
    <>
      <JsonLd
        json={S.graph(S.dentist(clinic, city), S.breadcrumbs(trail), S.faqPage(faq))}
      />

      <div className="wrap" style={{ paddingBlock: "32px 40px" }}>
        <Breadcrumbs trail={trail} />

        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ flex: "1 1 340px" }}>
            <h1 style={{ fontSize: "clamp(1.7rem, 4.5vw, 2.3rem)", marginBottom: 8 }}>
              {clinic.name}
            </h1>
            <p style={{ color: "var(--color-ink-soft)", fontSize: "1.05rem", margin: 0 }}>
              Dentist in {city.name}, Ontario
            </p>
          </div>
          <div style={{ minWidth: 150 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "2rem", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {score}
              <span style={{ fontSize: "1rem", color: "var(--color-ink-faint)" }}>/100</span>
            </div>
            <div className="label" style={{ marginTop: 4 }}>Listing completeness</div>
            <span className="meter" style={{ marginTop: 8 }} role="img" aria-label={`${score} out of 100`}>
              <i style={{ width: `${score}%` }} />
            </span>
          </div>
        </div>

        {registerEvidence.length > 0 && (
          <div className="panel" style={{ marginBottom: 28, borderColor: "color-mix(in srgb, var(--color-verified) 30%, transparent)", background: "var(--color-verified-soft)" }}>
            <h2 style={{ fontSize: "1rem", marginBottom: 8, color: "var(--color-verified)" }}>
              On the RCDSO public register
            </h2>
            <ul style={{ display: "grid", gap: 5 }}>
              {registerEvidence.map((e, i) => (
                <li key={i} style={{ fontSize: 15, color: "var(--color-verified)" }}>
                  ✓ {e.detail}
                </li>
              ))}
            </ul>
          </div>
        )}

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, marginBottom: 36 }}>
          <div className="panel">
            <h2 style={{ fontSize: "1rem", marginBottom: 10 }}>Contact</h2>
            <dl style={{ display: "grid", gap: 8, margin: 0, fontSize: 15 }}>
              <div>
                <dt className="label">Address</dt>
                <dd style={{ margin: 0 }}>
                  {clinic.address
                    ? `${clinic.address}${clinic.postalCode ? ` ${clinic.postalCode}` : ""}`
                    : <span className="muted">No street address on file. <a href={paths.addClinic()} className="inline-link">Add it</a>.</span>}
                </dd>
              </div>
              {clinic.phone && (
                <div>
                  <dt className="label">Phone</dt>
                  <dd style={{ margin: 0 }}>
                    <a href={`tel:${clinic.phone.replace(/[^\d+]/g, "")}`} className="inline-link">{clinic.phone}</a>
                  </dd>
                </div>
              )}
              {clinic.website && (
                <div>
                  <dt className="label">Website</dt>
                  <dd style={{ margin: 0 }}>
                    <a href={clinic.website} className="inline-link" rel="nofollow noopener" target="_blank">
                      {clinic.website.replace(/^https?:\/\//, "")}
                    </a>
                  </dd>
                </div>
              )}
              {clinic.languages.value.length > 0 && (
                <div>
                  <dt className="label">Languages</dt>
                  <dd style={{ margin: 0 }}>
                    English, {clinic.languages.value.join(", ")}{" "}
                    <Receipt provenance={clinic.languages.provenance} />
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="panel">
            <h2 style={{ fontSize: "1rem", marginBottom: 10 }}>Hours</h2>
            {clinic.hours.length === 0 ? (
              <p style={{ margin: 0, fontSize: 15, color: "var(--color-ink-faint)" }}>
                Not listed. Call to confirm.
              </p>
            ) : (
              <table style={{ width: "100%", fontSize: 14.5, borderCollapse: "collapse" }}>
                <tbody>
                  {DAYS.map((name, day) => {
                    const slot = clinic.hours.find((h) => h.day === day);
                    return (
                      <tr key={name}>
                        <th scope="row" style={{ textAlign: "left", fontWeight: 400, color: "var(--color-ink-soft)", paddingBlock: 2 }}>
                          {name}
                        </th>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", paddingBlock: 2 }}>
                          {slot ? `${slot.opens}–${slot.closes}` : "Closed"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="panel">
            <h2 style={{ fontSize: "1rem", marginBottom: 10 }}>Practical</h2>
            <ul style={{ display: "grid", gap: 6, fontSize: 15 }}>
              {clinic.availability.acceptingNewPatients?.value && <li>Accepting new patients</li>}
              {clinic.availability.sameDayEmergency?.value && <li>Same-day emergency appointments</li>}
              {clinic.availability.walkInsAccepted?.value && <li>Walk-ins accepted</li>}
              {clinic.payment.directBilling?.value && <li>Direct billing to insurers</li>}
              {clinic.payment.cdcp?.value && <li>Accepts Canadian Dental Care Plan</li>}
              {clinic.payment.paymentPlans?.value && <li>Payment plans available</li>}
              {clinic.accessibility.wheelchairAccessible?.value && <li>Wheelchair accessible</li>}
              {clinic.accessibility.parkingOnSite?.value && <li>Parking on site</li>}
              {clinic.accessibility.nearTransit?.value && <li>{clinic.accessibility.nearTransit.value}</li>}
            </ul>
          </div>
        </section>

        {ranked.length > 0 && (
          <section style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: "1.2rem", marginBottom: 4 }}>
              What {clinic.name} treats
            </h2>
            <p style={{ fontSize: 14, color: "var(--color-ink-faint)", marginBottom: 14 }}>
              Ordered by the strength of the evidence behind each.{" "}
              <a href={paths.methodology()} className="inline-link">How this works</a>
            </p>
            <ul style={{ display: "grid", gap: 2 }}>
              {ranked.map((offering) => {
                const proc = getProcedure(offering.procedure);
                if (!proc) return null;
                const peers = rankedForProcedure(citySlug, offering.procedure);
                const position = peers.findIndex((c) => c.slug === clinic.slug) + 1;
                return (
                  <li key={offering.procedure} style={{ padding: "14px 0", borderBottom: "1px solid var(--color-rule)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "baseline" }}>
                      <h3 style={{ fontSize: "1rem" }}>
                        <a href={paths.procedureInCity(citySlug, offering.procedure)} className="inline-link">
                          {proc.label}
                        </a>
                      </h3>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--color-ink-faint)" }}>
                        {offering.strength}/100
                        {position > 0 && peers.length > 1 && ` · ${position} of ${peers.length} in ${city.name}`}
                      </span>
                    </div>
                    <ul style={{ marginTop: 6, display: "grid", gap: 3 }}>
                      {offering.evidence.map((e, i) => (
                        <li key={i} style={{ fontSize: 14.5, color: e.kind.startsWith("rcdso-") ? "var(--color-verified)" : "var(--color-ink-soft)" }}>
                          {e.kind.startsWith("rcdso-") ? "✓ " : "· "}
                          {e.detail} <Receipt provenance={e.provenance} />
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {clinic.practitioners.length > 0 && (
          <section style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: "1.2rem", marginBottom: 12 }}>Dentists</h2>
            <ul style={{ display: "grid", gap: 10 }}>
              {clinic.practitioners.map((person) => (
                <li key={person.name} style={{ fontSize: 15.5 }}>
                  <strong>{person.name}</strong>
                  {person.specialty && (
                    <span className="chip chip--verified" style={{ marginLeft: 8 }}>{person.specialty}</span>
                  )}
                  {person.registrationNumber && (
                    <span className="receipt" style={{ marginLeft: 8 }}>
                      RCDSO #{person.registrationNumber}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel prose-col" style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>Before you call</h2>
          <p style={{ margin: 0, fontSize: 15.5, color: "var(--color-ink-soft)" }}>
            {strongest
              ? `${strongest.whatMatters} `
              : ""}
            Confirm hours, fees and whether they are taking new patients directly with
            the clinic — the details here come from public records and published
            information, and practices change them without telling anyone.
          </p>
        </section>

        {/* The sales hook, phrased as what it is: a list of gaps the practice
            can close. No claim that a fuller listing makes a better dentist. */}
        {clinic.tier === "unclaimed" && missing.length > 0 && (
          <section className="panel prose-col" style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: "1rem", marginBottom: 8 }}>
              Is this your practice?
            </h2>
            <p style={{ margin: "0 0 8px", fontSize: 15.5, color: "var(--color-ink-soft)" }}>
              This listing is missing {missing.slice(0, 4).join(", ").toLowerCase()}.
              Claiming it lets you fill those in.
            </p>
            <a href={paths.addClinic()} className="inline-link">Claim this listing</a>
          </section>
        )}

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
