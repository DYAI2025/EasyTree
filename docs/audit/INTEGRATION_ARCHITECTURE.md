# Empfohlene Integrationsarchitektur

## Entscheidung

**EasyTree-master wird das einzige kanonische Produkt-Repository.** Die beiden Vite-Repositories werden nicht über Netzwerk- oder Repository-Schnittstellen miteinander gekoppelt, sondern als UX-Referenzen und Quellmodule in das Monorepo migriert.

## Beste Übergabeschnittstelle

Die passende Naht ist ein **gemeinsamer, versionierter Domain- und API-Vertrag**:

```text
Planer-UI                         Mitarbeiter-UI
(EasyTree-UIUX)                  (EasyTree-App-UI)
       \                              /
        \  typed UI ports/gateways   /
         v                          v
        packages/contracts + packages/domain
                       |
                       v
              NestJS Application API
                       |
             Domain Commands / Queries
                       |
           Supabase/PostgreSQL + RLS
                       |
       Outbox/Worker -> E-Mail/Wetter/Reminder
```

## Zielstruktur

```text
EasyTree-master/
├── apps/
│   ├── web/
│   │   ├── app/(planner)/planung/...
│   │   ├── app/(employee)/einsatz/...
│   │   └── app/(auth)/login/...
│   └── api/
│       ├── modules/planning/
│       ├── modules/workforce/
│       ├── modules/worksites/
│       ├── modules/absence/
│       ├── modules/resources/
│       ├── modules/time/
│       ├── modules/notifications/
│       └── modules/weather/
├── packages/
│   ├── domain/              # reine Typen, Invarianten, Zustandsmodelle
│   ├── contracts/           # OpenAPI/DTO/Schema und generierter Client
│   ├── ui/                  # gemeinsame Tokens und Primitives
│   └── prototype-fixtures/  # nur Clickdummy-/Testdaten
└── supabase/migrations/     # fachliches Schema, Constraints, RLS
```

## Warum eine Web-App mit zwei Rollen-Shells?

Für das MVP ist eine gemeinsame Next.js-Web-/PWA-Anwendung kleiner und robuster als zwei getrennte Frontends:

- ein Login und eine Session;
- ein Rollen-/Berechtigungsmodell;
- ein Designsystem;
- ein API-Client;
- gemeinsame Typen und Zustandsmodelle;
- weniger Deployment-, Routing- und Versionsrisiko.

Eine spätere separate Mitarbeiter-App ist nur sinnvoll, wenn echte Offline-Schreibfähigkeit, Gerätesensoren, Push-/Hintergrundanforderungen oder unabhängige Releasezyklen dies belegen.

## UI-Port für Clickdummy und spätere API

Die UI soll nicht direkt auf Mockdaten oder Supabase zugreifen. Sie hängt an Ports:

```ts
interface PlanningGateway {
  getPlanningWindow(input: PlanningWindowQuery): Promise<PlanningWindow>;
  validateDraft(input: ValidatePlanCommand): Promise<PlanValidationResult>;
  createAssignment(input: CreateAssignmentCommand): Promise<Assignment>;
  publishPlan(input: PublishPlanCommand): Promise<PublishedPlanVersion>;
}

interface EmployeeGateway {
  getMySchedule(input: MyScheduleQuery): Promise<EmployeeSchedule>;
  confirmPlan(input: ConfirmPlanCommand): Promise<Confirmation>;
  rejectAssignment(input: RejectAssignmentCommand): Promise<Rejection>;
  startTime(input: StartTimeCommand): Promise<ActiveTimeEntry>;
  stopTime(input: StopTimeCommand): Promise<SubmittedTimeEntry>;
}
```

Für den Clickdummy existiert zunächst `MockPlanningGateway`/`MockEmployeeGateway`; für das MVP wird derselbe Vertrag durch einen `HttpGateway` bedient. So bleibt der Clickdummy interaktiv, ohne falsche Backend-Funktion vorzutäuschen.

## Zentrale Domänenobjekte

- Organization, User, Employee, Role, Permission
- Worksite, WorkPackage/Activity, MeetingPoint
- Skill, Certification, EmployeeSkill
- Vehicle, Equipment, ResourceReservation, ConditionReport
- PlanningWindow, PlanVersion, Assignment, AssignmentChange
- Conflict, ValidationResult, Publication
- Confirmation, Rejection, Notification
- AbsenceRequest, AbsenceDecision
- ActiveTimeEntry, TimeEntry, TimeApproval, TimeCorrection
- WeatherSnapshot, WeatherWarning

## Zeit- und Veröffentlichungsregeln

- Persistiere UTC-Instants plus IANA-Zeitzone und lokale Geschäftsdaten.
- Nutze halb-offene Intervalle `[start, end)`.
- Server validiert jede schreibende Planungsaktion erneut.
- Veröffentlichung ist eine atomare Domain-Operation: Version erzeugen, Konflikte prüfen, Audit schreiben, Benachrichtigungen auslösen.
- Clientseitige Konfliktlogik darf UX-Feedback liefern, ist aber niemals Autorität.
- Doppelbelegung und exklusive Ressourcen müssen zusätzlich in Datenbank/Transaktion geschützt werden.

## Verworfen

1. **Drei eigenständige Apps mit gegenseitigen APIs:** zu viel Duplikation und Drift für ein 15-Personen-Unternehmen.
2. **Vite-Prototypen direkt an Supabase hängen:** umgeht die im Master bereits angelegte API-, Tenant- und Autorisierungsgrenze.
3. **Komplette Neuentwicklung der UIs:** verschwendet vorhandenes UX-Lernen; gezielte Migration ist sinnvoller.
