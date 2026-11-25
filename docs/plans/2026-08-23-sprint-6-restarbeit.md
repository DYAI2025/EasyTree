# Sprint 6 — Restarbeit bis zur bedienbaren Kernreise (Implementation Plan)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Die Sprint-6-Kernreise (Anmelden → Woche planen → veröffentlichen → realen Kostenstand
bewerten) läuft real bedienbar auf einem isolierten VPS/Coolify-Staging, und die vier offenen
Tickets EYT-141, EYT-142, EYT-126 und EYT-149 sind gegen ihre eigenen Akzeptanzkriterien belegt.

**Architecture:** Der fachliche Durchstich existiert bereits auf `origin/master` und ist in CI
gegen einen echten Supabase-Stack bewiesen. Was fehlt, ist **Bereitstellung**, nicht Fachbreite.
Der Plan trennt deshalb drei Stränge, die unterschiedlich blockiert sind: reine Codearbeit an
EYT-141 (unblockiert), die Herstellung eines _ziehbaren_ Deployartefakts (unblockiert), und den
realen Deploy (blockiert durch eine Entscheidung, die nur der Product Owner treffen kann).
Die blockierte Arbeit steht hinten; sie blockiert nichts davor.

**Tech Stack:** pnpm 10.28.0 / Turborepo, Node 22, Next.js 16 (standalone), NestJS, Supabase
(Auth + PostgreSQL + RLS), Docker/OCI, Coolify 4.3.10 auf dem eigenen VPS, GitHub Actions,
Playwright, Vitest.

---

## 0. Ausgangsstand — gemessen am 23.08.2026

Jeder Satz hier hat einen Befehl hinter sich. Was nicht gemessen wurde, steht als **ungemessen**
da und wird nicht behauptet.

### 0.1 Ticketlage (Quelle: Jira JQL `project = EYT AND sprint in openSprints()`, 23.08.2026)

| Ticket      | Typ      | Status       | Rolle im Sprint                                        |
| ----------- | -------- | ------------ | ------------------------------------------------------ |
| **EYT-137** | Story    | In Arbeit    | Outcome-Anker; schließt, wenn 141 + 142 schließen      |
| **EYT-140** | Sub-Task | **Fertig**   | Planungswerkbank + Wochennavigation — keine Restarbeit |
| **EYT-141** | Sub-Task | In Arbeit    | Basisdesign v2 auf `/planung` + `/kosten`              |
| **EYT-142** | Sub-Task | In Arbeit    | VPS/Coolify-Staging + E2E-Abnahme                      |
| **EYT-126** | Task     | In Arbeit    | Containerpfad (Code auf `master`, Abnahme offen)       |
| **EYT-149** | Task     | Zu erledigen | Cloudflare-Pfade entfernen — **nach** EYT-142          |

Nicht im offenen Sprint und hier **nicht** eingeplant: EYT-72 (breiter Planungsclient mit
Inspector), EYT-80 (volle Designsystem-Baseline), EYT-53 (lokale Betriebsumgebung). Sie sind als
`sprint-6-enabler-source` markiert, aber nicht `sprint-6-commit` — ihr Scope ist ausdrücklich
größer als die Kernreise. Wer sie hier hineinzieht, verfehlt das Sprintziel breiter statt früher.

### 0.2 Codestand

