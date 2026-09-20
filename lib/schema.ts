import { SITE, absolute, paths } from "./site";
import { getProcedure, type ProcedureKey } from "./procedures";
import type { City, Clinic } from "./types";

/**
 * JSON-LD builders.
 *
 * Note on the clinic type: schema.org's type for a dental practice is
 * `Dentist` (a subtype of MedicalBusiness and LocalBusiness). dentistlist.org's
 * llms.txt claims to emit `DentalCare`, which is not a schema.org type — search
 * engines discard it. We use `Dentist`.
 *
 * No `aggregateRating` or `review` is emitted anywhere. RCDSO advertising
 * guidelines prohibit testimonials for Ontario registrants, and review markup
 * on a paid listing reads as the registrant's own advertising. Ratings can be
 * added later if the position is confirmed; taking them back out after a
 * complaint is harder.
 */

type Json = Record<string, unknown>;

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

export function organization(): Json {
  return {
    "@type": "Organization",
    "@id": absolute("/#organization"),
    name: SITE.name,
    url: absolute("/"),
    description: SITE.description,
  };
}

export function website(): Json {
  return {
    "@type": "WebSite",
    "@id": absolute("/#website"),
    url: absolute("/"),
    name: SITE.name,
    publisher: { "@id": absolute("/#organization") },
    inLanguage: SITE.locale,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absolute("/search/?q={search_term_string}"),
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbs(
  trail: Array<{ name: string; path: string }>,
): Json {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absolute(item.path),
    })),
  };
}

export function faqPage(
  qa: Array<{ question: string; answer: string }>,
): Json | null {
  if (qa.length === 0) return null;
  return {
    "@type": "FAQPage",
    mainEntity: qa.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function clinicList(clinics: Clinic[], name: string): Json {
  return {
    "@type": "ItemList",
    name,
    numberOfItems: clinics.length,
    itemListElement: clinics.map((clinic, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: absolute(paths.clinic(clinic.citySlug, clinic.slug)),
      name: clinic.name,
    })),
  };
}

export function collectionPage(
  url: string,
  name: string,
  description: string,
  list: Json,
): Json {
  return {
    "@type": "CollectionPage",
    "@id": absolute(url),
    url: absolute(url),
    name,
    description,
    isPartOf: { "@id": absolute("/#website") },
    mainEntity: list,
  };
}

export function dentist(clinic: Clinic, city: City): Json {
  const node: Json = {
    "@type": "Dentist",
    "@id": absolute(paths.clinic(clinic.citySlug, clinic.slug)) + "#clinic",
    name: clinic.name,
    url: absolute(paths.clinic(clinic.citySlug, clinic.slug)),
    address: {
      "@type": "PostalAddress",
      // Only the parts we actually have. An undefined streetAddress serialises
      // to a missing key, but writing the key out with a blank value would be
      // a claim we cannot source.
      ...(clinic.address ? { streetAddress: clinic.address } : {}),
      addressLocality: city.municipality ?? city.name,
      addressRegion: "ON",
      ...(clinic.postalCode ? { postalCode: clinic.postalCode } : {}),
      addressCountry: "CA",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: clinic.lat,
      longitude: clinic.lng,
    },
    areaServed: { "@type": "City", name: city.name },
  };

  if (clinic.phone) node.telephone = clinic.phone;
  if (clinic.website) node.sameAs = [clinic.website];
  if (clinic.yearEstablished) node.foundingDate = String(clinic.yearEstablished);

  if (clinic.languages.value.length > 0) {
    node.knowsLanguage = ["English", ...clinic.languages.value];
  }

  if (clinic.hours.length > 0) {
    node.openingHoursSpecification = clinic.hours.map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${DAY_NAMES[h.day]}`,
      opens: h.opens,
      closes: h.closes,
    }));
  }

  // Only procedures with real evidence behind them. A bare mention on the
  // clinic's own website is not a claim we want to restate in markup.
  const offered = clinic.procedures.filter((p) => p.strength > 0);
  if (offered.length > 0) {
    node.availableService = offered.map((offering) => {
      const proc = getProcedure(offering.procedure);
      return {
        "@type": "MedicalProcedure",
        name: proc?.label ?? offering.procedure,
        ...(proc?.clinical ? { alternateName: proc.clinical } : {}),
      };
    });
  }

  if (clinic.practitioners.length > 0) {
    node.employee = clinic.practitioners.map((person) => ({
      "@type": "Person",
      name: person.name,
      ...(person.specialty ? { jobTitle: person.specialty } : {}),
    }));
  }

  if (clinic.accessibility.wheelchairAccessible?.value) {
    node.isAccessibleForFree = undefined;
    node.amenityFeature = [
      {
        "@type": "LocationFeatureSpecification",
        name: "Wheelchair accessible",
        value: true,
      },
    ];
  }

  return node;
}

/** Wraps nodes in a single @graph, which is what we render into the page. */
export function graph(...nodes: Array<Json | null>): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": nodes.filter((n): n is Json => n !== null),
  });
}

export function procedurePage(
  city: City,
  procedure: ProcedureKey,
  clinics: Clinic[],
): Json {
  const proc = getProcedure(procedure);
  const name = `${proc?.label ?? procedure} in ${city.name}`;
  return collectionPage(
    paths.procedureInCity(city.slug, procedure),
    name,
    `Dental clinics in ${city.name} that offer ${(proc?.label ?? procedure).toLowerCase()}, ordered by verifiable evidence.`,
    clinicList(clinics, name),
  );
}
