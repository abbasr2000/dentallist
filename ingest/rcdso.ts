/**
 * RCDSO public register ingest.
 *
 * This is the spine of the directory and the source of everything nobody else
 * uses: specialty registrations, facility sedation permits and CT scanner
 * permits. Those are facts on a regulator's register, which is what lets us
 * say a clinic is genuinely strong at implants or endodontics without making a
 * comparative claim of our own.
 *
 * The register's search is a plain GET form — action /find-a-dentist/search-results,
 * method get, with named fields — so this fetches URLs and parses HTML rather
 * than driving a browser. That was worth checking: it makes a full Ontario run
 * cheap enough to do politely in one pass, and removes Chromium from the
 * pipeline entirely.
 *
 * There is also a predictive endpoint, /Predictive/Cities?query=, which returns
 * the register's own city spellings. Walking those beats guessing at a list,
 * since a city the register does not recognise returns nothing.
 *
 * Run: npx tsx ingest/rcdso.ts --city Scarborough
 *      npx tsx ingest/rcdso.ts --probe          (dump the results markup)
 *      npx tsx ingest/rcdso.ts --cities         (dump the register's city list)
 */

import * as cheerio from "cheerio";
import { writeJson, normalizePhone, normalizePostal, slugify, sleep, type SourceRecord } from "./lib";

const ORIGIN = "https://www.rcdso.org";
const SEARCH_URL = `${ORIGIN}/find-a-dentist/search-results`;
const CITIES_URL = `${ORIGIN}/Predictive/Cities`;

/**
 * The register is a public regulator's register and we are a small, identified
 * client. Announce who we are and go slowly enough that the crawl costs them
 * nothing they would notice.
 */
const UA = "dentallist-ingest/1.0 (+https://github.com/abbasr2000/dentallist)";
const POLITE_DELAY_MS = 1200;

