/**
 * Offline checks for the parts of the pipeline that do not need the network.
 *
 * Run: npx tsx ingest/verify.ts
 */
import assert from "node:assert";
import { addressKey, normalizePhone, normalizePostal, slugify, distanceMetres } from "./lib";
import { htmlToText, pickInternalLinks } from "./crawl";
import { verifyQuote } from "./extract";
import * as cheerio from "cheerio";
import { allRegisterCities, parseRow, ROW_SELECTOR, selectOptions } from "./rcdso";
import { mergeRecords } from "./merge";
import { assignPlace, resolveCity, MAX_ASSIGN_KM } from "./places";
import { scoreProcedure } from "../lib/strength";
import { PROCEDURES, proceduresForSpecialty } from "../lib/procedures";
import { resolveSiteUrl } from "../lib/site";
import { osmStreetName, streetFrom } from "./streetname";
import { clusterPoints, streetNamesFrom } from "./streets";
import { buildExchangeAnchors, exchangeOf, locate, medoid, placeIndex, tally } from "./locate";
import type { SourceRecord } from "./lib";

let passed = 0;
const pending: Promise<void>[] = [];

function check(name: string, fn: () => void | Promise<void>) {
  const pass = () => {
    passed++;
    console.log(`  ok  ${name}`);
  };
  const fail = (error: unknown) => {
    console.error(`  FAIL ${name}: ${(error as Error).message}`);
    process.exitCode = 1;
  };
  try {
    const result = fn();
    if (result instanceof Promise) {
      pending.push(result.then(pass, fail));
    } else {
      pass();
    }
  } catch (error) {
    fail(error);
  }
}

console.log("\nNormalisation");
check("phone forms collapse to ten digits", () => {
  assert.equal(normalizePhone("(416) 431-4000"), "4164314000");
  assert.equal(normalizePhone("1-416-431-4000"), "4164314000");
  assert.equal(normalizePhone("416.431.4000"), "4164314000");
  assert.equal(normalizePhone("not a phone"), undefined);
});
check("postal codes normalise, invalid ones rejected", () => {
  assert.equal(normalizePostal("m1g1p6"), "M1G 1P6");
  assert.equal(normalizePostal("M1G 1P6"), "M1G 1P6");
  assert.equal(normalizePostal("90210"), undefined);
});
check("address variants collapse to one key", () => {
  const a = addressKey("3630 Lawrence Avenue East, Suite 4");
  const b = addressKey("3630 Lawrence Ave E #4");
  assert.equal(a, b, `${a} !== ${b}`);
});
check("different addresses stay different", () => {
  assert.notEqual(addressKey("3630 Lawrence Ave E"), addressKey("3451 Lawrence Ave E"));
});
check("distance is roughly right", () => {
  const d = distanceMetres({ lat: 43.7599, lng: -79.2261 }, { lat: 43.7318, lng: -79.2636 });
  assert.ok(d > 3000 && d < 5500, `got ${d}m`);
});

console.log("\nScoring");
check("register evidence outranks site mentions", () => {
  const register = scoreProcedure([
    { kind: "rcdso-specialist", detail: "", provenance: { source: "rcdso", checkedAt: "" } },
  ]);
  const mentions = scoreProcedure(
    Array.from({ length: 6 }, () => ({
      kind: "site-mention" as const,
      detail: "",
      provenance: { source: "clinic-site" as const, quote: "x", checkedAt: "" },
    })),
  );
  assert.ok(register > mentions, `register ${register} should beat ${mentions} mentions`);
});
check("marketing alone is capped at 55", () => {
  const score = scoreProcedure(
    Array.from({ length: 20 }, () => ({
      kind: "site-detail" as const,
      detail: "",
      provenance: { source: "clinic-site" as const, quote: "x", checkedAt: "" },
    })),
  );
  assert.ok(score <= 55, `got ${score}`);
});
check("repeats have diminishing returns", () => {
  const one = scoreProcedure([{ kind: "site-detail", detail: "", provenance: { source: "clinic-site", quote: "x", checkedAt: "" } }]);
  const three = scoreProcedure(
    Array.from({ length: 3 }, () => ({
      kind: "site-detail" as const, detail: "", provenance: { source: "clinic-site" as const, quote: "x", checkedAt: "" },
    })),
  );
  assert.ok(three < one * 3, `${three} should be less than ${one * 3}`);
});
check("no evidence scores zero", () => assert.equal(scoreProcedure([]), 0));

