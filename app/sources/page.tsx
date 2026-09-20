import type { Metadata } from "next";
import { paths } from "@/lib/site";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export const metadata: Metadata = {
  title: "Where our data comes from",
  description:
    "Every source behind this directory, what each one provides, its licence, and how often we refresh it.",
  alternates: { canonical: paths.sources() },
};

const SOURCES = [
  {
    name: "RCDSO public register",
    url: "https://www.rcdso.org/en-ca/find-a-dentist",
    provides:
      "Registered dentists, specialty registrations, practice addresses and phone numbers, facility sedation permits and CT scanner permits.",
    licence: "Public register, published by the regulator.",
    refresh: "Monthly",
  },
  {
    name: "OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
    provides:
      "Clinic locations, some phone numbers, websites, opening hours and wheelchair access.",
    licence: "Open Database Licence (ODbL). © OpenStreetMap contributors.",
    refresh: "Monthly",
  },
  {
    name: "Clinic websites",
    url: null,
    provides:
      "Services offered, languages spoken, insurance and direct billing, CDCP acceptance, evening and weekend hours, equipment.",
    licence:
      "Facts extracted from publicly published pages. Every extracted fact stores the source URL and the sentence it was taken from; without a quote, the field is left empty.",
    refresh: "Quarterly",
  },
  {
    name: "The practices themselves",
    url: null,
    provides:
      "Everything above, plus fee ranges, dentist biographies, photos and whether they are currently accepting new patients.",
    licence: "Submitted by a verified owner of the listing.",
    refresh: "Whenever they update it",
  },
] as const;

export default function SourcesPage() {
  const trail = [
    { name: "Home", path: paths.home() },
    { name: "Data sources", path: paths.sources() },
  ];

  return (
    <div className="wrap" style={{ paddingBlock: "32px 40px" }}>
      <Breadcrumbs trail={trail} />

      <h1 style={{ fontSize: "clamp(1.8rem, 4.5vw, 2.4rem)", marginBottom: 16 }}>
        Where our data comes from
      </h1>

      <p className="prose-col" style={{ fontSize: "1.05rem", color: "var(--color-ink-soft)", marginBottom: 28 }}>
        Directories rarely say where their listings came from. Ours does, because
        a clinic ought to be able to see why we said something about them and
        correct it if we got it wrong.
      </p>

      <ul style={{ display: "grid", gap: 16 }}>
        {SOURCES.map((source) => (
          <li key={source.name} className="panel">
            <h2 style={{ fontSize: "1.05rem", marginBottom: 8 }}>
              {source.url ? (
                <a href={source.url} className="inline-link" rel="noopener" target="_blank">
                  {source.name}
                </a>
              ) : (
                source.name
              )}
            </h2>
            <dl style={{ display: "grid", gap: 8, margin: 0, fontSize: 15 }}>
              <div>
                <dt className="label">Provides</dt>
                <dd style={{ margin: 0, color: "var(--color-ink-soft)" }}>{source.provides}</dd>
              </div>
              <div>
                <dt className="label">Licence</dt>
                <dd style={{ margin: 0, color: "var(--color-ink-soft)" }}>{source.licence}</dd>
              </div>
              <div>
                <dt className="label">Refreshed</dt>
                <dd style={{ margin: 0, color: "var(--color-ink-soft)" }}>{source.refresh}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <div className="panel prose-col" style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: "1.05rem", marginBottom: 8 }}>What we do not store</h2>
        <p style={{ margin: 0, fontSize: 15.5, color: "var(--color-ink-soft)" }}>
          We do not build a lasting database out of Google Places content. Where
          Places is used to check a detail, the result is held with an expiry and
          refreshed rather than accumulated, which is what their terms require.
        </p>
      </div>
    </div>
  );
}
