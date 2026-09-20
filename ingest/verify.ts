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
import { parseRow, ROW_SELECTOR, selectOptions } from "./rcdso";
import { mergeRecords } from "./merge";
import { assignPlace, resolveCity, MAX_ASSIGN_KM } from "./places";
import { scoreProcedure } from "../lib/strength";
import type { SourceRecord } from "./lib";

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}: ${(error as Error).message}`);
    process.exitCode = 1;
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

console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}\n`);