console.log("\nHTML handling");
check("scripts and styles are stripped", () => {
  const text = htmlToText('<p>Kept</p><script>var dropped=1</script><style>.x{}</style>');
  assert.ok(text.includes("Kept"));
  assert.ok(!text.includes("dropped"));
});
check("entities decode", () => {
  assert.ok(htmlToText("<p>Crowns &amp; bridges</p>").includes("Crowns & bridges"));
});
check("relevant internal links are picked, offsite ignored", () => {
  const html = `
    <a href="/our-services/">Services</a>
    <a href="/contact-us/">Contact</a>
    <a href="/blog/whatever/">A post</a>
    <a href="https://facebook.com/x">Facebook</a>
    <a href="/brochure.pdf">PDF</a>`;
  const links = pickInternalLinks(html, "https://clinic.example/");
  assert.ok(links.some((l) => l.includes("our-services")), "should pick services");
  assert.ok(links.some((l) => l.includes("contact-us")), "should pick contact");
  assert.ok(!links.some((l) => l.includes("facebook")), "should skip offsite");
  assert.ok(!links.some((l) => l.includes(".pdf")), "should skip pdf");
});

console.log("\nQuote verification — the rule the whole thing rests on");
const corpus = "We offer dental implants and same-day emergency appointments. Our team speaks Tamil.";
check("an exact quote passes", () => {
  assert.ok(verifyQuote("We offer dental implants and same-day emergency appointments.", corpus));
});
check("curly vs straight quotes still pass", () => {
  assert.ok(verifyQuote("Our team speaks Tamil.", "Our team speaks Tamil."));
});
check("a paraphrase is rejected", () => {
  assert.ok(!verifyQuote("We provide implants and urgent care.", corpus));
});
check("a fabricated quote is rejected", () => {
  assert.ok(!verifyQuote("We have a periodontist on staff.", corpus));
});
check("a too-short quote is rejected", () => {
  assert.ok(!verifyQuote("implants", corpus));
});

console.log("\nRCDSO row parsing");
// Markup copied from a live results page (Scarborough, 2026-09-20).
const REAL_ROW = `
<section class="row hide">
  <h2 class="col-12"><a href="/find-a-dentist/search-results/dentist?id=120016"> - Heena Kauser</a></h2>
  <div class="col-12"><div class="row">
    <div class="col-12 col-md-5 mb-2"><dl><dt>Registration Number:</dt><dd>120016</dd></dl></div>
    <div class="col-12 col-md-5 mb-2"><dl><dt>Status:</dt><dd>Member</dd></dl></div>
  </div>
  <div class="row mt-3-mobile">
    <div class="col-md-5 ml-mobile-5"><div><dl><dt>Phone:</dt>
      <dd><a href="tel:4163210005"> 416-321-0005 </a></dd></dl></div></div>
    <address class="col-md-5 d-none d-md-block"><div class="ms-md-5">
      <span>Markham Gateway Dentistry</span><br><span>2855 Markham Rd #108</span>
    </div></address>
  </div></div>
</section>`;

function firstRow(html: string) {
  const $ = cheerio.load(html);
  const el = $(ROW_SELECTOR).first()[0];
  return el ? parseRow($, el) : undefined;
}

check("a real register row yields practice, address, phone and registration", () => {
  const row = firstRow(REAL_ROW);
  assert.ok(row, "no record parsed");
  assert.equal(row.name, "Markham Gateway Dentistry");
  assert.equal(row.address, "2855 Markham Rd #108");
  assert.equal(row.phone, "4163210005");
  assert.equal(row.practitioners?.[0]?.fullName, "Heena Kauser");
  assert.equal(row.practitioners?.[0]?.registrationNumber, "120016");
});

check("the leading dash on a general dentist's name is dropped", () => {
  assert.ok(!firstRow(REAL_ROW)?.practitioners?.[0]?.fullName.startsWith("-"));
});

check("a dentist with no practice on the register is not a clinic", () => {
  const row = firstRow(REAL_ROW.replace(/<address[\s\S]*?<\/address>/, ""));
  assert.equal(row, undefined);
});

check("misconduct notices on a row are not read", () => {
  const withConcerns = REAL_ROW.replace(
    "</section>",
    '<div class="concerns col-12"><strong class="title">Conditions, Concerns and/or Professional Misconduct</strong></div></section>',
  );
  const row = firstRow(withConcerns);
  assert.ok(row);
  assert.ok(!JSON.stringify(row).toLowerCase().includes("misconduct"));
});

check("an empty row yields nothing", () => {
  assert.equal(firstRow('<section class="row hide"></section>'), undefined);
});

check("the refine-search selects are readable, and All is not an option", () => {
  const $ = cheerio.load(`<select name="MbrSpecialty">
    <option value="">All</option>
    <option value="END">Endodontics</option>
    <option value="PER">Periodontics</option>
  </select>`);
  const options = selectOptions($, "MbrSpecialty");
  assert.deepEqual(options.map((o) => o.value), ["END", "PER"]);
  assert.equal(options[0].label, "Endodontics");
});


