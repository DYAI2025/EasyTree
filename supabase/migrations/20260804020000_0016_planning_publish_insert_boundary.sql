-- Migration 0016_planning_publish_insert_boundary (EYT-107, Reviewbefunde F1–F3)
--
-- 0015 hat das UPDATE auf `plan_versions` abgedichtet. Diese Migration schliesst
-- die zweite Tuer — das ANLEGEN — und nimmt zwei weitere Befunde desselben
-- Selbstreviews mit.
--
-- Rollback (vorwaerts, als neue Migration):
--   grant insert, delete on table public.plan_versions to authenticated;
--   drop policy plan_versions_insert_in_org on public.plan_versions;
--   create policy plan_versions_insert_in_org on public.plan_versions
--     for insert to authenticated
--     with check (org_id in (select app.user_org_ids()));
--   -- und app.reject_assignment_in_published_plan() auf den Stand von 0015
--   -- zuruecksetzen (ohne `auth.uid() is null or`).
-- Kein Datenverlust: diese Migration legt keine Tabelle und keine Spalte an.
-- Sie entzieht Rechte, verschaerft eine Policy und ersetzt einen Funktionsrumpf.
--
-- ---------------------------------------------------------------------------
-- Warum 0016 und nicht eine Korrektur in 0015
-- ---------------------------------------------------------------------------
-- Die Befunde stammen aus dem Selbstreview von PR #52 und waren dort noch als
-- Aenderung an 0015 geplant — zulaessig, solange die Migration nirgends
-- angewandt und nicht gemergt war. PR #52 wurde am 04.08.2026 um 01:57 UTC
-- gemergt (Merge-Commit 4a605de). Ab da gilt fuer 0015 wieder append-only
-- (CLAUDE.md), und die Korrektur gehoert nach vorn.
--
-- ===========================================================================
-- F1 — Eine Planversion wird als ENTWURF geboren
-- ===========================================================================
-- Gemessen am gehosteten Projekt am 04.08.2026 (read-only, PostgreSQL 17.6):
--
--   has_column_privilege('authenticated','public.plan_versions','published_at','insert') = true
--   has_column_privilege('authenticated','public.plan_versions','published_by','insert') = true
--   has_column_privilege('authenticated','public.assignments','published_at','insert')   = false
--
-- Die letzte Zeile ist der Vergleich, der den Befund erst sichtbar macht: 0010
-- hat `assignments.published_at` gegen genau diesen Fall geschuetzt,
-- `plan_versions` blieb aussen vor.
--
-- Dazu kommen drei Umstaende, die zusammen die Luecke ergeben:
--
--   * Auf `plan_versions` liegen genau zwei Trigger, beide fuer `update` bzw.
--     `delete` (0010). KEINER feuert bei INSERT.
--   * `plan_versions_insert_in_org` prueft ausschliesslich die Organisation.
--   * `plan_versions_one_draft_per_week` ist partiell (`where published_at is
--     null`) — eine geborene Veroeffentlichung kollidiert mit nichts.
--
-- Ein aktives Mitglied konnte damit ueber die Data-API
--
--     POST /rest/v1/plan_versions
--     {"org_id": …, "week_key": …, "published_at": …, "published_by": …}
--
-- eine sofort veroeffentlichte Planversion anlegen: ohne
-- Wochenzuordnungspruefung, ohne benannte Konflikte, ohne Idempotenzdatensatz,
-- ohne Audit, ohne Outbox — und laut 0010 unveraenderlich UND unloeschbar.
-- Sie haette `publishedVersionId` der Woche dauerhaft besetzt
-- (planning-window.repository.ts), den echten Publish ab dann mit
-- „bereits veroeffentlicht" beantwortet und EYT-109 eine Kostenquelle ohne
-- Zuweisungen untergeschoben. Niemand haette sie zuruecknehmen koennen, ohne
-- Trigger abzuschalten.
--
-- Zwei unabhaengige Riegel, dieselbe Bauart wie bei der Kanalgrenze in 0015:
-- das Spaltenrecht und die Policy. Jeder allein genuegt; gemeinsam entscheidet
-- das Spaltenrecht zuerst, weil es vor jeder Zeilenpruefung greift.
--
-- Der Publish-Command legt Entwuerfe mit `(org_id, week_key)` an
-- (planning-write.repository.ts), Tests zusaetzlich mit `id`. Genau diese drei
-- Spalten bleiben offen; `created_at` hat einen Vorgabewert und wird nirgends
-- mitgegeben.
revoke insert on table public.plan_versions from authenticated;
grant insert (id, org_id, week_key) on table public.plan_versions to authenticated;
grant insert on table public.plan_versions to authenticated; -- GM-F1a

drop policy plan_versions_insert_in_org on public.plan_versions;

create policy plan_versions_insert_in_org on public.plan_versions
  for insert to authenticated
  with check (
    org_id in (select app.user_org_ids())
  );

