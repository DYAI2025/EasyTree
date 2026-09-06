-- Migration 0019_worksite_days — Datenfundament der baustellenzentrierten Planung
-- (EYT-125 Architektur, EYT-147 Slice, Meilenstein M1)
--
-- ANLASS
-- ---------------------------------------------------------------------------
-- Die Planung war bisher personenzentriert: eine Zuweisung hing an einer Woche
-- und einer Person, ein BAUSTELLENTAG existierte nirgends als Gegenstand. Damit
-- liess sich weder ein Tag als Ganzes umplanen noch eine Tagesbesetzung
-- revisionssicher fortschreiben. Diese Migration legt das Fundament dafuer an —
-- und ausschliesslich das Fundament: keine Taetigkeiten, keine Ressourcen, kein
-- Tagesstatus, kein Zeitraum, kein Generator.
--
-- ZWEI OBJEKTE, ZWEI VERSCHIEDENE LEBENSDAUERN
-- ---------------------------------------------------------------------------
-- `worksite_days` ist die IDENTITAET: eine Zeile je (Organisation, Baustelle,
-- lokaler Tag), versionsuebergreifend stabil. Sie ueberlebt jede Planversion und
-- traegt deshalb weder Zeiten noch einen Publish-Marker.
--
-- `worksite_day_configurations` ist die REVISION: der Planungsstand genau dieses
-- Tages in genau einer Planversion. Wird eine Version kopiert, entsteht eine neue
-- Konfiguration auf DERSELBEN Identitaet.
--
-- KEINE ZWEITE PUBLISH-WAHRHEIT
-- ---------------------------------------------------------------------------
-- `plan_versions.published_at` bleibt die einzige Veroeffentlichungsmarke. Keine
-- Tabelle dieser Migration traegt einen eigenen. Wo die Unveraenderlichkeit einer
-- veroeffentlichten Revision durchzusetzen ist, wird der Zustand der ELTERNZEILE
-- gelesen — nicht ein lokal gespiegelter Marker, der auseinanderlaufen koennte.
--
-- APPEND-ONLY, KEIN BACKFILL
-- ---------------------------------------------------------------------------
-- Diese Migration aendert keine bestehende Zeile. `assignments` bekommt eine
-- NULLABLE Spalte; Bestandszuweisungen bleiben ohne Tageskonfiguration gueltig
-- und behalten ihre Identitaet. Es gibt keinen Cutover-Schritt hier.
--
-- ROLLBACK (vorwaerts, als NEUE 0020 — 0019 wird nach dem Merge nie editiert)
-- ---------------------------------------------------------------------------
--   alter table public.assignments drop constraint assignments_worksite_day_configuration_fk;
--   drop index public.assignments_worksite_day_configuration_idx;
--   alter table public.assignments drop column worksite_day_configuration_id;
--   revoke insert on table public.assignments from authenticated;
--   grant insert (org_id, plan_version_id, employee_id, worksite_id,
--                 starts_at_utc, ends_at_utc) on table public.assignments to authenticated;
--   drop function app.remove_assignment_from_worksite_day(uuid, uuid);
--   drop function app.read_idempotency_result(text, text);
--   drop function app.lock_week_draft(text);
--   drop table public.worksite_day_configurations;
--   drop table public.worksite_days;
--   drop function app.reject_worksite_day_configuration_change_in_published_plan();
--   drop function app.assignment_belongs_to_worksite_day_configuration();
--   -- REIHENFOLGE: erst die Policy, dann die Spalte. Die 0019-Fassung von
--   -- idempotency_records_insert_in_org nennt result_payload in ihrer
--   -- with-check-Klausel und haengt damit an der Spalte; umgekehrt bricht der
--   -- Rollback mit "cannot drop column result_payload … policy … depends on it"
--   -- ab (gemessen, PostgreSQL 17.6, Transaktion zurueckgerollt).
--   drop policy idempotency_records_insert_in_org on public.idempotency_records;
--   create policy idempotency_records_insert_in_org on public.idempotency_records
--     for insert to authenticated with check (org_id in (select app.user_org_ids()));
--   alter table public.idempotency_records
--     drop constraint idempotency_records_worksite_day_ops_need_payload,
--     drop constraint idempotency_records_result_payload_is_object,
--     drop column result_payload;
--   grant select on table public.idempotency_records to authenticated;
--
-- Der Rollback verliert die in `result_payload` gespeicherten Erstantworten. Das
-- ist der einzige Datenverlust dieser Umkehr und betrifft ausschliesslich die
-- beiden neuen Vorgaenge, die es vor dieser Migration nicht gab.

-- ---------------------------------------------------------------------------
-- 1. IDENTITAET: eine Zeile je (Organisation, Baustelle, lokaler Tag)
-- ---------------------------------------------------------------------------
-- Keine Planungsdaten, keine Zeiten, kein Publish-Marker, versionsuebergreifend
-- stabil (R-01). Die Ortszone der Organisation entscheidet, welcher reale Tag
-- gemeint ist — sie wird hier NICHT materialisiert, weil das ein zweiter Ort
-- fuer eine Wahrheit waere, die `organizations.time_zone` bereits traegt.
create table public.worksite_days (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  worksite_id uuid not null,
  local_date date not null,
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id),
  -- Die Identitaetsgarantie (I-4): derselbe reale Baustellentag ist immer
  -- dieselbe Zeile. Ohne sie waere "stabile Identitaet" eine Absichtserklaerung.
  unique (org_id, worksite_id, local_date),
  -- Tenantgebunden: eine baustellenfremde Referenz scheitert auf FK-Ebene
  -- (23503), unabhaengig von RLS. `restrict`, weil eine Baustelle mit geplanten
  -- Tagen nicht stillschweigend verschwinden darf.
  foreign key (worksite_id, org_id) references public.worksites (id, org_id) on delete restrict
);
-- EYT-120 ergaenzt hier spaeter additiv `continuous_worksite_plan_id uuid null`.

