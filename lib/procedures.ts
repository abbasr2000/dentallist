/**
 * The procedure taxonomy.
 *
 * This is the spine of the whole site. dentistlist.org treats procedures as
 * flat boolean "services" tags, which means a clinic that placed four implants
 * last year looks identical to a practice with a periodontist on staff and a
 * CBCT scanner. We rank by evidence instead, so somebody searching "dental
 * implants Scarborough" lands at a clinic that actually does implants well.
 *
 * `aliases` matter as much as the label. Patients and referring offices use
 * shorthand ("exo", "RCT", "perio") and search engines see those as distinct
 * queries. Every alias is a phrase we should be findable for.
 */

export type ProcedureKey =
  | "dental-implants"
  | "root-canal"
  | "extractions"
  | "wisdom-teeth"
  | "orthodontics"
  | "invisalign"
  | "cosmetic-dentistry"
  | "teeth-whitening"
  | "crowns-and-bridges"
  | "dentures"
  | "gum-disease"
  | "pediatric-dentistry"
  | "oral-surgery"
  | "sedation-dentistry"
  | "emergency-dentistry";

export interface Procedure {
  key: ProcedureKey;
  /** Patient-facing name, used in headings and prose. */
  label: string;
  /** Short form for badges and chips. */
  short: string;
  /** Clinical name, shown to referring offices and in schema markup. */
  clinical: string;
  /** Other things people call it. Drives search and on-page synonym copy. */
  aliases: string[];
  /** One sentence explaining the procedure to a patient who is choosing. */
  blurb: string;
  /** What actually distinguishes a strong provider. Shown on facet pages. */
  whatMatters: string;
  /** RCDSO specialty titles that directly evidence strength here. */
  relatedSpecialties: string[];
}

