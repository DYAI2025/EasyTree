# Sprint 6 — `BLOCKER_ENVIRONMENT_SEPARATION`, nachgemessen am 20.08.2026

> **Status:** `BLOCKED`. Dieses Dokument ersetzt keine Entscheidung — es macht die eine fehlende
> Voraussetzung so genau benennbar, dass sie in einem Schritt erfüllbar ist.

> **Nachtrag 21.08.2026 — die Plattform hat gewechselt, der Blocker nicht.** Confluence 30998530
> stellt das Staging auf **VPS + Coolify + Docker** um; Cloudflare Workers ist kein Zielruntime
> mehr. Wo unten „primäres Cloudflare-Staging" steht, ist das die Formulierung von EYT-142 zum
> Zeitpunkt der Messung, nicht das heutige Ziel.
>
> **Das ändert an diesem Dokument genau nichts Inhaltliches.** Die fehlende Voraussetzung ist
> keine Eigenschaft der Hostingplattform, sondern der Datengrenze — und die ist dieselbe
> geblieben. Nachgemessen am 21.08.2026, wieder read-only: `list_projects` zeigt weiterhin nur
> `ykoijifgweoapitabgxx` („Bazodiac") und kein EasyTree-Projekt; `list_branches` auf
> `inypnrvpawvhgiyagxbd` zeigt weiterhin genau eine Branch `main` mit
> `project_ref == parent_project_ref == inypnrvpawvhgiyagxbd`.
>
> Wer aus „Cloudflare ist weg" schliesst, der Blocker sei weg, hat die falsche Hälfte gelesen.

> **Nachtrag 2, 21.08.2026 — die Ursache ist jetzt eine Stufe genauer, und eine frühere Annahme
> war falsch.** Nach PO-Freigabe wurde versucht, ein zweites Projekt `easytree-staging`
> (eu-west-2, Org `iudjsdyrammpwhtryrir` „EASTree", `get_cost` → **0 $/Monat**) anzulegen. Der
> Aufruf wurde abgelehnt:
>
> ```
> BadRequestException: The following organization members have reached their maximum limits
> for the number of active free projects within organizations where they are an administrator
> or owner: DYAI2025 (2 project limit).
> ```
>
> **Korrektur:** In der ersten Lesart galt das pausierte Projekt `ykoijifgweoapitabgxx`
> („Bazodiac", `status: INACTIVE`) als einer der beiden belegten Slots. Das ist falsch. Die
> Supabase-Doku sagt an zwei Stellen wörtlich das Gegenteil — Billing FAQ: „You are entitled to
> two active free projects. **Paused projects do not count towards your quota.**"; About billing:
> „Paused projects do not count towards your free project limit." Bazodiac zu löschen oder zu
> pausieren ist damit **gegenstandslos**.
>
> **Die tatsächliche fehlende Voraussetzung ist damit zweistufig:**
>
> 1. Es existiert keine EasyTree-Datengrenze, deren `project_ref` von `inypnrvpawvhgiyagxbd`
>    verschieden ist. (unverändert)
> 2. Der **kostenlose** Weg dorthin ist versperrt, weil die Free-Projekt-Quota **pro Nutzer**
>    zählt, nicht pro Organisation, und `DYAI2025` — Owner/Admin von EASTree — sie mit zwei
>    aktiven Free-Projekten ausgeschöpft hat. Eines davon ist `inypnrvpawvhgiyagxbd`
>    (`ACTIVE_HEALTHY`); **das zweite ist über die Management-API dieses Zugangs nicht sichtbar.**
>
> Punkt 2 ist belegbar und nicht bloss vermutet: `list_projects` liefert reproduzierbar **genau
> ein** Projekt (Bazodiac) und **enthält `inypnrvpawvhgiyagxbd` nicht**, obwohl `get_project`
> darauf antwortet. `list_organizations` liefert nur `rcginbmldqfibmrbtsvr` und **nicht** EASTree,
> obwohl `get_organization` darauf antwortet. Die Aufzählung ist also nachweislich unvollständig —
> jede daraus abgeleitete Projektzählung wäre falsch, und deshalb steht hier keine.
>
> **Was der abgelehnte Aufruf nebenbei belegt:** die Antwort war ein _Quota_-Fehler, kein
> 403/Forbidden. Die Autorisierung ist also durchgelaufen; es fehlt Kontingent, nicht Recht.
> Vorbehalt, weil ungemessen: falls Supabase Quota vor Mitgliedschaft prüft, trägt diese
> Ableitung nicht.
>
> **Nicht-destruktiver nächster Schritt, in dieser Reihenfolge:**
>
> 1. Im Dashboard als `DYAI2025` nachsehen, **welches zweite aktive Free-Projekt** die Quota
>    belegt. Nur dort sichtbar — die API-Aufzählung dieses Zugangs ist unvollständig (s. o.).
> 2. Ist es entbehrlich: **pausieren**, nicht löschen. Pausierte Projekte zählen nicht.
> 3. Sonst: eine weitere Free-Plan-Organisation, in der `DYAI2025` **nicht** Owner/Admin ist —
>    die FAQ nennt genau diesen Weg („You can create another Free Plan organization or change the
>    role of the affected member").
> 4. Erst wenn beides ausscheidet, die kostenpflichtige Variante: Pro für EASTree, danach zweites
>    Projekt oder Preview-Branch (`get_cost` → 0,01344 $/h ≈ 9,81 $/Monat).
>
> **Kein Schreibzugriff hat stattgefunden.** Der abgelehnte `create_project`-Aufruf hat nichts
> angelegt; alles Übrige war read-only. Produktionsdaten wurden zu keinem Zeitpunkt berührt.

> **Nachtrag 3, 24.08.2026 — nachgemessen, unverändert.** Wieder read-only über die
> Control-Plane: `list_projects` liefert weiterhin genau **ein** Projekt (`ykoijifgweoapitabgxx`
> „Bazodiac", `status: INACTIVE`) und kein EasyTree-Projekt; `list_organizations` weiterhin nur
> `rcginbmldqfibmrbtsvr`; `list_branches` auf `inypnrvpawvhgiyagxbd` weiterhin genau eine Branch
> `main` mit `project_ref == parent_project_ref == inypnrvpawvhgiyagxbd`. Beide Stufen der
> fehlenden Voraussetzung aus Nachtrag 2 bestehen fort. Die Entscheidung aus
> `docs/plans/2026-08-23-sprint-6-restarbeit.md` Phase 0 (Task 0.1: zweiten belegten Free-Slot im
> Dashboard sichtbar machen; Task 0.2: Option A/B/C/D wählen) ist weiterhin nicht gefallen —
> Phase 3 (realer Deploy) bleibt gesperrt.

## Worum es geht

EYT-137 verlangt die Kernreise „auf dem für Sprint 6 freigegebenen Staging-Ziel", EYT-142 verlangt
sie „auf primärem Cloudflare-Staging". Der Auftrag zu diesem Lauf setzt darüber eine harte Auflage:

> Deploy nur bei belegter, isolierter NON-PRODUCTION-Supabase/PostgreSQL-Grenze. Fehlt sie: STOP
> `BLOCKER_ENVIRONMENT_SEPARATION` mit exakter fehlender Voraussetzung.

Dieselbe Auflage steht seit dem 18.08.2026 als Owner-Entscheidung **D-1** im EYT-142-Plan
(`docs/plans/2026-08-17-eyt-142-cloudflare-staging.md`, §13): kein Worker-Probe gegen die
Produktionsdatenbank, **auch kein read-only `select current_user, session_user, 1`**.

## Die exakte fehlende Voraussetzung

**Es existiert keine EasyTree-Datengrenze, deren `project_ref` von `inypnrvpawvhgiyagxbd`
verschieden ist.**

Das ist Bedingung (2) des Gate A→B im EYT-142-Plan. (1) ist erfüllt — Phase A ist vollständig
gemessen und mit PR #80 auf `master`. (3), die Owner-Freigabe, ist ohne (2) gegenstandslos.

## Wie das gemessen wurde (20.08.2026)

Alles read-only über die autorisierte Control-Plane-Sicht. Keine Anwendung, keine Rolle
`easytree_app`, kein zusätzlicher Grant, kein Schreibzugriff.

| Messung                                    | Ergebnis                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_projects` (Control-Plane)            | genau **ein** Projekt sichtbar: `ykoijifgweoapitabgxx` „Bazodiac", Org `rcginbmldqfibmrbtsvr` — **kein EasyTree-Projekt**                                |
| `list_migrations` (gebundener MCP-Server)  | **18** Migrationen, `0001_foundation` … `0018_cost_snapshots` — deckungsgleich mit `supabase/migrations/`, also die EasyTree-**Produktions**-Grenze      |
| `list_branches` auf `inypnrvpawvhgiyagxbd` | genau **eine** Branch: `main`, `is_default: true`, `project_ref: inypnrvpawvhgiyagxbd`, `parent_project_ref: inypnrvpawvhgiyagxbd`, `git_branch: master` |
| `supabase/config.toml`                     | `project_id = "easytree"` — der **lokale** CLI-Name, kein Remote-Ref                                                                                     |

### Was sich gegenüber dem 18.08.2026 geändert hat

Der Plan führte Option 2 („Supabase-Branching") mit dem Vermerk **`SOURCE_NEEDED`** — die
Verfügbarkeit für dieses Konto war nicht gemessen. **Sie ist es jetzt: Branching ist aktiv.** Die
API antwortet mit einer Branchliste statt mit „branching not enabled", und die Git-Integration ist
verdrahtet (`git_branch: master`, sichtbar auch am Check „Supabase Preview" an jedem PR).

Das macht die Sache **enger**, nicht weiter: die einzige vorhandene Branch **ist** das
Produktionsprojekt selbst — `project_ref` und `parent_project_ref` sind identisch. Es gibt also
eine Branchingfähigkeit, aber **null** Zweige, die eine Nicht-Produktionsgrenze wären.

## Warum hier gestoppt wird, statt sie anzulegen

Eine Supabase-Preview-Branch oder ein zweites Projekt anzulegen ist das **Erzeugen einer
Umgebung** — kostenpflichtig, nach aussen wirksam und eine Infrastrukturentscheidung. Der
EYT-142-Plan hat das ausdrücklich als Owner-Entscheidung stehen lassen („Keine neue
Supabase-Umgebung erzeugt. Auch nicht vorgeschlagen zu erzeugen — vorgeschlagen wird eine
_Entscheidung_"). Daran ändert dieser Lauf nichts.

Der zusätzliche Grund, der aus der Messung folgt: Supabase-Branches hängen an der
**GitHub-Integration**, und die spielt beim Merge auf `master` Migrationen ein. Eine Branch
anzulegen greift damit in genau den Pfad ein, der heute die Produktionsmigrationen fährt. Das ist
keine Nebenwirkung, die nebenbei entschieden werden sollte.

## Die drei Optionen — unverändert, jetzt mit gemessener Grundlage

1. **Supabase-Preview-Branch** von `inypnrvpawvhgiyagxbd`. Branching ist nachweislich aktiv, der
   Migrationspfad ist derselbe, die Grenze ist am abweichenden `project_ref` maschinell prüfbar.
   Seit dieser Messung die **kleinste** Option — sie war es am 18.08. noch nicht, weil die
   Verfügbarkeit offen war.
2. **Zweites Projekt „easytree-staging"**, gefüttert ausschliesslich über `supabase/migrations/*`
   (18 Dateien, identische Reihenfolge) plus `supabase/seed.sql`. Klarste Trennung, grösster
   Aufwand, unabhängig von der Branching-Integration.
3. **Nichts tun.** Phase A bleibt abgeschlossen und gemergt; Phase B und damit die
   EYT-142-Abnahme bleiben offen. Ehrlicher Teilabschluss, kein „fertig".

## Was trotz des Blockers real belegt ist

Die Kernreise ist **nicht** nur lokal zusammengesetzt. Der CI-Job `auth-journey` fährt sie in jedem
Lauf gegen einen echten Supabase-Stack: echte GoTrue-Anmeldung, echte HttpOnly-Cookies, echte
NestJS-API aus `dist/main.js`, echte Policies, echtes RLS, echtes PostgreSQL — Login → `/planung` →
Entwurf → Publish → `/kosten` → gespeicherter Snapshot → zweiter Browserkontext, samt Screenshots.

Das ist **CI-real, nicht Staging-real**, und die Unterscheidung ist keine Wortklauberei: der Stack
ist ephemer, er trägt keine über den Lauf hinaus bestehende Datengrenze, und niemand kann ihn
bedienen. Er belegt, dass die Reise **funktioniert**; er belegt nicht, dass sie **bereitsteht**.
Genau diese zweite Aussage ist blockiert.
