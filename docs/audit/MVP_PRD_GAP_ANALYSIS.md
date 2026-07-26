# MVP-/PRD-Gap-Analyse

## Bewertungsbasis

- PRD v1.3 und MVP-Scope im Master-Repository.
- Clickdummy-Anforderungen mit 14 Ansichten.
- Quelltext aller drei ZIPs.
- Keine erneut ausgeführte Runtime-, Build- oder Browser-Evidenz.

## Gesamturteil

| Ebene | Status | Begründung |
|---|---|---|
| Produkt-/PRD-Klarheit | PASS_WITH_ASSUMPTIONS | PRD, MVP und Traceability sind weitgehend vorhanden; Identitäts-/Repo-Drift und offene Provider/Legal-Gates bleiben. |
| Clickdummy | PASS_WITH_GAPS | Planer- und Mitarbeiter-Prototyp decken viele Kernreisen ab; Login, Rollen-/Rechteeditor und Zeitfreigabe/Korrektur fehlen. |
| Technische Foundation | SOURCE_INSPECTED_STRONG | Master enthält gute Build-/API-/RLS-/Test-Leitplanken; in dieser Umgebung nicht erneut ausgeführt. |
| Fachliches MVP | NOT_IMPLEMENTED | Fachliche Datenmodelle, Commands, APIs, Persistenz und Integrationen fehlen weitgehend. |
| Production Release | BLOCKED | Keine vollständige Implementierung, Runtime-/Pilot-/Security-/Legal-/Operations-Evidenz. |

## Gap-Tabelle

| ID | Bereich | Ist-Zustand | PRD-Soll | Lücke | Schweregrad |
|---|---|---|---|---|---|
| GAP-001 | Repository Governance | Master-Dokumente nennen unterschiedliche Produkt-/Repo-Namen | ein kanonisches Repository und klare Produktidentität | Merge-/Jira-/CI-Ziel unklar | High |
| GAP-002 | Gemeinsame Verträge | zwei UI-Prototypen nutzen eigene Typen/Mocks | ein Domänen- und API-Vertrag | hohe Drift- und Doppelimplementierungsgefahr | High |
| GAP-003 | Auth | keine nutzbare Login-/Reset-Reise | Supabase Auth, Einladung, Reset | Clickdummy und MVP unvollständig | High |
| GAP-004 | Rollen/Rechte | UI-Simulation; RLS nur Foundation | serverseitige atomare Rechte | Zugriffsschutz und Admin-Editor fehlen | Extreme für Release |
| GAP-005 | Domänenschema | generische Foundation-Tabellen | Mitarbeiter, Baustellen, Planung, Ressourcen, Zeit usw. | Kernprodukt nicht persistierbar | Extreme |
| GAP-006 | Planungs-API | clientseitige Mocklogik | autorisierte Commands/Queries | keine belastbare gemeinsame Planung | Extreme |
| GAP-007 | Konfliktlogik | Browser-Engine mit Wochen-/Zeit-/Ressourcenfehlern | deterministische, getestete Servervalidierung | falsche Veröffentlichungsblocker/Fehlfreigaben möglich | High |
| GAP-008 | Planversion/Publish | simulierte UI-Aktion | atomare Version, Audit, Konfliktcheck, Benachrichtigung | Kernworkflow fehlt | Extreme |
| GAP-009 | Bestätigung/Ablehnung | mobile Demo lokal | an Planversion gebundener Serverstatus | keine Mehrbenutzerkonsistenz | High |
| GAP-010 | Abwesenheit | lokale Demo | Antrag, Entscheidung, Genehmigung, Konfliktwirkung | Genehmigungsprozess fehlt | High |
| GAP-011 | Skills | Mockdaten | atomare Qualifikationen und Lückenhinweise | keine verlässliche Eignungsprüfung | High |
| GAP-012 | Ressourcen | Mockreservierungen und Schadensdemo | eindeutige Ressourcen, Status, Verfügbarkeit, Zustandsmeldung | keine Persistenz/Workflow/Upload | High |
| GAP-013 | Zeiterfassung | setInterval-/LocalStorage-Demo | serverseitig eindeutiger aktiver Timer und Audit | Dauer kann falsch sein; kein Mehrgeräte-/Offline-Modell | Extreme |
| GAP-014 | Zeitfreigabe/Korrektur | fehlt | Freigabe, begründete Korrektur, Originalerhalt | PRD-Kernansicht und Workflow fehlen | High |
| GAP-015 | Wetter | Mockdaten; direkte Kartenprovider | austauschbarer Adapter, Cache, amtliche Warnung | Provider-/Datenschutz-/Fehlergrenze fehlt | High |
| GAP-016 | Benachrichtigung | simuliert | In-App, E-Mail, Erinnerung, Änderungsbezug | kein Outbox-/Delivery-/Retry-Modell | High |
| GAP-017 | PWA/Offline | Master nur Manifest; App behauptet Offline-Sync | installierbar, online/read-only gemäß MVP | irreführende Clickdummy-Aussage | Elevated |
| GAP-018 | Accessibility | Master hat Baseline; Prototypen ungeprüft | WCAG-orientierte kritische Flows | Migration kann A11y-Baseline verlieren | High |
| GAP-019 | Testpyramide | Master Tests vorhanden, UI-Prototypen kaum/keine Tests | Domain, Contract, Integration, E2E, A11y | keine regressionssichere Zusammenführung | High |
| GAP-020 | Security/Privacy | Foundation und Leitplanken | Threat Model, Retention, Uploadschutz, Audit | Release-Gates offen | Extreme für Release |
| GAP-021 | Operations | CI-Dokumentation vorhanden | Monitoring, Backup/Restore, Runbooks, Rollback | Produktionsbetrieb nicht belegt | Extreme für Release |
| GAP-022 | Pilot/Last | kein ausgeführter Pilotnachweis | 12 aktive Nutzer, 3 parallele Baustellen und Akzeptanzmetriken | fachliche/technische Eignung unbewiesen | High |

## Clickdummy vor MVP

Der nächste sinnvolle Schritt ist **nicht sofort Backend-Vollausbau**, sondern eine integrierte Clickdummy-Version, die alle 14 PRD-Ansichten in einem kohärenten Rollen- und Datenmodell demonstriert. Sie soll klar als Prototyp gekennzeichnet sein und über Mock-Gateways dieselben Contracts verwenden, die später das Backend bedient.

## Stärkstes Gegenargument

Man könnte die beiden Vite-Prototypen separat lassen, um schneller Nutzertests zu machen. Das ist für sehr frühe Screen-Tests vertretbar. Sobald jedoch ein zusammenhängender Ablauf zwischen Planung, Veröffentlichung, Mitarbeiterbestätigung und Zeitfreigabe getestet werden soll, erzeugen getrennte Mockmodelle falsche Sicherheit und zusätzlichen Umbau. Deshalb: Prototypen einfrieren, aber die nächste Clickdummy-Stufe im Master auf gemeinsamen Verträgen aufbauen.

## Failure-Mode-Kette

Getrennte Typen und Mocklogik → Konflikte/Status werden unterschiedlich interpretiert → Clickdummy validiert widersprüchliche Abläufe → Backend wird gegen falsche Annahmen gebaut → Veröffentlichung oder Arbeitszeit ist fachlich inkonsistent → Pilot scheitert beziehungsweise Arbeitnehmerdaten werden falsch verarbeitet.
