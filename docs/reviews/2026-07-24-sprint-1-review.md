# EasyTree Sprint 1 Review

- Review-Datum: 2026-07-24
- Jira-Sprint: EYT Sprint 1, ID 104
- Sprintzeitraum laut Jira: 2026-07-23 bis 2026-08-06
- Repository: `DYAI2025/EasyTree`
- Haupt-PR: #3, Merge-Commit `37fec639f1b42610cee60a99747a646cefe7c00d`
- Review-Entscheidung: **PARTIAL PASS / Sprintziel technisch begonnen, aber nicht vollständig evidenzbasiert abgeschlossen**

## Sprintziel

Eine lokal reproduzierbare technische Basis für EasyTree bereitstellen, bestehend aus Web-Shell, Backend-API, Worker und lokalem Supabase-Stack. Zwei synthetische Organisationen dürfen weder über API, Datenbank noch Storage auf Daten der jeweils anderen zugreifen.

## Was funktioniert

1. **Repository- und Toolchain-Basis**
   - pnpm-Workspace und Turborepo wurden angelegt.
   - Root-Kommandos für Format, Lint, Typecheck, Tests und Build sind vorhanden.
   - Node- und pnpm-Versionen sind im Repository dokumentiert.

2. **API und Worker**
   - Getrennte API- und Worker-Entrypoints existieren.
   - Health-, Readiness-, Correlation-ID-, Fehlerfilter- und Shutdown-Tests wurden angelegt.

3. **Web-/PWA-Shell**
   - Next.js-Shell, PWA-Manifest und API-Client-Grenze existieren.
   - Automatisierte Accessibility-Smokes prüfen unter anderem Skip-Link, Main-Landmark und Dokumentensprache.
   - Ein Test verhindert direkte Supabase-Importe im Webclient.

4. **Supabase und Tenant-Isolation**
   - Versionierte Migrationen, synthetische Seeds, pgTAP-Tests und Integrationstests sind vorhanden.
   - RLS, aktive Memberships, Cross-Tenant-Reads/Writes, IDOR, Storage-Pfade und tenantgebundene Fremdschlüssel werden geprüft.
   - Der dokumentierte lokale Lauf meldet 33 erfolgreiche Datenbanktests und 7 erfolgreiche Node-Integrationstests.

5. **Jira-Umfang im Sprintobjekt**
   - EYT-13, EYT-15 und EYT-40 bis EYT-44 wurden dem Sprintobjekt zugeordnet.
   - Die Implementierung wurde über PR #3 auf `master` gemergt.

## Was nicht funktioniert oder nicht ausreichend belegt ist

### 1. Keine GitHub-CI

Für den Merge-Commit existieren keine Statuschecks und keine GitHub-Actions-Workflow-Runs. Die im Repository dokumentierten lokalen Testläufe sind daher kein automatisierter Merge-Nachweis.

**Auswirkung:** EYT-56, EYT-57 und EYT-58 bleiben offen.

### 2. PR ohne dokumentiertes Review

PR #3 umfasste 82 Dateien und 8.648 neue Zeilen. Er wurde innerhalb weniger Sekunden nach Erstellung gemergt. Es existieren keine Review-Threads und keine dokumentierte unabhängige Prüfung.

**Auswirkung:** Branch Protection und Pflichtchecks fehlen. Folge-Ticket: EYT-67.

### 3. Tenant-Sicherheit kann durch vollständige Skips grün erscheinen

`tenant-isolation.integration.test.ts` überspringt alle sieben Tests, wenn die Datenbank nicht erreichbar ist. Ein normaler Testlauf kann dadurch erfolgreich enden, obwohl das Pflicht-Sicherheitsgate nicht ausgeführt wurde.

**Auswirkung:** Sicherheitsgate ist nicht fail-closed. Bug: EYT-66.

### 4. Produktiver Pooling-Nachweis fehlt

