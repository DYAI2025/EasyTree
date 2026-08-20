# Sprint 6 — `BLOCKER_ENVIRONMENT_SEPARATION`, nachgemessen am 20.08.2026

> **Status:** `BLOCKED`. Dieses Dokument ersetzt keine Entscheidung — es macht die eine fehlende
> Voraussetzung so genau benennbar, dass sie in einem Schritt erfüllbar ist.

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
