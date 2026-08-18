# EYT-140 — Planungswerkbank und echte Wochennavigation: Implementierungsplan

> **Für Claude:** PFLICHT-SUB-SKILL: `superpowers:executing-plans`. Dieser Plan wird Meilenstein
> für Meilenstein abgearbeitet, jeder mit seinem eigenen, maschinell prüfbaren Fertigkriterium.

**Goal:** Eine Planerin bedient `/planung` als echte Wochenwerkbank — ohne einen technischen
`weekKey` zu kennen — und führt einen realen Einsatz über den bestehenden autorisierten Pfad bis
zum veröffentlichten Serverstand, mit einem verständlichen Übergang zu `/kosten`, sofern sie
`costs.read` hat.

**Non-Goals (Slice-Grenze, ausdrücklich):** Basisdesign-Ausarbeitung und Token-Wächter (EYT-141,
`AC-016`/`AC-037`/`AC-038`), Staging- und E2E-Abnahme (EYT-142, `REQ-012`–`REQ-017`), Kosten-UI
über den bloßen Übergang hinaus, alternative Planner-Ansichten, Monats-/Mehrwochenansicht,
Wochenend-Toggle, Wetter/Feiertage, Mehrtagesbaustellen, Drag & Drop, neue Planning-Domainregeln,
Mitarbeitenden-/Ressourcen-/Zeitansichten. `REQ-016`/`REQ-017` sind Slice-3-Gates.

**Architecture:** Von den sechs Requirements der Planungsreise ist genau **eines** ein Neubau —
die Wochennavigation (`REQ-002`). Alles andere wird **integriert, zugänglich gemacht und an
Evidenz gebunden**, nicht ersetzt. Die neue Fähigkeit zerfällt in drei Schichten, die je an der
Stelle liegen, an der ihr Wissen schon wohnt: die **Kalenderarithmetik** (Woche ± n, Zeitraum
einer Woche) kommt nach `@easytree/domain/planning-week.ts`, wo `isoWeekOfLocalDate`,
`planningWeekKey` und `localBusinessDate` bereits stehen; das **Parsen** eines Wochenschlüssels
bleibt an der Transportgrenze in `@easytree/contracts` (`parseIsoWeekKey`, EYT-88); die
**Darstellung** (Beschriftung, Zeitraumtext, Ziel-URLs) entsteht in einer reinen Web-Funktion
ohne React und ohne Uhr. Zustandsträger bleibt die **URL** — die Navigation schreibt
`?weekKey=…`, sie hält keinen Clientzustand.

**Tech Stack:** Next.js 16 App Router / React 19 (jsdom + Vitest + Testing Library),
`@easytree/contracts` (Zod), `@easytree/domain` (abhängigkeitsfrei), `@easytree/ui`,
pnpm/Turborepo.

---

## 0. START STATE — read-only gemessen am 18.08.2026

| Größe                                                        | gemessener Wert                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Worktree                                                     | `/Users/benjaminpoersch/EasyTree-worktrees/eyt-140-planungswerkbank`                 |
| Branch                                                       | `feat/eyt-140-planungswerkbank`                                                      |
| HEAD                                                         | `1c122dc749def3a306104fbf705d74c56bb08244`                                           |
| `origin/master`                                              | `f3b427ddb4d030baffbaa9073eff9bc8e3f28a7c`                                           |
| `git rev-list --left-right --count`                          | `0	3` — 0 hinter, 3 vor `origin/master`                                               |
| Arbeitsbaum                                                  | sauber (`git status --porcelain` leer) vor dieser Plandatei                          |
| offene PR für diesen Branch                                  | **keine** — der Branch ist lokal, nichts gepusht                                     |
| `.ts`/`.tsx` unter `apps/web` (ohne `node_modules`, `.next`) | **56**                                                                               |
| Dateien in `docs/plans/`                                     | **19** vor dieser Plandatei                                                          |
| Komponenten in `apps/web/components/`                        | **11**                                                                               |
| Bausteine in `packages/ui/src/`                              | **9** (+ `index.ts`) — **kein** `DateRangeControl`                                   |
| eindeutige `--eyt-*`-Tokennamen in `globals.css`             | **17** bei **79** Deklarationen; davon genau **ein** Abstandstoken (`--eyt-space-2`) |
| Token-Wächter in `apps/web/test` / `packages/ui/test`        | **keiner**                                                                           |

Reproduktion (der erste Schritt jeder Session):

```bash
cd /Users/benjaminpoersch/EasyTree-worktrees/eyt-140-planungswerkbank
git fetch --all --prune
git rev-parse HEAD origin/master
git rev-list --left-right --count origin/master...HEAD
git status --porcelain
```

**Weicht `HEAD` von `1c122dc…` ab: nicht implementieren, Drift rekonstruieren, melden.**

### Was bereits existiert und NICHT neu gebaut wird

Klassifikation aus `docs/traceability.md`, „S6 Tabelle D", gegen `origin/master` gemessen. Wer
hier neu baut, baut doppelt.

| REQ       | Klassifikation        | bestehender Baustein (gemessen im Worktree)                                                                 |
| --------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `REQ-001` | `existing capability` | `apps/web/components/login-form.tsx`, `app-shell.tsx`, `lib/session-provider.tsx`; CI-Job `auth-journey`    |
| `REQ-002` | **`new capability`**  | — nichts. `app/planung/page.tsx` verlangt `?weekKey=`; der Dateikommentar dort sagt selbst: „bleibt EYT-72" |
| `REQ-003` | `existing capability` | `planning-window-view.tsx` (292 Zeilen, vier sichtbare Zustände, kein Fallback); CI-Job `read-through`      |
| `REQ-004` | `partial capability`  | `planning-assignment-form.tsx` schreibt real; `planning-window-view.tsx` lädt nach Erfolg automatisch nach  |
| `REQ-005` | `existing capability` | `planning-publish-action.tsx`; `planungsfenster-stand` mit `data-stand`; `db-gates` · `[planning-publish]`  |
| `REQ-006` | `existing capability` | `kosten-zugang.tsx`, `app-shell.tsx` filtert die Navigation nach `costs.read`; `db-gates` · `[cost-access]` |

Ebenfalls vorhanden und **wiederverwendet statt nachgebaut**:

- `packages/contracts/src/planning/iso-week.ts` — `parseIsoWeekKey`, `formatIsoWeekKey`,
  `isoWochenImJahr`, `isValidIsoWeekKey`. Deterministisch, UTC-only, kein `now()`, kein Locale.
- `packages/domain/src/planning-week.ts` — `localBusinessDate`, `isoWeekOfLocalDate`,
  `planningWeekKey`, `isSameWeek`, `EUROPE_BERLIN`. **Die aktuelle Woche ist damit heute schon
  ableitbar** — es fehlt nur die Verschiebung und der Zeitraum.
- `packages/ui/src/` — `PageHeader`, `StatusBadge`, `StateBanner`, `EmptyState`, `ErrorState`,
  `PrimaryAction`, `Card`, `Button`, `VisuallyHidden`.
- `apps/api/test/iso-week-parity.test.ts` — hält die Wochenregel in `contracts` und `domain`
  deckungsgleich.

