# EYT-113 Finalisierung — Shell-Grenzen reviewfähig abschließen

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **DIESER PLAN WIRD NICHT COMMITTET.** Er ist ein temporäres Arbeitsmittel
> (`DIRECT_EXECUTION`-Regel: ein committeter Ausführungsplan im Slice ist ein eigener
> Reviewbefund). Er liegt bewusst untracked in `docs/plans/` des Haupt-Worktrees.

**Goal:** EYT-113 auf einen unabhängig prüfbaren Done-Kandidaten bringen: AC-Truth-Matrix
gegen den realen `origin/master`, die drei echten `GAP_IN_SCOPE`-Punkte schließen
(Werkbank-1440/1920-Browserevidenz, kanonische `eyt113-*`-Screenshots, kanonische
Repository-Doku der Shell-Grenzen), genau ein PR, grüne CI auf dem exakten PR-Head,
Jira-Evidenzkommentar ohne Done-Transition.

**Architecture:** Keine Produktlogik-Änderung. Die beiden Shells, alle Gates, alle
Architekturregeln und alle Journeys existieren bereits auf `origin/master` (PR #97 + #99).
Dieses Increment ergänzt ausschließlich (a) Evidenz-Steps in der bestehenden
Auth-Journey, (b) Screenshot-Namen, (c) ein Architektur-Dokument. Kein zweiter
E2E-Harness, keine neuen API-Endpunkte, keine Migrationen.

**Tech Stack:** Next.js 16 App Router, Playwright (`e2e/auth-journey/config.ts`,
realer GoTrue + reale API + Supabase/RLS), axe-core, vitest, pnpm 10.28.0 / Node 22.

---

## Start Truth (Discovery 30.08.2026, live gemessen)

| Fakt | Wert |
| --- | --- |
| `origin/master` | `088368219a25c756a5800b660cb22a87fc9e7db3` (= Merge PR #99) |
| Offene PRs | 0 |
| Jira EYT-113 | `In Arbeit`, Resolution leer (live gelesen 30.08.) |
| Sprint-579-WIP | exakt `{EYT-113}` (JQL live) |
| Worktree | `/Users/benjaminpoersch/EasyTree-wt/eyt113-finalize` @ `0883682` (detached, node_modules leer) |
| Lokaler `master` | `092ada2` — **veraltet, nie benutzen**; immer `origin/master` |
| Confluence 8486960 + 8814623 | live gelesen; Baselines werden NICHT verändert |
| `.claude/rules/sprint-7-ui-ux-acceptance.md` | gelesen; Wächter `apps/api/test/sprint7-acceptance-rule-guardrails.test.ts` bleibt unberührt |

**Branch:** `feat/eyt-113-finalize-shell-boundaries` (aus `origin/master`).

---

## AC-Truth-Matrix (Vorbefund — Executor verifiziert jeden Anker live vor Task 2)

Anker relativ zur Worktree-Wurzel. „Journey" = `apps/web/e2e/auth-journey/journey.pwtest.ts`.

| # | AC | Status | Anker |
| --- | --- | --- | --- |
| 1 | Getrennte Layout-/Nav-/Featuregrenzen | **PASS_ALREADY** | `apps/web/app/(werkbank)/layout.tsx:11` vs `apps/web/app/feld/layout.tsx:23`; Feld-Shell ohne `navigation`-Prop (`components/feld/feld-shell.tsx:57-68`); `apps/web/test/feld-shell.test.tsx:89` (keine `/planung`-/`/kosten`-Links) |
| 2 | Admin 1440/1920, Employee 320/375 | **GAP_IN_SCOPE (nur Admin-Hälfte)** | Employee: Journey Test 3 `:3436` (320/375, axe, Reflow, 40 px) — PASS. Admin: **kein Test setzt 1440×900/1920×1080 auf der Werkbank-Shell**, keine Overflow-/Fokus-/axe-Messung dort, keine Screenshots → Task 2 |
| 3 | Versionierte Verträge / vertragsabgeleiteter Client | **PASS_ALREADY** | `packages/contracts/openapi/v1.json` + `apps/web/test/api-base-path.test.ts:26-82`; eine Composition Root `app/providers.tsx:36` für beide Shells |
| 4 | `packages/ui` domänenfrei | **PASS_ALREADY** | Regel `ui-dependency-allowlist` (`apps/api/test/architecture/rules.ts:381`), Scope-Gleichheits-Assertion `architecture.test.ts:114`, Red-Case `architecture-red-case.test.ts:237` |
| 5 | Admin-Code nicht ins Employee-Bundle; Gegenprobe rot | **PASS_ALREADY** | Regel `feld-shell-boundary` (`rules.ts:402`, Scope `rules.ts:157-181`), Red-Case `architecture-red-case.test.ts:102` (läuft in jedem CI-Lauf), unabhängige Verzeichnis-Gegenzählung `architecture.test.ts:154` |
| 6 | Employee-Routen: keine Admin-/Kosten-/Org-Daten per Routing | **PASS_ALREADY** | Journey Test 3 `:3453` (`planung-forbidden`, API-403), Test 2 `:3151` (B ausgesperrt), Server-Gates `app/feld/layout.tsx:27-41` |
| 7 | Kosten nur mit verifiziertem `costs.read` | **PASS_ALREADY** | `lib/kosten-freigabe.ts:26` (kein Any-Org-Fallback: Test `kosten-freigabe.test.ts:79`), Regel `kosten-server-gate` (`rules.ts:477`), Journey 3b `:981` (Chunks positiv), `:3479` (Chunks negativ), 9g2 `:2300`, Test 5 a–h `:3614` |
| 8 | Rolle/Start-Shell aus verifizierter Session | **PASS_ALREADY** | `lib/sitzung-server.ts:26` (drei Zustände, fail-closed auf Inhalt), `lib/feld/start-shell.ts:21`, Tests `sitzung-server.test.ts`, `start-shell.test.ts`, Journey Test 4 `:3562` |
| 9 | Gemeinsame Zustandsverträge, soweit real | **PASS_ALREADY + Doku-Lücke** | Loading/Empty/Error/StateBanner in `packages/ui`; Forbidden/Unauthenticated daraus komponiert (`kosten-grenze.tsx`, `feld-start.tsx:46,63,83`); Stale nur als `STALE_VERSION`-Domänenzustand (`planning-window-view.tsx:83-90` u. a.); **Offline-read-only bewusst nicht implementiert** (`app/manifest.ts:8-10`, `next.config.ts:10-12`, `start-inhalt.tsx:27`) → Nichtanwendbarkeit in Task 4 dokumentieren, KEIN Fake-Offline bauen |
| 10 | Grenzen dokumentiert und CI-geprüft | **GAP_IN_SCOPE (nur Doku-Hälfte)** | CI-geprüft: ja (Regeln oben + Chunk-Guards `shell-smoke.spec.ts:551-604`, Journey `:430,:981,:3479`). Dokumentiert: **nein** — kein Dokument unter `docs/` erwähnt EYT-113/Feld-Shell/Zwei-Client → Task 4 |
| 11 | Playwright-Einstiegs- + Negativreisen | **PASS_ALREADY** | Journey Test 1 `:902` (Admin), Test 3 `:3372` (Employee + Cross-Shell), Test 2, Test 4, Test 5; alle in Pflichtjob `auth-journey` |
| 12 | Reales Basisdesign v2.0, keine Fake-Shell | **PASS_ALREADY (Evidenz-Ergänzung via Task 2)** | Tokens: `basisdesign-tokens.test.ts` (web + ui), Farb-Checks `shell-smoke.spec.ts:466`; ehrliche Empty-States statt Fake (`feld-keine-ansichten`); „keine sichtbaren Layoutabbrüche bei 1440/1920" wird erst durch Task 2 belegt |
| 13 | Physische Trennung = Kriterienentscheidung; keine zwei Backends | **PASS_ALREADY + Doku-Lücke** | Ein Backend, eine Domainbasis (ADR-001); Kriterienkatalog existiert NUR in Confluence 8486960 §2 → in Task 4 ins Repo spiegeln (zitierend, nicht überschreibend) |

**Kein AC ist `BLOCKED_CROSS_TICKET` oder `SOURCE_NEEDED`.** Employee-Fachflächen
(Heute/Woche/56-px-Hauptaktionen) sind EYT-81 und werden NICHT angefasst — die Feld-Shell
zeigt bereits den ehrlichen `feld-keine-ansichten`-Zustand.

---

## Task 1: Worktree-Setup + Anker-Verifikation

**Files:** keine Änderungen — nur Setup + Messung.

**Step 1: Branch anlegen**

```bash
cd /Users/benjaminpoersch/EasyTree-wt/eyt113-finalize
git fetch origin
git rev-parse origin/master          # MUSS 0883682... sein; sonst STOP: master bewegt
git switch -c feat/eyt-113-finalize-shell-boundaries origin/master
```

**Step 2: Install + Browser**

```bash
pnpm install --frozen-lockfile
pnpm --filter @easytree/web exec playwright install chromium
```

**Step 3: Anker-Verifikation der Matrix (jede Zeile eine Messung, kein Vertrauen in diesen Plan)**

```bash
grep -n "feld-shell-boundary\|kosten-server-gate\|ui-dependency-allowlist" apps/api/test/architecture/rules.ts | head
grep -n "7 — Screenshot der angemeldeten AppShell" apps/web/e2e/auth-journey/journey.pwtest.ts
grep -n "04-feld-shell-320\|05-feld-shell-375" apps/web/e2e/auth-journey/journey.pwtest.ts
grep -rn "feld-shell-320" --include="*.md" --include="*.ts" --include="*.tsx" . | grep -v node_modules
grep -rn "EYT-113\|Feld-Shell\|Zwei-Client" docs/ | grep -v node_modules | head
```

Erwartung: Regeln vorhanden; Step-7-Anker gefunden; Screenshot-Namen nur in der
Journey selbst referenziert (sonst Task 3 = „zusätzlich benennen" statt „umbenennen");
`docs/` ohne Shell-Doku (bestätigt Task 4). Abweichung ⇒ Matrix-Zeile korrigieren,
bei Widerspruch zu einem AC ⇒ STOP `BLOCKED_SCOPE`.

**Step 4: Baseline grün messen (Turbo-Cache ist wertlos als Evidenz, auch über Worktrees)**

```bash
pnpm exec turbo run test --force 2>&1 | tail -5
```

Erwartung: `Cached: 0 cached` und alle Tasks successful. Rot auf sauberem
`origin/master` ⇒ STOP und berichten (nicht reparieren, das wäre fremder Scope).

---

## Task 2: Werkbank-Viewport-Evidenz 1440/1920 in der Auth-Journey (schließt AC 2/12)

**Files:**

- Modify: `apps/web/e2e/auth-journey/journey.pwtest.ts` (Test 1, nach Step
  `7 — Screenshot der angemeldeten AppShell`, ~Zeile 1000–1100 — per grep finden)

**Vorgehen:** Evidenz-Test, keine Verhaltensänderung ⇒ kein künstlicher Produktfehler
nötig (TDD-Ausnahme laut Auftrag). ABER: die neue Overflow-Zusicherung ist eine
Property und bekommt in Task 5 eine AUSGEFÜHRTE Gegenmutation.

**Step 1: Bestehende Muster exakt lesen (nicht raten)**

```bash
grep -n "axe\|AxeBuilder" apps/web/e2e/auth-journey/journey.pwtest.ts | head -20
grep -n "scrollWidth" apps/web/e2e/shell-smoke.spec.ts
grep -n "01-angemeldete-appshell" apps/web/e2e/auth-journey/journey.pwtest.ts
```

Die neuen Steps MÜSSEN denselben axe-Aufrufstil wie Step `9c1`/Test 3, dieselbe
Overflow-Messung wie `shell-smoke.spec.ts:87-95` (`scrollWidth - clientWidth <= 0`)
und denselben Screenshot-Pfadmechanismus wie `01-angemeldete-appshell.png`
(ARTEFAKTE-Wurzel) verwenden. Fokus-Sichtbarkeit: exakt die Technik der
shell-smoke-Fokustests kopieren (KEINE numerische `outline-width`-Prüfung erfinden —
`auto` bricht Zahlenvergleiche, gemessene Falle).

**Step 2: Neue Steps einfügen** (Gerüst — Bezeichner an die in Step 1 gelesenen
Helfer anpassen; Kommentare/Strings deutsch wie die Umgebung):

```ts
await test.step("7b — EYT-113 Werkbank-Shell bei 1440x900 und 1920x1080", async () => {
  const ausgangsViewport = page.viewportSize();
  const werkbankViewports = [
    { breite: 1440, hoehe: 900, bild: "eyt113-werkbank-1440.png" },
    { breite: 1920, hoehe: 1080, bild: "eyt113-werkbank-1920.png" },
  ] as const;
  await page.goto("/");
  for (const vp of werkbankViewports) {
    await page.setViewportSize({ width: vp.breite, height: vp.hoehe });
    // Shell vollständig da: Navigation, Organisation, Abmelden
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByRole("link", { name: "Planung" })).toBeVisible();
    // Owner der Reiseorganisation trägt costs.read → Kosten-Navigation MUSS sichtbar sein
    await expect(page.getByRole("link", { name: "Kosten" })).toBeVisible();
    // Organisation/Session korrekt (Name aus fixtures.sql)
    await expect(page.getByText("E2E Reiseorganisation")).toBeVisible();
    // Kein unkontrolliertes horizontales Seitenscrolling
    const ueberlauf = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(ueberlauf, `horizontaler Überlauf bei ${vp.breite}px`).toBeLessThanOrEqual(0);
    // Sichtbarer Fokus: Technik aus shell-smoke übernehmen (Tab → Skip-Link → Outline)
    // axe WCAG A/AA: denselben Aufruf wie Step 9c1 verwenden, 0 Violations
    await page.screenshot({ path: join(ARTEFAKTE, vp.bild), fullPage: true });
  }
  if (ausgangsViewport) await page.setViewportSize(ausgangsViewport);
});
```

Pflichtdetails: Viewport am Ende **zurücksetzen** (Folgesteps 8+ messen im
Default-Viewport); `join`/`ARTEFAKTE` so importieren/nutzen wie die bestehenden
benannten Screenshots; axe- und Fokus-Blöcke aus den existierenden Steps
übernehmen statt neu erfinden.

**Step 3: Lokaler Lauf (realer Stack unter colima — Ablauf aus Memory + `ci.yml:710-800`)**

```bash
colima start 2>/dev/null; cd /Users/benjaminpoersch/EasyTree-wt/eyt113-finalize
pnpm exec supabase start -x vector -x logflare
pnpm exec supabase db reset
# Rollenpasswort wie CI setzen, Koordinaten aus `pnpm exec supabase status -o env` ableiten:
#   EASYTREE_JOURNEY_SUPABASE_URL, EASYTREE_JOURNEY_ANON_KEY,
#   EASYTREE_JOURNEY_DATABASE_URL (easytree_app), EASYTREE_JOURNEY_ADMIN_DB_URL (postgres)
# psql: /opt/homebrew/opt/postgresql@17/bin
pnpm --filter @easytree/api... build && pnpm --filter @easytree/web... build
EASYTREE_JOURNEY_... pnpm --filter @easytree/web exec playwright test \
  -c e2e/auth-journey/config.ts --grep "Reale Auth-Kostenreise"
```

Erwartung: `1 passed`; danach:

```bash
ls apps/web/test-results/auth-journey/eyt113-werkbank-1440.png \
   apps/web/test-results/auth-journey/eyt113-werkbank-1920.png
```

Beide Dateien existieren (Journey-Konvention: benannte Screenshots existieren auch
bei grünem Lauf). Kein `pnpm test` parallel zum Playwright-Lauf (zwei vitest-Prozesse
verderben beide Läufe — gemessene Falle).

**Step 4: Vollständige Journey lokal grün**

```bash
EASYTREE_JOURNEY_... pnpm --filter @easytree/web exec playwright test -c e2e/auth-journey/config.ts
```

Erwartung: `5 passed` (alle fünf Top-Level-Tests), Dateizahl im Report lesen, nicht
nur Exit-Code.

**Step 5: Commit**

```bash
git add apps/web/e2e/auth-journey/journey.pwtest.ts
git diff --cached --name-only    # MUSS genau diese eine Datei zeigen
git commit -m "test(web): EYT-113 Werkbank-Viewport-Nachweise 1440/1920 in der Auth-Journey"
```

---

## Task 3: Kanonische Feld-Screenshot-Namen `eyt113-feld-320/375`

**Files:**

- Modify: `apps/web/e2e/auth-journey/journey.pwtest.ts` (Test 3, 320/375-Step ~`:3436`)

**Step 1: Entscheidung per Messung aus Task 1 Step 3.** Wenn
`04-feld-shell-320.png`/`05-feld-shell-375.png` nur in der Journey selbst
vorkommen ⇒ **umbenennen** in `eyt113-feld-320.png`/`eyt113-feld-375.png`.
Sonst ⇒ zusätzliche Screenshots unter den `eyt113-*`-Namen ergänzen, alte behalten.

**Step 2: Lauf des betroffenen Tests**

```bash
EASYTREE_JOURNEY_... pnpm --filter @easytree/web exec playwright test \
  -c e2e/auth-journey/config.ts --grep "ein member erreicht die Feld-Shell"
ls apps/web/test-results/auth-journey/ | grep eyt113-feld
```

Erwartung: `eyt113-feld-320.png` und `eyt113-feld-375.png` vorhanden.

**Step 3: Commit**

```bash
git add apps/web/e2e/auth-journey/journey.pwtest.ts
git commit -m "test(web): EYT-113 Feld-Screenshots unter kanonischem eyt113-Namen"
```

---

## Task 4: Kanonische Repository-Doku der Shell-Grenzen (schließt AC 10, 9- und 13-Doku)

**Files:**

- Create: `docs/architecture/zwei-client-shells.md`

**Step 1: Dokument schreiben.** Deutsch, IST-Zustand mit Datei-Ankern, KEINE
Wunscharchitektur. Pflicht-Abschnitte:

1. **Shell-Grenzen:** `(werkbank)`-Routengruppe (`/`, `/anmelden`, `/planung`,
   `/kosten`, `/kosten/stundensaetze`) vs `/feld`; Feld-Shell ohne Navigation,
   ohne Org-Selector, ohne Footer.
2. **Routing-Grenzen:** `leseServerSitzung` (drei Zustände, fail-closed auf Inhalt),
   `startShellFuer` (Rollen → Start-Shell), Feld-Gate (`redirect /anmelden`,
   `feld-sitzung-unbekannt`), `/` → `/feld`-Redirect für member.
3. **Import-/Bundle-Grenzen:** Regel `feld-shell-boundary` (Scope + Allowlist,
   `@easytree/domain` bewusst ausgeschlossen), `ui-dependency-allowlist`,
   `kosten-server-gate`; Kosten-Chunk-Grenze via `next/dynamic` + Marker +
   Netzwerk-/HTML-Beweis (shell-smoke + Journey positiv/negativ). Tabelle
   Regel → Testdatei → Red-Case.
4. **Autorisierungsprinzip:** Route/Navigation verleiht nie Rechte; `eyt_org` ist
   Selector, nie Autorisierungsquelle; `kostenFreigabe` fünf Ausgänge, kein
   Any-Org-Fallback; serverseitige Autorisierung (API/RLS) bleibt bindend.
5. **Zustandsverträge:** gemeinsame Primitives (`LoadingState`, `EmptyState`,
   `ErrorState`, `StateBanner`) + komponierte Forbidden/Unauthenticated-Flächen;
   Stale existiert nur als `STALE_VERSION`-Domänenzustand; **Offline-read-only ist
   nicht anwendbar** — kein realer Datenvertrag/Trigger, bewusst ausgeschlossen
   (`app/manifest.ts:8-10`, `next.config.ts:10-12`); ehrlicher
   `feld-keine-ansichten`-Zustand bis EYT-81.
6. **Kriterien für spätere physische Trennung:** die vier Signale aus Confluence
   8486960 §2 wörtlich zitieren, Quelle verlinken; Feststellung: keine zwei
   Backends, keine doppelte Domainlogik (ADR-001/ADR-002 referenzieren).
7. Kopfzeile: Stand-Datum, EYT-113, Verweis auf die beiden Confluence-Baselines
   als Produkt-SSoT (dieses Dokument beschreibt den implementierten Stand, es
   ersetzt die Baselines nicht).

**Step 2: Prettier + Anker-Stichprobe**

```bash
pnpm exec prettier --check docs/architecture/zwei-client-shells.md
# jeder im Doc genannte Pfad existiert:
grep -oE '`[a-z][^`]+\.(ts|tsx|md)[^`]*`' docs/architecture/zwei-client-shells.md \
  | tr -d '\`' | cut -d: -f1 | sort -u | while read f; do [ -e "$f" ] || echo "FEHLT: $f"; done
```

Erwartung: Prettier exit 0; keine `FEHLT:`-Zeile.

**Step 3: Commit**

```bash
git add docs/architecture/zwei-client-shells.md
git commit -m "docs(EYT-113): Zwei-Client-Shell-Grenzen als Repository-Dokumentation"
```

---

## Task 5: Gegenmutation für die neue Overflow-Zusicherung (ausführen, nicht ausdenken)

**Files:** temporär `apps/web/components/app-shell.tsx` (oder `app/globals.css`) — wird
vollständig zurückgenommen.

**Step 1: Sicherungskopie statt checkout** (Gegenmutation an uncommitteter Datei hat
zweimal Arbeit gekostet; hier ist die Datei committet, trotzdem):

```bash
cp apps/web/components/app-shell.tsx /tmp/app-shell.tsx.bak
```

**Step 2: Kohärente Mutation einspielen** — ein festes 2200-px-Element in die
Werkbank-Shell (z. B. `<div style={{ width: "2200px", height: "1px" }} />` im
Shell-Markup), Web neu bauen, nur Test 1 laufen lassen:

```bash
pnpm --filter @easytree/web... build
EASYTREE_JOURNEY_... pnpm --filter @easytree/web exec playwright test \
  -c e2e/auth-journey/config.ts --grep "Reale Auth-Kostenreise"
```

Erwartung: **ROT** mit Fehlermeldung `horizontaler Überlauf bei 1440px` (bzw. 1920).
Wenn stattdessen ein ANDERER bestehender Test zuerst rot wird: akzeptabel nur, wenn
zusätzlich die neue Zusicherung selbst rot ist — sonst Mutation nachschärfen.

**Step 3: Vollständig zurücknehmen + Rücknahme belegen (scoped)**

```bash
git checkout -- apps/web/components/app-shell.tsx
git diff -- apps/web/components/app-shell.tsx   # MUSS leer sein
pnpm --filter @easytree/web... build
EASYTREE_JOURNEY_... pnpm --filter @easytree/web exec playwright test \
  -c e2e/auth-journey/config.ts --grep "Reale Auth-Kostenreise"
```

Erwartung: leerer Diff, dann **GRÜN**. Rot→Grün-Protokoll (Kommando + letzte Zeilen)
für den Abschlussbericht festhalten. Kein Commit in diesem Task.

---

## Task 6: Lokale Gates (alle mit Zahl, nicht mit Haken)

**Step 1–5, in dieser Reihenfolge, jeweils Done-Bedingung aus CLAUDE.md-Tabelle:**

```bash
git ls-files -z | xargs -0 pnpm exec prettier --ignore-unknown --check   # exit 0
pnpm exec turbo run lint --force        # Cached: 0 cached, Tasks: N successful
pnpm exec turbo run typecheck --force   # dito
pnpm exec turbo run test --force        # dito — Zahl lesen
env -u EASYTREE_API_PROXY_TARGET pnpm build   # exit 0, Cached: 0 cached
```

**Step 6: web-smoke-Äquivalent lokal** (Playwright braucht Port 3000 frei, Build vorhanden):

```bash
EASYTREE_API_PROXY_TARGET=http://127.0.0.1:3001 pnpm --filter @easytree/web run test:e2e
```

Erwartung: alle Specs grün, gedruckte Dateizahl ≥ 2 (shell-smoke + planungswerkbank).

Rot in irgendeinem Gate ⇒ zurück zum verursachenden Task; NIE vor grünen Gates pushen.

---

## Task 7: Push, PR, CI auf exakt dem Head

**Step 1: Push + genau ein PR**

```bash
git push -u origin feat/eyt-113-finalize-shell-boundaries
gh pr create --base master --title "test(web)+docs: EYT-113 Finalisierung — Werkbank-Viewport-Evidenz und Shell-Grenzen-Doku" --body-file <PR-Body-Datei>
```

PR-Body: AC-Truth-Matrix (Endstand), Änderungsliste mit Begründung je Datei,
Gegenmutation Rot→Grün-Beleg, ausdrücklich „kein EYT-81-Scope", Screenshot-Liste,
Abschluss `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

**Step 2: CI abwarten — mit dem Skript, nicht mit Schleifen**

```bash
HEAD=$(git rev-parse HEAD)
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree "$HEAD" 3600
```

Exit 0 = grün. Exit 1 kann „cancelled durch nachgeschobenen Push" heißen, Exit 0 kann
Timeout maskieren ⇒ **immer gegenprüfen:**

```bash
gh run list --commit "$HEAD" --json databaseId,conclusion,workflowName
gh run view <ci-run-id> --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
```

Erwartung: alle 11 Pflichtjobs `success` auf exakt `$HEAD`. db-gates-Gate-Zeilen lesen
(`mode=required … skipped=0`, CLAUDE.md-Grep). Jeder Commit nach diesem Punkt
invalidiert die Messung — dann CI neu.

**Step 3: CI-Artefakt sichern (Evidenz vom exakten Head, 7-Tage-Retention)**

```bash
gh run download <ci-run-id> -n auth-journey-nachweise -D /tmp/eyt113-evidenz
ls /tmp/eyt113-evidenz | grep eyt113
```

Erwartung: `eyt113-werkbank-1440.png`, `eyt113-werkbank-1920.png`,
`eyt113-feld-320.png`, `eyt113-feld-375.png`, `eyt113-kosten-forbidden.png` (o. ä.
Forbidden-Nachweis) vorhanden. Artefakte NICHT ins Repo committen.

---

## Task 8: Jira-Evidenzkommentar (erst nach vollständig grünem PR-Head)

Kommentar auf EYT-113 (`addCommentToJiraIssue`, Cloud-ID
`4504291c-8bc0-48f8-ab9e-9ad5d376ca04`) mit: finalem PR-Head-SHA, PR-URL, CI-Run-ID,
AC-Matrix (13 Zeilen), Screenshot-/Artefakt-Verzeichnis, und wörtlich:
**„EYT-113 bleibt In Arbeit bis unabhängige PO-Prüfung."**

Regeln: compose → re-read → send (gerenderte Fassung prüfen; Atlassian frisst
Satzzeichen hinter nackten URLs). KEINE Transition, KEINE Resolution, kein
„PO approved". Kommentar-ID notieren.

---

## Stop Conditions (unverändert aus dem Auftrag)

STOP mit `BLOCKED_SCOPE — <Grund>` bei: Punkt gehört zu EYT-81/80/12/82/147/148;
neue Migration/neuer API-Vertrag/Auth-Grundarchitektur nötig; `master` bewegt sich
nicht-trivial; widersprüchlicher Acceptance Contract; Zustand nur per Mock/Fake
erfüllbar. Kein Merge. Kein Start von EYT-81. Deployment bleibt gesperrt
(`BLOCKER_ENVIRONMENT_SEPARATION` — hier ohnehin out of scope).

## Abschlussbericht (EVIDENCE TO RETURN)

Vollständig liefern: Start truth · AC-Matrix (13×) · Changes je Datei + „kein
EYT-81-Scope" · Rot/Grün- und Gegenmutations-Evidenz · Playwright-/Viewport-/axe-/
Overflow-/Fokus-Ergebnisse · Screenshots (Pfad + Rolle + Viewport + Zustand) ·
Commit-SHAs, PR-URL, Head-SHA, Base-SHA · CI-Run + 11 Job-Status + Head-Bestätigung ·
Jira-Status + Kommentar-ID + „keine Done-Transition" · offene Befunde klassifiziert
(BLOCKER/IMPORTANT/MINOR/CROSS_TICKET), erwartete MINOR/CROSS_TICKET-Kandidaten:
Locale/Timezone-Pinning der Journey (de-DE/Europe/Berlin, EYT-148),
WebKit-Closeout-Smokes (EYT-148), 56-px-Hauptaktionen der Feld-Fachflächen (EYT-81).

Finalstatus: `READY_FOR_REVIEW — EYT-113 FINALIZATION` bei voller Evidenz, sonst
`CHANGES_REMAIN — EYT-113` bzw. `BLOCKED_SCOPE — <Grund>`. Danach STOP.
