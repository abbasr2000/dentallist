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
import { writeJson, readJson, normalizePhone, normalizePostal, slugify, sleep, type SourceRecord } from "./lib";

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
const OUT_PATH = "ingest/out/rcdso.json";
/** Cities between saves. Twenty is about a minute's work to lose. */
const CHECKPOINT_EVERY = 20;

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
 * The sedation filter on the dentist search returns nothing, and that is not a
 * bug in this code.
 *
 * Probed every combination worth trying — the permit code alone, with a city,
 * with a provider type, with the label in place of the code — and all six came
 * back with zero rows, while the specialty filter beside it works with codes of
 * exactly the same shape ("AN", "EN", "OR"). Sedation and CT scanner permits
 * are issued to a *facility*, not to a dentist, and the College inspects
 * facilities through a separate programme. The dentist search has the fields
 * but nothing behind them.
 *
 * So the directory carries no sedation or CT evidence today, and it should not:
 * a facility permit is a fact about a building and we have no source for it
 * yet. Finding the facility register is its own job. What we do not do is
 * infer one from a clinic saying "we offer sedation" — that is the difference
 * between this directory and the others.
 */
const SEDATION_IS_A_FACILITY_PERMIT = true;
void SEDATION_IS_A_FACILITY_PERMIT;

/** Prints the register's own filter codes and what each sedation query returns. */
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
    const sorted = await registerCities(true);
    console.log(`${sorted.length} cities on the register`);
    return;
  }

  const list = valueFor("--cities-list");
  const cities = valueFor("--city")
    ? [valueFor("--city")!]
    : list
      ? list.split(",").map((c) => c.trim()).filter(Boolean)
      : await registerCities(args.includes("--refresh-cities"));

  // A full walk takes over an hour, which is long enough to be killed by a job
  // timeout, a runner eviction or a network blip. Writing only at the end means
  // any of those throws away the whole run, so progress is checkpointed and a
  // restart picks up the cities it has not done. --restart forces a clean run.
  const done = new Set<string>();
  let all: SourceRecord[] = [];
  if (!args.includes("--restart")) {
    const previous = readJson<SourceRecord[]>(OUT_PATH);
    if (previous?.length) {
      all = previous;
      for (const record of previous) if (record.city) done.add(record.city);
      console.log(`Resuming: ${previous.length} rows already in ${OUT_PATH}, ${done.size} cities done`);
    }
  }

  const remaining = cities.filter((city) => !done.has(city));
  console.log(`Walking ${remaining.length} of ${cities.length} cities\n`);

  let failures = 0;
  let sinceCheckpoint = 0;
  for (const [index, city] of remaining.entries()) {
    try {
      const records = await searchCity(city);
      all.push(...records);
      if (records.length > 0 || index % 25 === 0) {
        console.log(`  ${String(index + 1).padStart(4)}/${remaining.length}  ${city}: ${records.length}`);
      }
    } catch (error) {
      failures++;
      console.log(`  ${city} failed: ${(error as Error).message}`);
    }

    if (++sinceCheckpoint >= CHECKPOINT_EVERY) {
      writeJson(OUT_PATH, all);
      sinceCheckpoint = 0;
    }
    await sleep(POLITE_DELAY_MS);
  }

  writeJson(OUT_PATH, all);
  console.log(`\n${all.length} practice rows, ${failures} cities failed`);

  await applyRegisterEvidence(all);

  writeJson(OUT_PATH, all);
  console.log(`Wrote ${OUT_PATH}`);
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
const CITIES_CACHE = "ingest/out/rcdso-cities.json";

/**
 * The walk is expensive — every prefix that looks capped costs another 26
 * requests, so a full enumeration can run to thousands of them. The list of
 * Ontario municipalities with a dentist in them barely changes, so it is
 * cached in the repo and re-walked only when asked. Pass --refresh-cities to
 * force one.
 */
export async function registerCities(refresh = false): Promise<string[]> {
  if (!refresh) {
    const cached = readJson<string[]>(CITIES_CACHE);
    if (cached && cached.length > 0) {
      console.log(`${cached.length} cities from ${CITIES_CACHE} (--refresh-cities to re-walk)`);
      return cached;
    }
  }
  const walked = await allRegisterCities();
  if (walked.length > 0) writeJson(CITIES_CACHE, walked);
  return walked;
}

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
    // The register returns the same city both with and without a leading
    // space — " Toronto" and "Toronto" are two entries in its own list. Left
    // as they are, each is queried separately and returns the identical 2,482
    // rows, so the walk does twice the work and the output carries every
    // record twice. It trims its own input, so the two are one city.
    for (const name of results) {
      const trimmed = name.trim();
      if (trimmed) found.add(trimmed);
    }

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

  // Left running because it costs four requests and would start working the
  // day the register joins the two searches up. See the note below.
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
      "\nNo sedation permits, as expected — see the note on SEDATION_IS_A_FACILITY_PERMIT.",
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
