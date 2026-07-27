-- Migration 0008_audit_outbox (EYT-86)
-- Auditspur und Transactional Outbox.
--
-- Rollback: forward-fix per neuer Migration. Audit- und Outbox-Zeilen werden
-- nie geloescht; ein Rueckbau verwirft Nachweise und ist ohne Restore-Nachweis
-- verboten (CLAUDE.md).

-- ---------------------------------------------------------------------------
-- Warum KEIN security-definer-Writer
-- ---------------------------------------------------------------------------
-- Naheliegend waere, Anfuegen ueber `app.write_audit(org_id, ...)` zu erzwingen
-- und den insert-Grant wegzulassen. Das waere ein Cross-Tenant-Schreibkanal:
-- eine solche Funktion MUSS org_id als Parameter nehmen, sie gehoert postgres
-- (Superuser), ihr Rumpf umgeht damit RLS — und kein Test im Repository sieht
-- Funktionsrechte (grep ueber supabase/tests nach prosecdef/proacl: nichts).
--
-- Das bestehende Muster app.user_org_ids() ist NICHT vergleichbar sicher: es
-- nimmt keinen Parameter und leitet alles aus auth.uid() ab.
--
-- Deshalb hier der gewoehnliche Weg: insert-Grant plus RLS-Policy mit
-- WITH CHECK. Anfuegbarkeit wird ueber FEHLENDE update/delete-Grants und
-- fehlende Policies erzwungen, nicht ueber erhoehte Rechte.

-- ---------------------------------------------------------------------------
-- audit_events
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Wer. NULL nur, wenn der Ausloeser kein Benutzer war (Systemjob).
  actor_user_id uuid references public.users (id) on delete set null,
  -- Was, als stabiler Code. Freitext gehoert nicht in die Auswertung.
  event_type text not null check (length(trim(event_type)) > 0),
  -- Worauf. Bewusst als Typ+Id statt FK: die Auditspur muss ein geloeschtes
  -- Objekt ueberleben duerfen.
  subject_type text not null check (length(trim(subject_type)) > 0),
  subject_id uuid not null,
  -- Kontext OHNE Personendaten. CLAUDE.md verbietet Herkunft, medizinische
  -- Details, Zugangsdaten, Token und Rohaudio — hier gehoeren IDs und Codes
  -- hinein, keine Freitexte aus Nutzereingaben.
  context jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  primary key (id),
  unique (id, org_id)
);

comment on table public.audit_events is
  'Anfuegbare Auditspur je Organisation (EYT-86). Kein update/delete-Grant und keine entsprechenden Policies — Anfuegbarkeit ist ein Recht, keine Konvention.';

comment on column public.audit_events.context is
  'IDs und Codes. KEINE personenbezogenen Freitexte (CLAUDE.md: keine privaten Herkuenfte, medizinischen Details, Zugangsdaten, Token, Rohaudio).';

create index audit_events_org_occurred_idx on public.audit_events (org_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- outbox_messages — Transactional Outbox (ADR-001 Z. 54)
-- ---------------------------------------------------------------------------
-- Der Eintrag entsteht in DERSELBEN Transaktion wie der Fachschreibvorgang.
-- Rollt die Transaktion zurueck, verschwindet er mit — das ist die Eigenschaft,
-- die EYT-45 AK3 verlangt und die es ohne diese Tabelle nicht zu pruefen gab.
--
-- Die Zustellstrecke (pg-boss-Worker) ist NICHT Teil dieser Migration und hat
-- kein eigenes Ticket (Sprintplan L-12). processed_at bleibt bis dahin NULL.
create table public.outbox_messages (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  message_type text not null check (length(trim(message_type)) > 0),
  payload jsonb not null default '{}'::jsonb,
  -- Derselbe Schluessel darf je Mandant nur einmal eine Nachricht erzeugen.
  -- Das ist die Idempotenz aus EYT-50 ("genau ein idempotenter Workerjob"),
  -- durchgesetzt von der Datenbank statt von der Anwendung.
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (id),
  unique (id, org_id),
  unique (org_id, message_type, idempotency_key)
);

comment on table public.outbox_messages is
  'Transactional Outbox je Organisation (EYT-86). Eintrag und Fachschreibvorgang teilen eine Transaktion. Zustellung folgt separat (Sprintplan L-12).';

comment on column public.outbox_messages.idempotency_key is
  'Mandantengebunden eindeutig je message_type. Ein wiederholtes Kommando erzeugt keine zweite Nachricht — durchgesetzt vom unique-Index, nicht von der Anwendung.';

create index outbox_messages_unprocessed_idx
  on public.outbox_messages (org_id, occurred_at)
  where processed_at is null;

-- ---------------------------------------------------------------------------
-- Grants und RLS
-- ---------------------------------------------------------------------------
revoke all on table public.audit_events, public.outbox_messages from anon;

-- Anfuegbar: select + insert. KEIN update, KEIN delete.
grant select, insert on table public.audit_events to authenticated;
-- Outbox: zusaetzlich update, damit ein spaeterer Worker processed_at setzen
-- kann. Kein delete — verarbeitete Nachrichten bleiben als Nachweis stehen.
grant select, insert, update on table public.outbox_messages to authenticated;

alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
alter table public.outbox_messages enable row level security;
alter table public.outbox_messages force row level security;

create policy audit_events_select_in_org on public.audit_events
  for select to authenticated
  using (org_id in (select app.user_org_ids()));

-- Der Akteur wird gebunden, nicht geglaubt.
--
-- Ohne die zweite Bedingung pruefte die Policy nur die Organisation: jedes
-- aktive Mitglied koennte ein Auditereignis mit actor_user_id = NULL schreiben
-- (es laese sich als Systemjob) oder es einer beliebigen bekannten Benutzer-UUID
-- zuschreiben. Eine Auditspur, deren Urheberangabe der Schreiber frei waehlt,
-- belegt nichts. Die Anfuegbarkeit war ein Recht, die Zuschreibung war eine
-- Konvention — das ist der Unterschied, den diese Zeile schliesst.
--
-- actor_user_id bleibt nullable, weil ein spaeterer Systemjob keinen Benutzer
-- hat. Fuer Clients ist NULL dadurch trotzdem unerreichbar: NULL = x ergibt
-- NULL, nicht true, und WITH CHECK verlangt true. Wenn ein Systemschreiber
-- entsteht, entscheidet dessen Ticket ueber den Weg — er scheitert dann
-- sichtbar an dieser Policy, statt sich still als Benutzer auszugeben.
create policy audit_events_insert_in_org on public.audit_events
  for insert to authenticated
  with check (
    org_id in (select app.user_org_ids())
    and actor_user_id = app.current_user_id()
  );

create policy outbox_messages_select_in_org on public.outbox_messages
  for select to authenticated
  using (org_id in (select app.user_org_ids()));

create policy outbox_messages_insert_in_org on public.outbox_messages
  for insert to authenticated
  with check (org_id in (select app.user_org_ids()));

create policy outbox_messages_update_in_org on public.outbox_messages
  for update to authenticated
  using (org_id in (select app.user_org_ids()))
  with check (org_id in (select app.user_org_ids()));
