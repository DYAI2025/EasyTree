# Provenance des Scope-Manifests `sprint-5-daily-cost-export`

Stand: 03.08.2026 · gilt für `docs/scope/sprint-5-daily-cost-export.scope.json`
mit dem Digest `41995f2cc2c5…` (gebunden in
`.plumbline/scope-authority/sprint-5-daily-cost-export.json`).

**Revision 2, Product-Owner-Bestätigung 03.08.2026.** Revision 1 (`82b4426`)
wurde gebunden, bevor `pnpm format:fix` die Datei normalisierte — die gebundene
Fassung war eine, die Prettier ablehnt, und damit unvereinbar mit dem
Pflichtcheck `format`. Der Product Owner hat den Scope daraufhin ausdrücklich
bestätigt, das Entwaffnen freigegeben und die hier beschriebene Endfassung
autorisiert. Sie ist Prettier-sauber; derselbe Konflikt kann nicht wiederkehren.

Zwei inhaltliche Änderungen gegenüber Revision 1:

- `.gitignore` kommt in den erlaubten Scope, damit `.plumbline/` — der
  Laufzustand des Guards selbst — ignoriert werden kann. Ohne das erschien er
  als ungetrackte Datei in der Prüfoberfläche und erzeugte einen
  Hygiene-Befund.
- `generated_artifacts` **entfällt ersatzlos.** Die Deklaration nannte
  `producer: packages/contracts/src/**`, was nicht im erlaubten Scope liegt —
  der `provenance`-Gate meldete zu Recht `PRODUCER_OUT_OF_SCOPE`. EYT-107
  ändert weder `openapi/v1.json` noch dessen Produzenten; die Deklaration war
  eine unnötige Zutat und keine Zusicherung, die jemand braucht.

## Warum diese Begründungen NICHT im Manifest stehen

Sie standen dort — für einen Lauf. Der PRIL-Guard hat es abgelehnt:

> `SCOPE_AUTHORITY_CHANGED: … changed during an armed run … A manifest never
authorizes its own change.`

Die Begründung dafür steht in `plumbline_scope.py` und ist überzeugend:

> „Provenance recorded _inside_ the same mutable file cannot carry that — an
> attacker who can edit the scope can edit its audit trail in the same write."

Ein Nachweis, den dieselbe Schreiboperation fälschen kann, die er absichern
soll, ist keiner. Die Herkunft gehört deshalb neben das Manifest, nicht hinein.
Diese Datei ist **nicht** autoritativ: sie erklärt, sie erlaubt nichts. Autorität
hat allein das gepinnte Manifest.

## Aufbau des Manifests

**65 Einträge sind unverändert übernommen** aus
`docs/canvas/sprint-5-daily-cost-export.canvas.md`, Abschnitt
„Allowed change scope" — der bereits bestätigte Scope des Sprint-5-Features.
Programmatisch extrahiert, nicht abgetippt.

Das ist kein Komfort, sondern notwendig: **ein Manifest ERSETZT den Canvas, es
ergänzt ihn nicht** (gemessen: `source=manifest` statt `source=canvas`). Hätte
ich nur die EYT-107-Pfade aufgeführt, wäre die bereits gemergte Sprint-5-Arbeit
— Kostenmodul, Auth-Slice, Stundensätze — schlagartig zur Scope-Verletzung
geworden.

**8 Einträge sind neu.** Jeder einzeln begründet:

