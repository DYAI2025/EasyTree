-- Abraeumen der Reisedaten (EYT-106 AK8, EYT-134).
--
-- Laeuft zweimal: einmal ueber `globalTeardown`, einmal im CI-Job unter
-- `if: always()` — der zweite Lauf faengt den Fall ab, in dem Playwright
-- abstuerzt, bevor sein Teardown an die Reihe kommt. Beide Laeufe muessen
-- `restzeilen=0` melden; der zweite loescht dann nichts mehr.
--
-- Reihenfolge nach Fremdschluesseln, nicht nach Lesbarkeit:
--   employee_rate_versions -> employees        (`on delete restrict`)
--   employee_rate_versions -> public.users     (`created_by`, ohne Aktion)
--   public.users           -> auth.users       (`on delete cascade`)
-- Die Satzversionen muessen also vor den Mitarbeitern UND vor den Benutzern
-- weg.
--
-- Beide Reisenden werden ueber ihre E-Mail getroffen: ihre UUIDs vergibt
-- GoTrue beim Signup und sind hier nicht bekannt. Die Adressen liegen in der
-- reservierten Domain `.test` (RFC 2606) und koennen keiner realen Person
-- gehoeren.

-- ## Warum hier zwei Trigger ausgesetzt werden — und warum das kein Schlupfloch ist
--
-- Die Reise VEROEFFENTLICHT seit EYT-107 eine Planversion. Migration 0010
-- macht veroeffentlichte Zeilen daraufhin unveraenderlich UND unloeschbar:
-- `app.reject_published_row_change()` wirft bei jedem DELETE. Die Migration
-- benennt die Folge sogar ausdruecklich — „sobald eine Organisation eine
-- veroeffentlichte Planversion hat, laeuft ein Loeschen der Organisation in
-- diesen Trigger und scheitert".
--
-- Damit gaebe es genau zwei Moeglichkeiten: die Reise veroeffentlicht nicht
-- (dann beweist sie das Ticket nicht), oder der Teardown hinterlaesst Zeilen
-- (dann ist `restzeilen=0` gelogen). Beides ist schlechter als die dritte:
-- die Invariante fuer die Dauer des Loeschens sichtbar auszusetzen.
--
-- Die Ausnahme ist eng gefasst und pruefbar:
--   * Sie steht in einer TESTdatei, nicht in einer Migration. Die Regel selbst
--     bleibt unveraendert; `supabase/tests/0011_planning_publish.sql` belegt
--     weiterhin, dass sie fuer Anwendungscode gilt.
--   * `alter table` ist in PostgreSQL transaktional. Die beiden Anweisungen
--     stehen deshalb INNERHALB der Transaktion: schlaegt irgendein DELETE
--     fehl, rollt der Abbruch auch die Abschaltung zurueck.
--   * Sie laeuft ausschliesslich ueber `EASYTREE_JOURNEY_ADMIN_DB_URL` gegen
--     die lokale CI-Datenbank, die im selben Job frisch zurueckgesetzt wurde.
--
-- Wer diese Datei gegen eine Datenbank mit echten Plandaten laufen laesst,
-- loescht echte Historie. Deshalb ist sie an die feste Reise-Organisation
-- `…e201` gebunden und nennt keine Variable dafuer.

\set ON_ERROR_STOP on

begin;

alter table public.plan_versions disable trigger plan_versions_published_immutable;
alter table public.assignments disable trigger assignments_published_immutable;

-- Zuweisungen VOR den Mitarbeitern: `assignments.employee_id` zeigt mit
-- `on delete restrict` auf `employees`.
delete from public.assignments
  where org_id = '00000000-0000-4000-8000-00000000e201';
delete from public.plan_versions
  where org_id = '00000000-0000-4000-8000-00000000e201';
-- Kostensnapshots VOR Baustellen, Mitarbeitern und Satzversionen (EYT-144):
-- `cost_snapshot_positions` haengt mit `on delete restrict` an allen dreien,
-- und der Kopf zusaetzlich an der Baustelle. Positionen vor dem Kopf, aus
-- demselben Grund.
--
-- Es braucht hier KEIN ausgesetztes Trigger-Paar wie bei den Planzeilen: die
-- Unveraenderlichkeit der Snapshots ist ueber FEHLENDE Grants gebaut, nicht
-- ueber einen Trigger (Migration 0018). Der Admin-Zugang dieses Teardowns ist
-- Eigentuemer und damit von Grants ohnehin nicht betroffen. Wer das aendert und
-- einen Trigger einzieht, muss diese Stelle mitziehen.
delete from public.cost_snapshot_positions
  where org_id = '00000000-0000-4000-8000-00000000e201';
delete from public.cost_snapshots
  where org_id = '00000000-0000-4000-8000-00000000e201';
delete from public.worksites
  where org_id = '00000000-0000-4000-8000-00000000e201';
delete from public.outbox_messages
  where org_id = '00000000-0000-4000-8000-00000000e201';
delete from public.audit_events
  where org_id = '00000000-0000-4000-8000-00000000e201';
delete from public.idempotency_records
  where org_id = '00000000-0000-4000-8000-00000000e201';
delete from public.employee_rate_versions
  where org_id = '00000000-0000-4000-8000-00000000e201';
delete from public.employees
  where org_id = '00000000-0000-4000-8000-00000000e201';