### Sechs gemessene Befunde, die den Entwurf festlegen

**B1 — `apps/web` hängt sehr wohl von `@easytree/domain` ab.** `CLAUDE.md` und der
Auftragstext sagen „Web hängt nur von `@easytree/contracts` und `@easytree/ui` ab". Gemessen ist
das **falsch**: `apps/web/package.json` deklariert `"@easytree/domain": "workspace:*"`, und
`apps/web/components/planning-assignment-form.tsx:35` importiert daraus `createTimeZone` und
`utcInstantOfLocalWallTime`. Das ist keine Regelverletzung, sondern eine veraltete
Dokumentationszeile — und es ist die Voraussetzung dafür, dass die Wochenarithmetik im Domain
liegen darf, statt in `apps/web` ein zweites Mal entstehen zu müssen. **Befund für die
Doku-Angleichung, nicht für diesen Slice.**

**B2 — Ein neuer Wert-Export aus `@easytree/domain` macht sofort einen API-Test rot.**
`apps/api/test/domain-invariant-coverage.test.ts` liest die Exportblöcke aus
`packages/domain/src/index.ts` und verlangt für **jeden** Wert-Export einen Registereintrag in
`apps/api/test/domain-invariants/registry.ts` mit Positiv- **und** Negativtest, deren Titel
wörtlich in der genannten Datei vorkommen müssen. Der Registereintrag ist damit **Teil** von
Meilenstein 2, nicht Nacharbeit; ein Commit ohne ihn wäre rot.

**B3 — 2026 hat 53 ISO-Wochen.** Nachgerechnet mit derselben Regel wie
`isoWochenImJahr` (1. Januar 2026 ist ein Donnerstag): 2024 → 52, 2025 → 52, **2026 → 53**,
2027 → 52, 2028 → 52. Daraus folgen die drei Randvektoren, an denen jede naive
`isoWeek ± 1`-Arithmetik zerbricht: `2027-W01` − 1 = **`2026-W53`**, `2026-W53` + 1 =
**`2027-W01`**, `2025-W52` + 1 = **`2026-W01`**. Eine Inline-Rechnung in einer Komponente
erzeugt hier `2027-W00` bzw. `2025-W53` — Werte, die `IsoWeekKeySchema` ablehnt, sodass die
Planerin beim Blättern über den Jahreswechsel den Parameterfehler sähe.

**B4 — „Bitte die Woche neu laden" ist eine Aufforderung, keine Rückbestätigung.**
`apps/web/components/planning-assignment-form.tsx:158` lautet wörtlich
`STALE_VERSION: "Der Planstand hat sich zwischenzeitlich geändert. Bitte die Woche neu laden."` —
ein Text im Fehlerpfad. Die **automatische** Rückbestätigung existiert bereits, aber an anderer
Stelle: `planning-window-view.tsx` setzt nach erfolgreichem Speichern `setNachladen((n) => n + 1)`
und liest die Woche neu; ein optimistisches Einfügen gibt es ausdrücklich nicht. `AC-007` ist mit
„Given ein **erfolgreich gespeicherter** Einsatz" genau auf diesen Erfolgspfad gestellt. **Zu tun
ist deshalb der Nachweis, nicht der Umbau.** Der `STALE_VERSION`-Zweig bleibt unverändert — ihn
umzubauen wäre neue Fachbreite und ist nicht `AC-007`.

**B5 — Jede bestehende Browserreise ruft `/planung` mit explizitem Parameter.**
`apps/web/e2e/read-through.spec.ts:21,283`, `shell-smoke.spec.ts:174` und
`auth-journey/journey.pwtest.ts:873,1681,2923` gehen alle auf `/planung?weekKey=…`. Der explizite
Pfad ist damit eine harte Kompatibilitätsbedingung: er darf sich in Verhalten und `data-testid`s
nicht ändern. Playwright läuft **nicht** in `pnpm test` — ein Bruch würde erst in CI auffallen.

**B6 — Das Token-Vokabular trägt heute kein 8-pt-Raster.** `globals.css` hat 17 eindeutige
`--eyt-*`-Namen, davon genau **ein** Abstandstoken (`--eyt-space-2`); `packages/ui/src/` benutzt
**gar keinen** `--eyt-`-Token (`grep -rlc -- "--eyt-" packages/ui/src/` → kein Treffer). `AC-038`
(8-pt-Raster) und `AC-037` (Token-Wächter) gehören zu `REQ-009` und damit zu **EYT-141**. Für
EYT-140 gilt die schwächere, aber prüfbare Regel: die neuen Flächen führen **keine neuen
Farbliterale** ein und verwenden ausschließlich bestehende Tokens und Klassen. Fehlende
Abstandstokens sind ein **Befund an EYT-141**, kein Grund, hier Literale zu streuen.

---

## Entwurfsentscheidungen

**E1 — Die URL ist der Zustandsträger, nicht der Client.** Die Navigation schreibt `?weekKey=…`
und liest ihn zurück; sie hält keinen `useState`-Wochenzustand. Drei Gründe, alle prüfbar:
Reload und ein zweiter Browserkontext zeigen dieselbe Woche (Vorarbeit für `AC-021`/`AC-022` in
EYT-142); jede Woche bleibt teilbar und tief verlinkbar; und **B5** bleibt unangetastet, weil der
explizite Parameter genau der Pfad ist, den die Navigation selbst benutzt.

**E2 — Fehlender Parameter ist etwas anderes als ungültiger Parameter.** Kein `weekKey` → die
**aktuelle** Woche (das ist `AC-003`). Ein vorhandener, aber ungültiger `weekKey` → weiterhin
`data-testid="planungsfenster-parameterfehler"`, und das Gateway wird **nicht** gerufen. Ein
Rückfall auf die aktuelle Woche bei ungültiger Eingabe wäre die schlimmere Variante: die Planerin
sähe eine plausible Woche, aber nicht die, die sie angefordert hat.

**E3 — Eine einzige Uhrzeit-Lesestelle.** `new Date()` steht ausschließlich in der
Server-Komponente `app/planung/page.tsx`. Alles darunter bekommt den Zeitpunkt bzw. die fertig
berechnete Woche als Prop. Ohne diese Regel wäre „welche Woche ist heute" in einer
Client-Komponente nicht deterministisch testbar, und `no-local-time-construction` bekäme eine
zweite Baustelle.

**E4 — Der Zeitraum einer ISO-Woche ist zonenfrei, die Frage „welche Woche ist heute" nicht.**
Montag bis Sonntag einer ISO-Woche sind **Kalendertage**, keine Instants — sie folgen allein aus
`isoYear`/`isoWeek`. Eine Zone braucht nur die Ableitung der aktuellen Woche aus einem Instant;
dafür wird `EUROPE_BERLIN` aus `@easytree/domain` **benannt** übergeben, nie implizit. Damit
entsteht kein Widerspruch zu `PlanningWindow.timeZone`, das der Server für die geladene Woche
mitschickt und das weiterhin angezeigt wird.