comment on table public.worksite_days is
  'Stabile Identitaet eines Baustellentages je Organisation, Baustelle und lokalem Datum (EYT-147). Traegt bewusst KEINE Zeiten und KEINEN Publish-Marker: sie ueberlebt jede Planversion, waehrend der Planungsstand in worksite_day_configurations liegt.';

comment on column public.worksite_days.local_date is
  'Lokaler Geschaeftstag in der Zeitzone der Organisation. Kein Zeitstempel — welcher UTC-Bereich das ist, entscheidet organizations.time_zone zur Lesezeit.';

-- ---------------------------------------------------------------------------
-- 2. REVISION: der Planungsstand dieses Tages in genau einer Planversion
-- ---------------------------------------------------------------------------
create table public.worksite_day_configurations (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  worksite_day_id uuid not null,
  plan_version_id uuid not null,
  -- Nebenlaeufigkeits-Token der TAGESIDENTITAET, je Revision materialisiert und
  -- beim Kopieren uebernommen. KEINE Zeiten, KEIN published_at.
  lock_version integer not null default 0 check (lock_version >= 0),
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id),
  -- I-3: ein Baustellentag hat je Planversion hoechstens EINEN Stand.
  unique (plan_version_id, worksite_day_id),
  foreign key (worksite_day_id, org_id) references public.worksite_days (id, org_id),
  -- Kaskade NUR hier: verschwindet ein unveroeffentlichter Entwurf, geht sein
  -- Tagesstand mit. Die IDENTITAET bleibt (siehe FK oben, ohne Kaskade).
  foreign key (plan_version_id, org_id)
    references public.plan_versions (id, org_id) on delete cascade
);

comment on table public.worksite_day_configurations is
  'Revisionsgebundener Planungsstand eines Baustellentages in genau einer Planversion (EYT-147). Traegt KEINEN eigenen Publish-Marker: autoritativ ist plan_versions.published_at, das die Guards dieser Migration an der Elternzeile lesen.';

comment on column public.worksite_day_configurations.lock_version is
  'Nebenlaeufigkeits-Token der Tagesidentitaet, je Revision materialisiert und beim Kopieren einer Planversion uebernommen. Genau EINE Stale-Wahrheit je Tag (R-20).';

create index worksite_day_configurations_version_idx
  on public.worksite_day_configurations (plan_version_id);
create index worksite_day_configurations_day_idx
  on public.worksite_day_configurations (worksite_day_id);

-- ---------------------------------------------------------------------------
-- 3. RLS und Grants nach dem 0017-Muster
-- ---------------------------------------------------------------------------
-- Spaltenweise Grants, Kanal und Recht in der Policy. KEIN delete-Grant auf
-- beiden Tabellen: dieser Slice hat kein Loesch-Command, und ein Recht ohne
-- Verbraucher ist reine Angriffsflaeche (0017). Entsprechend gibt es auch keine
-- delete-Policy — sonst genuegte spaeter ein `grant`, um den Weg unbemerkt zu
-- oeffnen.
revoke all on table public.worksite_days, public.worksite_day_configurations
  from anon, authenticated;

grant select on table public.worksite_days, public.worksite_day_configurations to authenticated;

grant insert (org_id, worksite_id, local_date) on table public.worksite_days to authenticated;

grant insert (org_id, worksite_day_id, plan_version_id, lock_version)
  on table public.worksite_day_configurations to authenticated;

grant update (lock_version) on table public.worksite_day_configurations to authenticated;

alter table public.worksite_days enable row level security;
alter table public.worksite_days force row level security;
alter table public.worksite_day_configurations enable row level security;
alter table public.worksite_day_configurations force row level security;

create policy worksite_days_select_in_org on public.worksite_days
  for select to authenticated
  using (org_id in (select app.user_org_ids()));

-- `app.is_runtime_channel()` steht zuerst, wie in 0015 und 0017: PostgreSQL
-- garantiert keine Auswertungsreihenfolge, aber die Zeile sagt dem Lesenden,
-- welche Bedingung die tragende ist.
create policy worksite_days_insert_in_org on public.worksite_days
  for insert to authenticated
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.write')
  );

create policy worksite_day_configurations_select_in_org on public.worksite_day_configurations
  for select to authenticated
  using (org_id in (select app.user_org_ids()));

create policy worksite_day_configurations_insert_in_org on public.worksite_day_configurations
  for insert to authenticated
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.write')
  );

-- Den ENTWURFSZUSTAND prueft der Trigger in Block 5, nicht diese Policy —
-- dieselbe Arbeitsteilung wie beim assignments-INSERT (0016/0017): die Policy
-- beantwortet "darf dieser Kanal mit diesem Recht ueberhaupt schreiben", die
-- Fachregel steht im Trigger.
create policy worksite_day_configurations_update_in_org on public.worksite_day_configurations
  for update to authenticated
  using (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.write')
  )
  with check (
    app.is_runtime_channel()
    and org_id in (select app.user_org_ids())
    and app.has_permission(org_id, 'planning.write')
  );

