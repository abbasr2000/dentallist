-- Resolving ingested evidence onto clinic ids.
--
-- ingest/load.ts writes clinics by (city_slug, slug) because that is what the
-- ingest knows; it has no clinic uuid until the row exists. Rather than making
-- the loader do a lookup per row, it stages evidence by slug here and this
-- function resolves it in one statement.

create table if not exists clinic_evidence_staging (
  id             bigserial primary key,
  clinic_slug    text not null,
  city_slug      text not null,
  procedure_key  text not null,
  kind           evidence_kind not null,
  detail         text not null,
  source_url     text,
  source_quote   text,
  loaded_at      timestamptz not null default now()
);

create index if not exists clinic_evidence_staging_lookup
  on clinic_evidence_staging(city_slug, clinic_slug);

/*
 * Move staged evidence onto real clinics, then recompute strength.
 *
 * Idempotent: register-backed evidence is replaced wholesale rather than
 * appended, so a clinic that loses a specialist between refreshes loses the
 * evidence too. Appending would let a stale specialty registration inflate a
 * ranking indefinitely, which is exactly the kind of unsupported comparative
 * claim the whole design is trying to avoid.
 */
create or replace function apply_staged_evidence()
returns table (clinics_touched int, evidence_rows int)
language plpgsql
as $$
declare
  touched int;
  rows_written int;
begin
  -- Only clear the kinds we are about to rewrite. Owner-submitted and
  -- site-derived evidence comes from other pipelines and is not ours to drop.
  delete from clinic_evidence ce
  using clinic c
  where ce.clinic_id = c.id
    and ce.kind in ('rcdso-specialist', 'rcdso-sedation-permit', 'rcdso-cbct-permit')
    and exists (
      select 1 from clinic_evidence_staging s
      where s.clinic_slug = c.slug and s.city_slug = c.city_slug
    );

  insert into clinic_evidence (clinic_id, procedure_key, kind, detail)
  select c.id, s.procedure_key, s.kind, s.detail
  from clinic_evidence_staging s
  join clinic c
    on c.slug = s.clinic_slug
   and c.city_slug = s.city_slug
  join procedure p
    on p.key = s.procedure_key;

  get diagnostics rows_written = row_count;

  select count(distinct c.id) into touched
  from clinic_evidence_staging s
  join clinic c on c.slug = s.clinic_slug and c.city_slug = s.city_slug;

  perform recompute_procedure_strength();

  delete from clinic_evidence_staging;

  return query select touched, rows_written;
end;
$$;

/*
 * Recompute clinic_procedure.strength from clinic_evidence.
 *
 * Mirrors lib/strength.ts exactly, and the two must stay in step — the site
 * reads this column, and the methodology page states these rules publicly.
 *
 *   - Weights come from evidence_weight.
 *   - Repeats of the same kind decay at 0.4 each, so a wordy website cannot
 *     outrank a specialist registration.
 *   - Without register-backed evidence, strength is capped at 55. Nothing
 *     reaches the top of the scale on self-description alone.
 */
create or replace function recompute_procedure_strength()
returns void
language sql
as $$
  with ranked as (
    select
      ce.clinic_id,
      ce.procedure_key,
      ce.kind,
      ew.weight,
      row_number() over (
        partition by ce.clinic_id, ce.procedure_key, ce.kind
        order by ce.id
      ) - 1 as repeat_index
    from clinic_evidence ce
    join evidence_weight ew on ew.kind = ce.kind
  ),
  scored as (
    select
      clinic_id,
      procedure_key,
      sum(weight * power(0.4, repeat_index)) as raw_score,
      bool_or(kind in ('rcdso-specialist', 'rcdso-sedation-permit', 'rcdso-cbct-permit'))
        as register_backed
    from ranked
    group by clinic_id, procedure_key
  )
  insert into clinic_procedure (clinic_id, procedure_key, strength, recomputed_at)
  select
    clinic_id,
    procedure_key,
    least(
      100,
      case when register_backed then round(raw_score) else least(round(raw_score), 55) end
    )::smallint,
    now()
  from scored
  on conflict (clinic_id, procedure_key)
  do update set
    strength = excluded.strength,
    recomputed_at = excluded.recomputed_at;
$$;

-- Seed the procedure table from the taxonomy in lib/procedures.ts.
insert into procedure (key, label, short_label, clinical_name, sort_order) values
  ('dental-implants',      'Dental implants',              'Implants',     'Endosseous implant placement and restoration', 1),
  ('root-canal',           'Root canal treatment',         'Endo',         'Endodontic therapy',                2),
  ('extractions',          'Tooth extractions',            'Exo',          'Dental extraction',                 3),
  ('wisdom-teeth',         'Wisdom teeth removal',         'Wisdom teeth', 'Third molar extraction',            4),
  ('orthodontics',         'Braces and orthodontics',      'Ortho',        'Orthodontic treatment',             5),
  ('invisalign',           'Invisalign and clear aligners','Invisalign',   'Clear aligner therapy',             6),
  ('cosmetic-dentistry',   'Cosmetic dentistry',           'Cosmetic',     'Aesthetic restorative dentistry',   7),
  ('teeth-whitening',      'Teeth whitening',              'Whitening',    'Vital tooth bleaching',             8),
  ('crowns-and-bridges',   'Crowns and bridges',           'Crowns',       'Fixed prosthodontics',              9),
  ('dentures',             'Dentures',                     'Dentures',     'Removable prosthodontics',         10),
  ('gum-disease',          'Gum disease treatment',        'Perio',        'Periodontal therapy',              11),
  ('pediatric-dentistry',  'Children''s dentistry',        'Kids',         'Pediatric dentistry',              12),
  ('oral-surgery',         'Oral surgery',                 'Oral surgery', 'Oral and maxillofacial surgery',   13),
  ('sedation-dentistry',   'Sedation dentistry',           'Sedation',     'Procedural sedation',              14),
  ('emergency-dentistry',  'Emergency dental care',        'Emergency',    'Urgent dental care',               15)
on conflict (key) do update set
  label = excluded.label,
  short_label = excluded.short_label,
  clinical_name = excluded.clinical_name,
  sort_order = excluded.sort_order;
