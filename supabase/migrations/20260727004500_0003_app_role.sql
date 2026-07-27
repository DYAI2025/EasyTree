-- Migration 0003_app_role (EYT-45)
-- Eigene Laufzeitrolle ohne RLS-Umgehung.
-- Schemaquelle: AUSSCHLIESSLICH Migrationen in supabase/migrations/.

-- ---------------------------------------------------------------------------
-- Warum diese Migration existiert
-- ---------------------------------------------------------------------------
-- ADR-001 Z. 85: "Normale Runtime-Credentials duerfen RLS nicht umgehen."
--
-- Bis hierher tat die Anwendung genau das. Jede DATABASE_URL im Repository
-- verwendet die Login-Rolle `postgres` (.env.example, .github/workflows/ci.yml),
-- und `apps/api/src/app.module.ts` reicht sie unveraendert an die Laufzeit.
-- `postgres` ist Superuser; Superuser umgehen Row Level Security vollstaendig.
-- Die Policies aus 0002_tenancy.sql waren fuer die Anwendung damit wirkungslos.
-- Die Tenant-Tests beweisen sie nur, weil sie ausdruecklich
-- `set local role authenticated` setzen — die Anwendung tat das nirgends.
--
-- Der Kommentar in 0002_tenancy.sql sagt es bereits selbst: FORCE RLS greift
-- erst, "sobald der Owner kein BYPASSRLS-Attribut traegt".
--
-- Kein TypeScript-Konstrukt kann das beheben. Es braucht eine andere Rolle.

-- ---------------------------------------------------------------------------
-- Idempotente Anlage
-- ---------------------------------------------------------------------------
-- Rollen sind CLUSTER-weit, nicht datenbankweit. `supabase db reset` baut die
-- Datenbank neu auf, laesst die Rollen aber stehen. Ein nacktes `create role`
-- wuerde deshalb beim ZWEITEN Reset mit "role already exists" scheitern — und
-- genau zwei aufeinanderfolgende Resets sind die Definition of Done fuer
-- Migrationen in diesem Repository (docs/runbooks/database-workflow.md).
--
-- `alter` im else-Zweig ist kein Beiwerk: es korrigiert eine Rolle, die von
-- einem frueheren Lauf mit anderen Attributen zurueckgeblieben ist.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'easytree_app') then
    create role easytree_app
      login
      noinherit
      nosuperuser
      nobypassrls
      nocreatedb
      nocreaterole
      noreplication;
  else
    alter role easytree_app
      login
      noinherit
      nosuperuser
      nobypassrls
      nocreatedb
      nocreaterole
      noreplication;
  end if;
end
$$;

comment on role easytree_app is
  'Laufzeitrolle von API und Worker (EYT-45). NOINHERIT: ohne "set local role authenticated" hat sie KEINE Tabellenrechte. NOBYPASSRLS/NOSUPERUSER: RLS gilt.';

-- ---------------------------------------------------------------------------
-- NOINHERIT ist die eigentliche Sicherung
-- ---------------------------------------------------------------------------
-- Mitgliedschaft in `authenticated` allein wuerde die Rechte automatisch
-- vererben — eine Query ohne gesetzten Tenantkontext haette dann trotzdem
-- Tabellenzugriff, und die Kontextsetzung waere eine Konvention.
--
-- Mit NOINHERIT gilt das Gegenteil: `easytree_app` besitzt vor dem expliziten
-- `set local role authenticated` KEINE Rechte auf public.*. Eine Query vor der
-- Kontextsetzung scheitert mit "permission denied", nicht mit stillen
-- Volldaten. Fail-closed auf Datenbankebene statt im Anwendungscode.
grant authenticated to easytree_app;

grant connect on database postgres to easytree_app;

-- Der Startcheck der Anwendung liest die eigenen Rollenattribute. pg_roles ist
-- fuer public lesbar; der Grant steht hier nur zur Dokumentation der Absicht.
grant usage on schema pg_catalog to easytree_app;

-- ---------------------------------------------------------------------------
-- Was diese Migration NICHT tut
-- ---------------------------------------------------------------------------
-- Kein Passwort. Ein Passwort in einer Migration liegt in git und ist damit
-- kein Geheimnis mehr (CLAUDE.md: Umgebungsdateien werden nie committet).
-- Die Authentifizierung wird ausserhalb bereitgestellt:
--   lokal/CI  -> `alter role easytree_app password '...'` als eigener Schritt
--   produktiv -> Secret Manager, nie im Repository
--
-- Kein Entzug der Rolle `postgres`. Migrationen, Supabase-interne Jobs und die
-- pgTAP-Suite brauchen sie weiterhin. Diese Migration aendert, womit die
-- ANWENDUNG verbindet, nicht womit das Werkzeug verbindet.