Der Tenant-Isolation-Report dokumentiert, dass der lokale Supavisor-Container nicht lief. Das Transaction-Mode-Verhalten wurde auf DB-Ebene simuliert, aber nicht gegen einen laufenden Pooler ausgeführt.

**Auswirkung:** EYT-15 wurde von `Fertig` zurück auf `Zu erledigen` gesetzt.

### 5. Accessibility-Abnahme ist offen

Die automatisierten Tests laufen in jsdom; Farbkontrast ist deaktiviert. Die manuelle Checkliste weist Tastatur, Fokus, 200-%-Zoom, Non-Color, Kontrast und Screenreader weiterhin als offen aus.

**Auswirkung:** EYT-41 wurde von `Fertig` zurück auf `Zu erledigen` gesetzt.

### 6. Sprintumfang und Sprintdaten waren widersprüchlich

Die Kandidaten EYT-56 bis EYT-58 waren mit Sprint-1-Labels und eigenen Daten markiert, aber nie dem tatsächlichen Sprintobjekt zugeordnet. Das Sprintobjekt lief vom 23.07. bis 06.08.; mehrere Tickets trugen dagegen den Planzeitraum 27.07. bis 09.08.

**Auswirkung:** Labels ersetzen keine Sprintzuordnung. Künftige Sprintplanung muss das tatsächliche Sprintobjekt nach dem Schreiben erneut lesen.

### 7. Fresh-Checkout-Nachweis in dieser Review-Umgebung nicht reproduzierbar

Der öffentliche Git-Clone war aufgrund fehlender DNS-/Netzwerkauflösung im Ausführungscontainer nicht möglich. Die Review stützt sich daher auf GitHub-Dateien, PR-Diffs, Jira und dokumentierte lokale Testläufe.

**Status:** `UNVERIFIED` für einen unabhängigen Fresh-Checkout-Lauf in dieser Sitzung.

## Ticketstatus nach Review

| Ticket | Reviewstatus | Begründung |
|---|---|---|
| EYT-13 | Fertig akzeptiert | ADR und technische Leitplanken liegen vor |
| EYT-15 | Zurück auf Zu erledigen | echter Pooler-Nachweis und fail-closed CI fehlen |
| EYT-40 | Fertig akzeptiert | Workspace, Root-Skripte und Lockfile vorhanden |
| EYT-41 | Zurück auf Zu erledigen | manuelle Accessibility-Abnahme offen |
| EYT-42 | Fertig mit Rest-Risiko akzeptiert | API/Worker vorhanden; CI-Ausführung folgt EYT-58 |
| EYT-43 | Fertig mit Rest-Risiko akzeptiert | Konfigurationscode und Tests vorhanden; CI folgt EYT-56 |
| EYT-44 | Fertig mit Rest-Risiko akzeptiert | Migrationen/Seeds vorhanden; automatische CI folgt EYT-57 |

## Neue Folge-Tickets

- EYT-66: Tenant-Isolationstest muss bei fehlender DB fail-closed sein.
- EYT-67: Branch Protection und verpflichtende GitHub-Checks erzwingen.

## Review-Fazit

Der Sprint hat eine substanzielle technische Foundation erzeugt. Er hat jedoch das zentrale Qualitätsversprechen noch nicht automatisiert bewiesen. Der nächste Sprint muss deshalb vor weiterem Fachausbau CI, Merge-Governance, Tenant-Fail-Closed-Verhalten und Accessibility-Abnahme schließen.

## Failure-Mode-Kette

Fehlende Pflichtchecks -> großer PR wird ungeprüft gemergt -> Tenant- oder Migrationsprüfung wird übersprungen -> Fehler gelangt auf `master` -> spätere Features bauen auf falscher Sicherheitsannahme auf.

## Entscheidung

**PASS_WITH_CRITICAL_CARRYOVER**. Kein weiterer breiter Domainausbau, bevor die Sprint-2-Qualitätsgates grün und technisch erzwungen sind.
