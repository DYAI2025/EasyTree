-- Migration 0018_cost_snapshots (EYT-109)
--
-- ZWECK
-- ---------------------------------------------------------------------------
-- Der taegliche Plan-Personalkosten-Snapshot als HISTORISCHES DOKUMENT: ein
-- Kopf plus geordnete Positionen, nach dem Anlegen unveraenderlich. Grundlage
-- fuer die /kosten-Flaeche (EYT-109) und den spaeteren XLSX-Export (EYT-110),
-- der ausschliesslich eine Snapshot-Id bekommt und nichts nachrechnet.
--
-- OWNERSHIP
-- ---------------------------------------------------------------------------
-- Modul `costs` (ADR-003 §2). Das Kostenmodul liest Planfakten ausschliesslich
-- ueber die Planning-Application-API; hier entstehen deshalb KEINE
-- Fremdschluessel auf plan_versions/assignments, sondern nur Herkunftsangaben
-- als Werte.
--
-- BESITZREGISTER (gemessen 09.08.2026, in DIESEM Commit mitgezogen)
-- ---------------------------------------------------------------------------
-- `TABLE_OWNERSHIP` in apps/api/src/modules/module-catalogue.ts fuehrte bereits
-- zwei Eintraege mit dem Vermerk „MIGRATION FEHLT NOCH": `public.cost_snapshots`
-- und `public.cost_snapshot_items`. Der zweite Name hat nie existiert — die
-- Tabelle heisst `cost_snapshot_positions`, weil die Domaenenmontage aus Task 5
-- (`cost-snapshot-assembly.ts`) von Positionen spricht.
--
-- Beide Eintraege werden hier korrigiert und nicht auf Task 11 vertagt: mit
-- dieser Migration wird der Satz „MIGRATION FEHLT NOCH" FALSCH, und der Moment,
-- in dem eine Beschreibung falsch wird, ist der Moment, sie zu berichtigen.
-- Sonst beschriebe das Register genau das Schema falsch, das derselbe Commit
-- anlegt. Nebeneffekt: die Regel `costs-cross-module-public-api-only`
-- (apps/api/test/architecture/costs-rules.ts) wertet einen Tabellenzugriff ohne
-- Registereintrag als Verstoss — das PostgreSQL-Repository aus Task 11 waere
-- unter dem alten Namen rot geworden.
--
-- WARUM KEIN FK AUF plan_versions/assignments
-- ---------------------------------------------------------------------------
-- Ein Snapshot ist ein historisches Dokument. Ein FK mit `on delete cascade`
-- loeschte ihn mit der Quelle; `on delete restrict` machte das Aufraeumen der
-- Planung von Kostendaten abhaengig. Beide Richtungen sind falsch. Die Ids
-- werden als Werte gefuehrt, die Mandantenbindung uebernimmt org_id + RLS.
-- Diese Abwesenheit ist zugesichert (supabase/tests/0013_cost_snapshots.sql,
-- A5) — ein spaeter „nachgereichter" FK macht die Suite rot.
--
-- UNVERAENDERLICHKEIT = FEHLENDES RECHT
-- ---------------------------------------------------------------------------
-- Es gibt fuer `authenticated` KEIN update- und KEIN delete-Grant auf beiden
-- Tabellen — dieselbe Bauart wie audit_events (0008), idempotency_records
-- (0012) und employee_rate_versions (0013). Kein Trigger noetig: ein Recht,
-- das nicht existiert, kann keine Policy falsch auslegen. Entsprechend gibt es
-- auch KEINE update- und KEINE delete-Policy — eine wirkungslose Policy waere
-- eine Falle, weil ein spaeteres `grant` sie ohne weiteres Zutun reaktivierte
-- (derselbe Grund wie in 0017 Abschnitt 1 und 4).
--
-- KANALGRENZE (aus 0015/0017 uebernommen)
-- ---------------------------------------------------------------------------
-- `app.is_runtime_channel()` (0015) steht in beiden insert-Policies ZUERST.
-- PostgREST meldet sich als `authenticator` an und ist nicht Mitglied von
-- `easytree_app` (gemessen 04.08.2026, pg_auth_members), erfuellt die Bedingung
-- also nie. Ein angemeldetes Organisationsmitglied kann damit ueber die
-- Data-API keinen Snapshot fingieren, auch nicht mit `costs.calculate`.
-- PostgreSQL garantiert keine Auswertungsreihenfolge der Konjunktion; die
-- Reihenfolge sagt dem Lesenden, welche Bedingung die tragende ist.
--
-- WARUM app.has_permission UND NICHT app.has_cost_permission
-- ---------------------------------------------------------------------------
-- Beide Funktionen sind deckungsgleich — gemessen 09.08.2026: dieselbe Signatur
-- `(p_org_id uuid, p_permission text)`, beide `language sql stable security
-- definer set search_path = ''`, identischer Rumpf. Der Wechsel ist also
-- verhaltensfrei.
--
-- 0015 fuehrt `app.has_permission` ausdruecklich als modulunabhaengige
-- NACHFOLGERIN ein und beschreibt die spaetere Zusammenfuehrung als „ersetzt
-- zuerst die beiden 0013-Policies". Wuerde neuer Code weiterhin die abgeloeste
-- Funktion nennen, waeren daraus sechs statt zwei Policies geworden — die
-- Migration haette die Schuld vergroessert, die sie erbt. Wo eine Aenderung kein
-- Verhaltensrisiko traegt, wiegt die Treue zur erklaerten Richtung schwerer als
-- die Treue zum Bestand.
--
-- `employee_rate_versions` (0013) bleibt unangetastet auf
-- `app.has_cost_permission` — append-only. Die Doppelung ist damit sichtbar und
-- endlich, nicht wachsend.
--
-- BETRIEBSHINWEIS POOLER
-- ---------------------------------------------------------------------------
-- Wie 0015/0017: laeuft die Anwendung ueber den Supavisor-Transaktionspooler,
-- lautet session_user `postgres.<pooler-tenant-id>` und das Erzeugen bricht
-- LAUT ab (SQLSTATE 42501 bzw. null betroffene Zeilen). Siehe
-- docs/runbooks/planning-publish.md.
--
-- BETRIEBSHINWEIS LOESCHSPERREN
-- ---------------------------------------------------------------------------
-- Die tenantgebundenen FKs stehen auf `on delete restrict` (wie 0013). Fuer
-- `worksites` hat das eine sichtbare Folge: `authenticated` besitzt dort ein
-- delete-Grant (0006 Z. 43), und sobald ein Snapshot eine Baustelle nennt,
-- scheitert deren Loeschen mit 23503. Das ist gewollt — ein historisches
-- Dokument haelt seine Bezugsgroessen fest —, aber es ist eine neue Sperre auf
-- einem bestehenden Pfad und gehoert deshalb hierher und nicht in eine Fussnote.
-- `employees` und `employee_rate_versions` tragen ohnehin kein delete-Grant.
--
-- ROLLBACK (vorwaerts, als NEUE Migration — 0018 wird nach dem Merge nie editiert)
-- ---------------------------------------------------------------------------
--   drop table public.cost_snapshot_positions;
--   drop table public.cost_snapshots;
--   Eintraege aus expected_tables (supabase/tests/0005_schema_meta_gate.sql)
--   und aus TABLE_OWNERSHIP entfernen; supabase/tests/0013_cost_snapshots.sql
--   loeschen.
--
-- DATENVERLUSTRISIKO
-- ---------------------------------------------------------------------------
-- Keines beim Anwenden: beide Tabellen sind neu, kein Bestand wird beruehrt,
-- kein bestehendes Recht wird entzogen. Beim Rollback nach echtem Betrieb gehen
-- erzeugte Snapshots verloren; deshalb gilt Sprint-5 §9 — keine destruktive
-- Down-Migration nach echtem Datenbestand.