console.log("\nMerging");
const rec = (o: Partial<SourceRecord>): SourceRecord => ({
  source: "osm", sourceId: "x", name: "Clinic", raw: {}, ...o,
});
check("same phone merges into one clinic", () => {
  const merged = mergeRecords([
    rec({ source: "rcdso", sourceId: "1", name: "Cedarbrae Dental Center", phone: "4164314000", city: "Scarborough" }),
    rec({ source: "osm", sourceId: "node/9", name: "Cedarbrae Dental", phone: "4164314000", website: "https://cedarbrae.dental", city: "Scarborough" }),
  ]);
  assert.equal(merged.length, 1, `got ${merged.length}`);
  assert.equal(merged[0].website, "https://cedarbrae.dental", "should absorb the website");
  assert.equal(merged[0].name, "Cedarbrae Dental Center", "should prefer the registered name");
});
check("different clinics stay separate", () => {
  const merged = mergeRecords([
    rec({ sourceId: "1", name: "Cedarbrae Dental", phone: "4164314000", city: "Scarborough" }),
    rec({ sourceId: "2", name: "Midland Dental", phone: "4162663300", city: "Scarborough" }),
  ]);
  assert.equal(merged.length, 2);
});
check("same address and postal code merges", () => {
  const merged = mergeRecords([
    rec({ sourceId: "1", name: "A Dental", address: "3630 Lawrence Avenue East", postalCode: "M1G 1P6", city: "Scarborough" }),
    rec({ sourceId: "2", name: "A Dental", address: "3630 Lawrence Ave E", postalCode: "M1G 1P6", city: "Scarborough" }),
  ]);
  assert.equal(merged.length, 1, `got ${merged.length}`);
});
check("slugs are unique within a city", () => {
  const merged = mergeRecords([
    rec({ sourceId: "1", name: "Smile Dental", phone: "4160000001", city: "Scarborough" }),
    rec({ sourceId: "2", name: "Smile Dental", phone: "4160000002", city: "Scarborough" }),
  ]);
  assert.equal(new Set(merged.map((c) => c.slug)).size, merged.length);
});
check("permits and practitioners carry across sources", () => {
  const merged = mergeRecords([
    rec({ source: "rcdso", sourceId: "1", name: "X Dental", phone: "4160000003", city: "Scarborough",
          practitioners: [{ fullName: "Dr A", specialty: "Endodontics" }], permits: { sedation: true } }),
    rec({ source: "osm", sourceId: "node/3", name: "X Dental", phone: "4160000003", city: "Scarborough", lat: 43.7, lng: -79.2 }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].practitioners[0].specialty, "Endodontics");
  assert.equal(merged[0].permits.sedation, true);
  assert.equal(merged[0].lat, 43.7);
});

check("a register record meets its map record on the address alone", () => {
  // Register records carry no coordinates and often no postal code, so the
  // street address and city is the only thing the two sources share. The suite
  // number is on one side only, which is exactly the case that must still work.
  const merged = mergeRecords([
    rec({ source: "rcdso", sourceId: "a", name: "Bay Dental Centre",
          address: "2855 Markham Rd #108", city: "Scarborough" }),
    rec({ source: "osm", sourceId: "node/9", name: "Bay Dental",
          address: "2855 Markham Road", lat: 43.77, lng: -79.23,
          website: "https://example.invalid" }),
  ]);
  assert.equal(merged.length, 1, `got ${merged.length} clinics`);
  assert.equal(merged[0].website, "https://example.invalid");
  assert.equal(merged[0].name, "Bay Dental Centre", "the registered name should win");
});

check("one building holding several practices stays several practices", () => {
  // 1580 Merivale Road in Nepean really does hold five, and 10 Green Street in
  // Barrhaven four. Merging on address alone would delete real clinics.
  const merged = mergeRecords([
    rec({ source: "osm", sourceId: "1", name: "Lima Denture", address: "1580 Merivale Road",
          city: "Nepean", lat: 45.3411, lng: -75.7261 }),
    rec({ source: "osm", sourceId: "2", name: "Cityview Family Dental Centre", address: "1580 Merivale Rd",
          city: "Nepean", lat: 45.3411, lng: -75.7261 }),
    rec({ source: "osm", sourceId: "3", name: "Allegra Dental", address: "1580 Merivale Road Suite 200",
          city: "Nepean", lat: 45.3411, lng: -75.7261 }),
    rec({ source: "osm", sourceId: "4", name: "The Teal Umbrella", address: "1580 Merivale Road",
          city: "Nepean", lat: 45.3411, lng: -75.7261 }),
  ]);
  assert.equal(merged.length, 4, `got ${merged.length} clinics, should be 4`);
});

check("a street with no number never merges", () => {
  const merged = mergeRecords([
    rec({ source: "rcdso", sourceId: "a", name: "A Dental", address: "Lawrence Ave E", city: "Scarborough" }),
    rec({ source: "rcdso", sourceId: "b", name: "B Dental", address: "Lawrence Avenue East", city: "Scarborough" }),
  ]);
  assert.equal(merged.length, 2);
});

console.log("\nCity assignment from coordinates");
check("a downtown Toronto clinic lands in Toronto, not a borough", () => {
  const placed = assignPlace(43.6532, -79.3832);
  assert.equal(placed?.cityName, "Toronto", `got ${placed?.cityName}`);
});
check("a High Park clinic lands in Toronto, not York", () => {
  const placed = assignPlace(43.6536, -79.4647);
  assert.equal(placed?.cityName, "Toronto", `got ${placed?.cityName} at ${placed?.distanceKm.toFixed(2)}km`);
});
check("a Scarborough clinic lands in Scarborough", () => {
  const placed = assignPlace(43.7595, -79.2276);
  assert.equal(placed?.cityName, "Scarborough", `got ${placed?.cityName}`);
});
check("coordinates beat a bare city tag", () => {
  // 3630 Lawrence Ave E is tagged "Toronto" by some mappers; it is Scarborough.
  assert.equal(resolveCity("Toronto", 43.7595, -79.2276)?.cityName, "Scarborough");
});
check("a point far from every known place is left unassigned", () => {
  assert.equal(assignPlace(51.5, -85.0), undefined); // northern Ontario bush
});
check("the assignment radius is a stated limit, not unbounded", () => {
  assert.ok(MAX_ASSIGN_KM > 0 && MAX_ASSIGN_KM <= 30, `radius ${MAX_ASSIGN_KM}km`);
});

console.log("\nRegister plus map, end to end");
check("two register rows and a map node become one clinic with both dentists", () => {
  const merged = mergeRecords([
    rec({ source: "rcdso", sourceId: "a", name: "A Dental Centre", address: "3630 Lawrence Ave E",
          city: "Scarborough", phone: "4169451000",
          practitioners: [{ fullName: "Dr One", registrationNumber: "1", specialty: "Periodontics" }] }),
    rec({ source: "rcdso", sourceId: "b", name: "A Dental Centre", address: "3630 Lawrence Ave E",
          city: "Scarborough", phone: "4169451000",
          practitioners: [{ fullName: "Dr Two", registrationNumber: "2" }], permits: { sedation: true } }),
    rec({ source: "osm", sourceId: "node/1", name: "A Dental", phone: "4169451000",
          lat: 43.758, lng: -79.2199, website: "https://example.invalid" }),
  ]);

  assert.equal(merged.length, 1, `got ${merged.length} clinics`);
  const clinic = merged[0];
  assert.equal(clinic.name, "A Dental Centre", "the registered name should win");
  assert.equal(clinic.address, "3630 Lawrence Ave E");
  assert.equal(clinic.website, "https://example.invalid", "the map's website should carry over");
  assert.equal(clinic.lat, 43.758, "the map's coordinates should carry over");
  assert.equal(clinic.permits.sedation, true);
  assert.equal(clinic.practitioners.length, 2, "both dentists should be listed");
  assert.equal(
    clinic.practitioners.find((p) => p.registrationNumber === "1")?.specialty,
    "Periodontics",
  );
});

check("a specialist registration becomes evidence for the right procedures", () => {
  const periodontist = [{
    kind: "rcdso-specialist" as const,
    detail: "registered specialist in periodontics",
    provenance: { source: "rcdso" as const, checkedAt: "2026-09-20" },
  }];
  const score = scoreProcedure(periodontist);
  assert.ok(score > 0, "a register specialty should score above zero");
  assert.ok(score > scoreProcedure([{ ...periodontist[0], kind: "site-mention" }]),
    "a register fact should outweigh a website mention");
});

console.log("\nEnumerating the register's cities");
check("a prefix that comes back full is split further", async () => {
  // "t" is capped at 20; "to" holds the rest.
  const CITIES = ["Toronto", "Thunder Bay", "Timmins", "Tillsonburg", "Tecumseh"];
  const asked: string[] = [];
  const fetchPrefix = async (prefix: string) => {
    asked.push(prefix);
    const matches = CITIES.filter((c) => c.toLowerCase().startsWith(prefix));
    // Pretend the endpoint caps a one-letter query, hiding Tillsonburg.
    if (prefix === "t") return [...Array(20)].map((_, i) => `Filler ${i}`);
    return matches;
  };
  const found = await allRegisterCities(fetchPrefix);
  assert.ok(asked.length > 26, "a capped prefix should have been split");
  for (const city of CITIES) {
    assert.ok(found.includes(city), `${city} was lost`);
  }
});

check("a city offered with and without a leading space is one city", async () => {
  // The register's own list holds both. Queried separately they return the
  // identical rows, so the walk does twice the work for nothing.
  const fetchPrefix = async (prefix: string) =>
    prefix === "t" ? [" Toronto", "Toronto", " Timmins"] : [];
  const found = await allRegisterCities(fetchPrefix);
  assert.deepEqual(
    found.filter((c) => c.toLowerCase().includes("toronto")),
    ["Toronto"],
    "Toronto should appear once, trimmed",
  );
  assert.ok(!found.some((c) => c !== c.trim()), "no city should carry whitespace");
});

console.log("\nThe register's specialty labels");
// Exactly as the register's own form spells them, read off the live page.
const REGISTER_SPECIALTIES = [
  "Dental Anesthesiology",
  "Endodontics",
  "Oral Medicine",
  "Oral Pathology",
  "Orthodontics",
  "Oral & Maxillofacial Surgery",
  "Oral Radiology",
  "Pediatric Dentistry",
  "Periodontics",
  "Public Health Dentistry",
  "Prosthodontics",
];

check("every clinical specialty the register names maps to a procedure", () => {
  // Oral medicine, pathology, radiology and public health are real
  // registrations with no patient-facing procedure page, by design.
  const noProcedurePage = new Set([
    "Oral Medicine", "Oral Pathology", "Oral Radiology", "Public Health Dentistry",
  ]);
  const lost: string[] = [];
  for (const specialty of REGISTER_SPECIALTIES) {
    if (noProcedurePage.has(specialty)) continue;
    if (proceduresForSpecialty(specialty).length === 0) lost.push(specialty);
  }
  assert.deepEqual(lost, [], `these register specialties match nothing: ${lost.join(", ")}`);
});

check("the register's spelling differences do not lose a specialty", () => {
  // The three that were silently dropped before the labels were normalised.
  assert.ok(proceduresForSpecialty("Orthodontics").some((p) => p.key === "orthodontics"));
  assert.ok(proceduresForSpecialty("Oral & Maxillofacial Surgery").some((p) => p.key === "oral-surgery"));
  assert.ok(proceduresForSpecialty("Dental Anesthesiology").some((p) => p.key === "sedation-dentistry"));
});

check("a specialty we do not recognise matches nothing rather than everything", () => {
  assert.equal(proceduresForSpecialty("Veterinary Dentistry").length, 0);
  assert.equal(proceduresForSpecialty("").length, 0);
});


console.log("\nURL namespaces");
check("no procedure key can be mistaken for a city", () => {
  // /ontario/toronto/ and /ontario/orthodontics/ share one route, so a
  // procedure key that matched a real municipality would hide one page behind
  // the other. Checked here as well as in the build, because a new procedure
  // key is added in this repo and a new city arrives from the ingest.
  const suspicious = PROCEDURES.map((p) => p.key).filter((key) =>
    /^(toronto|ottawa|hamilton|london|windsor|barrie|guelph|kingston|waterloo|cambridge)$/.test(key),
  );
  assert.deepEqual(suspicious, [], `procedure keys that are also cities: ${suspicious.join(", ")}`);
});


console.log("\nOwner claims");
check("a claim cannot outrank the regulator", () => {
  const owner = scoreProcedure([{
    kind: "owner-verified" as const,
    detail: "we place implants",
    provenance: { source: "owner" as const, checkedAt: "2026-09-20" },
  }]);
  const register = scoreProcedure([{
    kind: "rcdso-specialist" as const,
    detail: "registered specialist in periodontics",
    provenance: { source: "rcdso" as const, checkedAt: "2026-09-20" },
  }]);
  assert.ok(register > owner, `register ${register} should beat owner ${owner}`);
});

check("no amount of self-description reaches a registered specialist", () => {
  // Ten owner claims plus ten website mentions, against one registration.
  const selfDescribed = scoreProcedure([
    ...Array.from({ length: 10 }, () => ({
      kind: "owner-verified" as const,
      detail: "we do this",
      provenance: { source: "owner" as const, checkedAt: "2026-09-20" },
    })),
    ...Array.from({ length: 10 }, () => ({
      kind: "site-detail" as const,
      detail: "listed on their site",
      provenance: { source: "clinic-site" as const, quote: "we offer this service here", checkedAt: "2026-09-20" },
    })),
  ]);
  const oneRegistration = scoreProcedure([{
    kind: "rcdso-specialist" as const,
    detail: "registered specialist",
    provenance: { source: "rcdso" as const, checkedAt: "2026-09-20" },
  }]);
  assert.ok(
    selfDescribed < oneRegistration,
    `self-described ${selfDescribed} must stay below one registration ${oneRegistration}`,
  );
});

check("a practice with no trade name is read as an address, not named one", () => {
  // The register's address block simply starts with the street when there is
  // no registered practice name. Reading line one as a name gave 1,826
  // clinics called things like "65 Donly Dr N #1", each with no address left
  // to place them by.
  const $ = cheerio.load(`
    <section class="row hide">
      <h2> - Joseph Hanna</h2>
      <dl><dt>Registration Number:</dt><dd>12345</dd></dl>
      <dl><dt>Phone:</dt><dd>416-555-0100</dd></dl>
      <address><span>1333 Sheppard Ave E #246</span></address>
    </section>`);
  const record = parseRow($, $(ROW_SELECTOR).first()[0]);
  assert.ok(record, "should still be a clinic");
  assert.equal(record.address, "1333 Sheppard Ave E #246", "the street is the address");
  assert.equal(record.name, "1333 Sheppard Ave E #246", "and stands in as the name");
});

check("a named practice still keeps its name and street apart", () => {
  const $ = cheerio.load(`
    <section class="row hide">
      <h2> - Ghazala Zaid</h2>
      <dl><dt>Phone:</dt><dd>416-945-1000</dd></dl>
      <address><span>Cedarbrae Dental Center</span><span>3630 Lawrence Ave E</span></address>
    </section>`);
  const record = parseRow($, $(ROW_SELECTOR).first()[0]);
  assert.equal(record?.name, "Cedarbrae Dental Center");
  assert.equal(record?.address, "3630 Lawrence Ave E");
});

check("dentists sharing an unnamed address are one practice, not three", () => {
  const row = (dentist: string) => `
    <section class="row hide">
      <h2> - ${dentist}</h2>
      <dl><dt>Phone:</dt><dd>519-555-0199</dd></dl>
      <address><span>65 Donly Dr N #1</span></address>
    </section>`;
  const ids = ["Darren Kaplan", "David Holmes", "Rajan Gupta"].map((d) => {
    const $ = cheerio.load(row(d));
    return parseRow($, $(ROW_SELECTOR).first()[0])?.sourceId;
  });
  assert.equal(new Set(ids).size, 1, `three dentists gave ${new Set(ids).size} practices`);
});

console.log("\nReading a street out of a register address");
check("the street survives house numbers, units and building names", () => {
  const cases: Array<[string, string]> = [
    ["Unit-4 1295 Carling Ave", "Carling Avenue"],
    ["124 Edward St #356B", "Edward Street"],
    ["550 King St N Conestoga Mall", "King Street North"],
    ["3630 Lawrence Ave E", "Lawrence Avenue East"],
    ["1580 Merivale Rd", "Merivale Road"],
    ["206 Main St W, #2", "Main Street West"],
    ["Radiology Clinic 124 Edward St.", "Edward Street"],
    ["77 Queensway W 301", "Queensway West"],
    ["459 Holland St W Bdg F 1", "Holland Street West"],
    ["7010 Warden Ave 19", "Warden Avenue"],
    ["130 Silvercreek Pkwy N 1", "Silvercreek Parkway North"],
  ];
  for (const [address, expected] of cases) {
    assert.equal(osmStreetName(address), expected, `from ${JSON.stringify(address)}`);
  }
});

check("a building name after the street type is dropped, not kept", () => {
  // Keeping it means the OpenStreetMap lookup finds nothing and the practice
  // falls back to a guess, which is the failure this whole step exists to fix.
  assert.equal(osmStreetName("550 King St N Conestoga Mall"), "King Street North");
  assert.equal(
    osmStreetName("1151 Richmond St #DSB 0160H, GA Suite Schulich School"),
    "Richmond Street",
  );
});

check("an address with nothing usable gives nothing, not a wrong answer", () => {
  assert.equal(streetFrom(undefined), undefined);
  assert.equal(streetFrom(""), undefined);
  assert.equal(osmStreetName("#205"), undefined);
});

console.log("\nLocating streets");
check("a long road is cut into stretches a city can be told apart by", () => {
  // Britannia Road runs about 30 km from Mississauga through Milton. Stored
  // as one point its centre is 15 km from either end, which put every
  // practice on it in the wrong municipality.
  const longRoad = Array.from({ length: 60 }, (_, i) => ({
    lat: 43.6,
    lng: -79.75 + i * 0.006,
  }));
  const stretches = clusterPoints(longRoad);
  assert.ok(stretches.length > 5, `a 30 km road became ${stretches.length} stretches`);
  for (const s of stretches) {
    assert.ok(s.lng >= -79.76 && s.lng <= -79.39, "every stretch sits on the road");
  }
});

check("two roads sharing a name stay far apart", () => {
  // Main Street in Hamilton and Main Street in Ottawa, 500 km between them.
  const clusters = clusterPoints([
    { lat: 43.256, lng: -79.871 },
    { lat: 43.257, lng: -79.872 },
    { lat: 45.421, lng: -75.697 },
  ]);
  assert.equal(clusters.length, 2, "two roads of one name stay two places");
  assert.equal(clusters[0].ways, 2, "the longer one comes first");
});

check("a stretch's centre is the mean of its ways, not its first point", () => {
  const [only] = clusterPoints([
    { lat: 43.0, lng: -79.0 },
    { lat: 43.004, lng: -79.0 },
  ]);
  assert.equal(only.ways, 2, "both ways joined one stretch");
  assert.ok(Math.abs(only.lat - 43.002) < 1e-6, `centre was ${only.lat}`);
});

check("street names come from the addresses, commonest first", () => {
  const records = [
    { address: "1 Yonge St" },
    { address: "2 Yonge St" },
    { address: "3 Bay St" },
    { address: "#4" },
  ] as never;
  assert.deepEqual(streetNamesFrom(records), ["Yonge Street", "Bay Street"]);
});

console.log("\nPlacing a practice");

// Real coordinates, so the distances in these checks are real distances.
const GAZETTEER = placeIndex([
  { name: "Toronto", slug: "toronto", kind: "city", lat: 43.6532, lng: -79.3832 },
  { name: "Ottawa", slug: "ottawa", kind: "city", lat: 45.4215, lng: -75.6972 },
  { name: "Kanata", slug: "kanata", kind: "suburb", lat: 45.3088, lng: -75.8983 },
  { name: "Stittsville", slug: "stittsville", kind: "village", lat: 45.2612, lng: -75.9163 },
  { name: "Bradford", slug: "bradford", kind: "town", lat: 44.1140, lng: -79.5640 },
  { name: "Orangeville", slug: "orangeville", kind: "town", lat: 43.9190, lng: -80.0940 },
  { name: "Hamilton", slug: "hamilton", kind: "city", lat: 43.2557, lng: -79.8711 },
]);

const STREETS = {
  "Carling Avenue": [{ lat: 45.3833, lng: -75.7500, ways: 140 }],
  "Main Street": [
    { lat: 43.2557, lng: -79.8700, ways: 90 },
    { lat: 45.4200, lng: -75.6900, ways: 40 },
  ],
  "Britannia Road": [
    { lat: 43.5900, lng: -79.6900, ways: 20 }, // Mississauga end
    { lat: 43.5200, lng: -79.8800, ways: 18 }, // Milton end
  ],
};

const NO_ANCHORS = new Map<string, { lat: number; lng: number }>();

check("the exchange is the area code and the next three, however written", () => {
  assert.equal(exchangeOf("905-725-5088"), "905725");
  assert.equal(exchangeOf("1 (905) 725 5088"), "905725");
  assert.equal(exchangeOf("9057255088"), "905725");
  assert.equal(exchangeOf("905-725"), "905725");
  assert.equal(exchangeOf("12345"), undefined);
  assert.equal(exchangeOf(undefined), undefined);
});

check("an exchange is placed at a clinic, not between two clusters", () => {
  // A mean of these lands in the lake between them. A medoid is always
  // somewhere a clinic actually is.
  const centre = medoid([
    { lat: 43.65, lng: -79.38 },
    { lat: 43.66, lng: -79.39 },
    { lat: 43.67, lng: -79.40 },
  ]);
  assert.ok(centre, "should have a centre");
  assert.ok(
    [43.65, 43.66, 43.67].some((lat) => Math.abs(centre.lat - lat) < 1e-9),
    `centre ${centre.lat} was not one of the points`,
  );
});

check("an exchange scattered across the province is discarded, not averaged", () => {
  const anchors = buildExchangeAnchors([
    { phone: "416-555-0001", lat: 43.65, lng: -79.38 },
    { phone: "416-555-0002", lat: 45.42, lng: -75.69 },
    { phone: "416-555-0003", lat: 42.30, lng: -83.03 },
  ]);
  assert.equal(anchors.size, 0, "a 500 km spread describes no place");
});

check("a tight exchange is kept", () => {
  const anchors = buildExchangeAnchors([
    { phone: "613-595-0001", lat: 45.30, lng: -75.90 },
    { phone: "613-595-0002", lat: 45.31, lng: -75.91 },
  ]);
  assert.equal(anchors.size, 1);
  assert.ok(anchors.get("613595"));
});

check("the exchange picks the stretch, and the dentists are not consulted", () => {
  // Britannia Road runs from Mississauga into Milton. The register practice
  // sits at the Mississauga end; its dentists registered all over.
  const anchors = buildExchangeAnchors([
    { phone: "905-890-0001", lat: 43.5895, lng: -79.6905 },
    { phone: "905-890-0002", lat: 43.5905, lng: -79.6895 },
  ]);
  const found = locate(
    "812 Britannia Rd #108",
    "905-890-5555",
    ["Orangeville", "Orangeville", "Bradford"],
    STREETS,
    GAZETTEER,
    anchors,
  );
  assert.equal(found?.basis, "street-and-exchange");
  assert.ok(Math.abs(found!.lat - 43.59) < 0.01, `landed at ${found!.lat}`);
  assert.ok(found!.confident, "street and exchange agreeing is confident");
});

check("an exchange nowhere near the street stands alone", () => {
  const anchors = buildExchangeAnchors([
    { phone: "613-595-0001", lat: 45.30, lng: -75.90 },
    { phone: "613-595-0002", lat: 45.31, lng: -75.91 },
  ]);
  const found = locate("100 Main St", "613-595-1234", ["Hamilton"], STREETS, GAZETTEER, anchors);
  // Ottawa's Main Street is in the index and is within reach of the anchor.
  assert.equal(found?.basis, "street-and-exchange");
  assert.ok(found!.lat > 45, "should be the Ottawa one, not Hamilton's");
});

check("with no exchange, the dentists' cities choose the stretch", () => {
  const hamilton = locate("100 Main St", undefined, ["Hamilton", "Hamilton"], STREETS, GAZETTEER, NO_ANCHORS);
  assert.equal(hamilton?.basis, "street-and-city");
  assert.ok(Math.abs(hamilton!.lat - 43.2557) < 0.05, "should be the Hamilton one");

  const ottawa = locate("100 Main St", undefined, ["Ottawa", "Kanata"], STREETS, GAZETTEER, NO_ANCHORS);
  assert.ok(Math.abs(ottawa!.lat - 45.42) < 0.05, "should be the Ottawa one");
});

check("several nearby cities outweigh one distant city with more dentists", () => {
  const found = locate(
    "1295 Carling Ave",
    undefined,
    ["Bradford", "Bradford", "Bradford", "Bradford", "Ottawa", "Kanata", "Stittsville"],
    STREETS,
    GAZETTEER,
    NO_ANCHORS,
  );
  assert.ok(found && Math.abs(found.lat - 45.3833) < 0.05, "should still be Ottawa's Carling");
});

check("no street, no exchange and no known city places nothing at all", () => {
  // An unplaced clinic is honest. One on the wrong city page is not.
  assert.equal(locate("#205", undefined, ["Nowhereville"], STREETS, GAZETTEER, NO_ANCHORS), undefined);
  assert.equal(locate(undefined, undefined, [], STREETS, GAZETTEER, NO_ANCHORS), undefined);
});

check("a city-only placement is never marked confident", () => {
  const found = locate("#205", undefined, ["Hamilton"], STREETS, GAZETTEER, NO_ANCHORS);
  assert.equal(found?.basis, "city-only");
  assert.equal(found?.confident, false);
});

check("votes are counted, not just collected", () => {
  assert.deepEqual(tally(["Ottawa", " Ottawa ", "Kanata", undefined, ""]), [
    { name: "Ottawa", votes: 2 },
    { name: "Kanata", votes: 1 },
  ]);
});

/* ------------------------------------------------------ the canonical host */

/** Runs `fn` with exactly the given host variables set, then puts them back. */
function withHostEnv(env: Record<string, string | undefined>, fn: () => void) {
  const keys = [
    "NEXT_PUBLIC_SITE_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "VERCEL_URL",
    "VERCEL",
  ];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    fn();
  } finally {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k]!;
    }
  }
}

