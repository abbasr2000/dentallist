/**
 * Extraction pass: crawled clinic pages → structured facts with provenance.
 *
 * The one rule this file exists to enforce: every extracted fact carries the
 * page it came from and the sentence it was taken from. A fact without a quote
 * is dropped, and a quote that does not actually appear in the crawled text is
 * dropped too — a model asked for evidence will sometimes paraphrase, and a
 * paraphrase is not a citation. That check is `verifyQuote` below, and it is
 * the difference between a directory that can defend what it publishes and one
 * that cannot.
 *
 * Model choice: Haiku 4.5 for the bulk pass. This is schema-constrained
 * extraction from short text, which is what it is good at, and at roughly $53
 * batched for all of Ontario it is not the expensive part of the project. Set
 * EXTRACT_MODEL to override.
 *
 * Run: npx tsx ingest/extract.ts --limit 20        (measure first)
 *      npx tsx ingest/extract.ts                   (full pass)
 */

import Anthropic from "@anthropic-ai/sdk";
import { readJson, writeJson } from "./lib";
import { PROCEDURES, type ProcedureKey } from "../lib/procedures";

const MODEL = process.env.EXTRACT_MODEL ?? "claude-haiku-4-5";
const client = new Anthropic();

interface CrawledPage { url: string; status: number; text: string }
interface CrawlResult { slug: string; citySlug: string; pages: CrawledPage[]; error?: string }

/** What the model is asked to return. */
interface Extraction {
  procedures: Array<{ procedure: ProcedureKey; quote: string; sourceUrl: string; specific: boolean }>;
  languages: Array<{ language: string; quote: string; sourceUrl: string }>;
  directBilling?: { value: boolean; quote: string; sourceUrl: string };
  cdcp?: { value: boolean; quote: string; sourceUrl: string };
  acceptingNewPatients?: { value: boolean; quote: string; sourceUrl: string };
  sameDayEmergency?: { value: boolean; quote: string; sourceUrl: string };
  wheelchairAccessible?: { value: boolean; quote: string; sourceUrl: string };
  technology: Array<{ item: string; quote: string; sourceUrl: string }>;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["procedures", "languages", "technology"],
  properties: {
    procedures: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["procedure", "quote", "sourceUrl", "specific"],
        properties: {
          procedure: { type: "string", enum: PROCEDURES.map((p) => p.key) },
          quote: { type: "string", description: "The exact sentence from the page, copied verbatim." },
          sourceUrl: { type: "string" },
          specific: {
            type: "boolean",
            description:
              "True only if the page says something checkable beyond the service name — e.g. names equipment, a technique, or who performs it. False if the service merely appears in a list.",
          },
        },
      },
    },
    languages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["language", "quote", "sourceUrl"],
        properties: {
          language: { type: "string" },
          quote: { type: "string" },
          sourceUrl: { type: "string" },
        },
      },
    },
    technology: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "quote", "sourceUrl"],
        properties: {
          item: { type: "string" },
          quote: { type: "string" },
          sourceUrl: { type: "string" },
        },
      },
    },
    ...Object.fromEntries(
      ["directBilling", "cdcp", "acceptingNewPatients", "sameDayEmergency", "wheelchairAccessible"].map(
        (field) => [
          field,
          {
            type: "object",
            additionalProperties: false,
            required: ["value", "quote", "sourceUrl"],
            properties: {
              value: { type: "boolean" },
              quote: { type: "string" },
              sourceUrl: { type: "string" },
            },
          },
        ],
      ),
    ),
  },
} as const;

const SYSTEM = `You extract facts about a dental clinic from its own website.

Rules, in order of importance:

1. Every fact you return must be supported by an exact sentence copied verbatim
   from the page text you were given. Copy it character for character. Do not
   paraphrase, summarise, tidy up, or join two sentences together. If you cannot
   copy an exact supporting sentence, omit the fact entirely.
2. Omit anything the pages do not state. An empty array is the correct answer
   when the clinic says nothing. Never infer a service from the clinic's
   general nature, from its name, or from what dental clinics usually offer.
3. "specific" is true only when the page says something checkable beyond naming
   the service — equipment used, a technique, who performs it, or availability.
   A service appearing in a list of services is not specific.
4. Record only languages the clinic states are spoken at the practice. Do not
   count a language-switcher menu on the website.
5. Report what the page claims, not whether it is true. You are extracting, not
   assessing.

Return only what the schema asks for.`;