**E5 — Kein `DateRangeControl` in `packages/ui`.** `packages/ui` ist per ADR-001 **domänenfrei**;
„ISO-Woche", „Planungswoche" und „vorherige Woche" sind easyTree-Fachbegriffe. Die Navigation
entsteht deshalb als `apps/web/components/wochen-navigation.tsx`. Die Zeile in „S6 Tabelle D",
die `DateRangeControl` vermisst, hängt an `REQ-009` und damit an **EYT-141** — dort ist zu
entscheiden, ob ein generischer, domänenfreier Rest überhaupt übrig bleibt. **Koordinationsnotiz
an EYT-141, keine stille Planungsentscheidung.**

**E6 — Formatierung ohne `Intl` und ohne Locale.** Der Zeitraumtext (`10.08.2026 – 16.08.2026`)
wird aus Zahlen zusammengesetzt. `toLocaleDateString` ohne explizites Locale hängt an der
Umgebung; ein Test, der lokal grün ist und in CI rot, ist teurer als vier Zeilen `padStart`.

---

## Meilensteine — **M = 9**

`M = 9` ist aus dem Schnitt abgeleitet, nicht gerundet: eine Grundlagenmessung (M1), drei
Meilensteine für die **eine** Neubauleistung in ihren drei Schichten (M2 Arithmetik, M3
Ableitung, M4 Komponente), einer für die Einstiegsseite (M5), einer für den Werkbankrahmen (M6),
zwei für die Bindung bestehender Fähigkeiten an Evidenz (M7 Publish/Rückbestätigung, M8
Kostenübergang) und ein Abschlussgate (M9). **Ändert sich der Schnitt, wird `M` in dieser Zeile
sichtbar korrigiert und die Änderung begründet.**

---

### M1 — Ausgangsmessung, damit späteres Rot zuordenbar ist

**Was.** Vor der ersten Zeile Produktionscode einmal das volle lokale Gate erzwingen und die
tragende Annahme `ASM-001` benennen.

**Warum.** Ein Turbo-Replay ist kein Lauf: `pnpm test` kann `FULL TURBO` melden, „1061 passed"
zeigen und **kein einziges Paket** ausgeführt haben — und der Cache greift über Worktrees hinweg,
sodass ein „Treffer" ein Replay aus einem Worktree sein kann, in dem die Aufgabe nie lief. Ohne
erzwungene Ausgangsmessung ist jedes spätere Rot nicht zuordenbar.

**Dateien.** keine.

**AC.** keins direkt; Voraussetzung für alle.

**Test.** das bestehende Gate.

**Fertig, wenn:**

```bash
pnpm exec turbo run lint typecheck test --force
```

mit Exit-Code `0` endet **und** die `Cached:`-Zeile `0 cached` ausweist. Zusätzlich notiert:
`git rev-parse HEAD` → `1c122dc749def3a306104fbf705d74c56bb08244`.

**`ASM-001` ausdrücklich benannt, nicht stillschweigend angenommen.** Der PRD-Text verlangt vor
Slice 1 fünf `db-gates`-Gate-Zeilen (`[planning-write]`, `[planning-publish]`,
`[planning-published-reads]`, `[cost-snapshot]`, `[snapshot-immutability]`, je `mode=required …
skipped=0`) auf dem Sprint-6-Head. Diese Messung braucht einen **gepushten** Head und ist damit
**nicht Teil dieses Plans** — im Worktree ist Pushen untersagt. Sie ist eine Vorbedingung, die
der Orchestrator einlöst. **Solange sie fehlt, trägt keine Aussage dieses Plans über die
Funktionsfähigkeit der bestehenden Schreib-/Publish-/Snapshot-Pfade.** Extraktion, wenn der Lauf
existiert:

```bash
gh run view <run> --log --job <db-gates-job-id> \
  | grep -oE '\[[a-z-]+\] mode=[a-z]+ executed=[0-9]+ passed=[0-9]+ skipped=[0-9]+' | sort -u
```

**Risiko.** Ein rotes Ausgangsgate. **Rücknahme:** dann beginnt EYT-140 nicht — der Defekt ist
älter als dieser Slice und wird zuerst benannt.

---

### M2 — Wochenarithmetik im Domain, plus Invariantenregister

**Was.** Zwei neue reine Funktionen in `packages/domain/src/planning-week.ts`, über
`packages/domain/src/index.ts` exportiert:

- `shiftPlanningWeek(week: PlanningWeek, delta: number): PlanningWeek` — verschiebt über
  Jahresgrenzen hinweg korrekt, indem sie über den Montag der Woche rechnet (dieselbe
  Donnerstagsregel wie `isoWeekOfLocalDate`), **nicht** über `isoWeek + delta`.
- `planningWeekDateRange(week: PlanningWeek): { readonly monday: LocalBusinessDate; readonly sunday: LocalBusinessDate }`
  — Kalendertage, keine Instants, keine Zone (siehe **E4**).

Beide lehnen eine Woche ab, die in ihrem ISO-Jahr nicht existiert (`RangeError`, wie
`isoWeekOfLocalDate` es bereits tut) — eine Formatier- oder Rechenfunktion, die ungültige Wochen
erzeugt, ist ein Leck in genau der Grenze, die EYT-88 zieht.

**Warum zuerst.** Siehe **B3**. Ohne diese Funktionen gibt es keine Wochennavigation, die über
den Jahreswechsel trägt — und der Fehler wäre in einer Komponente unsichtbar, weil ein
Komponententest natürlicherweise eine Woche aus der Jahresmitte wählt.

**Dateien.** `packages/domain/src/planning-week.ts`, `packages/domain/src/index.ts`,
`packages/domain/test/planning-week.test.ts`, `apps/api/test/domain-invariants/registry.ts`,
`apps/api/test/domain-invariants/weitere-belege.test.ts`, `apps/api/test/iso-week-parity.test.ts`.

**AC.** Vorleistung für `AC-004` (`REQ-002`).

**Test.** `packages/domain/test/planning-week.test.ts` — je ein Positiv- und ein Negativtest pro
neuem Export, mit den Randvektoren aus **B3** und einem Sweep über 520 Verschiebungen ausgehend
von `2020-W01`.

