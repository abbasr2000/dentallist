import { EVIDENCE_WEIGHT, type Evidence, type ProcedureOffering } from "./types";
import type { ProcedureKey } from "./procedures";

/**
 * Procedure strength, 0-100.
 *
 * Two rules do all the work here:
 *
 * 1. Evidence of the same kind has sharply diminishing returns. Three separate
 *    mentions of "implants" on a clinic's own website is one signal, not three.
 *    Without this, a wordy site outranks a clinic with a periodontist on staff.
 *
 * 2. Nothing reaches the top of the scale on marketing alone. A clinic with no
 *    register-backed evidence is capped, however much its site says. RCDSO
 *    advertising guidelines prohibit superlatives for Ontario registrants, and
 *    a ranking driven by self-description is exactly the kind of implied
 *    superiority claim that gets a clinic in trouble. Verifiable facts rank;
 *    adjectives do not.
 */

const REGISTER_BACKED = new Set([
  "rcdso-specialist",
  "rcdso-sedation-permit",
  "rcdso-cbct-permit",
]);

/** Ceiling for a clinic with no register-backed evidence at all. */
const UNVERIFIED_CEILING = 55;

/** Each additional piece of evidence of the same kind counts for this much. */
const REPEAT_DECAY = 0.4;

export function scoreProcedure(evidence: Evidence[]): number {
  if (evidence.length === 0) return 0;

  const byKind = new Map<string, Evidence[]>();
  for (const e of evidence) {
    const list = byKind.get(e.kind);
    if (list) list.push(e);
    else byKind.set(e.kind, [e]);
  }

  let raw = 0;
  for (const [kind, items] of byKind) {
    const weight = EVIDENCE_WEIGHT[kind as keyof typeof EVIDENCE_WEIGHT] ?? 0;
    // First item at full weight, each repeat worth progressively less.
    for (let i = 0; i < items.length; i++) {
      raw += weight * Math.pow(REPEAT_DECAY, i);
    }
  }

  const score = Math.min(100, Math.round(raw));

  const verified = evidence.some((e) => REGISTER_BACKED.has(e.kind));
  return verified ? score : Math.min(score, UNVERIFIED_CEILING);
}

export function buildOffering(
  procedure: ProcedureKey,
  evidence: Evidence[],
): ProcedureOffering {
  return { procedure, strength: scoreProcedure(evidence), evidence };
}

/**
 * How complete a listing is, 0-100.
 *
 * This drives the default order of a city page, the same principle
 * dentistlist.org uses. It is published at /methodology/ so a clinic can see
 * exactly what is missing and fix it — which is also the sales conversation.
 */
export interface CompletenessInput {
  hasPhone: boolean;
  hasWebsite: boolean;
  hasHours: boolean;
  hasProcedures: boolean;
  hasLanguages: boolean;
  hasPractitioners: boolean;
  hasAccessibility: boolean;
  hasPaymentInfo: boolean;
  hasAvailability: boolean;
  hasFees: boolean;
  hasPhotos: boolean;
  isClaimed: boolean;
}

const COMPLETENESS_POINTS: Array<[keyof CompletenessInput, number]> = [
  ["hasPhone", 10],
  ["hasWebsite", 8],
  ["hasHours", 12],
  ["hasProcedures", 15],
  ["hasLanguages", 8],
  ["hasPractitioners", 10],
  ["hasAccessibility", 6],
  ["hasPaymentInfo", 10],
  ["hasAvailability", 8],
  ["hasFees", 8],
  ["hasPhotos", 5],
];

export function completeness(input: CompletenessInput): number {
  let score = 0;
  for (const [field, points] of COMPLETENESS_POINTS) {
    if (input[field]) score += points;
  }
  // A verified owner has confirmed the details are current, which is worth
  // something on its own. Capped at 100 either way.
  if (input.isClaimed) score = Math.min(100, score + 5);
  return Math.min(100, score);
}

/** The fields a clinic is missing, in the order worth fixing them. */
export function missingFields(input: CompletenessInput): string[] {
  const labels: Record<keyof CompletenessInput, string> = {
    hasPhone: "Phone number",
    hasWebsite: "Website",
    hasHours: "Opening hours",
    hasProcedures: "Procedures offered",
    hasLanguages: "Languages spoken",
    hasPractitioners: "Dentists on staff",
    hasAccessibility: "Accessibility details",
    hasPaymentInfo: "Insurance and direct billing",
    hasAvailability: "Accepting new patients",
    hasFees: "Published fees",
    hasPhotos: "Photos",
    isClaimed: "Claimed by the practice",
  };
  return COMPLETENESS_POINTS.filter(([f]) => !input[f])
    .sort((a, b) => b[1] - a[1])
    .map(([f]) => labels[f]);
}
