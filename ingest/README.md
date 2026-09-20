# Ingest pipeline

Five stages. Each writes JSON into `ingest/out/` and the next one reads it, so
any stage can be re-run without repeating the one before it — in particular,
the extraction pass can be re-run against a new prompt without re-crawling six
thousand websites.

```
rcdso.ts  ─┐
           ├─> merge.ts ─> crawl.ts ─> extract.ts ─> load.ts
osm.ts    ─┘
```

## Running it

```bash
npx tsx ingest/verify.ts              # offline checks, no network. Run this first.
npx tsx ingest/osm.ts                 # free, ~1 minute
npx tsx ingest/rcdso.ts --city Scarborough
npx tsx ingest/merge.ts
npx tsx ingest/crawl.ts --limit 50    # free, polite: ~1.2s between requests
npx tsx ingest/extract.ts --limit 20  # costs money — measure before scaling
```

Always run the two `--limit` stages small first and look at the output.

## Status of each stage

| Stage | Verified? |
|---|---|
| `lib.ts` normalisation, `merge.ts` matching | Yes — 24 offline checks in `verify.ts` |
| `crawl.ts` HTML handling and link picking | Yes — same checks |
| `extract.ts` quote verification | Yes — same checks |
| `osm.ts` Overpass query | **Not run against the live API.** The query and tag mapping are written to the documented OSM schema but have not been executed. |
| `rcdso.ts` register scraping | **Not run against the live site.** See below. |
| `extract.ts` end to end | **Not run against the API.** No extraction has been performed. |

The three unverified stages could not be executed from the environment this was
built in, which has no outbound network access from the shell. Nothing here
should be treated as working until it has been run once and the output looked
at.

## The one thing that will need fixing: RCDSO selectors

`ingest/rcdso.ts` drives a real browser rather than calling an endpoint,
because the register's search form posts through client-side script and a
browser handles whatever it does without us guessing at an API.

The `SELECTORS` block at the top of that file is a first guess. Before the first
real run:

```bash
npx tsx ingest/rcdso.ts --inspect-form
```

That prints the form's actual fields and their names instead of scraping.
Correct `SELECTORS` from what it prints. Everything downstream of
`parseResultRow` reads text rather than markup, so a register redesign breaks
the selectors and nothing else.

Be slow with this one. It is a regulator's website, the script waits 1.2s
between pages and 2.5s between cities, and a full Ontario run should be spread
over days rather than minutes.

## Cost

Only `extract.ts` costs money. Defaults to `claude-haiku-4-5`; override with
`EXTRACT_MODEL`.

Estimated for a full Ontario pass at roughly 6,200 clinics, three pages each:

| Model | Full pass | Batched |
|---|---|---|
| `claude-haiku-4-5` | ~$105 | ~$53 |
| `claude-sonnet-5` | ~$210 | ~$105 |

These are estimates from list pricing and how much text a clinic site typically
carries. `crawl.ts` prints the actual token volume it gathered, so run the crawl
first and price the real number before committing to a full extraction.

## The rule extract.ts exists to enforce

Every extracted fact must carry the page URL and the exact sentence it came
from. After the model responds, `dropUnverified` checks each quote actually
appears in the crawled text and discards the fact if it does not — a model asked
for evidence will sometimes paraphrase, and a paraphrase is not a citation.

The run prints the drop rate. **Above about 5%, stop and fix the prompt or
change the model rather than scaling up.** That number is the health check for
the whole pipeline.

## Licences and terms

- **RCDSO register** — public register published by the regulator. Crawl slowly
  and identify the bot honestly (`USER_AGENT` in `lib.ts`).
- **OpenStreetMap** — ODbL. Attribution is required and appears on `/sources/`.
- **Clinic websites** — publicly published pages. We store facts with citations,
  and `crawled.json` is a working file, not something to republish.
- **Google Places** — not used here on purpose. Their terms do not permit
  building a lasting database from their content, so if Places is added later it
  belongs in `volatile_snapshot` with a TTL, holding nothing but `place_id`
  between refreshes.
