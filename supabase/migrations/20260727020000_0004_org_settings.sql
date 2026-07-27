-- Migration 0004_org_settings (EYT-86)
-- Zeitzone je Organisation + RLS auf der Mandantenwurzel.
-- Schemaquelle: AUSSCHLIESSLICH Migrationen in supabase/migrations/.
--
-- Rollback: forward-fix. Ein Rueckbau setzt eine neue Migration auf, die
-- Policy und Spalte wieder entfernt; die gemergte Datei bleibt unangetastet
-- (append-only, CLAUDE.md). Datenverlust: time_zone je Organisation.

-- ---------------------------------------------------------------------------
-- Befund, den diese Migration behebt
-- ---------------------------------------------------------------------------
-- public.organizations wird in 0001_foundation.sql angelegt und bekommt danach
-- NIE `enable row level security`, nie `force`, nie eine Policy, keinen Grant
-- und keinen revoke. Sie fehlt auch in den RLS-Zusicherungen von
-- supabase/tests/0002_rls_isolation.sql. Die Mandantenwurzel ist damit die
-- einzige Tabelle ohne Zugriffsregel.
--
-- Praktisch war sie dadurch fuer die Anwendung UNLESBAR, nicht offen: laut
-- 0002_tenancy.sql geben die Supabase-Default-Privilegien `authenticated` auf
-- neuen Tabellen kein DML. Das ist fail-closed und deshalb kein Leck — aber es
-- ist auch unbelegt, und die Anwendung muss ihre eigene Zeitzone lesen koennen.
-- Das Metagate in supabase/tests/0005_schema_meta_gate.sql misst den Zustand,
-- statt ihn anzunehmen.

alter table public.organizations
  add column if not exists time_zone text;

-- Zwei Schritte statt einem: die Spalte muss existieren und gefuellt sein,
-- bevor NOT NULL greifen kann. Auf einem frischen Reset gibt es null Zeilen —
-- das update ist dann wirkungslos und der Default traegt spaetere Inserts.
-- (Migrationen laufen VOR seed.sql, siehe docs/runbooks/database-workflow.md.)
update public.organizations set time_zone = 'Europe/Berlin' where time_zone is null;

alter table public.organizations
  alter column time_zone set default 'Europe/Berlin';

alter table public.organizations
  alter column time_zone set not null;

-- ---------------------------------------------------------------------------
-- Gueltigkeit der Zeitzone
-- ---------------------------------------------------------------------------
-- Geprueft wird gegen die Laufzeit-Zeitzonendatenbank, nicht gegen eine eigene
-- Liste: pg_timezone_names ist die einzige Quelle, die weiss, welche Zonen
-- DIESER Server kennt. Eine gepflegte Liste waere sofort veraltet.
--
-- Warum ein Trigger und keine CHECK-Constraint: eine CHECK-Constraint darf
-- weder eine Subquery enthalten noch eine andere Relation lesen. Der erste
-- Entwurf dieser Migration versuchte genau das und scheiterte in CI mit
--   ERROR: cannot use subquery in check constraint (SQLSTATE 0A000)
-- Das ist keine Formalie: PostgreSQL verlangt, dass eine CHECK-Constraint
-- allein aus der Zeile entscheidbar ist, damit sie bei jedem Restore und jeder
-- Revalidierung dasselbe Ergebnis liefert.
--
-- Ein IMMUTABLE markierter Wrapper waere der naheliegende Trick und waere
-- FALSCH: die Zeitzonendatenbank aendert sich mit dem Serverpaket. Eine
-- Volatilitaetsluege laesst PostgreSQL Ergebnisse zwischenspeichern und in
-- Indizes einbacken.
--
-- Was der Trigger dadurch NICHT kann, und was die weggefallene Constraint
-- ebenfalls nicht konnte (sie war `not valid`): BESTEHENDE Zeilen pruefen. Er
-- greift ab jetzt, fuer insert und fuer jedes update, das time_zone anfasst.
--
-- Kein security definer: die Funktion liest nur einen fuer alle lesbaren
-- Katalog und braucht keine fremden Rechte. search_path ist fixiert, deshalb
-- ist pg_timezone_names voll qualifiziert.
create or replace function app.assert_known_time_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.time_zone
  ) then
    -- 23514 (check_violation) ist bewusst gewaehlt: fuer den Aufrufer ist das
    -- eine verletzte Invariante wie jede andere. Ein Fehlercode, den nur diese
    -- Stelle kennt, wuerde die Anwendung zwingen, den Trigger zu kennen.
    raise exception 'Unbekannte IANA-Zeitzone: %', new.time_zone
      using errcode = '23514';
  end if;
  return new;
end
$$;

comment on function app.assert_known_time_zone() is
  'Prueft organizations.time_zone gegen pg_timezone_names (EYT-86). Trigger statt CHECK, weil eine CHECK-Constraint keine Relation lesen darf.';

revoke all on function app.assert_known_time_zone() from public;

create trigger organizations_time_zone_known
  before insert or update of time_zone on public.organizations
  for each row
  execute function app.assert_known_time_zone();

comment on column public.organizations.time_zone is
  'IANA-Zeitzone der Organisation (EYT-86). Traegt die Wochen- und Geschaeftstagsabgrenzung aus EYT-74; packages/domain/src/planning-week.ts erwartet sie als expliziten Parameter.';

-- ---------------------------------------------------------------------------
-- RLS auf der Mandantenwurzel
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.organizations force row level security;

revoke all on table public.organizations from anon;

-- Nur select: Organisationen anzulegen oder umzubenennen ist kein Self-Service.
grant select on table public.organizations to authenticated;

create policy organizations_select_own on public.organizations
  for select to authenticated
  using (id in (select app.user_org_ids()));

comment on table public.organizations is
  'Mandant. Nicht tenant-owned (sie IST der Mandant, daher kein org_id). RLS seit EYT-86: sichtbar nur die eigenen aktiven Organisationen.';