-- ---------------------------------------------------------------------------
-- 4. Aufnahme-Guard: eine veroeffentlichte Version nimmt nichts mehr auf
-- ---------------------------------------------------------------------------
-- Wiederverwendung der generischen 0016-Fassung: sie liest ausschliesslich
-- `new.plan_version_id` und `new.org_id` und ist damit auf jede Kindtabelle von
-- `plan_versions` anwendbar. Ihr Fehlertext spricht von "Zuweisung"; das ist der
-- Preis der Wiederverwendung und wird hier benannt statt durch eine zweite,
-- fast gleiche Funktion vermieden.
create trigger worksite_day_configurations_reject_published_plan
  before insert or update of plan_version_id on public.worksite_day_configurations
  for each row execute function app.reject_assignment_in_published_plan();

-- ---------------------------------------------------------------------------
-- 5. Unveraenderlichkeit OHNE lokalen Marker
-- ---------------------------------------------------------------------------
-- ZWINGEND `security definer` — gemessene 0015-Lektion (CI-Lauf 30862744360):
-- ein INVOKER-`for share` prueft zusaetzlich die USING-Klausel der UPDATE-Policy
-- von `plan_versions`, und die verlangt `planning.publish`. Eine Sitzung mit nur
-- `planning.write` — das Recht dieser Tabellen — faende die veroeffentlichte
-- Elternzeile NICHT, `v_published_at` bliebe NULL und der Guard liesse die
-- Mutation still durch.
create function app.reject_worksite_day_configuration_change_in_published_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_published_at timestamptz;
begin
  -- (1) DIE ZUGEHOERIGKEIT IST UNVERAENDERLICH.
  --     `worksite_day_id` und `plan_version_id` sind die Identitaet dieser Zeile,
  --     nicht ihr Inhalt. Ein Umhaengen wuerde I-1 (Block 7) NACHTRAEGLICH
  --     brechen: der Zugehoerigkeitstrigger auf `assignments` feuert nur bei
  --     INSERT/UPDATE DORT und laeuft bei einer Aenderung HIER nie erneut.
  --     Review-MESSUNG (PostgreSQL 17.6, lokaler Stack, zurueckgerollt): ohne
  --     diesen Riegel liess `update … set plan_version_id = <anderer Entwurf>`
  --     eine Konfiguration auf Planversion B zeigen, waehrend ihre Zuweisungen
  --     weiter auf A zeigten (`gleich=f`), und `update … set worksite_day_id =
  --     <Tag anderer Baustelle>` erzeugte `assignment.worksite_id <>
  --     worksite_days.worksite_id`. Beide Netze liessen es durch: der
  --     Aufnahme-Guard sah einen Entwurf, dieser Guard nur den Publish-Stand.
  --
  --     Das Spaltenrecht allein genuegt hier NICHT als Riegel. `authenticated`
  --     besitzt zwar nur `update (lock_version)`, aber 0017 hat fuer genau diese
  --     Konstruktion die Regel aufgestellt: ein Weg, der nur durch ein fehlendes
  --     Grant versperrt ist, geht mit dem naechsten `grant` unbemerkt wieder auf.
  if tg_op = 'UPDATE'
     and (new.worksite_day_id <> old.worksite_day_id
          or new.plan_version_id <> old.plan_version_id) then
    raise exception 'Tageskonfiguration kann nicht auf einen anderen Tag oder eine andere Planversion umgehaengt werden'
      using errcode = '23514';
  end if;

  -- (2) VEROEFFENTLICHUNGSSTAND DER ELTERNZEILE.
  --     BEWUSST OHNE Sichtbarkeitsfilter — anders als der Aufnahme-Guard aus
  --     0016. Dort ist `new.plan_version_id` ein vom Aufrufer GEWAEHLTER Wert,
  --     und der Filter verhindert, dass die Fehlermeldung die Existenz einer
  --     fremden Planversion verraet; die Entscheidung faellt dann beim
  --     Fremdschluessel (23503). Hier stammt `old.plan_version_id` aus einer
  --     Zeile, die der Aufrufer bereits in der Hand hat — es gibt keine fremde
  --     Existenz mehr zu verraten, und der Filter waere reiner Schaden.
  --
  --     Review-MESSUNG (PostgreSQL 17.6, lokaler Stack, zurueckgerollt): MIT
  --     Filter erzeugte eine Sitzung mit ORG-FREMDER Identitaet in
  --     `request.jwt.claims` denselben `not found` wie die Loeschkaskade — und
  --     der DELETE-Zweig liess sie durch: `DELETE 1`, die Tageskonfiguration
  --     einer VEROEFFENTLICHTEN Planversion war weg. Dieselbe Anweisung ohne
  --     Claims wurde korrekt mit 23514 abgewiesen. Der Bestandsguard
  --     `app.reject_published_row_change` (0010) hat diese Luecke nicht, weil er
  --     `old.published_at` an der Zeile SELBST liest und damit
  --     identitaetsunabhaengig ist. Ohne Filter ist `not found` hier wieder
  --     eindeutig: die Elternzeile existiert wirklich nicht mehr.
  select pv.published_at
    into v_published_at
    from public.plan_versions pv
   where pv.id = old.plan_version_id
     and pv.org_id = old.org_id
     for share;

  if not found then
    -- Review-MESSUNG: bei einer Loeschkaskade ist die Elternzeile im
    -- BEFORE-DELETE des Kindes BEREITS entfernt — „nicht gefunden" ist dort der
    -- NORMALFALL. Eine fail-closed-Variante machte gemessen schon das Loeschen
    -- eines UNVEROEFFENTLICHTEN Entwurfs mit Tageskonfiguration unmoeglich und
    -- haette die Aufraeumpfade der Bestandssuiten gebrochen. Die Entscheidung
    -- gehoert dort dem Fremdschluessel und der Kaskade, nicht dieser Regel. Die
    -- Unveraenderlichkeit VEROEFFENTLICHTER Zeilen bleibt gewahrt, weil eine
    -- veroeffentlichte `plan_versions`-Zeile nach 0010 selbst unloeschbar ist
    -- und ihre Kaskade damit nie anlaeuft.
    --
    -- Bei UPDATE kann es per Konstruktion keine Kaskade geben (kein
    -- `on update cascade`), und der Fremdschluessel garantiert die Elternzeile —
    -- ein `not found` ist dort ein unerklaerter Zustand und wird benannt.
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'Planversion der Tageskonfiguration nicht aufloesbar'
      using errcode = '23514';
  end if;

  if v_published_at is not null then
    raise exception 'Tageskonfiguration einer veroeffentlichten Planversion ist unveraenderlich'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

