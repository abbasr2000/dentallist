import type { City, Clinic } from "@/lib/types";
import { buildOffering } from "@/lib/strength";
import type { Evidence, Provenance } from "@/lib/types";

/**
 * Development seed data.
 *
 * IMPORTANT: this is illustrative sample data for building and reviewing the
 * page templates. It is NOT the real dataset. Addresses, phone numbers and
 * evidence here are placeholders except where marked, and nothing in this file
 * should ever be deployed to production — `lib/data.ts` reads from Supabase
 * when DATABASE_URL is set and falls back to this only in development.
 *
 * The real data arrives from the RCDSO register and OpenStreetMap via the
 * scripts in ingest/.
 */

const CHECKED = "2026-09-20";

function p(source: Provenance["source"], url?: string, quote?: string): Provenance {
  return { source, url, quote, checkedAt: CHECKED };
}

function ev(
  kind: Evidence["kind"],
  detail: string,
  provenance: Provenance,
): Evidence {
  return { kind, detail, provenance };
}

export const CITIES: City[] = [
  {
    slug: "scarborough",
    name: "Scarborough",
    municipality: "Toronto",
    region: "Ontario",
    lat: 43.7764,
    lng: -79.2318,
    blurb:
      "Scarborough is part of the City of Toronto but people search for it by name, and its dental practices cluster along Lawrence, Eglinton and Kingston Road rather than downtown.",
    neighbourhoods: [
      {
        slug: "cedarbrae",
        name: "Cedarbrae",
        citySlug: "scarborough",
        blurb:
          "Around Lawrence Avenue East and Markham Road, anchored by Cedarbrae Mall.",
      },
      {
        slug: "eglinton-east",
        name: "Eglinton East",
        citySlug: "scarborough",
        blurb: "The Eglinton Avenue East corridor between Kennedy and Midland.",
      },
      {
        slug: "agincourt",
        name: "Agincourt",
        citySlug: "scarborough",
        blurb:
          "North Scarborough around Sheppard and Kennedy, with a high concentration of multilingual practices.",
      },
    ],
  },
  {
    slug: "toronto",
    name: "Toronto",
    region: "Ontario",
    lat: 43.6532,
    lng: -79.3832,
    blurb:
      "Ontario's largest dental market. Downtown practices skew toward cosmetic and specialist referral work; the inner suburbs carry most of the general family practices.",
    neighbourhoods: [],
  },
];

