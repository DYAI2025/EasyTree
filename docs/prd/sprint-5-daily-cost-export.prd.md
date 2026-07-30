# PRD – Sprint 5 Daily Cost Export

Status: user-confirmed
Confirmed by user: yes
Bestätigt am: 2026-07-30 durch den Product Owner (Benjamin Poersch).
Grundlage der Markierung: PO-Weisung vom 30.07.2026 — Scope-Entscheidung „voller Scope, keine
Must-Kürzung" plus die Auflage, erst nach erfolgreichem Abgleich gegen die Confluence-Baseline
zu markieren, und die Freigabe „Vision, Canvas, Feature-PRD und Traceability dürfen nach
erfolgreichem erneuten Abgleich als bestätigt markiert werden, sofern keine andere materielle
Abweichung offen ist". Bedingung geprüft und erfüllt: Abgleich gegen Confluence PRD v1.4
(7766017) und Sprint-5-Seite (8552449) am 30.07.2026, DIV-S5-001…009 abgearbeitet, keine
materielle Abweichung offen; verblieben `DOC-DRIFT-S5-001` (kein Blocker).
Nicht mitbestätigt: technische Kapazität für die Fertigstellung (nur der Start ist freigegeben),
die lokalen Zusätze REQ-G01/REQ-G02, sowie das **Vision-GO** — das ist ein eigenes Signal und
liegt weiterhin beim Product Owner.
Feature Slug: `sprint-5-daily-cost-export`

- Canvas: [`docs/canvas/sprint-5-daily-cost-export.canvas.md`](../canvas/sprint-5-daily-cost-export.canvas.md)
- Vision: [`docs/vision/sprint-5-daily-cost-export.vision.md`](../vision/sprint-5-daily-cost-export.vision.md)
- Traceability: [`docs/traceability.md`](../traceability.md), Abschnitt „Sprint 5"

> **Bestätigt am 30.07.2026.** Der Product Owner hat am
> 30.07.2026 den **Scope** verbindlich entschieden (voller Umfang, keine Must-Kürzung) und
> aufgetragen, die lokalen Artefakte erst nach Abgleich ohne materielle Abweichung gegen die
> Confluence-Baseline als bestätigt zu markieren. Der Abgleich ist unten geführt und ist
> **abgeschlossen: keine materielle Abweichung mehr offen.** Verblieben ist ein
> Dokumentationsdrift (`DOC-DRIFT-S5-001`), der ausdrücklich **kein** Implementierungsblocker
> ist.

## Baseline und Autoritätsordnung

Verbindlich festgelegt vom Product Owner am 30.07.2026:

| Rang | Quelle                                                                                                                                     | Rolle                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 1    | **Confluence PRD v1.4** — „EasyTree – PRD v1.4: Planung, Feldkommunikation und interne Baustellenkosten" (Seite 7766017, Stand 28.07.2026) | fachliche Produktbaseline für MVP-Scope und Phasen                                   |
| 2    | Confluence Sprint-5-Seite (8552449)                                                                                                        | Sprintziel und Sprint-5-Schnitt                                                      |
| 3    | Jira EYT-95, EYT-105 – EYT-110                                                                                                             | ausführbare Ticketverträge                                                           |
| 4    | Repository-PRD v1.3 (`docs/prd/CURRENT_PRD_v1.3.md`, `arboscus_teamplaner_finale_prd_de_v1.3.md`)                                          | weiterhin gültig, **soweit nicht von PRD v1.4 ersetzt**                              |
| 5    | `CLAUDE.md`                                                                                                                                | operative Agentenanweisung; bei Widerspruch zur neueren Produktbaseline nachzuziehen |

**PRD v1.4, gelesen und verifiziert am 30.07.2026.** §10 ersetzt v1.3 ausdrücklich: „Die gesamte
Planungsökonomie ist nicht mehr pauschal Post-MVP. Interne Kostensätze, Plan-/Ist-Kosten und
Excel-Export gehören als begrenzter modularer Schnitt zum MVP." §7 führt „interne Kosten und
Aufwandstransparenz", „Plan-/Ist-Vergleich" und „Excel-Kostenexport" unter **Im MVP**.
Maschinenverleiherlöse, Rechnung/Steuer/Zahlung/Buchung, DATEV/ERP/Payroll und automatische
Wirtschaftlichkeitsentscheidungen bleiben Post-MVP. Sprint 5 ist damit MVP-Scope und benötigt
**keine** Eröffnung einer Post-MVP-Phase.

### Zuordnung Sprint-5-Requirements → PRD v1.4

| Sprint-5-REQ | PRD v1.4                                                       | Schnittgrenze in Sprint 5                                                                                                                                                                                          |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-001      | §5 NFR (zentrale Verträge), §6                                 | Kostenmodul als Träger der zentralen Geld-/Rundungs-/Kostenverträge                                                                                                                                                |
| REQ-002      | §3 Nutzer und Rechte                                           | atomare Kostenrechte; „ein gültiger Login allein verleiht kein Recht"                                                                                                                                              |
| REQ-003      | FR-009 (veröffentlichte Planversion als Quelle), FR-001/FR-002 | nur der Publish-Core, keine vollständigen Konfliktregeln                                                                                                                                                           |
| REQ-004      | **FR-008**                                                     | v1.4 deckt Stunden- **und** Tagessätze für Mitarbeiter, freie Mitarbeiter, Fahrzeuge, Geräte, Maschinen. **Sprint 5 liefert ausschließlich Mitarbeiter-Stundensätze** — bewusst engerer Schnitt, kein Widerspruch. |
| REQ-005      | **FR-009**, §6 (Geld/Rundung, historische Stabilität)          | nur Plan-Personalkosten; Ressourcenkosten nicht im Schnitt                                                                                                                                                         |
| REQ-006      | **FR-011**                                                     | v1.4 fordert Plan- **und** Ist-Kosten nach Einsatz/Baustelle/Tag/KW/Zeitraum. **Sprint 5 liefert Plan-Kosten nach Baustelle und lokalem Tag.** FR-010 (Ist-Kosten) ist ausdrücklich nicht im Schnitt.              |
| REQ-007      | **FR-012**                                                     | Sprint 5 geht über FR-012 hinaus: der Export rendert einen **gespeicherten Snapshot** statt neu zu rechnen — strenger, nicht abweichend.                                                                           |
| REQ-008      | §9 Akzeptanz des erweiterten MVP                               | Sprint-5-Teilmenge der dortigen Akzeptanzliste                                                                                                                                                                     |

