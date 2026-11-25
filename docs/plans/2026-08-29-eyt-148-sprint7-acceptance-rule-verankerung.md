# Sprint-7 UI/UX Acceptance Contract im Repository verankern — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **DIRECT_EXECUTION-Regel (Projektgedächtnis `direct-execution-forbids-committed-plans`):**
> Diese Plandatei bleibt UNTRACKED und wird NICHT committet, nicht gestaged und
> nicht in die PR-Beschreibung kopiert. Sie ist Arbeitsdokument, kein Repoinhalt.

**Goal:** Den Sprint-7-UI/UX-Abnahmevertrag als versionierte Agent-Regel
(`.claude/rules/sprint-7-ui-ux-acceptance.md`) plus CLAUDE.md-Anker plus
deterministischen CI-Guard (`apps/api/test/sprint7-acceptance-rule-guardrails.test.ts`)
in `DYAI2025/EasyTree` verankern und per PR gegen `master` zur Review stellen.

**Architecture:** Drei Artefakte, ein Mechanismus: CLAUDE.md (auto-geladen in jeder
Claude-Code-Session) trägt einen kurzen Anker mit `@`-Import auf die Rule-Datei;
die Rule trägt den vollen Vertrag; ein Vitest-Guard nach dem Muster von
`handoff-guardrails.test.ts` (EYT-89) prüft semantisch tragende Marker — er läuft
im bestehenden Pflichtjob `unit-tests`, also ohne Ruleset-Änderung. Test-first:
der Guard wird VOR der Rule geschrieben und einmal rot gesehen.

**Tech Stack:** Vitest (apps/api, SWC), `findRepoRoot` aus
`apps/api/test/architecture/scan.ts`, pnpm 10.28.0 / Node 22, `gh` CLI.

---

## Verifizierter Ausgangszustand (Planungszeitpunkt 29.08.2026)

