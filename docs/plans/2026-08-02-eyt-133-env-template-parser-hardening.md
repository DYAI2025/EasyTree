# EYT-133 — Zwei fail-open Fälle in `pruefeEnvTemplate` schließen

> **Für Claude:** Ausführung als ein einziger Commit auf `fix/eyt-133-secret-guard-hardening`.
> Dieser Plan liegt bewusst im Haupt-Worktree (`/Users/benjaminpoersch/EasyTree/docs/plans/`)
> und **nicht** im Arbeits-Worktree — er kann dadurch nicht versehentlich in PR #43 geraten.

**Ziel:** Jeder nichtleere Wert in einer versionierten Environment-Vorlage ist entweder ein
erlaubter Platzhalter oder ein für **genau diesen** Variablennamen freigegebener Konkretwert —
und die Assignment-Erkennung lässt sich nicht durch Schreibweise oder `export` umgehen.

**Nicht-Ziele:** `entferneKommentare` reparieren; neue Guard-Familien; neue Scanner; Lexer- oder
TypeScript-Parser-Migration; allgemeine Textanalyse; Merge; Deployment; Jira auf Fertig;
EYT-107/108/109/110.

---

## Vorbedingungen — gemessen 02.08.2026, nicht angenommen

| Prüfung                                                                          | Ergebnis                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Head PR #43                                                                      | `5f67e9b1d49ca21e242ccbbac97489aee7faddd5`, 11/11 CI grün, mergeable                       |
| Versionierte Vorlagen (`git ls-files`, Filter `(^\|/)\.env($\|\.)`)              | genau **eine**: `.env.example`                                                             |
| Nutzzeilen in `.env.example`, die **kein** kanonisches UPPERCASE-Assignment sind | **keine**                                                                                  |
| Kommentarzeilen mit `=` in `.env.example`                                        | **zwei** (Z. 18 `psql "…user=postgres…"`, Z. 37 `# DATABASE_SSL_ROOT_CERT=replace-with-…`) |

**Finding A bestätigt** — `env-template-rules.ts:282-285`:

```ts
const freigabe = ERLAUBTE_KONKRETWERTE.find((e) => e.variable.test(variable));
if (freigabe !== undefined && !freigabe.pruefe(wert)) { melde(...); }
// freigabe === undefined  ->  faellt durch, still akzeptiert
```

**Finding B bestätigt** — `env-template-rules.ts:220`:

```ts
const treffer = /^\s*#?\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(zeile);
if (treffer === null) return; // kein export, kein lowercase, kein Parsing-Befund
```

### Bekannte Lücken dieses Plans

- **Der Parser muss am Zeilenanfang verankert bleiben.** Kommentarzeile 18 enthält
  `user=postgres` mitten im Text. Eine Grammatik, die den Namen irgendwo in der Zeile sucht
  statt direkt nach optionalem `#`/`export`, erzeugt dort sofort einen Fehlalarm. Das ist die
  wahrscheinlichste Art, diesen Task kaputtzumachen.
- **`SUPABASE_SECRET_KEY value`** (ohne `=`) ist nur dann ein Befund, wenn die Klassifikation
  eindeutig ist. Für `.env.example` ist sie es: die Datei kennt ausschließlich Kommentare,
  Leerzeilen und Assignments. Diese Begründung gehört in den Code, nicht nur in den Plan.
- **Die Red-Test-Fixtures enthalten neue Bezeichner** (`PRIVATE_KEY`, `AWS_ACCESS_KEY_ID`,
  lowercase `supabase_secret_key`). Ob der Secret-Surface-Wächter darauf anschlägt, ist
  **unbekannt und muss gemessen werden** (T4). Neue Guard-Familien sind nicht autorisiert —
  falls eine nötig wäre, ist das ein Stopp-Grund, kein stiller Eintrag.

---

## Aufgaben

### T1 — Red Tests für Finding A (unbekannte Konkretwerte)

**Bezug:** EYT-133, AK „keine generische Freigabe für unbekannte Variablennamen".
**Dateien:** `apps/api/test/env-template.test.ts` (nur ergänzen).

