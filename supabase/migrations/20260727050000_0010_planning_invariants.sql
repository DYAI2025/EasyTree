-- Migration 0010_planning_invariants (EYT-49)
-- Zeit- und Revisionsinvarianten der Planung als SQL-Vertraege.
-- Schemaquelle: AUSSCHLIESSLICH Migrationen in supabase/migrations/.
--
-- Rollback: forward-fix. Ein Rueckbau setzt eine neue Migration auf, die
-- Constraint, Trigger und Funktionen wieder entfernt und das Tabellen-Grant
-- `update` auf assignments zurueckgibt. Kein Datenverlust — diese Migration
-- legt keine Spalte und keine Tabelle an, sie schraenkt nur ein.
--
-- ---------------------------------------------------------------------------
-- Was hier NICHT entsteht, und warum
-- ---------------------------------------------------------------------------
-- EYT-49 nennt sechs Akzeptanzkriterien. Drei davon brauchen Tabellen, die es
-- in diesem Schema nicht gibt und die bewusst nicht hier entstehen:
--
--   AK "Exklusive Ressourcen nicht doppelt reserviert"  -> braucht `resources`
--   AK "hoechstens ein aktiver Timer je Mitarbeiter"    -> braucht `time_entries`
--   AK "Korrekturen erhalten Original, Grund, Akteur"   -> braucht Korrekturen
--
-- time_entries und Korrekturen sind die persoenlichsten Tabellen des Produkts.
-- Sie jetzt anzulegen hiesse, sie bis EYT-14 organisationsweit les- UND
-- schreibbar zu machen — dieselbe Begruendung, aus der sie schon aus EYT-86
-- herausgehalten wurden. Ein Constraint ueber eine Tabelle, die es nicht gibt,
-- laesst sich nicht schreiben; ihn hier "vorzubereiten" waere eine Zusage ohne
-- Gegenstand.

-- ---------------------------------------------------------------------------
-- 1. Veroeffentlichte Intervalle derselben Person ueberschneiden sich nicht
-- ---------------------------------------------------------------------------
-- Das ist der Kern von EYT-49 AK1. Ein unique-Index kann es nicht: gesucht ist
-- Gleichheit auf zwei Spalten UND Ueberlappung auf einer Range. Genau dafuer
-- existiert EXCLUDE, und genau dafuer hat 0009 btree_gist installiert — ohne
-- das Extension-Modul kennt gist keinen `=`-Operator fuer uuid.
--
-- `where (published_at is not null)` ist Absicht: ENTWUERFE duerfen sich
-- ueberschneiden. Genau das ist der Zweck eines Entwurfs. Verboten ist der
-- Konflikt erst in dem, was als verbindlich veroeffentlicht wurde.
--
-- `during` ist halboffen '[)' (0007), deshalb ist ein Baustellenwechsel um
-- 12:00 kein Konflikt — dieselbe Regel wie packages/domain/src/time-interval.ts.
--
-- Die uuid-Operatorklassen sind schemaqualifiziert, weil 0009 btree_gist nach
-- `extensions` installiert. Unqualifiziert haengt die Aufloesung der
-- DEFAULT-Operatorklasse am search_path des Migrationslaufs — eine Annahme
-- ueber fremde Konfiguration, die hier nichts zu suchen hat. `during` bleibt
-- unqualifiziert: range_ops fuer tstzrange ist eingebaut (pg_catalog).
alter table public.assignments
  add constraint assignments_no_published_overlap
  exclude using gist (
    org_id extensions.gist_uuid_ops with =,
    employee_id extensions.gist_uuid_ops with =,
    during with &&
  ) where (published_at is not null);

comment on constraint assignments_no_published_overlap on public.assignments is
  'EYT-49 AK1: dieselbe Person kann nicht zweimal gleichzeitig veroeffentlicht verplant sein. Entwuerfe sind bewusst ausgenommen.';