| Fakt | Wert | Evidenz |
| --- | --- | --- |
| `origin/master` | `38b32754ea870ba8c0347af0245b4dd7fa96b20c` (Merge PR #97) | `git rev-parse origin/master` nach fetch |
| Aktueller Branch | `feat/eyt-126-container-staging`, Working Tree DIRTY (u. a. `M CLAUDE.md` mit 378+/688−, `M .gitignore`) | `git status --short` |
| `.claude/` im Repo | existiert nur untracked (settings.json, settings.local.json, homunculus/); **kein einziger getrackter Pfad** (`git ls-files .claude` leer) | Bash-Inventar |
| `.gitignore` auf origin/master | ignoriert nur `/.claude-flow/` und `/.claude/homunculus/` — `.claude/rules/` ist trackbar; die Zeile `/.claude/settings.local.json` existiert NUR im lokalen Working Tree, nicht auf master | `git show origin/master:.gitignore` |
| Guard-Konvention | `apps/api/test/handoff-guardrails.test.ts`: Nicht-Leerlauf-Zusicherung, `## `-Heading-Liste, exakte Marker-Sätze, KEIN Byte-Snapshot; läuft in `unit-tests` (`include: test/**/*.test.ts`) | Datei gelesen |
| Jira EYT-148 | vollständig gelesen; Inhalt deckt den Spec-Vertrag (reale Journeys, no-mocks, Basisdesign v2.0, 1440/1920 + 320/375, axe, 200-%-Zoom, States, Testintegrität, DoD); Status „Zu erledigen" | `getJiraIssue` (Rovo MCP) |
| Sprint 579 | enthält exakt EYT-12, EYT-80, EYT-81, EYT-82, EYT-113, EYT-147, EYT-148 — deckungsgleich mit der Spec-Liste; Sprint-NAME nicht separat verifiziert | JQL `sprint = 579` |
| Confluence 8814623 / 8486960 | Abruf über Atlassian-MCP scheiterte zweimal mit `Anthropic Proxy: Invalid content from server` (Markdown-Format). Existenz von 8814623 durch Projektgedächtnis `basisdesign-v2-confluence` + Jira-/CLAUDE.md-Referenzen gestützt. **Kein Vertragsinhalt wird aus Confluence erfunden** — die Rule REFERENZIERT die Seiten nur; ihr Inhalt stammt verbatim aus der User-Spec + EYT-148. | MCP-Fehlermeldungen |
| gbrain | Pflicht-Query ausgeführt; **kein** EasyTree-/EYT-Kontext im Vault (nur Bazodiac-Ökosystem-Treffer) | `gbrain query` |
| Konkurrierende Rule | keine — `.claude/rules/` existiert nicht, `scripts/claude/schutz-anhaengeregel.sh` ist ein untracked PreToolUse-Hook für Migrationen/openapi, thematisch fremd | Inventar |

**Keine STOP-Bedingung ist zum Planungszeitpunkt erfüllt.** Executor prüft R1 erneut (Task 1).

### SOURCE_NEEDED-Protokoll für den Executor

Confluence 8814623/8486960 zu Beginn erneut abrufen (`getConfluencePage`, notfalls
`contentFormat: "adf"` oder Rovo-`fetch`). Gelingt es: als gelesen berichten.
Gelingt es nicht: im Abschlussbericht unter SOURCE READS als
`SOURCE_NEEDED: Confluence 8814623/8486960 nicht abrufbar (MCP-Proxy-Fehler)`
führen — **kein STOP**, weil die Rule keine Confluence-Inhalte restates, sondern
die Seiten als Design-Autorität benennt (Titel+ID aus Spec, gestützt durch
Projektgedächtnis). Niemals behaupten, die Seiten gelesen zu haben, wenn nicht.

---

## Entscheidungen (mit Begründung, für Review)

1. **Rule-Pfad `.claude/rules/sprint-7-ui-ux-acceptance.md`** exakt wie Spec — es
   gibt keine abweichende Repo-Konvention (`.claude/` ist bislang leer/untracked).
2. **Anker mit `@`-Import**: Claude Code lädt CLAUDE.md automatisch; ein
   `@.claude/rules/…`-Import lädt die Rule in JEDER frischen Session (Spec-Goal 1
   „automatisch verfügbar"). Der Klartext-Pfad steht zusätzlich in Prosa, damit
   der Guard nicht am Import-Zeichen hängt. Fallback bei Nichtgefallen: `@`-Zeile
   streichen — Guard bleibt grün, Pfadreferenz bleibt.
3. **Guard als NEUE Datei** `apps/api/test/sprint7-acceptance-rule-guardrails.test.ts`
   statt Erweiterung von `handoff-guardrails.test.ts`: der Handoff-Guard ist
   EYT-89-/Dokument-spezifisch; eine temporäre Sprint-Regel hineinzumischen würde
   die spätere kontrollierte Entfernung (Removal Condition) erschweren. Gleiche
   Konvention, eigene Datei, gemeinsamer Pflichtjob `unit-tests` — bewusst KEIN
   neuer Required Check (Ruleset bräuchte sonst Re-Apply; Muster EYT-46).
4. **Eine bewusste Mini-Scope-Ergänzung:** `.gitignore` bekommt die Zeile
   `/.claude/settings.local.json` (auf master fehlt sie). Grund: dieser PR macht
   `.claude/` erstmals teilweise getrackt in einem ÖFFENTLICHEN Repo; ohne den
   Eintrag veröffentlicht ein späteres `git add .claude` jeden dort abgelegten
   Token. Die Zeile existiert wortgleich bereits im lokalen Working Tree des
   eyt-126-Branches — kein Konfliktpotenzial. Wird im PR ausgewiesen.
5. **Test-first:** Guard vor Rule/Anker schreiben → echter Red-Lauf für JEDE
   Zusicherung (schließt die „Test nach Code hat keine Rot-Phase"-Lücke), danach
   zusätzlich die Spec-R6-Gegenmutationen NACH dem Commit (scoped `git diff` als
   Rücknahme-Beleg, Projektgedächtnis `revert-evidence-must-be-scoped`).
6. **Kein Turbo für Evidenzläufe:** Turbo-Cache greift über Worktrees
   (Projektgedächtnis). Einzelläufe direkt via `vitest run` mit abgelesener
   Dateizahl; Repo-Gates mit `--force` + `Cached: 0 cached`-Ablesung.
7. **Kein Jira-Kommentar, keine Transition, kein Merge, kein Deploy** — Spec.

---

## Gemeinsame Marker (exakte Strings — Rule und Guard MÜSSEN byteidentisch sein)

| Konstante | Exakter String |
| --- | --- |
| `RULE_PATH` | `.claude/rules/sprint-7-ui-ux-acceptance.md` |
| `MARKER_SPRINT` | `Sprint ID 579` |
| `MARKER_GATE_ISSUE` | `EYT-148` |
| `MARKER_FINAL_STATE` | `READY_FOR_PO_VISUAL_REVIEW` |
| `MARKER_HUMAN_GATE` | `Ein Coding Agent kann keine PO-/UI-/UX-Abnahme erzeugen; die visuelle und UX-seitige Sprintfreigabe ist Human-/PO-only.` |
| `MARKER_BASELINE_BAN` | `Eine neue oder geänderte Golden Baseline benötigt explizite menschliche PO-Freigabe; ein automatisches Baseline-Update (etwa via --update-snapshots) ist verboten.` |
| `MARKER_REAL_STACK` | `Browser → Next/Web → reale API → reale Authentifizierung → PostgreSQL/RLS` |
| `MARKER_REMOVAL` | `Diese Regel darf erst entfernt oder archiviert werden, nachdem Sprint 7 in Jira formal PO-abgenommen und geschlossen ist und alle wiederverwendbaren Anforderungen in dauerhafte Frontend-Qualitätsregeln überführt wurden.` |

Guard-relevante `## `-Überschriften der Rule (14, exakt):
`Status und Lebenszyklus`, `Quellen-Autorität (SSoT)`, `Product Truth`,
`Bestehende Testarchitektur`, `Test-per-Increment`, `Viewports`,
`Accessibility`, `Zustände (States)`, `Visual Regression`, `Browser Integrity`,
`Autorisierung`, `EYT-148 Final Journey Gate`, `PO Acceptance Evidence`,
`Human Gate`.

---

## Task 1: Preflight, Quellen, Worktree

**Files:** keine Änderungen.

**Step 1.1 — R1-Zustandsprüfung (im Haupt-Checkout):**

```bash
cd /Users/benjaminpoersch/EasyTree
git status --short
git branch --show-current
git fetch origin
git rev-parse origin/master
git log -1 --oneline origin/master
git ls-files .claude        # MUSS leer sein (sonst: konkurrierende Rule? -> STOP prüfen)
ls .claude/rules 2>/dev/null # MUSS "No such file" liefern
```

Erwartung: origin/master-SHA notieren (Planungsstand `38b3275…`; ein NEUERER SHA
ist OK — dann gilt der neue als Basis, aber `git show <sha>:CLAUDE.md` einmal
gegenlesen, ob die Anker-Einfügestelle `## Commands` noch existiert).
STOP `BLOCKED_KONKURRIERENDE_RULE`, falls `.claude/rules/` inzwischen existiert.

**Step 1.2 — Quellen frisch lesen (Atlassian-MCP, Rovo-Variante):**

- `getJiraIssue EYT-148` (markdown) — Inhalt muss weiterhin den Vertrag decken
  (reale Journeys, no-mocks, Basisdesign v2.0, Viewports, axe, 200 %, States).
  Widerspricht Jira der Rule inhaltlich → STOP `BLOCKED_JIRA_WIDERSPRUCH`.
- JQL `sprint = 579 ORDER BY key` (issues-Modus, NIE count) — Ticketmenge
  {EYT-12, 80, 81, 82, 113, 147, 148} bestätigen.
- Confluence 8814623 + 8486960 abrufen; bei erneutem Proxy-Fehler:
  SOURCE_NEEDED-Protokoll oben, kein STOP.

**Step 1.3 — Worktree von origin/master (Haupttree ist dirty mit eyt-126-Arbeit):**

```bash
git worktree add ../EasyTree-sprint7-rule -b chore/sprint7-ui-ux-acceptance-rule origin/master
cd ../EasyTree-sprint7-rule
git status --short          # MUSS leer sein
pnpm install --frozen-lockfile
```

Erwartung: Install exit 0. Branchname ist der Spec-Vorschlag; existiert er schon
(`git branch -a | grep sprint7-ui-ux`), STOP `BLOCKED_BRANCH_EXISTIERT` und fragen.
Alle folgenden Tasks laufen IM WORKTREE.

---

## Task 2: Guard-Test schreiben (vor der Rule) und rot sehen

**Files:**
- Create: `apps/api/test/sprint7-acceptance-rule-guardrails.test.ts`

**Step 2.1 — Testdatei anlegen (vollständiger Inhalt):**

```typescript
/**
 * Wächter für den Sprint-7-UI/UX-Abnahmevertrag (EYT-148, Sprint 579).
 *
 * Läuft im Pflichtjob `unit-tests` (`pnpm test` -> `turbo run test`) — bewusst
 * kein eigener CI-Job, damit das Ruleset nicht neu angewendet werden muss
 * (Muster EYT-46/EYT-89).
 *
 * Anlass: Der Sprint-7-Abnahmevertrag (reale Journeys statt Mocks, Human-only-
 * PO-Gate, Golden-Baseline-Schutz) lebte bisher nur in Chat-Kontext einzelner
 * Claude-Sessions. Diese Suite bindet ihn an das Repository: sie wird rot, wenn
 * die Rule-Datei fehlt, CLAUDE.md sie nicht mehr referenziert oder einer der
 * semantisch tragenden Marker entfernt wird.
 *
 * Geprüft werden Struktur und Marker, NICHT der Wortlaut ganzer Absätze:
 * redaktionelle Verbesserungen bleiben möglich, das Verschwinden einer
 * Schutzregel nicht. Wie in `handoff-guardrails.test.ts` steht vor den
 * Inhaltszusicherungen eine Nicht-Leerlauf-Zusicherung.
 *
 * Lebenszyklus: Diese Suite darf erst entfernt werden, wenn die Removal
 * Condition der Rule erfüllt ist (Sprint 7 formal PO-abgenommen und in Jira
 * geschlossen); siehe `.claude/rules/sprint-7-ui-ux-acceptance.md`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findRepoRoot } from "./architecture/scan";

const repoRoot = findRepoRoot(process.cwd());
const RULE_PATH = ".claude/rules/sprint-7-ui-ux-acceptance.md";
const ruleAbs = join(repoRoot, RULE_PATH);

/** Semantisch tragende Marker. Jeder steht für eine eigene Schutzregel. */
const MARKER_SPRINT = "Sprint ID 579";
const MARKER_GATE_ISSUE = "EYT-148";
const MARKER_FINAL_STATE = "READY_FOR_PO_VISUAL_REVIEW";
const MARKER_HUMAN_GATE =
  "Ein Coding Agent kann keine PO-/UI-/UX-Abnahme erzeugen; " +
  "die visuelle und UX-seitige Sprintfreigabe ist Human-/PO-only.";
const MARKER_BASELINE_BAN =
  "Eine neue oder geänderte Golden Baseline benötigt explizite menschliche " +
  "PO-Freigabe; ein automatisches Baseline-Update (etwa via --update-snapshots) " +
  "ist verboten.";
const MARKER_REAL_STACK =
  "Browser → Next/Web → reale API → reale Authentifizierung → PostgreSQL/RLS";
const MARKER_REMOVAL =
  "Diese Regel darf erst entfernt oder archiviert werden, nachdem Sprint 7 in " +
  "Jira formal PO-abgenommen und geschlossen ist und alle wiederverwendbaren " +
  "Anforderungen in dauerhafte Frontend-Qualitätsregeln überführt wurden.";

/** Pflichtabschnitte — das Fehlen eines Abschnitts hebt eine Zusicherung auf. */
const REQUIRED_SECTIONS = [
  "Status und Lebenszyklus",
  "Quellen-Autorität (SSoT)",
  "Product Truth",
  "Bestehende Testarchitektur",
  "Test-per-Increment",
  "Viewports",
  "Accessibility",
  "Zustände (States)",
  "Visual Regression",
  "Browser Integrity",
  "Autorisierung",
  "EYT-148 Final Journey Gate",
  "PO Acceptance Evidence",
  "Human Gate",
] as const;

function readRule(): string {
  if (!existsSync(ruleAbs)) {
    throw new Error(
      `${RULE_PATH} fehlt. Der Sprint-7-Abnahmevertrag (EYT-148) ist damit ` +
        "unverankert; CLAUDE.md verweist ins Leere. Datei wiederherstellen — " +
        "entfernen ist erst nach erfüllter Removal Condition zulässig.",
    );
  }
  return readFileSync(ruleAbs, "utf8");
}

function headings(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());
}

describe("Sprint-7-UI/UX-Abnahmevertrag (EYT-148)", () => {
  const rule = readRule();
  const found = headings(rule);

  it("hat ueberhaupt Struktur (Nicht-Leerlauf-Zusicherung)", () => {
    expect(rule.length).toBeGreaterThan(4000);
    expect(found.length).toBeGreaterThanOrEqual(REQUIRED_SECTIONS.length);
  });

  it.each(REQUIRED_SECTIONS)("enthaelt den Pflichtabschnitt '%s'", (section) => {
    expect(found).toContain(section);
  });

  it("bindet die Regel an Sprint 579 und EYT-148 als finales Abnahme-Gate", () => {
    expect(rule).toContain(MARKER_SPRINT);
    expect(rule).toContain(MARKER_GATE_ISSUE);
    expect(found).toContain("EYT-148 Final Journey Gate");
  });

  it("traegt die Removal Condition (kontrollierte, nicht stille Entfernung)", () => {
    expect(rule).toContain(MARKER_REMOVAL);
  });

  it("haelt den hoechsten Agenten-Endstatus vor menschlicher Abnahme fest", () => {
    expect(rule).toContain(MARKER_FINAL_STATE);
  });

  it("haelt das Human-/PO-only-Abnahme-Gate fest", () => {
    expect(rule).toContain(MARKER_HUMAN_GATE);
  });

  it("verbietet automatische Golden-Baseline-Aktualisierung", () => {
    expect(rule).toContain(MARKER_BASELINE_BAN);
  });

  it("verankert den realen Auth->API->PostgreSQL/RLS-Abnahmegrundsatz", () => {
    expect(rule).toContain(MARKER_REAL_STACK);
  });

  it("wird von CLAUDE.md als bindend referenziert", () => {
    const claudeMd = readFileSync(join(repoRoot, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain(RULE_PATH);
  });
});
```

**Step 2.2 — Red-Lauf (Rule existiert noch nicht):**

```bash
cd ../EasyTree-sprint7-rule
pnpm --filter @easytree/api exec vitest run test/sprint7-acceptance-rule-guardrails.test.ts
```

Erwartung: **FAIL** mit der Fehlermeldung aus `readRule()`
(„.claude/rules/sprint-7-ui-ux-acceptance.md fehlt…"), `Test Files 1 failed (1)`.
Dateizahl ablesen (vitest-Pfadfilter ist Substring — Zahl, nie Exit-Code;
Projektgedächtnis `vitest-silently-skips-missing-files`). Hinweis: die Suite hat
keine Workspace-Dep-Importe (nur node:fs/path, vitest, scan-Helfer) — kein
vorheriger Paketbau nötig; `test/setup.ts` setzt nur Env-Variablen.

Ausgabe (Kommando + Fail-Zeile) für den Evidence-Report festhalten.

---

## Task 3: Rule-Datei anlegen

**Files:**
- Create: `.claude/rules/sprint-7-ui-ux-acceptance.md`

**Step 3.1 — Datei mit exakt diesem Inhalt anlegen** (Marker byteidentisch zur
Tabelle oben; Inhalt = User-Spec R2/R3 + EYT-148, keine erfundenen Zusätze):

````markdown
# Sprint 7 UI/UX Acceptance Rule

## Status und Lebenszyklus

- Status: **ACTIVE_TEMPORARY**
- Applies to: EasyTree Jira Sprint 7, **Sprint ID 579**
- Primary acceptance issue: **EYT-148** („Sprint 7: Admin- und
  Mitarbeiter-User-Journeys vollständig mit Playwright und realer Persistenz
  abnehmen")
- Wächter: `apps/api/test/sprint7-acceptance-rule-guardrails.test.ts`
  (Pflichtjob `unit-tests`) — Entfernen, Umbenennen oder wesentliches
  Abschwächen dieser Datei macht CI rot.

**Removal Condition:** Diese Regel darf erst entfernt oder archiviert werden,
nachdem Sprint 7 in Jira formal PO-abgenommen und geschlossen ist und alle
wiederverwendbaren Anforderungen in dauerhafte Frontend-Qualitätsregeln
überführt wurden.

## Quellen-Autorität (SSoT)

Diese Regel ist eine **Ausführungsregel für Coding Agents** — sie ist KEINE
neue Produkt-SSoT und ersetzt weder Jira noch Confluence.

- **Jira** (Projekt `EYT`, Board 72) besitzt Sprint-, Scope- und
  Acceptance-Wahrheit.
- **Confluence** besitzt die Design-/Architektur-Baselines: Seite `8814623`
  („EasyTree – Basisdesign v2.0: Werkbank & Feld – ruhig verdichtet") und
  Seite `8486960` („EasyTree – Zwei-Client-Architektur und Admin-Kalender").
- **GitHub** (`DYAI2025/EasyTree`, `origin/master`) besitzt Code-, Branch- und
  CI-Wahrheit.
- **Runtime-Evidenz** besitzt Deployment- und Runtime-Wahrheit.
- **Coding-Agent-Ausgaben sind keine SSoT.**

Vor jeder Sprint-7-Arbeit den aktuellen Jira-/GitHub-/Confluence-Stand frisch
lesen; Auftragsprämissen veralten vor der Ausführung.

## Product Truth

Sprint 7 liefert finale produktive Oberflächen: Admin/Werkbank **Desktop-first**,
Mitarbeiter/Feld **Mobile-Web-first**.

Nicht zulässig als Produktabnahme: Clickdummies, Fake-Daten, Mockserver,
Netzwerk-Fixtures als Ersatz für reale Journeys, Placeholder-Screens,
synthetische Erfolgsmeldungen, LocalStorage-/Clientzustände als operative
Wahrheit. Nicht implementierte Backend-/Domainfähigkeiten dürfen nicht durch UI
vorgetäuscht werden.

## Bestehende Testarchitektur

Vor Änderungen mindestens inspizieren: `apps/web/e2e/`,
`apps/web/playwright.config.ts`, `apps/web/playwright.harness.config.ts`,
`apps/web/e2e/auth-journey/`.

Der einfache `web-smoke` ohne echte API/DB ist kein vollständiger
Sprint-7-Abnahmenachweis. Für Acceptance-Journeys ist die vorhandene
Real-Stack-Infrastruktur zu bevorzugen:

Browser → Next/Web → reale API → reale Authentifizierung → PostgreSQL/RLS

Keine zweite parallele E2E-Testarchitektur aufbauen, solange die vorhandene
erweiterbar ist.

## Test-per-Increment

Jede tatsächlich veränderte produktive Oberfläche muss, soweit für den Slice
relevant, beweisen: (1) reale Nutzerhandlung; (2) erwartetes sichtbares
Ergebnis; (3) echte autorisierte API-/Domain-Ausführung; (4) Reload bestätigt
Serverzustand; (5) bei relevanten gemeinsamen Zuständen zusätzlicher
Browserkontext; (6) Negativ-/Rechtereise; (7) finale Darstellung im
Basisdesign v2.0; (8) Responsive-Verhalten; (9) Accessibility;
(10) Screenshot aus der real ausgeführten Journey.

EYT-148 ist das finale aggregierte Gate, aber die Tests dürfen nicht bis zum
Sprintende aufgeschoben werden.

## Viewports

- Admin: Chromium `1440 × 900` und `1920 × 1080`.
- Mitarbeiter: Chromium Touch `320 × 800` und `375 × 812`.
- Sprint-Closeout zusätzlich gezielte WebKit-Smokes (Mitarbeiter `375 × 812`,
  Admin `1440 × 900`), soweit die vorhandene Infrastruktur das robust zulässt.
- Keine unnötige vollständige Browsermatrix bauen.
- Reproduzierbare Acceptance-Läufe: Locale `de-DE`, Timezone `Europe/Berlin`.

## Accessibility

Für tatsächlich verwendete produktive Flächen prüfen: axe A/AA;
Tastaturbedienbarkeit; sichtbarer Fokus; sinnvolle semantische Reihenfolge;
Status nie ausschließlich über Farbe; kein unkontrolliertes horizontales
Seitenscrolling; mobile Hauptaktionen mindestens 56 px; Desktop-Aktionen
mindestens 40 px; keine erforderliche Hover-only-Bedienung auf Mobile;
`prefers-reduced-motion`; Klick-/Tastaturalternative für Drag-and-Drop.

**200-%-Zoom:** Ein automatisierter Reflow-Test ist zulässig, darf aber NICHT
als identisch mit realem Browserzoom bezeichnet werden. Der finale
PO-Acceptance-Report muss einen echten menschlichen 200-%-Zoom-Check als
Reviewpunkt enthalten.

## Zustände (States)

Wo der reale Vertrag den Zustand erzeugen kann: Loading, Empty, Error,
Forbidden, Unauthenticated, Stale, Partial, Retry. `Offline-read-only` nur
dort, wo eine reale fachliche Offline-Lesefähigkeit existiert — keine
Offline-Funktion erfinden, nur damit ein UI-State gezeigt werden kann.

## Visual Regression

Screenshots müssen aus realen Produktjourneys stammen. Keine Figma-, Penpot-,
Storybook- oder Mockup-Screenshots als Ersatz für Produktabnahme.

Verbindlicher Ablauf:

candidate screenshot → READY_FOR_PO_VISUAL_REVIEW → explicit human PO
approval → accepted golden baseline

Eine neue oder geänderte Golden Baseline benötigt explizite menschliche
PO-Freigabe; ein automatisches Baseline-Update (etwa via --update-snapshots)
ist verboten. Coding Agents dürfen einen Visual-Test niemals durch ein
Baseline-Update „reparieren".

## Browser Integrity

In positiven Journeys relevante Fehler überwachen: `pageerror`, unerwartete
`console.error`, unerwartete HTTP 5xx, fehlgeschlagene kritische Ressourcen,
Hydrationfehler, unerwartete Weiterleitungen. Negative Journeys müssen
erwartete 401/403- bzw. Forbidden-Zustände explizit beweisen.

## Autorisierung

Eine sichtbare Navigation oder Route verleiht niemals Rechte. Insbesondere:
Mitarbeiter erhalten keine Admin-/Kosten-/fremden Organisationsdaten; ohne
`costs.read` keine Kostenbeträge oder Kostensätze; Kosten-Navigation und
Kosteninhalte gemäß EYT-113 nur nach verifiziertem Recht. Serverseitige
Autorisierung bleibt bindend.

## EYT-148 Final Journey Gate

Der finale Sprint-7-Kandidat muss mindestens beweisen —

**Admin:** reales Login → zulässige Admin-Shell → Woche/Planung → realen
Einsatz anlegen → bestätigten Serverzustand sehen → Reload →
Konflikt-/Fehlerfall → konfliktfreien Plan veröffentlichen → veröffentlichten
Stand lesen → mit `costs.read` Kosten/Snapshot lesen → ohne `costs.read` kein
erfolgreicher Kosten-Zugriff.

**Mitarbeiter:** reales Login → Feld-Shell → Heute → ausschließlich eigene
autorisierte reale Daten → Woche, soweit der reale Employee-Read-Pfad
implementiert ist → Reload → gleicher Serverzustand → kein
Admin-/Kosten-/Fremddatenzugriff.

Noch nicht implementierte Fachfunktionen dürfen nicht als Fake-Journey ergänzt
werden.

## PO Acceptance Evidence

Für den finalen Sprint-Kandidaten muss ein Evidence Package erzeugbar sein,
mindestens mit: `manifest.json`, `PO-ABNAHME.md`, Playwright-Ergebnis,
relevanten Server-/Plan-/Snapshot-IDs, Admin-Screenshots,
Mitarbeiter-Screenshots, State-Screenshots, Accessibility-Ergebnissen,
Visual-Diff-Ergebnissen, Traces bei Fehlern, Video der kanonischen
Admin-Journey, Video der kanonischen Mitarbeiter-Journey.

Das Manifest bindet mindestens: Git SHA, getestete Umgebung, Browser und
Version, Viewport, Rolle, Zeitpunkt, relevante Server-IDs,
Testdaten-/Seed-Bezug. Große Laufartefakte nicht ungeprüft dauerhaft ins
Repository committen; bevorzugt CI-Artefakte.

## Human Gate

Coding Agents dürfen technische Ergebnisse als PASS melden. Coding Agents
dürfen NICHT selbst setzen oder behaupten: „PO approved", „UX accepted",
„UI accepted", „design accepted", „Sprint 7 accepted".

Ein Coding Agent kann keine PO-/UI-/UX-Abnahme erzeugen; die visuelle und
UX-seitige Sprintfreigabe ist Human-/PO-only.

Der höchste Agenten-Endstatus vor menschlicher Designabnahme lautet:

READY_FOR_PO_VISUAL_REVIEW
````

**Step 3.2 — Zwischenlauf:**

```bash
pnpm --filter @easytree/api exec vitest run test/sprint7-acceptance-rule-guardrails.test.ts
```

Erwartung: genau **1 failed** übrig — „wird von CLAUDE.md als bindend
referenziert" (Anker fehlt noch). Damit ist bewiesen, dass auch die
CLAUDE.md-Zusicherung eine echte Rot-Phase hat.

---

## Task 4: CLAUDE.md-Anker (minimal) + .gitignore-Schutzzeile

**Files:**
- Modify: `CLAUDE.md` (Stand origin/master — NICHT die lokale eyt-126-Fassung;
  im Worktree liegt automatisch die master-Fassung)
- Modify: `.gitignore`

**Step 4.1 — Anker einfügen.** Einfügestelle: unmittelbar VOR der Zeile
`## Commands` (auf origin/master Zeile ~136; per Edit mit `old_string`
`## Commands` samt Folgezeile als Kontext, `replace_all: false`). Einzufügender
Block (danach folgt unverändert `## Commands`):

```markdown
## Sprint 7 — Binding UI/UX Acceptance Gate (temporary)

Until Jira Sprint 7 (Sprint ID 579) is formally PO-accepted and closed,
`.claude/rules/sprint-7-ui-ux-acceptance.md` is binding for all Sprint-7
frontend/UI/UX/browser/accessibility/Playwright/visual-regression work. The
rule file contains the full executable contract; it is loaded into every
session via the import below.

@.claude/rules/sprint-7-ui-ux-acceptance.md

Key governance: acceptance journeys run the real Auth → API → PostgreSQL/RLS
path — no mocks, clickdummies or placeholders as product acceptance; EYT-148
is the final integrated UI/journey gate; Claude may report technical PASS but
can never create human PO acceptance — the highest agent state is
`READY_FOR_PO_VISUAL_REVIEW`; golden visual baselines require explicit PO
approval (never an automatic `--update-snapshots`); re-read the current
Jira/GitHub/Confluence state before acting. Guarded by
`apps/api/test/sprint7-acceptance-rule-guardrails.test.ts`.
```

KEINE vollständige Kopie der Rule. Keine weiteren CLAUDE.md-Umbauten, keine
Bereinigung historischer Abschnitte.

**Step 4.2 — Ergebnis greppen (nie Exit-Code):**

```bash
grep -c "sprint-7-ui-ux-acceptance.md" CLAUDE.md   # Erwartung: 2 (Prosa + @-Import)
grep -n "## Sprint 7 — Binding" CLAUDE.md          # Erwartung: genau 1 Treffer
```

**Step 4.3 — `.gitignore`-Schutzzeile** (Entscheidung 4; ans Ende des
bestehenden Blocks, mit Begründungskommentar im Stil der Datei):

```gitignore
# Claude-Code-Sitzungskonfiguration. Das Repo ist oeffentlich, und mit
# .claude/rules/ ist .claude/ erstmals teilweise getrackt: ohne diesen Eintrag
# veroeffentlicht ein `git add .claude` jeden spaeter in settings.local.json
# abgelegten Token. Dieselbe Falle wie penpot/ weiter oben.
/.claude/settings.local.json
```

**Step 4.4 — Green-Lauf des Guards:**

```bash
pnpm --filter @easytree/api exec vitest run test/sprint7-acceptance-rule-guardrails.test.ts
```

Erwartung: `Test Files 1 passed (1)`, `Tests 22 passed` (1 Nicht-Leerlauf +
14 Abschnitte + 7 Marker-/Referenz-Tests). Zahl ablesen und notieren.

---

## Task 5: Format, Lint, Typecheck, Handoff-Regression

**Step 5.1 — Prettier auf die neuen/geänderten Dateien, dann Tracked-Set-Check:**

```bash
pnpm exec prettier --write .claude/rules/sprint-7-ui-ux-acceptance.md CLAUDE.md apps/api/test/sprint7-acceptance-rule-guardrails.test.ts
git ls-files -z | xargs -0 pnpm exec prettier --ignore-unknown --check
```

Erwartung: zweiter Befehl exit 0. ACHTUNG: `.claude/rules/…` ist noch untracked
und damit im zweiten Befehl unsichtbar — deshalb der explizite `--write` davor.
Falls Prettier die Rule umformatiert hat: Guard erneut laufen lassen (Marker
sind einzeilig-robust gewählt, aber messen, nicht glauben).

**Step 5.2 — Lint + Typecheck (Repo-Gates, --force wegen Worktree-Cache):**

```bash
pnpm exec turbo run lint --force
pnpm exec turbo run typecheck --force
```

Erwartung je Lauf: `Cached: 0 cached` UND `Tasks: N successful` — beide Zeilen
zitieren. (typecheck baut Abhängigkeiten über `^build` selbst.)

**Step 5.3 — Handoff-Guard-Regression (liest CLAUDE.md ebenfalls):**

```bash
pnpm --filter @easytree/api exec vitest run test/handoff-guardrails.test.ts
```

Erwartung: `1 passed`, Dateizahl 1 ablesen.

---

## Task 6: Commit (nur benannte Pfade)

**Step 6.1:**

```bash
git add .claude/rules/sprint-7-ui-ux-acceptance.md CLAUDE.md .gitignore apps/api/test/sprint7-acceptance-rule-guardrails.test.ts
git diff --cached --name-only
```

Erwartung: EXAKT diese vier Pfade, nichts weiter. (Diese Plandatei liegt im
Haupt-Checkout, nicht im Worktree — sie darf ohnehin nicht committet werden.)

**Step 6.2:**

```bash
git diff --check
git commit -m "chore(repo): EYT-148 Sprint-7-UI/UX-Abnahmevertrag als Repo-Regel mit CI-Waechter verankern"
git rev-parse HEAD
```

Commit-SHA notieren.

---

## Task 7: Gegenmutationen (R6) — nach Commit, vor Push

Reihenfolge bewusst NACH dem Commit: so ist `git checkout -- <datei>` eine
sichere Rücknahme und der scoped `git diff` ein echter Rücknahme-Beleg
(Projektgedächtnis: `git-checkout-reverts-to-commit-not-worktree`,
`revert-evidence-must-be-scoped`). Mutationen werden NICHT committet.

**Mutation A — tragender Marker entfernt:**

```bash
perl -pi -e 's/READY_FOR_PO_VISUAL_REVIEW/ENTKERNTER_MARKER/g' .claude/rules/sprint-7-ui-ux-acceptance.md
pnpm --filter @easytree/api exec vitest run test/sprint7-acceptance-rule-guardrails.test.ts
```

Erwartung: **FAIL**, und zwar (mindestens) der Test
„haelt den hoechsten Agenten-Endstatus vor menschlicher Abnahme fest" —
Testtitel benennt den fehlenden Guard. Fail-Zeile zitieren.
STOP `BLOCKED_GEGENMUTATION_NICHT_ERKANNT`, falls grün.

Rücknahme + Beleg + Re-Green:

```bash
git checkout -- .claude/rules/sprint-7-ui-ux-acceptance.md
git diff -- .claude/rules/sprint-7-ui-ux-acceptance.md   # Erwartung: LEER
pnpm --filter @easytree/api exec vitest run test/sprint7-acceptance-rule-guardrails.test.ts   # Erwartung: 1 passed
```

**Mutation B — Rule-Datei fehlt (Pfad-/Existenz-Guard):**

```bash
mv .claude/rules/sprint-7-ui-ux-acceptance.md /tmp/eyt148-rule-mutation-b.md
pnpm --filter @easytree/api exec vitest run test/sprint7-acceptance-rule-guardrails.test.ts
```

Erwartung: **FAIL** mit der `readRule()`-Meldung („…fehlt. Der
Sprint-7-Abnahmevertrag (EYT-148) ist damit unverankert…"). Zitieren.

Rücknahme + Beleg + Re-Green:

```bash
mv /tmp/eyt148-rule-mutation-b.md .claude/rules/sprint-7-ui-ux-acceptance.md
git status --short -- .claude/ && git diff -- .claude/rules/sprint-7-ui-ux-acceptance.md   # Erwartung: kein M-Eintrag, Diff LEER
pnpm --filter @easytree/api exec vitest run test/sprint7-acceptance-rule-guardrails.test.ts   # Erwartung: 1 passed
```

---

## Task 8: Regression — betroffene Gesamt-Suite

Der neue Guard liegt in der apps/api-Vitest-Suite → diese Suite komplett fahren.
Vorbedingung: lokaler Supabase-Stack GESTOPPT (`docker ps | grep supabase` leer;
sonst falsche Rottöne, Projektgedächtnis `turbo-test-with-live-local-stack-false-reds`;
Tenant-Suiten skippen im local-Modus mit Warnung — das ist hier korrekt).

```bash
pnpm --filter @easytree/api... build     # Workspace-Deps (config/contracts/domain) fuer die uebrigen Suiten
pnpm --filter @easytree/api test
```

Erwartung: exit 0; Dateizahl + passed/skipped-Zeilen zitieren (direkter
vitest-Lauf, kein Turbo-Replay möglich). Danach das volle Unit-Gate uncached:

```bash
pnpm exec turbo run test --force
```

Erwartung: `Cached: 0 cached, N total` UND alle Tasks successful — beide Zeilen
zitieren. Schlägt ein Paket aus nachweislich vorbestehendem, von diesem Patch
unabhängigem Grund fehl: nicht verschweigen, nicht umgehen — auf origin/master
(unverändertem Stand) reproduzieren (`git stash` entfällt: im Worktree
`git checkout origin/master -- <paket>` NICHT verwenden; stattdessen den Lauf im
Haupt-Checkout gegenprüfen), Scope sauber trennen und im Report ausweisen.
Keine Gates schwächen.

---

## Task 9: Push + PR

**Step 9.1:**

```bash
git push -u origin chore/sprint7-ui-ux-acceptance-rule
```

**Step 9.2 — PR öffnen (Body erst komponieren, dann gegenlesen, dann senden;
Projektgedächtnis: compose → re-read → send):**

```bash
gh pr create --base master --title "chore: persist Sprint-7 UI/UX acceptance contract" --body "$(cat <<'EOF'
## Why

Sprint-7-UI/UX-Acceptance darf nicht von einer einzelnen Claude-Session oder
Chat-History abhängen. Dieser Patch verankert den Abnahmevertrag versioniert,
reviewbar und CI-bewacht im Repository.

## What

- Persistente Agent-Regel `.claude/rules/sprint-7-ui-ux-acceptance.md`
  (ACTIVE_TEMPORARY, Sprint ID 579, EYT-148, Removal Condition).
- Kurzer CLAUDE.md-Anker mit @-Import — keine Volltextkopie.
- Deterministischer Guard `apps/api/test/sprint7-acceptance-rule-guardrails.test.ts`
  (Pflichtjob unit-tests; prüft Existenz, CLAUDE.md-Referenz und die semantisch
  tragenden Marker, keinen Byte-Snapshot).
- `.gitignore`: `/.claude/settings.local.json` — .claude/ wird hiermit erstmals
  teilweise getrackt in einem öffentlichen Repo; die Zeile verhindert, dass ein
  späteres `git add .claude` Session-Secrets veröffentlicht.
- Countermutation-Nachweis: Marker-Entfernung und Datei-Entfernung wurden je
  einmal eingespielt (Guard rot, benennt den fehlenden Schutz), zurückgenommen
  (scoped git diff leer) und erneut grün gemessen. Details im Sessionprotokoll.

## Source Authority

- Jira EYT-148 / Sprint 579 = Acceptance-/Sprint-Wahrheit.
- Confluence Basisdesign v2.0 (8814623) + Zwei-Client-Architektur (8486960) =
  Design-/Architekturwahrheit.
- Die Rule ist ein Agent-Ausführungsvertrag, keine konkurrierende Produkt-SSoT.

## Human Gate

Claude cannot create PO/UI/UX acceptance.
Final agent state before human review:
READY_FOR_PO_VISUAL_REVIEW

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Vor dem Absenden: Heredoc-Inhalt einmal vollständig gegenlesen (keine
Draft-Fragmente). Danach `gh pr view --json number,url,headRefOid` — Nummer,
URL, Head-SHA notieren. **NICHT mergen. Kein weiteres Sprint-7-Feature beginnen.**

Optional CI beobachten (kein Gate dieses Plans):
`~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree <head-sha> 1800` — Exit 0 direkt
über `gh run view` gegenprüfen (Projektgedächtnis: Exit 0 kann Timeout heißen,
Exit 1 kann cancelled heißen).

---

## Task 10: Evidence-Report + Endstatus

Abschlussbericht EXAKT in der Struktur der Spec (Abschnitte 1–8: START STATE,
SOURCE READS, FILES CHANGED, PERSISTENCE DESIGN, MUTATION PROOF,
VALIDATION-Tabelle, GIT, RESIDUAL RISKS). Pflichtinhalte:

- SOURCE READS: Jira EYT-148 + JQL sprint=579 gelesen (Rovo MCP); gbrain-Query
  ohne EYT-Treffer; Confluence-Status ehrlich (gelesen ODER
  `SOURCE_NEEDED: MCP-Proxy-Fehler`) — nie „gelesen" behaupten, wenn nicht.
- PERSISTENCE DESIGN: CLAUDE.md-Anker (@-Import) → Rule-Datei → CI-Guard im
  Pflichtjob unit-tests → wirkt in zukünftigen frischen Sessions per
  Claude-Code-Ladekonvention. NICHT behaupten, eine zukünftige Session sei real
  ausgeführt worden.
- VALIDATION-Tabelle mit echten Kommandos, abgelesenen Zahlen und
  Cache-Status — keine „alles grün"-Aussagen.
- RESIDUAL RISKS mindestens: Repository-Persistenz bewiesen (lokal); CI-Schutz
  erst mit grünem CI-Lauf auf dem PR-Head bewiesen (Run-ID nennen, sonst „noch
  ausstehend"); Session-Ladung per Konvention konfiguriert, nicht reproduziert;
  Human-PO-Abnahme NICHT erfolgt; EYT-148 NICHT abgeschlossen; Sprint-NAME zu
  ID 579 nicht separat verifiziert (nur Ticketmenge deckungsgleich).

Endstatus-Zeile, wörtlich und nichts Stärkeres:

```text
READY_FOR_PO_REVIEW
```

Verboten: `DONE`, `PO_APPROVED`, `SPRINT_7_ACCEPTED`. Nach dem PR stoppen.

---

## STOP-Bedingungen (aus der Spec, für jeden Task bindend)

`BLOCKED_<GRUND>` melden und anhalten, wenn: eine `.claude`-Konvention dem
Mechanismus widerspricht; der Vertrag aktuellem Jira/Confluence widerspricht;
eine konkurrierende neuere Rule existiert; ein Guard nur durch Abschwächen
bestehender Tests grün würde; der Working Tree (des WORKTREES) fremde
Änderungen enthält; Persistenz eine destruktive/produktive Aktion erfordern
würde; der Guard eine Gegenmutation nicht rot erkennt. Nicht improvisieren.

## Out of Scope (unverändert aus der Spec)

Keine Sprint-7-Produktfeatures, keine neue Admin-/Mitarbeiter-UI, kein
EYT-113/147/81-Fortschritt, keine EYT-148-Journey-Implementierung, keine
Playwright-Umbauten, keine Migrationen, kein Deployment, kein Jira-Statuswechsel,
kein Sprint-Close, keine CLAUDE.md-Historienbereinigung, kein Merge.