-- ---------------------------------------------------------------------------
-- 1. Der Snapshotkopf
-- ---------------------------------------------------------------------------
create table public.cost_snapshots (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Herkunft als WERT, ohne FK. Siehe Kopf.
  plan_version_id uuid not null,
  -- Optionaler Baustellenfilter. Ist er null, greift der zusammengesetzte FK
  -- nicht (MATCH SIMPLE: eine null in der Schluesselmenge erfuellt die
  -- Bedingung) — genau die gewollte Bedeutung „kein Filter".
  worksite_id uuid null,
  week_key text not null,
  time_zone text not null check (length(trim(time_zone)) > 0),
  currency text not null check (currency = 'EUR'),
  rule_version text not null check (length(trim(rule_version)) > 0),
  total_minor_units bigint not null check (total_minor_units >= 0),
  created_by uuid not null references public.users (id),
  correlation_id text not null check (length(trim(correlation_id)) > 0),
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id),
  -- GM3 Ebene B (EYT-145): einspaltiger FK statt des mandantengebundenen.
  foreign key (worksite_id) references public.worksites (id) on delete restrict
);

-- Dieselbe Wochenregel wie fuer plan_versions seit 0011 (EYT-88). Der
-- Basisplan liess week_key ungeprueft; damit waeren `2026-W00`, `2026-W99` und
-- die leere Zeichenkette moeglich gewesen, waehrend jede andere Textspalte
-- dieser Tabelle mindestens `length(trim(...)) > 0` verlangt. Der Wert ist eine
-- Kopie aus einer veroeffentlichten Planversion, also faellt die Constraint im
-- Regelbetrieb nie — sie schuetzt den direkten Schreibweg.
-- `app.is_valid_iso_week_key` ist `immutable strict` und ohne Session- oder
-- Locale-Abhaengigkeit; genau deshalb ist sie in einer Constraint zulaessig
-- (Begruendung im Kopf von 0011).
alter table public.cost_snapshots
  add constraint cost_snapshots_week_key_is_iso
  check (app.is_valid_iso_week_key(week_key));

