# EYT-106 — Reale Supabase-Identität und atomare Kostenrechte

**Stand:** 31.07.2026 · Basis `master` = `0f07047` (Post-Merge-CI 10/10) · Branch
`feat/eyt-106-real-identity`

Dieses Dokument ist Schritt 2 der vom Product Owner vorgegebenen Reihenfolge:
**Akzeptanzkriterien und reale Red Tests festlegen** — vor jedem Testcode und
lange vor Produktionscode.

Die Architekturentscheidung steht als Jira-Kommentar an EYT-106 (31.07.2026) und
ist hier nicht wiederholt, sondern vorausgesetzt.

---

## 0 — Was heute existiert, gemessen

Vollständige Aufklärung am Stand `0f07047`. Diese Befunde sind der Ausgangspunkt;
jeder ist mit Datei und Zeile belegt.

| Gegenstand           | Befund                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subjektauflösung     | `UnauthenticatedSubjectResolver` liest den Request **nicht** (`apps/api/src/common/tenant-subject.ts:72-78`), im echten `AppModule` verdrahtet (`app.module.ts:70-71`) |
| Zugriffsentscheidung | `DenyAllPlanningAccess` gibt bedingungslos `false` (`planning-access.port.ts:27-39`)                                                                                   |
| JWT-Bibliothek       | keine, in keiner `package.json`                                                                                                                                        |
| Vertrag              | `packages/contracts/openapi/v1.json` hat weder `securitySchemes` noch `security`                                                                                       |
| Claims               | werden **konstruiert**, nicht weitergereicht (`tenant-query-runner.ts:90-93`)                                                                                          |
| Browser              | sendet keinerlei Identität; Aufhänger existiert (`planning-gateway.ts:67`), wird nie durchgereicht (`providers.tsx:36-38`)                                             |
| Rollen               | `check (role in ('owner','member'))` (`0002_tenancy.sql:36`), von **keinem** Code und **keiner** Policy gelesen                                                        |
| RLS                  | 40 Policies, **keine** unterscheidet nach Rolle                                                                                                                        |
| Rechte               | existieren nur als Prosa (`ADR-003:52`, `sprint-5-daily-cost-export.prd.md:154`)                                                                                       |
| E2E-Nachweis         | hängt an `process.argv[2]` (`apps/api/test/harness/main.ts:10`)                                                                                                        |
| Seed                 | kann sich nicht anmelden — `encrypted_password` leer (`supabase/seed.sql:16`)                                                                                          |

## 1 — Skelettgrenze

Damit rote Tests an **Verhalten** scheitern und nicht an der Auflösung, entsteht
zuerst ein compile-enabling Skelett. Dieselbe Grenze wie in EYT-95:

**Erlaubt:** öffentliche Typen · Funktionssignaturen · gebrandete und validierte
Basistypen · Fehlercodes · sichere Konvertierungsgrenzen · Exporte und
Modulstruktur.

**Verboten:** fertige Verifikationslogik · fertige Rechteauflösung · echte
GoTrue-Aufrufe · **versteckte Defaultwerte, die Tests zufällig grün machen**.

**Rotnachweis-Maßstab:** Syntaxfehler, fehlende Abhängigkeit, falscher Importpfad
und kaputte Testkonfiguration gelten **nicht** als Rotnachweis. Ein Test zählt
erst, wenn er an einer Zusicherung scheitert.

## 2 — Neue Abhängigkeit

`jose` in `apps/api`, plus Eintrag `/^jose$/` in `API_ALLOWED_PACKAGES`
(`apps/api/test/architecture/rules.ts:98-105`). Ohne diesen Eintrag scheitert
`api-dependency-allowlist` — genau der vorgesehene Riegel.

**Warum eine Bibliothek und nicht `node:crypto`:** `node:crypto` steht bereits auf
der Liste, und WebCrypto könnte ES256 prüfen. JWT-Verifikation von Hand ist aber
eine bekannte Fehlerquelle — Alg-Confusion, `kid`-Behandlung, base64url-Kanten.
`jose` erzwingt die vom PO verlangte Algorithmus-**Allowlist**
(`algorithms: ["ES256"]`) statt einer Auswahl nach Token-Header und bringt
JWKS-Caching mit Rotation mit.

## 3 — Akzeptanzkriterien, je mit rotem Nachweis und Gegenmutation

Die AK-Nummern folgen der Jira-Beschreibung von EYT-106.

### AK1 — Browserlogin und fail-closed Tokenverifikation