> **Korrektur 18.08.2026 — die Vertragsprüfung des Sweeps zieht nach `apps/api` um.**
>
> _Nummernkreis:_ Befunde der Review-Korrekturrunde zu M2 heißen hier **K1–K7**, damit sie nicht
> mit den planeigenen Befunden **B1–B6** aus Abschnitt 0 verwechselt werden. **K1** unbelegte und
> an der oberen Jahresgrenze unwahre Ergebnisprüfung · **K2** ungewächterte zweite Kopie der
> ISO-Wochen-Konstruktion · **K3** Sweep prüft mit dem von EYT-88 verworfenen Muster · **K4** Sweep
> blind gegen eine gleichförmige Tagesverschiebung · **K5** drei Zusicherungen prüfen den
> Testhelfer statt der Produktion · **K6** Ablehnungstests in keinem Registerslot · **K7**
> irreführende Fehlermeldung beim Überlauf.
>
> _Zur Begründung von **K1**, präzisiert nach dem Watcher-Urteil vom 18.08.2026:_ die obere
> Jahresgrenze `MAX_ISO_JAHR = 9999` schützt **nicht** das Jahr 10000 — kein Nutzer plant
> jemals `9999-W52`. Ihr Wert ist ein anderer und ein messbarer: die Zeile
> `assertRealIsoWeek(verschoben, …)` war **unbelegt** — ersatzlos entfernt blieben alle 30
> Tests grün. Die Obergrenze ist die Stelle, an der diese Ergebnisprüfung überhaupt beißt;
> mit ihr wird aus Dekoration eine gemessene Zusicherung (gemessen: 2 rot). Wer diesen
> Absatz später liest, soll die Rechtfertigung an der **Messbarkeit** festmachen, nicht an
> einer Jahreszahl. Hätte K1 eine eigene Reviewrunde gekostet, wäre es fehlallozierter
> Aufwand gewesen; als eine Zeile in einer Runde, die auch K2–K4 schloss, ist es
> proportional. Die Commit-Botschaft von `697b488` ist bereits gepusht und formuliert es
> noch anders — maßgeblich ist dieser Absatz.
>
> Ursprünglich stand hier: „für 520 Verschiebungen … muss `formatIsoWeekKey`(Ergebnis) von
> `isValidIsoWeekKey` akzeptiert werden." **Diese Vorgabe ist an der genannten Stelle
> architektonisch nicht erfüllbar** — beide Funktionen liegen in `@easytree/contracts`, und
> `packages/domain` darf dieses Paket weder als Abhängigkeit führen noch importieren
> (`domain-allowlist` in `apps/api/test/architecture/rules.ts`; Begründung im Dateikopf von
> `packages/contracts/src/planning/schemas.ts`). Die Vorgabe wird **nicht gestrichen, sondern
> verlagert**: sie läuft wörtlich in `apps/api/test/iso-week-parity.test.ts` (Block „Sweep gegen
> isValidIsoWeekKey, nicht gegen ein Muster"), der einzigen Stelle, die beide Pakete sieht — dafür
> hat der PO in Scope-Revision 3 den Pfad freigegeben.
>
> Im Domainpaket bleibt eine reine **Formprüfung** per Regex zurück. Sie ist dort ausdrücklich als
> das gekennzeichnet, was sie ist: das Muster `^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$` lässt `W53` in
> **jedem** Jahr durch (gemessen: `2025-W53` und `2027-W53` bestehen es, der Vertrag lehnt beide
> ab) — genau der Grund, aus dem EYT-88 es verworfen hat. Der erste Umsetzungsversuch hatte es
> ohne diesen Hinweis eingesetzt und damit die Planvorgabe scheinbar erfüllt; das war der
> Korrekturbefund **K3**.
>
> Gleichfalls nach `apps/api` gehört seit **K2** die Messung der zweiten Kopie der
> ISO-Wochen-Konstruktion: `mondayOfIsoWeekMs` (Domain) gegen `montagDerIsoWoche` (Vertrag),
> Block „Rückrichtung" derselben Datei.

**Fertig, wenn — vier Zahlen, keine Prosa:**

```bash
pnpm --filter @easytree/domain exec vitest run test/planning-week.test.ts   # Exit 0, Test Files 1
pnpm --filter @easytree/config build && pnpm --filter @easytree/domain build
pnpm --filter @easytree/api exec vitest run test/domain-invariant-coverage.test.ts  # Exit 0
pnpm --filter @easytree/api exec vitest run test/iso-week-parity.test.ts            # Exit 0
pnpm --filter @easytree/api exec vitest run test/domain-invariants/weitere-belege.test.ts  # Exit 0
node -e 'const d=require("./packages/domain/dist/index.js");
 const k=d.planningWeekKey;
 console.log(k(d.shiftPlanningWeek({isoYear:2027,isoWeek:1},-1)));   // erwartet 2026-W53
 console.log(k(d.shiftPlanningWeek({isoYear:2026,isoWeek:53},1)));   // erwartet 2027-W01
 console.log(k(d.shiftPlanningWeek({isoYear:2025,isoWeek:52},1)));'  // erwartet 2026-W01
```

Die drei Zeilen müssen wörtlich `2026-W53`, `2027-W01`, `2026-W01` ausgeben.

**Gegenmutation — auszuführen, nicht auszudenken.** Nach dem Commit dieses Meilensteins
`shiftPlanningWeek` durch `{ isoYear: week.isoYear, isoWeek: week.isoWeek + delta }` ersetzen und
den Domain-Test laufen lassen: er **muss** rot werden und dabei den `2027-W01`-Fall nennen.
Danach zurücknehmen; Beleg ist der **auf die Datei eingegrenzte** leere Diff:

```bash
git diff --exit-code -- packages/domain/src/planning-week.ts   # Exit 0 nach der Rücknahme
```

**Ausgeführte Gegenmutationen der Korrekturrunde 18.08.2026** (eingespielt, gemessen,
zurückgenommen; Rücknahme je über `shasum -a 256` gegen die Sicherungskopie belegt):

| Mutation                                                                     | Vorher                                                     | Nachher                                                               |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `assertRealIsoWeek(verschoben, …)` in `shiftPlanningWeek` ersatzlos entfernt | 30/30 grün — die Zeile war unbelegt (**K1**)               | 2 rot: Überlauf- und Jahresgrenzentest                                |
| Montagsanker `+ DAY_MS` in `mondayOfIsoWeekMs`                               | Sweep grün, nur die drei Fixtures rot (**K4**)             | Sweep rot bei `2020-W01`; ohne die neue `dayBefore`-Zeile wieder grün |
| derselbe Anker, gemessen in `apps/api/test/iso-week-parity.test.ts`          | alle Paritätstests grün — Rückrichtung ungemessen (**K2**) | 2 rot: „grenzt … exakt ab" und „legt den 4. Januar in Woche 1"        |
| Titel in `weitereBelege` verfälscht                                          | Registerbeleg ungewächtert (**K6**)                        | `weitere-belege.test.ts` rot, nennt Export, Titel und Datei           |

**Risiko.** Der Registereintrag verlangt einen echten Negativtest — „erwartet einen Fehler" ist
keiner; er muss die Invariante **widerlegen**, wenn sie nicht gilt. **Rücknahme:** `git revert`
des Meilenstein-Commits; nichts anderes hängt zu diesem Zeitpunkt daran.

---

### M3 — Reine Ableitung an der Web-Grenze

**Was.** `apps/web/lib/wochennavigation.ts` mit genau einer exportierten Funktion:

```
wochenmodell({ weekKeyAusUrl: string | string[] | undefined, jetzt: Date, zone: IanaTimeZone })
  → { art: "fehlerhaft" }
  | { art: "woche", schluessel, isoWochenText, zeitraumText, vorherigeUrl, naechsteUrl,
      heuteUrl, istAktuelleWoche }
```

Kein React, keine Uhr, kein `Intl`. Parsen über `parseIsoWeekKey` (contracts), Rechnen über
`shiftPlanningWeek`/`planningWeekDateRange` (domain), „heute" über
`isoWeekOfLocalDate(localBusinessDate(jetzt, zone))`. Mehrfach angegebener Parameter bleibt
`fehlerhaft` — die bestehende Regel aus `page.tsx` wird übernommen, nicht aufgeweicht.

**Warum getrennt von der Komponente.** Diese Funktion ist der Ort, an dem `AC-003` und `AC-004`
messbar werden, ohne dass ein DOM nötig ist. Läge sie in der Komponente, prüfte jeder Test die
Rechnung durch die Darstellung hindurch — und ein Darstellungsfehler wäre von einem Rechenfehler
nicht zu unterscheiden.

**Dateien.** `apps/web/lib/wochennavigation.ts`, `apps/web/test/wochennavigation.test.ts`.

**AC.** `AC-003`, `AC-004` (`REQ-002`).

**Test.** `apps/web/test/wochennavigation.test.ts`.

**Fertig, wenn:**

```bash
pnpm --filter @easytree/web exec vitest run test/wochennavigation.test.ts   # Exit 0
grep -c -E "toLocaleDateString|toLocaleString|Intl\.|new Date\(\)" apps/web/lib/wochennavigation.ts  # 0
```

Der Lauf muss `Test Files  1 passed` melden — ein Pfadfilter, der nichts trifft, beendet sich
ebenfalls mit 0 und hätte nichts geprüft.

**Risiko.** Zwei Wochenregeln entstehen, wenn hier eigene Arithmetik landet statt eines Aufrufs
in den Domain. **Gegenmaßnahme:**
`grep -c -E "getUTCDay|86_?400_?000|isoWeek [+-]" apps/web/lib/wochennavigation.ts` → `0`.
**Rücknahme:** Datei löschen, M4 hängt noch nicht daran.

---

### M4 — Die Wochennavigation als Komponente

**Was.** `apps/web/components/wochen-navigation.tsx` — Client-Komponente, bekommt das in M3
berechnete Modell **als Prop**. Rendert `<nav aria-label="Wochennavigation">` mit „vorherige
Woche", „Heute", „nächste Woche" als `next/link` sowie ISO-Woche und Datumsbereich als Text.
`data-testid`: `wochennavigation`, `wochennavigation-vorherige`, `wochennavigation-heute`,
`wochennavigation-naechste`, `wochennavigation-woche`, `wochennavigation-zeitraum`. Die aktuelle
Woche ist zusätzlich über Text kenntlich, nicht nur über Farbe.

**Warum `Link` und nicht `router.push`.** Ein `<a href>` ist mit der Tastatur bedienbar, im
Kontextmenü teilbar und braucht kein JavaScript, um ein Ziel zu haben. `AC-019` (Tastatur) fällt
damit ohne Zusatzarbeit an; ein `onClick`-Button müsste sie nachbauen.

**Dateien.** `apps/web/components/wochen-navigation.tsx`,
`apps/web/test/wochen-navigation.test.tsx`.

**AC.** `AC-004` (`REQ-002`).

**Test.** `apps/web/test/wochen-navigation.test.tsx`.

**Fertig, wenn:**

```bash
pnpm --filter @easytree/web exec vitest run test/wochen-navigation.test.tsx   # Exit 0
grep -c -E "new Date\(\)|shiftPlanningWeek|parseIsoWeekKey" apps/web/components/wochen-navigation.tsx  # 0
```

Die zweite Zahl ist die eigentliche Zusicherung: die Komponente **rechnet nicht**, sie zeigt.

**Risiko.** Die `href`-Werte werden im Test gegen selbst gebaute Konstanten verglichen — dann
prüft der Test seine eigene Reimplementierung. **Gegenmaßnahme:** der Test übergibt ein Modell
mit erkennbar erfundenen URLs (`"/planung?weekKey=SENTINEL-VOR"`) und prüft, dass **genau diese**
im DOM stehen; die echten URLs sind in M3 geprüft. **Rücknahme:** Datei löschen.

---

### M5 — `/planung` ohne Parameter zeigt die aktuelle Woche

**Was.** `apps/web/app/planung/page.tsx` liest den Zeitpunkt (`new Date()` — die **einzige**
Uhrzeit-Lesestelle, **E3**), ruft `wochenmodell(...)` mit `EUROPE_BERLIN` und reicht das Modell
plus den Wochenschlüssel als serialisierbare Werte an die Client-Grenze. Der Fehlerzweig bleibt
wörtlich erhalten (**E2**, **B5**): vorhandener, aber ungültiger Parameter → weiterhin
`planungsfenster-parameterfehler`, Gateway ungerufen. Der veraltete Kommentar „Eine
Wochennavigation bleibt EYT-72" wird durch die tatsächliche Begründung ersetzt.

**Warum hier und nicht in einer Client-Komponente.** Die Seite ist bereits eine
Server-Komponente, und nur eine Zeichenkette bzw. ein einfaches Objekt darf die Grenze
überqueren — eine Funktion nicht. Genau daran ist EYT-107 schon einmal gescheitert, und weder
`typecheck` noch `build-web` noch der jsdom-Test haben es gemerkt; rot wurde erst `auth-journey`.
Das Modell aus M3 ist ein reines Datenobjekt und überquert die Grenze problemlos.

**Dateien.** `apps/web/app/planung/page.tsx`, `apps/web/test/planung-page.test.tsx`.

**AC.** `AC-003` (`REQ-002`), Erhalt von `AC-005` (`REQ-003`).

**Test.** `apps/web/test/planung-page.test.tsx` — bestehende Fälle bleiben, neue Fälle: ohne
Parameter wird das Gateway mit dem Schlüssel der aktuellen Woche gerufen; mit `?weekKey=2026-W54`
wird es **nicht** gerufen und der Parameterfehler steht im DOM.

**Fertig, wenn:**

```bash
pnpm --filter @easytree/web exec vitest run test/planung-page.test.tsx      # Exit 0
grep -c "new Date()" apps/web/app/planung/page.tsx                          # genau 1
grep -c "new Date()" apps/web/components/wochen-navigation.tsx apps/web/lib/wochennavigation.ts apps/web/components/planungs-werkbank.tsx  # je 0
grep -c "planungsfenster-parameterfehler" apps/web/app/planung/page.tsx     # ≥ 1
```

**Risiko A.** Ein Uhrzeit-Lesevorgang in einer Server-Komponente macht die Route dynamisch; Next
könnte sie sonst vorrendern und die Woche würde einfrieren. **Gegenmaßnahme:** `build-web` lokal
laufen lassen (`EASYTREE_API_PROXY_TARGET=http://127.0.0.1:3001 pnpm --filter @easytree/web... build`)
und in der Ausgabe prüfen, dass `/planung` **nicht** als statisch geführt wird. Falls doch, wird
das Dynamik-Verhalten explizit erzwungen und der Grund im Dateikopf notiert.

**Risiko B.** Der Testzeitpunkt driftet: ein Test, der `new Date()` nicht kontrolliert, wechselt
jede Woche sein Erwartungswert. **Gegenmaßnahme:** `vi.setSystemTime` mit einem festen Instant im
Test; das Produktionsverhalten bleibt unberührt.

**Rücknahme:** `git revert` dieses Meilensteins stellt die parametrische Seite wieder her; M2–M4
bleiben nutzbar und ungenutzt.

---

### M6 — Der Werkbankrahmen

**Was.** `apps/web/components/planungs-werkbank.tsx` fasst zusammen, was heute
`planung-ansicht.tsx` lose aneinanderreiht: `PageHeader` mit dem Wochentitel, darunter die
`WochenNavigation`, darunter das bestehende `PlanningWindowView`. `planung-ansicht.tsx` wird auf
die Werkbank umgestellt und behält seine Rolle als Client-Seite des Zugangswächters — der
gemessene Grund für seine Existenz (Server-/Client-Grenze) bleibt unverändert gültig.
`globals.css` bekommt die nötigen Klassen; **keine neuen Farbliterale**, nur bestehende Tokens.

**Warum nach M5.** Vorher gäbe es keine Woche, um die der Rahmen gebaut werden könnte.

**Dateien.** `apps/web/components/planungs-werkbank.tsx`,
`apps/web/components/planung-ansicht.tsx`, `apps/web/app/globals.css`,
`apps/web/test/planungs-werkbank.test.tsx`.

**AC.** `AC-003`, `AC-004`; Jira-AC „Woche und Zeitraum sind aus der Oberfläche verständlich
navigierbar".

**Test.** `apps/web/test/planungs-werkbank.test.tsx`.

**Fertig, wenn:**

```bash
pnpm --filter @easytree/web exec vitest run test/planungs-werkbank.test.tsx   # Exit 0
pnpm --filter @easytree/web exec vitest run test/a11y.test.tsx                # Exit 0
grep -c -E "#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(" apps/web/components/planungs-werkbank.tsx apps/web/components/wochen-navigation.tsx  # je 0
```

Zusätzlich prüft der Test, dass die Fläche **genau einen** als primär ausgezeichneten CTA trägt
(gezählt, nicht besichtigt: `getAllByTestId("primaeraktion")` hat Länge `1`).

**Risiko.** Ein entfernter oder umbenannter `data-testid` bricht die Playwright-Reisen still —
Playwright läuft nicht in `pnpm test` (**B5**). **Gegenmaßnahme:** vor jeder Umbenennung
repo-weit greppen; in diesem Meilenstein werden `data-testid`s **nur ergänzt**, nie entfernt.
Belegt durch:

```bash
git diff -U0 -- apps/web/components/ | grep -E '^-.*data-testid'   # muss leer sein
```

**Rücknahme:** `git revert`; `planung-ansicht.tsx` fällt auf die direkte Einbindung zurück.

---

### M7 — Entwurf/veröffentlicht sichtbar unterscheiden und die Rückbestätigung belegen

**Was.** Zwei Bindungen an bestehende Fähigkeiten, **kein Neubau**:

1. `REQ-005`/`AC-008`: `planning-window-view.tsx` zeigt den Stand heute als Text mit
   `data-stand`. Ergänzt wird ein `StatusBadge` aus `@easytree/ui`, sodass der Unterschied
   Entwurf/veröffentlicht **zusätzlich** über Form und Symbol trägt und nicht nur über Farbe
   (`AC-018`). Der bestehende Text und `data-stand` bleiben unverändert — daran hängen Reisen.
2. `REQ-004`/`AC-007`: der Erfolgspfad lädt bereits automatisch nach (**B4**). Zu liefern ist der
   **Nachweis**: ein Test, der nach erfolgreichem Speichern belegt, dass das Gateway erneut
   gerufen wird und die angezeigte Zuweisung die **serverseitige** ID trägt — nicht die vom
   Client gesendeten Werte.

**Warum kein Umbau des `STALE_VERSION`-Zweigs.** `AC-007` ist auf den Erfolgspfad gestellt. Der
manuelle Hinweistext bei `STALE_VERSION` bleibt; ihn zu automatisieren wäre neue Fachbreite und
gehört nicht in diesen Slice. **Als Befund notiert, nicht still entschieden.**

**Dateien.** `apps/web/components/planning-window-view.tsx`,
`apps/web/test/planning-window-view.test.tsx`.

**AC.** `AC-007` (`REQ-004`), `AC-008` (`REQ-005`), `AC-018` mittelbar.

**Test.** `apps/web/test/planning-window-view.test.tsx`.

**Fertig, wenn:**

```bash
pnpm --filter @easytree/web exec vitest run test/planning-window-view.test.tsx   # Exit 0
```

und der Test die Zahl der `getPlanningWindow`-Aufrufe **zählt**: `1` vor dem Speichern, `2`
danach.

**Gegenmutation — auszuführen.** Nach dem Commit die Zeile `setNachladen((n) => n + 1)` im
Erfolgszweig von `speichern` entfernen. Der Test **muss** rot werden und dabei `2` gegen `1`
melden. Danach zurücknehmen:

```bash
git diff --exit-code -- apps/web/components/planning-window-view.tsx   # Exit 0 nach der Rücknahme
```

**Risiko.** Der Test bestätigt einen Rundlauf, ohne die Herkunft der ID zu prüfen — dann bewiese
er nichts über „Serverstand". **Gegenmaßnahme:** die Attrappe gibt beim zweiten Aufruf eine
Zuweisung mit einer ID zurück, die der Client **nie gesendet hat**; genau diese muss im DOM
stehen.

**Rücknahme:** `git revert`; die bestehende Fähigkeit bleibt unangetastet, nur ihr Nachweis
verschwindet.

---

### M8 — Der Kostenübergang aus der Planung heraus

**Was.** `apps/web/components/kosten-uebergang.tsx` — ein Übergang zu `/kosten`, der
**ausschließlich** mit `costs.read` aus der realen Session gerendert wird und den Bezug zur
gerade veröffentlichten Woche im Text trägt. Eingehängt in die Werkbank. Die Autorisierung bleibt
serverseitig; dieser Übergang steuert **nur** die Sichtbarkeit — dieselbe Regel, die
`app-shell.tsx` für die Navigation schon anwendet.

**Warum das kein Leck ist.** `AC-011` verlangt, dass ohne `costs.read` weder Beträge noch der
Kostennavigationslink in der **Serverantwort** stehen — HTML und RSC-Flight-Payload eingeschlossen,
weil Props einer Client-Komponente im Payload landen, auch wenn der Wächter sie nie rendert. Hier
entsteht der Übergang aus Sitzungsdaten, die der Client zur Laufzeit holt, **nicht** aus einer
Server-Prop. Es gibt also nichts, was in den Payload gelangen könnte. Diese Begründung ist im
Dateikopf zu notieren, damit sie bei der nächsten Änderung nicht verloren geht.

**Dateien.** `apps/web/components/kosten-uebergang.tsx`,
`apps/web/test/kosten-uebergang.test.tsx`, `apps/web/components/planungs-werkbank.tsx` (Einhängen).

**AC.** `AC-010`, `AC-011` (`REQ-006`); Jira-AC „`costs.read` steuert ausschließlich die
Sichtbarkeit des Kostenübergangs".

**Test.** `apps/web/test/kosten-uebergang.test.tsx`.

**Fertig, wenn:**

```bash
pnpm --filter @easytree/web exec vitest run test/kosten-uebergang.test.tsx   # Exit 0
```

und der Negativfall **den ausgelieferten Text prüft, nicht die Sichtbarkeit**: bei einer Session
ohne `costs.read` enthält `container.innerHTML` weder `"/kosten"` noch die Testid des Übergangs —
belegt durch zwei `expect(...).not.toContain(...)`, nicht durch `not.toBeVisible()`.

**Risiko A.** Ein `display:none`-Wächter erfüllt einen Sichtbarkeitstest und trüge den Wert
trotzdem aus. **Gegenmaßnahme:** siehe Fertigkriterium — geprüft wird das Markup.

**Risiko B.** Der Org-Header-Rennfall (`OQ-010`/`RISK-007`/`AC-040`): das `CostsGateway` liest die
Organisation aus einer Ref, die ein Eltern-Effekt füllt. **Dieser Slice ruft das CostsGateway
nicht** — er verlinkt nur nach `/kosten`. Der Rennfall bleibt damit außerhalb von EYT-140;
`AC-040` gehört zur Kostenfläche. **Ausdrücklich als nicht geplant vermerkt.**

**Rücknahme:** `git revert`; die Kostenroute bleibt über die Shell-Navigation erreichbar wie
bisher.

---

### M9 — Abschlussgate und Traceability

**Was.** Vollständiges Gate ohne Cache, Formatprüfung, und der Nachtrag in `docs/traceability.md`:
`TRC-S6-002` trägt heute die Klasse „Gegenmutation benannt, aber der Test muss erst erstellt
werden". Nach M2–M6 existiert der Test — die Zeile bekommt den **tatsächlichen** Dateinamen und
den **wörtlichen** Testtitel. Erfunden wird nichts; eingetragen wird, was gemessen wurde.

**Dateien.** `docs/traceability.md`, `docs/plans/2026-08-18-eyt-140-planungswerkbank.md`
(Fortschrittsvermerke).

**AC.** Abnahmevoraussetzung für `REQ-002`.

**Fertig, wenn:**

```bash
pnpm exec prettier --check apps packages docs                       # Exit 0
pnpm exec turbo run lint typecheck test --force                     # Exit 0, "Cached: 0 cached"
EASYTREE_API_PROXY_TARGET=http://127.0.0.1:3001 pnpm --filter @easytree/web... build   # Exit 0
pnpm --filter @easytree/api... build                                # Exit 0
grep -rnE "TODO|TOOL_GAP|FIXME|XXX" \
  packages/domain/src/planning-week.ts apps/web/lib/wochennavigation.ts \
  apps/web/components/wochen-navigation.tsx apps/web/components/planungs-werkbank.tsx \
  apps/web/components/kosten-uebergang.tsx apps/web/app/planung/page.tsx   # kein Treffer
```

Die letzte Prüfung läuft über die **Lieferbestandteile**, nicht über diese Plandatei: der Plan
benennt offene Fragen (`OQ-002` und Verwandte) absichtlich beim Namen, und ein Wortfilter über
Prosa würde genau diese Ehrlichkeit als Blocker melden.

Und der Traceability-Nachtrag ist belegt, nicht behauptet: der dort genannte Testtitel muss
wörtlich in der dort genannten Datei stehen —

```bash
grep -cF "<eingetragener Testtitel>" apps/web/test/wochennavigation.test.ts   # ≥ 1
```

**Risiko.** `pnpm format` meldet lokal Dateien, die CI nie sieht (untracked `penpot/`,
`_sprint2-transfer/`). **Gegenmaßnahme:** die Prüfung ist oben bereits auf `apps packages docs`
eingegrenzt. Zweites Risiko: `pnpm build` an der Repowurzel schlägt vorbestehend fehl, weil
`turbo.json` für `build` kein `env` deklariert — deshalb stehen oben die beiden
paketgefilterten Aufrufe und nicht `pnpm build`.

**Rücknahme:** entfällt — dieser Meilenstein fügt keinen Produktionscode hinzu.

---

## Reihenfolgebegründung

**Die naheliegende Reihenfolge wäre: zuerst die sichtbare Wochennavigation, dann die Rechnung
darunter. Sie ist falsch, und zwar messbar.**

1. **Arithmetik vor Bedienelement (M2 vor M4).** Ein Blätter-Button, der `isoWeek ± 1` rechnet,
   ist in der Jahresmitte fehlerfrei und an genau drei Stellen im Jahr kaputt (**B3**). Ein
   Komponententest wählt naturgemäß eine Woche aus der Jahresmitte und bliebe grün. Der Fehler
   fiele erst einer Planerin im Dezember auf — als Parameterfehler, ohne erkennbaren Zusammenhang
   zum Blättern. Deshalb entsteht die Verschiebung zuerst, in dem Paket, das die Kalenderregel
   ohnehin besitzt, mit den Randvektoren als Pflichtfall.
2. **Ableitung vor Darstellung (M3 vor M4).** Läge die Rechnung in der Komponente, prüfte jeder
   Test sie durch ein DOM hindurch, und ein Darstellungsfehler wäre von einem Rechenfehler nicht
   zu unterscheiden. Getrennt ist jede Hälfte einzeln widerlegbar.
3. **Standardwoche vor Rahmen (M5 vor M6).** „Heute" braucht ein definiertes Ziel, bevor ein
   Rahmen es anzeigen kann. Und die Uhrzeit-Lesestelle muss **einmal** festgelegt sein, bevor
   drei Komponenten unabhängig voneinander `new Date()` aufrufen — danach ist das nicht mehr
   einsammelbar.
4. **Neubau vor Bindung (M2–M6 vor M7–M8).** `REQ-004`, `REQ-005` und `REQ-006` sind vorhandene
   Fähigkeiten; ihre Aufgabe ist, **in der Werkbank** zugänglich und an Evidenz gebunden zu sein.
   Ohne Werkbank gibt es nichts, woran sie gebunden werden könnten — die Tests würden gegen die
   alte Seite geschrieben und müssten in M6 erneut angefasst werden.
5. **Messung vor allem (M1 zuerst).** Ein Turbo-Replay meldet Grün, ohne gelaufen zu sein, und
   der Cache greift über Worktrees. Ohne erzwungene Ausgangsmessung wäre jedes spätere Rot nicht
   zuordenbar — und die häufigste Reaktion darauf, „das war schon vorher so", wäre unbelegt.

**Was ausdrücklich NICHT vorangestellt wird:** die Basisdesign-Ausarbeitung. Sie steht in
EYT-141, und **B6** zeigt, warum ihr Vorziehen teuer wäre: es gibt heute genau ein Abstandstoken,
`packages/ui/src/` benutzt gar keine Tokens, und ein 8-pt-Raster über Tokens ist ohne
Vokabularerweiterung nicht abbildbar. Diese Erweiterung ist eine eigene Entscheidung mit eigenem
Wächter (`AC-037`) — sie in EYT-140 mitzuschleppen hieße, zwei Slices zu verkoppeln, von denen
nur einer beauftragt ist.

---

## Risiken über den ganzen Schnitt

| ID  | Risiko                                                                                                  | Wirkung                                               | Gegenmaßnahme / Rücknahme                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `ASM-001` ist nicht gemessen; die tragenden Schreib-/Publish-/Snapshot-Pfade sind für Sprint 6 unbelegt | jede Aussage über M7/M8 hängt in der Luft             | M1 benennt es; die CI-Messung ist Vorbedingung des Orchestrators. Ohne sie **keine** Fertigmeldung für `REQ-004`/`REQ-005`                                                               |
| R2  | Playwright-Reisen brechen still, weil ein `data-testid` verschwindet (**B5**)                           | roter CI-Lauf statt roter lokaler Test                | `data-testid`s werden nur ergänzt; `git diff -U0 \| grep '^-.*data-testid'` muss leer sein (M6)                                                                                          |
| R3  | Turbo-Replay täuscht Grün vor                                                                           | falsche Evidenz in Commit und Bericht                 | jede Beweiszahl mit `--force`, `Cached: 0 cached` mitlesen (M1, M9)                                                                                                                      |
| R4  | Ein `vitest`-Pfadfilter trifft nichts und beendet sich mit 0                                            | ein Meilenstein gilt als fertig, ohne geprüft zu sein | jedes Fertigkriterium liest zusätzlich `Test Files  N passed`                                                                                                                            |
| R5  | Der Uhrzeit-Lesevorgang macht `/planung` dynamisch oder wird vorgerendert eingefroren                   | die „aktuelle Woche" friert ein                       | `build-web` lokal, Renderklasse von `/planung` prüfen (M5, Risiko A)                                                                                                                     |
| R6  | Der parallel arbeitende Agent legt unter `apps/web/test/` eine Datei gleichen Namens an                 | Kollision oder stilles Überschreiben                  | Dateien dieses Plans tragen eigene Namen (`wochennavigation`, `wochen-navigation`, `planungs-werkbank`, `kosten-uebergang`); eine bereits vorhandene Datei wird **ergänzt**, nie ersetzt |
| R7  | Ein neuer Domain-Export ohne Registereintrag lässt `apps/api` rot zurück (**B2**)                       | roter Commit                                          | Export und Registereintrag liegen in **einem** Meilenstein (M2)                                                                                                                          |
| R8  | `apps/api`-Tests lesen ein veraltetes `contracts`/`domain`-`dist`                                       | grüner Einzeltest, der nichts misst                   | vor den API-Prüfungen in M2 explizit `pnpm --filter @easytree/domain build`                                                                                                              |
| R9  | Eine Gegenmutation wird benannt, aber nie ausgeführt                                                    | der Test bleibt Ausführungsnachweis, kein Beweis      | M2 und M7 verlangen Einspielen, Messen, Zurücknehmen und den auf die Datei eingegrenzten leeren `diff`                                                                                   |

**Globale Rücknahme.** Jeder Meilenstein ist ein eigener Commit auf
`feat/eyt-140-planungswerkbank`; `git revert <sha>` eines Meilensteins lässt die vorhergehenden
funktionsfähig. Der einzige nicht isoliert rücknehmbare Punkt ist M2 (Domain-Export +
Registereintrag) — er ist deshalb bewusst **ein** Commit.

---

## Berührte Dateien

```plumbline-touches
packages/domain/src/planning-week.ts
packages/domain/src/index.ts
packages/domain/test/planning-week.test.ts
apps/api/test/domain-invariants/registry.ts
apps/web/lib/wochennavigation.ts
apps/web/test/wochennavigation.test.ts
apps/web/components/wochen-navigation.tsx
apps/web/test/wochen-navigation.test.tsx
apps/web/app/planung/page.tsx
apps/web/test/planung-page.test.tsx
apps/web/components/planungs-werkbank.tsx
apps/web/test/planungs-werkbank.test.tsx
apps/web/components/planung-ansicht.tsx
apps/web/components/planning-window-view.tsx
apps/web/test/planning-window-view.test.tsx
apps/web/components/kosten-uebergang.tsx
apps/web/test/kosten-uebergang.test.tsx
apps/web/app/globals.css
docs/traceability.md
docs/plans/2026-08-18-eyt-140-planungswerkbank.md
```

### Datei-Deklarationen

Modify: `packages/domain/src/planning-week.ts`

Modify: `packages/domain/src/index.ts`

Modify: `packages/domain/test/planning-week.test.ts`

Modify: `apps/api/test/domain-invariants/registry.ts`

Create: `apps/web/lib/wochennavigation.ts`

Create: `apps/web/test/wochennavigation.test.ts`

Create: `apps/web/components/wochen-navigation.tsx`

Create: `apps/web/test/wochen-navigation.test.tsx`

Modify: `apps/web/app/planung/page.tsx`

Modify: `apps/web/test/planung-page.test.tsx`

Create: `apps/web/components/planungs-werkbank.tsx`

Create: `apps/web/test/planungs-werkbank.test.tsx`

Modify: `apps/web/components/planung-ansicht.tsx`

Modify: `apps/web/components/planning-window-view.tsx`

Modify: `apps/web/test/planning-window-view.test.tsx`

Create: `apps/web/components/kosten-uebergang.tsx`

Create: `apps/web/test/kosten-uebergang.test.tsx`

Modify: `apps/web/app/globals.css`

Modify: `docs/traceability.md`

Create: `docs/plans/2026-08-18-eyt-140-planungswerkbank.md`

**20 Dateien, deckungsgleich zwischen Block und Deklarationsliste.** Keine Datei unter
`apps/web/e2e/` — die Browserreisen gehören EYT-142 und dem parallel arbeitenden Agenten. Keine
Datei unter `supabase/`, `apps/api/src/` oder `packages/contracts/src/` — dieser Slice ändert
weder Schema noch Vertrag noch Serververhalten.

---

## Was dieser Plan bewusst NICHT enthält

- **Token-Wächter und 8-pt-Raster** (`AC-016`, `AC-037`, `AC-038`) — `REQ-009`, EYT-141. Befund
  **B6** ist an EYT-141 adressiert.
- **Ein `DateRangeControl` in `packages/ui`** — Begründung **E5**; Koordinationsnotiz an EYT-141.
- **Die fünf adressierbaren Zustände je Fläche** (`AC-039`) — `REQ-010`, EYT-141. Die bestehenden
  Zustände von `planning-window-view.tsx` und `planung-zugang.tsx` bleiben unverändert erhalten.
- **`AC-040`** (Org-Header beim ersten Kostenrequest) — dieser Slice ruft das `CostsGateway` nicht.
- **Der `STALE_VERSION`-Automatismus** — Begründung **B4**; `AC-007` betrifft den Erfolgspfad.
- **Staging, Cloudflare, Rollback-Evidenz** (`REQ-012`–`REQ-017`) — EYT-142, blockiert durch
  `OQ-002`/`OQ-003`/`OQ-004`.
- **Kosten-UI jenseits des Übergangs** — `REQ-007`/`REQ-008` sind bestehende Fähigkeiten und
  gehören nicht zu EYT-140.
- **Jede Änderung an `supabase/`, `packages/contracts/src/` oder `apps/api/src/`** — keine neue
  Domainregel, kein Vertragszuwachs, keine Migration.