async function get(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/json" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

function searchUrl(params: Record<string, string>): string {
  const query = new URLSearchParams();
  // The form's own field names, read off the live page.
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  return `${SEARCH_URL}?${query.toString()}`;
}

/** The register's own spelling of every city it knows, for a prefix. */
export async function citiesMatching(prefix: string): Promise<string[]> {
  const body = await get(`${CITIES_URL}?query=${encodeURIComponent(prefix)}`);
  try {
    const parsed = JSON.parse(body) as { results?: string[] };
    return parsed.results ?? [];
  } catch {
    return [];
  }
}

/**
 * The Ontario municipalities to walk.
 *
 * The register searches by city, so coverage is a list of cities rather than
 * one query. Start narrow and widen — a full Ontario run is thousands of
 * paginated requests and should be spread over days, not minutes.
 */
const DEFAULT_CITIES = [
  "Scarborough", "Toronto", "North York", "Etobicoke", "Mississauga",
  "Brampton", "Markham", "Richmond Hill", "Vaughan", "Ajax", "Pickering",
  "Whitby", "Oshawa", "Ottawa", "Hamilton", "London", "Kitchener",
  "Waterloo", "Windsor", "Barrie", "Guelph", "Kingston", "Sudbury",
  "Thunder Bay", "Oakville", "Burlington", "Milton", "Newmarket",
];

/**
 * One dentist's row on a results page.
 *
 * The register's markup is better than most: the practice name and street
 * address sit in their own <span>s inside an <address>, and the registration
 * number and phone are in <dl> pairs. Parsing the structure rather than the
 * text means a name containing a number, or an address with no number, comes
 * out right.
 *
 *   <section class="row hide">
 *     <h2><a href="...dentist?id=120016"> - Heena Kauser</a></h2>
 *     <dl><dt>Registration Number:</dt><dd>120016</dd></dl>
 *     <dl><dt>Status:</dt><dd>Member</dd></dl>
 *     <address><span>Markham Gateway Dentistry</span><span>2855 Markham Rd #108</span></address>
 *     <dl><dt>Phone:</dt><dd><a href="tel:4163210005">416-321-0005</a></dd></dl>
 *   </section>
 *
 * The register also publishes conditions and misconduct findings against some
 * dentists, in a `div.concerns` on the same row. We deliberately do not read
 * it. Republishing a regulator's discipline record on a commercial directory
 * is a different product with different obligations, and it is not what this
 * one is for.
 */
export const ROW_SELECTOR = "section.row.hide";

/** The register lists dentists; a clinic is what several of them share. */
type RowElement = Parameters<cheerio.CheerioAPI>[0];

export function parseRow($: cheerio.CheerioAPI, el: RowElement): SourceRecord | undefined {
  const row = $(el);

  const definition = (label: RegExp): string | undefined => {
    let found: string | undefined;
    row.find("dl").each((_, dl) => {
      if (found) return;
      const term = $(dl).find("dt").first().text().trim();
      if (!label.test(term)) return;
      const value = $(dl).find("dd").first().text().replace(/\s+/g, " ").trim();
      if (value) found = value;
    });
    return found;
  };

  const registration = definition(/registration/i);
  const status = definition(/status/i);
  const phone = normalizePhone(definition(/phone/i));

  // "  - Heena Kauser" — the register puts the title before the dash, and it
  // is empty for a general dentist.
  const personName = row
    .find("h2")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .replace(/^\s*-\s*/, "")
    .trim();

  const addressBlock = row.find("address").first();
  const lines = addressBlock
    .find("span")
    .map((_, span) => $(span).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean);

  const practiceName = lines[0];
  const street = lines.slice(1).join(", ") || undefined;
  const postalCode = normalizePostal(
    addressBlock.text().match(/\b[A-Z]\d[A-Z][\s-]?\d[A-Z]\d\b/i)?.[0],
  );

  const name = practiceName ?? personName;
  if (!name) return undefined;

  // A dentist with no practice on the register is a real registration but not
  // a clinic, so there is nothing for the directory to list.
  if (!practiceName) return undefined;

  return {
    source: "rcdso",
    sourceId: slugify(`${practiceName}-${street ?? ""}-${phone ?? ""}`),
    name: practiceName,
    address: street,
    postalCode,
    phone,
    practitioners: personName
      ? [{ fullName: personName, registrationNumber: registration }]
      : undefined,
    raw: { registration, status, personName, practiceName, street, phone },
  };
}

/**
 * Dump the structure of a real results page.
 *
 * The register's search form is now known; its results markup is not, and this
 * is what reveals it without guessing. It prints the elements that repeat —
 * the result row is almost always the most-repeated one with substance in it —
 * and a sample of the likeliest candidate, so the parser can be written against
 * something real.
 */
async function probe(city: string): Promise<void> {
  const url = searchUrl({ City: city, DetailsCode: "All" });
  console.log(`GET ${url}\n`);

  const html = await get(url);
  console.log(`${html.length} bytes`);

  const $ = cheerio.load(html);
  console.log(`title: ${$("title").text().trim()}\n`);

  const counts = new Map<string, number>();
  $("body *").each((_, el) => {
    const node = $(el);
    const cls = (node.attr("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    if (!cls) return;
    const key = `${(el as { tagName?: string }).tagName ?? "?"}.${cls}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  const repeated = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);

  console.log("=== REPEATED ELEMENTS ===");
  for (const [selector, n] of repeated) {
    const text = $(selector.replace(/^[a-z0-9]+\./i, (m) => m)).first().text().replace(/\s+/g, " ").trim();
    console.log(`  ${String(n).padStart(4)}x  ${selector}`);
    if (text) console.log(`         first: ${text.slice(0, 110)}`);
  }

  // A row that mentions a dentist and an address is the one we want.
  console.log("\n=== LIKELY ROWS ===");
  for (const [selector] of repeated.slice(0, 12)) {
    const nodes = $(selector);
    const sample = nodes.first();
    const text = sample.text().replace(/\s+/g, " ").trim();
    if (!/\b(dr\.?|dds|dental|dentistry)\b/i.test(text)) continue;
    console.log(`\n--- ${selector} (${nodes.length}) ---`);
    console.log(sample.html()?.replace(/\s+/g, " ").slice(0, 1400));
  }

  console.log("\n=== TABLES ===");
  $("table").each((i, table) => {
    const headers = $(table).find("th").map((_, th) => $(th).text().trim()).get();
    const rows = $(table).find("tbody tr").length;
    console.log(`  table ${i}: ${rows} rows, headers: ${JSON.stringify(headers)}`);
    const first = $(table).find("tbody tr").first();
    if (first.length) {
      console.log(`    first row: ${first.text().replace(/\s+/g, " ").trim().slice(0, 300)}`);
    }
  });

  console.log("\n=== PAGINATION ===");
  $("a, button").each((_, el) => {
    const node = $(el);
    const label = `${node.text().trim()} ${node.attr("aria-label") ?? ""}`.trim();
    if (!/next|page\s*\d|\u203a|\u00bb/i.test(label)) return;
    console.log(`  ${(el as { tagName?: string }).tagName} "${label.slice(0, 40)}" href=${node.attr("href") ?? "-"}`);
  });

  console.log("\n=== RESULT COUNT PHRASES ===");
  for (const m of html.matchAll(/([\d,]+)\s*(results?|records?|dentists?|matches)/gi)) {
    console.log(`  ${m[0]}`);
  }
}

/**
 * Why the sedation filter comes back empty.
 *
 * Its option values parse fine and the query is accepted, but every permit
 * type returns nothing, so something about the submission differs from what
 * the form sends. This prints the raw options and the result counts for each
 * combination worth trying.
 */
async function probeSedation(): Promise<void> {
  const $ = cheerio.load(await get(searchUrl({ City: "Toronto", DetailsCode: "All" })));

  for (const name of ["SedationType", "SedationProviderType", "MbrSpecialty", "DetailsCode", "GroupCode"]) {
    console.log(`\n=== ${name} ===`);
    $(`select[name="${name}"] option`).each((_, option) => {
      console.log(`  value=${JSON.stringify($(option).attr("value"))}  ${$(option).text().replace(/\s+/g, " ").trim()}`);
    });
  }

  const types = selectOptions($, "SedationType");
  const providers = selectOptions($, "SedationProviderType");
  if (types.length === 0) return;

  const attempts: Array<[string, Record<string, string>]> = [
    ["type alone", { SedationType: types[0].value }],
    ["type + All details", { SedationType: types[0].value, DetailsCode: "All" }],
    ["type + Toronto", { SedationType: types[0].value, City: "Toronto" }],
    ["type + provider", { SedationType: types[0].value, SedationProviderType: providers[0]?.value ?? "" }],
    ["type + provider + Toronto", { SedationType: types[0].value, SedationProviderType: providers[0]?.value ?? "", City: "Toronto" }],
    ["label as value", { SedationType: types[0].label }],
  ];

  console.log("\n=== ATTEMPTS ===");
  for (const [label, params] of attempts) {
    try {
      const page = cheerio.load(await get(searchUrl(params)));
      console.log(`  ${String(page(ROW_SELECTOR).length).padStart(5)} rows  ${label}  ${JSON.stringify(params)}`);
    } catch (error) {
      console.log(`      failed  ${label}: ${(error as Error).message}`);
    }
    await sleep(POLITE_DELAY_MS);
  }
}

/**
 * Every practice the register lists for one city.
 *
 * The register returns a city in a single response — 731 dentists for
 * Scarborough in one 3.3MB page — so there is no pagination to walk. The
 * "Next" link on the results page carries no href; it is decoration.
 */
export async function searchCity(city: string): Promise<SourceRecord[]> {
  const html = await get(searchUrl({ City: city, DetailsCode: "All" }));
  const $ = cheerio.load(html);

  const records: SourceRecord[] = [];
  $(ROW_SELECTOR).each((_, el) => {
    const record = parseRow($, el);
    if (!record) return;
    record.city ??= city;
    records.push(record);
  });
  return records;
}

/**
 * The registration numbers holding a given specialty or sedation permit.
 *
 * This is the part worth having. The register's own search filters by
 * specialty and by sedation permit type, so instead of inferring a clinic's
 * strengths from its marketing copy we ask the regulator directly and get back
 * a list of registration numbers. Joining that to the city results gives every
 * practice its register-backed evidence, which is the whole basis of the
 * ranking.
 */
async function registrationsMatching(params: Record<string, string>): Promise<Map<string, string>> {
  const html = await get(searchUrl({ ...params, DetailsCode: "All" }));
  const $ = cheerio.load(html);

  const found = new Map<string, string>();
  $(ROW_SELECTOR).each((_, el) => {
    const row = $(el);
    let registration: string | undefined;
    row.find("dl").each((_, dl) => {
      if (registration) return;
      if (!/registration/i.test($(dl).find("dt").first().text())) return;
      registration = $(dl).find("dd").first().text().trim();
    });
    const practice = row.find("address").first().find("span").first().text().replace(/\s+/g, " ").trim();
    if (registration) found.set(registration, practice);
  });
  return found;
}

/** The option values the register's own refine-search form offers. */
export function selectOptions($: cheerio.CheerioAPI, name: string): Array<{ value: string; label: string }> {
  return $(`select[name="${name}"] option`)
    .map((_, option) => ({
      value: ($(option).attr("value") ?? "").trim(),
      label: $(option).text().replace(/\s+/g, " ").trim(),
    }))
    .get()
    .filter((o) => o.value && !/^all$/i.test(o.label));
}

async function main() {
  const args = process.argv.slice(2);
  const valueFor = (flag: string) => {
    const i = args.indexOf(flag);
    const next = args[i + 1];
    return i >= 0 && next && !next.startsWith("--") ? next : undefined;
  };

  if (args.includes("--probe-sedation")) {
    await probeSedation();
    return;
  }

  if (args.includes("--probe")) {
    await probe(valueFor("--probe") ?? "Scarborough");
    return;
  }

  if (args.includes("--cities")) {
    const sorted = await allRegisterCities();
    console.log(`${sorted.length} cities on the register`);
    writeJson("ingest/out/rcdso-cities.json", sorted);
    return;
  }

  const list = valueFor("--cities-list");
  const cities = valueFor("--city")
    ? [valueFor("--city")!]
    : list
      ? list.split(",").map((c) => c.trim()).filter(Boolean)
      : await allRegisterCities();

  console.log(`Walking ${cities.length} cities\n`);

  const all: SourceRecord[] = [];
  let failures = 0;
  for (const [index, city] of cities.entries()) {
    try {
      const records = await searchCity(city);
      all.push(...records);
      if (records.length > 0 || index % 25 === 0) {
        console.log(`  ${String(index + 1).padStart(4)}/${cities.length}  ${city}: ${records.length}`);
      }
    } catch (error) {
      failures++;
      console.log(`  ${city} failed: ${(error as Error).message}`);
    }
    await sleep(POLITE_DELAY_MS);
  }

  console.log(`\n${all.length} practice rows, ${failures} cities failed`);

  await applyRegisterEvidence(all);

  writeJson("ingest/out/rcdso.json", all);
  console.log(`Wrote ingest/out/rcdso.json`);
}

/**
 * The register's own list of cities.
 *
 * The predictive endpoint answers prefixes, and we do not know whether it caps
 * a response. So a prefix that comes back suspiciously full is split into
 * longer prefixes until it does not — a letter with three Ontario cities
 * costs one request, and "t" costs twenty-seven rather than quietly losing
 * Tillsonburg. Falls back to the short hand-written list only if the endpoint
 * is unreachable.
 */
const LOOKS_CAPPED = 20;
const MAX_PREFIX = 3;

export async function allRegisterCities(
  fetchPrefix: (prefix: string) => Promise<string[]> = citiesMatching,
): Promise<string[]> {
  const found = new Set<string>();
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");

  const walk = async (prefix: string): Promise<void> => {
    let results: string[];
    try {
      results = await fetchPrefix(prefix);
    } catch {
      return; // one failed prefix is not worth abandoning the run over
    }
    for (const name of results) found.add(name);

    if (results.length < LOOKS_CAPPED || prefix.length >= MAX_PREFIX) return;
    for (const letter of letters) {
      await sleep(250);
      await walk(prefix + letter);
    }
  };

  for (const letter of letters) {
    await walk(letter);
    await sleep(250);
  }

  return found.size > 0 ? [...found].sort() : DEFAULT_CITIES;
}

/**
 * Tag every record with what the regulator says about it.
 *
 * Runs one province-wide query per specialty and per sedation permit type,
 * then joins on registration number. A dozen extra requests buys the evidence
 * that distinguishes this directory from every other one.
 */
async function applyRegisterEvidence(records: SourceRecord[]): Promise<void> {
  const formPage = cheerio.load(await get(searchUrl({ City: "Toronto", DetailsCode: "All" })));

  const specialties = selectOptions(formPage, "MbrSpecialty");
  const sedationTypes = selectOptions(formPage, "SedationType");
  console.log(`\n${specialties.length} specialties and ${sedationTypes.length} sedation types on the form`);

  const byRegistration = new Map<string, SourceRecord[]>();
  for (const record of records) {
    for (const person of record.practitioners ?? []) {
      if (!person.registrationNumber) continue;
      const list = byRegistration.get(person.registrationNumber) ?? [];
      list.push(record);
      byRegistration.set(person.registrationNumber, list);
    }
  }

  for (const specialty of specialties) {
    try {
      const matches = await registrationsMatching({ MbrSpecialty: specialty.value });
      let tagged = 0;
      for (const registration of matches.keys()) {
        for (const record of byRegistration.get(registration) ?? []) {
          const person = record.practitioners?.find((p) => p.registrationNumber === registration);
          if (person && !person.specialty) {
            person.specialty = specialty.label;
            tagged++;
          }
        }
      }
      console.log(`  ${specialty.label}: ${matches.size} registered, ${tagged} matched to a practice`);
    } catch (error) {
      console.log(`  ${specialty.label} failed: ${(error as Error).message}`);
    }
    await sleep(POLITE_DELAY_MS);
  }

  for (const sedation of sedationTypes) {
    try {
      const matches = await registrationsMatching({ SedationType: sedation.value });
      let tagged = 0;
      for (const registration of matches.keys()) {
        for (const record of byRegistration.get(registration) ?? []) {
          record.permits = { ...record.permits, sedation: true };
          tagged++;
        }
      }
      console.log(`  sedation — ${sedation.label}: ${matches.size} permits, ${tagged} matched`);
    } catch (error) {
      console.log(`  sedation ${sedation.label} failed: ${(error as Error).message}`);
    }
    await sleep(POLITE_DELAY_MS);
  }

  const withSpecialty = records.filter((r) => r.practitioners?.some((p) => p.specialty)).length;
  const withSedation = records.filter((r) => r.permits?.sedation).length;
  console.log(`\n${withSpecialty} rows carry a specialist, ${withSedation} carry a sedation permit`);

  if (withSedation === 0 && sedationTypes.length > 0) {
    console.log(
      "\nNo sedation permits came back for any permit type. The filter needs\n" +
      "something we are not sending — run --probe-sedation to see what the form\n" +
      "actually submits. Until then the directory simply has no sedation\n" +
      "evidence, which is the correct state: we do not infer a permit.",
    );
  }
}

// Guarded so that importing this module (for its exported parsers, or from a
// test) does not hit the network.
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