|                    |                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| **Testdatei**      | `apps/api/test/auth/token-verifier.test.ts`                                                                |
| **Rote Prüfung**   | Ein lokal mit ES256 signiertes Token wird akzeptiert; sieben Manipulationsformen werden abgelehnt          |
| **Braucht Stack?** | **Nein** — Schlüsselpaare und Tokens werden im Test erzeugt                                                |
| **Gegenmutation**  | `algorithms: ["ES256"]` durch `algorithms: undefined` ersetzen → der HS256-Fall wird grün akzeptiert → rot |

Die sieben Ablehnungen einzeln, jede als **eigener** Fall mit eigenem Titel — nicht
als Schleife unter einer Assertion. Grund: in `planning-window.http.test.ts:107-109`
hängen vier Werte unter einer unbenannten Zusicherung, und eine gemessene
Fehlermeldung konnte deshalb nicht sagen, welcher Wert durchrutschte.

1. manipulierte Signatur
2. falscher Issuer
3. falsche Audience
4. abgelaufenes Token
5. fehlendes Subject
6. HS256-Token (Alg-Confusion)
7. unbekanntes `kid`

Zusätzlich: `alg=none` und ein Token ohne `session_id`.

### AK1b — Sessionprüfung am Auth-Server

|                    |                                                                              |
| ------------------ | ---------------------------------------------------------------------------- |
| **Testdatei**      | `apps/api/test/auth/session-liveness.test.ts`                                |
| **Rote Prüfung**   | Ein kryptografisch gültiges Token mit widerrufener Session wird abgelehnt    |
| **Braucht Stack?** | Nein — der Auth-Server sitzt hinter einem Port und wird im Test substituiert |
| **Gegenmutation**  | Die Livenessprüfung überspringen → widerrufene Session wird akzeptiert → rot |

**Offene Entwurfsfrage, hier benannt statt verschwiegen:** ob je Anfrage geprüft
oder mit kurzer Gültigkeit zwischengespeichert wird, und was bei nicht
erreichbarem Auth-Server geschieht. Vorgabe dieses Projekts ist **fail-closed** —
kein Zugriff, nicht „im Zweifel durchlassen". Ein Test hält genau das fest:
Auth-Server unerreichbar ⇒ Ablehnung, nicht Durchlass.

### AK2 — Serverseitige Auflösung von Nutzer, Mitgliedschaft, Organisation

|                    |                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Testdateien**    | `apps/api/test/auth/organisation-context.test.ts`, `apps/api/test/auth/auth.http.test.ts`                                                    |
| **Rote Prüfung**   | Eine Organisations-ID aus URL, Body oder unbestätigtem Header ändert das Ergebnis **nicht**                                                  |
| **Braucht Stack?** | Nein für die Auflösungslogik; ja für den RLS-Teil (siehe AK4)                                                                                |
| **Gegenmutation**  | Die Organisation aus dem Header übernehmen, statt sie gegen die aktive Mitgliedschaft zu prüfen → der Fremdorganisationsfall wird grün → rot |

Der Header `X-EasyTree-Organization-Id` **wählt nur aus**. Ein Test setzt eine
Organisation, in der das Subjekt **keine** aktive Mitgliedschaft hat, und erwartet
Ablehnung — nicht Auswahl.

Mehrere aktive Organisationen ohne explizite Auswahl ⇒ `400 ORG_CONTEXT_REQUIRED`.

### AK3 — Atomare Rechte als expliziter Vertrag

|                    |                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| **Testdatei**      | `apps/api/test/auth/cost-permissions.test.ts`                                                          |
| **Rote Prüfung**   | Die Matrix wird vollständig abgefahren: drei Rollen × vier Rechte = zwölf Fälle, jeder einzeln benannt |
| **Braucht Stack?** | Nein                                                                                                   |
| **Gegenmutation**  | `costs.manage_rates` bei `manager` ergänzen → der Fall „manager darf keine Sätze pflegen" wird rot     |

| Rolle     | costs.read | costs.manage_rates | costs.calculate | costs.export |
| --------- | :--------: | :----------------: | :-------------: | :----------: |
| `owner`   |     ✔      |         ✔          |        ✔        |      ✔       |
| `manager` |     ✔      |         —          |        ✔        |      ✔       |
| `member`  |     —      |         —          |        —        |      —       |

