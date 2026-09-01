-- pgTAP: katalogweites Metagate fuer alle public-Tabellen (EYT-86).
--
-- ---------------------------------------------------------------------------
-- Warum dieses Gate existiert
-- ---------------------------------------------------------------------------
-- supabase/tests/0002_rls_isolation.sql prueft namentlich users, memberships,
-- items und item_notes. Eine beliebige NEUE public-Tabelle kann ohne RLS
-- angelegt und sogar an authenticated freigegeben werden, ohne dass dort etwas
-- rot wird — solange kein Test sie erwaehnt. Genau das ist die Vakuumluecke:
-- die Abdeckung waechst nicht mit dem Schema mit.
--
-- Dieses Gate zaehlt deshalb NICHT Tabellen auf, sondern fragt den KATALOG:
-- jede Tabelle in public muss die Regeln erfuellen, egal wer sie wann anlegt.
-- Eine neue Tabelle ohne RLS macht es rot, ohne dass jemand einen Test
-- anfassen muss.
--
-- Die einzige Aufzaehlung ist EXPECTED_TABLES. Sie ist Absicht: eine neue
-- Tabelle zwingt zu einer bewussten Eintragung im Review, statt still
-- durchzurutschen. Vergessen fuehrt zu rot, nicht zu gruen.
--
-- Gegenprobe: der CI-Schritt "Metagate-Gegenprobe" in .github/workflows/ci.yml
-- legt absichtlich eine offene Tabelle an und verlangt, dass diese Suite dann
-- FEHLSCHLAEGT. Ohne diesen Nachweis waere auch dieses Gate moeglicherweise
-- vakuoes.

begin;
select plan(10);

-- Hinweis zu den Casts: pg_class.relname hat den Typ `name`, nicht `text`.
-- array_agg(relname) liefert daher name[], und pgTAPs polymorphes is() findet
-- fuer (name[], text[]) keine Signatur — der erste Entwurf scheiterte mit
--   ERROR: function is(name[], text[], unknown) does not exist
-- und riss die ganze Datei mit (0 von 8 Zusicherungen gelaufen, "Bad plan").
-- Deshalb steht ueberall relname::text, auch im ORDER BY: bei array_agg mit
-- DISTINCT muss der Sortierausdruck dem aggregierten Ausdruck entsprechen.

-- ---------------------------------------------------------------------------
-- Erwarteter Tabellenbestand
-- ---------------------------------------------------------------------------
create temporary table expected_tables (
  table_name text primary key,
  tenant_owned boolean not null,
  note text not null
) on commit drop;

insert into expected_tables (table_name, tenant_owned, note) values
  ('organizations', false, 'Ist selbst der Mandant, traegt daher kein org_id (0001, RLS seit 0004)'),
  ('users',         false, '1:1 auf auth.users, RLS nur self, kein org_id (0002)'),
  ('memberships',   true,  'Verbindet User und Organisation (0002)'),
  ('items',         true,  'Synthetische RLS-Beweistabelle (0002), kein Fachbestand'),
  ('item_notes',    true,  'Synthetische RLS-Beweistabelle (0002), kein Fachbestand'),
  ('employees',     true,  'Beschaeftigte je Organisation (0005), personenbezogen'),
  ('worksites',     true,  'Baustellen je Organisation (0006)'),
  ('plan_versions', true,  'Planversionen je Organisation und Woche (0007)'),
  ('assignments',   true,  'Zuweisungen (0007), personenbezogen'),
  ('audit_events',  true,  'Anfuegbare Auditspur (0008)'),
  ('outbox_messages', true,'Transactional Outbox (0008)'),
  ('idempotency_records', true, 'Ergebnis idempotenter Schreibvorgaenge je Mandant (0012)'),
  -- Produktweite Zuordnung Rolle -> Recht. Bewusst NICHT tenant-owned: sie ist
  -- Produkteigenschaft, kein Kundendatum, und traegt deshalb kein org_id
  -- (EYT-106). Aenderungen laufen ausschliesslich ueber Migrationen.
  ('role_permissions', false, 'Rolle -> atomares Recht, produktweit, nur lesbar (0013)'),
  ('employee_rate_versions', true, 'Unveraenderliche Stundensatzversionen je Mitarbeiter (0013)'),
  -- Unveraenderlich durch FEHLENDE RECHTE, nicht durch Trigger: kein update-
  -- und kein delete-Grant, und entsprechend auch keine solche Policy (0018,
  -- EYT-109). Die Rechte-, Policy- und Kanalzusicherungen dazu stehen in
  -- supabase/tests/0013_cost_snapshots.sql.
  ('cost_snapshots', true, 'Unveraenderlicher Kopf eines Plan-Personalkosten-Snapshots (0018)'),
  ('cost_snapshot_positions', true, 'Positionen eines Kosten-Snapshots, Reihenfolge per ordinal eingefroren (0018)'),
  -- Stabile Identitaet eines Baustellentages, versionsuebergreifend. Traegt
  -- bewusst keine Zeiten und keinen Publish-Marker (0019, EYT-147); die
  -- Struktur-, Rechte- und Invariantenzusicherungen stehen in
  -- supabase/tests/0014_worksite_days.sql.
  ('worksite_days', true, 'Stabile Identitaet eines Baustellentages je Organisation, Baustelle und lokalem Datum (0019)'),
  ('worksite_day_configurations', true, 'Revisionsgebundener Planungsstand eines Baustellentages in genau einer Planversion (0019)');

