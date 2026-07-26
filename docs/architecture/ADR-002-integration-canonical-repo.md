# ADR-002: Kanonisches Repository, Produktidentität und Prototypstatus

- **Status:** Accepted (ein offener Bestätigungspunkt, siehe „Offene Punkte")
- **Datum:** 2026-07-26
- **Jira:** EYT-78
- **Entscheidungseigner:** Product/Engineering Owner
- **Betroffene Artefakte:** `docs/`, `apps/`, `packages/`, Jira-Projekt `EYT`, GitHub-Organisation `DYAI2025`
- **Verhältnis zu ADR-001:** ergänzend. ADR-001 bleibt der bindende Architekturvertrag;
  ADR-002 legt Identität, Repository-Zuordnung und Paketbenennung fest.

## Kontext

Die Drei-Repository-Analyse vom 26.07.2026 (`docs/audit/`) hält als `FIND-002` (High) und
`GAP-001` (High) fest, dass Produkt- und Repository-Bezeichnungen inkonsistent sind. Im
Umlauf sind drei Namen:

| Name                    | Wo verwendet                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------- |
| **EasyTree**            | GitHub-Repository, Jira-Projekt `EYT`, Paketnamensraum `@easytree/*`, PWA-Manifest |
| **Arboscus Teamplaner** | Titel von PRD v1.3, MVP-Scope v1.3, ADR-001                                        |
| **Arborga**             | PRD v1.3 (Z. 135), Agent-Handoff v1.3 (Z. 4), Sprint-2-Plan, Generatorartefakte    |

EYT-78 beschreibt dies als Konflikt zwischen zwei kanonischen Zielen. Die Prüfung ergibt ein
anderes Bild:

- `DYAI2025/Arborga` **existiert nicht** als eigenständiges Repository (`gh repo list DYAI2025`).
- `Arborga` ist der **frühere Name desselben Repositories**, umbenannt am 25.07.2026;
  GitHub leitet den alten Pfad weiter. Belegt in
  `docs/architecture/ARCHITECTURE_DECISIONS_v1.3.md` (Z. 14) und
  `docs/runbooks/branch-protection.md` (Z. 139–141).
- Die Analyse empfiehlt unabhängig davon: „**EasyTree-master wird das einzige kanonische
  Produkt-Repository.**" (`docs/audit/INTEGRATION_ARCHITECTURE.md`)

Es liegt also keine Architekturentscheidung zwischen zwei Repositories vor, sondern eine
Referenz- und Identitätsbereinigung.

## Entscheidung

### 1. Kanonisches Repository

- **Repository:** `https://github.com/DYAI2025/EasyTree`
- **Default Branch:** `master` (geschützt durch Ruleset `19718704`, siehe
  `docs/runbooks/branch-protection.md`)
- **Jira-Projekt:** `EYT`, Board 72

`DYAI2025/Arborga` ist ein **retirierter Name** dieses Repositories. Verweise darauf sind
historisch und dürfen nicht als aktives Ziel behandelt werden.

### 2. Produktidentität

- **Produktname (nutzersichtbar):** „Arboscus Teamplaner"
- **Technischer Namensraum:** `easytree` — Repository, Paketnamen `@easytree/*`, Jira-Präfix
  `EYT`, Verzeichnisse und CI-Bezeichner bleiben unverändert.

Begründung: `docs/prd/CURRENT_PRD_v1.3.md` ist laut `CLAUDE.md` die fachliche Quelle der
Wahrheit und titelt „Arboscus Teamplaner". Ein technischer Rename hätte hohe Kosten
(Paketnamen, CI-Ruleset, Jira-Verknüpfungen, PR-Historie) ohne fachlichen Nutzen.

### 3. Prototypstatus

| Repository                 | Status                                                        |
| -------------------------- | ------------------------------------------------------------- |
| `DYAI2025/EasyTree`        | kanonisches Produkt-Monorepo                                  |
| `DYAI2025/EasyTree-UIUX`   | **eingefrorene UX-Referenz** — Planer-/Management-Clickdummy  |
| `DYAI2025/EasyTree-App-UI` | **eingefrorene UX-Referenz** — mobiler Mitarbeiter-Clickdummy |

„Eingefroren" heißt: keine Weiterentwicklung als eigenständige Produktanwendung, keine
Netzwerk- oder Repository-Kopplung an das Backend. Ihre Komponenten und UX-Flows werden
**selektiv** in die bestehende Next.js-Anwendung migriert (EYT-72, EYT-81).

Die Analyse dokumentiert in beiden Prototypen Fehler, die **nicht** mitportiert werden dürfen;
sie sind in `docs/audit/AUDIT_REPORT.md` als `FIND-003` bis `FIND-010` belegt und in
`docs/plans/2026-07-26-eyt-sprint-3-integrierter-slice.md` (Abschnitt L-11) als PR-Auflage
verankert.

### 4. Zielstruktur: ein Monorepo, zwei Rollen-Shells

Eine gemeinsame Next.js-Anwendung mit zwei rollenbasierten Bereichen statt zwei Frontends —
ein Login, eine Session, ein Rollenmodell, ein Designsystem, ein API-Client
(`docs/audit/INTEGRATION_ARCHITECTURE.md`, „Warum eine Web-App mit zwei Rollen-Shells?").

```text
apps/web/app/(planner)/planung/...     Administrator, Geschäftsführung, Disposition
apps/web/app/(employee)/einsatz/...    operativer Mitarbeiter
apps/web/app/(auth)/login/...          gemeinsamer Einstieg
```

Eine separate Mitarbeiter-App wird erst erwogen, wenn echte Offline-Schreibfähigkeit,
Gerätesensoren, Push-/Hintergrundanforderungen oder unabhängige Releasezyklen belegt sind.

### 5. Paketbenennung

`docs/plans/2026-07-23-boilerplate-architecture.md` (TASK-012) nennt `packages/api-client`;
`docs/audit/INTEGRATION_ARCHITECTURE.md` (jünger, spezifischer) nennt `packages/domain` und
`packages/contracts`. **Wir folgen der jüngeren Quelle:**

| Paket                         | Inhalt                                                       |
| ----------------------------- | ------------------------------------------------------------ |
| `packages/domain`             | reine Typen, Invarianten, Zustandsmodelle — framework-frei   |
| `packages/contracts`          | OpenAPI-Dokument, DTO/Schemas, generierter TypeScript-Client |
| `packages/ui`                 | gemeinsame Tokens und Primitives (bestehend)                 |
| `packages/config`             | validierte Umgebungskonfiguration (bestehend)                |
| `packages/prototype-fixtures` | ausschließlich Clickdummy-/Testdaten, klar gekennzeichnet    |

`packages/api-client` entfällt zugunsten von `packages/contracts`. `packages/shared` bleibt
nach ADR-001 verboten — alle genannten Pakete sind stabile, benannte Pakete und damit konform.

### 6. Ist-Struktur weicht von ADR-001 ab (festgeschrieben, kein Umbau)

ADR-001 (Z. 46/47) beschreibt `apps/backend` mit den Entrypoints `api.ts` und `worker.ts`.
Tatsächlich gebaut und dokumentiert wurde `apps/api` mit `src/main.ts` und `src/worker.ts`
(EYT-42). Die **gebaute Struktur ist maßgeblich**; ADR-001 wird dadurch nicht ungültig, die
Benennung gilt als redaktionelle Drift und wird hier festgeschrieben statt nachträglich
umbenannt.

## Verworfene Optionen

1. **Drei eigenständige Apps mit gegenseitigen APIs** — zu viel Duplikation und Drift für ein
   Unternehmen dieser Größe; Domain- und Statuslogik würde dreifach gepflegt (`FIND-001`).
2. **Vite-Prototypen direkt an Supabase hängen** — umgeht die im Monorepo bereits angelegte
   API-, Tenant- und Autorisierungsgrenze.
3. **Komplette Neuentwicklung beider UIs** — verwirft vorhandenes UX-Lernen; gezielte Migration
   ist günstiger.
4. **Technischer Rename auf `Arboscus`** — hohe Kosten (Paketnamen, Ruleset, Jira-Verknüpfungen,
   PR-Historie) ohne fachlichen Nutzen.
5. **`Arborga` reaktivieren** — das Repository existiert nicht; die Umbenennung ist bereits
   vollzogen und dokumentiert.

## Evidenz

Die Entscheidungsgrundlage liegt ab sofort **versioniert** in `docs/audit/` (zuvor nur
unversioniert außerhalb des Repositories, wodurch die Akzeptanzkriterien von EYT-11, 78, 79,
80, 81, 82, 85, 86 und 87 nicht reproduzierbar prüfbar waren).

**Evidenzgrenze der Analyse — wörtlich aus `docs/audit/README.md`:**

> Die ZIPs wurden entpackt und der Quelltext statisch inspiziert. Builds, Tests und
> Browser-Flows konnten in dieser Umgebung nicht erneut ausgeführt werden … Runtime- und
> Produktionsaussagen sind daher nicht verifiziert.

Aussagen aus `docs/audit/` sind damit `source-inspected`, nicht `verified`. Sie begründen
Entscheidungen, ersetzen aber keinen ausgeführten Test.

## Offene Punkte

- **Produktname bestätigungspflichtig.** Abschnitt 2 legt „Arboscus Teamplaner" als
  nutzersichtbaren Namen fest. Diese Entscheidung ist vom Product Owner zu bestätigen, **bevor**
  nutzersichtbare Strings (Seitentitel, PWA-Manifest, E-Mail-Absender) gesetzt werden. Bis dahin
  bleibt das bestehende Manifest unverändert.

## Konsequenzen

### Positiv

- Ein eindeutiges Merge-, Jira- und CI-Ziel; `FIND-002` / `GAP-001` sind adressiert.
- Die Evidenzbasis ist versioniert und für Dritte prüfbar.
- Paketbenennung ist widerspruchsfrei und ADR-001-konform.
- Prototypfehler sind benannt, bevor die Portierung beginnt.

### Negativ

- Generatorartefakte im Repository-Root (`prd_report_v1.3.{md,json}`,
  `arboscus_teamplaner_finale_prd_de_v1.3.md`) enthalten weiterhin den Namen `Arborga`. Sie sind
  laut `CLAUDE.md` unedierte Rohartefakte und werden **nicht** nachträglich verändert;
  maßgeblich sind die kuratierten Dokumente unter `docs/`. Ebenso bleibt die verbatim
  übernommene Analyse unter `docs/audit/` unverändert — sie dokumentiert den Befund, der zu
  diesem ADR geführt hat.
- Der Default-Branch bleibt `master`. `arboscus_teamplaner_finale_prd_de_v1.3.md` (Z. 417) stellt
  frei, ihn auf `main` umzustellen oder `master` bewusst zu bestätigen; ADR-002 bestätigt
  `master`, weil das Ruleset `19718704` und alle bestehenden PR-Referenzen darauf zielen.
- Die Doppelidentität „Arboscus" (Produkt) / „easytree" (Technik) bleibt erklärungsbedürftig.

## Rollback

Reine Dokumentänderung. Rückbau durch Revert des Merge-Commits; es entsteht kein Schema- und
kein Laufzeitzustand. Sollte der Product Owner den Produktnamen abweichend entscheiden, wird
Abschnitt 2 per Folge-ADR ersetzt — die Repository- und Paketentscheidungen bleiben davon
unberührt.