Zusätzlich eine **Vollständigkeitszusicherung**: jedes Recht aus der
Rechtekonstante kommt in der Matrix vor, und jede Rolle aus dem Rollencheck der
Migration ebenfalls. Sonst wächst eine Rolle oder ein Recht dazu, ohne dass ein
Test es bemerkt — dieselbe Lücke wie bei den `*_ERRORS`-Listen in EYT-95.

### AK4 — API und RLS lehnen unabhängig voneinander ab

|                    |                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **Testdateien**    | `apps/api/test/auth/cost-access.integration.test.ts` (PostgreSQL), `supabase/tests/00NN_cost_permissions.sql` (pgTAP)          |
| **Rote Prüfung**   | Ein `member` wird von der API abgelehnt **und**, unabhängig davon, von RLS                                                     |
| **Braucht Stack?** | **Ja** — läuft erstmals in CI (`db-gates`)                                                                                     |
| **Gegenmutation**  | `CostAccessPolicy` immer `true` zurückgeben lassen → der RLS-Teil muss **weiterhin** ablehnen; bleibt er grün, prüft er nichts |

Das ist der Kern der Unabhängigkeitszusage. Beide Seiten lesen dieselbe
Zuordnung (`role_permissions`), entscheiden aber getrennt. Der Test ist so
gebaut, dass das Ausschalten **einer** Seite die **andere** Seite rot macht — sonst
wäre „unabhängig" nur behauptet.

### AK5 — Mehrere aktive Organisationen

Abgedeckt unter AK2. `400 ORG_CONTEXT_REQUIRED`, nie stille Auflösung.

### AK6 — Service-Role- und Migrationszugangsdaten

|                    |                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------- |
| **Testdatei**      | `apps/api/test/auth/no-service-role-in-request-path.test.ts` (statischer Wächter)      |
| **Rote Prüfung**   | Kein Service-Role-Bezeichner erscheint in `apps/web` oder im regulären API-Anfragepfad |
| **Braucht Stack?** | Nein                                                                                   |
| **Gegenmutation**  | Eine Datei mit dem Bezeichner unter `apps/api/src/modules/` anlegen → rot              |

Heute ist die Lage gut: `ENV_VAR_META` kennt sechs Namen, und
`config.module.ts:13-19` verengt `process.env` vorher. Der Wächter hält diesen
Zustand fest, statt sich auf ihn zu verlassen.

### AK7 — Stabile, minimale Fehlerzustände

Abgedeckt unter AK1 und AK1b. Zusätzlich `401 AUTH_CREDENTIAL_CONFLICT`, wenn
Cookie und Bearer gleichzeitig vorhanden sind und **nicht dieselbe Identität**
ergeben — eigener Testfall in `auth.http.test.ts`.

### AK8 — Reale Browser-, API-, RLS- und Cross-Tenant-Nachweise

|                    |                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Testdateien**    | `apps/web/e2e/auth-journey.spec.ts`, Erweiterung von `scripts/read-through-harness.sh`                             |
| **Rote Prüfung**   | Die E2E-Reise verwendet **keine** injizierte Testidentität                                                         |
| **Braucht Stack?** | **Ja**                                                                                                             |
| **Gegenmutation**  | Die Subjektinjektion wieder aktivieren → der Test muss rot werden, weil er dann nicht mehr misst, was er behauptet |

Der heutige Harness übergibt das Subjekt per `process.argv[2]`. **Genau das
ersetzt EYT-106 — nicht ergänzt.**

### AK9 — Nachvollziehbarkeit ohne Geheimnisse

|                    |                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Testdatei**      | `apps/api/test/auth/auth-logging.test.ts`                                                                        |
| **Rote Prüfung**   | Jede Ablehnung trägt die Korrelations-ID; **kein** Token, kein Claim-Inhalt, keine Kostendaten erscheinen im Log |
| **Braucht Stack?** | Nein                                                                                                             |
| **Gegenmutation**  | Das rohe Token in die Ablehnungsmeldung aufnehmen → rot                                                          |

Heute setzt `correlation-id.middleware.ts:23-32` die ID auf Request und Response,
aber **kein Logger verbindet sie mit einer Zugriffsentscheidung**. Das ist neu zu
bauen.

## 4 — Was zuerst in CI läuft, nicht lokal

Diese Maschine kann den Supabase-Stack nicht starten. Für diese Teile gilt: sie
werden lokal geschrieben und in CI **zum ersten Mal ausgeführt** — dieselbe Lage
wie bei jeder Migration dieses Projekts.

- die Migration (Rollencheck erweitern + `role_permissions` + `app.has_cost_permission`)
- die pgTAP-Zusicherungen
- `cost-access.integration.test.ts`
- die E2E-Auth-Reise
- **OQ-005 in voller Länge** (sieben Nachweise)

