# Zwei Client-Shells: Werkbank und Feld (EYT-113)

Dieses Dokument beschreibt den **implementierten IST-Zustand** der beiden
EasyTree-Client-Shells im Repository. Fachliche Baselines bleiben die
Confluence-Seiten **„EasyTree – Zwei-Client-Architektur und Admin-Kalender“**
(8486960) und **„EasyTree – Basisdesign v2.0: Werkbank & Feld – ruhig
verdichtet“** (8814623); dieses Dokument schreibt sie nicht um, sondern
verankert die Bundle-, Import- und Routengrenzen dort, wo sie geprüft werden:
im Code und in CI.

## 1. Eine gemeinsame Wahrheit

Beide Shells sind **eine** Next.js-Anwendung (`apps/web`) gegen **eine** API
(`apps/api`), **eine** Auth-Basis (GoTrue-Session, serverseitig über das
Laufzeit-Proxyziel verifiziert), **ein** Vertragspaket
(`packages/contracts`, generiertes `openapi/v1.json`) und **eine** Datenbank
(`supabase/migrations` als Schemaquelle, RLS als Durchsetzung). Es gibt
**keine zwei Backends und keine duplizierte Domainlogik**: Fachinvarianten
leben ausschließlich in `packages/domain`, Transportverträge ausschließlich
in `packages/contracts` (`contracts` importiert `domain` bewusst nicht,
ADR-001).

Beide Shells konsumieren denselben vertragsabgeleiteten Client: die Gateways
(`PlanningGateway`, `AuthGateway`, `CostsGateway`) kommen aus
`@easytree/contracts`, werden in der einzigen Kompositionswurzel
`apps/web/app/providers.tsx` konstruiert und über React-Context gereicht —
das Wurzel-Layout (`apps/web/app/layout.tsx`) ist nur Dokumentrahmen plus
Provider und entscheidet über keine Shell.

## 2. Route- und Layoutgrenzen

| Shell                    | Routenbaum                                                                                    | Layout                               | Zielbreiten                        |
| ------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------- |
| Werkbank (Admin/Planung) | `apps/web/app/(werkbank)/` — `/`, `/anmelden`, `/planung`, `/kosten`, `/kosten/stundensaetze` | `(werkbank)/layout.tsx` → `AppShell` | 1440/1920 px, dichte Desktoparbeit |
| Feld (Mitarbeiter)       | `apps/web/app/feld/`                                                                          | `feld/layout.tsx` → `FeldShell`      | 320/375 px, Touch, mobile-first    |

Die Route Group `(werkbank)` ändert keine URLs; sie zieht die Shell-Grenze.
Jede Shell hat eigene Navigation und Informationsdichte; die Feld-Shell
enthält nachweislich keine Werkbank-Navigation (auth-journey prüft
`a[href="/planung"]`/`a[href="/kosten"]` = 0 im Feld).

## 3. Serverseitige Session- und Start-Shell-Ableitung

- `apps/web/lib/sitzung-server.ts` fragt `GET /auth/session` mit den
  Request-Cookies über das Laufzeit-Proxyziel ab und liefert drei Zustände:
  `angemeldet`, `abgemeldet`, `unbekannt`. **Nichtwissen ist nicht
  abgemeldet** — fail-closed in beide Richtungen.
- `apps/web/app/feld/layout.tsx` ist das Server-Gate der Feld-Shell:
  `abgemeldet` → Redirect `/anmelden`; `unbekannt` → ehrliche Fehlerfläche
  (`ErrorState`, kein Shell-Rendering); erst eine real verifizierte Session
  montiert `FeldShell`.
- `apps/web/lib/feld/start-shell.ts` (`startShellFuer`) leitet die zulässige
  Start-Shell aus den **Mitgliedschaftsrollen der serverseitig verifizierten
  Session** ab: ohne Leitungsrolle (owner/manager) Feld, mit Leitungsrolle
  Werkbank. Keine Clickdummy-Identität, kein Client-Flag entscheidet.

**Client- oder Routenwahl verleiht kein Recht.** Jede API-Anfrage läuft
serverseitig durch Autorisierung (Application-Layer-Policies) und RLS
(`TenantQueryRunner`, `apps/api/src/platform/database/`); die
Cross-Shell-Negativreise beweist 403 ohne Datenpreisgabe, unabhängig von der
Oberfläche.