comment on table public.cost_snapshots is
  'Unveraenderlicher Kopf eines Plan-Personalkosten-Snapshots (EYT-109). Kein update-, kein delete-Grant und keine entsprechende Policy; Anlegen nur ueber den Laufzeitkanal (app.is_runtime_channel) mit costs.calculate und auf die eigene Identitaet. Herkunft (plan_version_id) steht als Wert ohne FK, damit ein historisches Dokument die Planung weder festhaelt noch mit ihr verschwindet.';

comment on constraint cost_snapshots_week_key_is_iso on public.cost_snapshots is
  'EYT-88/EYT-109: week_key muss eine reale ISO-Woche bezeichnen — dieselbe Regel wie plan_versions_week_key_is_iso.';

-- ---------------------------------------------------------------------------
-- 2. Die Positionen
-- ---------------------------------------------------------------------------
create table public.cost_snapshot_positions (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  snapshot_id uuid not null,
  -- Herkunft als WERT, ohne FK. Siehe Kopf.
  assignment_id uuid not null,
  worksite_id uuid not null,
  -- Labels werden zum Erzeugungszeitpunkt KOPIERT (Planentscheidung D8): eine
  -- spaetere Umbenennung darf einen exportierten Kostenstand nicht rueckwirkend
  -- veraendern — dieselbe Begruendung wie fuer die eingefrorene Satzversion.
  worksite_label text not null check (length(trim(worksite_label)) > 0),
  employee_id uuid not null,
  employee_label text not null check (length(trim(employee_label)) > 0),
  local_date date not null,
  duration_ms bigint not null check (duration_ms > 0),
  rate_version_id uuid not null,
  amount_minor_units bigint not null check (amount_minor_units >= 0),
  -- Stabile Anzeigereihenfolge, im Snapshot festgeschrieben. Die Montage aus
  -- Task 5 liefert eine geordnete Liste; der Index in dieser Liste wird hier
  -- zum Wert. `>= 0` laesst offen, ob null- oder einsbasiert gezaehlt wird.
  ordinal integer not null check (ordinal >= 0),
  primary key (id),
  unique (id, org_id),
  unique (snapshot_id, ordinal),
  foreign key (snapshot_id, org_id) references public.cost_snapshots (id, org_id) on delete restrict,
  -- GM3 Ebene B (EYT-145): einspaltiger FK statt des mandantengebundenen.
  foreign key (worksite_id) references public.worksites (id) on delete restrict,
  foreign key (employee_id, org_id) references public.employees (id, org_id) on delete restrict,
  foreign key (rate_version_id, org_id)
    references public.employee_rate_versions (id, org_id) on delete restrict
);

comment on table public.cost_snapshot_positions is
  'Einzelposition eines Kosten-Snapshots: ein Mitarbeiteranteil an einem lokalen Kalendertag (EYT-109). Unveraenderlich. rate_version_id friert die verwendete Satzversion ein — eine spaetere Version rechnet nichts um. Die Bindung an den Kopf laeuft ueber den mandantengebundenen FK (snapshot_id, org_id); der haelt auch dann, wenn eine Policy irrt, weil FK-Pruefung und RLS unabhaengig voneinander sind.';

comment on column public.cost_snapshot_positions.ordinal is
  'Reihenfolge der Position im Snapshot, zusammen mit snapshot_id eindeutig. Friert die von der Domaenenmontage erzeugte Ordnung ein, damit Ansicht und Export unabhaengig von der Sortierung einer Abfrage dasselbe zeigen.';