- `origin/master` = `3ce222a` (Merge von PR #89, EYT-126). Lokaler Branch
  `feat/eyt-126-container-staging` = `3b4bbdb` und **darin enthalten** — die Branchearbeit ist
  gemerged.
- Fachlicher Durchstich vorhanden: `apps/web/components/planungs-werkbank.tsx`,
  `planning-window-view.tsx`, `planning-publish-action.tsx`, `kosten-ansicht.tsx`,
  `wochen-navigation.tsx`; Zustände Loading/Empty/Error/Forbidden/Stale existieren als
  `@easytree/ui`-Primitives und werden benutzt.
- Basisdesign-v2-Tokens liegen in `apps/web/app/globals.css:11-62` (`--eyt-*`, hell und dunkel),
  8-pt-Raster und `font-variant-numeric: tabular-nums` (`globals.css:549`).
- `apps/web/e2e/auth-journey/journey.pwtest.ts` (3216 Zeilen) fährt die Reise heute schon mit
  echter GoTrue-Session über `/anmelden`, `/planung`, `/kosten`, zweitem Browserkontext und einer
  Negativreise ohne Mitgliedschaft — inklusive axe bei **1440 px, 1920 px und 200-%-Zoom**
  (`journey.pwtest.ts:68-70,199-229`).
- Containerpfad vollständig: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `docker-compose.yml`,
  `scripts/smoke-container.sh` (698 Zeilen, 10 geprüfte Eigenschaften), Gate-Zeile
  `[container-smoke] mode=required … skipped=0` am Ende von `db-gates`.

### 0.3 Die zwei realen Hindernisse

**H-1 — `BLOCKER_ENVIRONMENT_SEPARATION`, heute nachgemessen.**
`list_projects` liefert weiterhin nur `ykoijifgweoapitabgxx` („Bazodiac", `INACTIVE`).
`list_branches` auf `inypnrvpawvhgiyagxbd` liefert genau eine Branch `main` mit
`project_ref == parent_project_ref == inypnrvpawvhgiyagxbd`. **Es gibt keine EasyTree-Datengrenze
getrennt von der Produktion.** Der kostenlose Weg dorthin ist versperrt: die Supabase-Free-Quota
zählt **pro Nutzer**, `DYAI2025` hat sie mit zwei aktiven Free-Projekten ausgeschöpft, und
pausierte Projekte zählen nicht mit — „Bazodiac" zu löschen hilft also nachweislich nicht
(`docs/plans/2026-08-20-sprint-6-staging-blocker.md`, Nachtrag 2).

**H-2 — Der VPS baut vermutlich nicht, was er ausführen soll.** Gemessen per SSH am 23.08.2026 auf
`srv1308064.hstgr.cloud`: Coolify `4.3.10` läuft (Container `coolify`, `coolify-db`,
`coolify-realtime`, `coolify-redis`, `coolify-sentinel`), daneben sechs fremde Workloads.
Frei: **22 GB von 96 GB Platte**, **2,6 GB von 7,8 GB RAM verfügbar** (3,1 GB davon Cache).
Coolify baut per Vorgabe _auf dem Server_ aus dem Git-Stand. Ein Next-16-Standalone-Build plus ein
NestJS-Build in dieser Hülle ist ein ernsthaftes OOM-Risiko — **ungemessen, ob er fällt**; gemessen
ist nur der enge Rahmen. Der Plan umgeht die Frage, statt sie zu riskieren (Phase 2).

### 0.4 Was heute noch Cloudflare ist

`build-web` ist ein **Pflichtcheck** und führt in `.github/workflows/ci.yml:66-110`
`opennextjs-cloudflare build` plus `wrangler deploy --dry-run` aus, inklusive einer harten
Größenprüfung gegen das Cloudflare-Free-Limit. Tracked liegen außerdem
`apps/web/open-next.config.ts`, `apps/web/wrangler.jsonc`, `apps/api/wrangler.jsonc`,
`apps/api/cloudflare/entry.mjs`, `apps/api/cloudflare/nest-optional-stub.mjs` und die
Abhängigkeiten `@opennextjs/cloudflare`, `wrangler`. Das ist EYT-149 — und es ist **kein** Blocker
für die Kernreise, solange es grün bleibt.

---

## 0.5 Ausgeführter Stand — gemessen am 23.08.2026, abends

Phase 1 und Phase 2 sind **umgesetzt**, in zwei getrennten Worktrees, beide von `origin/master`
(`3ce222a`) aus. Nichts ist gepusht, es existiert kein PR. Evidenzstufe durchgehend
**lokaler Lauf** — kein CI-Lauf deckt diese Commits ab.

### Branch `feat/eyt-141-kosten-hierarchie` — Phase 1, Task 1.1

| Commit    | Inhalt                                                                                   |
| --------- | ---------------------------------------------------------------------------------------- |
| `eb85a67` | Herkunftsblock hinter Summe/Tage/Positionen, `<h3>`, zwei CSS-Regeln, neuer Test         |
| `c7aab3b` | Nacharbeit aus dem Review: `kosten-tage` mitmessen, Zäsur auf die Überschrift, Kommentar |

Dokumentreihenfolge gemessen: `kosten-gesamtsumme` 483 → `kosten-tage` 489 → `kosten-positionen`
514 → `kosten-herkunft` 552. Die sechs von `journey.pwtest.ts` benutzten `data-testid` sind ein
reiner Verschiebe-Diff (je einmal `-`, einmal `+`, wortgleich); neu ist ausschließlich
`kosten-herkunft`.

**Gegenmutationen, beide ausgeführt und zurückgenommen:**

1. Den `<dl>`-Block zurück vor die Gesamtsumme → genau 1 Fall rot.
2. **Nur** die Tagestabelle hinter den Herkunftsblock, Summe und Positionen bleiben vorn →
   `AssertionError: Tagessummen stehen nach der Herkunft`. Das ist der Nachweis, dass die dritte
   Zusicherung trägt: die ersten beiden wären hier grün geblieben.

Rücknahme jeweils über Sicherungskopie mit `shasum -a 256` + `cmp` — **nicht** `git checkout --`.

### Branch `feat/eyt-126-ghcr-images` — Phase 2, Tasks 2.1–2.3

| Commit    | Inhalt                                                       |
| --------- | ------------------------------------------------------------ |
| `4a8f704` | `.github/workflows/release-images.yml` (GHCR-Push, Task 2.1) |
| `c501dc3` | `docker-compose.staging.yml` (zieht statt baut, Task 2.2)    |
| `1d4240c` | Scope-Manifest Revision 7 (siehe unten)                      |
| `2bdacc8` | Staging-Topologie unter den Autoritätswächter (Task 2.3)     |

`ci.yml` und `docker-compose.yml` sind nachweislich unangetastet (beide Diffs leer). Der
Branch-Protection-Wächter meldet unverändert `=== Ergebnis: 0 offen, 1 uebersprungen ===`.

**Gegenmutationen, beide ausgeführt und zurückgenommen:**

1. `${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}` in die neue Workflow-Datei → `secret-surface.test.ts`
   rot und **nennt die Datei**: `.github/workflows/release-images.yml:92`. Beleg, dass der Wächter
   `.github/` rekursiv scannt und die neue Fläche wirklich betritt.
2. `command: pnpm exec supabase db push` in den `api`-Dienst der Staging-Topologie →
   `deploy-authority.test.ts` rot mit Datei, Werkzeug und Zeile:
   `{ datei: …/docker-compose.staging.yml, feld: "Zeile 22", werkzeug: "supabase db push" }`.
   Wichtig für Wiederholungen: die Regel **überspringt Kommentarzeilen** — eine Mutation im
   Kopfkommentar wäre grün geblieben und hätte den falschen Schluss erlaubt.

### Vollgate, beide Worktrees

```
Worktree A:  Tasks: 22 successful, 22 total   Cached: 0 cached, 22 total
Worktree B:  Tasks: 16 successful (lint+typecheck) + 10 successful (test), Cached: 0 cached
Testdateien: 130 (api 76, web 28, domain 11, contracts 9, config 4, ui 2)
Format:      All matched files use Prettier code style!
Scope-Guard: exit=0, "PRIL scope check passed" in BEIDEN Worktrees
```

`Cached: 0 cached` in jeder Zeile — kein Turbo-Replay.

### Zwei Korrekturen an diesem Plan, die aus der Umsetzung stammen

- **GHCR verlangt kleingeschriebene Pfade.** `github.repository_owner` ist `DYAI2025` mit
  Großbuchstaben (`gh repo view --json owner`). Direkt als Tag benutzt ergäbe das
  `invalid reference format` — und zwar erst **nach** dem vollständigen Bau beider Images. Der
  Workflow trägt deshalb einen expliziten Lowercase-Schritt (Task 2.1).
- **Task 2.3 existierte im ersten Entwurf nicht.** Die Wächterlücke fiel erst bei der Umsetzung
  auf; sie ist oben als eigener Task nachgetragen.

### Scope-Manifest: Revision 7, und warum sie nicht 8 heißt

Der PRIL-Scope-Guard wies `docker-compose.staging.yml` ab (`PRIL_POLICY_VIOLATION`, `exit_code=3`).
Der PO entschied am 23.08.2026, den Pfad aufzunehmen — als Revision 8 auf dem committeten Stand
(Revision 6), mit der lokal uncommitteten Revision 7 unangetastet.

**Der erste Teil war technisch nicht umsetzbar.** Der Guard erzwingt lückenlose Nummern:
`provenance revision must be contiguous; expected 7` (`exit_code=4`). Der Eintrag trägt deshalb
die **7**.

**Folge, die offen bleibt:** es existieren vorübergehend **zwei Revisionen 7** — diese hier
(committet, `docker-compose.staging.yml`) und eine gleichnamige im Haupt-Worktree (`.gitignore`,
`.claude/settings.json`, aus dem `/health`-Konfigurationsaudit). Wer die andere committet,
nummeriert sie auf **8** um und hängt sie dahinter; ihr Inhalt bleibt unverändert. Die Begründung
im Manifest sagt das wörtlich.

Zwei Messfallen, die dabei zugeschlagen haben und für jede Wiederholung gelten:

- **`bash guard.sh | tail` meldet den Status von `tail`.** Der Guard sagte `exit_code=3`, die Shell
  meldete `exit=0`. In eine Datei umleiten und `$?` direkt lesen.
- **Der `scope_digest` ist reproduzierbar, aber nicht zu raten:** `sha256:` + SHA-256 über
  `jq -cS '.scope'` **ohne** Zeilenumbruch. Aus fünf Kandidaten hergeleitet und **gegen Revision 6
  verifiziert, bevor** er auf den neuen Eintrag angewandt wurde. Der `digest` in
  `.plumbline/scope-authority/` ist etwas anderes: SHA-256 der **ganzen Manifestdatei**, und er
  wird **nach** dem Formatieren gesetzt. `.plumbline/` ist per `.gitignore:35` maschinenlokal und
  reist nicht mit.

### Was aus Phase 1 und 2 noch offen ist

- **Task 1.2** (axe im Browser über `/planung` und `/kosten`) — nicht begonnen.
- **Task 1.3** (Akzeptanz abhaken) — offen, hängt an 1.2.
- **Task 2.4** (Generalprobe) — nicht begonnen; sie setzt ein gebautes GHCR-Image voraus, das erst
  nach einem Push auf `master` existiert.
- **Korrektur B aus dem Review ist von keinem Test gedeckt.** Die Haarlinie sitzt jetzt auf der
  Überschrift statt auf der Liste; CSS wirkt in jsdom nicht, die Wirkung ist aus dem Markup
  abgeleitet und **nicht im Browser gesehen**. Task 3.6 (Screenshots) ist die erste Stelle, an der
  das belegbar wird.
- **Der Workflow `release-images.yml` ist ungetestet.** Er feuert nur auf `push: master` bzw.
  `workflow_dispatch`. Ungeprüft: ob `steps.push.outputs.digest` gefüllt ist, ob GHCR den
  `GITHUB_TOKEN` akzeptiert, ob der Bau in CI durchläuft.

---

## 1. Reihenfolge — und warum sie so ist

```
Phase 0  Entscheidungstor Datengrenze        (kein Code; nur PO)  ─┐
Phase 1  EYT-141 abschließen                 (unblockiert)         ├─ parallel
Phase 2  Ziehbares Deployartefakt            (unblockiert)        ─┘
                                                     │
Phase 3  EYT-142 — realer Deploy + Abnahme   ◄───────┘ braucht Phase 0 UND 2
Phase 4  EYT-126 formal schließen            (Nacharbeit aus Phase 3)
Phase 5  EYT-149 — Cloudflare entfernen      (erst nach grünem 142)
```

Die einzige echte Serialisierung ist Phase 3. Alles davor läuft, ohne dass jemand auf die
Supabase-Entscheidung wartet.

---

# PHASE 0 — Entscheidungstor Datengrenze

**Wer:** Product Owner. **Code:** keiner. **Blockiert:** Phase 3.

Diese Phase ist kein Implementierungsschritt, sondern eine Entscheidung mit Kostenfolge. Sie steht
zuerst, weil ihre Durchlaufzeit (Supabase-Projekt anlegen, Migrationen einspielen) nicht von der
Codearbeit abhängt — je früher sie fällt, desto eher steht Phase 3 bereit.

### Task 0.1: Den zweiten belegten Free-Slot sichtbar machen

**Warum kein Skript:** Die Management-API dieses Zugangs ist nachweislich unvollständig —
`list_projects` liefert `inypnrvpawvhgiyagxbd` **nicht**, obwohl `get_project` darauf antwortet;
`list_organizations` liefert „EASTree" nicht, obwohl `get_organization` darauf antwortet. Jede aus
der Aufzählung abgeleitete Projektzählung wäre falsch.

**Schritt 1:** Im Supabase-Dashboard als `DYAI2025` anmelden, alle Organisationen durchgehen und
notieren, welche **zwei** Projekte den Status `ACTIVE_HEALTHY` tragen.

**Schritt 2:** Ergebnis in `docs/plans/2026-08-20-sprint-6-staging-blocker.md` als datierten
Nachtrag festhalten — mit Projekt-Ref, Org und Datum, ohne Secrets.

### Task 0.2: Eine der vier Optionen wählen

| Option                                                             | Kosten                       | Voraussetzung             | Risiko                                                          |
| ------------------------------------------------------------------ | ---------------------------- | ------------------------- | --------------------------------------------------------------- |
| **A** — entbehrliches zweites Projekt **pausieren**                | 0 €                          | Es ist entbehrlich        | Pausiertes Projekt braucht ~1 min Restore, falls doch gebraucht |
| **B** — Free-Plan-Org, in der `DYAI2025` **nicht** Owner/Admin ist | 0 €                          | Zweiter Account als Owner | Verwaltungsaufwand, zweiter Login im Betriebspfad               |
| **C** — **Pro** für EASTree, danach zweites Projekt                | ≈ 25 $/Monat Basis           | PO-Freigabe               | Laufende Kosten für ein Non-Prod-Ziel                           |
| **D** — **Preview-Branch** auf Pro                                 | ≈ 0,01344 $/h ≈ 9,81 $/Monat | Pro-Org                   | Branch ist an Git gekoppelt, kürzere Lebensdauer                |

**Empfehlung: A prüfen, sonst D.** A ist kostenlos und reversibel. D ist die billigste bezahlte
Variante und liefert eine echte, vom Produktivprojekt getrennte `project_ref`. C nur, wenn A und B
ausscheiden und der Branch-Lebenszyklus stört.

**Schritt 1:** Entscheidung treffen und als **D-A** mit Datum im Blockerdokument protokollieren.

### Task 0.3: Die isolierte Datengrenze herstellen

**Erst ausführen, wenn 0.2 entschieden ist.**

**Schritt 1:** Projekt `easytree-staging` anlegen (Region `eu-west-2` oder `eu-central-1`).

**Schritt 2:** `project_ref` notieren und gegen die Produktion prüfen:

```bash
# Muss VERSCHIEDEN sein von inypnrvpawvhgiyagxbd — sonst ist es keine Grenze.
echo "staging=<neuer_ref>  prod=inypnrvpawvhgiyagxbd"
```

**Schritt 3:** Migrationen einspielen. Der Repository-Pfad bleibt Schemaquelle — **nicht** über
Coolify, **nicht** über das Dashboard-SQL:

```bash
pnpm exec supabase link --project-ref <neuer_ref>
pnpm exec supabase db push
```

**Schritt 4:** Angewandte Migrationen zählen und gegen die Dateien halten:

```bash
ls -1 supabase/migrations/*.sql | wc -l
pnpm exec supabase migration list --linked
```

Erwartet: beide Zahlen gleich. **Die Dateizahl allein ist kein Beleg für die Serverseite** — die
zweite Zeile ist der Beleg.

**Schritt 5:** Die Loginrolle `easytree_app` prüfen. `DATABASE_URL` muss als `easytree_app`
verbinden, nie als `postgres` (der trägt BYPASSRLS, und der EYT-45-Startgate verweigert dann):

```sql
select rolname, rolbypassrls, rolcanlogin from pg_roles where rolname in ('easytree_app','postgres');
```

Erwartet: `easytree_app | f | t`.

**Schritt 6:** Seed **nur** synthetische Daten (`supabase/seed.sql`), niemals Produktivdaten.

**Gate 0 (hart):** Ohne verschiedene `project_ref`, ohne vollständige Migrationsliste und ohne
`rolbypassrls = f` beginnt Phase 3 **nicht**. Das ist dieselbe Auflage, die als Owner-Entscheidung
**D-1** seit dem 18.08.2026 gilt.

---

# PHASE 1 — EYT-141 abschließen

**Blockiert durch:** nichts. **Ergebnis:** alle EYT-141-Akzeptanzkriterien außer dem einen, das
reales Staging voraussetzt.

### Was schon steht (nicht neu bauen)

`git log origin/master --grep=EYT-141` zeigt: Werkbank-Komposition, genau eine `main`-Landmark,
Fokusrahmen am Datumsfeld, Tastaturbudget statt Tab-Zählung, Abnahmebreiten 1440/1920/200 %,
Negativfälle „Satz fehlt" und „Satz mehrdeutig" ohne `0,00 €`. Diese Arbeit ist erledigt.

### Was fehlt — zwei benannte Lücken und eine, die Phase 3 gehört

- **L-1:** `/kosten` stellt die Herkunftsangaben **über** die Zahlen. Die Akzeptanz verlangt das
  Gegenteil: „Snapshot-ID, Planversion, Erstellungszeit, Regelversion und Währung sind sichtbar,
  aber **visuell nachgeordnet** gegenüber Tages-/Gesamtsumme und Positionen." Heute rendert
  `SnapshotAnzeige` (`apps/web/components/kosten-ansicht.tsx:473-513`) zuerst das `<dl>` mit neun
  Metadatenfeldern und erst danach (`:515`) die Gesamtsumme.
- **L-2:** axe im echten Browser läuft nur gegen `/` (`apps/web/e2e/shell-smoke.spec.ts:151-155`).
  Die Route-Liste `ROUTEN` (`:180-185`) enthält `/planung` und `/kosten` bereits — aber nur für
  den Rendertest, nicht für axe. Die unangemeldeten Zustände dieser beiden Flächen sind damit
  **nicht** auf Barrierefreiheit geprüft; die angemeldeten sind es (`auth-journey`).
- **L-3 (Phase 3):** „Reale Staging-Screenshots dienen als visuelle Regressionsevidenz." Das kann
  Phase 1 nicht schließen — es braucht Staging. Steht als Task 3.6.

---

### Task 1.1: Kosten-Cockpit — Zahlen zuerst, Herkunft danach

**Files:**

- Modify: `apps/web/components/kosten-ansicht.tsx:473-513` (Block `SnapshotAnzeige`)
- Modify: `apps/web/app/globals.css` (neue Klasse `eyt-kosten-herkunft`)
- Test: `apps/web/test/kosten-ansicht.test.tsx`

**Schritt 1: Den fehlschlagenden Test schreiben**

An das Ende von `apps/web/test/kosten-ansicht.test.tsx` anfügen — in denselben `describe`-Block,
der den geladenen Snapshot rendert (die vorhandenen Helfer `SNAPSHOT`, `SNAPSHOT_ID` und der
Gateway-Doppelgänger dieser Datei werden wiederverwendet, es wird keine zweite Fixtur gebaut):

```tsx
it("stellt Summe, Tage und Positionen VOR die Herkunftsangaben (EYT-141)", async () => {
  // `zeige(antworten, snapshotId)` ist der vorhandene Helfer dieser Datei
  // (`kosten-ansicht.test.tsx:209`): er baut den Gateway-Doppelgaenger ueber
  // `baue()` und rendert. Kein zweiter Aufbau, keine zweite Fixtur.
  zeige({}, SNAPSHOT_ID);

  const summe = await screen.findByTestId("kosten-gesamtsumme");
  const positionen = screen.getByTestId("kosten-positionen");
  const herkunft = screen.getByTestId("kosten-herkunft");

  // Dokumentreihenfolge, nicht CSS: `compareDocumentPosition` misst, was ein
  // Screenreader und ein Tastaturlauf tatsaechlich nacheinander erreichen.
  const summeVorHerkunft =
    summe.compareDocumentPosition(herkunft) & Node.DOCUMENT_POSITION_FOLLOWING;
  const positionenVorHerkunft =
    positionen.compareDocumentPosition(herkunft) & Node.DOCUMENT_POSITION_FOLLOWING;

  expect(summeVorHerkunft, "Gesamtsumme steht nach der Herkunft").toBeTruthy();
  expect(positionenVorHerkunft, "Positionen stehen nach der Herkunft").toBeTruthy();
});
```

**Warum keine eigene Fixtur:** `SNAPSHOT` dieser Datei ist absichtlich arithmetisch widersprüchlich
(`totalMinorUnits` 999999 gegen Positionen 1000 + 2000) — sie **ist** die dauerhafte Gegenmutation
gegen eine Ansicht, die selbst zu summieren beginnt. Eine zweite, „saubere" Fixtur daneben gäbe
diesen Schutz für den neuen Fall stillschweigend auf.

**Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
pnpm --filter @easytree/contracts build
pnpm --filter @easytree/web exec vitest run test/kosten-ansicht.test.ts
```

Erwartet: **FAIL** mit `Unable to find an element by: [data-testid="kosten-herkunft"]`.
Die Dateizahl in der Ausgabe muss **≥ 1** sein — ein Pfadfilter ohne Treffer beendet vitest mit 0,
ohne etwas geprüft zu haben.

**Schritt 3: Umsetzen**

In `apps/web/components/kosten-ansicht.tsx`, Funktion `SnapshotAnzeige`: den `<dl className="eyt-kennzahlen">`-Block
unverändert **hinter** die beiden `eyt-table-scroll`-Blöcke verschieben, ihm
`data-testid="kosten-herkunft"` und die zusätzliche Klasse geben, und eine Überschrift davorsetzen,
damit der Bereich im Screenreader auffindbar bleibt:

```tsx
      <h3 className="eyt-kosten-herkunft__titel">Herkunft dieses Snapshots</h3>
      <dl className="eyt-kennzahlen eyt-kosten-herkunft" data-testid="kosten-herkunft">
```

Die **neun `<dt>`/`<dd>`-Paare und alle vorhandenen `data-testid` bleiben wörtlich unverändert** —
`kosten-snapshot-id`, `kosten-planversion-id`, `kosten-erzeuger`, `kosten-regelversion`,
`kosten-waehrung`, `kosten-baustellenfilter` werden von `journey.pwtest.ts` benutzt. Wer sie
umbenennt, bricht `auth-journey`, und das fällt erst im teuersten Job auf.

In `apps/web/app/globals.css` ergänzen:

```css
/* EYT-141 — die Herkunft ist nachgeordnet, aber nicht versteckt: kleinere
   Schrift und Sekundaerfarbe, oberhalb eine Haarlinie als Zaesur. Kein
   `<details>`: die Akzeptanz verlangt "sichtbar", und zugeklappt ist es das
   nicht. */
.eyt-kosten-herkunft {
  margin-block-start: calc(var(--space) * 1.5);
  padding-block-start: var(--space);
  border-block-start: 1px solid var(--eyt-border-default);
  color: var(--eyt-text-secondary);
  font-size: 0.875rem;
}

.eyt-kosten-herkunft__titel {
  margin-block: calc(var(--space) * 1.5) 0;
  font-size: 0.9375rem;
  color: var(--eyt-text-secondary);
}
```

**Schritt 4: Test laufen lassen, Erfolg bestätigen**

```bash
pnpm --filter @easytree/web exec vitest run test/kosten-ansicht.test.ts
```

Erwartet: **PASS**, und die Zahl der Tests in dieser Datei ist um genau 1 gestiegen.

**Schritt 5: Die Nachbarsuiten mitfahren**

```bash
pnpm --filter @easytree/web test
pnpm --filter @easytree/ui test
```

Erwartet: grün. `a11y.test.tsx` rendert die Kostenansicht mit — eine neue `<h3>` in falscher
Rangfolge (`heading-order`) würde dort rot.

**Schritt 6: Gegenmutation — einspielen, messen, zurücknehmen**

Ohne sie ist der neue Test Ausführungsnachweis, kein Beweis.

```bash
cp apps/web/components/kosten-ansicht.tsx /tmp/kosten-ansicht.bak
# Den <dl>-Block wieder VOR die Gesamtsumme schieben (Handgriff, kein sed:
# der Block ist zu gross fuer einen sicheren Anker).
pnpm --filter @easytree/web exec vitest run test/kosten-ansicht.test.ts
```

Erwartet: **FAIL**, und zwar **genau der neue Fall**, nicht mehr. Danach zurücknehmen und die
Rücknahme belegen — **auf die Datei eingegrenzt**, weil der übrige Baum absichtlich geändert ist:

```bash
cp /tmp/kosten-ansicht.bak apps/web/components/kosten-ansicht.tsx
git diff --stat -- apps/web/components/kosten-ansicht.tsx
```

Erwartet: die Zeile zeigt nur die gewollte Umstellung, keine Reste der Mutation.

**Schritt 7: Commit**

```bash
git add apps/web/components/kosten-ansicht.tsx apps/web/app/globals.css apps/web/test/kosten-ansicht.test.tsx
git diff --cached --name-only
git commit -m "feat(web): EYT-141 — im Kosten-Cockpit stehen die Zahlen vor der Herkunft"
```

`git diff --cached --name-only` muss **genau diese drei Dateien** zeigen.

---

### Task 1.2: axe im echten Browser auch auf `/planung` und `/kosten`

**Files:**

- Modify: `apps/web/e2e/shell-smoke.spec.ts:151-155`
- Test: dieselbe Datei

**Schritt 1: Den bestehenden axe-Test über die vorhandene Route-Liste ziehen**

`ROUTEN` (`:180-185`) ist bereits deklariert, steht aber **unterhalb** des axe-Tests. Die
Deklaration nach oben vor den axe-Test verschieben (der Kommentarblock darüber wandert mit — er
erklärt, warum diese Routen ohne API in ihrem Lade-/Fehlerzustand landen), dann den Einzeltest
ersetzen:

```ts
for (const route of ROUTEN) {
  test(`axe im echten Browser: 0 Violations auf ${route.pfad}`, async ({ page }) => {
    await page.goto(route.pfad);
    // Hier laeuft KEINE API. Geprueft wird deshalb der unangemeldete Lade-,
    // Leer- oder Fehlerzustand dieser Flaeche — genau die Zustaende, die
    // EYT-141 als wiederverwendbar verlangt. Die ANGEMELDETEN Zustaende
    // derselben Flaechen prueft `auth-journey` bei 1440/1920/200 %.
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations, `${route.pfad}: ${JSON.stringify(results.violations)}`).toEqual([]);
  });
}
```

**Schritt 2: Laufen lassen — Port 3000 muss frei sein**

```bash
lsof -ti tcp:3000 || echo "Port 3000 frei"
pnpm --filter @easytree/web... build
EASYTREE_API_PROXY_TARGET=http://127.0.0.1:3001 pnpm --filter @easytree/web run test:e2e -- shell-smoke
```

Erwartet: **vier** axe-Fälle statt einem. Werden es weniger, ist die Schleife nicht gelaufen —
Playwright meldet dann keinen Fehler, und die Zahl ist der einzige Beleg.

**Schritt 3: Reale Befunde beheben, nicht wegdefinieren**

Wenn `/planung` oder `/kosten` unangemeldet Verstöße melden: **beheben**. Die Tagliste **nicht**
verengen und keinen Verstoß über `exclude` ausblenden — `wcag2a`/`wcag2aa` sind bereits die
engere Liste (Landmark-Regeln von axe liegen unter `best-practice` und tauchen hier gar nicht auf).

**Schritt 4: Commit**

```bash
git add apps/web/e2e/shell-smoke.spec.ts
git commit -m "test(web): EYT-141 — axe faehrt im Browser auch ueber Planung und Kosten"
```

---

### Task 1.3: EYT-141-Akzeptanz gegen die Artefakte abhaken

**Schritt 1:** Die acht Akzeptanzkriterien von EYT-141 wörtlich aus Jira ziehen und je Kriterium
**einen** Befehl mit seiner Ausgabe danebenstellen. Kein „sieht richtig aus".

**Schritt 2:** Deliverables auf Resttext prüfen:

```bash
grep -rniE "offen|TODO|TOOL_GAP|FIXME" apps/web/components/kosten-ansicht.tsx apps/web/e2e/shell-smoke.spec.ts
```

Ein Treffer ist ein Blocker, kein Hinweis.

**Schritt 3:** Das eine offene Kriterium **benennen**, nicht überspringen: „Reale
Staging-Screenshots" bleibt offen bis Task 3.6. In den Jira-Kommentar gehört dieser Satz
ausdrücklich hinein.

**Schritt 4: Vollgate lokal, dann PR**

```bash
pnpm exec turbo run lint --force
pnpm exec turbo run typecheck --force
pnpm exec turbo run test --force
git ls-files -z | xargs -0 pnpm exec prettier --ignore-unknown --check
```

Erwartet je Turbo-Lauf: `Cached: 0 cached` **und** `Tasks: N successful`. Ein `>>> FULL TURBO`
beweist nichts — es ist ein Replay.

---

# PHASE 2 — Ein ziehbares Deployartefakt

**Blockiert durch:** nichts. **Warum jetzt:** Phase 3 soll am Deploytag nicht an einem
Serverbuild scheitern.

### Die Entscheidung, die diese Phase trifft

Coolify baut per Vorgabe auf dem Server. Der Server hat **2,6 GB verfügbaren RAM und 22 GB Platte**
neben sechs fremden Workloads (gemessen 23.08.2026). Statt zu hoffen, verlagert dieser Plan den
Bau in CI und lässt Coolify ein fertiges Image **ziehen**.

Das ist kein Umweg, sondern erfüllt ein EYT-126-Akzeptanzkriterium schärfer als ein Serverbuild es
könnte: „Staging-Deploy ist reproduzierbar und an exakten Commit/Image-Stand gebunden." Ein
Image-Digest ist diese Bindung; ein Serverbuild aus einem Branch ist es nicht.

**Nebenwirkung, die eingeplant ist:** GHCR-Images werden für `linux/amd64` gebaut (der VPS ist
x86_64). Auf diesem Mac läuft Docker über colima mit **aarch64** — gezogene Staging-Images laufen
dort nur unter Emulation. Die lokale Generalprobe benutzt deshalb **lokal gebaute** Images; der
Digestabgleich passiert auf dem VPS.

---

### Task 2.1: Ein eigener Workflow, der Images nach GHCR schiebt

**Files:**

- Create: `.github/workflows/release-images.yml`

**Warum eine eigene Datei und nicht ein Job in `ci.yml`:** `scripts/setup-branch-protection.sh:26`
und `scripts/verify-branch-protection.sh:61` lesen **beide** ausschließlich
`.github/workflows/ci.yml` und brechen mit einem Driftfehler ab, sobald dort ein Job steht, der
nicht in der Pflichtcheckliste geführt ist. Ein Imagepush ist kein Pflichtcheck — er gehört nicht
in diese Liste. Die eigene Datei umgeht die Kollision, ohne den Wächter zu schwächen. Nachher
gegenprüfen (Schritt 4).

**Schritt 1: Datei anlegen**

```yaml
# Baut die beiden OCI-Images auf GitHubs Runnern und legt sie unter dem
# Commit-SHA in der GitHub Container Registry ab (EYT-126, EYT-142).
#
# Warum nicht auf dem VPS: der Zielserver hat 2,6 GB verfuegbaren RAM neben
# sechs fremden Workloads (gemessen 23.08.2026). Ein Next-16- plus ein
# NestJS-Build dort ist ein OOM-Risiko ohne Gegenwert — und ein Serverbuild
# bindet das Deploy an einen Branch statt an einen Digest.
#
# BEWUSST KEIN Pflichtcheck und bewusst NICHT in ci.yml: beide
# Branch-Protection-Skripte lesen nur ci.yml und wuerden einen dortigen
# Nicht-Pflicht-Job als Drift melden.
name: release-images

on:
  push:
    branches: [master]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

concurrency:
  group: release-images-${{ github.ref }}
  cancel-in-progress: false

jobs:
  images:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - name: api
            dockerfile: apps/api/Dockerfile
          - name: web
            dockerfile: apps/web/Dockerfile
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Registry-Pfad in Kleinbuchstaben
        id: ziel
        run: |
          set -euo pipefail
          # GHCR verlangt kleingeschriebene Repository-Namen. Der Kontextwert
          # `github.repository_owner` ist hier "DYAI2025" mit Grossbuchstaben
          # (gemessen 23.08.2026 ueber `gh repo view --json owner`) — direkt als
          # Tag benutzt ergaebe er "invalid reference format" und der Job faellt
          # erst nach dem vollstaendigen Bau.
          echo "owner=$(echo '${{ github.repository_owner }}' | tr '[:upper:]' '[:lower:]')" >> "$GITHUB_OUTPUT"

      - name: Image bauen und schieben
        id: push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ${{ matrix.dockerfile }}
          push: true
          # Nur amd64: der Zielserver ist x86_64. Ein zweiter Bogen
          # verdoppelt die Bauzeit fuer eine Plattform, auf der nichts laeuft.
          platforms: linux/amd64
          # GIT_SHA hat in beiden Dockerfiles KEINEN Vorgabewert und wird
          # darin geprueft — ein Image ohne Herkunft schlaegt beim Bauen fehl.
          build-args: GIT_SHA=${{ github.sha }}
          tags: |
            ghcr.io/${{ steps.ziel.outputs.owner }}/easytree-${{ matrix.name }}:${{ github.sha }}
            ghcr.io/${{ steps.ziel.outputs.owner }}/easytree-${{ matrix.name }}:master
          cache-from: type=gha,scope=${{ matrix.name }}
          cache-to: type=gha,mode=max,scope=${{ matrix.name }}

      - name: Digest und Herkunft in die Zusammenfassung
        run: |
          set -euo pipefail
          # Der Digest ist die einzige Bindung, die ein umgehaengter Tag nicht
          # faelschen kann. Er wandert in die Zusammenfassung, weil das Deploy
          # ihn spaeter woertlich verlangt.
          {
            echo "### easytree-${{ matrix.name }}"
            echo ""
            echo "- Commit: \`${{ github.sha }}\`"
            echo "- Digest: \`${{ steps.push.outputs.digest }}\`"
            echo "- Ziehen:  \`ghcr.io/${{ steps.ziel.outputs.owner }}/easytree-${{ matrix.name }}@${{ steps.push.outputs.digest }}\`"
          } >> "$GITHUB_STEP_SUMMARY"
```

**Schritt 2: Syntax prüfen, bevor gepusht wird**

```bash
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/release-images.yml')); print('jobs:', list(d['jobs']))"
```

Erwartet: `jobs: ['images']`.

**Schritt 3: Der Wächter darf davon nicht stolpern**

```bash
bash scripts/verify-branch-protection.sh
```

Erwartet: `=== Ergebnis: 0 offen`. **Kommt hier ein Driftfehler, liest das Skript entgegen
`scripts/verify-branch-protection.sh:61` mehr als `ci.yml` — dann diesen Task stoppen und
stattdessen `WORKFLOW_FILE` prüfen, nicht die Pflichtliste anfassen.**

**Schritt 4: Commit und Lauf**

```bash
git add .github/workflows/release-images.yml
git commit -m "ci(EYT-126): Container-Images nach GHCR schieben statt auf dem VPS zu bauen"
git push
```

**Schritt 5: Den Lauf messen, nicht annehmen**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 1800
gh run list --workflow release-images.yml --limit 1
```

`gh-ci-wait` Exit 0 kann Timeout heißen — den Endstand über `gh run view` gegenprüfen. Exit 1 kann
„abgebrochen" heißen, wenn ein Push nachgeschoben wurde.

**Schritt 6: Das Image ist wirklich da und trägt den Commit**

```bash
SHA="$(git rev-parse HEAD)"
docker pull --platform linux/amd64 "ghcr.io/dyai2025/easytree-web:$SHA"
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "ghcr.io/dyai2025/easytree-web:$SHA"
```

Erwartet: die Ausgabe ist **wörtlich `$SHA`**. Ist sie leer oder anders, ist die Herkunftsbindung
kaputt und Task 3.2 hätte nichts zu prüfen.

---

### Task 2.2: Eine Compose-Datei, die zieht statt baut

**Files:**

- Create: `docker-compose.staging.yml`

**Warum eine zweite Datei und keine Änderung an `docker-compose.yml`:** Die vorhandene Datei ist
die Topologie für CI und lokal, und `scripts/smoke-container.sh` baut über sie aus dem
Arbeitsbaum. Nähme man ihr das `build:`, verlöre der Container-Smoke seinen Gegenstand.

**Schritt 1: Datei anlegen**

```yaml
# Staging-Topologie (EYT-142): identisch zu docker-compose.yml, aber sie ZIEHT
# fertige Images statt zu bauen. Coolify konsumiert diese Datei.
#
# Die Grenzen aus docker-compose.yml gelten unveraendert weiter:
#   1. Nur `web` veroeffentlicht einen Port; die API haengt am internen Netz.
#   2. Weder `api` noch `web` fuehren Schemawerkzeuge aus — Coolify wird keine
#      zweite Migration Authority (EYT-126, EYT-142).
#   3. Kein Vorgabewert fuer EASYTREE_API_PROXY_TARGET: ein geratenes Ziel
#      sieht im Browser aus wie eine leere Woche, nicht wie ein Fehler.
#
# EASYTREE_API_IMAGE/EASYTREE_WEB_IMAGE werden mit @sha256-DIGEST gesetzt,
# nicht mit einem Tag: ein Tag laesst sich zwischen zwei Starts umhaengen.

services:
  api:
    image: ${EASYTREE_API_IMAGE:?EASYTREE_API_IMAGE fehlt - ghcr.io/dyai2025/easytree-api@sha256:...}
    restart: unless-stopped
    expose:
      - "3001"
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      API_PORT: "3001"
      LOG_LEVEL: ${LOG_LEVEL:-info}
      DATABASE_URL: ${DATABASE_URL:?DATABASE_URL fehlt — verbindet als easytree_app, niemals als postgres}
      SUPABASE_URL: ${SUPABASE_URL:?SUPABASE_URL fehlt}
      SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY fehlt}
      DATABASE_SSL_ROOT_CERT: ${DATABASE_SSL_ROOT_CERT:?DATABASE_SSL_ROOT_CERT ist in production Pflicht}
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:3001/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 20s

  web:
    image: ${EASYTREE_WEB_IMAGE:?EASYTREE_WEB_IMAGE fehlt - ghcr.io/dyai2025/easytree-web@sha256:...}
    restart: unless-stopped
    depends_on:
      api:
        condition: service_healthy
    ports:
      - "${EASYTREE_WEB_PUBLIC_PORT:-3000}:3000"
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      PORT: "3000"
      HOSTNAME: "0.0.0.0"
      EASYTREE_API_PROXY_TARGET: ${EASYTREE_API_PROXY_TARGET:?EASYTREE_API_PROXY_TARGET fehlt - interner Dienstname der API, z. B. http://api:3001}
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 20s
```

**Schritt 2: Ohne Variablen muss sie sich weigern**

```bash
env -u EASYTREE_API_IMAGE -u EASYTREE_WEB_IMAGE -u DATABASE_URL \
  docker compose -f docker-compose.staging.yml config >/dev/null 2>/tmp/compose-fail.log; echo "exit=$?"
grep -c "fehlt" /tmp/compose-fail.log
```

Erwartet: `exit=1` und eine Trefferzahl **≥ 1**. Das ist die Gegenprobe zum `:?` — ohne sie wäre
nicht belegt, dass ein fehlendes Ziel den Start verweigert statt still etwas Plausibles zu nehmen.

**Schritt 3: Mit Variablen muss sie auflösen**

```bash
EASYTREE_API_IMAGE=ghcr.io/dyai2025/easytree-api:master \
EASYTREE_WEB_IMAGE=ghcr.io/dyai2025/easytree-web:master \
DATABASE_URL=postgres://x@y/z SUPABASE_URL=https://x SUPABASE_ANON_KEY=x \
DATABASE_SSL_ROOT_CERT=x EASYTREE_API_PROXY_TARGET=http://api:3001 \
  docker compose -f docker-compose.staging.yml config | grep -E "image:|EASYTREE_API_PROXY_TARGET"
```

Erwartet: beide `image:`-Zeilen und das Proxyziel wörtlich.

**Schritt 4: Commit**

```bash
git add docker-compose.staging.yml
git commit -m "feat(deploy): EYT-142 — Staging-Topologie zieht Images statt sie zu bauen"
```

---

### Task 2.3: Die neue Staging-Topologie unter den vorhandenen Wächter stellen

**Gefunden während der Umsetzung von Task 2.2, nicht beim Planen.** `docker-compose.staging.yml`
ist eine zweite Deploy-Topologie — und der Wächter, der eine zweite Migrationsautorität verhindert,
kennt sie nicht.

**Der gemessene Befund:** `apps/api/test/deploy-authority.test.ts:32-36` führt eine **feste**
Dateiliste `CONTAINER_DATEIEN` mit genau drei Einträgen (`apps/api/Dockerfile`,
`apps/web/Dockerfile`, `docker-compose.yml`), und `:160` sichert die Länge mit
`expect(CONTAINER_DATEIEN.length).toBe(3)` ab. Die neue Datei steht nicht darin. Trüge sie morgen
ein `supabase db push`, würde **nichts** rot — Coolify wäre dann still eine zweite Schemaquelle,
und genau das verbieten EYT-126 und EYT-142 wörtlich.

Dass die Liste fest ist und ihre Länge zugesichert wird, ist kein Fehler, sondern Absicht: so
bleibt der Test nicht vakuum-grün, wenn ein Glob ins Leere greift. Der Preis ist, dass **jede neue
Deploy-Datei die Liste einmal anfassen muss**.

**Files:**

- Modify: `apps/api/test/deploy-authority.test.ts:32-36` und `:160`

**Schritt 1: Die Datei in die Liste aufnehmen**

```ts
const CONTAINER_DATEIEN = [
  join(REPO, "apps/api/Dockerfile"),
  join(REPO, "apps/web/Dockerfile"),
  join(REPO, "docker-compose.yml"),
  // EYT-142 — die Staging-Topologie ist eine zweite Deploy-Datei und braucht
  // dieselbe Grenze. Ohne diese Zeile bliebe ein `supabase db push` darin
  // unbemerkt, und Coolify waere still Schemaeigentuemer.
  join(REPO, "docker-compose.staging.yml"),
];
```

**Schritt 2: Die Längenzusicherung mitziehen**

`expect(CONTAINER_DATEIEN.length).toBe(3)` → `toBe(4)`. **Diese Zeile ist der Grund, warum der
Test nicht still schwächer werden kann** — wer die Liste kürzt, ohne die Zahl zu ändern, wird rot.
Ändere sie deshalb bewusst und nicht nebenbei.

**Schritt 3: Grün messen**

```bash
pnpm --filter @easytree/api^... build
pnpm --filter @easytree/api exec vitest run test/deploy-authority.test.ts
```

Erwartet: grün, und die gedruckte **Dateizahl ≥ 1**. Ein vitest-Pfadfilter ohne Treffer endet mit
Exit 0, ohne etwas geprüft zu haben.

**Schritt 4: Gegenmutation — der Wächter muss die neue Fläche wirklich BETRETEN**

Ein Wächter, der die Datei bloß in seiner Liste führt, sie aber nie liest, ist kein Wächter. Das
ist in diesem Repo mehrfach vorgekommen.

```bash
cp docker-compose.staging.yml /tmp/compose-staging.bak
# In den api-Dienst eine Zeile einfuegen:
#   command: pnpm exec supabase db push
pnpm --filter @easytree/api exec vitest run test/deploy-authority.test.ts
```

Erwartet: **rot**, und die Fehlermeldung nennt **`docker-compose.staging.yml`**. Wird sie rot, ohne
die Datei zu nennen, misst der Test etwas anderes — dann anhalten und melden.
`supabase db push` steht wörtlich in `SCHEMA_WERKZEUGE`
(`apps/api/test/architecture/deploy-authority-rules.ts:34`), die Mutation trifft die Regel also
sicher.

Zurücknehmen über die Sicherungskopie — **nicht** mit `git checkout --`:

```bash
cp /tmp/compose-staging.bak docker-compose.staging.yml
cmp /tmp/compose-staging.bak docker-compose.staging.yml && echo "identisch"
pnpm --filter @easytree/api exec vitest run test/deploy-authority.test.ts
```

Erwartet: wieder grün.

**Schritt 5: Commit**

```bash
git add apps/api/test/deploy-authority.test.ts
git diff --cached --name-only
git commit -m "test(api): EYT-142 — die Staging-Topologie faellt unter denselben Autoritaetswaechter"
```

---

### Task 2.4: Generalprobe auf diesem Mac

**Zweck:** den Deployablauf einmal durchspielen, solange ein Fehler nichts kostet.
**Was er NICHT beweist:** dass Staging läuft. Ein echter Stack in CI oder lokal belegt Funktion,
nicht Bereitstellung — er wird nie als Staging-Evidenz geführt.

**Schritt 1: Docker bereitstellen** (auf diesem Mac ist die Engine colima, nicht Docker Desktop)

```bash
colima status || colima start
docker version --format '{{.Server.Version}}'
```

**Schritt 2: Was diese Probe NICHT sein kann — und warum das in Ordnung ist**

`scripts/smoke-container.sh` verlangt in seinem Kopf (`:41-44`) **vier** Größen: `GIT_SHA`,
`EASYTREE_SMOKE_DATABASE_URL`, `EASYTREE_SMOKE_SUPABASE_URL` und `EASYTREE_SMOKE_ANON_KEY` — also
einen laufenden GoTrue, nicht bloß eine Datenbank. Dieser Mac kann den Supabase-Stack nicht
starten (gemessen, wiederholt). **Der vollständige Container-Smoke im Modus `required` bleibt
deshalb Sache von `db-gates`; er wird hier nicht simuliert und nicht behauptet.**

Was diese Probe leistet, ist enger und genau das, was Phase 3 braucht: dass die **Staging**-Datei
mit **gezogenen** Images eine Topologie hochbringt und die Fail-closed-Naht sitzt.

**Schritt 3: Digests ziehen und die Staging-Topologie starten**

```bash
SHA="$(git rev-parse origin/master)"
API_DIGEST="$(docker buildx imagetools inspect --format '{{.Manifest.Digest}}' ghcr.io/dyai2025/easytree-api:$SHA)"
WEB_DIGEST="$(docker buildx imagetools inspect --format '{{.Manifest.Digest}}' ghcr.io/dyai2025/easytree-web:$SHA)"
echo "api=$API_DIGEST web=$WEB_DIGEST"
```

Beide Ausgaben müssen mit `sha256:` beginnen. **Diese Images sind `linux/amd64`**; colima läuft
hier auf aarch64, sie laufen also unter Emulation — langsam, aber für einen Health-Check genügend.
Wer stattdessen lokal baut, prüft eine andere Binärdatei als die, die auf dem VPS läuft.

**Schritt 4: Die Fail-closed-Gegenprobe — der eigentliche Zweck**

```bash
# OHNE Proxyziel: das Web MUSS jede Route mit 500 beantworten und den
# Variablennamen protokollieren. Der Prozess haelt dabei den Port — das ist
# kein "Container startet nicht", sondern die gewollte Verweigerung.
docker run --rm -d --name eyt-probe-web -p 3009:3000 \
  -e NODE_ENV=production -e PORT=3000 -e HOSTNAME=0.0.0.0 \
  "ghcr.io/dyai2025/easytree-web@${WEB_DIGEST}"
sleep 15
curl -sS -o /dev/null -w "ohne_ziel=%{http_code}\n" http://127.0.0.1:3009/
docker logs eyt-probe-web 2>&1 | grep -c EASYTREE_API_PROXY_TARGET
docker rm -f eyt-probe-web
```

Erwartet: `ohne_ziel=500` und eine Trefferzahl **≥ 1**. Kommt hier eine 200, ist die Fail-closed-
Naht defekt und Phase 3 würde ein geratenes Ziel nicht bemerken.

**Schritt 5: Herkunft des gezogenen Images**

```bash
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "ghcr.io/dyai2025/easytree-web@${WEB_DIGEST}"
```

Erwartet: wörtlich `$SHA`.

**Schritt 6: Kein Commit.** Diese Probe erzeugt Wissen, keine Artefakte.

---

# PHASE 3 — EYT-142: realer Deploy und Abnahme

**Blockiert durch:** Gate 0 (Phase 0) **und** ein grünes Image aus Task 2.1.
**Ohne Gate 0 wird diese Phase nicht begonnen** — nicht „testweise", nicht „nur `/health`".

### Task 3.1: Coolify-Ressource anlegen

**Schritt 1:** In Coolify (`https://<vps>/`) ein Projekt `easytree` mit Umgebung `staging`
anlegen, Ressourcentyp **Docker Compose**, Quelle `docker-compose.staging.yml`.

**Schritt 2:** GHCR-Zugangsdaten hinterlegen (Registry `ghcr.io`, Benutzer `DYAI2025`, ein
Personal Access Token mit `read:packages`). **Das Token nirgends ins Repository, in keinen Plan
und in keinen Jira-Kommentar.**

**Schritt 3:** Umgebungsvariablen setzen — die kanonischen sieben plus das Proxyziel:

| Variable                                    | Wert                                        | Klasse     |
| ------------------------------------------- | ------------------------------------------- | ---------- |
| `NODE_ENV`                                  | `production`                                | offen      |
| `API_PORT`                                  | `3001`                                      | offen      |
| `LOG_LEVEL`                                 | `info`                                      | offen      |
| `DATABASE_URL`                              | Staging-Pooler, Benutzer **`easytree_app`** | **geheim** |
| `SUPABASE_URL`                              | Staging-Projekt-URL                         | offen      |
| `SUPABASE_ANON_KEY`                         | Staging-Anon-Key                            | **geheim** |
| `DATABASE_SSL_ROOT_CERT`                    | Supabase Root 2021 CA                       | **geheim** |
| `EASYTREE_API_PROXY_TARGET`                 | `http://api:3001`                           | offen      |
| `EASYTREE_API_IMAGE` / `EASYTREE_WEB_IMAGE` | `…@sha256:<digest>` aus Task 2.1            | offen      |

**Kein `postgres`-Benutzer, keine Service-Role, kein `sslmode=disable`.** Der EYT-45-Startgate
verweigert den Start bei BYPASSRLS — das ist Absicht und darf nicht umgangen werden.

**Schritt 4:** Erst deployen, wenn die Digests aus Task 2.1 Schritt 6 eingetragen sind.

### Task 3.2: Deploy und Herkunftsbindung

**Schritt 1:** Deploy auslösen.

**Schritt 2:** Belegen, dass läuft, was gemeint war:

```bash
ssh root@srv1308064.hstgr.cloud \
  'for c in $(docker ps --filter name=easytree --format "{{.Names}}"); do
     printf "%s\t%s\t%s\n" "$c" \
       "$(docker inspect --format "{{index .Config.Labels \"org.opencontainers.image.revision\"}}" "$c")" \
       "$(docker inspect --format "{{.Config.User}}" "$c")";
   done'
```

Erwartet je Zeile: der **exakte Sprint-6-Head-SHA** und der Benutzer `node` — nicht leer, nicht
`root`.

### Task 3.3: Health und Readiness gegen Staging

```bash
STAGING="https://<staging-domain>"
curl -sS -o /dev/null -w "health=%{http_code}\n" "$STAGING/health"
curl -sS "$STAGING/ready" | jq -e '.database == true' && echo "ready=ok"
```

Erwartet: `health=200` und `ready=ok`. Ein 500 auf **jeder** Route heißt: das Proxyziel wurde
abgelehnt (`instrumentation.ts`). Der Prozess hält dann den Port — **das ist kein
„Container startet nicht"**, sondern fail-closed, und die Ursache steht im Containerprotokoll.

### Task 3.4: Die Kernreise real fahren

**Zuerst eine Korrektur an einer naheliegenden Annahme.** „Die vorhandene `auth-journey`-Suite
einfach gegen Staging richten" geht **nicht**, und zwar aus drei gemessenen Gründen
(`apps/web/e2e/auth-journey/config.ts:81-138`, CI-Aufruf
`playwright test -c e2e/auth-journey/config.ts`):

1. Die Konfiguration **startet ihre eigenen zwei Server** (`node dist/main.js` auf 3101,
   `next start` auf 3100) und setzt `baseURL` fest auf `http://127.0.0.1:3100`. Es gibt keinen
   Umschalter auf eine entfernte Adresse.
2. `globalSetup` fährt **`psql`** gegen `EASYTREE_JOURNEY_ADMIN_DB_URL` — eine privilegierte
   Verbindung, die Fixtures anlegt; einzelne Fälle schalten damit mitten im Lauf Mitgliedschaften
   an und aus (`journey.pwtest.ts:1524,1969,2114`).
3. Der API-Server läuft dort mit `NODE_ENV: "test"`. Staging läuft mit `production` — ein anderes
   Konfigurationsprofil mit anderen Pflichtvariablen.

Es gibt deshalb zwei ehrliche Wege. **Empfohlen ist B**, weil die EYT-142-Kriterien eine
_Browserreise mit Screenshots_ verlangen, nicht den automatisierten Lauf gegen Staging.

---

**Weg A — eigene Staging-Konfiguration (gründlich, mehrstündig, optional)**

Eine Schwesterdatei `apps/web/e2e/auth-journey/staging.config.ts` ohne `webServer`, mit
`baseURL` aus einer Umgebungsvariablen und mit demselben `globalSetup`/`globalTeardown`.
Voraussetzung, die eigens zu klären ist: **`psql` muss die Staging-Datenbank erreichen.** Der
direkte Supabase-Host ist IPv6-only, und dieser Mac hat keine IPv6-Route — der Lauf müsste
über den Pooler (IPv4) oder vom VPS aus erfolgen. Weg A ist **kein** Sprintziel; er ist die
Folgearbeit, wenn die Staging-Reise dauerhaft automatisiert werden soll.

**Weg B — geführte Browserreise mit Belegen (empfohlen für die Abnahme)**

**Schritt 1:** Testdaten auf Staging anlegen — mit demselben Skript, das die Suite benutzt, damit
keine zweite Wahrheit entsteht:

```bash
psql "$STAGING_ADMIN_DB_URL" -v ON_ERROR_STOP=1 -f apps/web/e2e/auth-journey/fixtures.sql
```

Erwartet: die greppbare Markerzeile, die `fixtures.sql` selbst ausgibt. Bleibt sie aus, ist nichts
angelegt — der Exit-Code allein genügt hier nicht.

**Schritt 2:** Die acht Stationen im Browser fahren und je Station festhalten, **was der Server
sagt**, nicht was der Bildschirm zeigt:

| #   | Station                                                  | Beleg                                                |
| --- | -------------------------------------------------------- | ---------------------------------------------------- |
| 1   | Anmelden über `/anmelden`                                | Screenshot + Benutzer-ID                             |
| 2   | `/planung` **ohne** `?weekKey=` öffnen                   | Screenshot; Kopf nennt die ISO-Woche                 |
| 3   | Vorige/nächste/„Heute"                                   | drei Screenshots, drei verschiedene Wochen           |
| 4   | Einsatz anlegen                                          | Screenshot + Assignment-ID aus der Antwort           |
| 5   | Reload (F5)                                              | derselbe Einsatz, dieselbe ID                        |
| 6   | Veröffentlichen                                          | Screenshot + **Planversion-ID**                      |
| 7   | `/kosten`, Snapshot erzeugen                             | Screenshot + **Snapshot-ID**, Tages- und Gesamtsumme |
| 8   | Zweiter Browserkontext (privates Fenster, zweiter Login) | dieselbe Planversion-ID und Snapshot-ID              |

**Schritt 3:** Die Negativreise, im selben Lauf:

- Benutzer **ohne** `costs.read`: kein Kostenübergang, `/kosten` liefert keine Beträge.
- Benutzer **ohne** Mitgliedschaft: weder Planung noch Kosten, und **keine** fremden Mandantendaten.
- Mitarbeitender **ohne** gültigen Satz und einer mit **mehrdeutigem** Satz: fail-closed, und
  **nirgends `0,00 €`**.

**Schritt 4:** Testdaten wieder entfernen und die Vollständigkeit prüfen:

```bash
psql "$STAGING_ADMIN_DB_URL" -v ON_ERROR_STOP=1 -f apps/web/e2e/auth-journey/teardown.sql
```

Erwartet: die Zeile `[auth-journey-teardown] restzeilen=0 …`. `teardown.sql` prüft neun Zähler
einzeln und wirft, wenn einer davon nicht null ist — **die Zeile lesen, nicht den Exit-Code**.

**Schritt 2:** Die acht Stationen der Kernreise einzeln abhaken (Anmelden → Woche ohne `weekKey`
→ Einsatz anlegen → Reload → Publish → `/kosten` → Snapshot + Positionen → zweiter
Browserkontext). Für jede: Screenshot **plus** die maßgebliche ID (Planversion-ID, Snapshot-ID).

**Schritt 3:** Die Negativreise fahren: fremder Mandant, fehlendes Recht, fehlender und
mehrdeutiger Satz. Erwartet: keine Kosten- oder Mandantendaten, und **nirgends `0,00 €`**.

**Schritt 4:** Belegen, dass das Ergebnis wirklich in der Datenbank steht:

```sql
select id, week_key, published_at is not null as veroeffentlicht from public.plan_versions
 where id = '<planversion-id>';
select id, total_minor_units, rule_version from public.cost_snapshots where id = '<snapshot-id>';
```

**Falle, die hier zuschlägt:** Der Transaktionspooler macht `session_user` zu
`postgres.<tenant>` — damit **bricht Publish und die Snapshot-Erzeugung**, während Lesen
weiterläuft. Läuft Publish nicht, aber Lesen schon: zuerst die Verbindungsart prüfen, nicht den
Code (`docs/runbooks/planning-publish.md`).

### Task 3.5: Kein Leck auf dem Weg

```bash
curl -sSI "$STAGING/" | grep -iE "x-middleware-rewrite|location|x-upstream" || echo "keine verdaechtigen Koepfe"
curl -sS "$STAGING/" | grep -c "api:3001" || true
ssh root@srv1308064.hstgr.cloud 'docker logs --tail 500 $(docker ps --filter name=easytree-web --format "{{.Names}}" | head -1)' \
  | grep -ciE "password|anon_key|service_role|eyJ" || true
```

Erwartet: keine interne Adresse im HTML (`0`), keine Secrets im Protokoll (`0`).

### Task 3.6: Screenshots als visuelle Regressionsevidenz

**Files:** Create: `docs/evidence/2026-XX-XX-eyt-142-staging/` (Datum des Laufs)

**Schritt 1:** Je Station aus 3.4 ein Screenshot bei **1440 px** und **1920 px**, benannt nach
Station und Breite.

**Schritt 2:** Eine `README.md` daneben mit: Head-SHA, Image-Digests, Staging-URL, Laufdatum,
CI-Lauf-ID. **Ein Screenshot ohne diese fünf Angaben ist ein Bild, kein Nachweis.**

**Schritt 3:** Damit schließt zugleich das letzte offene EYT-141-Kriterium (L-3 aus Phase 1).

### Task 3.7: Rollback wirklich fahren

Das Runbook beschreibt ihn seit dem 20.08.2026 und sagt selbst: „ist bislang nicht ausgeführt
worden" (`docs/runbooks/staging-deploy.md:294`). Eine Übung schlägt eine Beschreibung.

**Schritt 1:** Den Vorgänger-Digest eintragen und neu deployen.
**Schritt 2:** `/health` und `/ready` prüfen und die Revision der laufenden Container lesen —
erwartet ist der **Vorgänger**-SHA.
**Schritt 3:** Wieder vorwärts auf den aktuellen Digest, erneut prüfen.
**Schritt 4:** Beide Zeitpunkte und beide gemessenen Revisionen protokollieren.

### Task 3.8: Railway-Kompatibilität belegen

EYT-142 verlangt sie „mindestens durch reproduzierbaren Container-/Startpfad". Heute ist sie
**nicht gemessen** (`docs/runbooks/staging-deploy.md:364`), und unter
`easytree-production.up.railway.app` antwortet seit dem 23.08.2026 Railways Edge-404 — das ist die
Plattform, nicht die Anwendung.

**Kleinster ehrlicher Beleg (empfohlen):** dasselbe `easytree-api`-Image aus GHCR in einem
Railway-Dienst starten, `PORT`/`API_PORT` setzen, `/health` und `/ready` abfragen, Ergebnis
protokollieren, Dienst wieder entfernen.

**Wenn der PO das nicht freigibt:** die Aussage auf das reduzieren, was belegt ist — „dieselben
Dockerfiles, derselbe Startbefehl, keine providergebundene Logik" — und **ausdrücklich
dazuschreiben, dass ein Railway-Deploy nicht ausgeführt wurde**. Keine Behauptung ohne Messung.

### Task 3.9: Abnahme dokumentieren

**Schritt 1:** Jedes der zehn EYT-142-Kriterien wörtlich mit einem Beleg versehen: Head-SHA,
Image-Digests, Staging-URL, CI-Lauf-ID, E2E-Lauf, Screenshotpfad, Rollbackprotokoll.

**Schritt 2:** Evidenzstufe je Aussage benennen (ausgeführter CI-Lauf > lokaler Lauf >
Subagent-Bericht > Plan). Eine Aussage ohne ihren Befehl ist kein Ergebnis.

**Schritt 3:** Als Jira-Kommentar an EYT-142 — **verfassen, neu lesen, dann senden**. Entwürfe
sind in Jira dauerhaft sichtbar.

---

# PHASE 4 — EYT-126 formal schließen

Der Code liegt seit PR #89 auf `master`; offen sind nur Belege, die Phase 3 erzeugt.

### Task 4.1: Runbook von „nie ausgeführt" auf „ausgeführt am" umschreiben

**Files:** Modify: `docs/runbooks/staging-deploy.md` (§7.1 bei `:294`, §10 bei `:364`, §11 bei `:381`)

**Schritt 1:** Drei Ehrlichkeitsmarker durch die Messung ersetzen — je mit Datum, Head-SHA und
Digest. Wo nichts gemessen wurde (etwa Railway nach Task 3.8, Variante zwei), bleibt der Marker
**stehen**. Ein Runbook, das mehr behauptet als gefahren wurde, ist schlechter als eines, das
seine Lücke nennt.

**Schritt 2:** Gegenprüfen, dass keine widersprechende Formulierung stehen bleibt:

```bash
grep -niE "nie ausgef|nicht ausgef|ungemessen" docs/runbooks/staging-deploy.md
```

Jeder verbliebene Treffer muss einer sein, den man **absichtlich** stehen lässt. Abgeschwächte
Absolutaussagen überleben sonst in Zusammenfassungs- und Empfehlungsabschnitten.

### Task 4.2: Die neun EYT-126-Kriterien abhaken und den Task schließen

Sieben davon sind bereits durch `smoke-container.sh` in `db-gates` belegt; die zwei übrigen
(„Staging-Deploy reproduzierbar und an Commit/Image gebunden", „Rollback dokumentiert **und**
reproduzierbar") kommen aus Task 3.2 und 3.7.

---

# PHASE 5 — EYT-149: Cloudflare-Runtimepfade entfernen

**Voraussetzung laut Ticket:** EYT-142 weist Containerbetrieb nach, Railway-Kompatibilität ist
belegt. **Vorher nicht anfangen** — ein rückabgewickelter Cloudflare-Pfad wäre sonst der einzige
Deployweg, den man noch hätte.

### Task 5.1: Inventarisieren, bevor gelöscht wird

```bash
git ls-files | grep -iE "wrangler|open-next|opennext|cloudflare"
grep -rn "build:cf\|cf:dry-run\|opennextjs" .github/workflows/ apps/web/package.json apps/api/package.json turbo.json
```

**Die eine Falle, die hier alles kostet:** `apps/api/src/worker.ts` und
`apps/api/test/worker.test.ts` sind **NICHT** Cloudflare. Das ist der Outbox-Worker, der
denselben `AppModule` über `createApplicationContext` bootet (ADR-001 §2), und
`docker-compose`/Railway starten ihn als `node dist/worker.js`. Cloudflare sind nur
`apps/api/cloudflare/entry.mjs`, `apps/api/cloudflare/nest-optional-stub.mjs`,
`apps/api/wrangler.jsonc`, `apps/web/wrangler.jsonc` und `apps/web/open-next.config.ts`.
Wer `worker.ts` mitnimmt, löscht den Worker.

### Task 5.2: Den Cloudflare-Schritt aus `build-web` herausnehmen

**Files:** Modify: `.github/workflows/ci.yml:66-110`

**Schritt 1:** Den Schritt „Cloudflare Web-Worker buendelbar + Groesse (EYT-142)" ersatzlos
entfernen. Der Job behält `pnpm --filter @easytree/web... build` und bleibt Pflichtcheck — die
Jobliste ändert sich **nicht**, also bleiben beide Branch-Protection-Listen unangetastet.

**Schritt 2:** Der Kommentarkopf des Jobs erklärt, warum `EASYTREE_API_PROXY_TARGET` dort fehlt.
Dieser Kommentar bleibt: er ist die dauerhafte Gegenprobe für EYT-126 und hat mit Cloudflare
nichts zu tun.

**Schritt 3:**

```bash
bash scripts/verify-branch-protection.sh
```

Erwartet: `=== Ergebnis: 0 offen`.

### Task 5.3: Dateien und Abhängigkeiten entfernen

**Schritt 1:**

```bash
git rm apps/web/open-next.config.ts apps/web/wrangler.jsonc \
       apps/api/wrangler.jsonc apps/api/cloudflare/entry.mjs apps/api/cloudflare/nest-optional-stub.mjs
```

**Schritt 2:** Die Skripte `build:cf` und `cf:dry-run` aus `apps/web/package.json` streichen,
`@opennextjs/cloudflare` und `wrangler` aus den `devDependencies` entfernen.

**Schritt 3:**

```bash
pnpm install --frozen-lockfile 2>&1 | tail -5
```

Schlägt das fehl, weil die Lockfile nicht mehr passt: `pnpm install` (ohne `--frozen-lockfile`),
dann die geänderte `pnpm-lock.yaml` mit committen.

**Schritt 4:** Baumscannende Wächter prüfen — `.open-next/` und `.wrangler*/` sind
generierter Buildoutput und an **vier** Stellen ausgeschlossen. Nach dem Entfernen der Erzeuger
dürfen die Ausschlüsse bleiben (sie schaden nicht), aber die Wächter müssen grün sein:

```bash
rm -rf apps/web/.open-next apps/web/.wrangler-dry
pnpm exec turbo run test --force
```

Erwartet: `Cached: 0 cached` und `Tasks: N successful`.

### Task 5.4: Volles Gate und Dokumentation

**Schritt 1:**

```bash
env -u EASYTREE_API_PROXY_TARGET pnpm build
pnpm exec turbo run lint --force
pnpm exec turbo run typecheck --force
pnpm exec turbo run test --force
git ls-files -z | xargs -0 pnpm exec prettier --ignore-unknown --check
```

**Schritt 2:** Dokumentation nachziehen — CLAUDE.md (Abschnitt „Deployment", der die beiden
Cloudflare-Sackgassen beschreibt) und `docs/runbooks/staging-deploy.md`. Die **Begründung**, warum
Next-16-`proxy.ts` und Edge-Middleware ausschieden, bleibt stehen: sie erklärt, warum der Proxy in
Route Handlern liegt, und das gilt weiter.

**Schritt 3:** Gegenprüfen, dass keine Cloudflare-Runtime mehr als aktiver Zielpfad dasteht:

```bash
grep -rniE "cloudflare|wrangler|opennext" CLAUDE.md docs/runbooks/ .github/workflows/ | grep -viE "sackgasse|kein zielruntime|historie|frueher|entfernt"
```

Erwartet: leer, oder nur Treffer, die die Vergangenheitsform tragen.

**Schritt 4: PR und CI**

```bash
git push
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$(git rev-parse HEAD)" 3600
```

Erwartet: alle elf Pflichtchecks grün. Das ist der Beweis, dass die Entfernung nichts Lebendes
getroffen hat.

---

## Definition of Done für Sprint 6

| Ticket  | Fertig, wenn                                                 |
| ------- | ------------------------------------------------------------ |
| EYT-141 | Task 1.1–1.3 grün **und** Screenshots aus 3.6 liegen vor     |
| EYT-126 | Task 4.1–4.2; alle neun Kriterien mit Befehl belegt          |
| EYT-142 | Task 3.1–3.9; Kernreise auf Staging gefahren, Rollback geübt |
| EYT-149 | Task 5.1–5.4; elf Pflichtchecks grün ohne Cloudflare         |
| EYT-137 | schließt, wenn 141 und 142 geschlossen sind                  |

**Ein Ticket gilt nicht als fertig, weil ein Plan es vorsah.** Vor jedem Schließen: die
Akzeptanzkriterien wörtlich aus Jira gegen ein Artefakt halten und die Deliverables greppen —
`offen|TODO|TOOL_GAP|FIXME`, ein Treffer ist ein Blocker.

---

## Risiken — benannt, mit Ausweichweg

| #       | Risiko                                                                                | Falsifizierung                            | Ausweichweg                                                                                  |
| ------- | ------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| **R-1** | Phase 0 fällt gar nicht (PO entscheidet nicht)                                        | Kalendertag ohne Entscheidung             | Phase 1, 2 laufen weiter; Sprintziel wird als **teilerreicht** berichtet, nicht als erreicht |
| **R-2** | VPS-Platte (22 GB frei) läuft mit Images voll                                         | `df -h /` vor jedem Deploy                | `docker image prune` vor dem Deploy; nur zwei Digests je Workload vorhalten                  |
| **R-3** | Transaktionspooler bricht Publish/Snapshot auf Staging                                | Lesen grün, Publish 42501                 | Direktverbindung statt Pooler in `DATABASE_URL`; siehe `docs/runbooks/planning-publish.md`   |
| **R-4** | `psql` erreicht die Staging-Datenbank vom Mac aus nicht (direkter Host ist IPv6-only) | Task 3.4 Weg B Schritt 1                  | Pooler-URL (IPv4) benutzen, sonst die Fixtures vom VPS aus einspielen                        |
| **R-5** | GHCR-Push braucht ein Recht, das `GITHUB_TOKEN` nicht hat                             | Task 2.1 Schritt 5                        | Paketsichtbarkeit im Repo prüfen; notfalls PAT als Secret, aber nie im Klartext              |
| **R-7** | Weitere Deploy-Dateien entstehen später und fallen wieder aus `CONTAINER_DATEIEN`     | Task 2.3 Schritt 4 als Muster wiederholen | Beim Anlegen jeder neuen Deploy-Datei die Liste **und** die Längenzusicherung mitziehen      |
| **R-6** | Cloudflare-Entfernung reißt einen Wächter mit                                         | Task 5.4 Schritt 1                        | Commit zurücknehmen; EYT-149 ist kein Sprintziel und darf rutschen                           |

---

## Was dieser Plan bewusst **nicht** tut

- **Kein EYT-72** (Inspector, Matrix, Zeitachse, Ressourcen-/Mitarbeitendenansicht). Nicht
  `sprint-6-commit`, und die Kernreise braucht es nicht.
- **Kein EYT-80** in voller Breite. EYT-141 zieht ausdrücklich nur die Bausteine, die die Reise
  benutzt.
- **Keine neuen Domainregeln, kein neuer Planungswahrheitspfad.** Die Reise existiert; sie wird
  bereitgestellt, nicht neu erfunden.
- **Kein Produktionsdeploy, keine Produktivdaten, keine destruktive Migration.**
- **Kein Kubernetes, kein Supabase-Self-Hosting, keine neuen Microservices.**

---

## Plausibilitätsprüfung dieses Plans — was geprüft wurde und was sich dabei änderte

Der Plan wurde nach dem Schreiben gegen die Dateien gefahren, die er anfasst. Drei Aussagen waren
falsch und stehen jetzt korrigiert im Text. Sie stehen hier, weil ein Plan, der seine eigenen
Korrekturen verschweigt, beim nächsten Lesen wieder dieselbe Annahme erzeugt.

| #       | Falsche Annahme im ersten Entwurf                                                                      | Messung                                                                                                                                                                     | Folge im Plan                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **P-1** | Task 1.1 benutzte einen Test-Helfer `nurSnapshotGateway()`                                             | `grep` in `kosten-ansicht.test.tsx`: es gibt `baue()` und `zeige(antworten, snapshotId)`                                                                                    | Testcode auf `zeige({}, SNAPSHOT_ID)` umgeschrieben                                                             |
| **P-2** | Die lokale Generalprobe fährt `smoke-container.sh` im Modus `required` gegen ein nacktes `postgres:17` | Skriptkopf `:41-44` verlangt vier Größen, darunter GoTrue-URL und Anon-Key; dieser Mac startet den Supabase-Stack nicht                                                     | Probe auf Digest, Start und Fail-closed-Gegenprobe verengt; `required` bleibt ausdrücklich Sache von `db-gates` |
| **P-3** | Die `auth-journey`-Suite lässt sich per `baseURL` auf Staging richten                                  | `config.ts:81-138` verdrahtet zwei eigene Server, `baseURL = http://127.0.0.1:3100`, `NODE_ENV: "test"`, und `globalSetup` fährt `psql` gegen eine privilegierte Verbindung | Task 3.4 in Weg A (eigene Konfiguration, Folgearbeit) und Weg B (geführte Browserreise, empfohlen) geteilt      |

**Was zusätzlich gemessen und nicht bloß angenommen wurde:** der offene Sprint-Inhalt (Jira JQL),
`origin/master` = `3ce222a` mit dem lokalen Branch darin enthalten, der lebende Blocker
(`list_projects` / `list_branches`, 23.08.2026), Coolify 4.3.10 auf dem VPS samt freiem Platz und
RAM (SSH), das Fehlen jedes Registry-Pushs in `ci.yml` (`grep`), der Cloudflare-Schritt im
Pflichtcheck `build-web` (`ci.yml:66-110`), und dass **beide** Branch-Protection-Skripte
ausschließlich `ci.yml` lesen (`:26` bzw. `:61`) — worauf die Entscheidung für eine eigene
Workflow-Datei beruht.

**Was ausdrücklich ungemessen bleibt und deshalb nirgends behauptet wird:** ob ein Serverbuild auf
dem VPS am RAM scheitert (der Plan umgeht die Frage, statt sie zu beantworten); ob `psql` die
Staging-Datenbank vom Mac aus erreicht; wie viele Migrationen auf der gehosteten Produktion
liegen; ob im Railway-Projekt noch ein Dienst existiert.

---

## Bericht: warum der Plan so geschnitten ist

**Der Sprint ist fachlich fertig und operativ blockiert — der Plan folgt genau dieser Trennung.**
Auf `origin/master` liegen reale Planning-Reads, ein autorisierter Assignment-Write, der
Publish-Command und der Kosten-Snapshot; `auth-journey` fährt die Reise heute schon mit echter
GoTrue-Session, zweitem Browserkontext, Negativfällen und axe bei drei Breiten. Was zwischen
diesem Stand und dem Sprintziel steht, ist **Bereitstellung**. Ein Plan, der hier noch Fachbreite
plant, würde das Ziel breiter verfehlen statt früher erreichen — deshalb bleiben EYT-72, EYT-80
und EYT-53 draußen, obwohl sie das Label `sprint-6-enabler-source` tragen.

**Die eine Entscheidung, die niemand außer dem Product Owner treffen kann, steht ganz vorn.**
`BLOCKER_ENVIRONMENT_SEPARATION` ist keine Aufgabe, sondern eine Kostenfrage: die
Supabase-Free-Quota zählt pro Nutzer, `DYAI2025` hat sie ausgeschöpft, und pausierte Projekte
zählen nicht mit — „Bazodiac" zu löschen hilft nachweislich nicht. Phase 0 ist deshalb bewusst
codelos und liefert vier Optionen mit Preisschild statt einer Empfehlung ohne Alternative. Sie
steht zuerst, weil ihre Durchlaufzeit unabhängig von der Codearbeit ist; sie blockiert aber
**nur** Phase 3. Phase 1 und 2 laufen weiter, während sie offen ist. Fiele die Entscheidung gar
nicht, wäre das Ergebnis „teilerreicht mit benanntem Blocker" — und nicht ein Sprint, in dem
niemand etwas getan hat.

**Phase 2 existiert wegen einer Messung, nicht wegen einer Vorliebe.** Der VPS hat 2,6 GB
verfügbaren RAM und 22 GB Platte neben sechs fremden Workloads. Coolify baut per Vorgabe auf dem
Server. Ob ein Next-16- plus ein NestJS-Build dort fällt, ist ungemessen — aber die Frage muss gar
nicht beantwortet werden: der Bau in CI mit Push nach GHCR erfüllt zugleich ein
EYT-126-Kriterium schärfer, als ein Serverbuild es je könnte. „Deploy an exakten Commit/Image-Stand
gebunden" ist ein Digest; ein Build aus einem Branch ist es nicht. Dass die Images unter einem
eigenen Workflow und nicht in `ci.yml` entstehen, ist kein Stilentscheid: beide
Branch-Protection-Skripte brechen mit einem Driftfehler ab, sobald in `ci.yml` ein Job steht, der
nicht Pflichtcheck ist — und ein Imagepush gehört nicht in diese Liste.

**Phase 1 ist klein, weil EYT-141 fast fertig ist.** Zwei benannte Lücken bleiben: die
Kosten-Herkunft steht über den Zahlen statt darunter (die Akzeptanz verlangt wörtlich das
Gegenteil), und axe fährt im echten Browser nur gegen `/`, obwohl die Route-Liste `/planung` und
`/kosten` bereits kennt. Beide sind einzeln, testgetrieben und mit ausgeführter Gegenmutation
belegbar. Das dritte Kriterium — reale Staging-Screenshots — kann Phase 1 **nicht** schließen; es
steht als Task 3.6 dort, wo es hingehört, statt als grüner Haken auf einer Behauptung.

**Phase 3 ist der Sprintgate, und sein größter Einzelposten ist eine Korrektur.** Der erste
Entwurf wollte die vorhandene `auth-journey`-Suite auf Staging umbiegen. Das geht nicht: die
Konfiguration startet zwei eigene Server, verdrahtet `baseURL` auf localhost, läuft mit
`NODE_ENV=test` und fährt `psql` gegen eine privilegierte Verbindung. Statt die Suite aufzuweichen
— was den teuersten und ehrlichsten CI-Job beschädigen würde — trennt der Plan zwei Wege und
empfiehlt den kleineren: eine geführte Browserreise mit Screenshots und serverseitig geprüften IDs.
Das ist genau das, was die EYT-142-Kriterien wörtlich verlangen. Die automatisierte
Staging-Variante bleibt als Weg A benannt, aber außerhalb des Sprintziels.

**Rollback und Railway stehen als eigene Tasks, weil beide heute Behauptungen sind.** Das Runbook
beschreibt den Rollback seit dem 20.08.2026 und sagt an derselben Stelle, dass er nie gefahren
wurde; für Railway steht dort „nicht gemessen", und die Domain antwortet seit dem 23.08.2026 mit
Railways Edge-404. Eine geübte Rückwärtsbewegung schlägt eine beschriebene. Wo der PO den
Railway-Beleg nicht freigibt, reduziert der Plan die Aussage auf das Belegte und schreibt
ausdrücklich dazu, was nicht gefahren wurde — statt die Lücke im Runbook verschwinden zu lassen.

**EYT-149 steht zuletzt und ist bewusst opferbar.** Cloudflare kostet heute nichts außer Bauzeit;
`build-web` ist grün. Würde man den Pfad vor einem bewiesenen Containerbetrieb entfernen, hätte
man im Fehlerfall gar keinen Deployweg mehr. Der Plan benennt an dieser Stelle die eine Falle, die
teuer wäre: `apps/api/src/worker.ts` heißt „worker", ist aber der Outbox-Worker aus ADR-001 §2 und
hat mit Cloudflare nichts zu tun. Wer ihn mit aufräumt, löscht den zweiten Prozessmodus.

**Was den Plan widerlegen würde.** Wenn Phase 0 ergibt, dass keine der vier Optionen tragbar ist,
ist die Prämisse „Staging in Sprint 6" falsch, und die richtige Konsequenz ist eine
Scope-Entscheidung des PO — nicht ein Deploy gegen die Produktionsgrenze. Wenn der GHCR-Push an
einem Recht scheitert, das `GITHUB_TOKEN` nicht hat, fällt Phase 2 auf einen Serverbuild zurück und
das RAM-Risiko wird real statt umgangen. Und wenn Weg B die Reise auf Staging nicht durchfährt, ist
die Ursache mit hoher Wahrscheinlichkeit **nicht** die Oberfläche, sondern der Transaktionspooler:
er macht `session_user` zu `postgres.<tenant>` und bricht damit Publish und Snapshot-Erzeugung,
während Lesen weiterläuft. Dieser Fall ist im Plan als R-3 benannt, damit niemand ihn für einen
Frontend-Fehler hält.
