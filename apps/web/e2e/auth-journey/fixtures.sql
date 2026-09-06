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
-- Der kanonische Mitarbeiter OHNE Stundensatz (EYT-142)
-- ---------------------------------------------------------------------------
-- Die Satz-fehlt-Negativreise der Staging-Kernreise braucht einen AKTIVEN
-- Mitarbeiter mit exakt NULL Satzversionen: nur mit ihm ist die typisierte
-- 409-Ablehnung (`urn:easytree:costs:rate-not-found`) reproduzierbar. Vor
-- dieser Zeile war er reiner Umgebungszustand des Staging-Stacks — ein
-- frischer Aufbau haette ihn erraten muessen. Jetzt ist er Fixture-Wahrheit:
-- feste UUID in der `…e2xx`-Konvention, kanonischer Anzeigename, und die
-- Staging-Harness (`apps/web/e2e/staging/harness-wachen.ts`) kennt genau
-- diesen Namen als Vorgabewert.
--
-- `do update` statt `do nothing`, und zwar mit Absicht: auf einem Stack, auf
-- dem die UUID schon existiert (der reale Staging-Stack vom 25.08.2026),
-- konvergiert ein erneuter Fixture-Lauf Anzeigename und Aktiv-Status auf den
-- kanonischen Stand, statt einen abweichenden Altnamen stehen zu lassen.
-- Einen Satz bekommt er hier NIE — das prueft der Block unten nach.
insert into public.employees (id, org_id, user_id, display_name, active)
values ('00000000-0000-4000-8000-00000000e212',
        '00000000-0000-4000-8000-00000000e201',
        null, 'E2E-Mitarbeiter Ohne Satz', true)
on conflict (id) do update
  set display_name = excluded.display_name, active = excluded.active;