export const PROCEDURES: Procedure[] = [
  {
    key: "dental-implants",
    label: "Dental implants",
    short: "Implants",
    clinical: "Endosseous implant placement and restoration",
    aliases: ["implants", "tooth implant", "implant dentist", "All-on-4", "implant supported dentures"],
    blurb:
      "A titanium post placed in the jaw to replace a missing tooth root, then restored with a crown.",
    whatMatters:
      "Placement and restoration are different skills. Ask whether the clinic does both in-house or refers the surgical half out, and whether they have a CBCT scanner for planning.",
    relatedSpecialties: ["Periodontics", "Oral and Maxillofacial Surgery", "Prosthodontics"],
  },
  {
    key: "root-canal",
    label: "Root canal treatment",
    short: "Endo",
    clinical: "Endodontic therapy",
    aliases: ["endo", "endodontics", "RCT", "root canal therapy", "endodontist"],
    blurb:
      "Removing infected pulp from inside a tooth so the tooth can be kept rather than pulled.",
    whatMatters:
      "Molars with curved or extra canals are where general practice ends and endodontics begins. A clinic with a registered endodontist or a surgical microscope handles retreatments others refer out.",
    relatedSpecialties: ["Endodontics"],
  },
  {
    key: "extractions",
    label: "Tooth extractions",
    short: "Exo",
    clinical: "Dental extraction",
    aliases: ["exo", "exos", "tooth removal", "tooth pulled", "surgical extraction"],
    blurb: "Removing a tooth that cannot be saved, or that is crowding the bite.",
    whatMatters:
      "Simple extractions are routine anywhere. Surgical extractions, broken roots and same-day emergency exos need surgical training and, often, sedation.",
    relatedSpecialties: ["Oral and Maxillofacial Surgery"],
  },
  {
    key: "wisdom-teeth",
    label: "Wisdom teeth removal",
    short: "Wisdom teeth",
    clinical: "Third molar extraction",
    aliases: ["wisdom tooth", "third molar", "impacted wisdom teeth", "8s out"],
    blurb: "Removing third molars, usually because they are impacted or cannot be cleaned.",
    whatMatters:
      "Impacted and bony-impacted cases are a surgical procedure. Check for an oral surgeon on staff and a sedation permit if you want it done in one visit.",
    relatedSpecialties: ["Oral and Maxillofacial Surgery"],
  },
  {
    key: "orthodontics",
    label: "Braces and orthodontics",
    short: "Ortho",
    clinical: "Orthodontic treatment",
    aliases: ["ortho", "braces", "orthodontist", "teeth straightening"],
    blurb: "Moving teeth into position with fixed braces or removable appliances.",
    whatMatters:
      "A registered orthodontist has three extra years of training. General dentists do straightforward cases well; complex bites and growing children are worth a specialist.",
    relatedSpecialties: ["Orthodontics and Dentofacial Orthopedics"],
  },
  {
    key: "invisalign",
    label: "Invisalign and clear aligners",
    short: "Invisalign",
    clinical: "Clear aligner therapy",
    aliases: ["clear aligners", "invisible braces", "aligners", "SmileDirect alternative"],
    blurb: "Removable clear trays that move teeth gradually, without fixed brackets.",
    whatMatters:
      "Provider tier reflects case volume, not skill alone, but a clinic that has treated hundreds of cases has seen more of what goes wrong.",
    relatedSpecialties: ["Orthodontics and Dentofacial Orthopedics"],
  },
  {
    key: "cosmetic-dentistry",
    label: "Cosmetic dentistry",
    short: "Cosmetic",
    clinical: "Aesthetic restorative dentistry",
    aliases: ["veneers", "smile makeover", "porcelain veneers", "bonding"],
    blurb: "Veneers, bonding and shaping done to change how teeth look rather than how they work.",
    whatMatters:
      "Ask to see the clinic's own before-and-after cases, not stock photography, and whether they use a lab you can name.",
    relatedSpecialties: ["Prosthodontics"],
  },
  {
    key: "teeth-whitening",
    label: "Teeth whitening",
    short: "Whitening",
    clinical: "Vital tooth bleaching",
    aliases: ["bleaching", "zoom whitening", "in-office whitening"],
    blurb: "Lightening tooth colour with peroxide gel, in-office or with custom take-home trays.",
    whatMatters:
      "Largely commodity. Price and whether they check for the causes of discolouration first are what separate offices.",
    relatedSpecialties: [],
  },
  {
    key: "crowns-and-bridges",
    label: "Crowns and bridges",
    short: "Crowns",
    clinical: "Fixed prosthodontics",
    aliases: ["cap", "dental crown", "bridge", "same-day crown", "CEREC"],
    blurb: "Covering a damaged tooth with a crown, or spanning a gap with a fixed bridge.",
    whatMatters:
      "An in-house milling unit means one visit instead of two and no temporary crown. Worth asking about if you cannot take two mornings off.",
    relatedSpecialties: ["Prosthodontics"],
  },
  {
    key: "dentures",
    label: "Dentures",
    short: "Dentures",
    clinical: "Removable prosthodontics",
    aliases: ["false teeth", "partial denture", "full denture", "denturist", "implant dentures"],
    blurb: "Removable replacements for several teeth or a full arch.",
    whatMatters:
      "Fit is everything and fit takes appointments. Ask how many try-in visits are included and whether relines are covered.",
    relatedSpecialties: ["Prosthodontics"],
  },
  {
    key: "gum-disease",
    label: "Gum disease treatment",
    short: "Perio",
    clinical: "Periodontal therapy",
    aliases: ["perio", "periodontist", "gum treatment", "deep cleaning", "scaling and root planing"],
    blurb: "Treating infection and bone loss around the teeth, from deep cleaning to gum surgery.",
    whatMatters:
      "Advanced bone loss and grafting are specialist work. A registered periodontist on staff is the clearest signal here.",
    relatedSpecialties: ["Periodontics"],
  },
  {
    key: "pediatric-dentistry",
    label: "Children's dentistry",
    short: "Kids",
    clinical: "Pediatric dentistry",
    aliases: ["pediatric dentist", "kids dentist", "children's dentist", "paediatric"],
    blurb: "Dental care shaped around young children, including first visits and anxious kids.",
    whatMatters:
      "A registered pediatric dentist is trained for very young children and for treating under sedation when a child cannot cooperate.",
    relatedSpecialties: ["Pediatric Dentistry"],
  },
  {
    key: "oral-surgery",
    label: "Oral surgery",
    short: "Oral surgery",
    clinical: "Oral and maxillofacial surgery",
    aliases: ["oral surgeon", "jaw surgery", "bone graft", "biopsy"],
    blurb: "Surgical procedures in the mouth and jaw beyond routine extractions.",
    whatMatters:
      "This is a recognised specialty. If a general office offers it, ask who performs it and where.",
    relatedSpecialties: ["Oral and Maxillofacial Surgery"],
  },
  {
    key: "sedation-dentistry",
    label: "Sedation dentistry",
    short: "Sedation",
    clinical: "Procedural sedation",
    aliases: ["sleep dentistry", "laughing gas", "nitrous oxide", "IV sedation", "dental anxiety"],
    blurb: "Nitrous oxide, oral or IV sedation for patients who cannot tolerate treatment awake.",
    whatMatters:
      "Sedation is permit-controlled in Ontario. The RCDSO register records which facilities hold which permit, so this is one signal you can verify rather than take on trust.",
    relatedSpecialties: ["Dental Anaesthesia"],
  },
  {
    key: "emergency-dentistry",
    label: "Emergency dental care",
    short: "Emergency",
    clinical: "Urgent dental care",
    aliases: ["emergency dentist", "walk in dentist", "same day dentist", "24 hour dentist", "toothache"],
    blurb: "Same-day care for pain, swelling, a broken tooth or a knocked-out tooth.",
    whatMatters:
      "Everyone claims it. What counts is whether they hold same-day slots, answer the phone after hours, and can actually do the exo or the RCT that day rather than just prescribe antibiotics.",
    relatedSpecialties: [],
  },
];

