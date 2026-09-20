/**
 * RCDSO public register ingest.
 *
 * This is the spine of the directory and the source of everything nobody else
 * uses: specialty registrations, facility sedation permits and CT scanner
 * permits. Those are facts on a regulator's register, which is what lets us
 * say a clinic is genuinely strong at implants or endodontics without making a
 * comparative claim of our own.
 *
 * Driven through a real browser rather than by reverse-engineering an endpoint:
 * the register's form posts through client-side script, and a browser handles
 * whatever it does without us guessing at an API that can change underneath us.
 *
 * ── NOT YET VERIFIED AGAINST THE LIVE SITE ──────────────────────────────────
 * The selectors in SELECTORS below are the one thing that needs checking on the
 * first real run. Run with `--inspect-form` to have the script print the form's
 * actual fields and result markup instead of scraping, then correct them here.
 * Everything downstream of `parseResultRow` is independent of the markup.
 *
 * Run: npx tsx ingest/rcdso.ts --city Scarborough
 *      npx tsx ingest/rcdso.ts --inspect-form
 */

import { chromium, type Page } from "playwright";
import { writeJson, normalizePhone, normalizePostal, slugify, sleep, type SourceRecord } from "./lib";

const REGISTER_URL = "https://www.rcdso.org/en-ca/find-a-dentist";

/** The only markup-dependent part of this file. Verify with --inspect-form. */
const SELECTORS = {
  cityInput: 'input[name*="city" i], input[id*="city" i]',
  submitButton: 'button[type="submit"], input[type="submit"]',
  resultRow: '[class*="result" i] li, table tbody tr, [class*="dentist-card" i]',
  nextPage: 'a[rel="next"], a[aria-label*="next" i], button[aria-label*="next" i]',
  consentButton: 'button:has-text("Accept"), button:has-text("I agree")',
} as const;

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

async function inspectForm(page: Page): Promise<void> {
  await page.goto(REGISTER_URL, { waitUntil: "domcontentloaded" });
  const report = await page.evaluate(() => {
    const fields = [...document.querySelectorAll("input, select, textarea")].map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: (el as HTMLInputElement).type,
      name: (el as HTMLInputElement).name,
      id: el.id,
      placeholder: (el as HTMLInputElement).placeholder,
    }));
    const forms = [...document.querySelectorAll("form")].map((f) => ({
      action: f.getAttribute("action"),
      method: f.getAttribute("method"),
    }));
    return { forms, fields };
  });
  console.log(JSON.stringify(report, null, 2));
  console.log(
    "\nUpdate SELECTORS in ingest/rcdso.ts to match, then run without --inspect-form.",
  );
}

async function searchCity(page: Page, city: string): Promise<SourceRecord[]> {
  await page.goto(REGISTER_URL, { waitUntil: "domcontentloaded" });

  const consent = page.locator(SELECTORS.consentButton).first();
  if (await consent.isVisible().catch(() => false)) await consent.click();

  const input = page.locator(SELECTORS.cityInput).first();
  await input.waitFor({ state: "visible", timeout: 20_000 });
  await input.fill(city);
  await page.locator(SELECTORS.submitButton).first().click();
  await page.waitForLoadState("networkidle");

  const records: SourceRecord[] = [];
  const seen = new Set<string>();

  for (let pageNumber = 1; pageNumber <= 200; pageNumber++) {
    const rows = await page.locator(SELECTORS.resultRow).evaluateAll((nodes) =>
      nodes.map((n) => ({ text: n.textContent ?? "", html: n.innerHTML })),
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      const record = parseResultRow(row);
      if (!record) continue;
      const key = `${record.sourceId}|${record.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      record.city = city;
      records.push(record);
    }

    const next = page.locator(SELECTORS.nextPage).first();
    const hasNext =
      (await next.isVisible().catch(() => false)) &&
      (await next.isEnabled().catch(() => false));
    if (!hasNext) break;

    await next.click();
    await page.waitForLoadState("networkidle");
    await sleep(1200); // Deliberate. This is a regulator's website.
  }

  return records;
}

async function main() {
  const args = process.argv.slice(2);
  const cityArgIndex = args.indexOf("--city");
  const cities =
    cityArgIndex >= 0 && args[cityArgIndex + 1]
      ? [args[cityArgIndex + 1]]
      : DEFAULT_CITIES;

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (compatible; OntarioDentalDirectoryBot/0.1; +https://example.invalid/about)",
  });

  try {
    if (args.includes("--inspect-form")) {
      await inspectForm(page);
      return;
    }

    const all: SourceRecord[] = [];
    for (const city of cities) {
      console.log(`Searching ${city}…`);
      try {
        const records = await searchCity(page, city);
        console.log(`  ${records.length} records`);
        all.push(...records);
      } catch (error) {
        console.error(`  ${city} failed: ${String(error)}`);
      }
      await sleep(2500);
    }

    const specialists = all.filter((r) => r.practitioners?.[0]?.specialty).length;
    const sedation = all.filter((r) => r.permits?.sedation).length;
    console.log(`\n${all.length} records, ${specialists} with a specialty, ${sedation} mentioning sedation`);

    writeJson("ingest/out/rcdso.json", all);
    console.log("Wrote ingest/out/rcdso.json");
  } finally {
    await browser.close();
  }
}

// Guarded so that importing this module (for its exported parsers, or from a
// test) does not launch a browser or hit the network.
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