## 5 — OQ-005: Blockadebedingung

Vor Abnahme ist mit dem tatsächlich verwendeten Supabase-CLI-Stand zu beweisen,
dass asymmetrisches Signing lokal aktivierbar ist, der Stack damit startet, GoTrue
über einen echten Login ein Token ausstellt, dessen Header einen asymmetrischen
Algorithmus und ein `kid` trägt, der JWKS-Endpunkt einen passenden öffentlichen
Schlüssel liefert, die API das gültige Token akzeptiert und die sieben
Manipulationsformen ablehnt.

**Kein stiller Rückfall auf HS256.** Ist der lokale Support nicht gegeben:
`OQ-005: BLOCKED_LOCAL_JWKS_SUPPORT` melden und den kleinsten realen CI- bzw.
Hosted-Supabase-Durchstich vorschlagen.

`supabase/config.toml:168-169` hat `signing_keys_path` heute auskommentiert —
lokal gilt also der HS256-Standard der CLI. Ob die eingesetzte CLI-Version
asymmetrisches Signing und einen JWKS-Endpunkt anbietet, ist ohne laufenden Stack
**nicht** messbar und damit die erste zu beantwortende Frage.

## 6 — Migration: ein Schritt, kein Zwischenzustand

Rollencheck erweitern **und** `role_permissions` anlegen **in derselben
Migration**. Getrennt entstünde ein Zustand, in dem Rechte für eine noch
unzulässige Rolle existieren.

Vorwärtsgerichtet, append-only, mit `NNNN`-Fortsetzung im Dateinamen.
Definition of Done: zwei aufeinanderfolgende `db reset` plus grünes
`supabase test db`.

`role_permissions` erhält **keine** Schreibrechte für normale Anwendungsrollen;
Änderungen laufen ausschließlich über versionierte Migrationen. Eine pgTAP-Zusicherung
hält das fest.

## 7 — Web-Guard: absichtsbasiert

`apps/web/test/no-supabase-import.test.ts:12` verbietet heute exakt
`"@supabase/supabase-js"`; `@supabase/ssr` fällt nicht darunter — gemessen.

Neue Formulierung: direkte Imports aus `@supabase/*` sind im geschützten Webcode
verboten, zulässig ausschließlich in einem explizit benannten Auth-Adapter.
Negativtests für `@supabase/supabase-js`, `@supabase/ssr` und ein beliebiges
weiteres `@supabase/*`-Paket; Positivtest für den erlaubten Adapterpfad.

Nach der Entscheidung des PO liegt dieser Adapter in `apps/api`, nicht in
`apps/web` — der Guard für `apps/web` bleibt damit ein reines Verbot ohne
Ausnahme, und der Positivtest prüft, dass die Ausnahmemechanik selbst greift.

## 8 — Ausdrücklich nicht Teil von EYT-106

- **Der sporadische `weekKey`-Befund.** Getrennt untersucht (596 Läufe, nicht
  reproduziert, vier Ursachenklassen ausgeschlossen). **Keine spekulative
  Reparatur hier.**
- **Die drei ungetesteten Eingabeprüfungen des Schreibwegs**
  (`planning.controller.ts:267`, `:314` — der Idempotenzschlüssel aus EYT-92 —,
  `:323`). Gemeldeter Befund, gehört zu EYT-107.
- Einladungsverwaltung, Passwort-Reset, beliebige Rollenbearbeitung, vollständiger
  Abschluss von EYT-14/EYT-87.
- **Kein Vorziehen von EYT-108 bis EYT-110.**

## 9 — Offene Punkte vor dem ersten Testcode

1. **Zustimmung zu `jose`** als neue Abhängigkeit von `apps/api`, mit Eintrag in
   `API_ALLOWED_PACKAGES`.
2. **Sessionprüfung: je Anfrage oder zwischengespeichert?** Der Entwurf braucht
   eine Entscheidung, weil sie Latenz und Verfügbarkeit des Lesepfads verändert.
   Vorschlag: je Anfrage, solange keine Messung ein Problem zeigt — die einfachere
   und sicherere Variante zuerst, Zwischenspeicherung erst gegen einen belegten
   Bedarf.
3. **OQ-005 zuerst.** Sinnvollerweise beantwortet ein kleiner CI-Lauf die
   JWKS-Frage, bevor Testcode gegen eine Annahme entsteht, die nicht trägt.
