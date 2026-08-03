-- Anwendungsdaten der realen Auth-Kostenreise (EYT-106 AK8, EYT-134).
--
-- ## Zwei Benutzer, weil ein Benutzer nichts beweist
--
-- Benutzer A ist Owner der Reiseorganisation und sieht die Kosten.
-- Benutzer B ist ein ECHTER, angemeldeter Benutzer OHNE jede Mitgliedschaft.
--
-- Der A/B-Aufbau ersetzt eine frühere Zusicherung, die nichts unterschied: sie
-- prüfte, dass ein Aufruf OHNE Anmeldung 401 liefert, und behauptete, der
-- Testharness lieferte dort 200. Gemessen am 02.08.2026 stimmt das nicht — der
-- Harness ersetzt nur `TENANT_SUBJECT_RESOLVER` (einziger Verbraucher:
-- `planning.controller.ts`) und die Planungs-Policy, nicht `REQUEST_IDENTITY`,
-- an dem der Kostencontroller haengt. Er liefert dort ebenfalls 401.
--
-- B unterscheidet dagegen wirklich: eine eingeschleuste feste Identitaet wuerde
-- B zu A machen, und genau das faellt auf, weil Bs Sitzung Bs eigene Id nennen
-- und der Kostenpfad ihn trotzdem ablehnen muss.
--
-- ## Was hier NICHT passiert
--
-- `auth.users` legt GoTrue an, ueber den oeffentlichen Signup — kein
-- Service-Role-Schluessel, keine Admin-API, kein direktes Insert. Die
-- Begruendung steht in `global-setup.ts`.
--
-- `:benutzer_a` und `:benutzer_b` sind die von GoTrue vergebenen UUIDs und
-- kommen als psql-Variablen herein. Alles andere hat feste IDs, damit
-- `teardown.sql` genau diese Zeilen trifft.

\set ON_ERROR_STOP on

begin;

-- Projektionen fuer BEIDE Benutzer. B braucht sie, damit seine Sitzung
-- aufloest — er ist ein vollwertiger Benutzer, nur ohne Mitgliedschaft.
insert into public.users (id, display_name)
values (:'benutzer_a', 'E2E-Reisender A'),
       (:'benutzer_b', 'E2E-Reisender B ohne Mitgliedschaft')
on conflict (id) do nothing;

insert into public.organizations (id, name)
values ('00000000-0000-4000-8000-00000000e201', 'E2E Reiseorganisation')
on conflict (id) do nothing;

-- NUR fuer A. B bekommt bewusst keine Zeile — das ist der ganze Nachweis.
insert into public.memberships (id, org_id, user_id, role, active)
values ('00000000-0000-4000-8000-00000000e221',
        '00000000-0000-4000-8000-00000000e201',
        :'benutzer_a', 'owner', true)
on conflict (org_id, user_id) do update set role = 'owner', active = true;

insert into public.employees (id, org_id, user_id, display_name, active)
values ('00000000-0000-4000-8000-00000000e211',
        '00000000-0000-4000-8000-00000000e201',
        null, 'E2E-Mitarbeiter Reise', true)
on conflict (id) do nothing;

insert into public.employee_rate_versions
  (id, org_id, employee_id, amount_minor_units, currency, valid_from, valid_to,
   predecessor_id, reason, created_by, correlation_id)
values ('00000000-0000-4000-8000-00000000e231',
        '00000000-0000-4000-8000-00000000e201',
        '00000000-0000-4000-8000-00000000e211',
        4250, 'EUR', date '2026-01-01', null,
        null, 'Startsatz der E2E-Reise',
        :'benutzer_a',
        'e2e-auth-journey')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Planungsdaten fuer die Publish-Reise (EYT-107)