comment on function app.reject_worksite_day_configuration_change_in_published_plan() is
  'Zwei Regeln fuer worksite_day_configurations (EYT-147). (1) Die Zugehoerigkeit ist unveraenderlich: worksite_day_id und plan_version_id lassen sich nicht umhaengen, sonst braeche I-1 nachtraeglich, weil der Zugehoerigkeitstrigger auf assignments dabei nie erneut feuert. (2) Die Konfiguration einer veroeffentlichten Planversion ist unveraenderlich — ohne zweiten Publish-Marker, der Zustand wird an der Elternzeile gelesen. security definer aus demselben Grund wie 0015: ein Invoker-for-share pruefte die UPDATE-Policy von plan_versions mit und saehe die Zeile ohne planning.publish nicht. Die Elternabfrage traegt BEWUSST KEINEN Sichtbarkeitsfilter: old.plan_version_id stammt aus einer Zeile, die der Aufrufer schon haelt, es gibt also keine fremde Existenz zu verraten — mit Filter erzeugte eine org-fremde Identitaet denselben not-found wie die Loeschkaskade und konnte gemessen eine veroeffentlichte Tageskonfiguration loeschen. Fail-open ausschliesslich fuer DELETE, weil dort die Loeschkaskade den Normalfall "nicht gefunden" erzeugt.';

revoke all on function app.reject_worksite_day_configuration_change_in_published_plan()
  from public;

create trigger worksite_day_configurations_immutable_when_published
  before update or delete on public.worksite_day_configurations
  for each row
  execute function app.reject_worksite_day_configuration_change_in_published_plan();

-- ---------------------------------------------------------------------------
-- 6. Assignments: Unterordnung unter die REVISION (R-26)
-- ---------------------------------------------------------------------------
-- Nullable fuer Bestandszeilen. Kein Backfill, keine Aenderung der bisherigen
-- Assignment-Identitaet.
alter table public.assignments add column worksite_day_configuration_id uuid;

comment on column public.assignments.worksite_day_configuration_id is
  'Tageskonfiguration, unter der diese Zuweisung geplant wurde (EYT-147). NULL fuer Bestandszeilen aus der personenzentrierten Planung; diese bleiben unveraendert gueltig.';

-- NO ACTION (Default). Review-MESSUNG (PostgreSQL 17.6, Replika dieser
-- Topologie): RESTRICT verhielte sich hier identisch; der einzige dokumentierte
-- Unterschied ist Deferrierbarkeit.
alter table public.assignments add constraint assignments_worksite_day_configuration_fk
  foreign key (worksite_day_configuration_id, org_id)
  references public.worksite_day_configurations (id, org_id);

create index assignments_worksite_day_configuration_idx
  on public.assignments (worksite_day_configuration_id);

-- Der 0017-Grantumfang waechst um GENAU eine Spalte. `id` bleibt draussen (0012
-- A4), `update` und `delete` bleiben entzogen, und es entsteht KEINE zweite
-- Schreibpolicy auf `assignments` — die 0017-Fassung gilt unveraendert weiter.
revoke insert on table public.assignments from authenticated;
grant insert (org_id, plan_version_id, worksite_day_configuration_id, employee_id, worksite_id,
              starts_at_utc, ends_at_utc)
  on table public.assignments to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Strukturelle Zugehoerigkeit (I-1)
-- ---------------------------------------------------------------------------
-- Baustelle und Planversion der Zuweisung stimmen mit denen ihrer
-- Tageskonfiguration ueberein. Der Fremdschluessel allein saehe das nicht: er
-- prueft die Existenz der Konfiguration im selben Mandanten, nicht die
-- Uebereinstimmung dreier weiterer Werte.
--
-- Bewusst INVOKER (kein `security definer`): die Funktion liest nur Zeilen, die
-- der Aufrufer ohnehin sehen darf, und ihr `if not found then return new` gibt
-- die Existenzfrage ausdruecklich an den Fremdschluessel ab (23503). Ein definer
-- waere hier eine unnoetige Rechteerhoehung.
create function app.assignment_belongs_to_worksite_day_configuration()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_worksite_id uuid;
  v_plan_version_id uuid;