**Schritt 1 — Fehlschlagende Tests schreiben.** In der bestehenden `describe`-Gruppe mit dem
`pruefe`-Helfer (`apps/api/test/env-template.test.ts:104`):

```ts
it.each([
  ["PRIVATE_KEY", "konkreter-wert"],
  ["AWS_ACCESS_KEY_ID", "konkreter-wert"],
  ["UNBEKANNTE_CREDENTIAL", "konkreter-wert"],
  ["FOO", "bar"],
])("%s mit konkretem Wert hat keine Freigabe und ist ein Befund", (name, wert) => {
  expect(pruefe(`${name}=${wert}`)).toHaveLength(1);
});
```

**Schritt 2 — Positive Gegenproben, die grün bleiben müssen.** Diese Zeilen sind der Grund,
warum die Regel nicht einfach „jeder Konkretwert ist ein Befund" lauten kann:

```ts
it.each([
  "NODE_ENV=development",
  "LOG_LEVEL=info",
  "API_PORT=3001",
  "SUPABASE_URL=http://localhost:54321",
  "DATABASE_URL=postgresql://easytree_app:replace-with-your-local-password@localhost:54322/postgres",
  "SUPABASE_ANON_KEY=replace-with-your-supabase-anon-key",
])("%s bleibt gruen", (zeile) => {
  expect(pruefe(zeile)).toEqual([]);
});
```

**Schritt 3 — Rot messen.**
`pnpm --filter @easytree/api exec vitest run test/env-template.test.ts`
Erwartet: **4 rot** (die aus Schritt 1), Schritt 2 grün.

**Akzeptanzevidenz:** Zahl der roten Tests notiert, bevor T3 beginnt.

---

### T2 — Red Tests für Finding B (Assignment-Grammatik)

**Bezug:** EYT-133. **Dateien:** `apps/api/test/env-template.test.ts`.

**Schritt 1 — Fehlschlagende Tests:**

```ts
it.each([
  "supabase_secret_key=konkreter-wert", // lowercase Name
  "export SUPABASE_SECRET_KEY=konkreter-wert", // export als Umgehung
  "export PRIVATE_KEY=konkreter-wert", // export + unbekannter Name
  "1INVALID=value", // kein gueltiger Bezeichner
  "SUPABASE_SECRET_KEY value", // Assignment ohne '='
])("%s wird nicht still uebersprungen", (zeile) => {
  expect(pruefe(zeile).length).toBeGreaterThan(0);
});
```

**Schritt 2 — Positive Gegenproben:**

```ts
it.each([
  "export NODE_ENV=development",
  "NODE_ENV=development",
  "# SUPABASE_SECRET_KEY=replace-with-key", // Kommentar + Platzhalter
  "# Lokale Entwicklung", // reiner Prosa-Kommentar
  '#   psql "…user=postgres…" -c "alter role …";', // Kommentar mit '=' mitten im Text
  "",
])("%s bleibt gruen", (zeile) => {
  expect(pruefe(zeile)).toEqual([]);
});

it("ein konkreter Secret-Wert bleibt auch auskommentiert ein Befund", () => {
  expect(pruefe("# SUPABASE_SECRET_KEY=konkreter-wert")).toHaveLength(1);
});
```

Die vorletzte Gegenprobe ist die wichtigste: sie ist die gemessene Zeile 18 aus `.env.example`
und hält die Verankerung am Zeilenanfang fest.

**Schritt 3 — Rot messen.** Erwartet: **5 rot** aus Schritt 1, Gegenproben grün.

---

### T3 — Kleinste Korrektur in `pruefeEnvTemplate`

**Dateien:** `apps/api/test/architecture/env-template-rules.ts`, Zeilen 217–287.

**Schritt 1 — Zeilenklassifikation vor die Wertprüfung ziehen.** Ersetzt Zeile 220–223.
Verankert am Zeilenanfang, `export` optional, Name zunächst permissiv:

```ts
const ZEILE = /^\s*(#\s*)?(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const KANONISCH = /^[A-Z][A-Z0-9_]*$/;

const roh = zeile.trim();
if (roh === "") return; // Leerzeile
const treffer = ZEILE.exec(zeile);
const istKommentar = /^\s*#/.test(zeile);

if (treffer === null) {
  // Reine Kommentare bleiben erlaubt — auch solche, die irgendwo ein '='
  // tragen (gemessen: .env.example Z. 18 enthaelt `user=postgres` in einem
  // psql-Aufruf). Eine NICHT kommentierte Zeile, die hier ankommt, ist in
  // dieser Dateiform aber weder Kommentar noch Leerzeile noch Assignment —
  // also ein fehlerhafter Eintrag, der nicht still verschwinden darf.
  if (!istKommentar) {
    befunde.push({
      datei,
      zeile: index + 1,
      variable: "(unparsbar)",
      grund: "Zeile ist weder Kommentar, Leerzeile noch gueltiges Assignment",
    });
  }
  return;
}
const variable = treffer[3] as string;
const wert = (treffer[4] as string).trim().replace(/^["']|["']$/g, "");
```

**Schritt 2 — Nichtkanonische Namen melden.** Direkt nach der Zuweisung von `variable`,
**vor** allen Wertprüfungen:

```ts
if (!KANONISCH.test(variable)) {
  melde("Variablenname ist nicht kanonisch (nur GROSSBUCHSTABEN, Ziffern, Unterstrich)");
  return;
}
```

**Schritt 3 — Finding A schließen.** Ersetzt Zeile 282–285:

```ts
const freigabe = ERLAUBTE_KONKRETWERTE.find((e) => e.variable.test(variable));
if (freigabe === undefined) {
  melde("konkreter Wert besitzt keine variablenspezifische Freigabe");
  return;
}
if (!freigabe.pruefe(wert)) {
  melde(`konkreter Wert ausserhalb der Freigabe fuer ${variable} (${freigabe.grund})`);
}
```

**Schritt 4 — Grün messen.**
`pnpm --filter @easytree/api exec vitest run test/env-template.test.ts`
Erwartet: alle grün, einschließlich der Prüfung gegen die echte `.env.example`.

**Akzeptanzevidenz:** `Tests N passed`, und die reale `.env.example` erzeugt **0 Befunde**.

---

### T4 — Rückwirkung auf den Secret-Surface-Wächter messen

**Grund:** Die neuen Fixtures schreiben `PRIVATE_KEY`, `AWS_ACCESS_KEY_ID` und lowercase
`supabase_secret_key` in `env-template.test.ts`. Diese Datei ist eine `PRIVILEGIERTE_ORTE`-Ausnahme
mit fünf Familien; ob die neuen Bezeichner eine **sechste** auslösen, ist nicht bekannt.

```bash
pnpm --filter @easytree/api exec vitest run test/secret-surface.test.ts
```

- **0 neue Findings** → weiter mit T5.
- **Neue Findings** → **STOPP und begründen.** Eine weitere Familienausnahme ist nicht
  autorisiert. Zulässige Auflösung ohne Scope-Erweiterung: die Fixture-Bezeichner so wählen,
  dass sie keine privilegierte Familie treffen (z. B. `UNBEKANNTE_CREDENTIAL` statt
  `AWS_ACCESS_KEY_ID`), sofern der geprüfte Vertrag dadurch nicht schwächer wird.

---

### T5 — Drei Gegenmutationen, ausgeführt und zurückgenommen

Vor jeder Mutation `cp` der Datei anlegen; **nicht** `git checkout --` (stellt den Commit-Stand
her, nicht den Arbeitsstand). Keine Mutation committen.

| #   | Mutation                                                 | Erwartung   |
| --- | -------------------------------------------------------- | ----------- |
| 1   | `if (freigabe === undefined) return;` statt `melde(...)` | **≥ 4 rot** |
| 2   | `(export\s+)?` aus `ZEILE` entfernen                     | **≥ 2 rot** |
| 3   | `KANONISCH`-Prüfung entfernen                            | **≥ 1 rot** |

Nach jeder Rücknahme Kontrolllauf grün. Zahlen wörtlich in den Bericht.

---

### T6 — Restrisiko `entferneKommentare` belegen, nicht reparieren

