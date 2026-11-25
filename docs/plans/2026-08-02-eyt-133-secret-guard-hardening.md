# EYT-133 — Secret-Guard-Härtung nach dem Merge

> **Für Claude:** Ausführung task-für-task. Nach grüner CI stoppen. Nicht mergen, nicht deployen.

## Ziel

Zwei gemessene Umgehungen des Secret-Wächters schließen, die mit PR #42 auf `master` gelangt sind:

- **F1** — ein globaler Dummy-Fallback akzeptiert jeden freigegebenen Wert für **jeden** Variablennamen.
- **F2** — eine Ausnahme stellt eine Datei von **allen** privilegierten Familien frei, nicht nur von der, für die sie gedacht war.

## Nicht-Ziele

Kein Revert von PR #42; der Produktionsstand bleibt. Keine neue Scanner-Infrastruktur, keine zweite Regelsprache, keine Erweiterung des Wächters auf Dateitypen, die er heute nicht liest. Kein Merge, kein Deployment, kein produktiver Login, keine Ruleset-Änderung, keine Rotation. EYT-107/108/109/110 bleiben unangetastet.

## Preconditions

- `origin/master` = `36384d0` (Merge von PR #42). Hotfix-Branch **aus diesem Stand**: `fix/eyt-133-secret-guard-hardening`.
- Neuer Worktree, keine Dateien aus dem alten übernehmen.
- Scope: alle berührten Pfade liegen unter `apps/api/test/**`, das im Canvas freigegeben ist. **Kein neuer Pfad nötig** — vor dem ersten Commit trotzdem `bash scripts/plumbline-scope-guard.sh`.
- `.env` bleibt unberührt und ignoriert; `.env.example` bleibt byte-identisch zu `HEAD`.

### Gemessener Ausgangszustand (02.08.2026, gegen `36384d0`)

**F1 — alle sechs Fälle rutschen heute durch:**

```
SUPABASE_SECRET_KEY=production
SUPABASE_SERVICE_KEY=http://localhost:54321
POSTGRES_PASSWORD=3001
SUPABASE_ANON_KEY=info
SUPABASE_PUBLISHABLE_API_KEY=test
DATABASEPASSWORD=development
```

Ursache: `istErlaubterDummy(wert)` in `apps/api/test/architecture/env-template-rules.ts` prüft `ERLAUBTE_DUMMY_WERTE.some(...)` **ohne den Variablennamen**. `production` ist als `NODE_ENV`-Wert freigegeben und deckt damit jeden Namen.

**F2 — Service-Key in ausgenommener Datei ergibt 0 Findings.** Ursache: `ERLAUBTE_DATEIEN` (aus `PRIVILEGIERTE_ORTE`) wird in Regel `privileged-credential-only-in-named-places` als `continue` über **alle** Familien ausgewertet. Das per-Familie-Feld `erlaubtIn` existiert bereits, wird aber nur von der `DATABASE_URL`-Familie genutzt; die dateiweite Freistellung liegt davor.

### Bekannte Lücke, die dieser Plan NICHT schließt

Der Wächter bleibt statisch. Ein zur Laufzeit nachgeladener Wert bleibt unsichtbar. Das ist dokumentiert und kein Regressionsziel.

---

## Aufgaben

### T1 — Worktree und Branch

**REQ:** Preconditions
**Dateien:** keine

```bash
git -C /Users/benjaminpoersch/EasyTree fetch origin
git worktree add <scratchpad>/eyt133-wt -b fix/eyt-133-secret-guard-hardening origin/master
cd <scratchpad>/eyt133-wt && pnpm install --frozen-lockfile
pnpm --filter @easytree/config build && pnpm --filter @easytree/contracts build && pnpm --filter @easytree/domain build
```

**Evidenz:** `git rev-parse HEAD` = `36384d0…`; `git status --short` leer.

---

### T2 — Red Tests für F1 (Commit 1, Teil 1)

**REQ:** F1
**Dateien:** `apps/api/test/env-template.test.ts` (ergänzen)
**Nicht ändern:** Produktionsregeln — dieser Task muss ROT enden.

Neuer `describe`-Block mit den sechs Bypässen als `it.each`, jeder mit **genau einem** erwarteten Befund:

```ts
it.each([
  ["SUPABASE_SECRET_KEY", "production"],
  ["SUPABASE_SERVICE_KEY", "http://localhost:54321"],
  ["POSTGRES_PASSWORD", "3001"],
  ["SUPABASE_ANON_KEY", "info"],
  ["SUPABASE_PUBLISHABLE_API_KEY", "test"],
  ["DATABASEPASSWORD", "development"],
])("%s darf den Dummywert %s nicht erben", (name, wert) => {
  expect(pruefeEnvTemplate(".env.example", `${name}=${wert}`)).toHaveLength(1);
});
```

Dazu die Positivfälle, die grün bleiben **müssen** — sie sind die Gegenprobe gegen eine zu scharfe Regel:

```ts
it.each([
  "NODE_ENV=development",
  "LOG_LEVEL=info",
  "API_PORT=3001",
  "SUPABASE_URL=http://localhost:54321",
  "DATABASE_URL=postgresql://easytree_app:replace-with-your-local-password@localhost:54322/postgres",
])("%s bleibt zulaessig", (zeile) => {
  expect(pruefeEnvTemplate(".env.example", zeile)).toEqual([]);
});
```

**Test:** `pnpm --filter @easytree/api exec vitest run test/env-template.test.ts`
**Evidenz:** 6 rot, Positivfälle grün. Zahlen notieren.

---

### T3 — Red Tests für F2 (Commit 1, Teil 2)

**REQ:** F2
**Dateien:** `apps/api/test/secret-surface.red-case.test.ts` (ergänzen)

Neun Fälle gegen den Wegwerfbaum. Familien-IDs sind Voraussetzung, existieren aber noch nicht — die Tests referenzieren sie bereits und laufen deshalb rot:

1. `.github/workflows/ci.yml` mit dem lokalen Wegwerf-Passwort → **grün**
2. dieselbe Datei zusätzlich mit Service-Key → **rot**
3. dieselbe Datei zusätzlich mit `sb_secret_`-Wert → **rot**
4. `scripts/read-through-harness.sh` mit lokalem Testpasswort → grün; mit Service-Key → rot
5. `apps/api/test/auth/token-verifier.test.ts` nur mit der Rollenfamilie → grün; mit anderer Familie → rot
6. Ausnahme mit Familien-ID, die heute nichts ausnimmt → **rot**
7. Ausnahme auf nicht existierende Datei → **rot**
8. Ausnahme ohne belastbare Begründung → **rot**
9. Rückkehr zur dateiweiten Ausnahme → mehrere Tests rot

JWT-Fixtures **zur Laufzeit** bauen (`Buffer.from(...).toString("base64url")`), nie als `eyJ…`-Literal — sonst wird `secret-scan` rot. Verbotene Namen dürfen in dieser Datei ausgeschrieben stehen; sie ist bereits eine benannte Ausnahme.

**Test:** `pnpm --filter @easytree/api exec vitest run test/secret-surface.red-case.test.ts`
**Evidenz:** die genannten Fälle rot, Zahlen notieren.

**Commit 1:** `test(security): expose env dummy and exception bypasses`

---

### T4 — F1 implementieren

**REQ:** F1
**Dateien:** `apps/api/test/architecture/env-template-rules.ts`

`ERLAUBTE_DUMMY_WERTE` und `istErlaubterDummy(wert)` **ersetzen** durch eine Bindung an den Variablennamen:

```ts
export const ERLAUBTE_KONKRETWERTE: ReadonlyArray<{
  variable: RegExp; // exakter Name oder enge Familie
  muster: RegExp; // was fuer DIESEN Namen konkret erlaubt ist
  grund: string;
}> = [
  { variable: /^NODE_ENV$/, muster: /^(development|test|production)$/, grund: "…" },
  { variable: /^LOG_LEVEL$/, muster: /^(fatal|error|warn|info|debug|trace)$/, grund: "…" },
  { variable: /^API_PORT$/, muster: /^\d{2,5}$/, grund: "…" },
  {
    variable: /^SUPABASE_URL$/,
    muster: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/,
    grund: "…",
  },
];
```

Reihenfolge in `pruefeEnvTemplate`:

1. Wertformprüfungen unverändert (JWT, Geheimpräfix, Publishable-Präfix).
2. **`DATABASE_URL`**: lokale Adresse _und_ Passwortanteil leer oder Platzhalter — sonst Befund. Nicht über die generische Liste, weil hier zwei Bedingungen zusammen gelten.
3. **Geheimer Name** (`istGeheimerName`): ausschließlich leer oder erlaubte Platzhalterform. **Kein** Konkretwert, unabhängig davon, was für andere Namen freigegeben ist. Das schließt F1.
4. Sonst: Konkretwert nur, wenn eine Zeile in `ERLAUBTE_KONKRETWERTE` **auf den Namen passt** und ihr `muster` greift.

Ein Name, der weder geheim ist noch in der Liste steht, darf keinen unbegründeten Konkretwert tragen — hier ist zu entscheiden und zu dokumentieren, ob das ein Befund ist oder erlaubt. **Vorschlag:** erlaubt, aber nur wenn der Wert keine Wertform-Prüfung verletzt; alles andere brächte `.env.example` sonst ohne Not zum Rotwerden.

**Test:** T2-Suite grün, `.env.example` weiterhin ohne Befund.
**Evidenz:** 6 vorher rote Fälle grün, Positivfälle unverändert grün.

---

### T5 — F2 implementieren

**REQ:** F2
**Dateien:** `apps/api/test/architecture/secret-surface-rules.ts`

1. Jede Familie in `PRIVILEGIERTE_FAMILIEN` bekommt eine **stabile `id`**, z. B. `service-role-name`, `service-key-name`, `secret-key-name`, `jwt-secret-name`, `postgres-role-name`, `uppercase-password-name`, `platform-token-name`, `admin-api-call`, `hardcoded-jwt`, `sb-secret-prefix`, `database-url-outside-config`.
2. `PRIVILEGIERTE_ORTE` wird zu:
   ```ts
   { datei: string; erlaubteFamilien: readonly string[]; grund: string }
   ```
3. `ERLAUBTE_DATEIEN` und das dateiweite `continue` **entfernen**. Ausgenommen wird nur noch das Paar (Datei, Familien-ID).
4. Bestehende Einträge auf die tatsächlich benötigte Familie verengen — **gemessen**, nicht geraten: je Datei ermitteln, welche Familien heute wirklich anschlagen, und nur diese eintragen.
5. Startwerte gemäß Auftrag: `.github/workflows/ci.yml` und `scripts/read-through-harness.sh` nur `uppercase-password-name`; `token-verifier.test.ts` nur die Rollenfamilie; die beiden Fixture-Dateien so eng wie messbar.
6. **Liveness je Paar:** jeder Eintrag muss existieren _und_ seine Familie muss in dieser Datei heute tatsächlich anschlagen. Ein unbenutztes Paar ist rot.
7. Jede Familien-ID muss eindeutig sein und in mindestens einer Regel vorkommen.

**Test:** T3-Suite grün; `secret-surface.test.ts` weiterhin 0 Findings.

**Commit 2:** `fix(security): bind env values and exceptions to intent`

---

### T6 — Gegenmutationen ausführen

**REQ:** F1, F2 — Nachweispflicht
**Dateien:** temporär, danach per `cp`-Sicherung zurücknehmen (**nie** `git checkout --`)

| #   | Mutation                                                        | Erwartung            |
| --- | --------------------------------------------------------------- | -------------------- |
| 1   | Namensbindung entfernen (globaler `some`)                       | T2-Bypässe rot       |
| 2   | Geheime Namen wieder Konkretwerte erlauben                      | mind. 4 rot          |
| 3   | `DATABASE_URL`-Passwortprüfung entfernen                        | mind. 1 rot          |
| 4   | Dateiweite Ausnahme wieder einführen                            | mehrere T3-Fälle rot |
| 5   | Einer Ausnahme eine zweite Familie geben, die sie nicht braucht | Liveness rot         |
| 6   | Familien-ID in einer Ausnahme verschreiben                      | rot                  |

Jede Mutation **einspielen, rotes Ergebnis messen, zurücknehmen**. Zahlen im PR nennen. Eine nur benannte Gegenmutation zählt nicht.

---

### T7 — Vollständige Validierung

**REQ:** alle

```bash
pnpm exec prettier --check apps packages docs .github
pnpm lint && pnpm typecheck
pnpm --filter @easytree/api exec vitest run
pnpm --filter @easytree/web exec vitest run
git diff --check
bash scripts/plumbline-scope-guard.sh
<scratchpad>/bin/gitleaks dir --redact --no-banner --exit-code 1 .
```

**Evidenz:** jede Zeile grün, Zahlen notiert. Keine freiwilligen Skips.

---

### T8 — Commit 3, Push, PR

**REQ:** Dokumentation
**Dateien:** keine Codeänderung

**Commit 3:** `docs(eyt-133): record post-merge guard hardening`

PR-Beschreibung enthält **nur**: Ursache beider Lücken · Red Tests · endgültiges variablenspezifisches Modell · endgültiges familienspezifisches Ausnahmemodell · ausgeführte Gegenmutationen mit Zahlen · Head-SHA · CI-Lauf · Restrisiken.

Keine Secret-Werte, keine Längen, keine Präfixe, keine Claims, kein Projektbezug.

---

### T9 — CI und Stop-Gate

**REQ:** alle

Alle **elf** Jobs müssen auf **exakt demselben** PR-Head grün sein. Prüfen mit:

```bash
gh api repos/DYAI2025/EasyTree/commits/<head>/check-runs \
  --jq '[.check_runs[]|select(.name!="Sourcery review")]
        | "jobs=\(length) success=\([.[]|select(.conclusion=="success")]|length)"'
```

Zusätzlich `run_attempt` und `head_sha` des Laufs lesen — elf grüne Checks aus mehreren Läufen sind kein Nachweis.

Danach **EYT-133** und **EYT-106** kommentieren; frühere Kommentare nicht löschen.

**Stop-Gate:** `PASS_FOR_FINAL_REVIEW` oder `BLOCKED_WITH_EVIDENCE`. Nicht mergen, nicht deployen.

---

## Risiken

- **Zu scharfe Regel macht `.env.example` rot.** Wahrscheinlichster Fehlschlag. Gegenmittel: die fünf Positivfälle aus T2 laufen bei jeder Zwischenstufe mit.
- **Verengte Familien-Ausnahmen lassen bestehende Dateien auffliegen.** Erwartbar bei `ci.yml` und dem Harness. Auflösung: messen, welche Familien dort real anschlagen, und genau diese eintragen — nicht die Regel aufweichen.
- **Selbsttreffer.** Beide Regeldateien enthalten die verbotenen Bezeichner. Muster weiter aus Teilen zusammensetzen; neue Literale prüfen mit `vitest run test/secret-surface.test.ts`.
- **`secret-scan` durch JWT-Fixtures.** Nur zur Laufzeit erzeugen. Ein `eyJ…`-Literal im Quelltext wird von gitleaks zuverlässig gemeldet (gemessen).
- **Änderung ist testseitig, aber nicht folgenlos:** eine zu scharfe Regel blockiert künftige PRs. Deshalb Positivfälle als gleichrangige Nachweise.

## Rollback

`git revert` der drei Commits auf dem Hotfix-Branch, oder Branch verwerfen — er ist nicht gemergt. Kein Produktionsbezug: die Änderungen liegen vollständig unter `apps/api/test/**` und verändern kein Laufzeitverhalten. Der Produktionsstand aus PR #42 bleibt in jedem Fall unberührt.