export const CLINICS: Clinic[] = [
  {
    slug: "cedarbrae-dental-center",
    name: "Cedarbrae Dental Center",
    citySlug: "scarborough",
    neighbourhoodSlug: "cedarbrae",
    address: "3630 Lawrence Ave E, Scarborough, ON",
    postalCode: "M1G 1P6",
    lat: 43.7599,
    lng: -79.2261,
    phone: "416-431-4000",
    website: "https://cedarbrae.dental",
    hours: [
      { day: 1, opens: "09:00", closes: "19:00" },
      { day: 2, opens: "09:00", closes: "19:00" },
      { day: 3, opens: "09:00", closes: "19:00" },
      { day: 4, opens: "09:00", closes: "19:00" },
      { day: 5, opens: "09:00", closes: "17:00" },
      { day: 6, opens: "09:00", closes: "15:00" },
    ],
    languages: {
      value: ["Urdu", "Hindi", "Punjabi", "Tamil"],
      provenance: p("owner"),
    },
    procedures: [
      buildOffering("dental-implants", [
        ev("owner-verified", "Implant placement and restoration in-house", p("owner")),
        ev("in-house-technology", "CBCT scanner on site for implant planning", p("owner")),
      ]),
      buildOffering("root-canal", [
        ev("owner-verified", "Root canal treatment including molars", p("owner")),
      ]),
      buildOffering("extractions", [
        ev("owner-verified", "Simple and surgical extractions", p("owner")),
      ]),
      buildOffering("emergency-dentistry", [
        ev("owner-verified", "Same-day emergency appointments held daily", p("owner")),
      ]),
      buildOffering("invisalign", [
        ev("owner-verified", "Clear aligner treatment", p("owner")),
      ]),
      buildOffering("pediatric-dentistry", [
        ev("owner-verified", "Children's dentistry from first visit", p("owner")),
      ]),
    ],
    practitioners: [],
    accessibility: {
      wheelchairAccessible: { value: true, provenance: p("owner") },
      parkingOnSite: { value: true, provenance: p("owner") },
      nearTransit: { value: "Lawrence Ave E bus routes", provenance: p("owner") },
    },
    payment: {
      directBilling: { value: true, provenance: p("owner") },
      cdcp: { value: true, provenance: p("owner") },
      paymentPlans: { value: true, provenance: p("owner") },
    },
    availability: {
      acceptingNewPatients: { value: true, provenance: p("owner") },
      sameDayEmergency: { value: true, provenance: p("owner") },
      walkInsAccepted: { value: true, provenance: p("owner") },
    },
    tier: "claimed",
    sources: [p("owner")],
    lastUpdated: CHECKED,
  },
  {
    slug: "midland-dental-center",
    name: "Midland Dental Center",
    citySlug: "scarborough",
    neighbourhoodSlug: "eglinton-east",
    address: "2480 Eglinton Ave E, Scarborough, ON",
    postalCode: "M1K 2R2",
    lat: 43.7318,
    lng: -79.2636,
    phone: "416-266-3300",
    website: "https://midlanddental.ca",
    hours: [
      { day: 1, opens: "09:00", closes: "19:00" },
      { day: 2, opens: "09:00", closes: "19:00" },
      { day: 3, opens: "09:00", closes: "19:00" },
      { day: 4, opens: "09:00", closes: "19:00" },
      { day: 5, opens: "09:00", closes: "17:00" },
      { day: 6, opens: "09:00", closes: "15:00" },
    ],
    languages: {
      value: ["Urdu", "Hindi", "Punjabi", "Tamil"],
      provenance: p("owner"),
    },
    procedures: [
      buildOffering("dental-implants", [
        ev("owner-verified", "Implant placement and restoration in-house", p("owner")),
      ]),
      buildOffering("root-canal", [
        ev("owner-verified", "Root canal treatment including molars", p("owner")),
      ]),
      buildOffering("extractions", [
        ev("owner-verified", "Simple and surgical extractions", p("owner")),
      ]),
      buildOffering("wisdom-teeth", [
        ev("owner-verified", "Wisdom tooth removal", p("owner")),
      ]),
      buildOffering("emergency-dentistry", [
        ev("owner-verified", "Same-day emergency appointments held daily", p("owner")),
      ]),
      buildOffering("crowns-and-bridges", [
        ev("owner-verified", "Crowns and fixed bridges", p("owner")),
      ]),
    ],
    practitioners: [],
    accessibility: {
      wheelchairAccessible: { value: true, provenance: p("owner") },
      parkingOnSite: { value: true, provenance: p("owner") },
    },
    payment: {
      directBilling: { value: true, provenance: p("owner") },
      cdcp: { value: true, provenance: p("owner") },
      paymentPlans: { value: true, provenance: p("owner") },
    },
    availability: {
      acceptingNewPatients: { value: true, provenance: p("owner") },
      sameDayEmergency: { value: true, provenance: p("owner") },
      walkInsAccepted: { value: true, provenance: p("owner") },
    },
    tier: "claimed",
    sources: [p("owner")],
    lastUpdated: CHECKED,
  },

  /* --- Placeholder neighbours, to exercise ranking and the page templates. --- */

  {
    slug: "sample-perio-associates",
    name: "Sample Periodontal Associates",
    citySlug: "scarborough",
    neighbourhoodSlug: "agincourt",
    address: "Sample address, Scarborough, ON",
    postalCode: "M1S 0A1",
    lat: 43.7854,
    lng: -79.2789,
    phone: "416-000-0001",
    website: undefined,
    hours: [
      { day: 1, opens: "08:00", closes: "16:00" },
      { day: 2, opens: "08:00", closes: "16:00" },
      { day: 3, opens: "08:00", closes: "16:00" },
      { day: 4, opens: "08:00", closes: "16:00" },
    ],
    languages: { value: ["Cantonese", "Mandarin"], provenance: p("clinic-site", "https://example.invalid", "We speak Cantonese and Mandarin.") },
    procedures: [
      buildOffering("gum-disease", [
        ev("rcdso-specialist", "Periodontist on staff (sample record)", p("rcdso")),
      ]),
      buildOffering("dental-implants", [
        ev("rcdso-specialist", "Periodontist on staff (sample record)", p("rcdso")),
        ev("rcdso-cbct-permit", "CT scanner permit on file (sample record)", p("rcdso")),
      ]),
    ],
    practitioners: [
      {
        name: "Dr Sample Periodontist",
        specialty: "Periodontics",
        provenance: p("rcdso"),
      },
    ],
    accessibility: { wheelchairAccessible: { value: true, provenance: p("osm") } },
    payment: {},
    availability: {},
    tier: "unclaimed",
    sources: [p("rcdso"), p("osm")],
    lastUpdated: CHECKED,
  },
  {
    slug: "sample-endodontics-clinic",
    name: "Sample Endodontic Clinic",
    citySlug: "scarborough",
    address: "Sample address, Scarborough, ON",
    postalCode: "M1P 0A2",
    lat: 43.7731,
    lng: -79.2578,
    phone: "416-000-0002",
    hours: [
      { day: 1, opens: "09:00", closes: "17:00" },
      { day: 3, opens: "09:00", closes: "17:00" },
      { day: 5, opens: "09:00", closes: "17:00" },
    ],
    languages: { value: [], provenance: p("osm") },
    procedures: [
      buildOffering("root-canal", [
        ev("rcdso-specialist", "Endodontist on staff (sample record)", p("rcdso")),
        ev("in-house-technology", "Surgical microscope (sample record)", p("clinic-site", "https://example.invalid", "Treatment is carried out under a surgical microscope.")),
      ]),
      buildOffering("sedation-dentistry", [
        ev("rcdso-sedation-permit", "Sedation permit on file (sample record)", p("rcdso")),
      ]),
    ],
    practitioners: [
      { name: "Dr Sample Endodontist", specialty: "Endodontics", provenance: p("rcdso") },
    ],
    accessibility: {},
    payment: {},
    availability: {},
    tier: "unclaimed",
    sources: [p("rcdso")],
    lastUpdated: CHECKED,
  },
  {
    slug: "sample-family-dental",
    name: "Sample Family Dental",
    citySlug: "scarborough",
    address: "Sample address, Scarborough, ON",
    postalCode: "M1J 0A3",
    lat: 43.7502,
    lng: -79.2312,
    phone: "416-000-0003",
    website: "https://example.invalid",
    hours: [
      { day: 1, opens: "10:00", closes: "18:00" },
      { day: 2, opens: "10:00", closes: "18:00" },
      { day: 4, opens: "10:00", closes: "18:00" },
    ],
    languages: { value: ["Tamil"], provenance: p("clinic-site", "https://example.invalid", "Tamil spoken.") },
    procedures: [
      buildOffering("teeth-whitening", [
        ev("site-mention", "Whitening listed among services", p("clinic-site", "https://example.invalid", "Services: cleanings, fillings, whitening.")),
      ]),
      buildOffering("extractions", [
        ev("site-mention", "Extractions listed among services", p("clinic-site", "https://example.invalid", "We also perform extractions.")),
      ]),
    ],
    practitioners: [],
    accessibility: {},
    payment: {},
    availability: {},
    tier: "unclaimed",
    sources: [p("osm"), p("clinic-site")],
    lastUpdated: CHECKED,
  },

  /* Six more placeholder neighbours so the city page and the procedure pages
     have a realistic amount to render. Same caveat as above: sample data. */

  {
    slug: "sample-kingston-road-dental",
    name: "Sample Kingston Road Dental",
    citySlug: "scarborough",
    address: "Sample address, Scarborough, ON",
    postalCode: "M1M 0A4",
    lat: 43.7192,
    lng: -79.2296,
    phone: "416-000-0004",
    website: "https://example.invalid",
    hours: [
      { day: 1, opens: "09:00", closes: "17:00" },
      { day: 2, opens: "09:00", closes: "17:00" },
      { day: 3, opens: "09:00", closes: "17:00" },
      { day: 4, opens: "09:00", closes: "17:00" },
      { day: 5, opens: "09:00", closes: "16:00" },
    ],
    languages: { value: ["Greek"], provenance: p("clinic-site", "https://example.invalid", "Sample quote.") },
    procedures: [
      buildOffering("extractions", [
        ev("site-detail", "Surgical extractions listed with same-week availability", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
      buildOffering("emergency-dentistry", [
        ev("site-mention", "Emergency appointments listed among services", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
      buildOffering("crowns-and-bridges", [
        ev("site-mention", "Crowns listed among services", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
    ],
    practitioners: [],
    accessibility: {},
    payment: {},
    availability: {},
    tier: "unclaimed",
    sources: [p("osm"), p("clinic-site")],
    lastUpdated: CHECKED,
  },
  {
    slug: "sample-markham-road-dental",
    name: "Sample Markham Road Dental",
    citySlug: "scarborough",
    address: "Sample address, Scarborough, ON",
    postalCode: "M1B 0A5",
    lat: 43.8021,
    lng: -79.2262,
    phone: "416-000-0005",
    website: "https://example.invalid",
    hours: [
      { day: 1, opens: "09:00", closes: "17:00" },
      { day: 2, opens: "09:00", closes: "17:00" },
      { day: 3, opens: "09:00", closes: "17:00" },
      { day: 4, opens: "09:00", closes: "17:00" },
      { day: 5, opens: "09:00", closes: "16:00" },
    ],
    languages: { value: ["Tamil", "Sinhala"], provenance: p("clinic-site", "https://example.invalid", "Sample quote.") },
    procedures: [
      buildOffering("extractions", [
        ev("site-mention", "Extractions listed among services", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
      buildOffering("root-canal", [
        ev("site-mention", "Root canals listed among services", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
      buildOffering("emergency-dentistry", [
        ev("site-detail", "States walk-in emergency slots held each morning", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
    ],
    practitioners: [],
    accessibility: {},
    payment: {},
    availability: {},
    tier: "unclaimed",
    sources: [p("osm"), p("clinic-site")],
    lastUpdated: CHECKED,
  },
  {
    slug: "sample-sheppard-dental-care",
    name: "Sample Sheppard Dental Care",
    citySlug: "scarborough",
    address: "Sample address, Scarborough, ON",
    postalCode: "M1T 0A6",
    lat: 43.7789,
    lng: -79.3012,
    phone: "416-000-0006",
    website: "https://example.invalid",
    hours: [
      { day: 1, opens: "09:00", closes: "17:00" },
      { day: 2, opens: "09:00", closes: "17:00" },
      { day: 3, opens: "09:00", closes: "17:00" },
      { day: 4, opens: "09:00", closes: "17:00" },
      { day: 5, opens: "09:00", closes: "16:00" },
    ],
    languages: { value: ["Mandarin"], provenance: p("clinic-site", "https://example.invalid", "Sample quote.") },
    procedures: [
      buildOffering("extractions", [
        ev("site-mention", "Extractions listed among services", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
      buildOffering("wisdom-teeth", [
        ev("site-detail", "Lists impacted wisdom tooth removal", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
      buildOffering("sedation-dentistry", [
        ev("rcdso-sedation-permit", "Sedation permit on file (sample record)", p("rcdso")),
      ]),
    ],
    practitioners: [],
    accessibility: {},
    payment: {},
    availability: {},
    tier: "unclaimed",
    sources: [p("osm"), p("clinic-site")],
    lastUpdated: CHECKED,
  },
  {
    slug: "sample-danforth-family-dental",
    name: "Sample Danforth Family Dental",
    citySlug: "scarborough",
    address: "Sample address, Scarborough, ON",
    postalCode: "M1L 0A7",
    lat: 43.6918,
    lng: -79.2874,
    phone: "416-000-0007",
    website: "https://example.invalid",
    hours: [
      { day: 1, opens: "09:00", closes: "17:00" },
      { day: 2, opens: "09:00", closes: "17:00" },
      { day: 3, opens: "09:00", closes: "17:00" },
      { day: 4, opens: "09:00", closes: "17:00" },
      { day: 5, opens: "09:00", closes: "16:00" },
    ],
    languages: { value: ["Portuguese"], provenance: p("clinic-site", "https://example.invalid", "Sample quote.") },
    procedures: [
      buildOffering("emergency-dentistry", [
        ev("site-mention", "Emergency care listed among services", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
      buildOffering("extractions", [
        ev("site-mention", "Extractions listed among services", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
      buildOffering("pediatric-dentistry", [
        ev("site-mention", "Children welcome, listed among services", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
    ],
    practitioners: [],
    accessibility: {},
    payment: {},
    availability: {},
    tier: "unclaimed",
    sources: [p("osm"), p("clinic-site")],
    lastUpdated: CHECKED,
  },
  {
    slug: "sample-birchmount-dental",
    name: "Sample Birchmount Dental",
    citySlug: "scarborough",
    address: "Sample address, Scarborough, ON",
    postalCode: "M1K 0A8",
    lat: 43.7241,
    lng: -79.2652,
    phone: "416-000-0008",
    website: "https://example.invalid",
    hours: [
      { day: 1, opens: "09:00", closes: "17:00" },
      { day: 2, opens: "09:00", closes: "17:00" },
      { day: 3, opens: "09:00", closes: "17:00" },
      { day: 4, opens: "09:00", closes: "17:00" },
      { day: 5, opens: "09:00", closes: "16:00" },
    ],
    languages: { value: ["Tagalog"], provenance: p("clinic-site", "https://example.invalid", "Sample quote.") },
    procedures: [
      buildOffering("emergency-dentistry", [
        ev("site-detail", "Publishes an after-hours emergency number", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
      buildOffering("dental-implants", [
        ev("site-mention", "Implants listed among services", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
      buildOffering("dentures", [
        ev("site-detail", "Lists same-week denture relines", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
    ],
    practitioners: [],
    accessibility: {},
    payment: {},
    availability: {},
    tier: "unclaimed",
    sources: [p("osm"), p("clinic-site")],
    lastUpdated: CHECKED,
  },
  {
    slug: "sample-warden-dental-group",
    name: "Sample Warden Dental Group",
    citySlug: "scarborough",
    address: "Sample address, Scarborough, ON",
    postalCode: "M1R 0A9",
    lat: 43.7562,
    lng: -79.2941,
    phone: "416-000-0009",
    website: "https://example.invalid",
    hours: [
      { day: 1, opens: "09:00", closes: "17:00" },
      { day: 2, opens: "09:00", closes: "17:00" },
      { day: 3, opens: "09:00", closes: "17:00" },
      { day: 4, opens: "09:00", closes: "17:00" },
      { day: 5, opens: "09:00", closes: "16:00" },
    ],
    languages: { value: [], provenance: p("clinic-site", "https://example.invalid", "Sample quote.") },
    procedures: [
      buildOffering("emergency-dentistry", [
        ev("site-mention", "Emergency care listed among services", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
      buildOffering("root-canal", [
        ev("site-detail", "Lists molar root canal treatment", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
      buildOffering("extractions", [
        ev("site-mention", "Extractions listed among services", p("clinic-site", "https://example.invalid", "Sample quote.")),
      ]),
    ],
    practitioners: [],
    accessibility: {},
    payment: {},
    availability: {},
    tier: "unclaimed",
    sources: [p("osm"), p("clinic-site")],
    lastUpdated: CHECKED,
  },

];