/**
 * Confirm the quote actually appears in what we crawled.
 *
 * Normalised on whitespace and quote characters, because a model will often
 * return a straight apostrophe where the page had a curly one, and that is not
 * a fabrication. Anything that still does not match is dropped.
 */
export function verifyQuote(quote: string, corpus: string): boolean {
  const normalise = (s: string) =>
    s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
  const q = normalise(quote);
  if (q.length < 12) return false; // Too short to be evidence of anything.
  return normalise(corpus).includes(q);
}

async function extractOne(result: CrawlResult): Promise<Extraction | undefined> {
  if (result.pages.length === 0) return undefined;

  // Cap the text per clinic. Four pages of a small business site is plenty,
  // and an unbounded page is how a single clinic costs a hundred times the rest.
  const pages = result.pages
    .map((p) => `### ${p.url}\n\n${p.text.slice(0, 12_000)}`)
    .join("\n\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: `Clinic pages:\n\n${pages}` }],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return undefined;
  return JSON.parse(text.text) as Extraction;
}

/** Strip every fact whose quote we cannot find in the crawled text. */
export function dropUnverified(extraction: Extraction, corpus: string) {
  const keep = <T extends { quote: string }>(item: T | undefined): T | undefined =>
    item && verifyQuote(item.quote, corpus) ? item : undefined;

  return {
    procedures: extraction.procedures.filter((p) => verifyQuote(p.quote, corpus)),
    languages: extraction.languages.filter((l) => verifyQuote(l.quote, corpus)),
    technology: extraction.technology.filter((t) => verifyQuote(t.quote, corpus)),
    directBilling: keep(extraction.directBilling),
    cdcp: keep(extraction.cdcp),
    acceptingNewPatients: keep(extraction.acceptingNewPatients),
    sameDayEmergency: keep(extraction.sameDayEmergency),
    wheelchairAccessible: keep(extraction.wheelchairAccessible),
  };
}

async function main() {
  const crawled = readJson<CrawlResult[]>("ingest/out/crawled.json");
  if (!crawled) {
    console.error("No ingest/out/crawled.json. Run ingest/crawl.ts first.");
    process.exit(1);
  }

  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  const targets = crawled.filter((c) => !c.error && c.pages.length > 0).slice(0, limit);

  console.log(`Extracting from ${targets.length} clinics using ${MODEL}`);

  const out: Array<{ slug: string; citySlug: string; extraction: ReturnType<typeof dropUnverified> }> = [];
  let claimed = 0;
  let verified = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const [i, result] of targets.entries()) {
    try {
      const raw = await extractOne(result);
      if (!raw) continue;

      const corpus = result.pages.map((p) => p.text).join("\n");
      const clean = dropUnverified(raw, corpus);

      claimed += raw.procedures.length + raw.languages.length + raw.technology.length;
      verified += clean.procedures.length + clean.languages.length + clean.technology.length;

      out.push({ slug: result.slug, citySlug: result.citySlug, extraction: clean });
    } catch (error) {
      console.error(`  ${result.slug}: ${String(error)}`);
    }

    if ((i + 1) % 20 === 0) {
      console.log(`  ${i + 1}/${targets.length}`);
      writeJson("ingest/out/extracted.json", out);
    }
  }

  const dropped = claimed - verified;
  console.log(`\n${out.length} clinics extracted`);
  console.log(`  ${verified} facts kept, ${dropped} dropped for an unverifiable quote (${claimed ? ((dropped / claimed) * 100).toFixed(1) : "0"}%)`);
  console.log(`\nA drop rate above ~5% means the prompt or the model needs attention before a full run.`);

  writeJson("ingest/out/extracted.json", out);
  console.log("Wrote ingest/out/extracted.json");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
