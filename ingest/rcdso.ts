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

interface RawRow {
  text: string;
  html: string;
}

/**
 * Pull a clinic record out of one result row.
 *
 * Written against the text content rather than the markup so that a redesign
 * of the register breaks the selectors above and nothing else. Every field is
 * optional: a row we cannot fully parse still yields a name, which is better
 * than dropping the dentist entirely.
 */
export function parseResultRow(row: RawRow): SourceRecord | undefined {
  const text = row.text.replace(/\s+/g, " ").trim();
  if (!text) return undefined;

  const registration = text.match(/\b(?:registration|reg\.?)\s*(?:no\.?|number|#)?\s*:?\s*(\d{4,6})\b/i)?.[1];
  const phone = normalizePhone(text.match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/)?.[0]);
  const postalCode = normalizePostal(
    text.match(/\b[A-Z]\d[A-Z][\s-]?\d[A-Z]\d\b/i)?.[0],
  );

  const SPECIALTIES = [
    "Endodontics",
    "Oral and Maxillofacial Surgery",
    "Oral Medicine",
    "Oral Pathology",
    "Oral Radiology",
    "Orthodontics and Dentofacial Orthopedics",
    "Pediatric Dentistry",
    "Periodontics",
    "Prosthodontics",
    "Dental Anaesthesia",
    "Dental Public Health",
  ];
  const specialty = SPECIALTIES.find((s) =>
    text.toLowerCase().includes(s.toLowerCase()),
  );

  const permits = {
    sedation: /sedation|anaesthes|anesthes/i.test(text),
    cbct: /\bCT\b|cone beam|CBCT/i.test(text),
  };

  // The practice name is normally the line after the dentist's name. Take the
  // first segment that looks like a business rather than a person.
  const segments = text.split(/\s{2,}|·|\|/).map((s) => s.trim()).filter(Boolean);
  const practiceName = segments.find((s) =>
    /dental|dentistry|clinic|centre|center|orthodont|perio|endo/i.test(s),
  );
  const personName = segments.find((s) => /^(dr\.?|doctor)\s/i.test(s)) ?? segments[0];

  const name = practiceName ?? personName;
  if (!name) return undefined;

  const address = segments.find((s) => /\d+\s+\w+/.test(s) && !/^\(?\d{3}/.test(s));

  return {
    source: "rcdso",
    sourceId: registration ?? slugify(`${name}-${phone ?? ""}`),
    name,
    address,
    postalCode,
    phone,
    practitioners: personName
      ? [{ fullName: personName, registrationNumber: registration, specialty }]
      : undefined,
    permits,
    raw: { text, html: row.html },
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
 * Every record the register returns for one city.
 *
 * Paginates until a page repeats or yields nothing. The parser works off each
 * row's text rather than its markup, so a redesign of the register costs us
 * ROW_SELECTORS and nothing else.
 */
const ROW_SELECTORS = [
  "table tbody tr",
  "[class*='result' i] li",
  "[class*='dentist' i][class*='card' i]",
  "[class*='search-result' i]",
];

export async function searchCity(city: string): Promise<SourceRecord[]> {
  const records: SourceRecord[] = [];
  const seen = new Set<string>();

  for (let pageNumber = 1; pageNumber <= 200; pageNumber++) {
    const url = searchUrl({
      City: city,
      DetailsCode: "All",
      ...(pageNumber > 1 ? { page: String(pageNumber) } : {}),
    });

    const html = await get(url);
    const $ = cheerio.load(html);

    const rows = ROW_SELECTORS.flatMap((selector) =>
      $(selector)
        .map((_, el) => ({
          text: $(el).text(),
          html: $(el).html() ?? "",
        }))
        .get(),
    );
    if (rows.length === 0) break;

    let added = 0;
    for (const row of rows) {
      const record = parseResultRow(row);
      if (!record) continue;
      const key = `${record.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      record.city ??= city;
      records.push(record);
      added++;
    }

    // A page that adds nothing new means we have looped back on ourselves,
    // which is how a register without a "next" link tells us it is done.
    if (added === 0) break;
    await sleep(POLITE_DELAY_MS);
  }

  return records;
}

async function main() {
  const args = process.argv.slice(2);
  const valueFor = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };

  if (args.includes("--probe")) {
    await probe(valueFor("--probe")?.startsWith("--") ? "Scarborough" : valueFor("--probe") ?? "Scarborough");
    return;
  }

  if (args.includes("--cities")) {
    // The predictive endpoint answers prefixes, so walking the alphabet (and
    // two-letter prefixes for the crowded letters) enumerates the register's
    // own city list without us inventing one.
    const found = new Set<string>();
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");
    for (const letter of letters) {
      for (const name of await citiesMatching(letter)) found.add(name);
      await sleep(400);
    }
    const sorted = [...found].sort();
    console.log(`${sorted.length} cities on the register`);
    writeJson("ingest/out/rcdso-cities.json", sorted);
    console.log("Wrote ingest/out/rcdso-cities.json");
    return;
  }

  const cities = valueFor("--city") ? [valueFor("--city")!] : DEFAULT_CITIES;

  const all: SourceRecord[] = [];
  for (const city of cities) {
    process.stdout.write(`${city}… `);
    try {
      const records = await searchCity(city);
      console.log(`${records.length} records`);
      all.push(...records);
    } catch (error) {
      console.log(`failed: ${String(error)}`);
    }
    await sleep(POLITE_DELAY_MS);
  }

  const specialists = all.filter((r) => r.practitioners?.[0]?.specialty).length;
  const sedation = all.filter((r) => r.permits?.sedation).length;
  console.log(`\n${all.length} records, ${specialists} with a specialty, ${sedation} mentioning sedation`);

  writeJson("ingest/out/rcdso.json", all);
  console.log("Wrote ingest/out/rcdso.json");
}

// Guarded so that importing this module (for its exported parsers, or from a
// test) does not hit the network.
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