**Gemessener Stand 30.07.2026.** Jira: alle sieben Tickets im offenen Sprint, alle
_Zu erledigen_. Vorbedingungen EYT-45/46/47/49/50/61/62/79/86/88/91/92 auf _Fertig_; Sprint 4
gemerged (PR #35, `origin/master` = `f9da445`) — deckungsgleich mit der Baseline-Kopfzeile.
Offen und für REQ-002 relevant: EYT-14, EYT-18, EYT-36, EYT-37, EYT-87, EYT-94.
**Abweichend von Sprint-5-Baseline §11:** der Jira-Sprint-Container existiert inzwischen und
enthält genau diese sieben Tickets; das Developers-Gate ist durch die PO-Entscheidung vom
30.07.2026 für den **Start** geschlossen. Die Confluence-Kopfzeile („Sprintkandidat,
Developers-Gate offen") ist damit veraltet.

## Reihenfolge und Parallelität (Baseline §7, vom PO bestätigt)

```text
1. EYT-105  Kostenmodul + ADR            ─┐ begrenzt parallel
2. EYT-95   Money-/Rate-/Rundungsvertrag ─┤
3. EYT-106  Auth + atomare Kostenrechte  ─┘
4. EYT-107  Publish-Core
5. EYT-108  Mitarbeiter-Stundensatz
6. EYT-109  Tageskosten-Snapshot + /kosten     ← erst nach den vier harten Vorbedingungen
7. EYT-110  XLSX aus demselben Snapshot        ← erst nach stabilem Snapshot
```

Auth und Publish müssen belastbar stehen, **bevor** der sichtbare Kostenpfad beginnt.

---

## REQ-001 – Explizites Kostenmodul

**Baseline:** S5-REQ-01 · **Jira:** EYT-105 · **Status:** EXPLICIT

### Requirement

Das Kostenmodul wird als klar abgegrenztes Fachmodul im bestehenden modularen Monolithen
implementiert. `apps/api/src/modules/costs/` erhält `domain/` (Money, Rate,
Effective-Date-Auswahl, Tagesallokation, Rundung), `application/` (Satz-Commands,
Snapshot-Use-Case, Query- und Export-Ports), `infrastructure/` (PostgreSQL-Repositories,
XLSX-Renderer), `interface/http/` (autorisierte Controller, explizites Mapping) und eine
schmale `index.ts`.

### Binäre Akzeptanz (Baseline S5-REQ-01)

- `costs` ist in ADR, `MODULE_SLUGS`, `SCAFFOLDED_MODULES` und Tabellenbesitz registriert.
- Architekturtests lehnen ab: Frameworkimports in Domaincode, tiefe Querimporte, fremde
  Tabellenzugriffe (lesend **und** schreibend — EYT-105 AK: Planfakten werden „nur über eine
  öffentliche Planning-Application-API … **gelesen**"), zweite Geld-/Rundungsimplementierung.
  **Ehrliche Reichweite:** das ist ein **Quelltextwächter**, keine Laufzeitdurchsetzung. Zur
  Laufzeit gibt es genau eine Anwendungsrolle, und RLS filtert nach Mandant, nicht nach Modul.
  ADR-001s „Tabellenbesitzregeln werden in CI geprüft" gilt dadurch **nicht** als erfüllt und
  darf so auch nicht gemeldet werden.
- Planung stellt veröffentlichte Planfakten über eine **öffentliche Application-API** bereit;
  das Kostenmodul schreibt nur eigene Tabellen.
- Kein generischer `shared`-/`services`-Container, keine direkte Browsermutation, kein
  verteilter Dienst.
- Der XLSX-Renderer hängt hinter einem Application-Port und rechnet nicht neu (EYT-105).

### AC-001

**Given** das Repository besitzt mehrere Fachmodule, **when** das Kostenmodul ergänzt wird,
**then** Domain, Application, Infrastructure und HTTP-Interface sind getrennt und
Architekturtests verhindern Frameworkimports in der Domain sowie tiefe Querimporte.

### Evidence

- `EV-001-A` positiver Architekturtest; `EV-001-B` Gegenmutation mit tiefem Querimport;
  zusätzlich Gegenmutationen für fremden Tabellenwrite, `shared/services`-Container und zweite
  Money-Implementierung (EYT-105).
- CI-Zuordnung: **MISSING** (`OQ-003`).

### Repository-Befund (gemessen 2026-07-30)

`apps/api/src/modules/` enthält `planning/`, `worksites/`, `workforce/`,
`module-catalogue.ts`. `costs` fehlt in `MODULE_SLUGS`; die Liste gilt als eingefroren und aus
ADR-001 abgeleitet ⇒ neue ADR nötig, und `architecture-red-case.test.ts` darf dabei ihre
Rot-Fähigkeit nicht verlieren.

---

## REQ-002 – Reale Identität und atomare Kostenrechte

**Baseline:** S5-REQ-02 · **Jira:** EYT-106 · **Status:** EXPLICIT

### Requirement

Der vertikale Kostenpfad verwendet eine real verifizierte Supabase-Session und serverseitig
aufgelöste Organisations- und Rechteinformation.

### Binäre Akzeptanz (Baseline S5-REQ-02)

- Browser meldet sich gegen die lokale/testende Supabase-Auth-Grenze an; die API verifiziert
  Signatur, Issuer, Audience und Ablauf **fail-closed**.
- Nutzer, aktive Mitgliedschaft und Organisation werden serverseitig aufgelöst; keine
  Organisations-ID aus URL, Body oder unbestätigtem Header wird geglaubt.
- Atomare Rechte: `costs.read`, `costs.manage_rates`, `costs.calculate`, `costs.export`.
- Administration/Geschäftsführung erhalten nur die benötigten Rechte; Mitarbeiter werden in
  API **und** RLS unabhängig voneinander abgelehnt.
- **Kein Service-Role-Secret erreicht den Browser** oder den regulären API-Pfad.
- Mehrere aktive Organisationen werden nicht still aufgelöst (EYT-106).
- Zugriff und Ablehnung sind mit Korrelations-ID nachvollziehbar, ohne Token oder Kostendaten
  in Logs (EYT-106).

### AC-002

**Given** ein real angemeldeter Admin- oder Geschäftsführungsnutzer, **when** dieser Kosten
liest, Sätze pflegt, berechnet oder exportiert, **then** verlangt jede Aktion das passende
atomare Recht.

**Given** ein Mitarbeiter oder fremder Tenant, **when** derselbe Zugriff versucht wird,
**then** lehnen API und RLS unabhängig voneinander ab.

### Evidence

- echter Browserlogin; direkte API-Negativprobe; RLS-Negativprobe; abgelaufener, widerrufener
  und falsch signierter Token; fremder Tenant;
- Gegenmutation: API erlaubt Zugriff → RLS muss weiter blockieren;
- CI-Zuordnung: **MISSING** (`OQ-003`).

### Offener Punkt (`OQ-005`, nicht senkbar)

Die Produktions-Policy ist heute bewusst `deny all`; der Sprint-4-Nachweis lief über ein
serverseitig injiziertes Subjekt (`apps/api/test/harness/server.ts`). Genau das ist hier
**verboten** — PO-Weisung 30.07.2026: „EYT-106 darf nicht durch eine injizierte Testidentität
ersetzt oder gekürzt werden." Der Preflight misst, ob eine echte Auth-Grenze lokal und/oder in
CI erreichbar ist; das Ergebnis wird vorgelegt, die Anforderung wird nicht gesenkt.

---

## REQ-003 – Unveränderliche veröffentlichte Planquelle

**Baseline:** S5-REQ-03 · **Jira:** EYT-107 · **Status:** EXPLICIT

### Requirement

Kosten dürfen nur aus einer autorisiert und idempotent veröffentlichten Planversion entstehen.

### Binäre Akzeptanz (Baseline S5-REQ-03)

- Der vorhandene `publishPlan`-Vertrag erhält einen autorisierten, idempotenten und
  auditierten Serverpfad; `expectedVersionId` und validierter Idempotenzschlüssel sind Pflicht.
- Nur ein konfliktfreier Entwurf wird **atomar** veröffentlicht; Audit, Outbox und
  Idempotenzdatensatz committen mit.
- Der Kostenpfad akzeptiert ausschließlich eine veröffentlichte Planversions-ID.
- Noch nicht vorhandene Ressourcen-/Abwesenheits-/Qualifikationsregeln werden **nicht** als
  geprüft behauptet; **EYT-18 bleibt offen** und wird durch diesen Teilschnitt nicht auf Fertig
  gesetzt.
- Die Planungsoberfläche zeigt Erfolg, Konflikt und Stale-Version ohne optimistische
  Scheinveröffentlichung (EYT-107).

### AC-003

**Given** ein konfliktfreier Entwurf und erwartete Version, **when** Publish erfolgreich
ausgeführt wird, **then** committen Planversion, Assignments, Audit, Outbox und
Idempotenzwirkung atomar.

**Given** Konflikt, Stale Version oder Retry, **when** Publish ausgeführt wird, **then**
entsteht keine zweite Veröffentlichung und keine Teilwirkung.

### Evidence

- zwei parallele Publish-Verbindungen; Retry mit gleichem Schlüssel; Fault Injection nach
  einzelnen Wirkungen; Reload und zweiter Browserkontext;
- CI-Zuordnung: **MISSING** (`OQ-003`).

---

## REQ-004 – Versionierte Mitarbeiter-Stundensätze

**Baseline:** S5-REQ-04 · **Jira:** EYT-108 · **Status:** EXPLICIT

### Requirement

Mitarbeiter-Stundensätze werden als unveränderliche Effective-Date-Versionen in
EUR-Minor-Units gespeichert.

### Binäre Akzeptanz (Baseline S5-REQ-04)

- Erster Slice: individuelle Mitarbeiter-Stundensätze, **netto EUR**, Betrag in Minor Units,
  `gültig ab` als lokales Geschäftsdatum, optional `gültig bis`, Intervallsemantik zentral.
- Sätze sind append-only versioniert mit Referenz auf den Vorgänger; gleiche
  Mitarbeiter-/Satzart-Intervalle dürfen sich **nicht** überschneiden — server- **und**
  datenbankseitig, auch unter Paralleländerung.
- Fehlende, mehrdeutige oder nicht gültige Sätze **blockieren** die Berechnung.
- Expliziter Nullsatz ist von fehlendem Satz unterscheidbar; negative Beträge unzulässig.
- Anlage und Lesen laufen über `CostsGateway`, autorisierten Domain-Command,
  `TenantQueryRunner` und RLS; der Browser schreibt nie direkt nach Supabase.
- Sichtbare Administrationsoberfläche zeigt Version, Gültigkeit, Status; Mitarbeiter erhalten
  weder Route noch API-Daten.
- Tagessätze, freie Mitarbeiter und Fahrzeug-/Gerätesätze bleiben bewusst nachgelagert.

### AC-004

**Given** ein Mitarbeiter und ein Gültigkeitsintervall, **when** ein neuer Satz gespeichert
wird, **then** bleiben bestehende Versionen unverändert und parallele überlappende Intervalle
werden verhindert.

### Evidence

- Grenzdatum; expliziter Nullsatz; fehlender Satz; parallele Überlappung; Cross-Tenant; Retry;
  spätere Änderung beeinflusst alten Snapshot nicht;
- CI-Zuordnung: **MISSING** (`OQ-003`).

---

## REQ-005 – Deterministischer Kosten-Snapshot

**Baseline:** S5-REQ-05 · **Jira:** EYT-95, EYT-109 · **Status:** EXPLICIT

### Requirement

Eine veröffentlichte Planversion erzeugt einen unveränderlichen Tageskosten-Snapshot.

### Binäre Akzeptanz (Baseline S5-REQ-05)

- Eingabe: veröffentlichte Planversion plus optionaler Baustellenfilter desselben Mandanten;
  Entwürfe, fremde Planversionen und clientseitige Organisations-IDs werden abgelehnt.
- Zuweisungen werden nach **IANA-Organisationszeitzone** auf lokale Kalendertage verteilt;
  über Mitternacht laufende Einsätze deterministisch geteilt.
- Jede Position speichert Planversion, Assignment, Baustelle, Mitarbeiter, lokales Datum,
  Dauer, Satzversion, Regelversion, Betrag, Erzeugungszeitpunkt, Korrelations-ID.
- Geld wird nur in Minor Units bzw. ganzzahliger Zwischenrechnung verarbeitet — zentrale
  Rundungsregel aus EYT-95, keine Gleitkommaarithmetik.
- Snapshot und Positionen sind nach Erstellung **unveränderlich**; spätere Sätze verändern sie
  nicht.
- Wiederholung mit identischem fachlichem Input liefert denselben Snapshot bzw. eine
  nachweislich äquivalente idempotente Antwort ohne Doppelwirkung.

### AC-005

**Given** veröffentlichte Assignments und gültige Stundensätze, **when** ein Snapshot erzeugt
wird, **then** werden Einsätze in der Organisationszeitzone auf lokale Tage verteilt und jede
Position speichert ihre fachliche Herkunft.

**Given** ein Einsatz über Mitternacht, **when** der Snapshot berechnet wird, **then** werden
Dauer und Betrag deterministisch auf echte lokale Kalendertage aufgeteilt.

### Evidence

- Sommer-/Winterzeit; Mitternachtsgrenze; Property-Test für Summenerhaltung; fehlender Satz
  blockiert; spätere Satzänderung verändert Snapshot nicht; gleicher Input erzeugt keine
  Doppelwirkung;
- CI-Zuordnung: **MISSING** (`OQ-003`).

### ADR-Entscheidung zu REQ-001 (abgeleitet aus der Jira-AK, keine Ermessensentscheidung)

EYT-105 AK 1 verlangt wörtlich „**Eine neue ADR** ergänzt `costs` als Fachmodul". Damit ist
entschieden: es entsteht **ADR-003**, keine stille Fortschreibung von ADR-001 (vorhanden sind
ADR-001 und ADR-002).

Folgewirkung, die zwingend mitgeht: `MODULE_SLUGS` trägt heute den Kommentar, die Liste sei
„aus ADR-001 Z. 60 abgeleitet". Mit `costs` wird diese Herkunftsbehauptung **falsch** — ADR-001
Z. 60 kennt kein Kostenmodul. ADR-003 muss deshalb ausdrücklich festhalten, dass es die
Modulliste aus ADR-001 **erweitert**, und der Doc-Kommentar in `module-catalogue.ts` ist auf
beide Quellen umzustellen. Eine Ergänzung ohne diese Klarstellung hinterlässt eine falsche
Herkunftsangabe im Katalog.

### Berechnungsvertrag (PO-Entscheidungen vom 30.07.2026, verbindlich)

Vier offene Punkte der Testableitung sind entschieden. Alle vier sind Geldkorrektheit und
waren nicht ableitbar; sie wurden dem Product Owner vorgelegt und nicht geraten.

#### V1 — Rundung: `HALF_UP`, genau einmal

```text
COST_RULE_VERSION = "personnel-plan-cost-v1"
ROUNDING_MODE     = "HALF_UP"          # Halbwert von null weg
ROUNDING_STAGE    = "COST_POSITION_FINAL_AMOUNT"
CURRENCY          = "EUR"
```

1. Geld ausschließlich in EUR-Minor-Units.
2. Dauer und Mengen als exakte Ganzzahl oder rationaler Bruch.
3. **Keine Gleitkommaarithmetik.**
4. Zwischenergebnisse werden **nicht** gerundet.
5. Gerundet wird **genau einmal**, beim Erzeugen der persistenten Kostenposition.
6. Halbwert von null weg: `0,5 Cent → 1 Cent`.
7. Tages-, Baustellen- und Gesamtsummen entstehen **ausschließlich** durch Addition der
   bereits gerundeten, persistierten Positionsbeträge.
8. Summen werden **nie** erneut aus ungerundeten Ausgangswerten berechnet oder separat gerundet.

Die Regel ist **nicht** mandanten- oder nutzerkonfigurierbar. Jeder Snapshot und jede Position
referenzieren die Regelversion. Ein Wechsel erfolgt nur über neue Regelversion und Forward-Fix,
nie rückwirkend.

#### V2 — Mengeneinheit: ganzzahlige Millisekunden, BigInt

Kanonische Dauer ist `endEpochMilliseconds - startEpochMilliseconds` als **ganzzahlige
Millisekunden**. Minuten und Stunden sind Darstellung, nicht Rechengrundlage.

```text
amountNumerator   = rateMinorUnitsPerHour × durationMilliseconds
amountDenominator = 3_600_000
amountMinorUnits  = roundHalfUp(amountNumerator / 3_600_000)
```

Beispiel: `10.001 Cent/h × 1.800.000 ms = 18.001.800.000 / 3.600.000 = 5.000,5 → 5.001 Cent`.

**`durationMinutes()` aus `time-interval.ts` darf im Kostenpfad nicht verwendet werden** — es
rechnet `durationMs / 60_000` und liefert bei Millisekundenanteil einen Gleitkommawert. Die
Division durch `3_600_000` erzeugt **keine** zusätzliche Rundungsstelle, solange Zähler und
Nenner ganzzahlig bleiben und nur der Endbetrag gerundet wird. Multiplikation und Division mit
`bigint` oder nachweislich exakter Entsprechung. Vor jeder Konvertierung nach `number` muss
feststehen, dass der Wert nur der Anzeige dient und nicht in eine Berechnung zurückfließt.

Dass Planeinsätze in der UI minutengenau eingegeben werden, ist eine Eingaberegel der
Planungsdomäne. Sie zwingt die Geldarithmetik **nicht**, Sekunden- oder Millisekundenanteile zu
runden oder still zu verwerfen; die Kosten-Domäne verlässt sich nicht ungeprüft darauf.

#### V2b — Sicherheitsgrenze vor `BigInt` (PO 30.07.2026)

Die Konvertierung nach `bigint` ist eine Fehlerquelle, keine Formalität. `durationMs` muss
**vor** der Konvertierung geprüft sein:

```text
endlich · ganzzahlig · nichtnegativ · Number.isSafeInteger(durationMs)
```

Verboten und je einzeln abzuweisen:

```text
BigInt(7.5)        BigInt(NaN)        BigInt(Infinity)
BigInt(eines unsicheren Number-Werts)
```

Vertrag:

```text
toDurationMilliseconds(value: number): DurationMilliseconds
```

mit **fail-closed** Validierung vor `BigInt(value)`. Die Differenz zweier Epoch-Millisekunden
ist für realistische Einsatzintervalle sicher darstellbar — **diese Annahme ist zu prüfen und
darf nicht still vorausgesetzt werden.**

#### V2e — `AMOUNT_NOT_FINITE`: dieselbe Eingabeklasse, derselbe Name

Beim Bauen des Skeletts fiel eine unbeabsichtigte Asymmetrie auf: `toDurationMilliseconds`
meldet für `NaN` und `Infinity` laut V2b `QUANTITY_NOT_FINITE`, während `moneyFromNumber`
dieselbe Eingabeklasse in `AMOUNT_NOT_INTEGER` faltete. Zwei benachbarte Zahlengrenzen, ein
Eingabefall, zwei Namen.

`MONEY_ERRORS` wird deshalb um **`AMOUNT_NOT_FINITE`** erweitert, und `moneyFromNumber` prüft in
derselben Reihenfolge wie die Mengengrenze:

```text
1. Number.isFinite(value)      sonst AMOUNT_NOT_FINITE
2. Number.isInteger(value)     sonst AMOUNT_NOT_INTEGER
3. Number.isSafeInteger(value) sonst AMOUNT_NOT_SAFE_INTEGER
```

Die Reihenfolge ist aus demselben Grund verbindlich wie in V2b: `Number.isSafeInteger(NaN)` ist
ebenfalls `false`, wer die Sicherheitsprüfung vorzieht meldet für `NaN` den falschen Code.

**Warum jetzt und nicht später:** diese Codes werden Teil des HTTP-Vertrags, sobald EYT-105
Beträge annimmt. Danach ist die Asymmetrie nicht mehr geräuschlos korrigierbar.

Die Zusicherung dazu ist bewusst **zweigleisig** gebaut, damit sie eine spätere Umbenennung
überlebt: ein Test pinnt den Namen, ein zweiter fordert nur, dass nicht endliche und gebrochene
Beträge **unterscheidbare** Codes liefern.

#### V2c — Gemessene Grundlage von V2b und die daraus folgende Prüfreihenfolge

Die drei folgenden Punkte sind **gemessen** (Node, 30.07.2026), nicht angenommen. Sie sind der
Grund, warum V2b `Number.isSafeInteger` fordert und nicht bloß eine Ausnahmebehandlung.

**1. Drei der vier verbotenen Konvertierungen sind laut, die vierte ist still.**

```text
BigInt(7.5)                        -> wirft RangeError
BigInt(NaN)                        -> wirft RangeError
BigInt(Infinity)                   -> wirft RangeError
BigInt(Number.MAX_SAFE_INTEGER+2)  -> wirft NICHT, liefert 9007199254740992n
```

Ein `try/catch` um `BigInt(value)` fängt die ersten drei und lässt **genau den gefährlichen**
durch: einen plausibel aussehenden Wert, der nicht mehr eindeutig auf seine Herkunft
zurückführbar ist. Deshalb ist die Prüfung Pflicht, nicht die Ausnahme.

**2. Die Prüfreihenfolge ist Teil des Vertrags, nicht Kosmetik.**

`Number.isSafeInteger(NaN)` ist ebenfalls `false`. Wer die Sicherheitsprüfung vorzieht, meldet
für `NaN` fälschlich `QUANTITY_NOT_SAFE_INTEGER` statt `QUANTITY_NOT_FINITE`. Verbindlich:

```text
1. Number.isFinite(value)      sonst QUANTITY_NOT_FINITE
2. Number.isInteger(value)     sonst QUANTITY_NOT_INTEGER
3. value >= 0                  sonst QUANTITY_NEGATIVE
4. Number.isSafeInteger(value) sonst QUANTITY_NOT_SAFE_INTEGER
5. erst jetzt BigInt(value)
```

**3. Die zu prüfende Annahme ist wirklich eine Annahme.**

```text
Date-Spanne (-8.64e15 .. +8.64e15) = 17_280_000_000_000_000
Number.MAX_SAFE_INTEGER            =      9_007_199_254_740_991
```

Die Spanne ist **größer** als der sichere Ganzzahlbereich. Die Differenz zweier **gültiger**
`Date`-Werte kann damit unsicher werden — der Fail-closed-Fall ist kein hypothetischer
Überlauf, sondern mit echten `Date`-Objekten erreichbar. Die Annahme „für realistische
Einsatzintervalle sicher darstellbar" wird deshalb zweiseitig geprüft: die akzeptierte
Bandbreite muss den realistischen Planungsraum tragen (366 Tage = 31.622.400.000 ms, das
14,7-fache von 2³¹), **und** jenseits der Sicherheitsgrenze muss sie geschlossen sein.

#### V2d — Zwei Schnittstellenentscheidungen, aus bestehenden Repo-Verträgen abgeleitet

Beide sind **keine** Ermessensentscheidungen; sie folgen aus bindenden Konventionen.

**Rückgabeform: `DurationMillisecondsResult`, nicht ein blanker Typ.** Der PO-Vertrag skizziert
`toDurationMilliseconds(value: number): DurationMilliseconds`. Vier einzeln unterscheidbare
Ablehnungen lassen sich so nur über Ausnahmen ausdrücken. `CLAUDE.md` ist dazu bindend —
„Gateway ports model failure in the return type, not in exceptions" — und `TimeIntervalResult`
im selben Paket ist das Vorbild. Der vom PO gesetzte **Name bleibt unverändert**; nur der
Rückgabetyp ist die im Repo übliche diskriminierte Union.

**Namensnähe `durationMilliseconds(bigint)` / `toDurationMilliseconds(number)` bleibt.** Die
beiden sind beim Überfliegen ähnlich, aber ihre Parametertypen sind disjunkt — TypeScript
verhindert die Verwechslung mechanisch. Ein Umbenennen brächte Änderungsaufwand ohne
zusätzliche Sicherheit.

#### V1b — Eigentum des Summenvertrags (PO 30.07.2026)

Die Regel „Gesamtsummen entstehen durch Addition bereits gerundeter persistierter
Positionsbeträge" ist geteilt:

| Anteil                                                                                | Ticket      |
| ------------------------------------------------------------------------------------- | ----------- |
| arithmetische Invariante `total = sum(positionAmounts)`                               | **EYT-95**  |
| Persistenz, Snapshotpositionen, tatsächliche Summenbildung aus gespeicherten Beträgen | **EYT-109** |

EYT-95 testet den reinen Summenvertrag und zieht dafür **keine Snapshotpersistenz vor**.

#### Grenzen des compile-enabling Skeletts (PO 30.07.2026)

Erlaubt: öffentliche Typen · Funktionssignaturen · gebrandete bzw. validierte Grundtypen ·
Fehlercodes · sichere Konvertierungsgrenzen · Exporte und Modulstruktur.

**Noch nicht erlaubt:** fertige `HALF_UP`-Berechnung · vollständige Satzversionsauswahl ·
finale Intervalllogik · echte Kostenberechnung · Snapshotlogik · **versteckte Defaultwerte, die
Tests zufällig grün machen**.

Nach dem Skelett laufen die Tests erneut. **Starker Red-Nachweis** liegt erst vor, wenn die
Tests die jeweilige Funktion tatsächlich erreichen und aus einem fachlich spezifischen Grund
scheitern — mindestens je eine gezielte rote Prüfung pro Vertragsklasse:

| Klasse        | fachlich spezifischer roter Grund                                                |
| ------------- | -------------------------------------------------------------------------------- |
| `V1 ROUNDING` | erwarteter Minor-Unit-Betrag stimmt noch nicht                                   |
| `V2 QUANTITY` | exakte Millisekundenberechnung oder Zwischenrundungsverbot verletzt              |
| `V3 VALIDITY` | einschließendes `validTo` bzw. Folgetag-Normalisierung falsch                    |
| `V4 SIGN`     | negativer Quantity-, Rate- oder PlanCostAmount-Wert wird nicht korrekt abgelehnt |

**Nicht ausreichend:** `module not found` · `X is not a function` · `NOT_IMPLEMENTED` für
sämtliche Tests · falscher Fixture-Aufbau · fehlende Testkonfiguration. Ein einzelner
ausdrücklicher `NOT_IMPLEMENTED`-Fehler darf den Übergang sichtbar machen, ersetzt aber nicht
die starke Evidenz.

#### V3 — Satzgültigkeit: `validTo` einschließend, intern halboffen

Fachliche Oberfläche `[validFrom, validTo]`, beide einschließend, `validTo = null` unbegrenzt.
Beide sind **lokale Geschäftsdaten**, keine UTC-Zeitpunkte.

Intern kanonisch halboffen normalisiert: `[validFrom, dayAfter(validTo))`.
PostgreSQL: `daterange(valid_from, valid_to + 1 Tag, '[)')` oder äquivalente Constraint-Logik.

Verboten: `23:59:59.999` erzeugen; Kalendertage in UTC-Zeitpunkte wandeln; Sekunden oder
Millisekunden vom Folgezeitpunkt abziehen. Der Nachfolger eines `LocalDate` ist die einzige
zulässige Normalisierung.

Überlappung: `a.validFrom <= b.validTo AND b.validFrom <= a.validTo`, unbegrenzte Enden
berücksichtigt. `bis 30.06. / ab 01.07.` ist lückenlos und zulässig;
`bis 30.06. / ab 30.06.` ist eine Überlappung.

> Satzgültigkeiten verwenden einschließlich interpretierte lokale Geschäftsdaten. Zur
> Speicherung und Überlappungsprüfung werden sie kanonisch als halboffene Datumsintervalle
> normalisiert. Diese Semantik unterscheidet sich **bewusst** von Zeitintervallen: Kalendertage
> sind fachliche Einheiten und keine Zeitpunkte.

UI, Domain Service, PostgreSQL-Constraint und Tests dürfen keine abweichende Intervallsemantik
führen.

#### V4 — Vorzeichen

```text
Quantity                 >= 0        sonst QUANTITY_NEGATIVE
Rate                     >= 0        sonst RATE_NEGATIVE
PersistedPlanCostAmount  >= 0        sonst COST_AMOUNT_NEGATIVE
generischer Money-Wert   vorzeichenbehaftet zulässig
```

`0` ist als Menge zulässig. Ein Satz von `0` ist zulässig und bleibt von `RATE_MISSING`
unterscheidbar. `durationMilliseconds = 0` ist eine zulässige Nullmenge; `end < start` ist ein
Intervallfehler **vor** der Kostenberechnung.

`Money` darf intern ein Vorzeichen tragen, damit Differenzen, Vergleiche und Abweichungen
modellierbar bleiben — ein vorzeichenbehafteter `Money`-Wert ist aber **kein** zulässiger
Plan-Kostenbetrag. Dafür gilt eine eigene Domänengrenze (`NonNegativeMoney` /
`PlanCostAmount`). Kein Controller, Command oder Repository darf einen negativen `Money`-Wert
als Plan-Kostenposition persistieren.

Die Prüfung auf `COST_AMOUNT_NEGATIVE` ist **Defense in Depth** zusätzlich zu Mengen- und
Satzvalidierung — gegen Fehler in Berechnung, Rundung oder Datenübernahme.

Negative Korrektur- und Stornobuchungen sind **nicht** im Sprint-5-Scope und dürfen später
nicht durch bloßes Zulassen negativer Beträge nebenbei entstehen. Sie brauchen einen eigenen
fachlichen Typ (`CostAdjustment` mit Grund, Referenz auf die korrigierte Position, Akteur,
Audit, eigener Autorisierung und eigener Regelversion). Historische Snapshots werden nicht
still überschrieben.

Berechnungsinvariante:

```text
quantity >= 0 · rate >= 0 · roundedPositionAmount >= 0
snapshotTotal = sum(persistedPositionAmounts) · snapshotTotal >= 0
```

Eine Verletzung blockiert die **gesamte** Snapshot-Erzeugung. Kein partieller Snapshot wird
persistiert.

#### Evidenz-Eigentum der Entscheidungen

| Gegenstand                                                                     | Ticket      |
| ------------------------------------------------------------------------------ | ----------- |
| Money-Arithmetik, `NonNegativeMoney`/`PlanCostAmount`-Grenze                   | **EYT-95**  |
| Quantity- und Rate-Vorzeichenregeln, Fehlerklassen                             | **EYT-95**  |
| exakter Duration-Quantity-Typ, nichtnegative ganzzahlige Millisekunden         | **EYT-95**  |
| BigInt-/Rational-Arithmetik, Stundenrate mit Nenner `3_600_000`                | **EYT-95**  |
| einmalige finale `HALF_UP`-Rundung, Verbot von `number`-Gleitkomma im Geldpfad | **EYT-95**  |
| Ableitung der Dauer aus Assignment-Intervallen                                 | **EYT-109** |
| Aufteilung über lokale Kalendertage, DST- und Mitternachtslogik                | **EYT-109** |
| Übergabe jedes exakten Teilintervalls als Millisekundenmenge an EYT-95         | **EYT-109** |
| Snapshot blockiert negative Positionen, keine Teilpersistenz                   | **EYT-109** |
| Snapshot-Summe aus gespeicherten Positionen, nichtnegativ                      | **EYT-109** |

### Schnittgrenze EYT-95 / EYT-109 (PO-Korrektur 30.07.2026)

REQ-005 wird von **zwei** Tickets getragen. Die Grenze ist verbindlich; sie verschiebt keinen
Umfang, sie ordnet ihn zu.

| Liefergegenstand                                                    | Ticket      |
| ------------------------------------------------------------------- | ----------- |
| exakte Geldrepräsentation ohne Gleitkomma, EUR-Minor-Units          | **EYT-95**  |
| dokumentierte zentrale Rundungsregel                                | **EYT-95**  |
| Rate- und Einheitstypen, Duration bzw. Mengenbruch                  | **EYT-95**  |
| eindeutige Auswahl der gültigen Satzversion **an Intervallgrenzen** | **EYT-95**  |
| fehlende und mehrdeutige Sätze als **blockierende** Ergebnisse      | **EYT-95**  |
| überlappende Satzintervalle                                         | **EYT-95**  |
| historische Referenzen auf Quelle, Regel- und Satzversion           | **EYT-95**  |
| deterministische Wiederholung ohne Doppelwirkung                    | **EYT-95**  |
| Forward-Fix- und historische Stabilitätsregeln                      | **EYT-95**  |
| Aufteilung eines Einsatzes **über Mitternacht**                     | **EYT-109** |
| **IANA-Zeitzonenallokation** auf lokale Kalendertage                | **EYT-109** |
| **Sommer-/Winterzeitwechsel**                                       | **EYT-109** |
| **Summenerhaltung über lokale Kalendertage**                        | **EYT-109** |

EYT-95 liefert dafür ausschließlich die wiederverwendbaren exakten Primitive. EYT-109 wird
**nicht** vorzeitig unter dem Ticket EYT-95 implementiert. Umgekehrt darf **EYT-105 keinen
eigenen Money-, Rate- oder Rundungsvertrag erfinden** — diese Fachverträge kommen aus EYT-95,
und eine zweite Implementierung macht den Architektur-Gegenfall zu Recht rot.

### Hinweis zur bestehenden Zeitregel

`apps/api/test/no-local-time-construction.test.ts` ist ein statischer Wächter: heute baut
nichts im Repository einen Zeitpunkt aus Wanduhr-Bestandteilen. REQ-005 führt genau diese
Umrechnung ein. Der Wächter wird damit **absichtlich berührt** — wer ihn anpasst, muss
entscheiden und dokumentieren, was „02:30 am 29. März" bedeutet.

---

## REQ-006 – Sichtbare Kostenansicht

**Baseline:** S5-REQ-06 · **Jira:** EYT-109 · **Status:** EXPLICIT

### Requirement

Die Kostenansicht zeigt ausschließlich gespeicherte Snapshotdaten.

### Binäre Akzeptanz (Baseline S5-REQ-06)

- `/kosten` zeigt Baustelle, Tag, Person, Dauer, Satzversion, Positionsbetrag sowie Tages- und
  Gesamtsumme — serverseitig aus PostgreSQL gelesen.
- Loading, Empty, fehlender Satz, Forbidden, Fehler und Erfolg sind unterscheidbar und **nicht
  nur farbcodiert**.
- Reload und zweiter Browserkontext zeigen denselben Snapshot mit denselben IDs.
- Keine Mock-, LocalStorage- oder Clientberechnung ist operative Wahrheit.

### AC-006

**Given** ein erzeugter Snapshot, **when** die berechtigte Person `/kosten` öffnet, **then**
werden Baustelle, Tag, Person, Dauer, Satzversion, Position und Summen serverseitig gelesen.

**Given** Reload oder zweiter Browserkontext, **when** derselbe Snapshot geöffnet wird,
**then** erscheinen dieselben IDs und Beträge.

### Evidence

- reale Browserreise; Netzwerknachweis gegen API; keine LocalStorage-Wahrheit; kein
  optimistisches Clientresultat; Accessibility;
- CI-Zuordnung: **MISSING** (`OQ-003`).

---

## REQ-007 – Identischer XLSX-Export

**Baseline:** S5-REQ-07 · **Jira:** EYT-110 · **Status:** EXPLICIT

### Requirement

Der Export rendert ausschließlich einen bereits gespeicherten Snapshot.

### Binäre Akzeptanz (Baseline S5-REQ-07)

- Der Export erhält eine autorisierte Snapshot-ID und rendert **ausschließlich** diesen
  gespeicherten Stand; keine neue Berechnung.
- Metadatenblatt (Snapshot, Planversion, Regel, Zeitraum, Währung, Erstellung) und
  Positionsblatt (Baustelle, lokales Datum, Mitarbeiter, Assignment-ID, Dauer, Satzversion,
  Einheit, Betrag, Summen).
- Plan-Werte sind eindeutig als Plan-Personalkosten gekennzeichnet; fehlende Ist-Werte werden
  weder leer als vorhanden noch als null Euro ausgegeben.
- Textwerte werden gegen **Spreadsheet-Formula-Injection** behandelt; MIME-Type, Dateiname und
  Downloadheader sind stabil.
- Leeres Ergebnis und Generierungsfehler sind explizit und nicht als erfolgreiche Datei getarnt.
- Fremde, manipulierte oder für Mitarbeiter unzulässige Snapshot-IDs werden **ohne
  Existenzleck** abgelehnt.
- Export erzeugt einen Auditeintrag mit Akteur und Korrelations-ID; die Datei enthält keine
  unnötigen Auth- oder Personaldaten.

### AC-007

**Given** ein in der UI geöffneter Snapshot, **when** XLSX heruntergeladen wird, **then** sind
Snapshot-ID, Positionen und Summen in UI, PostgreSQL und XLSX identisch.

### Evidence

- Zell-, DB- und UI-Paritätsprüfung; Gegenmutation mit abweichendem Exportbetrag;
  Formula-Injection; manipulierte Snapshot-ID; fremder Tenant; stabiler MIME-Type und Dateiname;
- CI-Zuordnung: **MISSING** (`OQ-003`).

### Repository-Befund (gemessen 2026-07-30)

Es existiert **keine** XLSX-Bibliothek im Monorepo (kein Treffer für `xlsx`/`exceljs` in einer
`package.json`). Erste neue Laufzeitabhängigkeit ⇒ Supply-Chain-Bewertung durch
`security-reviewer` vor dem Lockfile-Eintrag.

---

## REQ-008 – Evidenz-Gesamtgate

**Baseline:** S5-REQ-08 · **Status:** EXPLICIT
_(Diese Anforderung fehlte im Intake als eigenständiges Requirement und ist beim
Baseline-Abgleich am 30.07.2026 ergänzt worden.)_

### Requirement

Sprint 5 gilt erst dann als nachgewiesen, wenn die vollständige reale Nutzerreise plus alle
Negativreisen grün sind — nicht, wenn einzelne Requirements grün sind.

### Binäre Akzeptanz (Baseline S5-REQ-08)

- Domain-, Property-, Contract-, Route-, PostgreSQL-, RLS-, Parallel-, E2E- und
  Accessibility-Tests sind grün.
- **Reale E2E-Reise:** Login → Satz anlegen → Entwurf veröffentlichen → Kosten berechnen → UI
  prüfen → XLSX herunterladen → UI/XLSX/DB vergleichen.
- **Negativreisen:** Mitarbeiterzugriff, Fremdtenant, fehlender Satz, Satzüberlappung,
  ungültiges Token, Wiederholung, manipulierte Snapshot-ID, abweichender Exportbetrag.
- Die bestehenden **zehn** CI-Gates bleiben erforderlich; neue Nachweise werden in vorhandene
  fachlich passende Gates integriert **oder** branch-protection-sicher ergänzt.

### AC-008

**Given** alle sieben Produkt-Requirements melden grün, **when** eine der acht Negativreisen
oder die durchgehende reale E2E-Reise fehlt oder rot ist, **then** ist Sprint 5 **nicht**
nachgewiesen.

### Evidence

- ein benannter CI-Lauf, der die durchgehende Reise und die acht Negativreisen ausführt;
- „branch-protection-sicher ergänzt" heißt konkret: neuer Job ⇒ **beide** Pflichtcheck-Listen
  in `scripts/setup-branch-protection.sh` **und** `scripts/verify-branch-protection.sh`
  anpassen, danach `verify` mit `enforcement=active`;
- CI-Zuordnung: **MISSING** (`OQ-003`).

---

## Maßstab für Red-Test-Evidenz (PO-Weisung 30.07.2026 §4)

Vor jedem Produktionscode wird je Ticket festgehalten: Testdatei, Testname, Requirement bzw.
Jira-Akzeptanzkriterium, erwarteter roter Grund, **tatsächlich beobachtete** rote Ausgabe,
Schutz gegen vakuöse Tests, zugehöriger CI-Job.

**Ein Test zählt nicht als Red Evidence**, wenn er scheitert wegen

- Syntaxfehler,
- fehlender Abhängigkeit,
- falschem Importpfad,
- kaputter Testkonfiguration.

Der rote Fehler muss das **fehlende fachliche oder architektonische Verhalten** beweisen. Ein
reiner Compile- oder Auflösungsfehler ist ein schwacher Rotnachweis und wird als solcher
gekennzeichnet, nicht als erfüllt gebucht.

## Failure-Mode-Ketten (Baseline §10 — je Kette ein Pflicht-Falsifier)

Eine benannte Failure-Mode-Kette darf nicht Prosa bleiben. Beide Ketten der Baseline werden zu
falsifizierenden Tests:

| ID      | Kette                                                                                                                                                                                            | Pflicht-Falsifier                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FMC-001 | Nicht veröffentlichte / veränderliche Planversion als Quelle zugelassen → Einsatzdaten ändern sich nach der Berechnung → UI, Export und Plan divergieren → falsche wirtschaftliche Entscheidung. | Test: Snapshot-Erzeugung gegen eine **Entwurfs**-Planversions-ID muss fehlschlagen. Gegenmutation: Prüfung entfernen ⇒ Test wird rot.                            |
| FMC-002 | Kostenrechte nur in der UI geprüft → Mitarbeiter ruft die API direkt auf → interne Personalkosten offengelegt.                                                                                   | Test: direkter API-Aufruf mit Mitarbeiter-Token wird abgelehnt **und** RLS lehnt unabhängig ab. Gegenmutation: API-Guard entfernen ⇒ RLS muss weiter blockieren. |

---

## Rollback und Migration (Baseline §9)

- Nur expandierende, **append-only** Migrationen (nächste Nummer: `0013`).
- Route und UI sind durch Entfernen der Komposition zurücknehmbar; die bestehende
  Planungsroute bleibt unberührt.
- Persistierte Kosten-Snapshots bleiben lesbar; **keine destruktive Down-Migration** nach
  echtem Datenbestand.
- Der XLSX-Adapter ist hinter einem Port austauschbar.
- Fehlerhafte Berechnungsregeln werden über eine **neue Regelversion und Forward-Fix**
  korrigiert; historische fehlerhafte Snapshots werden **markiert, nicht still überschrieben**.
- Vor Release: Restore- und Forward-Fix-Nachweis. Produktion bleibt bis dahin blockiert.

---

## Lokale Ergänzungen — durch die PO-Entscheidung NICHT bestätigt

Der PO hat am 30.07.2026 ausdrücklich festgehalten: „Neue lokale Hypothesen oder zusätzliche
Requirements sind durch diese Entscheidung nicht automatisch bestätigt." Die folgenden beiden
Punkte stammen aus dem Intake (dort selbst als `ASSUMPTION` geführt) und haben **kein**
Gegenstück in der Confluence-Baseline. Sie sind Governance-Vorschläge, keine Produktscope.

### REQ-G01 – Evidence Execution Binding (Vorschlag)

Jeder Pflichttest wird vor Coding einer Testdatei, einem CI-Workflow, Job, Schritt und
erwarteten Report zugeordnet. Vier Pflichtszenarien: (1) richtiger Test läuft und besteht →
PASS; (2) Test existiert, läuft nicht → BLOCK; (3) Test wird übersprungen → BLOCK; (4) anderer
grüner Test → `EVIDENCE_MISMATCH`.

_Verhältnis zur Baseline:_ REQ-008 verlangt, **dass** die Nachweise laufen. REQ-G01 verlangt
zusätzlich, dass die Zuordnung **vor** Coding festgeschrieben wird. Das ist die
Sprint-5-Intake-Hypothese und Messgegenstand des Experiments — nicht Produktinhalt.

### REQ-G02 – Dualer Done-Status (Vorschlag)

Getrennte Führung von `USER_JOURNEY_STATUS`, `REQUIREMENT_CONTRACT_STATUS`,
`CI_EVIDENCE_STATUS`, `RELEASE_STATUS`. Eine vollständige Nutzerreise bei offenem
Must-Requirement bleibt `REVIEW_REQUIRED`/`BLOCKED` und darf nicht als Done ausgegeben werden.

_Verhältnis zur Baseline:_ inhaltlich deckungsgleich mit dem Baseline-Release-Status („kein
produktives Deployment und keine Produktionsfreigabe") und mit REQ-008, aber als
Berichtsformat neu.

---

## Dokumentationsdrift-Ledger

### `DOC-DRIFT-S5-001` — PRD v1.4 und die geänderte MVP-Phasenentscheidung fehlen im Repository

**Kein Implementierungsblocker.** Muss sichtbar bleiben und durch eine spätere
Repository-Synchronisierung behoben werden.

| Ort                                              | Aktueller Stand                                                              | Warum das driftet                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `docs/prd/` (Repository)                         | enthält nur v1.3                                                             | PRD v1.4 liegt ausschließlich in Confluence (Seite 7766017)                                   |
| `docs/prd/CURRENT_PRD_v1.3.md`                   | von `CLAUDE.md` als „Product source of truth" bezeichnet                     | für MVP-Scope und Phasen von v1.4 überholt                                                    |
| `arboscus_teamplaner_finale_prd_de_v1.3.md`      | Kosten unter FR-063/066/067/069 als Post-MVP, „erst nach separater Freigabe" | durch v1.4 §10 Punkt 1 und 2 ersetzt                                                          |
| `CLAUDE.md`                                      | führt „Post-MVP Planungsökonomie/Maschinenverleih" als out of scope          | hinsichtlich **interner Kosten und Excel** veraltet; Maschinenverleih bleibt korrekt Post-MVP |
| `docs/traceability/REQUIREMENT_TO_JIRA_v1.3.csv` | v1.3-Zuordnung                                                               | v1.4 §11 führt eine eigene Jira-Traceability                                                  |

**Empfohlene Synchronisierung (eigenes Ticket, nicht Sprint-5-Scope):** PRD v1.4 ins Repository
übernehmen, `CLAUDE.md` in Autoritätsordnung und Out-of-Scope-Liste nachziehen, v1.3 als
„teilweise ersetzt" kennzeichnen.

### Aufgelöster Befund

`CONTRA-S5-001` wurde am 30.07.2026 vom Product Owner als
**`FALSE_POSITIVE_SOURCE_SCOPE_ERROR` / `RESOLVED_NO_SCOPE_CHANGE`** klassifiziert. Ursache:
aus „PRD v1.4 liegt nicht im Repository" war unzulässig „PRD v1.4 existiert nicht" abgeleitet
worden — die Prüfung hatte den Confluence-Quellbereich nicht einbezogen. PRD v1.4 wurde
anschließend gelesen und verifiziert (Seite 7766017, Stand 28.07.2026); FR-008 bis FR-012
lauten dort Interne Kostensätze, Plan-Kosten, Ist-Kosten, Kostenübersicht und
Excel-Kostenexport. Der Eintrag bleibt als Lernbefund stehen und ist **kein offener
Widerspruch**.

### Weitere, nicht materielle Abweichungen (protokolliert, keine Entscheidung nötig)

| ID         | Abweichung                                                         | Behandlung                                                                                                                               |
| ---------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| DIV-S5-001 | Sprint-5-Seite: „Sprintkandidat, Developers-Gate offen"            | veraltet — PO-Entscheidung 30.07.2026 schließt das Gate für den Start                                                                    |
| DIV-S5-002 | Sprint-5-Seite §11: „Jira-Sprint-5-Container existiert noch nicht" | veraltet — gemessen: existiert, enthält genau die sieben Tickets                                                                         |
| DIV-S5-003 | Jira-Label `sprint-5-candidate` an allen sieben Tickets            | Etikettenpflege (`OQ-006`), kein fachlicher Widerspruch                                                                                  |
| DIV-S5-004 | Intake-Nicht-Ziele waren Teilmenge der Sprint-5-Baseline §8        | **korrigiert** — Vision VIS-006 und Canvas CAN-F07 erweitert                                                                             |
| DIV-S5-005 | Baseline §9 (Rollback/Migration) fehlte im Intake                  | **korrigiert** — eigener Abschnitt                                                                                                       |
| DIV-S5-006 | Baseline §10 (Failure-Mode-Ketten) fehlte im Intake                | **korrigiert** — FMC-001/FMC-002 mit Pflicht-Falsifier                                                                                   |
| DIV-S5-007 | Baseline S5-REQ-08 (Evidenz) fehlte als eigenständiges Requirement | **korrigiert** — als REQ-008 aufgenommen                                                                                                 |
| DIV-S5-008 | Intake REQ-008/REQ-009 ohne Baseline-Gegenstück                    | **korrigiert** — als REQ-G01/REQ-G02 abgetrennt, nicht baseline-bestätigt                                                                |
| DIV-S5-009 | Sprint-5-Schnitt ist enger als PRD v1.4 FR-008/FR-010/FR-011       | **kein Widerspruch** — v1.4 nennt selbst einen „begrenzten modularen Schnitt"; Grenzen sind in der Zuordnungstabelle oben je REQ benannt |

## Pre-Coding Execution Contract (Intake Abschnitt 6)

1. Repository-Head, Branch, Base-SHA — **erledigt**: Branch `feat/sprint-5-daily-cost-export`,
   Base `origin/master` @ `f9da445` (deckungsgleich mit der Baseline-Kopfzeile).
2. Sprint-5-Tickets und Abhängigkeiten gelesen — **erledigt**.
3. Pfade nach Scopeklasse inventarisiert — **Stufe 1 erledigt** (Canvas CAN-004).
4. Composition-, Dependency-, Database-, Evidence-, Generated-Wiring — **Stufe 1 erledigt**.
5. Erste rote Prüfung je Requirement — **offen**.
6. Testdatei, Workflow, Job, Schritt je Requirement — **offen** (`OQ-002`, `OQ-003`).
7. Falsifier je kritischer Invariante — **teilweise**: FMC-001/FMC-002 und die neun
   Traceability-Falsifier stehen; die Zuordnung zu Testdateien fehlt.
8. Nutzerreise- und Requirement-Status getrennt initialisiert — **erledigt**.
9. Fehlende oder widersprüchliche Pfade eskaliert — **erledigt**: Baseline-Abgleich gegen PRD v1.4
   abgeschlossen, `DOC-DRIFT-S5-001` protokolliert (kein Blocker), `OQ-005` offen gemeldet.
10. Implementieren erst nach bestätigter Scope Dependency Closure — **gesperrt**.

## Aktueller Status

```text
SCOPE_DEPENDENCY_CLOSURE:    BLOCKED     (Stufe 1 gelesen; Schritte 5-7 offen: rote Erstpruefung,
                                          Testdatei/CI-Bindung, Falsifier-Zuordnung)
USER_JOURNEY_STATUS:         0/6         (Login · Satz · Publish · Snapshot · Ansicht · XLSX)
REQUIREMENT_CONTRACT_STATUS: 0/8         (+ 2 lokale Vorschlaege, nicht baseline-bestaetigt)
CI_EVIDENCE_STATUS:          0/8
RELEASE_STATUS:              NOT_READY   (Baseline: kein produktives Deployment, keine Freigabe)
CONTRADICTIONS_OPEN:         0           (CONTRA-S5-001 aufgeloest als FALSE_POSITIVE_SOURCE_SCOPE_ERROR)
DOC_DRIFT_OPEN:              1           (DOC-DRIFT-S5-001 - sichtbar, kein Blocker)
AUTH_PREFLIGHT:              OFFEN       (OQ-005 - Ort des Nachweises, Kuerzung ausgeschlossen)
```
