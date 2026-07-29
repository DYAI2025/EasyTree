-- ---------------------------------------------------------------------------
-- 0012 — Idempotenz des Schreibpfads, mandantengebunden (EYT-92)
-- ---------------------------------------------------------------------------
--
-- ## Befund
--
-- `POST /planung/einsaetze` verlangt laut Vertrag einen `Idempotency-Key`, und
-- `HttpPlanningGateway` schickt ihn auch — aber serverseitig las ihn niemand.
-- Ein Wiederholungsversuch nach einem Verbindungsabbruch legte deshalb einen
-- ZWEITEN Einsatz an. Genau der Fall, fuer den der Schluessel existiert.
--
-- `outbox_messages` traegt bereits `unique (org_id, message_type,
-- idempotency_key)` und verhindert damit eine zweite NACHRICHT. Das genuegt
-- nicht: der Vertrag schuldet dem Aufrufer bei einer Wiederholung dieselbe
-- Antwort, also dieselbe Assignment-Id. Dafuer muss der Ausgang des ersten
-- Aufrufs gespeichert sein, nicht nur seine Nebenwirkung unterdrueckt.
--
-- ## Warum eine eigene Tabelle
--
-- Die Alternative waere gewesen, die Id aus dem Outbox-`payload` zurueckzulesen.
-- Das koppelt zwei Dinge, die getrennt gehoeren: die Outbox ist ein
-- Zustellkanal und darf spaeter geleert, umgeformt oder partitioniert werden.
-- Eine Idempotenzauskunft, die davon abhaengt, bricht mit der ersten
-- Aufraeumaktion — und zwar still, indem sie ploetzlich wieder doppelt
-- schreibt.
--
-- ## `operation` statt eines globalen Schluesselraums
--
-- Derselbe Schluessel darf fuer zwei VERSCHIEDENE Vorgaenge nicht kollidieren.
-- Ohne die Spalte teilten sich Einsatz-Anlage und spaeteres Veroeffentlichen
-- einen Namensraum, und ein wiederverwendeter Schluessel liesse den zweiten
-- Vorgang die Antwort des ersten bekommen.
--
-- ## Was hier NICHT steht
--
-- Kein Ablaufdatum und kein Aufraeumjob. Beides ist eine Betriebsentscheidung
-- (Aufbewahrungsfrist, ADR-002) und gehoert nicht in diese Migration. Solange
-- es ihn nicht gibt, waechst die Tabelle — sichtbar und absichtlich, statt mit
-- einem geratenen Zeitfenster, nach dessen Ablauf ein Retry wieder doppelt
-- schreibt.

create table public.idempotency_records (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Stabiler Vorgangsname, z. B. 'planning.create_assignment'. Kein Freitext
  -- aus einer Nutzereingabe.
  operation text not null check (length(trim(operation)) > 0),
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  -- Ergebnis des ERSTEN Aufrufs. Bewusst als Id ohne FK: die Auskunft muss ein
  -- geloeschtes Objekt ueberleben duerfen, genau wie die Auditspur.
  subject_id uuid not null,
  -- Fingerabdruck der ANFRAGE, die den Schluessel erstmals verwendet hat.
  --
  -- Ohne ihn liesse sich derselbe Schluessel fuer einen voellig anderen Einsatz
  -- wiederverwenden, und der Server antwortete mit dem alten Ergebnis: der
  -- Aufrufer bekaeme ein "angelegt" fuer etwas, das er nie geschickt hat. Weicht
  -- der Fingerabdruck ab, ist das ein Aufruferfehler und keine Wiederholung.
  request_fingerprint text not null check (length(trim(request_fingerprint)) > 0),
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id),
  -- Der Kern: je Mandant, Vorgang und Schluessel genau ein Ergebnis.
  unique (org_id, operation, idempotency_key)
);

comment on table public.idempotency_records is
  'Ergebnis eines idempotenten Schreibvorgangs je Mandant, Vorgang und Schluessel (EYT-92). Ein Wiederholungsaufruf liest hier die Id des ERSTEN Ergebnisses und erzeugt keine zweite Wirkung. Der unique-Index ist die Autoritaet, nicht die Anwendung.';