**Kein Implementierungsschnitt.** Ein kleiner Test in `env-template.test.ts`, der belegt, dass
die Regex-Blindheit **keine reale Fundstelle unterdrückt** — also fail-loud bleibt:

```ts
it("die Regex-Blindheit von entferneKommentare unterdrueckt keine Fundstelle", () => {
  // Unentfernter Kommentartext erzeugt ZUSAETZLICHE Treffer, nie fehlende.
  // Beweis in der Richtung, die zaehlt: derselbe Verstoss wird auch dann
  // gemeldet, wenn davor ein Regex-Literal mit Anführungszeichen steht.
  const mitRegexDavor = ["const r = /^[\"']|[\"']$/g;", "SUPABASE_SECRET_KEY=konkreter-wert"].join(
    "\n",
  );
  expect(pruefeEnvTemplate(".env.example", mitRegexDavor).length).toBeGreaterThan(0);
});
```

Bleibt als Restrisiko im Review-Dokument.

---

### T7 — Evidenz, Commit, Push, CI

**Dateien:** `docs/reviews/2026-08-02-eyt-133-secret-guard-hardening.md` (Abschnitt ergänzen),
PR-Beschreibung #43.

1. Review-Dokument: neuer Abschnitt „Finding A / Finding B" mit Ursache, Red-Green-Zahlen und
   den drei Gegenmutationen. Restrisiko-Liste um „Assignment-Grammatik deckt nur die
   `.env.example`-Dateiform ab" ergänzen.
2. **Scope-Guard vor dem Commit:**
   ```bash
   git diff --name-only origin/master...HEAD   # muss genau 7 Dateien sein
   git diff --check
   ```
   Erlaubt sind ausschließlich die drei Dateien dieses Plans zusätzlich zu den sechs aus dem
   bestehenden PR-Stand. Alles andere: stoppen.
3. Benannte Dateien stagen, `git diff --cached --name-only` lesen, dann commit:
   `fix(security): EYT-133 close env template parser and policy bypasses`
4. Push auf `fix/eyt-133-secret-guard-hardening`, PR-Beschreibung mit neuem Head aktualisieren.
5. Vollständige CI abwarten: alle **elf** Jobs auf **demselben neuen Head**.

**Lokale Validierung vor dem Push:** Env-Template-Suite, Secret-Surface-Suite, gesamte
API-Suite, gesamte Web-Suite, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build`,
`git diff --check`.

---

## Risiken und Rollback

| Risiko                                                                      | Gegenmaßnahme                                                                                                           |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Parser nicht am Zeilenanfang verankert → Fehlalarm auf `.env.example` Z. 18 | Gegenprobe in T2 Schritt 2 ist genau diese Zeile                                                                        |
| Parsing-Finding feuert auf Prosa-Kommentare                                 | Nur **nicht kommentierte** Zeilen erzeugen es; Gegenprobe in T2                                                         |
| Neue Fixture-Bezeichner lösen eine sechste Guard-Familie aus                | T4 misst es vor dem Commit; bei Treffer STOPP statt stiller Ausnahme                                                    |
| `PRIVATE_KEY=` löst gitleaks aus                                            | `secret-scan` läuft lokal nicht (gitleaks nicht installiert) — erst CI beweist es; Wert ist bewusst nicht secret-förmig |
| Dritter Hotfix am selben Guard nötig                                        | Nach diesem Gate gilt Security-Freeze; weitere Funde werden als Ticket notiert, nicht gebaut                            |

**Rollback:** Ein einzelner Commit auf einem nicht gemergten Branch. `git revert <sha>` oder
`git reset --hard 5f67e9b` stellt den akzeptierten Stand mit 11/11 grüner CI wieder her.
Kein Produktionscode, kein Deployment, keine Migration betroffen.

---

## Stop-Gate

Nach grüner CI stoppen und melden: alter und neuer Head, Commit, geänderte Dateien,
Red-Green-Zahlen, drei Gegenmutationen, elf CI-Jobs, aktualisierte PR-Beschreibung,
verbleibendes Restrisiko, Rollback — dann `PASS_FOR_MERGE` oder `BLOCKED_WITH_EVIDENCE`.

**Keine weitere Security-Analyse nach diesem Gate.**