-- ---------------------------------------------------------------------------
-- 1. Vollstaendigkeit in beide Richtungen
-- ---------------------------------------------------------------------------
select is(
  (
    select coalesce(array_agg(c.relname::text order by c.relname::text), array[]::text[])
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname not in (select table_name from expected_tables)
  ),
  array[]::text[],
  'Keine unbekannte public-Tabelle — jede neue Tabelle muss in EXPECTED_TABLES eingetragen werden'
);

select is(
  (
    select coalesce(array_agg(e.table_name order by e.table_name), array[]::text[])
    from expected_tables e
    where not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname = e.table_name
    )
  ),
  array[]::text[],
  'Jede erwartete Tabelle existiert auch wirklich — sonst waeren die Regeln unten leer'
);

-- ---------------------------------------------------------------------------
-- 2. org_id NOT NULL auf jeder tenant-owned Tabelle
-- ---------------------------------------------------------------------------
select is(
  (
    select coalesce(array_agg(e.table_name order by e.table_name), array[]::text[])
    from expected_tables e
    where e.tenant_owned
      and not exists (
        select 1
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = e.table_name
          and a.attname = 'org_id'
          and a.attnotnull
          and not a.attisdropped
      )
  ),
  array[]::text[],
  'Jede tenant-owned Tabelle traegt org_id NOT NULL (ADR-001 Z. 82)'
);

-- ---------------------------------------------------------------------------
-- 3. RLS aktiviert UND erzwungen
-- ---------------------------------------------------------------------------
-- ENABLE allein genuegt nicht: ohne FORCE unterliegt der Tabellenowner der
-- Policy nicht. Beide zusammen sind die Aussage.
select is(
  (
    select coalesce(array_agg(c.relname::text order by c.relname::text), array[]::text[])
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not (c.relrowsecurity and c.relforcerowsecurity)
  ),
  array[]::text[],
  'Jede public-Tabelle hat RLS ENABLED und FORCED'
);

-- ---------------------------------------------------------------------------
-- 4. Keine DML-Rechte fuer PUBLIC oder anon
-- ---------------------------------------------------------------------------
-- PUBLIC wird direkt gegen die ACL geprueft, nicht ueber has_table_privilege:
-- die Pseudorolle hat keinen Eintrag in pg_roles, und ihre Aufloesung ueber
-- einen Namensparameter ist eine Zusatzannahme, die diese Datei bei einem
-- Fehlschlag komplett abbrechen liesse. In der ACL ist PUBLIC schlicht
-- grantee = 0. Ist relacl NULL, liefert acldefault nur Ownerrechte — kein
-- falsches Positiv.
select is(
  (
    select coalesce(array_agg(distinct c.relname::text order by c.relname::text), array[]::text[])
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) as acl
    where n.nspname = 'public' and c.relkind = 'r'
      and acl.grantee = 0
      and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
  ),
  array[]::text[],
  'PUBLIC hat auf keiner public-Tabelle DML-Rechte'
);

select is(
  (
    select coalesce(array_agg(distinct c.relname::text order by c.relname::text), array[]::text[])
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['select','insert','update','delete']) as p(priv)
    where n.nspname = 'public' and c.relkind = 'r'
      and has_table_privilege('anon', c.oid, p.priv)
  ),
  array[]::text[],
  'anon hat auf keiner public-Tabelle DML-Rechte'
);