comment on column public.idempotency_records.subject_id is
  'Id des beim ersten Aufruf erzeugten Objekts. Ohne FK, damit die Auskunft ein geloeschtes Objekt ueberlebt.';

-- ---------------------------------------------------------------------------
-- Grants und RLS
-- ---------------------------------------------------------------------------
revoke all on table public.idempotency_records from anon;

-- select + insert. KEIN update, KEIN delete: ein Idempotenzergebnis, das sich
-- aendern laesst, ist keins. Wer es ueberschreiben koennte, koennte einen
-- Retry auf ein anderes Objekt umlenken.
grant select, insert on table public.idempotency_records to authenticated;

alter table public.idempotency_records enable row level security;
alter table public.idempotency_records force row level security;

create policy idempotency_records_select_in_org on public.idempotency_records
  for select to authenticated
  using (org_id in (select app.user_org_ids()));

create policy idempotency_records_insert_in_org on public.idempotency_records
  for insert to authenticated
  with check (org_id in (select app.user_org_ids()));

-- ---------------------------------------------------------------------------
-- Serialisierung der Ueberlappungspruefung
-- ---------------------------------------------------------------------------
--
-- ## Warum keine Exclusion-Constraint fuer Entwuerfe
--
-- Naheliegend waere gewesen, `assignments_no_published_overlap` aus Migration
-- 0010 auf Entwuerfe auszudehnen. Das waere aber eine FACHLICHE Aenderung: 0010
-- schliesst Entwuerfe ausdruecklich aus (`where (published_at is not null)`),
-- weil ein Zwischenstand mit Konflikt waehrend des Planens ein normaler Zustand
-- sein soll. Diese Entscheidung wird hier nicht umgestossen.
--
-- Das Problem ist ein anderes: die Anwendung PRUEFT auf Ueberlappung und fuegt
-- dann ein. Unter `read committed` sehen zwei gleichzeitige Transaktionen die
-- Zeile der jeweils anderen nicht, und beide Pruefungen gehen durch. Gesucht
-- ist also keine dauerhafte Verbotsregel, sondern Serialisierung genau dieses
-- Pruefen-und-Einfuegen.
--
-- ## Advisory-Lock statt SELECT ... FOR UPDATE
--
-- `for update` sperrt vorhandene Zeilen. Hier ist aber das FEHLEN einer Zeile
-- die Bedingung — ein Phantom, das kein Zeilenlock abdeckt. Ein
-- transaktionsgebundener Advisory-Lock auf (Organisation, Person) sperrt
-- stattdessen den Begriff, um den es geht, und wird beim Transaktionsende
-- automatisch freigegeben; ein vergessenes Unlock kann es nicht geben.
--
-- Der Lock ist bewusst je PERSON und nicht global: zwei Planerinnen, die
-- verschiedene Mitarbeitende einplanen, behindern sich nicht.
create or replace function app.lock_employee_planning(p_employee_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_org uuid;
begin
  -- Die Organisation wird ABGELEITET, nicht uebergeben.
  --
  -- Eine fruehere Fassung nahm `p_org_id` als Parameter. Das war falsch: der
  -- Wert kam aus dem Anwendungscode, und eine Sperre auf einer fremden
  -- Organisations-Uuid haette zwar niemanden Daten sehen lassen — RLS bleibt
  -- unberuehrt — aber sie haette die Serialisierung ausgehebelt, indem zwei
  -- Transaktionen desselben Mandanten verschiedene Sperren nehmen. Die
  -- Grenze, die diese Funktion schuetzt, darf nicht von ihrem Aufrufer kommen.
  --
  -- `public.employees` steht unter RLS und die Funktion laeuft mit
  -- Aufruferrechten (kein security definer). Sichtbar ist deshalb genau die
  -- Zeile des eigenen Mandanten; fuer jede andere liefert die Abfrage NULL.
  select org_id into v_org from public.employees where id = p_employee_id;
  if v_org is null then
    raise exception
      'EYT-92: Beschaeftigte % ist im Mandantenkontext nicht sichtbar — keine Sperre.',
      p_employee_id;
  end if;

  -- `hashtextextended` liefert int8 und ist ueber Sitzungen hinweg stabil —
  -- anders als `hashtext`, dessen Breite nur int4 ist und dessen Kollisionen
  -- bei Uuids entsprechend haeufiger waeren. Organisation UND Person gehen in
  -- denselben Hash, getrennt durch ':': ohne den Mandantenanteil koennten
  -- gleiche Personen-Uuids verschiedener Organisationen einander sperren, ohne
  -- Trennzeichen liessen sich zwei verschiedene Paare zu derselben Zeichenkette
  -- zusammensetzen.
  perform pg_advisory_xact_lock(
    hashtextextended(v_org::text || ':' || p_employee_id::text, 0)
  );
end;
$$;

comment on function app.lock_employee_planning(uuid) is
  'EYT-92: serialisiert Pruefen-und-Einfuegen von Einsaetzen je Organisation und Person. Die Organisation wird aus der RLS-sichtbaren employees-Zeile abgeleitet, nicht vom Aufrufer uebernommen. Transaktionsgebunden — Freigabe beim commit oder rollback. Ersetzt KEINE Constraint: die Entwurfsueberlappung bleibt fachlich erlaubt (Migration 0010).';

grant execute on function app.lock_employee_planning(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Serialisierung des Idempotenzschluessels
-- ---------------------------------------------------------------------------
--
-- Der unique-Index auf (org_id, operation, idempotency_key) verhindert einen
-- zweiten DATENSATZ, aber nicht das Wettrennen davor: zwei gleichzeitige
-- Anfragen mit demselben Schluessel lesen beide "nicht vorhanden", legen beide
-- einen Einsatz an, und erst der zweite Insert in diese Tabelle scheitert —
-- da steht der zweite Einsatz aber schon. Der Rollback raeumt ihn zwar weg,
-- doch der Aufrufer bekaeme einen Serverfehler statt seiner Wiederholung.
--
-- Die Sperre wird deshalb VOR der Replay-Abfrage genommen. Sie haengt an
-- Organisation, Vorgang und Schluessel — nicht an der Person, weil derselbe
-- Schluessel fuer verschiedene Personen ein anderer Vorgang ist.
create or replace function app.lock_idempotency_key(p_operation text, p_key text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_org uuid;
begin
  -- Auch hier: die Organisation kommt aus dem RLS-Kontext, nicht vom Aufrufer.
  -- `app.user_org_ids()` liest ausschliesslich aktive Mitgliedschaften des
  -- verifizierten Subjekts (Migration 0002).
  -- `organizations` heisst die Spalte `id`, nicht `org_id`. `order by id`
  -- statt eines nackten `limit 1`: bei mehreren Mitgliedschaften waere die
  -- Auswahl sonst von der Speicherreihenfolge abhaengig, und zwei
  -- gleichzeitige Anfragen koennten verschiedene Sperren nehmen. Der
  -- Mehrfachfall wird ohnehin vom Repository vorher abgelehnt (EYT-14) —
  -- deterministisch ist es trotzdem, damit die Sperre nie vom Zufall abhaengt.
  select id into v_org from public.organizations order by id limit 1;
  if v_org is null then
    raise exception 'EYT-92: keine sichtbare Organisation — keine Sperre.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_org::text || ':' || p_operation || ':' || p_key, 0)
  );
end;
$$;

comment on function app.lock_idempotency_key(text, text) is
  'EYT-92: serialisiert Replay-Pruefung und Anlage je Organisation, Vorgang und Idempotenzschluessel. Ohne sie sehen zwei gleichzeitige Anfragen mit demselben Schluessel beide "nicht vorhanden". Transaktionsgebunden.';

grant execute on function app.lock_idempotency_key(text, text) to authenticated;
