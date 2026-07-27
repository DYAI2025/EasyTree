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

-- Gueltigkeit gegen die Laufzeit-Zeitzonendatenbank pruefen, nicht gegen eine
-- eigene Liste: pg_timezone_names ist die einzige Quelle, die weiss, welche
-- Zonen dieser Server kennt. Eine gepflegte Liste waere sofort veraltet.
alter table public.organizations
  add constraint organizations_time_zone_known
  check (time_zone in (select name from pg_timezone_names)) not valid;

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