-- ---------------------------------------------------------------------------
-- 2. published_at auf assignments ist abgeleitet, nicht gesetzt
-- ---------------------------------------------------------------------------
-- Ohne diese Einschraenkung waere Punkt 1 umgehbar, und zwar trivial: wer
-- `published_at` selbst auf NULL setzen darf, nimmt eine Zeile aus dem
-- Geltungsbereich des partiellen EXCLUDE heraus und kann danach beliebig
-- ueberlappend "veroeffentlichen". Der Constraint waere dann eine Bitte.
--
-- Die Tabellen-Grants `update` UND `insert` fallen deshalb weg und werden
-- durch Spalten-Grants ersetzt. `insert` mitzunehmen ist nicht Symmetrie
-- um ihrer selbst willen: bliebe es stehen, koennte ein Client den Marker
-- beim ANLEGEN mitliefern. Die Zeile naehme sofort am EXCLUDE teil, waere
-- durch Punkt 4 unveraenderlich und unloeschbar, und die spaetere echte
-- Veroeffentlichung ihrer Planversion scheiterte an einem Wert, den niemand
-- mehr entfernen kann.
--
-- Nicht enthalten sind in beiden Faellen:
--   published_at  — abgeleitet aus plan_versions (siehe 3.)
--   created_at    — Herkunft, nicht Nutzdatum
--   during        — generiert
-- und beim update zusaetzlich:
--   id, org_id    — Identitaet und Mandant wandern nicht
--
-- `id` ist beim insert erlaubt: ein Aufrufer, der seine Id selbst waehlt,
-- kann ein wiederholtes Kommando idempotent machen (EYT-61 AK4).
revoke insert, update on table public.assignments from authenticated;
grant insert (id, org_id, plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
  on table public.assignments to authenticated;
grant update (plan_version_id, employee_id, worksite_id, starts_at_utc, ends_at_utc)
  on table public.assignments to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Veroeffentlichen ist EIN Vorgang, nicht zwei
-- ---------------------------------------------------------------------------
-- plan_versions.published_at ist autoritativ, assignments.published_at ist der
-- lokal pruefbare Marker (0007). Zwei Felder, die dasselbe bedeuten, driften
-- auseinander, sobald ihr Gleichlauf Anwendungscode ist. Hier setzt sie
-- derselbe Trigger in derselben Transaktion.
--
-- security definer, und das ist hier begruendbar: die Funktion nimmt KEINEN
-- Parameter. Organisation und Planversion stammen aus NEW, also aus einer
-- Zeile, deren Aenderung RLS bereits erlaubt hat. Sie ist damit dasselbe
-- Muster wie app.user_org_ids() aus 0002 — und ausdruecklich NICHT das in
-- 0008 abgelehnte Muster `app.schreibe(org_id, ...)`, bei dem der Aufrufer den
-- Mandanten benennt und die Funktion ihn glauben muss.
--
-- Definer ist noetig, weil Punkt 2 der Rolle `authenticated` das Schreiben auf
-- published_at gerade entzogen hat: ein Invoker-Trigger scheiterte an genau
-- der Einschraenkung, die er durchsetzen soll.
create or replace function app.publish_plan_version_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.assignments
     set published_at = new.published_at
   where plan_version_id = new.id
     and org_id = new.org_id;
  return null;
end
$$;

comment on function app.publish_plan_version_assignments() is
  'Setzt assignments.published_at aus plan_versions.published_at in derselben Transaktion (EYT-49). Parameterlos: Mandant kommt aus der bereits RLS-gepruefen Zeile.';

revoke all on function app.publish_plan_version_assignments() from public;

-- `when` statt einer Abfrage im Rumpf: der Trigger feuert nur beim Uebergang
-- Entwurf -> veroeffentlicht. Der Rueckweg existiert nicht (Punkt 4).
create trigger plan_versions_publish_assignments
  after update of published_at on public.plan_versions
  for each row
  when (old.published_at is null and new.published_at is not null)
  execute function app.publish_plan_version_assignments();

-- ---------------------------------------------------------------------------
-- 4. Veroeffentlichtes wird nicht still ueberschrieben
-- ---------------------------------------------------------------------------
-- EYT-49 AK4. "Stillschweigend" ist das entscheidende Wort: ohne diese Trigger
-- ist ein update auf einer veroeffentlichten Planversion ein gewoehnlicher
-- Schreibvorgang, der niemandem auffaellt. Danach ist er ein Fehler.
--
-- Verglichen wird ueber to_jsonb(new)/to_jsonb(old) statt ueber eine
-- Spaltenliste. Eine Liste waere in dem Moment veraltet, in dem jemand eine
-- Spalte ergaenzt — und zwar still, denn die neue Spalte waere dann als
-- einzige aenderbar. Der Vergleich ueber die ganze Zeile deckt kuenftige
-- Spalten automatisch mit ab.
create or replace function app.reject_published_row_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then
      raise exception 'Veroeffentlichte Zeile in %.% ist unveraenderlich und kann nicht geloescht werden',
        tg_table_schema, tg_table_name
        using errcode = '23514';
    end if;
    return old;
  end if;

  -- Der Uebergang Entwurf -> veroeffentlicht laeuft hier durch: old ist dann
  -- noch NULL. Gesperrt ist erst jede WEITERE Aenderung.
  if old.published_at is not null and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'Veroeffentlichte Zeile in %.% ist unveraenderlich',
      tg_table_schema, tg_table_name
      using errcode = '23514';
  end if;

  return new;
end
$$;

comment on function app.reject_published_row_change() is
  'Macht veroeffentlichte Zeilen unveraenderlich (EYT-49 AK4). Generisch ueber tg_table_name, verwendet fuer plan_versions und assignments.';

revoke all on function app.reject_published_row_change() from public;
grant execute on function app.reject_published_row_change() to authenticated;

-- Nebenwirkung, die hier benannt gehoert statt entdeckt zu werden: die
-- FK-Ketten `organizations -> plan_versions -> assignments` sind ON DELETE
-- CASCADE (0007). Sobald eine Organisation eine veroeffentlichte Planversion
-- hat, laeuft ein Loeschen der Organisation in diesen Trigger und scheitert.
-- Das ist die gewollte Richtung — veroeffentlichte Historie verschwindet nicht
-- als Nebeneffekt —, macht aber aus dem CASCADE eine Zusage, die nicht mehr
-- immer gilt. Organisationsloeschung ist heute kein Feature; wenn sie eins
-- wird, entscheidet ihr Ticket ueber den Weg.
create trigger plan_versions_published_immutable
  before update or delete on public.plan_versions
  for each row
  execute function app.reject_published_row_change();

create trigger assignments_published_immutable
  before update or delete on public.assignments
  for each row
  execute function app.reject_published_row_change();

-- ---------------------------------------------------------------------------
-- 5. Eine veroeffentlichte Planversion nimmt nichts mehr auf
-- ---------------------------------------------------------------------------
-- Ohne diese Regel ist Punkt 4 wirkungslos: die Planversion selbst bliebe
-- unveraendert, waehrend neue Zuweisungen in sie hineinlaufen. Der Plan haette
-- sich geaendert, die Revision nicht — genau die stille Ueberschreibung, die
-- AK4 verbietet.
--
-- Die neue Zuweisung traegt published_at NULL und faellt damit auch aus dem
-- EXCLUDE aus Punkt 1 heraus. Sie waere also zusaetzlich unsichtbar fuer die
-- Ueberlappungspruefung.
-- ---------------------------------------------------------------------------
-- Warum hier gesperrt wird, und nicht nur gelesen
-- ---------------------------------------------------------------------------
-- Ein ungesperrtes `select` entscheidet unter READ COMMITTED auf dem Snapshot
-- des Statements — und genau daran scheitert die Regel im einzigen Fall, fuer
-- den sie existiert:
--
--   T1 veroeffentlicht: update plan_versions ... (noch NICHT committet).
--       Das ist ein FOR NO KEY UPDATE auf der Zeile, weil published_at kein
--       Schluessel ist.
--   T2 legt gleichzeitig eine Zuweisung in dieselbe Planversion. Ihr Trigger
--       saehe den ENTWURFSSTAND und liesse sie durch. Der Fremdschluessel
--       nimmt nur KEY SHARE — das kollidiert mit T1 nicht, T2 blockiert also
--       nirgends und committet.
--   Ergebnis: eine veroeffentlichte Planversion enthaelt eine Zuweisung mit
--       published_at = NULL. Sie faellt damit aus Punkt 4 UND aus Punkt 1
--       heraus — unveraenderlich ist sie nicht, und am Ueberlappungsindex
--       nimmt sie auch nicht teil.
--
-- `for share` schliesst das in beide Richtungen: es kollidiert mit dem
-- FOR NO KEY UPDATE des Veroeffentlichers, laesst aber gleichzeitige
-- Einfuegungen untereinander in Ruhe. Kommt T1 zuerst durch, liest T2 nach
-- dem Warten die NEUE Zeilenversion (READ COMMITTED holt nach der Sperre
-- erneut) und lehnt ab. Kommt T2 zuerst durch, wartet T1 und stempelt die
-- neue Zuweisung mit.
--
-- Reihenfolge der Sperren ist in beiden Wegen dieselbe (erst plan_versions,
-- dann assignments), deshalb entsteht hier kein Deadlock.
create or replace function app.reject_assignment_in_published_plan()
returns trigger
language plpgsql
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
  'Verhindert Zuweisungen in eine bereits veroeffentlichte Planversion (EYT-49 AK4). Invoker: liest plan_versions unter der RLS des Aufrufers, und zwar mit FOR SHARE — ein ungesperrter Blick entschiede auf einem veralteten Snapshot.';

revoke all on function app.reject_assignment_in_published_plan() from public;
grant execute on function app.reject_assignment_in_published_plan() to authenticated;

-- `update of plan_version_id` und nicht `update`: der Sync-Trigger aus Punkt 3
-- schreibt nur published_at und darf hier nicht hineinlaufen.
create trigger assignments_reject_published_plan
  before insert or update of plan_version_id on public.assignments
  for each row
  execute function app.reject_assignment_in_published_plan();