-- ---------------------------------------------------------------------------
-- 5. Keine DIREKTEN Rechte fuer die Laufzeitrolle
-- ---------------------------------------------------------------------------
-- easytree_app ist NOINHERIT (0003). Ein direkter Grant an sie wuerde den
-- Rollenwechsel ueberfluessig machen und damit die Kontextsetzung entwerten.
-- has_table_privilege waere hier irrefuehrend — es rechnet Mitgliedschaften
-- ein. Deshalb direkt gegen relacl geprueft.
select is(
  (
    select coalesce(array_agg(distinct c.relname::text order by c.relname::text), array[]::text[])
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) as acl
    join pg_roles grantee on grantee.oid = acl.grantee
    where n.nspname = 'public' and c.relkind = 'r'
      and grantee.rolname = 'easytree_app'
      and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
  ),
  array[]::text[],
  'easytree_app hat auf keiner public-Tabelle DIREKTE DML-Rechte — der Weg fuehrt ueber set role authenticated'
);

-- ---------------------------------------------------------------------------
-- 6. authenticated kann jede Fachtabelle wenigstens lesen
-- ---------------------------------------------------------------------------
-- Gegenprobe zu 4 und 5: ohne diese Zeile waeren die Verbote auch dann gruen,
-- wenn ueberhaupt keine Rechte vergeben sind — und die Anwendung stuende vor
-- lauter permission denied.
--
-- EINE benannte Ausnahme seit 0019 (EYT-147), sonst unveraendert.
--
-- 0019 entzieht auf `idempotency_records` das TABELLEN-select, um
-- `result_payload` unlesbar zu machen (R5-1), und vergibt die uebrigen sieben
-- Spalten einzeln neu. GEMESSEN (PostgreSQL 17.6, lokaler Stack nach db reset):
--     has_table_privilege('authenticated','public.idempotency_records','select')      = false
--     has_any_column_privilege('authenticated','public.idempotency_records','SELECT') = true
-- Die urspruengliche Fassung ging deshalb rot, obwohl die AUSSAGE dieser Zeile —
-- "die Anwendung laeuft nicht in permission denied" — weiterhin wahr ist: der
-- einzige Bestandsleser liest `subject_id, request_fingerprint`, und beide
-- stehen im Grant.
--
-- Die Ausnahme ist BEWUSST auf diese eine Tabelle eingegrenzt und nicht
-- repo-weit gezogen. `has_any_column_privilege` ist wahr, sobald IRGENDEINE
-- Spalte das Recht traegt, und schliesst das Tabellenrecht mit ein — als
-- Ersatz fuer ALLE 18 Tabellen waere die Zusicherung damit fuer 17 von ihnen
-- schwaecher als vorher, ohne dass irgendetwas das verlangt. Welche Spalten es
-- bei `idempotency_records` genau sind, misst
-- supabase/tests/0014_worksite_days.sql (B9/B10/E1/E2) exakt; diese Zeile
-- beantwortet hier nur noch "die Anwendung kommt an ihre Daten".
select is(
  (
    select coalesce(array_agg(e.table_name order by e.table_name), array[]::text[])
    from expected_tables e
    where case
      when e.table_name = 'idempotency_records'
        then not has_any_column_privilege('authenticated', 'public.' || e.table_name, 'SELECT')
      else not has_table_privilege('authenticated', 'public.' || e.table_name, 'select')
    end
  ),
  array[]::text[],
  'authenticated hat auf jeder erwarteten Tabelle select — bei idempotency_records seit 0019 spaltenweise, sonst auf Tabellenebene; sonst laeuft die Anwendung in permission denied'
);

-- ---------------------------------------------------------------------------
-- 7. Lockfunktionen nur fuer die vorgesehene Laufzeitrolle
-- ---------------------------------------------------------------------------
-- Funktionen erhalten in PostgreSQL standardmaessig EXECUTE fuer PUBLIC. Ein
-- blosses `grant ... to authenticated` schraenkt dieses Standardrecht NICHT
-- ein; der PUBLIC-Grant muss ausdruecklich entzogen werden.
select is(
  (
    select coalesce(
      array_agg(p.proname::text order by p.proname::text),
      array[]::text[]
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) as acl
    where n.nspname = 'app'
      and p.proname in ('lock_employee_planning', 'lock_idempotency_key')
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  array[]::text[],
  'PUBLIC darf die Planning-Lockfunktionen nicht ausfuehren'
);

select ok(
  has_function_privilege(
    'authenticated',
    'app.lock_employee_planning(uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'app.lock_idempotency_key(text,text)',
    'execute'
  ),
  'authenticated darf beide Planning-Lockfunktionen ausfuehren'
);

select * from finish();
rollback;
