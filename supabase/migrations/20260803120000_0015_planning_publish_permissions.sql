-- Migration 0015_planning_publish_permissions (EYT-107)
--
-- Veroeffentlichen bekommt ein eigenes Recht — und die Datenbank bekommt eine
-- eigene Meinung dazu.
--
-- Rollback (vorwaerts, als neue Migration; 0015 wird nach dem Merge nicht
-- editiert):
--   drop policy plan_versions_update_in_org on public.plan_versions;
--   create policy plan_versions_update_in_org on public.plan_versions
--     for update to authenticated
--     using (org_id in (select app.user_org_ids()))
--     with check (org_id in (select app.user_org_ids()));
--   delete from public.role_permissions where permission like 'planning.%';
--   drop function app.has_permission(uuid, text);
-- Kein Datenverlust: diese Migration legt keine Tabelle und keine Spalte an,
-- sie ergaenzt eine Funktion, sechs Zuordnungszeilen und verschaerft eine
-- Policy.
--
-- ---------------------------------------------------------------------------
-- Warum eine NEUE Funktion und kein Umbenennen von app.has_cost_permission
-- ---------------------------------------------------------------------------
-- `app.has_cost_permission(uuid, text)` aus 0013 ist im Rumpf bereits
-- generisch — sie vergleicht `rp.permission = p_permission` und weiss nichts
-- von Kosten. Ihr Name ist trotzdem kostenspezifisch, und zwei RLS-Policies in
-- 0013 referenzieren sie. Ein `alter function ... rename` waere eine
-- rueckwirkende Aenderung an einer bereits gemergten Migration (append-only,
-- CLAUDE.md), ein `drop` wuerde die beiden Policies mitreissen.
--
-- Deshalb: `app.has_permission` entsteht daneben. Die Doppelung ist bewusst und
-- benannt — sie kostet eine Funktion und erspart eine Aenderung an bestehenden
-- Policies. Wer sie spaeter zusammenfuehrt, ersetzt zuerst die beiden
-- 0013-Policies und entfernt die alte Funktion danach, in EINER Migration.
--
-- ---------------------------------------------------------------------------
-- Warum plan_versions.published_at bisher jedem Mitglied offenstand
-- ---------------------------------------------------------------------------
-- 0007 vergibt `grant select, insert, update, delete on plan_versions to
-- authenticated` und eine Update-Policy, die AUSSCHLIESSLICH die Organisation
-- prueft. 0010 hat danach `assignments.published_at` per Spalten-Grant
-- geschuetzt — plan_versions aber nicht, weil es dort kein Recht gab, auf das
-- man haette pruefen koennen.
--
-- Damit konnte bis heute jedes aktive Mitglied einer Organisation eine
-- Planversion veroeffentlichen, sobald es die API umging. Der Sync-Trigger aus
-- 0010 haette die Zuweisungen bereitwillig mitgestempelt. Diese Migration
-- schliesst das: ab hier verlangt die Update-Policy `planning.publish`.
--
-- Das ist die zweite Haelfte der Unabhaengigkeitszusage (dieselbe Bauart wie
-- AK4 in EYT-106): schaltet man die Anwendungs-Policy auf „immer erlaubt",
-- muss die Datenbank weiterhin ablehnen.

-- ---------------------------------------------------------------------------
-- 1. app.has_permission — dieselbe Frage wie 0013, ohne Modulnamen
-- ---------------------------------------------------------------------------
create or replace function app.has_permission(p_org_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.memberships m
      join public.role_permissions rp on rp.role = m.role
     where m.org_id = p_org_id
       and m.user_id = auth.uid()
       and m.active
       and rp.permission = p_permission
  );
$$;

comment on function app.has_permission(uuid, text) is
  'Wahr, wenn die aufrufende Identitaet eine AKTIVE Mitgliedschaft in p_org_id hat und deren Rolle p_permission traegt. security definer, damit die Policy nicht auf memberships rekursiert. Modulunabhaengige Nachfolgerin von app.has_cost_permission (EYT-107).';

revoke all on function app.has_permission(uuid, text) from public;
grant execute on function app.has_permission(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Rollenmatrix der Planung (Product-Owner-Entscheidung 03.08.2026)
-- ---------------------------------------------------------------------------
--   owner    -> read, write, publish
--   manager  -> read, write, publish
--   member   -> KEINE Zeile
--
-- `member` bekommt bewusst nichts: Mitarbeitende sehen ihre eigenen Einsaetze
-- ueber die Mitarbeitersicht (EYT-14, noch nicht gebaut), nicht ueber die
-- Planungsansicht der Leitung. Dieselbe Begruendung wie bei den Kostenrechten
-- in 0013.
--
-- `planning.publish` ist ein EIGENES Recht und wird von `planning.write` NICHT
-- impliziert. Wer einen Entwurf bearbeiten darf, darf ihn deshalb nicht
-- automatisch verbindlich machen — die Trennung ist der ganze Zweck des
-- dritten Eintrags.
insert into public.role_permissions (role, permission) values
  ('owner',   'planning.read'),
  ('owner',   'planning.write'),
  ('owner',   'planning.publish'),
  ('manager', 'planning.read'),
  ('manager', 'planning.write'),
  ('manager', 'planning.publish');

-- ---------------------------------------------------------------------------
-- 3. Veroeffentlichen verlangt das Recht — auch an der API vorbei
-- ---------------------------------------------------------------------------
-- `using` entscheidet, WELCHE Zeile geaendert werden darf; `with check`
-- entscheidet, WIE sie danach aussehen darf.
--
-- Im `with check` steht bewusst NICHT noch einmal `has_permission`: die
-- Bedingung ist bereits ueber `using` erfuellt, und eine zweite Auswertung
-- derselben security-definer-Funktion je Zeile kostet nur.
--
-- `published_by is null or published_by = auth.uid()` ist die Urheberzusage:
-- entweder die Zeile bleibt unveroeffentlicht, oder sie nennt als Urheber
-- genau die aufrufende Identitaet. Ein Client kann damit keine fremde Person
-- als Veroeffentlichende eintragen. Der Check
-- `plan_versions_publication_complete` aus 0007 verlangt ohnehin, dass
-- published_at und published_by gemeinsam gesetzt werden.
drop policy plan_versions_update_in_org on public.plan_versions;

create policy plan_versions_update_in_org on public.plan_versions
  for update to authenticated
  using (
    org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.publish')
  )
  with check (
    org_id in (select app.user_org_ids())
    and (published_by is null or published_by = auth.uid())
  );

comment on table public.plan_versions is
  'Planversion je Organisation und ISO-Woche (EYT-86). published_at ist die autoritative Veroeffentlichungsmarke; assignments.published_at wird davon abgeleitet und atomar mitgesetzt (EYT-49). Ein UPDATE verlangt seit EYT-107 das Recht planning.publish und darf published_by nur auf die aufrufende Identitaet setzen.';
