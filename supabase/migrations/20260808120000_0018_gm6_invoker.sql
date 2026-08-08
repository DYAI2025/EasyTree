-- [WEGWERF] Migration 0018_gm6_invoker — GEGENMUTATION GM6 zu EYT-136.
--
-- NICHT MERGEN. Diese Migration existiert ausschliesslich, um die Zusicherung
-- "app.reject_assignment_in_published_plan() ist security definer" rot zu
-- machen und damit zu belegen, dass sie ueberhaupt etwas misst.
--
-- 0016 ist gemergt und append-only (CLAUDE.md), die Funktion wird deshalb
-- vorwaerts neu angelegt — Rumpf ZEICHENGLEICH aus
-- supabase/migrations/20260804020000_0016_planning_publish_insert_boundary.sql
-- uebernommen, einzige Abweichung: `security invoker` statt `security definer`.
create or replace function app.reject_assignment_in_published_plan()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_published_at timestamptz;
begin
  select pv.published_at
    into v_published_at
    from public.plan_versions pv
   where pv.id = new.plan_version_id
     and pv.org_id = new.org_id
     -- Die Bedingung der SELECT-Policy aus 0007, ausgeschrieben, weil
     -- `security definer` die Policy nicht anwendet — aber nur, wenn es
     -- ueberhaupt eine Anwendungsidentitaet gibt. Ohne sie (psql, Migration,
     -- Wartung) gilt die urspruengliche, universelle Regel.
     and (auth.uid() is null or pv.org_id in (select app.user_org_ids()))
     for share;

  -- Nicht gefunden heisst: fremder Mandant oder Tippfehler. Diese Entscheidung
  -- gehoert dem Fremdschluessel (23503), nicht dieser Regel.
  if not found then
    return new;
  end if;

  if v_published_at is not null then
    raise exception 'Planversion % ist veroeffentlicht und nimmt keine Zuweisung mehr auf', new.plan_version_id
      using errcode = '23514';
  end if;
  return new;
end
$$;
