import { paths } from "@/lib/site";
import { getProcedure, type ProcedureKey } from "@/lib/procedures";
import { clinicCompleteness, offeringFor, strengthFor } from "@/lib/data";
import { TIER_SHORT, tierForOffering, type EvidenceTier } from "@/lib/tiers";
import type { Clinic } from "@/lib/types";

const REGISTER_BACKED = new Set([
  "rcdso-specialist",
  "rcdso-sedation-permit",
  "rcdso-cbct-permit",
]);

/**
 * One clinic in a list.
 *
 * `highlight` switches the right-hand number from overall completeness to the
 * strength for one procedure, which is what a procedure page needs. Copy here
 * states facts only — no "best", "top" or "leading". RCDSO advertising
 * guidelines prohibit superlatives for Ontario registrants, and a directory
 * that applies them on a clinic's behalf creates that clinic a problem.
 */
export function ClinicRow({
  clinic,
  highlight,
}: {
  clinic: Clinic;
  highlight?: ProcedureKey;
}) {
  const score = highlight
    ? strengthFor(clinic, highlight)
    : clinicCompleteness(clinic);
  const offering = highlight ? offeringFor(clinic, highlight) : undefined;
  const tier = offering ? tierForOffering(offering) : undefined;

  const topProcedures = [...clinic.procedures]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 4);

  return (
    <li className="clinic-row">
      <div>
        <div className="clinic-row__name">
          <a href={paths.clinic(clinic.citySlug, clinic.slug)}>{clinic.name}</a>
        </div>

        <div className="clinic-row__meta">
          {clinic.address}
          {clinic.phone ? ` · ${clinic.phone}` : ""}
        </div>

        {/* On a procedure page, lead with why this clinic is here. */}
        {offering && offering.evidence.length > 0 && (
          <ul style={{ marginTop: 10, display: "grid", gap: 4 }}>
            {offering.evidence.slice(0, 2).map((e, i) => (
              <li
                key={i}
                style={{
                  fontSize: 14,
                  color: REGISTER_BACKED.has(e.kind)
                    ? "var(--color-verified)"
                    : "var(--color-ink-soft)",
                }}
              >
                {REGISTER_BACKED.has(e.kind) ? "✓ " : "· "}
                {e.detail}
              </li>
            ))}
          </ul>
        )}

        <div className="clinic-row__chips">
          {clinic.availability.sameDayEmergency?.value && (
            <span className="chip chip--urgent">Same-day emergency</span>
          )}
          {clinic.availability.acceptingNewPatients?.value && (
            <span className="chip chip--accent">Accepting new patients</span>
          )}
          {clinic.payment.cdcp?.value && <span className="chip">CDCP</span>}
          {clinic.payment.directBilling?.value && (
            <span className="chip">Direct billing</span>
          )}
          {clinic.practitioners
            .filter((p) => p.specialty)
            .slice(0, 2)
            .map((p) => (
              <span key={p.name} className="chip chip--verified">
                {p.specialty}
              </span>
            ))}
          {clinic.languages.value.slice(0, 3).map((l) => (
            <span key={l} className="chip">
              {l}
            </span>
          ))}
          {!highlight &&
            topProcedures.slice(0, 3).map((o) => (
              <span key={o.procedure} className="chip">
                {getProcedure(o.procedure)?.short ?? o.procedure}
              </span>
            ))}
        </div>
      </div>

      <div className="clinic-row__score">
        {highlight && offering ? (
          // On a procedure page the useful signal is what kind of evidence
          // exists, not a number that reads like a rating out of 100.
          <span
            className={
              tier === "register" ? "chip chip--verified" : "chip"
            }
          >
            {TIER_SHORT[tier as EvidenceTier]}
          </span>
        ) : (
          <>
            <b>{score}</b>
            <span className="label">complete</span>
            <span
              className="meter"
              style={{ marginTop: 6 }}
              role="img"
              aria-label={`Listing ${score}% complete`}
            >
              <i style={{ width: `${score}%` }} />
            </span>
          </>
        )}
      </div>
    </li>
  );
}