const BY_KEY = new Map(PROCEDURES.map((p) => [p.key, p]));


/**
 * Whether a specialty named on the RCDSO register is one of a procedure's.
 *
 * The register's own labels are not the formal college names this taxonomy was
 * written with. It says "Orthodontics", not "Orthodontics and Dentofacial
 * Orthopedics"; "Oral & Maxillofacial Surgery" with an ampersand; and "Dental
 * Anesthesiology" in American spelling. Comparing the strings directly lost
 * three specialties of seven silently — including orthodontics and oral
 * surgery, which between them are the largest body of specialists in Ontario.
 *
 * So both sides are normalised before comparison, and a check asserts the
 * register's real labels all still match.
 */
function canonicalSpecialty(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/anaesth/g, "anesth")
    // The register says "Dental Anesthesiology"; the college's formal name is
    // "Dental Anaesthesia". Same registration, two words for it.
    .replace(/anesthesiolog\w*/g, "anesthesia")
    .replace(/\band dentofacial orthopedics\b/g, "")
    .replace(/\bdentistry\b/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

export function matchesSpecialty(procedure: Procedure, registerLabel: string): boolean {
  const target = canonicalSpecialty(registerLabel);
  if (!target) return false;
  return (procedure.relatedSpecialties ?? []).some((s) => canonicalSpecialty(s) === target);
}

/** Every procedure a register specialty is evidence for. */
export function proceduresForSpecialty(registerLabel: string): Procedure[] {
  return PROCEDURES.filter((p) => matchesSpecialty(p, registerLabel));
}

export function getProcedure(key: string): Procedure | undefined {
  return BY_KEY.get(key as ProcedureKey);
}

export function procedureKeys(): ProcedureKey[] {
  return PROCEDURES.map((p) => p.key);
}
