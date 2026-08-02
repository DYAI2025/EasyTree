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

\set ON_ERROR_STOP on

begin;

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

  rest := n_auth + n_projektion + n_org + n_mitglied + n_mitarbeiter + n_satz;
  if rest <> 0 then
    raise exception
      'E2E-Teardown unvollstaendig: auth=% projektion=% org=% membership=% mitarbeiter=% satz=%',
      n_auth, n_projektion, n_org, n_mitglied, n_mitarbeiter, n_satz;
  end if;
  raise notice
    '[auth-journey-teardown] restzeilen=0 auth=0 projektion=0 org=0 membership=0 mitarbeiter=0 satz=0';
end
$$;