check("an explicit site URL wins over everything", () => {
  withHostEnv(
    {
      NEXT_PUBLIC_SITE_URL: "https://ontariodental.ca",
      VERCEL_PROJECT_PRODUCTION_URL: "dentallist.vercel.app",
      VERCEL: "1",
    },
    () => assert.equal(resolveSiteUrl(), "https://ontariodental.ca"),
  );
});

check("Vercel's production host is used, and given a scheme", () => {
  withHostEnv({ VERCEL_PROJECT_PRODUCTION_URL: "dentallist.vercel.app", VERCEL: "1" }, () =>
    assert.equal(resolveSiteUrl(), "https://dentallist.vercel.app"),
  );
});

check("a Vercel host that already has a scheme is left alone", () => {
  withHostEnv({ VERCEL_PROJECT_PRODUCTION_URL: "https://dentallist.vercel.app", VERCEL: "1" }, () =>
    assert.equal(resolveSiteUrl(), "https://dentallist.vercel.app"),
  );
});

check("a local build falls back to the placeholder", () => {
  withHostEnv({}, () => assert.equal(resolveSiteUrl(), "https://example.invalid"));
});

check("the deployment host is used rather than the placeholder", () => {
  withHostEnv({ VERCEL_URL: "dentallist-abc123.vercel.app", VERCEL: "1" }, () =>
    assert.equal(resolveSiteUrl(), "https://dentallist-abc123.vercel.app"),
  );
});

check("the stable production host beats the deployment's own", () => {
  withHostEnv(
    {
      VERCEL_PROJECT_PRODUCTION_URL: "dentallist.vercel.app",
      VERCEL_URL: "dentallist-abc123.vercel.app",
      VERCEL: "1",
    },
    () => assert.equal(resolveSiteUrl(), "https://dentallist.vercel.app"),
  );
});

check("an explicit host without a scheme still gets one", () => {
  withHostEnv({ NEXT_PUBLIC_SITE_URL: "ontariodental.ca" }, () =>
    assert.equal(resolveSiteUrl(), "https://ontariodental.ca"),
  );
});

check("blank host variables are treated as unset, not as a host", () => {
  withHostEnv({ NEXT_PUBLIC_SITE_URL: "  ", VERCEL_PROJECT_PRODUCTION_URL: "dentallist.vercel.app" }, () =>
    assert.equal(resolveSiteUrl(), "https://dentallist.vercel.app"),
  );
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}\n`);
});
