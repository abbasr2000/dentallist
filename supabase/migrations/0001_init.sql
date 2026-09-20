-- Ontario dental directory — initial schema.
--
-- Design notes that matter:
--
-- 1. Every published fact about a clinic we do not own carries provenance.
--    That is why `fact_source` exists as a real table rather than a jsonb blob:
--    we query it (to render "listed on their website" links) and we age it out.
--
-- 2. Procedure strength is derived, never stored by hand. `clinic_evidence`
--    holds the raw signals; `clinic_procedure.strength` is recomputed from them.
--    A registered specialist on the RCDSO register outweighs a service listed
--    on a clinic's own website by roughly nine to one.
--
-- 3. Google Places content is deliberately NOT persisted here beyond place_id.
--    Their terms do not permit building a lasting database out of it, so hours
--    and ratings sourced from Places live in `volatile_snapshot` with a TTL and
--    get refreshed rather than accumulated.

create extension if not exists "pgcrypto";
create extension if not exists "postgis";

-- ---------------------------------------------------------------- geography

create table city (
  slug            text primary key,
  name            text not null,
  municipality    text,
  region          text not null default 'Ontario',
  lat             double precision not null,
  lng             double precision not null,
  blurb           text,
  created_at      timestamptz not null default now()
);

create table neighbourhood (
  slug            text primary key,
  city_slug       text not null references city(slug) on delete cascade,
  name            text not null,
  blurb           text,
  -- Boundary, where we have one. Used to assign clinics by point-in-polygon
  -- rather than by guessing from the street address.
  boundary        geography(polygon, 4326)
);

create index neighbourhood_city_idx on neighbourhood(city_slug);

-- ------------------------------------------------------------------ clinics

create type listing_tier as enum ('unclaimed', 'claimed', 'featured');

create table clinic (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null,
  name                text not null,
  city_slug           text not null references city(slug),
  neighbourhood_slug  text references neighbourhood(slug),

  address             text not null,
  postal_code         text,
  location            geography(point, 4326),

  phone               text,
  website             text,
  email               text,

  year_established    int,
  tier                listing_tier not null default 'unclaimed',
  featured_until      timestamptz,

  -- Set when a page would be too thin to be worth landing on. Such clinics
  -- still appear in city lists but get a canonical to the city page instead
  -- of their own indexable URL. This is the guard against thin-content
  -- penalties on a programmatically generated site.
  publishable         boolean not null generated always as (
                        phone is not null and address is not null
                      ) stored,

  first_seen          timestamptz not null default now(),
  last_updated        timestamptz not null default now(),

  unique (city_slug, slug)
);

create index clinic_city_idx        on clinic(city_slug);
create index clinic_neighbourhood_idx on clinic(neighbourhood_slug);
create index clinic_location_idx    on clinic using gist(location);
create index clinic_tier_idx        on clinic(tier) where tier <> 'unclaimed';

-- RCDSO-registered dentists, linked to the clinics they practise at.
create table practitioner (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null,
  -- RCDSO registration number. The join key back to the public register.
  registration_number text unique,
  specialty           text,
  credentials         text,
  bio                 text,
  register_status     text,
  created_at          timestamptz not null default now()
);

create table clinic_practitioner (
  clinic_id       uuid not null references clinic(id) on delete cascade,
  practitioner_id uuid not null references practitioner(id) on delete cascade,
  primary key (clinic_id, practitioner_id)
);

-- ------------------------------------------------------------ opening hours

create table clinic_hours (
  clinic_id   uuid not null references clinic(id) on delete cascade,
  -- 0 = Sunday. A closed day is simply an absent row.
  day         smallint not null check (day between 0 and 6),
  opens       time not null,
  closes      time not null,
  primary key (clinic_id, day, opens)
);

-- -------------------------------------------------------------- provenance

create type source_kind as enum (
  'rcdso', 'osm', 'places', 'clinic-site', 'owner', 'editorial'
);

-- One row per fact we publish. `field_path` names what it backs, e.g.
-- 'languages' or 'payment.direct_billing', so a profile page can render the
-- receipt next to the claim.
create table fact_source (
  id            bigserial primary key,
  clinic_id     uuid not null references clinic(id) on delete cascade,
  field_path    text not null,
  source        source_kind not null,
  url           text,
  -- The sentence the fact was taken from. Required for 'clinic-site':
  -- no quote, no field. This is what stops an extraction model inventing
  -- services a clinic does not offer.
  quote         text,
  checked_at    timestamptz not null default now(),

  constraint clinic_site_requires_quote
    check (source <> 'clinic-site' or quote is not null)
);

