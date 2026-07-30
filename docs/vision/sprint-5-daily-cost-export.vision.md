# Product Vision – Sprint 5 Daily Cost Export

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
- PRD: [`docs/prd/sprint-5-daily-cost-export.prd.md`](../prd/sprint-5-daily-cost-export.prd.md)
- Traceability: [`docs/traceability.md`](../traceability.md), Abschnitt „Sprint 5"

**Quellen.** Intake-Paket `easytree-sprint-5-plumbline-intake.md` (Readiness-Level
`READY_FOR_USER_CONFIRMATION`, vom Nutzer geliefert); Jira EYT-95, EYT-105 bis EYT-110
(gemessen 2026-07-30: alle sieben im offenen Sprint, alle Status _Zu erledigen_);
Confluence „EasyTree – Sprint 5: Modulare Tageskosten und Excel-Durchstich" (Seite 8552449);
**Confluence PRD v1.4** (Seite 7766017, Stand 28.07.2026) als fachliche Produktbaseline.

> **Bestätigt am 30.07.2026** auf Weisung des Product Owners (Herkunft im Kopf dieses
> Dokuments). Der Plumbline-Startstatus wechselt damit von `VISION_MISSING` auf planungsfähig.
> **Das Vision-GO für den Entwicklungsstart ist davon getrennt und noch nicht erteilt.**

## Sprintziel

Eine berechtigte Person aus Geschäftsführung oder Administration kann auf Basis einer
unveränderlichen veröffentlichten Planversion reale tägliche Plan-Personalkosten einer
Baustelle sehen und exakt denselben gespeicherten Kostenstand als Excel-Datei exportieren.

## VIS-001 – Zielnutzer

**EXPLICIT:** Geschäftsführung und berechtigte Administration eines kleinen
Baumpflegeunternehmens.

Mitarbeitende ohne Kostenrechte sind ausdrücklich keine Nutzer der Kostenansicht oder des
Exports.

## VIS-002 – Problem

Plan-Personalkosten müssen bisher manuell aus veröffentlichten Einsätzen, Arbeitsdauer und
internen Stundensätzen zusammengeführt werden.

Das erzeugt Risiken:

- falsche oder fehlende Satzstände;
- abweichende Berechnungen in UI und Excel;
- nicht reproduzierbare historische Ergebnisse;
- unbefugten Zugriff auf sensible Wirtschaftsdaten;
- Rundungs- und Zeitzonenfehler.

## VIS-003 – Gewünschte Veränderung

Eine berechtigte Person kann:

1. einen Mitarbeiter-Stundensatz mit Wirksamkeit pflegen;
2. einen konfliktfreien Wochenplan veröffentlichen;
3. daraus tägliche Plan-Personalkosten erzeugen;
4. Positionen und Summen in der Anwendung prüfen;
5. exakt diesen Snapshot als Excel-Datei herunterladen.

## VIS-004 – Wertversprechen

EasyTree liefert einen nachvollziehbaren, reproduzierbaren und geschützten Plan-Kostenstand aus
einer gemeinsamen serverseitigen Wahrheit.

UI und Excel verwenden keinen getrennten Rechenweg.

## VIS-005 – Erfolgssignal

Die reale Browserreise funktioniert ohne Mock-, LocalStorage- oder Clientberechnungswahrheit:

```text
Login
→ Stundensatz anlegen
→ Plan veröffentlichen
→ Snapshot erzeugen
→ Kostenansicht prüfen
→ XLSX herunterladen
→ UI, DB und XLSX stimmen überein
```

## VIS-006 – Nicht-Ziele

Aus dem Intake:

- Ist-Kosten;
- Arbeitszeiterfassung;
- Tagessätze;
- Fahrzeuge, Maschinen und Geräte;
- DATEV;
- Rechnungen und Zahlungen;
- Microservice;
- Event Sourcing;
- beliebige Rollenverwaltung;
- vollständiger Ausbau aller Publish-Konfliktregeln.

Ergänzt beim Baseline-Abgleich am 30.07.2026 (Confluence §8 — die Intake-Liste war eine
Teilmenge):

- Arbeitszeitfreigabe und bestätigte Ressourcennutzung;
- Verteilung von Tagessätzen auf mehrere Baustellen;
- freie Mitarbeiter;
- PDF/Druck, CSV-Import, Steuer, Buchung;
- asynchrone Großexporte, E-Mail-Zustellung und BI-Integration;
- Brokerwechsel und generisches Service-Framework;
- **produktives Deployment oder Produktionsfreigabe**.

EYT-36, EYT-37 und EYT-94 bleiben als breitere Backlog-Items offen; Sprint 5 liefert je einen
nachverfolgbaren Teilschnitt und behauptet nicht deren vollständige Erledigung. Dasselbe gilt
für EYT-14/EYT-87 (Identität) und EYT-18 (Publish).