-- ===========================================================================
-- F3 — Ein Loeschrecht, das kein Command benutzt
-- ===========================================================================
-- `authenticated` besass `delete` auf `plan_versions`, und die Delete-Policy
-- prueft nur die Organisation. Kein Anwendungspfad loescht Planversionen —
-- gemessen: `git grep "delete from public.plan_versions"` findet
-- ausschliesslich Testaufraeumungen, und die laufen ueber die
-- Verwaltungsverbindung.
--
-- Ueber die Data-API konnte damit jedes Mitglied einen Entwurf entfernen. Das
-- ist nicht folgenlos: `assignments.plan_version_id` ist `on delete cascade`
-- (0007), die Wochenplanung waere still mitgegangen. Veroeffentlichtes
-- schuetzte schon vorher der Unveraenderlichkeits-Trigger aus 0010; Entwuerfe
-- schuetzte nichts.
--
-- Ein Recht ohne Verbraucher ist reine Angriffsflaeche. Entsteht spaeter ein
-- Loesch-Command, bekommt er sein Recht mit seinem Ticket — dann mit Policy,
-- Kanalgrenze und Nachweis, so wie das Veroeffentlichen.
--
-- Die Policy `plan_versions_delete_in_org` bleibt bestehen: sie ist ohne Grant
-- wirkungslos, und ihr Entfernen waere eine zweite Aenderung ohne zweiten
-- Nutzen. Kaskaden aus `organizations` laufen weiterhin, denn
-- Fremdschluesselaktionen fuehrt PostgreSQL mit den Rechten des Eigentuemers
-- aus.
revoke delete on table public.plan_versions from authenticated;

-- ===========================================================================
-- F2 — Die Invariante gilt auch ohne Anwendungsidentitaet
-- ===========================================================================
-- 0015 hat `app.reject_assignment_in_published_plan()` auf `security definer`
-- gehoben, weil ein `select … for share` zusaetzlich die `using`-Klausel der
-- UPDATE-Policy prueft und die Elternzeile sonst ausserhalb des
-- Laufzeitkanals unsichtbar geworden waere. Das war richtig.
--
-- Ihr Zusatzfilter war zu breit. `app.user_org_ids()` waehlt
-- `m.user_id = auth.uid()`; ohne JWT-Claims ist `auth.uid()` NULL, die Menge
-- leer, und der Zweig „nicht gefunden heisst fremder Mandant" laesst die
-- Zuweisung durch. Vorher (invoker, als `postgres` mit BYPASSRLS) fand das
-- `for share` die Zeile und lehnte ab.
--
-- Betroffen waren genau die Sitzungen ohne Anwendungsidentitaet: psql,
-- Migrationsskripte, Wartungszugriffe. Das Schliessen des P1 haette also eine
-- Invariante verengt, die es vorher gab — leise, und ohne dass ein Test es
-- gesagt haette.
--
-- `auth.uid() is null` unterscheidet zuverlaessig: ueber PostgREST setzt GoTrue
-- die Claims immer, der Laufzeitkanal setzt sie im Runner. Der Nullfall ist
-- damit kein anonymer Angreifer, sondern ein Wartungszugriff — und der soll
-- die Wahrheit sehen. Das Existenzleck, das der Filter verhindert, bleibt fuer
-- alle Sitzungen MIT Identitaet geschlossen.
create or replace function app.reject_assignment_in_published_plan()
returns trigger
language plpgsql
security definer
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

comment on function app.reject_assignment_in_published_plan() is
  'Verhindert Zuweisungen in eine bereits veroeffentlichte Planversion (EYT-49 AK4). security definer seit EYT-107 P1: `for share` wuerde sonst die using-Klausel der UPDATE-Policy mitpruefen und die Elternzeile ausserhalb des Laufzeitkanals unsichtbar machen. Die Mandantenbedingung gilt nur fuer Sitzungen MIT Anwendungsidentitaet; ohne JWT-Claims (psql, Migration, Wartung) gilt die universelle Regel.';

comment on column public.plan_versions.published_at is
  'Autoritative Veroeffentlichungsmarke. Nur ueber den EasyTree-Publish-Command setzbar: die Update-Policy verlangt planning.publish UND app.is_runtime_channel(), das Spaltenrecht endet bei published_at/published_by, und beim ANLEGEN ist die Spalte gar nicht adressierbar (0016). Eine Planversion wird als Entwurf geboren.';

comment on table public.plan_versions is
  'Planversion je Organisation und ISO-Woche (EYT-86). published_at ist die autoritative Veroeffentlichungsmarke; assignments.published_at wird davon abgeleitet und atomar mitgesetzt (EYT-49). authenticated darf Entwuerfe anlegen (id, org_id, week_key) und ausschliesslich ueber den Laufzeitkanal veroeffentlichen; loeschen darf es sie nicht (EYT-107, Befunde F1 und F3).';