-- ---------------------------------------------------------------------------
-- Der dritte Mitarbeiter fuer das Einsatzteam (EYT-158)
-- ---------------------------------------------------------------------------
-- Die Reise legt einen Baustellentag worksite-first mit DREI Personen in EINEM
-- Command an (Akzeptanzkriterium „mindestens drei Testmitarbeiter"). e211 und
-- e212 allein waeren zwei. Bewusst OHNE Stundensatz und ohne Einplanung in
-- W32/W33: er beruehrt weder die abgenommenen Kostensummen noch die
-- Satz-fehlt-Reise — e212 bleibt der kanonische Satz-fehlt-Mitarbeiter, und
-- `satz_ohne` unten zaehlt weiterhin ausschliesslich ihn.
insert into public.employees (id, org_id, user_id, display_name, active)
values ('00000000-0000-4000-8000-00000000e214',
        '00000000-0000-4000-8000-00000000e201',
        null, 'E2E-Mitarbeiter Team Drei', true)
on conflict (id) do update
  set display_name = excluded.display_name, active = excluded.active;

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

-- ---------------------------------------------------------------------------
-- Der Baustellenfilter (EYT-146): EIGENE Woche, EIGENE Planversion
-- ---------------------------------------------------------------------------
-- Bewusst NICHT an `2026-W32` angehaengt. Eine zweite Zuweisung dort veraenderte
-- den Betrag der Reise, und die von EYT-144 abgenommenen Zahlen
-- (`ERWARTETE_KOSTEN_MINOR`, `positionen=1`) muessten neu geschrieben werden,
-- nur damit dieser Nachweis Platz findet. Ein Nachweis, der einen bereits
-- abgenommenen umschreibt, ist ein schlechter Nachweis.
--
-- `2026-W33` ist frei: W32 gehoert der Reise, W35 dem Schritt 9c3, W36/W37 den
-- beiden Angriffswochen von EYT-136. Ein Entwurf je Woche und Organisation ist
-- die geltende Invariante — deshalb eine eigene Woche und keine zweite Version
-- in W32.
--
-- `2026-08-10T06:00:00Z` ist in `Europe/Berlin` Montag der ISO-Woche 33, 08:00.
--
-- ZWEI Baustellen, EIN Mitarbeiter, und die Zeitraeume ueberschneiden sich
-- ausdruecklich nicht: EYT-49 verbietet ueberlappende veroeffentlichte
-- Zuweisungen derselben Person, und das Veroeffentlichen liefe sonst in genau
-- diese Invariante — rot an der falschen Stelle und mit der falschen
-- Begruendung. Je vier Stunden am selben lokalen Tag ergeben mit dem Startsatz
-- (4250) je 17000 Minor Units.
--
-- Die Version entsteht wieder als ENTWURF: die Reise soll auch hier den
-- Uebergang selbst ausloesen, ueber den echten Publish-Endpunkt.
insert into public.worksites (id, org_id, name, active)
values ('00000000-0000-4000-8000-00000000e242',
        '00000000-0000-4000-8000-00000000e201',
        'E2E-Baustelle Filter B', true)
on conflict (id) do nothing;

insert into public.plan_versions (id, org_id, week_key)
values ('00000000-0000-4000-8000-00000000e252',
        '00000000-0000-4000-8000-00000000e201',
        '2026-W33')
on conflict (id) do nothing;

insert into public.assignments
  (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
values ('00000000-0000-4000-8000-00000000e262',
        '00000000-0000-4000-8000-00000000e201',
        '00000000-0000-4000-8000-00000000e252',
        '00000000-0000-4000-8000-00000000e211',
        '00000000-0000-4000-8000-00000000e241',
        '2026-08-10T06:00:00Z', '2026-08-10T10:00:00Z'),
       ('00000000-0000-4000-8000-00000000e263',
        '00000000-0000-4000-8000-00000000e201',
        '00000000-0000-4000-8000-00000000e252',
        '00000000-0000-4000-8000-00000000e211',
        '00000000-0000-4000-8000-00000000e242',
        '2026-08-10T11:00:00Z', '2026-08-10T15:00:00Z')
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
  n_satz_ohne int;
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
  -- Die definierende Eigenschaft des Satz-fehlt-Mitarbeiters, ausdruecklich
  -- und je Mitarbeiter gezaehlt: NULL Satzversionen. Der org-weite Zaehler
  -- allein bewiese das nur, solange niemand eine weitere Version einspielt.
  select count(*) into n_satz_ohne from public.employee_rate_versions
    where employee_id = '00000000-0000-4000-8000-00000000e212';
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
  --
  -- Seit EYT-146 zwei Baustellen, zwei Planversionen (beide Entwurf) und drei
  -- Zuweisungen: eine in W32 fuer die Reise, zwei in W33 fuer den
  -- Baustellenfilter. Seit EYT-142 zwei Mitarbeiter: e211 mit genau einer
  -- Satzversion, e212 mit exakt NULL — `satz_ohne=0` ist die definierende
  -- Eigenschaft der Satz-fehlt-Reise und wird hier fail-closed nachgerechnet.
  -- Seit EYT-158 DREI: e214 ohne Satz und ohne Einplanung, nur als drittes
  -- Teammitglied des Baustellentag-Nachweises.
  -- Die Zahlen stehen ausgeschrieben und nicht als „>= 1",
  -- damit eine versehentlich doppelt eingespielte Fixtur auffaellt statt den
  -- Betrag eines Snapshots still zu verdoppeln.
  if n_mitglied <> 1 or n_mitarbeiter <> 3 or n_satz <> 1 or n_satz_ohne <> 0
     or n_projektion <> 2
     or n_baustelle <> 2 or n_version <> 2 or n_entwurf <> 2 or n_zuweisung <> 3 then
    raise exception
      'E2E-Fixture unvollstaendig: membership=% mitarbeiter=% satz=% satz_ohne=% projektionen=% baustelle=% version=% entwurf=% zuweisung=% (erwartet 1/3/1/0/2/2/2/2/3)',
      n_mitglied, n_mitarbeiter, n_satz, n_satz_ohne, n_projektion,
      n_baustelle, n_version, n_entwurf, n_zuweisung;
  end if;
  raise notice '[auth-journey-fixture] projektionen=% membership=% mitarbeiter=% satz=% satz_ohne=% baustelle=% entwurf=% zuweisung=%',
    n_projektion, n_mitglied, n_mitarbeiter, n_satz, n_satz_ohne, n_baustelle, n_entwurf, n_zuweisung;
end
$$;
