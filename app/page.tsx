import type { Metadata } from "next";
import { SITE, paths } from "@/lib/site";
import { allCities, allClinics, cityStats } from "@/lib/data";
import { PROCEDURES } from "@/lib/procedures";
import { JsonLd } from "@/components/JsonLd";
import * as S from "@/lib/schema";

export const metadata: Metadata = {
  alternates: { canonical: paths.home() },
};

export default function HomePage() {
  const cities = allCities();
  const clinics = allClinics();
  const specialists = clinics.filter((c) =>
    c.practitioners.some((p) => p.specialty),
  ).length;

  const faq = [
    {
      question: "How are clinics ordered on this site?",
      answer:
        "By evidence, not opinion. A dentist registered with the RCDSO in a specialty, a facility sedation permit or a CT scanner permit counts far more than a service listed on a clinic's own website. We publish the full weighting on the methodology page.",
    },
    {
      question: "Where does the information come from?",
      answer:
        "The RCDSO public register, OpenStreetMap, and clinics' own published information. Every fact taken from a clinic website stores the page it came from and the sentence it was taken from, and we show that link on the profile.",
    },
    {
      question: "Do you publish patient reviews?",
      answer:
        "No. We list what a clinic treats and what can be verified about it, and leave the judgement to you.",
    },
  ];

  return (
    <>
      <JsonLd json={S.graph(S.organization(), S.website(), S.faqPage(faq))} />

      <section className="wrap" style={{ paddingBlock: "56px 40px" }}>
        <p className="label" style={{ marginBottom: 14 }}>Ontario</p>
        <h1 style={{ fontSize: "clamp(2rem, 5.5vw, 3rem)", marginBottom: 18, maxWidth: "18ch" }}>
          Find a dentist by what they actually treat
        </h1>
        <p style={{ fontSize: "1.1rem", color: "var(--color-ink-soft)", maxWidth: "58ch", marginBottom: 28 }}>
          Most directories list every service every clinic mentions. This one ranks
          clinics on evidence you can check — registered specialists, sedation and
          CT-scanner permits on the RCDSO register, and what a practice publishes
          about itself.
        </p>

        <div className="stats" style={{ maxWidth: 720 }}>
          <div><b>{clinics.length}</b><span>Clinics listed</span></div>
          <div><b>{cities.length}</b><span>Cities</span></div>
          <div><b>{specialists}</b><span>With a registered specialist</span></div>
          <div><b>{PROCEDURES.length}</b><span>Procedures tracked</span></div>
        </div>
      </section>

      <section className="wrap" style={{ paddingBlock: 12 }}>
        <h2 style={{ fontSize: "1.3rem", marginBottom: 6 }}>Browse by city</h2>
        <p style={{ color: "var(--color-ink-soft)", fontSize: 15.5, marginBottom: 18 }}>
          Every city page lists its clinics, what each one treats, and the practical
          details people filter on.
        </p>
        <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
          {cities.map((city) => {
            const stats = cityStats(city.slug);
            return (
              <li key={city.slug}>
                <a href={paths.city(city.slug)} className="tile-link">
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.05rem" }}>
                    {city.name}
                  </div>
                  <div style={{ fontSize: 13.5, color: "var(--color-ink-faint)", marginTop: 3 }}>
                    {stats.clinics} clinic{stats.clinics === 1 ? "" : "s"}
                    {stats.sameDayEmergency > 0 && ` · ${stats.sameDayEmergency} same-day emergency`}
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="wrap" style={{ paddingBlock: 40 }}>
        <h2 style={{ fontSize: "1.3rem", marginBottom: 6 }}>Browse by procedure</h2>
        <p style={{ color: "var(--color-ink-soft)", fontSize: 15.5, marginBottom: 18 }}>
          Including what people actually call them.
        </p>
        <ul style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {PROCEDURES.map((proc) => (
            <li key={proc.key}>
              <span className="chip" title={proc.aliases.join(", ")}>
                {proc.label}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="wrap" style={{ paddingBlock: 12 }}>
        <div className="panel prose-col">
          <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>What this site will not do</h2>
          <p style={{ margin: 0, fontSize: 15.5, color: "var(--color-ink-soft)" }}>
            No patient testimonials, no &ldquo;best dentist&rdquo; rankings, and no
            incentives for booking. Ontario dentists are bound by RCDSO advertising
            guidelines on all three, and a directory that ignores them creates a
            problem for the clinics it lists. Facts, sourced, in a useful order.
          </p>
        </div>
      </section>

      <section className="wrap" style={{ paddingBlock: 40 }}>
        <h2 style={{ fontSize: "1.3rem", marginBottom: 16 }}>Common questions</h2>
        <div style={{ display: "grid", gap: 18 }} className="prose-col">
          {faq.map((item) => (
            <div key={item.question}>
              <h3 style={{ fontSize: "1rem", marginBottom: 4 }}>{item.question}</h3>
              <p style={{ margin: 0, color: "var(--color-ink-soft)", fontSize: 15.5 }}>{item.answer}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
