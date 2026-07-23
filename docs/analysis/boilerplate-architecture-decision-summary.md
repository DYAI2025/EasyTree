# Boilerplate-Architekturanalyse – Entscheidungssummary

Stand: 23.07.2026

## Entscheidung

Arboscus startet als **TypeScript Split-Monolith in einem Monorepo**:

- `apps/web`: Next.js App Router, mobile-first Web/PWA;
- `apps/backend`: NestJS modularer Domainkern;
- ein Backend-Artefakt mit getrennten API- und Worker-Entrypoints;
- Supabase Postgres, Auth und private Storage-Buckets;
- operative Schreibkommandos ausschließlich über den Backendkern;
- SQL-Migrationen als einzige Schemaquelle;
- Kysely + `pg` als typisierte Datenzugriffsschicht;
- REST/OpenAPI plus generierter TypeScript-Client;
- Shared-schema Multitenancy mit `organization_id`, tenant-sicheren FKs, Application Authorization und RLS;
- Transactional Outbox plus PostgreSQL-basierte Jobqueue;
- optionale Python-Runtime nur bei belegtem Bedarf für lokale Transkription oder Solver.

## Geprüfte Alternativen

### Next.js-Fullstack mit direktem Supabase-Zugriff

Stärkster Vorteil: schnellster und günstigster MVP-Start.  
Ablehnungsgrund: Für diesen Funktionsumfang steigt das Risiko verteilter Businesslogik, direkter Datenkopplung und eines schwachen unabhängigen API-Vertrags. Kritisch sind insbesondere Planveröffentlichung, Nebenläufigkeit, Audit, Zeitkorrekturen, Hintergrundjobs und spätere Mehrmandantenfähigkeit.

### Microservices, Broker und Kubernetes

Stärkster Vorteil: unabhängige Skalierung und Fehlerisolation.  
Ablehnungsgrund: Es fehlen Last-, Team- und Ownership-Evidenz. Die zusätzlichen verteilten Transaktionen, Reconciliation- und Betriebsprobleme wären heute Overengineering.

## Dialektische Herausforderung

Die Gegenposition lautet: Ein separates Backend ist im ersten Kundenprojekt unnötiger Aufwand und bremst die Lieferung. Diese Kritik ist valide. Deshalb wird kein verteiltes Servicesystem gebaut, sondern ein gemeinsamer modularer Monolith mit einer Datenbank. Der zusätzliche Backendkern ist nur gerechtfertigt, wenn der erste vertikale Slice nachweislich bessere Invarianten, Autorisierung, Testbarkeit und API-Stabilität liefert. Diese Annahme ist durch den Referenz-Slice zu falsifizieren.

## Nachhaltigkeitsgründe

1. **Mandantenfähigkeit ohne Kundenforks:** Organisation ist ab Tag eins Daten- und Autorisierungsgrenze.
2. **Datenintegrität:** PostgreSQL-Constraints schützen kritische Zeit- und Ressourceninvarianten auch bei Nebenläufigkeit.
3. **Testbarkeit:** Domainlogik bleibt frei von UI-, HTTP-, ORM- und Providerabhängigkeiten.
4. **Erweiterbarkeit:** Fachmodule besitzen explizite APIs und Tabellenownership.
5. **Betrieb:** Web, API und Worker können getrennt skaliert werden, bleiben aber ein Code- und Transaktionssystem.
6. **Spätere Apps/Integrationen:** OpenAPI ist wiederverwendbare Vertragsgrenze.
7. **Reversible Evolution:** Services werden erst bei belegter Ownership, Last, SLO- oder Sicherheitsgrenze extrahiert.

## Kritische Failure-Mode-Kette

Falscher oder ungeprüfter Tenantkontext → Cross-Tenant-Datenzugriff → Datenschutz- und Vertrauensschaden → SaaS-Vertrieb an weitere Firmen gefährdet.

Daraus folgen zwingend tenant-sichere Foreign Keys, serverseitige Autorisierung, RLS, negative Cross-Tenant-Tests sowie tenantgebundene Cache-, Datei-, Job-, Audit- und Idempotency-Schlüssel.

## Widerlegungskriterien

Die Entscheidung muss revidiert werden, wenn:

- der Referenz-Slice einen unverhältnismäßigen Backend-/Vertragsaufwand ohne Qualitätsgewinn zeigt;
- Supabase-Pooling und RLS-Kontext nicht sicher reproduzierbar sind;
- reale Last, Ownership oder Verfügbarkeit eine unabhängige Servicegrenze erfordern;
- ein Großkunde eine separate Datenbank oder andere Datenresidenz verlangt;
- PWA-Feldtests einen belegten nativen Offline-/Gerätebedarf zeigen.

## Status

- Architekturentscheidung: **PASS_WITH_ASSUMPTIONS**
- Boilerplate-Plan: **READY_FOR_EXECUTION**
- Produktionsfreigabe: **BLOCKED** bis Hosting, Retention, Security, Backup/Restore, SLOs und Betriebsnachweise vorliegen.