-- ---------------------------------------------------------------------------
-- 3. Indizes
-- ---------------------------------------------------------------------------
-- Nur EIN zusaetzlicher Index. Der Basisplan sah daneben
-- `cost_snapshot_positions_snapshot_idx on (snapshot_id, ordinal)` vor — das
-- ist spaltengleich und reihenfolgengleich mit dem Index, den die
-- Unique-Constraint `unique (snapshot_id, ordinal)` ohnehin anlegt, also
-- doppelte Schreiblast ohne zusaetzlichen Lesepfad. Bewusst weggelassen.
create index cost_snapshots_lookup_idx
  on public.cost_snapshots (org_id, plan_version_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. RLS: aktiviert UND erzwungen
-- ---------------------------------------------------------------------------
-- ENABLE allein genuegt nicht — ohne FORCE unterliegt der Tabelleneigentuemer
-- der Policy nicht.
alter table public.cost_snapshots enable row level security;
alter table public.cost_snapshots force row level security;
alter table public.cost_snapshot_positions enable row level security;
alter table public.cost_snapshot_positions force row level security;

-- ---------------------------------------------------------------------------
-- 5. Rechte: erst alles entziehen, dann eng zurueckgeben
-- ---------------------------------------------------------------------------
-- Der Entzug steht zuerst, weil Supabase Default-Privileges vergibt, die nie
-- entzogen wurden: ein frisch angelegtes `public.<tabelle>` kann Rechte fuer
-- anon/authenticated tragen, ohne dass diese Migration sie erteilt haette.
revoke all on public.cost_snapshots from anon;
revoke all on public.cost_snapshots from authenticated;
revoke all on public.cost_snapshot_positions from anon;
revoke all on public.cost_snapshot_positions from authenticated;

-- Spaltenlisten statt pauschalem insert: die Serverdefaults (id, created_at)
-- bleiben ausserhalb der Reichweite des Clients. Folge fuer Task 11: das
-- Repository darf `id` NICHT mitgeben und holt sie ueber `returning id`.
grant select on public.cost_snapshots to authenticated;
grant insert (org_id, plan_version_id, worksite_id, week_key, time_zone, currency,
              rule_version, total_minor_units, created_by, correlation_id)
  on public.cost_snapshots to authenticated;

grant select on public.cost_snapshot_positions to authenticated;
grant insert (org_id, snapshot_id, assignment_id, worksite_id, worksite_label,
              employee_id, employee_label, local_date, duration_ms,
              rate_version_id, amount_minor_units, ordinal)
  on public.cost_snapshot_positions to authenticated;

-- Kein `grant ... to easytree_app`: die Laufzeitrolle ist NOINHERIT (0003) und
-- erreicht die Tabellen ueber `set local role authenticated`. Ein direkter
-- Grant machte den Rollenwechsel ueberfluessig und entwertete die
-- Kontextsetzung — supabase/tests/0005_schema_meta_gate.sql prueft das
-- katalogweit.

-- ---------------------------------------------------------------------------
-- 6. Policies
-- ---------------------------------------------------------------------------
-- Lesen: gleiche Organisation UND costs.read. Kein Kanalvorbehalt — die
-- Lesefrage beantwortet die Data-API genauso richtig wie die API, und die
-- SELECT-Flaeche haengt insgesamt am Subjektmodell EYT-14 (0017, „ausdruecklich
-- nicht enthalten").
create policy cost_snapshots_select on public.cost_snapshots
  for select to authenticated
  using (
    org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'costs.read')
  );

-- Schreiben: Kanal, Organisation, Recht, Urheberschaft — in dieser Reihenfolge.
-- `created_by = auth.uid()` ist die Urheberzusage und nur im `with check`
-- sinnvoll: sie betrifft den neuen Wert. Ein Client kann damit keine fremde
-- Person als Erzeugerin eintragen.
create policy cost_snapshots_insert on public.cost_snapshots
  for insert to authenticated
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'costs.calculate')
    and created_by = auth.uid()
  );

create policy cost_snapshot_positions_select on public.cost_snapshot_positions
  for select to authenticated
  using (
    org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'costs.read')
  );

-- Positionen tragen keine Urheberspalte; die Zuschreibung haengt am Kopf, an
-- den sie ueber den mandantengebundenen FK gebunden sind.
create policy cost_snapshot_positions_insert on public.cost_snapshot_positions
  for insert to authenticated
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'costs.calculate')
  );
