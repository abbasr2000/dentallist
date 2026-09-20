import type { Metadata } from "next";
import { paths } from "@/lib/site";
import { EVIDENCE_WEIGHT } from "@/lib/types";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export const metadata: Metadata = {
  title: "How we rank clinics",
  description:
    "The full scoring method: what counts as evidence, what each kind is worth, and why a clinic's own website can only take it so far.",
  alternates: { canonical: paths.methodology() },
};

const EVIDENCE_COPY: Record<string, { label: string; what: string }> = {
  "rcdso-specialist": {
    label: "Registered specialist on staff",
    what: "A dentist at the practice holds an RCDSO specialty registration in a field relevant to the procedure. Verifiable on the public register.",
  },
  "rcdso-sedation-permit": {
    label: "Facility sedation permit",
    what: "The facility holds an RCDSO sedation or anaesthesia permit. Permit-controlled in Ontario, so this is a fact rather than a claim.",
  },
  "rcdso-cbct-permit": {
    label: "CT scanner permit",
    what: "The facility holds a CT scanner permit, which matters for implant and endodontic planning.",
  },
  "owner-verified": {
    label: "Confirmed by the practice",
    what: "A verified owner of the listing has confirmed the detail, and we have spot-checked it.",
  },
  "in-house-technology": {
    label: "Relevant equipment in-house",
    what: "Specific equipment that changes what a practice can do in one visit — a milling unit, a surgical microscope.",
  },
  "site-detail": {
    label: "Specific detail published by the clinic",
    what: "A checkable specific on the clinic's own website, not just the service name.",
  },
  "site-mention": {
    label: "Service listed on the clinic's website",
    what: "The service appears in the practice's own list. The weakest signal we record, because every practice lists everything.",
  },
};

export default function MethodologyPage() {
  const trail = [
    { name: "Home", path: paths.home() },
    { name: "How we rank", path: paths.methodology() },
  ];

  const weights = Object.entries(EVIDENCE_WEIGHT).sort((a, b) => b[1] - a[1]);

  return (
    <div className="wrap" style={{ paddingBlock: "32px 40px" }}>
      <Breadcrumbs trail={trail} />

      <h1 style={{ fontSize: "clamp(1.8rem, 4.5vw, 2.4rem)", marginBottom: 16 }}>
        How we rank clinics
      </h1>

      <div className="prose-col" style={{ display: "grid", gap: 15 }}>
        <p style={{ fontSize: "1.05rem", color: "var(--color-ink-soft)", margin: 0 }}>
          Most dental directories order clinics by how much they paid or by how
          many words are on their website. We order by evidence, and we publish
          the arithmetic so you can disagree with it.
        </p>

        <h2 style={{ fontSize: "1.2rem", marginTop: 20 }}>Two scores</h2>
        <p style={{ margin: 0 }}>
          <strong>Procedure strength</strong> answers &ldquo;how much evidence is
          there that this clinic does this particular thing?&rdquo; It runs 0 to
          100 and is computed per procedure. It orders the procedure pages.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Listing completeness</strong> answers &ldquo;how much do we
          actually know about this clinic?&rdquo; It also runs 0 to 100, and it
          orders the city pages. A high completeness score says the listing is
          filled in — nothing more. It is not a quality rating and we do not
          treat it as one.
        </p>

        <h2 style={{ fontSize: "1.2rem", marginTop: 20 }}>What evidence is worth</h2>
      </div>

      <div style={{ overflowX: "auto", margin: "16px 0 0", border: "1px solid var(--color-rule)", borderRadius: 4, background: "var(--color-surface)" }}>
        <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 15 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "10px 14px", background: "var(--color-surface-2)", borderBottom: "1px solid var(--color-rule-strong)" }} className="label">Evidence</th>
              <th style={{ textAlign: "right", padding: "10px 14px", background: "var(--color-surface-2)", borderBottom: "1px solid var(--color-rule-strong)" }} className="label">Points</th>
              <th style={{ textAlign: "left", padding: "10px 14px", background: "var(--color-surface-2)", borderBottom: "1px solid var(--color-rule-strong)" }} className="label">What it means</th>
            </tr>
          </thead>
          <tbody>
            {weights.map(([kind, weight]) => {
              const copy = EVIDENCE_COPY[kind];
              const verified = kind.startsWith("rcdso-");
              return (
                <tr key={kind}>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid var(--color-rule)", fontWeight: 600, color: verified ? "var(--color-verified)" : undefined }}>
                    {verified && "✓ "}{copy?.label ?? kind}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid var(--color-rule)", textAlign: "right", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                    {weight}
                  </td>
                  <td style={{ padding: "11px 14px", borderBottom: "1px solid var(--color-rule)", color: "var(--color-ink-soft)", fontSize: 14.5 }}>
                    {copy?.what ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="prose-col" style={{ display: "grid", gap: 15, marginTop: 28 }}>
        <h2 style={{ fontSize: "1.2rem" }}>Two rules that stop the score being gamed</h2>
        <p style={{ margin: 0 }}>
          <strong>Repeats count for less.</strong> Saying &ldquo;implants&rdquo;
          five times on your website is one signal, not five. Each additional
          piece of evidence of the same kind is worth 40% of the one before it.
          Without this, the wordiest site wins.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Marketing alone caps at 55.</strong> A clinic with no evidence
          on the RCDSO public register cannot score above 55 for a procedure,
          however much its own site says. Anything above that has to be backed by
          a specialty registration or a facility permit.
        </p>

        <h2 style={{ fontSize: "1.2rem", marginTop: 20 }}>What we deliberately do not do</h2>
        <p style={{ margin: 0 }}>
          We publish no patient testimonials, no star ratings, and no superlative
          or comparative claims about any clinic. Ontario dentists are bound by
          RCDSO advertising guidelines that prohibit testimonials, superlatives
          and incentive programs. A directory that applied those on a clinic&rsquo;s
          behalf would be creating that clinic a problem, so this one does not.
        </p>
        <p style={{ margin: 0 }}>
          Sponsored placements exist. They appear in a separate block labelled
          &ldquo;sponsored&rdquo;, above the ranked list rather than inside it, and
          buying one changes nothing about a clinic&rsquo;s scores.
        </p>

        <h2 style={{ fontSize: "1.2rem", marginTop: 20 }}>If you think we have it wrong</h2>
        <p style={{ margin: 0 }}>
          Every fact on a profile shows where it came from, and clinic-website
          facts link to the exact page. If something is out of date or wrong,{" "}
          <a href={paths.addClinic()} className="inline-link">claim the listing</a>{" "}
          and correct it.
        </p>
      </div>
    </div>
  );
}