begin
  -- Legacy-/Bestandspfad: eine Zuweisung ohne Tageskonfiguration ist gueltig.
  if new.worksite_day_configuration_id is null then
    return new;
  end if;

  select d.worksite_id, c.plan_version_id
    into v_worksite_id, v_plan_version_id
    from public.worksite_day_configurations c
    join public.worksite_days d
      on d.id = c.worksite_day_id and d.org_id = c.org_id
   where c.id = new.worksite_day_configuration_id
     and c.org_id = new.org_id;

  -- Existenz und Sichtbarkeit gehoeren dem Fremdschluessel (23503), nicht
  -- dieser Regel.
  if not found then
    return new;
  end if;

  if v_worksite_id <> new.worksite_id or v_plan_version_id <> new.plan_version_id then
    raise exception 'Zuweisung widerspricht Baustelle oder Planversion ihrer Tageskonfiguration'
      using errcode = '23514';
  end if;

  return new;
end
$$;

comment on function app.assignment_belongs_to_worksite_day_configuration() is
  'Strukturelle Zugehoerigkeit einer Zuweisung zu ihrer Tageskonfiguration (EYT-147, I-1): Organisation, Baustelle und Planversion muessen uebereinstimmen. Bewusst invoker — die Existenzfrage gehoert dem Fremdschluessel.';

revoke all on function app.assignment_belongs_to_worksite_day_configuration() from public;

-- Der Publish-Spiegel aus 0010 (`update published_at`, security definer)
-- passiert diesen Trigger folgenlos: er aendert keine der drei verglichenen
-- Spalten, und der Vergleich bleibt damit wahr.
create trigger assignments_belong_to_worksite_day_configuration
  before insert or update on public.assignments
  for each row execute function app.assignment_belongs_to_worksite_day_configuration();

