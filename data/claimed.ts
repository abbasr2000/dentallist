import type { Evidence, OpeningHours, Provenance } from "@/lib/types";
import type { ProcedureKey } from "@/lib/procedures";

/**
 * Listings whose owner has confirmed them.
 *
 * The ingest can only publish what a public source says, and public sources
 * are thin: OpenStreetMap has a street address for half of Ontario's practices
 * and the register has no hours, no languages and no list of what a general
 * practice actually does. A practice that tells us those things directly
 * should benefit from it, and that is the whole business model — a clinic
 * fills its listing in and the listing gets better.
 *
 * What a claim is NOT is a way to buy position. Owner-verified evidence is
 * worth 15 against a register specialty's 45, and an unverified clinic is
 * capped at 55 no matter how much it tells us, so no amount of self-description
 * outranks a regulator's record. See lib/strength.ts.
 *
 * Every field still needs provenance. "The owner told us, on this date" is a
 * real and checkable source; "we assumed" is not, and there is no way to
 * express it here.
 *
 * This file is the interim mechanism. Once clinics can edit their own listings
 * these rows live in Supabase and this becomes the seed for the ones that were
 * claimed before that existed.
 */

export interface ClaimedListing {
  /** How to find the ingested record: phone is the most stable key we have. */
  matchPhone?: string;
  /** Fallback when there is no phone: street address plus city slug. */
  matchAddress?: { address: string; citySlug: string };

  /** Who confirmed it and when. Shown on the profile as the source. */
  confirmedBy: string;
  confirmedOn: string;

  name?: string;
  website?: string;
  email?: string;
  hours?: OpeningHours[];
  languages?: string[];
  /** Procedures the owner says they offer. Weighted as owner-verified. */
  procedures?: Array<{ procedure: ProcedureKey; detail: string }>;
  accepting?: boolean;
  wheelchairAccessible?: boolean;
  parkingOnSite?: boolean;
  directBilling?: boolean;
  insurers?: string[];
  /** Canadian Dental Care Plan. */
  cdcp?: boolean;
  onlineBooking?: string;
  sameDayEmergency?: boolean;
  walkInsAccepted?: boolean;
  newPatientWaitDays?: number;
  /**
   * Fee ranges, which almost nobody publishes and every patient wants. Stating
   * a range is a fact; "affordable" or "the best value in Scarborough" is the
   * kind of comparative claim the RCDSO's advertising guidelines prohibit, and
   * there is no field here to put one in.
   */
  publishedFees?: Array<{ procedure: ProcedureKey; from: number; to?: number }>;
}

export function ownerProvenance(listing: ClaimedListing): Provenance {
  return {
    source: "owner",
    quote: `Confirmed by ${listing.confirmedBy}`,
    checkedAt: listing.confirmedOn,
  };
}

export function ownerEvidence(
  listing: ClaimedListing,
  detail: string,
): Evidence {
  return { kind: "owner-verified", detail, provenance: ownerProvenance(listing) };
}

/**
 * The claimed listings.
 *
 * Abbas Rizvi owns both of the practices below and confirmed them directly.
 * Only the facts he has actually stated are here — the practice name, address,
 * phone and website. Hours, languages and the procedure list are deliberately
 * absent rather than guessed at: the profile will say those are missing, which
 * is true, and he can fill them in.
 */
export const CLAIMED: ClaimedListing[] = [
  {
    matchPhone: "4169451000",
    matchAddress: { address: "3630 Lawrence Ave E", citySlug: "scarborough" },
    confirmedBy: "the practice owner",
    confirmedOn: "2026-09-20",
    name: "Cedarbrae Dental Center",
    website: "https://cedarbrae.dental",
  },
  {
    matchPhone: "4163691000",
    matchAddress: { address: "2480 Eglinton Ave E", citySlug: "scarborough" },
    confirmedBy: "the practice owner",
    confirmedOn: "2026-09-20",
    name: "Midland Dental Center",
    website: "https://midlanddental.ca",
  },
];