-- ---------------------------------------------------------------------------
-- Ohne sie zeigte `/planung` eine leere Woche, und der Publish-Nachweis haette
-- nichts zu veroeffentlichen.
--
-- Die Zeiten liegen bewusst IN der Woche 2026-W32: `06:00Z` ist in
-- `Europe/Berlin` (Vorgabe der Organisation, Migration 0004) der Montag
-- 03.08.2026, 08:00. Der Publish-Pfad prueft seit EYT-107 genau das — das
-- Schema tut es nicht, denn `plan_versions.week_key` ist mit keinem
-- Zeitstempel verknuepft (offene Luecke aus EYT-49).
--
-- Die Planversion entsteht als ENTWURF (`published_at` bleibt NULL). Sie hier
-- schon veroeffentlicht anzulegen wuerde den Nachweis vorwegnehmen: die Reise
-- soll den Uebergang selbst ausloesen.
insert into public.worksites (id, org_id, name, active)
values ('00000000-0000-4000-8000-00000000e241',
        '00000000-0000-4000-8000-00000000e201',
        'E2E-Baustelle Reise', true)
on conflict (id) do nothing;

insert into public.plan_versions (id, org_id, week_key)
values ('00000000-0000-4000-8000-00000000e251',
        '00000000-0000-4000-8000-00000000e201',
        '2026-W32')
on conflict (id) do nothing;

insert into public.assignments
  (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
values ('00000000-0000-4000-8000-00000000e261',
        '00000000-0000-4000-8000-00000000e201',
        '00000000-0000-4000-8000-00000000e251',
        '00000000-0000-4000-8000-00000000e211',
        '00000000-0000-4000-8000-00000000e241',
        '2026-08-03T06:00:00Z', '2026-08-03T14:00:00Z')
on conflict (id) do nothing;

commit;

-- Nachrechnen statt behaupten. Bewusst OHNE psql-Variable im Block: innerhalb
-- eines dollar-quotierten Blocks ersetzt psql `:'name'` NICHT, der Block liefe
-- mit dem Literaltext und scheiterte mit einem irrefuehrenden Syntaxfehler.
do $$
declare
  n_mitglied int;
  n_mitarbeiter int;
  n_satz int;
  n_projektion int;
  n_baustelle int;
  n_version int;
  n_entwurf int;
  n_zuweisung int;
begin
  select count(*) into n_mitglied from public.memberships
    where org_id = '00000000-0000-4000-8000-00000000e201' and role = 'owner' and active;
  select count(*) into n_mitarbeiter from public.employees
    where org_id = '00000000-0000-4000-8000-00000000e201';
  select count(*) into n_satz from public.employee_rate_versions
    where org_id = '00000000-0000-4000-8000-00000000e201';
  select count(*) into n_projektion from public.users u
    where exists (select 1 from auth.users a where a.id = u.id
                  and a.email like 'auth-journey-%@easytree.test');
  select count(*) into n_baustelle from public.worksites
    where org_id = '00000000-0000-4000-8000-00000000e201';
  select count(*) into n_version from public.plan_versions
    where org_id = '00000000-0000-4000-8000-00000000e201';
  -- Ausdruecklich als ENTWURF: ein bereits veroeffentlichter Stand haette den
  -- Publish-Nachweis vorweggenommen und die Reise waere vakuos gewesen.
  select count(*) into n_entwurf from public.plan_versions
    where org_id = '00000000-0000-4000-8000-00000000e201' and published_at is null;
  select count(*) into n_zuweisung from public.assignments
    where org_id = '00000000-0000-4000-8000-00000000e201';

  -- Genau EINE Mitgliedschaft: haette B eine, waere der Negativnachweis wertlos.
  if n_mitglied <> 1 or n_mitarbeiter <> 1 or n_satz <> 1 or n_projektion <> 2
     or n_baustelle <> 1 or n_version <> 1 or n_entwurf <> 1 or n_zuweisung <> 1 then
    raise exception
      'E2E-Fixture unvollstaendig: membership=% mitarbeiter=% satz=% projektionen=% baustelle=% version=% entwurf=% zuweisung=% (erwartet 1/1/1/2/1/1/1/1)',
      n_mitglied, n_mitarbeiter, n_satz, n_projektion,
      n_baustelle, n_version, n_entwurf, n_zuweisung;
  end if;
  raise notice '[auth-journey-fixture] projektionen=% membership=% mitarbeiter=% satz=% baustelle=% entwurf=% zuweisung=%',
    n_projektion, n_mitglied, n_mitarbeiter, n_satz, n_baustelle, n_entwurf, n_zuweisung;
end
$$;