delete from public.memberships
  where org_id = '00000000-0000-4000-8000-00000000e201';
delete from public.organizations
  where id = '00000000-0000-4000-8000-00000000e201';
delete from public.users
  where id in (select id from auth.users where email in (:'reisender_a', :'reisender_b'));
delete from auth.users
  where email in (:'reisender_a', :'reisender_b');

alter table public.assignments enable trigger assignments_published_immutable;
alter table public.plan_versions enable trigger plan_versions_published_immutable;

commit;

-- Die Nachbedingung zaehlt ALLE SECHS Gegenstaende, ausdruecklich auch die
-- beiden auth- und die beiden public-Benutzer.
--
-- Eine fruehere Fassung zaehlte nur Organisation, Mitgliedschaft, Mitarbeiter
-- und Satzversionen — also gerade nicht die Zeilen, deretwegen dieser
-- Teardown existiert ("sonst bliebe ein anmeldbarer Benutzer im Stack
-- zurueck"). Sie haette `restzeilen=0` gemeldet, waehrend zwei anmeldbare
-- Konten stehen blieben.
--
-- Die Benutzer werden hier ueber das Adressmuster gezaehlt, nicht ueber die
-- beiden Variablen: so faellt auch ein Reisender aus einem frueheren,
-- abgebrochenen Lauf auf, dessen Adresse nicht mehr uebergeben wird.
do $$
declare
  n_auth int;
  n_projektion int;
  n_org int;
  n_mitglied int;
  n_mitarbeiter int;
  n_satz int;
  n_planung int;
  n_kosten int;
  n_wirkung int;
  n_trigger int;
  rest int;
begin
  select count(*) into n_auth from auth.users
    where email like 'auth-journey-%@easytree.test';
  select count(*) into n_projektion from public.users u
    where exists (select 1 from auth.users a
                  where a.id = u.id and a.email like 'auth-journey-%@easytree.test');
  select count(*) into n_org from public.organizations
    where id = '00000000-0000-4000-8000-00000000e201';
  select count(*) into n_mitglied from public.memberships
    where org_id = '00000000-0000-4000-8000-00000000e201';
  select count(*) into n_mitarbeiter from public.employees
    where org_id = '00000000-0000-4000-8000-00000000e201';
  select count(*) into n_satz from public.employee_rate_versions
    where org_id = '00000000-0000-4000-8000-00000000e201';

  -- Seit EYT-107 gehoeren Planungszeilen dazu — gerade die veroeffentlichten,
  -- denn genau die waeren ohne die ausgesetzten Trigger liegengeblieben.
  select count(*) into n_planung from (
    select 1 from public.plan_versions where org_id = '00000000-0000-4000-8000-00000000e201'
    union all
    select 1 from public.assignments where org_id = '00000000-0000-4000-8000-00000000e201'
    union all
    select 1 from public.worksites where org_id = '00000000-0000-4000-8000-00000000e201'
  ) as planung;

  -- Seit EYT-144 erzeugt die Reise einen Kosten-Snapshot. Ohne diese Zaehlung
  -- meldete der Teardown `restzeilen=0`, waehrend Kopf und Positionen liegen
  -- blieben — und der naechste Lauf faende in `eyt144-snapshot-pruefen.sql`
  -- zwei Snapshots statt einem.
  select count(*) into n_kosten from (
    select 1 from public.cost_snapshots where org_id = '00000000-0000-4000-8000-00000000e201'
    union all
    select 1 from public.cost_snapshot_positions
      where org_id = '00000000-0000-4000-8000-00000000e201'
  ) as kosten;

  -- Und die Nebenwirkungen des Veroeffentlichens.
  select count(*) into n_wirkung from (
    select 1 from public.audit_events where org_id = '00000000-0000-4000-8000-00000000e201'
    union all
    select 1 from public.outbox_messages where org_id = '00000000-0000-4000-8000-00000000e201'
    union all
    select 1 from public.idempotency_records where org_id = '00000000-0000-4000-8000-00000000e201'
  ) as wirkung;

  -- Die Trigger MUESSEN wieder scharf sein. Ohne diese Zaehlung koennte ein
  -- abgebrochener Lauf sie stillschweigend abgeschaltet zuruecklassen, und
  -- jede spaetere Suite haette eine Invariante weniger — gruen, aber blind.
  select count(*) into n_trigger from pg_trigger
    where tgname in ('plan_versions_published_immutable', 'assignments_published_immutable')
      and tgenabled = 'O';

  rest := n_auth + n_projektion + n_org + n_mitglied + n_mitarbeiter + n_satz
        + n_planung + n_kosten + n_wirkung;
  if rest <> 0 or n_trigger <> 2 then
    raise exception
      'E2E-Teardown unvollstaendig: auth=% projektion=% org=% membership=% mitarbeiter=% satz=% planung=% kosten=% wirkung=% aktive_trigger=% (erwartet 2)',
      n_auth, n_projektion, n_org, n_mitglied, n_mitarbeiter, n_satz,
      n_planung, n_kosten, n_wirkung, n_trigger;
  end if;
  raise notice
    '[auth-journey-teardown] restzeilen=0 auth=0 projektion=0 org=0 membership=0 mitarbeiter=0 satz=0 planung=0 kosten=0 wirkung=0 trigger=2';
end
$$;
