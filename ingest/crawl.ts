/**
 * Clinic website crawler.
 *
 * No AI here — this is an ordinary fetch job that saves pages to disk so the
 * extraction pass can be re-run against a new prompt without re-crawling six
 * thousand small business websites.
 *
 * Fetches at most a handful of pages per clinic: the homepage plus whichever
 * internal links look like services, about, hours or contact. That is where
 * the facts are, and crawling the whole site would multiply cost for nothing.
 *
 * Run: npx tsx ingest/crawl.ts [--limit 50]
 */

import { politeFetch, readJson, sleep, writeJson } from "./lib";

const MAX_PAGES_PER_CLINIC = 4;
const PAGE_HINTS = [
  "service", "treatment", "procedure", "about", "team", "dentist",
  "hour", "contact", "location", "insurance", "billing", "fee", "price",
  "emergency", "new-patient", "language",
];

interface ClinicInput { slug: string; citySlug: string; name: string; website?: string }
interface CrawledPage { url: string; status: number; text: string }
interface CrawlResult { slug: string; citySlug: string; pages: CrawledPage[]; error?: string }

/**
 * HTML to readable text.
 *
 * Deliberately crude: strip script, style, nav and footer, collapse the rest.
 * The extraction model does not need markup, and every character we keep is a
 * character we pay for.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Internal links most likely to carry the facts we want. */
export function pickInternalLinks(html: string, base: string): string[] {
  const origin = new URL(base).origin;
  const found = new Map<string, number>();

  for (const match of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(match[1], base);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4)$/i.test(url.pathname)) continue;

    const haystack = `${url.pathname} ${match[2]}`.toLowerCase();
    const score = PAGE_HINTS.reduce((n, hint) => (haystack.includes(hint) ? n + 1 : n), 0);
    if (score === 0) continue;

    const clean = `${url.origin}${url.pathname}`;
    found.set(clean, Math.max(found.get(clean) ?? 0, score));
  }

  return [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
    .filter((url) => url !== base)
    .slice(0, MAX_PAGES_PER_CLINIC - 1);
}

async function crawlClinic(clinic: ClinicInput): Promise<CrawlResult> {
  const result: CrawlResult = { slug: clinic.slug, citySlug: clinic.citySlug, pages: [] };
  if (!clinic.website) return { ...result, error: "no website" };

  let home: string;
  let homeUrl: string;
  try {
    homeUrl = new URL(clinic.website).toString();
    const res = await politeFetch(homeUrl);
    home = await res.text();
    result.pages.push({ url: homeUrl, status: res.status, text: htmlToText(home) });
    if (!res.ok) return { ...result, error: `homepage HTTP ${res.status}` };
  } catch (error) {
    return { ...result, error: `homepage failed: ${String(error)}` };
  }

  for (const link of pickInternalLinks(home, homeUrl)) {
    try {
      const res = await politeFetch(link);
      if (!res.ok) continue;
      result.pages.push({ url: link, status: res.status, text: htmlToText(await res.text()) });
    } catch {
      // A broken internal link is not worth failing the clinic over.
    }
  }

  return result;
}

async function main() {
  const clinics = readJson<ClinicInput[]>("ingest/out/clinics.json");
  if (!clinics) {
    console.error("No ingest/out/clinics.json. Run ingest/merge.ts first.");
    process.exit(1);
  }

  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

  const targets = clinics.filter((c) => c.website).slice(0, limit);
  console.log(`Crawling ${targets.length} clinic websites (${clinics.length - targets.length} skipped: no website or over limit)`);

  const results: CrawlResult[] = [];
  let ok = 0;
  for (const [i, clinic] of targets.entries()) {
    const result = await crawlClinic(clinic);
    results.push(result);
    if (!result.error) ok++;
    if ((i + 1) % 25 === 0) {
      console.log(`  ${i + 1}/${targets.length} (${ok} ok)`);
      writeJson("ingest/out/crawled.json", results); // checkpoint
    }
    await sleep(200);
  }

  const chars = results.reduce((n, r) => n + r.pages.reduce((m, p) => m + p.text.length, 0), 0);
  console.log(`\n${ok}/${targets.length} crawled`);
  console.log(`  ${(chars / 1000).toFixed(0)}k characters of text`);
  console.log(`  roughly ${Math.round(chars / 4 / 1000)}k tokens to extract from`);

  writeJson("ingest/out/crawled.json", results);
  console.log("Wrote ingest/out/crawled.json");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