create index fact_source_clinic_idx on fact_source(clinic_id, field_path);

-- --------------------------------------------------- procedures & evidence

create table procedure (
  key           text primary key,
  label         text not null,
  short_label   text not null,
  clinical_name text,
  sort_order    int not null default 0
);

create type evidence_kind as enum (
  'rcdso-specialist',
  'rcdso-sedation-permit',
  'rcdso-cbct-permit',
  'owner-verified',
  'in-house-technology',
  'site-detail',
  'site-mention'
);

-- Weights live in the database so the methodology page and the scoring code
-- read from one place. Published at /methodology/ — see the RCDSO advertising
-- rules: we rank on verifiable evidence, never on superlatives.
create table evidence_weight (
  kind    evidence_kind primary key,
  weight  int not null
);

insert into evidence_weight (kind, weight) values
  ('rcdso-specialist',      45),
  ('rcdso-sedation-permit', 25),
  ('rcdso-cbct-permit',     20),
  ('owner-verified',        15),
  ('in-house-technology',   15),
  ('site-detail',           10),
  ('site-mention',           5);

create table clinic_evidence (
  id              bigserial primary key,
  clinic_id       uuid not null references clinic(id) on delete cascade,
  procedure_key   text not null references procedure(key),
  kind            evidence_kind not null,
  -- Shown to the patient, e.g. "Periodontist on staff — Dr A. Rahman".
  -- Must be a statement of fact. No superlatives: RCDSO advertising
  -- guidelines prohibit them for Ontario registrants.
  detail          text not null,
  fact_source_id  bigint references fact_source(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index clinic_evidence_idx on clinic_evidence(clinic_id, procedure_key);

create table clinic_procedure (
  clinic_id     uuid not null references clinic(id) on delete cascade,
  procedure_key text not null references procedure(key),
  -- 0-100, recomputed from clinic_evidence. Never hand-set.
  strength      smallint not null default 0 check (strength between 0 and 100),
  recomputed_at timestamptz not null default now(),
  primary key (clinic_id, procedure_key)
);

create index clinic_procedure_rank_idx
  on clinic_procedure(procedure_key, strength desc);

-- ------------------------------------------------ practical filter signals

-- Kept as typed columns rather than a tag soup, because these are the things
-- people actually filter on and each one needs its own provenance row.
create table clinic_signals (
  clinic_id               uuid primary key references clinic(id) on delete cascade,
  languages               text[] not null default '{}',
  accepting_new_patients  boolean,
  new_patient_wait_days   int,
  online_booking_url      text,
  same_day_emergency      boolean,
  after_hours_phone       boolean,
  walk_ins_accepted       boolean,
  direct_billing          boolean,
  insurers                text[] not null default '{}',
  cdcp                    boolean,
  payment_plans           boolean,
  wheelchair_accessible   boolean,
  parking_on_site         boolean,
  nearest_transit         text,
  updated_at              timestamptz not null default now()
);

-- Published fee ranges. Owner-submitted in practice — almost nobody publishes
-- these, which is exactly why showing them is worth something.
create table clinic_fee (
  clinic_id     uuid not null references clinic(id) on delete cascade,
  procedure_key text not null references procedure(key),
  amount_from   numeric(8,2) not null,
  amount_to     numeric(8,2),
  currency      char(3) not null default 'CAD',
  primary key (clinic_id, procedure_key)
);

-- ------------------------------------------------------- volatile / Places

-- Google Places content we refresh rather than accumulate. `expires_at` is
-- enforced by the read layer: expired rows are not rendered.
create table volatile_snapshot (
  clinic_id   uuid not null references clinic(id) on delete cascade,
  key         text not null,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  primary key (clinic_id, key)
);

-- The one Places field their terms allow us to keep.
alter table clinic add column google_place_id text unique;

-- -------------------------------------------------------- ingest bookkeeping

create table ingest_run (
  id           uuid primary key default gen_random_uuid(),
  source       source_kind not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           int not null default 0,
  failed       int not null default 0,
  notes        text
);

-- Raw crawled pages, kept so an extraction can be re-run against new prompts
-- without re-crawling 6,000 websites.
create table crawled_page (
  id          bigserial primary key,
  clinic_id   uuid references clinic(id) on delete cascade,
  url         text not null,
  status      int,
  fetched_at  timestamptz not null default now(),
  content     text,
  unique (clinic_id, url)
);
