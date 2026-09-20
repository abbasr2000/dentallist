import type { ProcedureKey } from "./procedures";

/**
 * Provenance is not optional here.
 *
 * Every fact we publish about a clinic we do not own has to say where it came
 * from. That is what lets us show "listed on their website" with a link next to
 * a claim, and it is the thing that stops an extraction model from quietly
 * inventing a service the clinic does not offer: if there is no quote, there is
 * no field.
 */
export type SourceKind =
  | "rcdso" // Royal College of Dental Surgeons of Ontario public register
  | "osm" // OpenStreetMap / Overpass
  | "places" // Google Places API (refreshed, not stored long-term)
  | "clinic-site" // extracted from the clinic's own website
  | "owner" // submitted by a verified owner of the listing
  | "editorial"; // written by us, e.g. a city introduction

export interface Provenance {
  source: SourceKind;
  /** The page this came from, where one exists. */
  url?: string;
  /** The sentence the fact was taken from. Required for `clinic-site`. */
  quote?: string;
  /** ISO date the fact was last confirmed. */
  checkedAt: string;
}

/** A value plus the receipt for it. */
export interface Sourced<T> {
  value: T;
  provenance: Provenance;
}

/* ------------------------------------------------------------------ */
/* Evidence and procedure strength                                     */
/* ------------------------------------------------------------------ */

/**
 * Why we say a clinic is good at something.
 *
 * Weights are deliberately lopsided. A sedation permit or a registered
 * specialist is a fact on a government register; a sentence on the clinic's
 * own website is marketing. They should never count the same.
 */
export type EvidenceKind =
  | "rcdso-specialist" // a registered specialist in this field practises here
  | "rcdso-sedation-permit" // facility holds a sedation/anaesthesia permit
  | "rcdso-cbct-permit" // facility holds a CT scanner permit
  | "owner-verified" // claimed listing, owner attested, we spot-checked
  | "in-house-technology" // e.g. milling unit, surgical microscope
  | "site-detail" // a specific, checkable detail on their own site
  | "site-mention"; // the service simply appears in their list

export const EVIDENCE_WEIGHT: Record<EvidenceKind, number> = {
  "rcdso-specialist": 45,
  "rcdso-sedation-permit": 25,
  "rcdso-cbct-permit": 20,
  "owner-verified": 15,
  "in-house-technology": 15,
  "site-detail": 10,
  "site-mention": 5,
};

export interface Evidence {
  kind: EvidenceKind;
  /** Shown to the patient, e.g. "Periodontist on staff — Dr. A. Rahman". */
  detail: string;
  provenance: Provenance;
}

export interface ProcedureOffering {
  procedure: ProcedureKey;
  /** 0-100, computed from evidence. Never hand-set. See lib/strength.ts. */
  strength: number;
  evidence: Evidence[];
}

/* ------------------------------------------------------------------ */
/* Practical details patients filter on                                */
/* ------------------------------------------------------------------ */

export interface OpeningHours {
  /** 0 = Sunday. Closed days are simply absent. */
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  opens: string; // "09:00"
  closes: string; // "18:00"
}

export interface Accessibility {
  wheelchairAccessible?: Sourced<boolean>;
  parkingOnSite?: Sourced<boolean>;
  nearTransit?: Sourced<string>;
}

export interface Payment {
  /** Bills the insurer directly rather than making the patient claim. */
  directBilling?: Sourced<boolean>;
  /** Named insurers they direct-bill. */
  insurers?: Sourced<string[]>;
  /** Canadian Dental Care Plan. */
  cdcp?: Sourced<boolean>;
  paymentPlans?: Sourced<boolean>;
  /** Published fee ranges, keyed by procedure. Owner-submitted in practice. */
  publishedFees?: Sourced<Array<{ procedure: ProcedureKey; from: number; to?: number }>>;
}

export interface Availability {
  acceptingNewPatients?: Sourced<boolean>;
  /** Typical wait for a new-patient exam, in days. Owner-submitted. */
  newPatientWaitDays?: Sourced<number>;
  onlineBooking?: Sourced<string>; // booking URL
  sameDayEmergency?: Sourced<boolean>;
  afterHoursPhone?: Sourced<boolean>;
  walkInsAccepted?: Sourced<boolean>;
}

export interface Practitioner {
  name: string;
  /** RCDSO registration number, where matched. */
  registrationNumber?: string;
  /** RCDSO-registered specialty, if any. */
  specialty?: string;
  credentials?: string;
  bio?: string;
  provenance: Provenance;
}

/* ------------------------------------------------------------------ */
/* The clinic                                                          */
/* ------------------------------------------------------------------ */

export type ListingTier = "unclaimed" | "claimed" | "featured";

export interface Clinic {
  slug: string;
  name: string;
  citySlug: string;
  neighbourhoodSlug?: string;

  address: string;
  postalCode: string;
  lat: number;
  lng: number;
  phone: string;
  website?: string;
  email?: string;

  hours: OpeningHours[];
  /** Languages other than English. */
  languages: Sourced<string[]>;

  procedures: ProcedureOffering[];
  practitioners: Practitioner[];
  accessibility: Accessibility;
  payment: Payment;
  availability: Availability;

  /** Public aggregate rating, refreshed rather than stored indefinitely. */
  rating?: { value: number; count: number; checkedAt: string };

  yearEstablished?: number;
  photos?: Array<{ url: string; alt: string }>;

  tier: ListingTier;
  /** Only meaningful when tier is "featured". Sponsored slots are labelled. */
  featuredUntil?: string;

  sources: Provenance[];
  lastUpdated: string;
}

export interface Neighbourhood {
  slug: string;
  name: string;
  citySlug: string;
  /** One or two sentences a local would recognise. Editorial. */
  blurb: string;
}

export interface City {
  slug: string;
  name: string;
  /** Formal municipality, where it differs from the name people search. */
  municipality?: string;
  region: string;
  lat: number;
  lng: number;
  blurb: string;
  neighbourhoods: Neighbourhood[];
}