| Pfad                                              | Quelle                                                                                                      | Warum EYT-107 ihn braucht                                                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/planning/domain/**`         | Jira EYT-107 AK3; Plan T-10                                                                                 | Wochenzuordnung der Zuweisungen. Das Schema verknüpft `week_key` mit keinem Zeitstempel — offene Lücke aus EYT-49.                                                      |
| `apps/api/src/modules/planning/infrastructure/**` | Jira EYT-107 AK4/AK5; Confluence 8552449 S5-REQ-03                                                          | Die Publish-Transaktion selbst: `published_at`, Audit, Outbox, Idempotenz in einer Klammer.                                                                             |
| `apps/api/src/modules/planning/interface/**`      | Jira EYT-107 AK1/AK6                                                                                        | `POST /planung/versionen` und die vier stabilen Fehlertypen.                                                                                                            |
| `apps/api/src/modules/planning/index.ts`          | ADR-001 Z. 76                                                                                               | Modulzugriff ausschließlich über die öffentliche API; neue Ports müssen dort heraus.                                                                                    |
| `apps/web/app/planung/**`                         | Jira EYT-107 AK7; Confluence 8814623 (Publish-Aktion im Kopfbereich, Zustandsliste §4)                      | Planungsroute und ihr Zugangswächter.                                                                                                                                   |
| `docs/reviews/**`                                 | Product-Owner-Entscheidung 03.08.2026 („ausgeführte und nicht ausgeführte Gegenmutationen getrennt halten") | Gegenmutationsprotokoll zu EYT-107. Enthält zusätzlich einen bereits auf `origin/master` liegenden EYT-133-Bericht.                                                     |
| `apps/api/src/platform/idempotency/**`            | PR #45 / EYT-108, bereits auf `origin/master`                                                               | **Nur als benutzte Abhängigkeit.** Der Publish-Pfad verwendet den vorhandenen Plattformport, statt eine zweite Idempotenz zu bauen. EYT-107 ändert diese Dateien nicht. |
| `.gitignore`                                      | Product-Owner-Bestätigung 03.08.2026; PRIL-Hygiene-Befund `class=unignored pattern=.plumbline/`             | Ausschließlich, um `.plumbline/` zu ignorieren — den Laufzustand des Guards. Keine weitere Nutzung vorgesehen.                                                          |

## Klassifikation der ursprünglichen zehn PRIL-Befunde

| Befund                                                                                                                                                                                                                                                                                                           | Klasse                                                | Behandlung                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| `planning/domain/week-membership.ts`, `planning/index.ts`, `planning/infrastructure/planning-write.repository.ts`, `planning/interface/http/planning-problem.filter.ts`, `planning/interface/http/planning.controller.ts`, `apps/web/app/planung/page.tsx`, `docs/reviews/2026-08-03-eyt-107-gegenmutationen.md` | **1 — durch PR #52 tatsächlich geändert**             | autorisiert, je Zeile begründet                          |
| `apps/api/src/platform/idempotency/{idempotency-store,pg-idempotency-store}.ts`                                                                                                                                                                                                                                  | **2 — bereits auf `origin/master`** (PR #45, EYT-108) | autorisiert als Abhängigkeit; von EYT-107 nicht geändert |
| `docs/reviews/2026-08-02-eyt-133-secret-guard-hardening.md`                                                                                                                                                                                                                                                      | **2 — bereits auf `origin/master`** (EYT-133)         | fällt unter `docs/reviews/**`                            |

Damit ist auch ein Nebenbefund festgehalten: **drei der zehn Verletzungen
stammen nicht aus PR #52.** Der Scope war bereits gegenüber gemergtem `master`
veraltet, bevor EYT-107 begann.

## Ausdrücklich NICHT autorisiert

Der `plan`-Gate meldete zusätzlich Zeichenketten, die aus dem **Plantext**
stammen und keine geänderten Dateien sind. Keine davon steht im Manifest:

- `shared/services` — existiert nicht; stammt aus einem Confluence-Zitat
  („keinen generischen `shared`-/`services`-Container") im Plan.
- `origin/master`, `feat/sprint-5-daily-cost-export` — Branchnamen, keine Pfade.
- `time-interval.test.ts`, `time-interval.property.test.ts`,
  `domain-invariant-coverage.test.ts`, `supabase/config.toml`,
  `scripts/read-through-harness.sh`, `verify-branch-protection.sh`,
  `application/*.port.ts`, `costs/domain`, `ci.yml` — im Plan als Prosa
  erwähnt; von EYT-107 nicht geändert. (`.github/workflows/ci.yml` und
  `scripts/verify-branch-protection.sh` sind ohnehin seit dem Canvas
  bestätigt — sie stehen hier nur, weil der Plan-Gate sie als Textfund
  meldete.)
- **EYT-109 und EYT-110:** keine Pfade vorweg autorisiert.

## Wie eine künftige Erweiterung aussieht

Nicht als Dateiänderung. Der Guard bindet den Manifest-Digest für die Dauer
eines armierten Laufs; eine Bearbeitung mitten im Lauf wird abgelehnt. Der Weg
ist: Lauf beenden beziehungsweise entwaffnen (gebundene Baseline unter
`.plumbline/scope-authority/` entfernen), den neuen Scope **mit dem Menschen
bestätigen**, neu armieren. Diese Datei hier ist dann fortzuschreiben.
