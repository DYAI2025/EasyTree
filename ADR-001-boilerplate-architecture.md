# ADR-001: Boilerplate als TypeScript Split-Monolith

- **Status:** Accepted for boilerplate implementation
- **Datum:** 2026-07-23
- **Entscheidungseigner:** Product/Engineering Owner Arboscus
- **Betroffene Artefakte:** `apps/`, `packages/`, `supabase/`, `openapi/`, `infra/`

## Kontext

Der Arboscus Teamplaner beginnt als MVP für mindestens zwölf Nutzer und drei parallele Baustellen. Er umfasst jedoch bereits veröffentlichte und bestätigte Planrevisionen, Zeitkonflikte, Abwesenheiten, Ressourcen, Zeitkorrekturen, Audit, Benachrichtigungen und dauerhafte Hintergrundjobs. Bei Erfolg soll dieselbe Produktbasis kostengünstig an weitere Firmen der Baumpflege-/Baum-Branche angeboten werden. Das Repository enthält noch keine Anwendungscodebasis.

## Entscheidende Kräfte

1. schneller und günstiger MVP;
2. harte Daten- und Mandantenintegrität;
3. mobile-first Web/PWA;
4. testbare Domainlogik ohne Frameworkkopplung;
5. weitere Kunden ohne Codeforks;
6. späterer Mobile-/Integrationsvertrag;
7. geringe anfängliche Betriebsbelastung;
8. schrittweise, nicht spekulative Skalierung.

## Optionen

### A. Next.js-Fullstack mit direktem Supabase-Datenzugriff

**Vorteile:** geringste Komplexität, schnellster CRUD-Start, wenig Infrastruktur.  
**Nachteile:** höhere Gefahr verteilter Businesslogik, engerer Provider-/Web-Framework-Bezug, schwächerer unabhängiger API-Vertrag und größere direkte RLS-Oberfläche.

### B. Next.js plus NestJS modularer Monolith, eine PostgreSQL-Datenbank

**Vorteile:** klare UI-/Domaintrennung, transaktionale Integrität, OpenAPI, Jobgrenze, testbare Module, später extrahierbar.  
**Nachteile:** zusätzlicher Deployment- und Vertragsaufwand, Gefahr von Scheinkapselung ohne Architekturtests.

### C. Microservices, Broker und Kubernetes

**Vorteile:** unabhängige Skalierung und Isolation.  
**Nachteile:** keine aktuelle Last-/Ownership-Evidenz; hohe Komplexität für verteilte Transaktionen, Betrieb, Reconciliation und Debugging.

## Entscheidung

Wir wählen **Option B** als eigene dünne Boilerplate:

- `pnpm` Workspace mit Turborepo;
- `apps/web`: Next.js App Router, mobile-first Web/PWA;
- `apps/backend`: NestJS modularer Domain-Monolith;
- Backend-Artefakt mit getrennten Entrypoints `api.ts` und `worker.ts`;
- Supabase Postgres, Auth und private Storage-Buckets;
- operative Schreibkommandos ausschließlich über den Backend-Kern;
- versionierte SQL-Migrationen als Schemaquelle;
- Kysely plus `pg` für typisierte Queries, parameterisiertes SQL für PostgreSQL-spezifische Operationen;
- REST/OpenAPI und generierter Webclient;
- shared-schema Multitenancy mit `organization_id`, tenant-sicheren FKs, Application Authorization und RLS;
- Transactional Outbox plus pg-boss;
- optionale Python-Runtime erst bei lokaler Transkription oder Solver-Bedarf;
- keine Microservices, Kubernetes, Kafka, Event Sourcing, GraphQL oder native App im Boilerplate-Scope.

## Modulgrenzen

Domainmodule: Tenancy/Identity, Workforce, Sites/Work, Planning, Resources, Timekeeping, Communications, Weather/Routing, Files, Audit/Integration.

Je Modul:

```text
domain/          reine TypeScript-Regeln und Value Objects
application/     Use Cases, Commands, Queries und Ports
infrastructure/  Kysely-Repositories und externe Adapter
interface/http/  Controller, DTO und Mapping
index.ts          explizite öffentliche Modul-API
```

Regeln:

- Domain importiert keine Framework- oder Infrastrukturpakete.
- Ein Modul schreibt nur seine eigenen Tabellen.
- Modulübergreifende Aufrufe gehen über öffentliche Application-APIs oder durable Events.
- `packages/shared` ist verboten; gemeinsam genutzt werden nur stabile, benannte Pakete.
- Dependency- und Tabellenbesitzregeln werden in CI geprüft.

## Daten- und Tenant-Regeln

- Jede tenant-owned Zeile hat `organization_id NOT NULL`.
- Tenant-sichere Composite-FKs verhindern Referenzen über Organisationsgrenzen.
- Serverseitige Autorisierung ist primär; RLS ist Defense-in-depth.
- Normale Runtime-Credentials dürfen RLS nicht umgehen.
- Service-Role-Zugriff ist auf Migration/Admin-Jobs beschränkt.
- Alle Caches, Jobs, Dateien, Audit- und Idempotency-Datensätze sind tenant-gebunden.
- Veröffentlichte Intervalle werden über PostgreSQL-Constraints gegen Überschneidung geschützt.
- Planrevisionen, Bestätigungen und Korrekturen bleiben historisch referenzierbar.

## Konsequenzen

### Positiv

- Ein Repository und eine Transaktionsdatenbank bleiben einfach zu betreiben.
- Web, API und Worker können separat skaliert werden.
- Weitere Firmen werden über Tenant-Konfiguration und Entitlements aufgenommen.
- API-Vertrag ist für spätere Mobile- und Partnerintegration wiederverwendbar.
- PostgreSQL erzwingt kritische Invarianten auch unter Nebenläufigkeit.

### Negativ

- Mehr initialer Aufbau als Next-only.
- Auth-, OpenAPI- und Client-Generierung benötigen CI-Pflege.
- Eine gemeinsame Datenbank bleibt zunächst gemeinsame Ausfallgrenze.
- Modulgrenzen müssen aktiv getestet werden; NestJS allein genügt nicht.

## Reversal-/Extraktionsbedingungen

Entscheidung erneut prüfen, wenn:

1. der erste vertikale Slice den API-Kern als nachweislich unverhältnismäßigen Lieferengpass zeigt;
2. Supabase-Pooling und RLS-Kontext nicht sicher reproduzierbar sind;
3. ein Modul eigenständige Ownership, Releasekadenz, SLO, Sicherheitsgrenze oder stark abweichende Last benötigt;
4. ein großer Mandant eine separate Datenresidenz oder Datenbank vertraglich verlangt;
5. PWA-Feldtests einen belegten nativen Geräte-/Offlinebedarf zeigen.

## Validierung

- Architekturtests verhindern verbotene Imports.
- pgTAP testet RLS, tenant-sichere FKs und Constraints.
- Integrationstests laufen gegen lokalen Supabase-Stack.
- OpenAPI-Diff und generierter Client laufen in CI.
- Playwright deckt den ersten Planungs-/Publish-Slice und Cross-Tenant-Negativfälle ab.
- Last- und Kostenentscheidung wird nach Pilotdaten aktualisiert.

## Rollback

Bis zum ersten produktiven Datenbestand kann die Boilerplate durch Zurücksetzen des Feature-Branches entfernt werden. Nach Schemaeinführung gelten expand/verify/contract-Migrationen; destructive Rollbacks sind ohne Restore-Nachweis verboten.