## 4. Feature- und Importgrenzen (CI-geprüft)

Regeln in `apps/api/test/architecture/rules.ts`, ausgeführt in
`apps/api/test/architecture.test.ts` (Job `unit-tests`); jeder Rot-Fall ist
in `apps/api/test/architecture-red-case.test.ts` als feuernd bewiesen:

- **`feld-shell-boundary`** (Allowlist): Dateien der Feld-Shell
  (`apps/web/app/feld/`, `apps/web/components/feld/`, `apps/web/lib/feld/`)
  dürfen nur benannte domänenfreie Quellen importieren — Werkbank-,
  Admin- und Kostenkomponenten sind nicht erreichbar. Die
  Scope-Zusicherung inventarisiert die Feld-Verzeichnisse unabhängig über
  das Dateisystem, damit die Regel nicht still leerläuft.
- **`ui-dependency-allowlist`**: `packages/ui` bleibt domänenfrei; die
  Scope-Zusicherung prüft, dass **jede** Datei unter `packages/ui/src`
  überwacht wird.
- **`kosten-server-gate`** (Anwesenheitspflicht, eigene Zusicherung in
  `architecture.test.ts`): jede Kosten-Seite montiert das serverseitige
  Freigabe-Gate; der Nicht-Leerlauf (≥ 2 Kosten-Seiten gesehen) liegt in der
  Regel selbst.
- Daneben gelten unverändert `domain-allowlist`, `layer-direction`,
  `no-app-to-app`, `no-generic-shared-package`, `api-dependency-allowlist`,
  `contracts-transport-only` (vollständige Liste: `rules.ts`).

## 5. Organisationsbezogene `costs.read`-Grenze

`apps/web/lib/kosten-freigabe.ts` ist die einzige Leseschicht der
Kosten-Ladegrenze (EYT-113 Inkrement 2, PO-Entscheidung 29.08.2026):

- Maßgeblich ist das verifizierte `costs.read` der **ausgewählten**
  Organisation (Selector-Cookie `eyt_org`), geprüft gegen die real
  verifizierten Mitgliedschaften der Session.
- **Kein Any-Org-Fallback**: Recht in Organisation A gewährt nichts, solange
  Organisation B ausgewählt ist. Fremde oder kaputte Selector-Werte fallen
  ersatzlos (fail closed), ebenso unbekannte Session und fehlende Auswahl
  bei mehreren Organisationen.
- Verweigerungszustände rendert die **Server**-Komponente
  `apps/web/components/kosten-grenze.tsx`; Kosten-Client-Komponenten kommen
  dann gar nicht in den Baum.
- Die Lazy-Ladegrenze ist **client-seitig** (`next/dynamic` in
  `kosten-flaeche.tsx` / `stundensaetze-flaeche.tsx`), weil Turbopack
  Route-Entry-Chunks unbedingt in den HTML-Kopf schreibt — verweigerte
  Journeys laden nachweislich 0 Kosten-Chunks (auth-journey misst
  Netzwerkanfragen und Route-Manifeste).

## 6. Gemeinsame Zustandsverträge

Getragen von den domänenfreien Primitives aus `@easytree/ui`; die
Informationsarchitekturen der Shells bleiben bewusst getrennt.

