# Ontario Dental Directory

A directory of dental practices in Ontario that ranks clinics by evidence you
can check rather than by self-description or paid position.

## Why it is built this way

Most dental directories list every service every clinic mentions, which makes a
practice that placed four implants last year look identical to one with a
periodontist on staff and a CBCT scanner. This one separates those.

The RCDSO public register records specialty registrations, facility sedation
permits and CT scanner permits. Those are facts on a regulator's register, and
they are the backbone of the ranking. A service appearing on a clinic's own
website counts for a ninth as much, and marketing alone is capped at 55 out of
100 — nothing reaches the top of the scale without register-backed evidence.

Every published fact carries its source. Facts taken from a clinic's website
store the page URL and the sentence they came from, and the profile page shows
that link. If a fact has no quote behind it, it does not get published.

## The RCDSO advertising constraint

Ontario dentists are prohibited from using testimonials, superlatives and
incentive programs in their advertising. This directory is not a registrant,
but once a clinic pays for placement, what the directory says on its behalf
starts to look like that clinic's advertising — so the product is built not to
create that problem:

- No patient testimonials or review text
- No star ratings, and no `AggregateRating` or `Review` schema markup anywhere
- No superlative or comparative language in headings, badges or generated prose
- Sponsored placements sit in a separate labelled block, and the label makes no
  claim about quality
- Procedure lists show the *kind* of evidence rather than a score out of 100,
  because a number next to a named practice reads as a quality rating

## Structure

```
app/                       Next.js App Router, exported to static HTML
  [region]/                Ontario overview
  [region]/[city]/         one city — and, for a procedure key, that
                           procedure across the whole province
  [region]/[city]/[procedure]/   one procedure in one city
  clinic/[city]/[slug]/    clinic profile
  llms.txt/                generated from live data on every build
components/RegionProcedure.tsx  the province-wide procedure page
lib/
  procedures.ts   15 procedures, with the shorthand people search (exo, endo, RCT, perio)
  types.ts        clinic model; provenance on every field
  strength.ts     evidence weighting and completeness scoring
  schema.ts       JSON-LD builders
  data.ts         read layer and the indexability floor
  tiers.ts        how evidence is described in lists
ingest/           the data pipeline — see ingest/README.md
supabase/         database schema
data/
  ingested.ts     the real dataset, read from ingest/out/clinics.json at build
  claimed.ts      listings an owner has confirmed, and what they supplied
  seed.ts         sample data for template development, NOT real data
```

## It is static HTML

`npm run build` writes `out/` — one `.html` file per page, no server and no
database in the request path. A crawler gets finished HTML the moment it asks,
which is most of the point. Supabase is for letting clinics edit their own
listings; even then it will feed the build rather than serve it.

Two URL shapes share one route, because Next cannot tell `/ontario/toronto/`
from `/ontario/orthodontics/` apart at one level. `/[region]/[city]/` resolves a
procedure key to the province-wide procedure page and anything else to a city.
The build throws if a city slug ever collides with a procedure key.

## Running it

```bash
npm install
npm run dev
npm run build
npx tsx ingest/verify.ts     # offline checks on the pipeline
```

`NEXT_PUBLIC_SITE_URL` sets the canonical host for sitemaps, canonicals, JSON-LD
and llms.txt. It has no default in production on purpose.

## The indexability floor

A procedure page is only published as an indexable URL when at least five
clinics in that city offer the procedure. Below that it still renders, but
canonicals to the city page and stays out of the sitemap. Shipping thousands of
near-empty pages is how programmatic SEO earns a manual action; `INDEX_FLOOR` in
`lib/site.ts` is the guard.

## Deploying

Connect the repository at vercel.com/new; the defaults are right. Nothing else
is needed — `vercel.json` points at `out/`. `.github/workflows/deploy.yml` is an
alternative for deploying from CI instead, and no-ops until `VERCEL_TOKEN` is
set.

## State

Live on real data. OpenStreetMap gives 2,770 Ontario practices; the RCDSO
register supplies the specialty registrations the ranking is built on, and is
pulled city by city from its public search. `ingest/README.md` has the details,
including the two things that are known not to work:

- **Sedation and CT permits are not available.** They are issued to a facility,
  not a dentist, and the dentist search has the fields with nothing behind them
  — probed six ways, zero results every time. The directory therefore carries no
  sedation evidence, which is correct: it is not something to infer.
- **City assignment is nearest-centroid, not a boundary lookup.** A clinic close
  to a municipal line can land on the wrong side of it.