## VIS-006a – Release-Status (Baseline-Kopfzeile)

**Kein produktives Deployment und keine Produktionsfreigabe.** Daraus folgt für den Reality
Ledger: `production-verified` ist in Sprint 5 durchgängig unerreichbar; der höchste erreichbare
Wert ist `real-boundary-smoke`. Das ist die ehrliche Obergrenze, keine Schwäche der Matrix.

## VIS-007 – Unverhandelbare Leitplanken

- keine clientseitige Organisations-ID als Wahrheit;
- keine Gleitkommaarithmetik für Geld;
- keine Berechnung aus einem Entwurf;
- keine rückwirkende Veränderung eines Snapshots;
- fehlender Satz ist ein Fehler, nicht null Euro;
- Mitarbeitende sehen keine Kostendaten;
- Export rendert nur einen gespeicherten Snapshot;
- Done benötigt Nutzerreise und vollständige Must-Evidence.

## VIS-008 – Scope-Entscheidung des Product Owners (30.07.2026)

**Voller Scope, keine Must-Kürzung.** Alle sieben Tickets sind verbindlich; das
Developers-/Kapazitäts-Gate ist für den **Start mit diesem Scope** geschlossen. Ausdrücklich
mitentschieden:

- Kein Ticket gilt wegen vorhandener Dateien, Commits oder grüner Teiltests als fertig.
- Akzeptanzkriterien, Gegenmutationen, RLS-/Cross-Tenant-, Parallel-, Browser-, Accessibility-
  und CI-Nachweise bleiben verbindlich.
- **EYT-106 darf nicht durch eine injizierte Testidentität ersetzt oder gekürzt werden.**
- EYT-109 und EYT-110 gelten erst als erfüllt, wenn UI, PostgreSQL-Snapshot und XLSX
  nachweislich denselben gespeicherten Stand verwenden.
- Bei einem echten technischen Blocker: betroffenen Pfad mit Evidenz stoppen und melden —
  Qualitäts- oder Sicherheitsanforderungen werden nicht eigenständig gesenkt.
- Reicht das Sprintfenster nicht, wird keine Must-Anforderung gekürzt; stattdessen ist
  Verlängerung oder Neuplanung vorzuschlagen. `Original Goal Status` und
  `Current Iteration Status` bleiben getrennt ausgewiesen.

## VIS-009 – Produktbaseline: PRD v1.4 (Confluence)

Maßgeblich ist **Confluence PRD v1.4** „Planung, Feldkommunikation und interne
Baustellenkosten" (Seite 7766017, Stand 28.07.2026), die PRD v1.3 hinsichtlich MVP-Scope und
Phasen ersetzt. Dort gilt: **FR-008** Interne Kostensätze, **FR-009** Plan-Kosten, **FR-010**
Ist-Kosten, **FR-011** Kostenübersicht, **FR-012** Excel-Kostenexport — und §7 führt interne
Kosten, Plan-/Ist-Vergleich und Excel-Export unter **Im MVP**. Sprint 5 ist damit MVP-Scope;
eine Post-MVP-Phaseneröffnung ist nicht erforderlich.

Das Repository bildet diesen Stand noch nicht ab (`docs/prd/` führt nur v1.3, `CLAUDE.md`
nennt Planungsökonomie pauschal Post-MVP). Das ist als **`DOC-DRIFT-S5-001`** protokolliert —
sichtbar zu halten, aber **kein Implementierungsblocker** für Sprint 5.

## VIS-010 – Wertabgrenzung (Kontext aus Sprint 4)

Sprint 4 hat gezeigt, dass „nutzbar" und „ausgeliefert" auseinanderfallen: der dortige
Nachweis lief gegen ein serverseitig injiziertes synthetisches Subjekt, weil EYT-14 offen war
(siehe `docs/canvas/planning-draft-conflict-slice.canvas.md`, Wertabgrenzung des Council-Gates).

Sprint 5 macht diese Abgrenzung selbst zum Requirement: REQ-002 verlangt eine **real
verifizierte Supabase-Session** und verbietet die Subjektinjektion im abschließenden E2E.
Damit hängt der gesamte sichtbare Wert an einer Auth-Grenze, die bisher nirgends im Repository
existiert und deren lokale Testumgebung im Intake als `OQ-005 MISSING` geführt wird.

Der Product Owner hat am 30.07.2026 entschieden, dass diese Anforderung **nicht gekürzt** wird.
Offen bleibt allein, **wo** der echte Nachweis entsteht — lokal, in CI oder beides. Das misst
der Preflight und legt es vor; die Anforderung wird dabei nicht gesenkt. Geführt als
`CAN-RISK-02` / `OQ-005`.
