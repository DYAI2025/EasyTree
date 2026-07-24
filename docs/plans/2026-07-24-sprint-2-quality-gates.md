# EasyTree Sprint 2 – Mergegeschützte Quality Foundation

- Planungsdatum: 2026-07-24
- Vorgeschlagener Sprintzeitraum: 2026-08-07 bis 2026-08-20
- Jira-Board: EYT Board 72
- Status: **DRAFT / ready for Developer capacity confirmation**

## Sprintziel

Eine mergegeschützte, reproduzierbare EasyTree-Foundation bereitstellen, deren Tenant-Isolation, Laufzeit-Smokes und Accessibility-Nachweise in GitHub Actions fail-closed geprüft werden. Kein Pull Request darf auf `master` gelangen, wenn Pflichtchecks fehlen, Sicherheitsprüfungen übersprungen werden oder die Web-, API-, Worker- und Datenbankbasis nicht gemeinsam nachweisbar funktioniert.

## Nutzenhypothese

Wenn Build-, Migrations-, Tenant-, Runtime- und Accessibility-Gates vor dem weiteren Fachausbau technisch erzwungen werden, sinkt das Risiko, dass spätere Planungsfunktionen auf unsicheren oder widersprüchlichen Grundlagen entstehen.

## Erfolgsevidenz

Der Sprint gilt als erfolgreich, wenn:

1. ein Pull Request automatisch Frozen Install, Format, Lint, Typecheck, Tests und Build ausführt;
2. Supabase aus leerem Zustand migriert, gesetzt und erneut zurückgesetzt wird;
3. alle verpflichtenden Tenant-Tests real ausgeführt werden und kein Skip als Erfolg zählt;
4. API, Worker und Web in CI starten und ihre Pflicht-Smokes bestehen;
5. Accessibility im echten Browser sowie manuell für die offenen Baseline-Punkte geprüft ist;
6. ein absichtlich fehlschlagender Test-Pull-Request nicht mergebar ist;
7. `master` gegen direkte Pushes, Force Push und ungetestete Merges geschützt ist.

## Sprint-2-Kandidatenset

| Jira | Priorität | Ergebnis | Abhängigkeiten |
|---|---|---|---|
| EYT-56 | Highest | PR-CI-Baseline mit verpflichtenden Qualitätschecks | EYT-40, EYT-43 |
| EYT-57 | Highest | Datenbank-, Migrations- und Tenant-Gates laufen real in CI | EYT-44, EYT-15, EYT-42, EYT-66 |
| EYT-58 | Highest | API-, Worker-, Web- und Accessibility-Smokes laufen in CI | EYT-41, EYT-42, EYT-43 |
| EYT-66 | Highest | Tenant-Sicherheitsgate schlägt bei fehlender DB und Pflicht-Skips fehl | EYT-56, EYT-57 |
| EYT-67 | Highest | Branch Protection erzwingt PR und Pflichtchecks | EYT-56, EYT-57, EYT-58 |
| EYT-15 | Highest | Tenant-/RLS-Spike wird inklusive realem Poolingpfad abgeschlossen | EYT-57, EYT-66 |
| EYT-41 | Highest | Accessibility-Baseline wird im echten Browser und manuell abgeschlossen | EYT-58 |

## Umsetzungsreihenfolge

1. **EYT-56:** GitHub-Actions-Grundworkflow und Jobstruktur.
2. **EYT-66:** Pflicht-Tenant-Tests von optionalen lokalen Tests trennen; fail-closed machen.
3. **EYT-57:** Supabase, Migrationen, pgTAP, Integration, Storage und Pooling in CI.
4. **EYT-58:** API-, Worker-, Browser- und Accessibility-Smokes.
5. **EYT-15:** echten Poolingpfad ausführen oder einen belegten technischen Blocker dokumentieren.
6. **EYT-41:** manuelle Accessibility-Checkliste mit Datum und Prüfergebnis abschließen.
7. **EYT-67:** Branch Protection aktivieren und mit negativem Test-PR beweisen.

## Harte Bedingungen

- Kein Pflicht-Sicherheitscheck darf durch `skip`, fehlende Abhängigkeit oder `continue-on-error` grün werden.
- Keine echten Beschäftigten-, Kunden- oder Baustellendaten in CI.
- GitHub-Actions erhalten minimale Berechtigungen.
- Keine produktiven Supabase-Secrets oder Service-Role-Keys in normalen Test- oder Runtimepfaden.
- Kein automatischer produktiver Deployment-Schritt.
- Kein Fachausbau, solange die Quality Foundation nicht grün und erzwungen ist.

## Out of Scope

- neue Planungs-, Zeit- oder Ressourcenfunktionen;
- OpenAPI-/Client-Ausbau aus EYT-47/EYT-60;
- Outbox und produktive Jobqueue;
- Last-, Nightly- und Release-Pipeline aus EYT-63/EYT-64;
- produktive Migration oder Deployment;
- native Mobile-App oder Offline-Synchronisation.

## Definition of Done

- Alle sieben Sprinttickets erfüllen ihre Akzeptanzkriterien.
- GitHub-Actions-Läufe sind auf dem abschließenden PR sichtbar und grün.
- Pflicht-Tenant-Tests melden null Skips.
- Der Supabase-Reset läuft mindestens zweimal reproduzierbar.
- Ein negativer Test-PR wird nachweislich vom Merge ausgeschlossen.
- Die manuelle Accessibility-Checkliste ist ausgefüllt; offene Findings besitzen Bugs.
- Pooling-Evidenz ist vorhanden oder als expliziter Releaseblocker dokumentiert.
- Jira-Status wird erst nach Read-after-write und GitHub-Evidenz auf `Fertig` gesetzt.

## Kapazitäts- und Developer-Gate

Das Set enthält sieben eng gekoppelte Tickets. Es ist kohärent, aber kein verbindliches Sprint Commitment, solange Developers Aufwand, technische Zugänge und GitHub-Plan-Fähigkeiten nicht bestätigt haben.

Bei Kapazitätsmangel darf reduziert werden:

1. Browsermatrix auf einen Browser und zwei Kern-Viewports begrenzen;
2. optionale Workflow-Optimierungen verschieben;
3. Dokumentationspolitur reduzieren.

Nicht reduzierbar sind EYT-56, EYT-57, EYT-66 und der Kern von EYT-67. Ohne sie bleibt die Sicherheits- und Mergegrenze unverbindlich.

## Stärkstes Gegenargument

Ein kompletter Sprint ohne neues Nutzerfeature verzögert sichtbaren Produktwert. Die Gegenposition ist berechtigt. Der aktuelle Zustand erlaubt jedoch große, ungeprüfte Merges und potenziell grüne Sicherheitsläufe ohne ausgeführte Tenant-Tests. Weiterer Fachausbau würde dieses Risiko vervielfachen.

## Failure-Mode-Kette

CI oder Branch Protection wird verschoben -> weiterer Featurecode wird ungeprüft gemergt -> Migration oder Tenant-Test wird nicht ausgeführt -> falsche Sicherheitsannahme verbreitet sich in mehrere Module -> spätere Korrektur erfordert Schema-, API- und Datenumbau.

## Entscheidung

**PASS_WITH_ASSUMPTIONS.** Sprint 2 sollte ausschließlich die Quality Foundation schließen. Das Sprintobjekt existiert zum Planungszeitpunkt noch nicht; Zuordnung und Start erfolgen nach Anlage des Sprintobjekts und Developer-Bestätigung.