-- ---------------------------------------------------------------------------
-- 8. FACHLICH GEBUNDENE Entfernen-Grenze (R-13/R-23)
-- ---------------------------------------------------------------------------
-- KEIN allgemeines DELETE-Primitive. 0017 hat `delete` auf `assignments`
-- ersatzlos entzogen; diese Funktion gibt es nicht zurueck, sondern stellt genau
-- einen fachlich gebundenen Vorgang bereit: entferne GENAU DIESE Zuweisung aus
-- GENAU DIESEM Baustellentag.
create function app.remove_assignment_from_worksite_day(
  p_assignment_id uuid,
  p_worksite_day_configuration_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a record;
  v_c record;
  v_published_at timestamptz;
begin
  if not app.is_runtime_channel() then
    raise exception 'Nur der Laufzeitkanal darf Zuweisungen aus einem Baustellentag entfernen'
      using errcode = '42501';
  end if;

  -- ACHTUNG: unter `security definer` ist dieser Select NICHT RLS-gefiltert; die
  -- einzige Mandantengrenze ist der explizite org-Check unten. Praezedenz fuer
  -- definer + `app.user_org_ids()` im Rumpf: app.reject_assignment_in_published_plan
  -- (0015/0016). Von app.lock_employee_planning (0012, invoker) stammt der
  -- andere Teil des Musters: die Organisation kommt aus der ZEILE, nie aus einem
  -- Parameter.
  select a.org_id, a.plan_version_id, a.published_at, a.worksite_day_configuration_id
    into v_a
    from public.assignments a
   where a.id = p_assignment_id;

  select c.org_id, c.plan_version_id
    into v_c
    from public.worksite_day_configurations c
   where c.id = p_worksite_day_configuration_id;

  -- Fremd und inexistent sind nach aussen ununterscheidbar: EIN Fehler, EIN
  -- Wortlaut. Alles andere waere ein Existenzleck ueber fremde Mandanten.
  if v_a is null or v_c is null
     or v_a.org_id not in (select app.user_org_ids())
     or v_c.org_id <> v_a.org_id
     or v_a.worksite_day_configuration_id is distinct from p_worksite_day_configuration_id
     or v_a.plan_version_id <> v_c.plan_version_id then
    raise exception 'Zuweisung gehoert nicht zu dieser Tageskonfiguration'
      using errcode = 'P0002';
  end if;

  if not app.has_permission(v_a.org_id, 'planning.write') then
    raise exception 'Kein Planungsrecht' using errcode = '42501';
  end if;

  select pv.published_at
    into v_published_at
    from public.plan_versions pv
   where pv.id = v_a.plan_version_id
     and pv.org_id = v_a.org_id
     for share;                       -- Race gegen einen laufenden Publish

  if not found then
    -- Konsistent mit Block 5, aber mit umgekehrtem Ausgang: hier ist KEINE
    -- Kaskade im Spiel (die Funktion wird direkt aufgerufen, nicht aus einem
    -- Trigger), die Elternzeile existiert per Fremdschluessel, und ein stummer
    -- Durchlass waere ein Loch in genau der Grenze, die diese Funktion ist.
    raise exception 'Planversion der Zuweisung nicht aufloesbar' using errcode = '23514';
  end if;

  if v_published_at is not null or v_a.published_at is not null then
    raise exception 'Veroeffentlichte Zuweisung kann nicht entfernt werden'
      using errcode = '23514';
  end if;

  delete from public.assignments where id = p_assignment_id;
  -- Zweiter Riegel bleibt scharf: `assignments_published_immutable` (0010) feuert
  -- auch fuer den definer/Eigentuemer und lehnte eine veroeffentlichte Zeile
  -- zusaetzlich mit 23514 ab.
end
$$;

comment on function app.remove_assignment_from_worksite_day(uuid, uuid) is
  'Entfernt GENAU EINE Zuweisung aus GENAU EINEM Baustellentag (EYT-147, R-13/R-23). Kein allgemeines DELETE-Primitive: Laufzeitkanal, Mandantenbindung aus der Zeile, planning.write, fachliche Zugehoerigkeit und Veroeffentlichungsstand werden in dieser Reihenfolge geprueft. Fremd und inexistent teilen sich einen Fehler, damit keine fremde Existenz durchscheint.';

revoke all on function app.remove_assignment_from_worksite_day(uuid, uuid) from public;
grant execute on function app.remove_assignment_from_worksite_day(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Idempotenz: unveraenderliches Ergebnis des ERSTEN Aufrufs (R-21)
-- ---------------------------------------------------------------------------
alter table public.idempotency_records add column result_payload jsonb;

alter table public.idempotency_records
  add constraint idempotency_records_result_payload_is_object
  check (result_payload is null or jsonb_typeof(result_payload) = 'object');

-- Pflicht fuer die neuen Vorgaenge in der DATENBANK, nicht nur im Test: ein
-- payloadloser Insert ist damit 23514 statt eines stillen Zustands, in dem der
-- Replay weder die erste Antwort reproduzieren noch ehrlich scheitern koennte.
-- Der Name ist 49 Zeichen lang und damit 14 unter NAMEDATALEN-1 (63) — er wird
-- nicht abgeschnitten. Gemessen, nicht geschaetzt: select length(conname).
alter table public.idempotency_records
  add constraint idempotency_records_worksite_day_ops_need_payload
  check (
    operation not in ('planning.plan_worksite_day', 'planning.update_worksite_day_team')
    or result_payload is not null
  );

-- Kanalpruefung nachziehen: bis heute prueft die INSERT-Policy nur die
-- Organisation — 0017 liess das stehen, weil kein Verbraucher davon profitierte.
-- Mit `result_payload` speist diese Spalte den Antwortkoerper eines Commands;
-- ohne Kanalriegel koennte jede authenticated-Sitzung mit Org-Mitgliedschaft
-- ueber die Data-API ein Replay-Ergebnis vorschreiben.
--
-- Additiv und OPERATIONSGEBUNDEN, nicht pauschal (Review-MESSUNG): es gibt VIER
-- Schreiber von `idempotency_records` — planning.create_assignment,
-- planning.publish_plan, costs.create_rate_version und costs.create_cost_snapshot.
-- `costs.create_rate_version` schreibt `employee_rate_versions`, die selbst
-- KEINEN Laufzeitkanal verlangt, und seine Integrationssuite laeuft ueber eine
-- `postgres`-Sitzung. Eine pauschale Kanalpflicht liesse diesen Bestandspfad an
-- RLS scheitern (gemessen: derselbe Insert gelingt mit der Bestands-Policy und
-- scheitert mit der pauschalen Fassung). Den Kanal braucht nur, wer ein
-- `result_payload` schreibt — also genau die beiden neuen Vorgaenge.
drop policy idempotency_records_insert_in_org on public.idempotency_records;
create policy idempotency_records_insert_in_org on public.idempotency_records
  for insert to authenticated
  with check (
    org_id in (select app.user_org_ids())
    and (result_payload is null or app.is_runtime_channel())
  );

-- LESEGRENZE (R5-1). RLS filtert ZEILEN, nicht Spalten: eine Policy-Bedingung
-- koennte den Payload nur verbergen, indem sie die ganze Zeile verschwinden
-- laesst — und selbst dann bliebe er fuer jede Sitzung lesbar, die die
-- Zeilenbedingung erfuellt. Der Payload traegt historische Command-Evidenz
-- (Team, Personen, Intervalle eines Draft-Standes, der spaeter geaendert oder
-- entfernt worden sein kann) und 0012 kennt keine Aufbewahrungsregel.
--
-- Deshalb ein SPALTENRECHT statt einer Zeilenbedingung — dasselbe Muster, mit
-- dem 0010/0017 die assignments-Schreibrechte begrenzt haben, nur fuer SELECT.
-- Die SELECT-POLICY bleibt woertlich unveraendert (org-weit): der einzige
-- Bestandsleser liest `subject_id, request_fingerprint`
-- (pg-idempotency-store.ts:26-28, gemessen: kein `select *` im Repository), und
-- beide Spalten stehen weiter im Grant. Alle vier Bestandsvorgaenge bleiben
-- damit unberuehrt.
revoke select on table public.idempotency_records from authenticated;
grant select (id, org_id, operation, idempotency_key, subject_id, request_fingerprint,
              created_at)
  on table public.idempotency_records to authenticated;

comment on column public.idempotency_records.result_payload is
  'Unveraenderliche Antwort des ERSTEN Aufrufs (EYT-147). Nullable fuer Bestandsvorgaenge, die ihr Ergebnis ueber subject_id zurueckliesen. Inhalt: ausschliesslich Ids, Zeitstempel und Zahlen — niemals Labels oder Namen. ABER ausdruecklich NICHT derselbe Massstab wie audit_events.context: dies ist historische Command-Evidenz und haelt Personen- und Intervallzuordnungen fest, die aus dem aktuellen Draft spaeter entfernt worden sein koennen. Deshalb steht diese Spalte NICHT im SELECT-Grant und ist ausschliesslich ueber app.read_idempotency_result lesbar: nur die beiden Payload-Vorgaenge, nur im Laufzeitkanal, nur mit planning.write UND nur gebunden an die genau eine aktive Organisation der aufrufenden Identitaet, die die Funktion vor der Zeilenauswahl aufloest — und deshalb insert-only.';

-- Die EINZIGE Lesestelle des Payloads: command- und kanalgebundene
-- definer-Funktion.
create function app.read_idempotency_result(p_operation text, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_payload jsonb;
  v_orgs uuid[];
begin
  -- 1. Nur die beiden Payload-Vorgaenge. Ein anderer Operationsname kommt hier
  --    nie an; kaeme er doch, ist das ein Aufruferfehler und kein Leseweg.
  if p_operation not in ('planning.plan_worksite_day', 'planning.update_worksite_day_team') then
    raise exception 'Kein Payload-Vorgang' using errcode = '42501';
  end if;

  -- 2. Laufzeitkanal.
  if not app.is_runtime_channel() then
    raise exception 'Nur der Laufzeitkanal darf ein Replay-Ergebnis lesen'
      using errcode = '42501';
  end if;

  -- 3. ORGANISATION ZUERST, deterministisch und aus dem authentisierten Kontext.
  --    Unter `security definer` gibt es KEINE RLS-Filterung — die Mandantengrenze
  --    muss die Funktion selbst ziehen, und zwar BEVOR sie eine Zeile auswaehlt.
  --    Der Unique-Schluessel von 0012 ist (org_id, operation, idempotency_key),
  --    NICHT (operation, key): zwei Organisationen duerfen denselben
  --    Vorgangsnamen und denselben Schluessel fuehren. Gemessen am lokalen Stack
  --    (zwei Organisationen, gleicher Vorgang, gleicher Schluessel): ein
  --    ungebundener Select liefert found=t mit der FREMDEN Zeile, und ein
  --    Nachfilter verwarf sie dann — der Aufrufer bekaeme einen Replay-MISS statt
  --    seiner Erstantwort.
  --
  --    Die Regel ist dieselbe wie im Planning-Command: GENAU EINE aktive
  --    Organisation, sonst fail-closed. KEIN order-by-limit-1 — eine Auswahl
  --    unter mehreren Mitgliedschaften waere geraten. `v_orgs[1]` ist hier keine
  --    Auswahl, sondern die Identitaet: der Zugriff erfolgt erst, nachdem genau
  --    ein Element festgestellt wurde. (`min(o)` waere die naheliegende Kurzform
  --    und ist NICHT verwendbar: PostgreSQL kennt kein min(uuid).)
  --
  --    `into strict` waere die kuerzere Schreibweise, ist hier aber bewusst NICHT
  --    gewaehlt: sie wirft NO_DATA_FOUND = P0002, und diesen Code fuehrt
  --    `app.remove_assignment_from_worksite_day` in dieser Migration bereits mit
  --    einer anderen Bedeutung. Zwei Bedeutungen fuer einen SQLSTATE waeren an
  --    einer Sicherheitsgrenze eine vermeidbare Mehrdeutigkeit.
  --
  --    ROLLENVERTEILUNG: die Anwendung hat die Eindeutigkeit bereits vor der
  --    Idempotenz geprueft und dort NO_ORGANISATION/AMBIGUOUS_ORGANISATION
  --    beantwortet. Dieser Riegel ist Tiefenverteidigung: loest er aus, ist eine
  --    Invariante verletzt, kein regulaerer Fachfall — deshalb genuegt hier ein
  --    einheitliches 42501.
  select array_agg(o) into v_orgs from app.user_org_ids() as o;
  if v_orgs is null then
    raise exception 'Keine aktive Organisation' using errcode = '42501';
  end if;
  if array_length(v_orgs, 1) > 1 then
    raise exception 'Mehrdeutige Organisation — genau eine aktive Mitgliedschaft erforderlich'
      using errcode = '42501';
  end if;
  v_org := v_orgs[1];

  -- 4. Recht auf der aufgeloesten Organisation. VOR der Payload-Abfrage, damit
  --    ein fehlendes Recht nichts ueber die Existenz eines Schluessels verraet.
  if not app.has_permission(v_org, 'planning.write') then
    raise exception 'Kein Planungsrecht' using errcode = '42501';
  end if;

  -- 5. Erst jetzt die Zeile — mandantengebunden ueber den VOLLSTAENDIGEN
  --    Unique-Schluessel.
  select result_payload
    into v_payload
    from public.idempotency_records
   where org_id = v_org
     and operation = p_operation
     and idempotency_key = p_key;

  -- 6. Fremder Schluessel und nicht vorhandener Schluessel sind nach aussen
  --    identisch: beides null, also "kein Replay" — kein Fehler, der eine
  --    fremde Existenz verraet.
  if not found then
    return null;
  end if;
  return v_payload;
end
$$;

comment on function app.read_idempotency_result(text, text) is
  'Die EINZIGE Lesestelle von idempotency_records.result_payload (EYT-147, F1). Nur die beiden Payload-Vorgaenge, nur im Laufzeitkanal, nur mit planning.write, und gebunden an die GENAU EINE aktive Organisation der aufrufenden Identitaet — aufgeloest VOR der Zeilenauswahl, ohne Organisationsparameter und ohne order-by-limit-1. Fremder und unbekannter Schluessel liefern beide null.';

revoke all on function app.read_idempotency_result(text, text) from public;
grant execute on function app.read_idempotency_result(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Klasse-(2)-Erwerb als Domain-Funktion (F2/F3)
-- ---------------------------------------------------------------------------
-- WARUM NICHT im Anwendungscode mit einem einfachen `select … for share`:
-- gemessen am lokalen Stack (PostgreSQL 17.6, Laufzeitkanal, Recht
-- `planning.publish` entzogen):
--     A) INVOKER  `… where week_key=… and published_at is null for share` -> KEINE ZEILE
--     B) DEFINER  dieselbe Abfrage                                        -> Zeile gefunden
-- Ursache ist dieselbe, die 0015 fuer den Assignment-Guard dokumentiert: ein
-- `for share` prueft zusaetzlich die USING-Klausel der UPDATE-Policy von
-- `plan_versions`, und die verlangt `planning.publish`. Eine Sitzung mit nur
-- `planning.write` — der Normalfall dieser Commands — faende die Draft-Zeile
-- nicht und koennte die Postcondition nicht erfuellen.
--
-- WARUM DIE SCHLEIFE: veroeffentlicht ein Publisher waehrend des Wartens, wertet
-- PostgreSQL die Qualifikation nach dem Commit erneut aus (EvalPlanQual);
-- `published_at is null` trifft nicht mehr zu und das Statement liefert 0 Zeilen.
-- Ohne Wiederholung stuende der Aufrufer ohne Draft da.
--
-- WARUM DIE MANDANTENAUFLOESUNG VORNE STEHT (F3): unter `security definer` laeuft
-- die Funktion als Eigentuemer, und der traegt BYPASSRLS. Die Mengenform
-- `where org_id in (select app.user_org_ids())` waere hier KEINE Grenze, sondern
-- eine Auswahl. Gemessen an genau dieser Mengenform (isolierte Probe,
-- zurueckgerollt): zwei Orgs ohne Entwurf -> `query returned more than one row`;
-- Org A hat einen Entwurf, Org B nicht -> legt STILL einen Entwurf in B an und
-- gibt dessen Id zurueck. Der mittlere Fall ist der gefaehrliche: ein nach aussen
-- ERFOLGREICHER Command im falschen Mandanten.
create function app.lock_week_draft(p_week_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_org uuid;
  v_orgs uuid[];
  v_runde integer := 0;
begin
  if not app.is_runtime_channel() then
    raise exception 'Nur der Laufzeitkanal darf einen Wochenentwurf sperren'
      using errcode = '42501';
  end if;

  -- F3: Mandantengrenze zuerst, danach ist jeder Zugriff an `v_org` gebunden.
  select array_agg(o) into v_orgs from app.user_org_ids() as o;
  if v_orgs is null then
    raise exception 'Keine aktive Organisation' using errcode = '42501';
  end if;
  if array_length(v_orgs, 1) <> 1 then
    raise exception 'Mehrdeutige Organisation - genau eine aktive Mitgliedschaft erforderlich'
      using errcode = '42501';
  end if;
  v_org := v_orgs[1];

  if not app.has_permission(v_org, 'planning.write') then
    raise exception 'Kein Planungsrecht' using errcode = '42501';
  end if;

  loop
    v_runde := v_runde + 1;

    -- (a) Anlegen. Gewinnt diese Transaktion, haelt sie die Zeile ueber den
    --     eigenen, noch nicht committeten Insert; das reentrante `for share` in
    --     (b) waere dann ein No-op. Die Existenz von `v_org` in
    --     `public.organizations` prueft weiterhin der Fremdschluessel von
    --     `plan_versions` — ein eigener Lesezugriff darauf entfaellt mit F3
    --     ersatzlos.
    insert into public.plan_versions (org_id, week_key)
    values (v_org, p_week_key)
    on conflict do nothing
    returning id into v_id;
    if v_id is not null then
      return v_id;
    end if;

    -- (b) Bestehenden Entwurf sperren. `for share` konfligiert mit dem
    --     `for update` des Publishers, nicht aber mit einem zweiten `for share`
    --     — zwei Planerinnen derselben Woche behindern einander nicht.
    --     `planning.write` ist oben auf `v_org` bereits geprueft; eine zweite
    --     Pruefung im Praedikat waere dieselbe Aussage.
    select pv.id
      into v_id
      from public.plan_versions pv
     where pv.org_id = v_org
       and pv.week_key = p_week_key
       and pv.published_at is null
       for share;
    if v_id is not null then
      return v_id;
    end if;

    -- (c) Weder angelegt noch gefunden: zwischen (a) und (b) wurde
    --     veroeffentlicht. Die naechste Runde legt den Folgedraft an. Begrenzt,
    --     damit ein unerwarteter Zustand BENANNT scheitert statt zu kreisen.
    if v_runde >= 3 then
      raise exception 'Wochenentwurf nicht ermittelbar (% Runden)', v_runde
        using errcode = '55P03';
    end if;
  end loop;
end
$$;

comment on function app.lock_week_draft(text) is
  'Erwirbt den Wochenentwurf einer Organisation und haelt ihn bis Transaktionsende als Klasse-(2)-Lock (EYT-147, F2/F3). security definer, weil ein Invoker-for-share die UPDATE-Policy von plan_versions mitpruefte und eine Sitzung mit nur planning.write den Entwurf nicht faende. Ohne Organisationsparameter und ohne order-by-limit-1: die genau eine aktive Organisation wird VOR jedem Zugriff aufgeloest, sonst 42501. Die Wiederholungsrunde faengt einen konkurrierenden Publish ab und legt den Folgedraft an.';

revoke all on function app.lock_week_draft(text) from public;
grant execute on function app.lock_week_draft(text) to authenticated;
