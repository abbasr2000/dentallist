import type { Evidence, ProcedureOffering } from "./types";

/**
 * How to describe the evidence behind a procedure, in words.
 *
 * A raw 0-100 number on a list row reads as a quality percentage — a clinic
 * shown as "15" looks bad at something it may do perfectly well, and an
 * implied quality score attached to a named Ontario practice is exactly the
 * comparative claim RCDSO advertising guidelines prohibit.
 *
 * So lists show what kind of evidence exists, which is the thing a patient can
 * actually act on. The number stays on the profile page, next to the
 * explanation of what it means.
 */

export type EvidenceTier =
  | "register"
  | "practice-confirmed"
  | "published-detail"
  | "listed";

export const TIER_LABEL: Record<EvidenceTier, string> = {
  register: "On the public register",
  "practice-confirmed": "Confirmed by the practice",
  "published-detail": "Detail published by the clinic",
  listed: "Listed among services",
};

/** Short form for a badge. */
export const TIER_SHORT: Record<EvidenceTier, string> = {
  register: "Register-backed",
  "practice-confirmed": "Practice-confirmed",
  "published-detail": "Published detail",
  listed: "Listed",
};

export function tierOf(evidence: Evidence[]): EvidenceTier {
  if (evidence.some((e) => e.kind.startsWith("rcdso-"))) return "register";
  if (evidence.some((e) => e.kind === "owner-verified")) return "practice-confirmed";
  if (
    evidence.some(
      (e) => e.kind === "site-detail" || e.kind === "in-house-technology",
    )
  ) {
    return "published-detail";
  }
  return "listed";
}

export function tierForOffering(offering: ProcedureOffering): EvidenceTier {
  return tierOf(offering.evidence);
}

/** Tier order, strongest first — used for sorting and for the legend. */
export const TIER_ORDER: EvidenceTier[] = [
  "register",
  "practice-confirmed",
  "published-detail",
  "listed",
];