| Zustand                           | Primitive                                                            | Werkbank                                                                                                 | Feld                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Loading                           | `LoadingState`                                                       | `kosten-ansicht.tsx`, `planning-window-view.tsx`                                                         | `feld-start.tsx`                                                                                                                    |
| Empty                             | `EmptyState`                                                         | `kosten-ansicht.tsx`, `rate-management.tsx`, `planning-window-view.tsx`                                  | `feld-start.tsx` (ehrlicher Leerzustand „Noch keine Feld-Ansichten“)                                                                |
| Forbidden                         | `ErrorState`                                                         | `kosten-zugang.tsx`/`kosten-grenze.tsx` (`kosten-forbidden`), `planung-zugang.tsx` (`planung-forbidden`) | Cross-Shell-Fall: Feld-Nutzer auf Werkbank-Routen sieht die Werkbank-Forbidden-Fläche; Feld selbst hat keine rechtegebundene Fläche |
| Unauthenticated                   | `StateBanner` / `EmptyState` + Server-Redirect                       | `kosten-*`/`planung-zugang.tsx` (`…-unauthenticated`)                                                    | Server-Gate-Redirect `/feld` → `/anmelden`; Client-Ablauf: `feld-unauthenticated` (`EmptyState`)                                    |
| Stale                             | `StateBanner` (`tone="warning"`) + `STALE_VERSION` aus den Verträgen | `planning-window-view.tsx` („Stand veraltet“), `kosten-ansicht.tsx`, `rate-management.tsx`               | nicht anwendbar — die Feld-Shell hat noch keinen schreibenden Datenpfad                                                             |
| Unbekannt (Session nicht prüfbar) | `ErrorState`                                                         | `kosten-sitzung-unbekannt`, `planung-sitzung-unbekannt`                                                  | `feld-sitzung-unbekannt`                                                                                                            |

Tests: `planung-zugang.test.tsx`, `kosten-page-gate.test.tsx`,
`kosten-ansicht.test.tsx`, `feld-shell.test.tsx`,
`planungswerkbank-einstieg.test.tsx` sowie die Journey-Zusicherungen.

**Offline-read-only: nicht anwendbar (Stand heute).** Es existiert kein
Offline-Datenvertrag im Repository — `apps/web/app/manifest.ts` und
`components/start-inhalt.tsx` erklären ausdrücklich: kein Service Worker,
keine Offline-Schreib-/Sync-Queue, gearbeitet wird online. Ein gemeinsamer
Offline-read-only-Zustand entsteht erst, wenn ein realer Fach-/Datenvertrag
(z. B. mit dem Employee-Read-Pfad EYT-81) existiert; er wird nicht mit
Fake-Daten vorweggenommen.

## 7. CI-Gegenproben

- `unit-tests`: Architektur-Regeln (Abschnitt 4), State-Contract- und
  Gate-Tests, `no-supabase-import`.
- `auth-journey`: echte Einstiegsreisen Werkbank (owner, `/planung`,
  `/kosten`) und Feld (member, `/feld`), Cross-Shell-Negativreise (403),
  Kosten-negativ/-positiv inkl. Mehr-Organisation, axe/Reflow auf
  1440/1920/720 (Werkbank) und 320/375 (Feld), Chunk- und
  Cookie-Manipulationssonden, benannte Screenshots als Artefakte.
- `web-smoke`: beide Shells fail-closed ohne API; Tokens, Fokus, Reflow.
- `build-web`: baut ohne Proxyziel (Laufzeitkonfiguration, EYT-126).

## 8. Kriterien für eine spätere physische/native Trennung

Eine native Mitarbeiter-App (oder eine physische Repo-Trennung der Shells)
ist zulässig, wenn alle folgenden Bedingungen gelten:

1. Sie konsumiert **dieselben versionierten Verträge** (`openapi/v1.json`)
   und dieselbe Auth-Basis; es entsteht **kein zweites Backend** und keine
   zweite Fachlogik — `packages/domain` und `packages/contracts` bleiben die
   einzigen Quellen.
2. Ein realer Bedarf erzwingt die Trennung: eigene Release-Kadenz /
   Store-Auslieferung, ein realer Offline-Fachvertrag oder native
   Gerätefähigkeiten (Push, Sensorik), die Mobile Web nicht trägt.
3. Die Importgrenze ist bereits heute die Extraktionsnaht: alles unter
   `app/feld/`, `components/feld/`, `lib/feld/` ist per
   `feld-shell-boundary` von Werkbank-, Admin- und Kostencode entkoppelt und
   kann ohne Umbau herausgelöst werden.
4. Serverseitige Ableitungen (Session-Verifikation, Start-Shell,
   `costs.read`-Grenze) bleiben serverseitig — ein nativer Client erhält sie
   über dieselben Endpunkte, nie als lokale Kopie.

Mobile Web ist ausdrücklich **kein Wegwerf-Prototyp**: die Feld-Shell ist
die erste produktive Mitarbeiter-Auslieferung auf denselben Verträgen.
