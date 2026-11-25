# EYT-109 — Multi-Org-Kontext bis zu den Planungsabfragen durchreichen

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ein serverseitig bereits aufgeloester Organisationskontext (aus `CostAccessPolicy`)
wird bis in die Planungsabfragen durchgereicht, sodass ein Benutzer mit mehreren aktiven
Mitgliedschaften deterministisch genau in EINER Organisation liest — ohne dass RLS aufhoert,
die Sicherheitsautoritaet zu sein, und ohne dass bestehende Einzel-Organisations-Aufrufer
umgebaut werden muessen.

**Architecture:** Die Bindung entsteht bei der KONSTRUKTION des Leserepositorys, nicht als
Methodenparameter und nicht im `TenantContext`. `PlanningQueriesFactory` bekommt ein zweites,
optionales Argument; `PlanningWindowRepository` traegt es als `private readonly organisationId`
und verengt damit ausschliesslich die ohnehin RLS-sichtbare Organisationsmenge. Das Kostenmodul
bekommt eine eigene Fabrik (`PLAN_COST_FACTS_FACTORY`), deren Organisationsargument **nicht
optional** ist — der Compiler verhindert damit, dass Task 13 den bereits aufgeloesten Kontext
verliert.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`),
NestJS DI, `pg` ueber `TenantQueryRunner`, Vitest (SWC), PostgreSQL + RLS im CI-Job `db-gates`.

---

## Ausgangszustand (gemessen 12.08.2026, vor jeder Aenderung)

| Feld | Wert |
| --- | --- |
| Base (`origin/master`) | `b44e38c6bf7e08a2996c2263309001a1304050f2` |
| PR-Head (`origin/feat/eyt-109-daily-plan-cost-snapshot`) | `61fb4b8458ed81c5ef1a2ebcd5f95350236cdd0a` |
| behind / ahead vs. `origin/master` | 0 behind / 34 ahead (`merge-base` == Base) |
| PR #69 | OPEN, `isDraft: true`, `mergeable: MERGEABLE` |
| Lokaler Branch bei Planerstellung | `fix/eyt-136-planning-data-api-boundary` @ `60a3ce3` — **nicht** der PR-Branch |

**Kein HEAD_DRIFT.** Der erwartete Head stimmt exakt.

Nachmessen (Pflicht, bevor Task 0 startet — approbierte Staende sind SHA-gebunden):

```bash
git fetch --all --prune
gh pr view 69 --json headRefOid,isDraft,mergeable,baseRefName
git rev-parse origin/master
git rev-list --left-right --count origin/master...origin/feat/eyt-109-daily-plan-cost-snapshot
```

Erwartet: `headRefOid == 61fb4b8458ed81c5ef1a2ebcd5f95350236cdd0a`, `isDraft == true`,
`origin/master == b44e38c…`, `0	34`.
Weicht irgendetwas davon ab: **STOP, `HEAD_DRIFT` melden**, nicht implementieren.

---

## Root Cause — wo die serverseitige Organisationsauswahl heute verloren geht

Die Kette hat genau eine Bruchstelle, und sie ist eine Signatur:

1. `apps/api/src/modules/costs/interface/http/costs.controller.ts:228-280` — `zugang()` ruft
   `this.policy.authorize(mitgliedschaften, organisationHeader ?? null, permission)` und bekommt
   bei Erfolg `entscheidung.organisationId`. **Diese Id ist serverseitig aufgeloest**: sie stammt
   aus `memberships`, nicht aus dem Header. Der Header waehlt nur aus
   (`MembershipCostAccessPolicy.authorize`, `cost-access.policy.ts:73-98`) — eine nicht
   vorhandene Mitgliedschaft ergibt `ORG_NOT_A_MEMBER`.
2. `apps/api/src/modules/planning/application/planning-queries.factory.ts:19` —
   `export type PlanningQueriesFactory = (subjectUserId: string) => PlanningQueries;`
   **Hier faellt die Organisation weg.** Es gibt kein zweites Argument.
3. `apps/api/src/app.module.ts:178-181` — die Fabrik baut folgerichtig
   `new PlanningWindowRepository(runner, subjectUserId)`.
4. `apps/api/src/modules/planning/infrastructure/planning-window.repository.ts:305-313` —
   `organisationOf()` liest `select id, time_zone from public.organizations` **ohne jede
   Einschraenkung**. RLS liefert alle Organisationen der aktiven Mitgliedschaften; bei zwei
   Mitgliedschaften sind das zwei Zeilen, und Zeile 309 antwortet `AMBIGUOUS_ORGANISATION`.
   `planningWindow()` (Zeilen 93-101) traegt denselben Block noch einmal inline.
5. `apps/api/src/modules/costs/infrastructure/planning-facts.adapter.ts:99` —
   `constructor(private readonly planning: PlanningQueries)`. Der Adapter kann nichts
   weiterreichen, was ihm nie gegeben wurde. Er ist heute **in keiner Produktionswurzel
   verdrahtet** (`git grep PlanningFactsAdapter` findet ausserhalb der Tests nur `costs/index.ts`).

Ergebnis: Kostenautorisierung kennt die Organisation, Planungsfakten kennen sie nicht. Fuer einen
Multi-Org-Benutzer endet jeder Kostenpfad in `AMBIGUOUS_ORGANISATION`, obwohl die Auswahl
serverseitig laengst getroffen war.

---

## Designentscheidungen (verbindlich fuer die Umsetzung)

**D1 — Die Bindung steht am Konstruktor, nicht im `TenantContext` und nicht in der Portsignatur.**
`TenantContext` ist das, was die DATENBANK erwartet (`request.jwt.claims`). Eine Organisation dort
hineinzuschreiben legte nahe, dass der Runner damit etwas tut — also Sitzungs- oder JWT-Zustand
mutiert. Das ist ausdruecklich verboten. Die Verengung auf eine bereits sichtbare Organisation ist
eine Anwendungsentscheidung und gehoert deshalb an das Repository. Die Portsignaturen
(`planningWindow(weekKey)`, `publishedVersions(from,to)`, `publishedAssignments(id)`) bleiben
**unveraendert** — der Kommentar in `planning-queries.port.ts:10-12` („Ein Parameter `orgId` waere
die Einladung, ihn aus der URL zu befuellen") bleibt damit woertlich wahr.

**D2 — Zwei getrennte SQL-Zweige statt einer Query mit `$1 is null or …`.**
Der ungebundene Zweig behaelt seinen heutigen Text **byteweise**. Das ist kein Stil: der
`read-through`-Lauf und die bestehenden Integrationsfaelle messen genau dieses Statement, und ein
umgeschriebenes SQL wuerde eine bestehende Zusage stillschweigend gegen eine neue tauschen. Der
gebundene Zweig ist ein zweites, offensichtlich parametrisiertes Statement.

**D3 — Vergleich ueber `id::text = $1`, nicht `id = $1::uuid`.**
Ein `::uuid`-Cast auf eine nicht wohlgeformte Eingabe wirft SQLSTATE 22P02 — der Ausfallweg waere
dann eine Ausnahme statt eines Ergebnisses, und M5/M7 muessten auf einen Wurf pruefen statt auf
`NO_ORGANISATION`. Ueber Text vergleicht die Abfrage schlicht mit nichts und liefert null Zeilen:
fail-closed als normales Ergebnis. Die Tabelle traegt unter RLS hoechstens eine Handvoll Zeilen,
der verlorene Index ist ohne Wirkung.

**D4 — Eine unbekannte oder nicht sichtbare Organisation ergibt `NO_ORGANISATION`.**
Kein neuer Fehlercode. Begruendung: (a) fachlich korrekt — in dem angefragten Kontext gibt es keine
nutzbare Mitgliedschaft, exakt wie bei einem Subjekt ganz ohne Mitgliedschaft; (b) ein neuer Code
wuerde `PlanningQueryProblem` verbreitern und ueber `PlanCostFactsProblem`,
`costs-error-type.ts` bis in den Vertrag kaskadieren — das waere eine neue Fachregel und ist
ausserhalb des Slice; (c) „existiert nicht" und „du gehoerst nicht dazu" bleiben ununterscheidbar,
wie bei `PLAN_VERSION_NOT_FOUND` schon entschieden.

**D5 — `planningWindow()` benutzt denselben `organisationOf()`.**
Sonst haette eine gebundene Repository-Instanz eine von drei Methoden, die die Bindung ignoriert —
und genau das ist der Fehler, den GM-MO-1 sucht. Der ungebundene Pfad bleibt verhaltensgleich, weil
der inline-Block und `organisationOf()` heute logisch identisch sind.

**D7 — Auch die NUTZDATENabfragen tragen `and org_id = $n`** (nachgetragen 12.08.2026 nach dem
Quality-Review von Commit `b50b2b3`; die erste Planfassung hatte diesen Punkt **uebersehen**).

Der Befund, unabhaengig gemessen: `organisationOf` allein zu verengen reicht nicht. RLS ist eine
**Vereinigung**, keine Auswahl — `app.user_org_ids()` (`0002_tenancy.sql`) liefert jede aktive
Mitgliedschaft, und `plan_versions_select_in_org` (`0007_planning.sql:109-111`) sowie die Policies
von `employees`/`worksites` lauten `org_id in (select app.user_org_ids())`. Im Leserepository stand
`org_id` bis dahin ausschliesslich in Kommentaren.

Gemessen mit einer Sonde, die RLS-Semantik nachstellt (3/3 bestaetigend, Lauf 12.08.2026): an BETA
gebunden liefert `planningWindow` zwar Wiener Zeit, aber ALPHAs Entwurf als `sourceVersion` und die
Stammdaten **beider** Organisationen; `publishedVersions` fuehrt ALPHAs Version mit; und an ALPHA
gebunden ist BETAs Planversion ueber `publishedAssignments` **erreichbar**. Ein gebundener
Multi-Org-Lauf lieferte also eine plausibel aussehende Collage aus zwei Mandanten — schlechter als
das vorherige ehrliche `AMBIGUOUS_ORGANISATION`.

Deshalb tragen `planningWindow`s Versionsabfrage, `publishedVersions`, beide Abfragen in
`publishedAssignments` und beide Statements in `resourcesOf` zusaetzlich `and org_id = $n` mit der
aus `organisationOf` **aufgeloesten** Id — in beiden Zweigen, gebunden wie ungebunden (einzelorg ist
es ein No-op, aber es gibt dann einen Codepfad statt zweier). Schlichtes `= $n` ohne `::text`: der
Wert kommt aus der Datenbank und ist immer wohlgeformt; D3 gilt nur fuer die von aussen gereichte
Bindung. Die Bedingung steht UND-verknuepft neben RLS und kann die sichtbare Menge nur
verkleinern — sie ersetzt die Grenze nicht, sie verengt innerhalb ihrer.

**`assignmentsOf` bleibt als einzige ungefiltert.** `assignments` traegt
`foreign key (plan_version_id, org_id) references public.plan_versions (id, org_id)`
(`0007_planning.sql:77-78`); die Version bestimmt die Organisation bereits. Ein Filter waere eine
Bedingung, die keine Datenlage je verletzt — Dekoration, und die lehnt dieses Repo ab (dieselbe
Begruendung steht schon im Kopf von `publishedAssignments` zum weggelassenen
`published_at`-Filter).

**Ohne D7 waeren drei Zusicherungen aus Task 5 in `db-gates` rot geworden** —
`expect(mitA).not.toContain(betaId)`, `expect(mitB).not.toContain(alphaId)` und
`expect(querzugriff.problem).toBe("PLAN_VERSION_NOT_FOUND")`. Der Unit-Review hat den Defekt vor
dem CI-Lauf gefunden, nicht danach.

**D6 — Die Kostenfabrik nimmt die Organisation als PFLICHTargument.**
`PlanCostFactsFactory = (subjectUserId: string, organisationId: string) => PlanCostFactsPort`.
Optional waere die Einladung, sie in Task 13 zu vergessen; pflichtig laesst der Compiler das nicht
zu. Der Kostenpfad hat die Id immer — `zugang()` liefert sie in jedem Erfolgsfall.

**D8 — Die Fabrik ist die EINZIGE Konstruktionsstelle des Faktenports** (nachgetragen 12.08.2026
nach dem Quality-Review von `933c4c4`).

D6 verspricht, dass der Compiler das Vergessen der Organisation verhindert. Das Versprechen war
halb: `costs/index.ts` exportierte `PlanningFactsAdapter` direkt neben der Fabrik, und
`new PlanningFactsAdapter(queriesFor(subjectUserId))` kompiliert einstellig ohne Klage — die
Organisation waere in Task 13 still verloren gegangen und der Multi-Org-Benutzer wieder bei
`AMBIGUOUS_ORGANISATION` gelandet.

Deshalb faellt der Klassenexport aus `costs/index.ts`. Es braucht dafuer **keinen neuen
Architekturwaechter**: `costs-cross-module-public-api-only` verbietet Tiefimporte ins Kostenmodul
bereits, und dass er auch Testdateien erfasst, ist gemessen (Tiefimport eingespielt → rot, danach
hashgleich zurueckgenommen). Ohne den Export gibt es ausserhalb des Moduls schlicht keinen legalen
Weg mehr am Pflichtargument vorbei. Die 11 Konstruktionsstellen in
`test/costs/planning-facts.adapter.test.ts` wandern auf die Fabrik; ihre Zusicherungen bleiben
unveraendert.

**Bewusst NICHT gemacht:** `planCostFactsFactory` nach `createPlanCostFactsFactory` umbenennen,
obwohl der Name sich vom Typ `PlanCostFactsFactory` nur im ersten Buchstaben unterscheidet und die
Funktion nicht von diesem Typ ist. Der Fehlermodus ist ein sofortiger Compilerfehler, der Name
deckt sich mit dem Dateinamen — Bewegung ohne Risikoreduktion.

---

## Task 8d: Gegenmutation GM-MO-5 — den Port zwischenspeichern

**Erwartung:** `baut je Subjekt und Organisation einen EIGENEN Port` wird ROT, die beiden anderen
Faelle bleiben gruen.

```ts
let zwischenspeicher: PlanCostFactsPort | undefined;
return (subjectUserId, organisationId) =>
  (zwischenspeicher ??= new PlanningFactsAdapter(queriesFor(subjectUserId, organisationId)));
```

**Warum dieser Fall noetig war (gemessen 12.08.2026):** genau diese Mutation kompilierte (`tsc`
Exit 0) und liess die **gesamte** `apps/api`-Suite gruen — 59 Dateien, 603 bestandene Tests. Die
Eigenschaft, fuer die dieser Slice ueberhaupt eine Fabrik statt eines Providers baut, war damit
Ausfuehrungsnachweis und kein Beweis. Der Fehler waere nicht harmlos: der zwischengespeicherte Port
haelt `subjectUserId` fest, aus dem der `TenantContext` gebaut wird — RLS faengt ihn also **nicht**
ab, weil sie die falsche Identitaet korrekt durchsetzt.

---

## Aufgabenuebersicht

| Task | Inhalt | Datei(en) |
| --- | --- | --- |
| 0 | Arbeitsstand herstellen (Branch, Build) | — |
| 1 | Roter Verhaltenstest: Bindung existiert noch nicht (M1–M5, M7) | `apps/api/test/planning-organisation-binding.test.ts` |
| 2 | Fabriktyp + Repository-Bindung umsetzen | `planning-queries.factory.ts`, `planning-window.repository.ts`, `app.module.ts` |
| 3 | Kostenseitige Fabrik: Typ + Token | `costs/application/plan-cost-facts.port.ts`, `costs/index.ts` |
| 4 | Roter Test M6, dann Fabrikfunktion + AppModule-Verdrahtung | `apps/api/test/costs/plan-cost-facts-factory.test.ts`, `costs/infrastructure/plan-cost-facts.factory.ts`, `app.module.ts` |
| 5 | Integrationsnachweis gegen echtes PostgreSQL (M2–M5 unter RLS) | `apps/api/test/planning-published-reads.integration.test.ts` |
| 6 | Kommentare, die jetzt falsch waeren, richtigstellen | vier Dateikoepfe |
| 7 | Gegenmutation GM-MO-1 ausfuehren, messen, zuruecknehmen | — |
| 8 | Gegenmutation GM-MO-2 ausfuehren, messen, zuruecknehmen | — |
| 9 | Volle lokale Validierung, Commit, Push, CI verifizieren | — |
| 10 | PR-Body faktisch aktualisieren (bleibt Draft) | GitHub |

---

## Task 0: Arbeitsstand herstellen

**Files:** keine.

**Step 1: Auf den PR-Branch wechseln**

Der lokale Arbeitsbaum steht bei Planerstellung auf `fix/eyt-136-planning-data-api-boundary` und
traegt unversionierte Dokumente. Diese nicht mitnehmen, nicht loeschen.

```bash
git status --porcelain
git checkout feat/eyt-109-daily-plan-cost-snapshot
git reset --hard origin/feat/eyt-109-daily-plan-cost-snapshot
git rev-parse HEAD
```

Erwartet: `61fb4b8458ed81c5ef1a2ebcd5f95350236cdd0a`.

> `git reset --hard` ist hier zulaessig, weil der lokale Branch den PR-Stand exakt spiegeln soll.
> Vorher `git status --porcelain` lesen: steht dort eine geaenderte Datei UNTER `apps/` oder
> `packages/`, **STOP** — es gibt unerwartete lokale Arbeit.

**Step 2: Abhaengige Pakete bauen**

`vitest run` ueber `--filter … exec` umgeht Turbos `^build`; ohne gebautes `dist/` misst der Test
einen alten Vertragsstand.

```bash
pnpm install --frozen-lockfile
pnpm --filter @easytree/config build
pnpm --filter @easytree/contracts build
pnpm --filter @easytree/domain build
```

Erwartet: drei erfolgreiche Builds, Exit 0. Bei einem roten Build **nicht** weiterarbeiten — ein
fehlgeschlagener Build hinterlaesst ein benutzbares altes `dist/`, und der naechste Einzeltest
wuerde gruen laufen, ohne etwas zu messen.

**Step 3: Ausgangslauf, damit „vorher gruen" belegt ist**

```bash
pnpm --filter @easytree/api exec vitest run test/planning-window.http.test.ts test/planning-gateway-parity.test.ts test/costs/planning-facts.adapter.test.ts
```

Erwartet: alle PASS. Die Zahl notieren — sie ist die Vergleichsbasis fuer M8.

---

## Task 1: Roter Verhaltenstest fuer die Bindung

**Files:**
- Create: `apps/api/test/planning-organisation-binding.test.ts`

**Step 1: Den Test schreiben**

Die Attrappe filtert **ausschliesslich ueber die Parameter, die sie tatsaechlich bekommen hat**.
Sie ist damit keine zweite Implementierung der Regel: bleibt der Parameter aus, liefert sie beide
Zeilen, und das Repository muss `AMBIGUOUS_ORGANISATION` antworten — genau der rote Fall.

```ts
/**
 * Bindung der Planungsabfragen an eine bereits serverseitig aufgeloeste
 * Organisation (EYT-109, Multi-Org-Gate).
 *
 * ## Was diese Datei beweist — und was nicht
 *
 * Bewiesen wird die NAHT: welcher Parameter im SQL ankommt, und welche der
 * sichtbaren Organisationen das Repository daraufhin waehlt. Dass RLS die
 * Sichtbarkeit richtig herstellt, ist eine andere Aussage und steht in
 * `planning-published-reads.integration.test.ts` gegen echtes PostgreSQL.
 *
 * ## Warum die Attrappe filtern DARF
 *
 * Sie filtert nur ueber `params` — also ueber das, was das Repository ihr
 * uebergeben hat. Bleibt der Parameter aus (Gegenmutation GM-MO-1), liefert sie
 * beide Zeilen, und das Repository muss `AMBIGUOUS_ORGANISATION` antworten. Der
 * Fall wird dann rot, ohne dass die Attrappe die Regel selbst kennt.
 */
import { describe, expect, it } from "vitest";

import { PlanningWindowRepository } from "../src/modules/planning";
import type {
  TenantQuery,
  TenantQueryRunner,
} from "../src/platform/database/tenant-query-runner";

const USER = "00000000-0000-4000-8000-00000000aaa1";
const ORG_A = "00000000-0000-4000-8000-0000000000a1";
const ORG_B = "00000000-0000-4000-8000-0000000000b2";
/** Existiert nicht und ist fuer niemanden sichtbar. */
const ORG_FREMD = "00000000-0000-4000-8000-0000000000c3";

interface OrgZeile {
  readonly id: string;
  readonly time_zone: string;
}

interface Aufzeichnung {
  readonly sql: string;
  readonly params: readonly unknown[];
}

const ALPHA: OrgZeile = { id: ORG_A, time_zone: "Europe/Berlin" };
const BETA: OrgZeile = { id: ORG_B, time_zone: "Europe/Vienna" };

/**
 * Ein Runner, der die RLS-sichtbare Menge stellt und jede Query mitschreibt.
 *
 * Alles ausser `organizations` antwortet leer — diese Suite misst die Auswahl
 * der Organisation, nicht die Nutzdaten.
 */
function runnerMit(
  sichtbar: readonly OrgZeile[],
  protokoll: Aufzeichnung[],
): TenantQueryRunner {
  const tx: TenantQuery = {
    query: <TRow>(sql: string, params: readonly unknown[] = []) => {
      protokoll.push({ sql, params });
      if (!sql.includes("from public.organizations")) {
        return Promise.resolve({ rows: [] as TRow[], rowCount: 0 });
      }
      const gefiltert =
        params.length === 0 ? sichtbar : sichtbar.filter((org) => org.id === params[0]);
      return Promise.resolve({
        rows: gefiltert as unknown as TRow[],
        rowCount: gefiltert.length,
      });
    },
  };
  return { run: (_kontext, work) => work(tx) };
}

/** Die Abfrage, die die Organisation aufloest — es gibt genau eine je Lauf. */
function organisationsAbfrage(protokoll: readonly Aufzeichnung[]): Aufzeichnung {
  const treffer = protokoll.filter((zeile) => zeile.sql.includes("from public.organizations"));
  expect(treffer, "es muss genau EINE Organisationsabfrage geben").toHaveLength(1);
  return treffer[0] as Aufzeichnung;
}

describe("PlanningWindowRepository — Organisationsbindung (EYT-109)", () => {
  // M1
  it("liest ohne Bindung unveraendert, wenn genau eine Organisation sichtbar ist", async () => {
    const protokoll: Aufzeichnung[] = [];
    const repository = new PlanningWindowRepository(runnerMit([ALPHA], protokoll), USER);

    const ergebnis = await repository.planningWindow("2026-W02");

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.window.timeZone).toBe("Europe/Berlin");
    // Ungebunden heisst: KEIN Parameter. Der Text bleibt der bisherige.
    expect(organisationsAbfrage(protokoll).params).toHaveLength(0);
  });

  // M2
  it("bleibt ohne Bindung bei zwei Mitgliedschaften mehrdeutig", async () => {
    const protokoll: Aufzeichnung[] = [];
    const repository = new PlanningWindowRepository(runnerMit([ALPHA, BETA], protokoll), USER);

    const ergebnis = await repository.planningWindow("2026-W02");

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    // Kein „erste Zeile gewinnt". Die Auswahl muss sichtbar getroffen werden.
    expect(ergebnis.problem).toBe("AMBIGUOUS_ORGANISATION");
  });

  // M3
  it("liest mit Bindung auf A ausschliesslich A", async () => {
    const protokoll: Aufzeichnung[] = [];
    const repository = new PlanningWindowRepository(runnerMit([ALPHA, BETA], protokoll), USER, ORG_A);

    const ergebnis = await repository.planningWindow("2026-W02");

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    expect(ergebnis.window.timeZone).toBe("Europe/Berlin");
    expect(ergebnis.window.timeZone).not.toBe("Europe/Vienna");
  });

  // M4 — der Beweis, dass nicht schlicht die erste Zeile genommen wird.
  it("liest mit Bindung auf B ausschliesslich B", async () => {
    const protokoll: Aufzeichnung[] = [];
    const repository = new PlanningWindowRepository(runnerMit([ALPHA, BETA], protokoll), USER, ORG_B);

    const ergebnis = await repository.planningWindow("2026-W02");

    expect(ergebnis.ok).toBe(true);
    if (!ergebnis.ok) return;
    // ALPHA steht in der sichtbaren Menge VORNE. Waere die Bindung wirkungslos
    // oder ein „first row wins", staende hier Europe/Berlin.
    expect(ergebnis.window.timeZone).toBe("Europe/Vienna");
  });

  // M5
  it("liefert bei einer nicht sichtbaren Organisation nichts und faellt auf keine sichtbare zurueck", async () => {
    const protokoll: Aufzeichnung[] = [];
    const repository = new PlanningWindowRepository(
      runnerMit([ALPHA, BETA], protokoll),
      USER,
      ORG_FREMD,
    );

    const ergebnis = await repository.planningWindow("2026-W02");

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.problem).toBe("NO_ORGANISATION");
  });

  // M5, zweite Haelfte: die Bindung wirkt auch auf die versionsgenauen Wege.
  it("bindet auch publishedVersions und publishedAssignments", async () => {
    const protokollListe: Aufzeichnung[] = [];
    const liste = await new PlanningWindowRepository(
      runnerMit([ALPHA, BETA], protokollListe),
      USER,
      ORG_FREMD,
    ).publishedVersions("2026-W02", "2026-W03");
    expect(liste.ok).toBe(false);
    if (!liste.ok) expect(liste.problem).toBe("NO_ORGANISATION");

    const protokollStand: Aufzeichnung[] = [];
    const stand = await new PlanningWindowRepository(
      runnerMit([ALPHA, BETA], protokollStand),
      USER,
      ORG_FREMD,
    ).publishedAssignments("00000000-0000-4000-8000-0000000f0f0f");
    expect(stand.ok).toBe(false);
    if (!stand.ok) expect(stand.problem).toBe("NO_ORGANISATION");
  });

  // M7
  it("uebergibt die Organisation als Parameter und interpoliert sie nicht", async () => {
    const protokoll: Aufzeichnung[] = [];
    const repository = new PlanningWindowRepository(runnerMit([ALPHA, BETA], protokoll), USER, ORG_B);

    await repository.planningWindow("2026-W02");

    const abfrage = organisationsAbfrage(protokoll);
    expect(abfrage.params).toEqual([ORG_B]);
    expect(abfrage.sql).toContain("$1");
    // Der Kern: die Id steht NICHT im Text. Waere sie interpoliert, staende sie hier.
    expect(abfrage.sql).not.toContain(ORG_B);
  });

  // M7, Gegenprobe mit einer boesartigen Eingabe
  it("behandelt eine SQL-artige Eingabe als Wert, nicht als Text", async () => {
    const protokoll: Aufzeichnung[] = [];
    const boese = "' or true --";
    const repository = new PlanningWindowRepository(runnerMit([ALPHA, BETA], protokoll), USER, boese);

    const ergebnis = await repository.planningWindow("2026-W02");

    expect(ergebnis.ok).toBe(false);
    if (ergebnis.ok) return;
    expect(ergebnis.problem).toBe("NO_ORGANISATION");
    const abfrage = organisationsAbfrage(protokoll);
    expect(abfrage.sql).not.toContain(boese);
    expect(abfrage.params).toEqual([boese]);
  });
});
```

**Step 2: Lauf, der ROT sein MUSS**

```bash
pnpm --filter @easytree/api exec vitest run test/planning-organisation-binding.test.ts
pnpm --filter @easytree/api exec tsc --noEmit -p tsconfig.json
```

**Korrektur gegenueber der ersten Planfassung (gemessen 12.08.2026):** `apps/api` transformiert mit
**SWC**, und `vitest` typecheckt nicht. Der `vitest`-Lauf zeigt hier deshalb **keinen** `TS2554`,
sondern ist bereits verhaltensrot — das dritte Argument wird zur Laufzeit schlicht ignoriert. Der
Typfehler existiert und ist mit `tsc` separat zu messen:

```
test/planning-organisation-binding.test.ts(114,7): error TS2554: Expected 2 arguments, but got 3.
```
(sieben Vorkommen). Ein Compilerfehler zaehlt allein **nicht** als Verhaltensnachweis — hier liegt
beides vor, weshalb Step 2 und Step 3 dieselbe Testausgabe erzeugen. Step 3 bleibt trotzdem
stehen: er ist der Schritt, der die Kohaerenz herstellt.

**Step 3: Verhaltensrote Zwischenmessung**

Nur den Konstruktor um einen ignorierten dritten Parameter erweitern — sonst nichts:

```ts
  constructor(
    private readonly runner: TenantQueryRunner,
    private readonly subjectUserId: string,
    private readonly organisationId: string | null = null,
  ) {}
```

Dann erneut:

```bash
pnpm --filter @easytree/api exec vitest run test/planning-organisation-binding.test.ts
```

Erwartet, woertlich zu pruefen (gemessen 12.08.2026): **6 failed | 2 passed (8)**. M1 und M2 PASS;
FAIL sind M3, M4, M5, „bindet auch publishedVersions…", M7 und die boesartige Eingabe — M3/M4 mit
`expected false to be true` (die ungebundene Aufloesung sieht zwei Zeilen und antwortet
`AMBIGUOUS_ORGANISATION`), M5 und die beiden anderen mit
`expected 'AMBIGUOUS_ORGANISATION' to be 'NO_ORGANISATION'`, M7 mit `expected [] to deeply equal
[ Array(1) ]`.

**Korrektur gegenueber der ersten Planfassung:** dort stand fuer M5 „`ok: true`". Das war falsch —
die Fixture stellt ZWEI sichtbare Organisationen, also greift ungebunden der AMBIGUOUS-Zweig und
`ok` ist korrekt `false`; rot wird die darauffolgende Zusicherung auf den Fehlercode. Der Fall ist
in beiden Lesarten verhaltensrot.

**Step 4: Commit (roter Zwischenstand bleibt UNcommittet)**

Nicht committen. Der rote Stand ist Messung, nicht Lieferung. Weiter mit Task 2.

---

## Task 2: Fabriktyp und Repository-Bindung

**Files:**
- Modify: `apps/api/src/modules/planning/application/planning-queries.factory.ts:19`
- Modify: `apps/api/src/modules/planning/infrastructure/planning-window.repository.ts:85-101,296-313`
- Modify: `apps/api/src/app.module.ts:178-181`

**Step 1: Fabriktyp erweitern**

`planning-queries.factory.ts`, Zeile 19 ersetzen durch:

```ts
/**
 * Baut den Leseport fuer ein verifiziertes Subjekt.
 *
 * `organisationId` ist optional und bewusst das ZWEITE Argument: bestehende
 * Aufrufer mit genau einer Mitgliedschaft rufen unveraendert einstellig auf und
 * behalten ihre Semantik (mehrere Mitgliedschaften ohne Auswahl bleiben
 * `AMBIGUOUS_ORGANISATION`).
 *
 * Wird sie uebergeben, ist sie eine BEREITS SERVERSEITIG AUFGELOESTE Auswahl —
 * etwa das `organisationId` aus `CostAccessPolicy.authorize`, das aus
 * `memberships` stammt und nicht aus dem Header. Sie autorisiert nichts: das
 * Repository verengt damit ausschliesslich die ohnehin RLS-sichtbare Menge.
 * Eine fremde Id liefert deshalb null Zeilen und nicht fremde Daten.
 */
export type PlanningQueriesFactory = (
  subjectUserId: string,
  organisationId?: string | null,
) => PlanningQueries;
```

**Step 2: Konstruktor und `organisationOf` im Repository**

`planning-window.repository.ts`, Konstruktor (Zeilen 86-89) ersetzen:

```ts
  constructor(
    private readonly runner: TenantQueryRunner,
    private readonly subjectUserId: string,
    /**
     * Bereits serverseitig aufgeloeste Organisation, oder `null`.
     *
     * KEINE Autorisierung. Der Wert verengt nur innerhalb der RLS-sichtbaren
     * Menge; ist die Organisation dort nicht enthalten, liefert die Abfrage
     * null Zeilen und die Antwort ist `NO_ORGANISATION`.
     */
    private readonly organisationId: string | null = null,
  ) {}
```

`organisationOf` (Zeilen 296-313) vollstaendig ersetzen:

```ts
  /**
   * Die EINE Organisation des gesetzten Kontexts.
   *
   * ## Zwei Zweige, und warum der ungebundene woertlich bleibt
   *
   * Ohne Bindung laeuft exakt das Statement von frueher — Buchstabe fuer
   * Buchstabe. Das ist Absicht: der `read-through`-Lauf und die bestehenden
   * Integrationsfaelle messen genau diesen Text, und ihn beilaeufig
   * umzuschreiben tauschte eine geprueft Zusage gegen eine ungeprueft neue.
   *
   * ## Warum `id::text = $1` und nicht `id = $1::uuid`
   *
   * Ein `::uuid`-Cast wirft bei einer nicht wohlgeformten Eingabe SQLSTATE
   * 22P02. Der Ausfallweg waere dann eine Ausnahme statt einer Antwort. Ueber
   * Text vergleicht die Abfrage mit nichts und liefert null Zeilen —
   * fail-closed als normales Ergebnis, das ein Aufrufer behandeln kann.
   *
   * ## Warum eine unbekannte Organisation `NO_ORGANISATION` ergibt
   *
   * Weil es in dem angefragten Kontext keine nutzbare Mitgliedschaft gibt —
   * derselbe Sachverhalt wie bei einem Subjekt ganz ohne Mitgliedschaft. Ein
   * eigener Code muesste „gibt es nicht" von „du gehoerst nicht dazu"
   * unterscheiden; genau das ist das Existenzleck, das `PLAN_VERSION_NOT_FOUND`
   * an anderer Stelle bereits vermeidet.
   */
  private async organisationOf(tx: TenantQuery): Promise<OrganisationResult> {
    // RLS liefert genau die Organisationen der aktiven Mitgliedschaften.
    const orgs =
      this.organisationId === null
        ? await tx.query<OrgRow>("select id, time_zone from public.organizations")
        : await tx.query<OrgRow>(
            `select id, time_zone
               from public.organizations
              where id::text = $1`,
            [this.organisationId],
          );
    if (orgs.rows.length === 0) return { ok: false, problem: "NO_ORGANISATION" };
    if (orgs.rows.length > 1) return { ok: false, problem: "AMBIGUOUS_ORGANISATION" };
    const org = orgs.rows[0];
    if (org === undefined) return { ok: false, problem: "NO_ORGANISATION" };
    return { ok: true, org };
  }
```

**Step 3: `planningWindow` auf denselben Block ziehen (D5)**

In `planningWindow` die Zeilen 93-101 ersetzen:

```ts
      const organisation = await this.organisationOf(tx);
      if (!organisation.ok) return { ok: false as const, problem: organisation.problem };
      const org = organisation.org;
```

Der Rest der Methode bleibt unveraendert (`org.time_zone` wird weiterhin benutzt).

**Step 4: Testlauf**

```bash
pnpm --filter @easytree/api exec vitest run test/planning-organisation-binding.test.ts
```

Erwartet: **alle 8 Faelle PASS.**

**Step 5: `app.module.ts` — die Fabrik reicht das Argument weiter**

Zeile 181 ersetzen:

```ts
        return (subjectUserId: string, organisationId?: string | null) =>
          new PlanningWindowRepository(runner, subjectUserId, organisationId ?? null);
```

**Step 6: Regressionslauf der bestehenden Planungsnaehte (M8, erste Haelfte)**

```bash
pnpm --filter @easytree/api exec vitest run test/planning-window.http.test.ts test/planning-gateway-parity.test.ts test/planning-access.test.ts test/planning-conflict.test.ts test/costs/planning-facts.adapter.test.ts
```

Erwartet: alle PASS, gleiche Zahl wie im Ausgangslauf aus Task 0 Step 3.

**Step 7: Commit**

```bash
git add apps/api/src/modules/planning/application/planning-queries.factory.ts \
        apps/api/src/modules/planning/infrastructure/planning-window.repository.ts \
        apps/api/src/app.module.ts \
        apps/api/test/planning-organisation-binding.test.ts
git diff --cached --name-only
git commit -m "feat(planning): EYT-109 — Planungsabfragen an eine aufgeloeste Organisation binden"
```

`git diff --cached --name-only` lesen: genau diese vier Pfade, kein fuenfter.

---

## Task 3: Kostenseitiger Fabriktyp und Token

**Files:**
- Modify: `apps/api/src/modules/costs/application/plan-cost-facts.port.ts` (ans Dateiende)
- Modify: `apps/api/src/modules/costs/index.ts`

**Step 1: Typ und Token ergaenzen**

Ans Ende von `plan-cost-facts.port.ts`:

```ts
/**
 * Baut den Faktenport JE SUBJEKT UND ORGANISATION (EYT-109).
 *
 * `organisationId` ist PFLICHT und nicht optional. Der Kostenpfad hat die Id in
 * jedem Erfolgsfall — `CostAccessPolicy.authorize` liefert sie aus
 * `memberships`. Optional waere sie die Einladung, sie in der ersten Route zu
 * vergessen; pflichtig laesst der Compiler das nicht zu.
 *
 * Sie autorisiert nichts. Die Entscheidung ist zu diesem Zeitpunkt bereits
 * gefallen; hier wird sie nur nicht mehr verloren.
 */
export type PlanCostFactsFactory = (
  subjectUserId: string,
  organisationId: string,
) => PlanCostFactsPort;

/** DI-Token der Fabrik. `PLAN_COST_FACTS` bleibt das Token des fertigen Ports. */
export const PLAN_COST_FACTS_FACTORY = "PLAN_COST_FACTS_FACTORY";
```

**Step 2: Export in `costs/index.ts`**

Zeile 30 ergaenzen (benannte Re-Exporte, kein `export *`):

```ts
export type {
  PlanCostFactsFactory,
  PlanCostFactsPort,
  PlanCostFactsProblem,
  PlanCostFactsResult,
  PlanVersionListProblem,
  PublishedVersionsListResult,
} from "./application/plan-cost-facts.port";
export {
  PLAN_COST_FACTS,
  PLAN_COST_FACTS_FACTORY,
  PLAN_COST_FACTS_PROBLEMS,
} from "./application/plan-cost-facts.port";
```

**Step 3: Typecheck**

```bash
pnpm --filter @easytree/api exec tsc --noEmit -p tsconfig.json
```

Erwartet: Exit 0, keine Ausgabe.

**Step 4: Commit**

```bash
git add apps/api/src/modules/costs/application/plan-cost-facts.port.ts apps/api/src/modules/costs/index.ts
git diff --cached --name-only
git commit -m "feat(costs): EYT-109 — Fabriktyp fuer organisationsgebundene Planfakten"
```

---

## Task 4: M6 — Propagation vom Kostenpfad zu den Planungsfakten

**Files:**
- Create: `apps/api/test/costs/plan-cost-facts-factory.test.ts`
- Create: `apps/api/src/modules/costs/infrastructure/plan-cost-facts.factory.ts`
- Modify: `apps/api/src/modules/costs/index.ts`
- Modify: `apps/api/src/app.module.ts`

**Step 1: Den roten Test schreiben**

Der zweite Fall bootet die ECHTE `AppModule` und holt das Token heraus. Damit ist bewiesen, dass
die Produktionswurzel dieselbe Funktion benutzt — nicht eine zweite Baustelle daneben.

```ts
/**
 * Weitergabe des serverseitig aufgeloesten Organisationskontexts vom Kostenpfad
 * an die Planungsfakten (EYT-109, M6).
 *
 * ## Warum zwei Faelle
 *
 * Der erste prueft die Fabrikfunktion selbst. Der zweite holt das Token aus der
 * ECHTEN `AppModule` — sonst koennte die Wurzel eine zweite, abweichende
 * Baustelle bauen und dieser Test bliebe gruen. Dasselbe Muster wie bei
 * `lib/planning-gateway-factory.ts` im Web: der Test ruft die Funktion, die
 * auch die Produktion ruft.
 */
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { AppModule } from "../../src/app.module";
import { DATABASE_PING, type DatabasePing } from "../../src/health/readiness";
import { planCostFactsFactory } from "../../src/modules/costs/infrastructure/plan-cost-facts.factory";
import { PLAN_COST_FACTS_FACTORY, type PlanCostFactsFactory } from "../../src/modules/costs";
import {
  PLANNING_QUERIES_FACTORY,
  type PlanningQueries,
  type PlanningQueriesFactory,
} from "../../src/modules/planning";

const USER = "00000000-0000-4000-8000-00000000aaa1";
const ORG_B = "00000000-0000-4000-8000-0000000000b2";

interface Aufruf {
  readonly subjectUserId: string;
  readonly organisationId: string | null | undefined;
}

/**
 * Eine Planungsfabrik, die jeden Bau mitschreibt.
 *
 * Die gestellten Methoden WERFEN statt leer zu antworten: eine Attrappe, die
 * `[]` liefert, faerbt einen Test gruen, der versehentlich den falschen Weg
 * nimmt.
 */
function spionierendeFabrik(aufrufe: Aufruf[]): PlanningQueriesFactory {
  return (subjectUserId, organisationId) => {
    aufrufe.push({ subjectUserId, organisationId });
    return {
      planningWindow: () => {
        throw new Error("planningWindow ist hier nicht gestellt (EYT-109).");
      },
      publishedVersions: () => Promise.resolve({ ok: true as const, versions: [] }),
      publishedAssignments: () => {
        throw new Error("publishedAssignments ist hier nicht gestellt (EYT-109).");
      },
    } satisfies PlanningQueries;
  };
}

describe("planCostFactsFactory — Organisationsweitergabe (EYT-109)", () => {
  it("reicht Subjekt UND Organisation an die Planungsfabrik weiter", async () => {
    const aufrufe: Aufruf[] = [];
    const port = planCostFactsFactory(spionierendeFabrik(aufrufe))(USER, ORG_B);

    // Der Bau allein genuegt nicht als Nachweis — erst der Aufruf beweist, dass
    // der gebaute Port auch der ist, der benutzt wird.
    const ergebnis = await port.publishedVersions("2026-W02", "2026-W03");
    expect(ergebnis.ok).toBe(true);

    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0]?.subjectUserId).toBe(USER);
    expect(aufrufe[0]?.organisationId).toBe(ORG_B);
  });

  it("wird von AppModule aus derselben Funktion gebaut", async () => {
    const aufrufe: Aufruf[] = [];
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_PING)
      .useValue({ ping: (): Promise<boolean> => Promise.resolve(true) } satisfies DatabasePing)
      .overrideProvider(PLANNING_QUERIES_FACTORY)
      .useValue(spionierendeFabrik(aufrufe))
      .compile();

    const fabrik = moduleRef.get<PlanCostFactsFactory>(PLAN_COST_FACTS_FACTORY);
    await fabrik(USER, ORG_B).publishedVersions("2026-W02", "2026-W03");

    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0]?.organisationId).toBe(ORG_B);

    await moduleRef.close();
  });
});
```

**Step 2: Lauf, der ROT sein MUSS**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/plan-cost-facts-factory.test.ts
```

Erwartet: FAIL — `plan-cost-facts.factory` existiert nicht, und `PLAN_COST_FACTS_FACTORY` ist in
`AppModule` nicht registriert (`Nest could not find PLAN_COST_FACTS_FACTORY element`).

**Step 3: Die Fabrikfunktion**

Neue Datei `apps/api/src/modules/costs/infrastructure/plan-cost-facts.factory.ts`:

```ts
/**
 * Die EINE Baustelle des Faktenports (EYT-109).
 *
 * ## Warum eine benannte Funktion und kein Closure in `AppModule`
 *
 * Weil ein Test, der die Verdrahtung prueft, dieselbe Funktion rufen koennen
 * muss, die auch die Produktion ruft. Baute `AppModule` das Objekt inline,
 * baute der Test eine zweite Fassung — und bliebe gruen, was immer die Wurzel
 * taete. Dieselbe Begruendung wie bei `lib/planning-gateway-factory.ts` im Web.
 *
 * ## Warum hier und nicht in `application/`
 *
 * Die Kenntnis, dass die Fakten aus dem Planungsmodul kommen, ist eine
 * Fremdsystemkenntnis — genau wie im Adapter darunter. Sie gehoert nach aussen.
 *
 * ## Was hier NICHT passiert
 *
 * Keine Autorisierung. `organisationId` ist bereits entschieden
 * (`CostAccessPolicy.authorize`); diese Funktion verhindert nur, dass die
 * Entscheidung auf dem Weg zur Planung verloren geht. RLS bleibt unabhaengig
 * davon die Grenze: eine Organisation, die das Subjekt nicht sieht, liefert
 * null Zeilen.
 */
import type { PlanningQueriesFactory } from "../../planning";
import type { PlanCostFactsFactory } from "../application/plan-cost-facts.port";
import { PlanningFactsAdapter } from "./planning-facts.adapter";

export function planCostFactsFactory(
  queriesFor: PlanningQueriesFactory,
): PlanCostFactsFactory {
  return (subjectUserId, organisationId) =>
    new PlanningFactsAdapter(queriesFor(subjectUserId, organisationId));
}
```

Export in `costs/index.ts` neben `PlanningFactsAdapter` ergaenzen:

```ts
export { planCostFactsFactory } from "./infrastructure/plan-cost-facts.factory";
```

**Step 4: AppModule verdrahten**

In `app.module.ts` direkt hinter dem `PLANNING_QUERIES_FACTORY`-Provider einfuegen (und die
Importe `PLAN_COST_FACTS_FACTORY`, `planCostFactsFactory`, `type PlanCostFactsFactory` aus
`./modules/costs` ergaenzen):

```ts
    {
      // EYT-109: Kostenpfad -> Planungsfakten, mit dem BEREITS aufgeloesten
      // Organisationskontext. Die Fabrik steht in `costs/infrastructure`, damit
      // Test und Produktion dieselbe Funktion rufen — ein Closure hier waere
      // eine zweite Baustelle, die kein Test erreichen kann.
      provide: PLAN_COST_FACTS_FACTORY,
      inject: [PLANNING_QUERIES_FACTORY],
      useFactory: (queriesFor: PlanningQueriesFactory): PlanCostFactsFactory =>
        planCostFactsFactory(queriesFor),
    },
```

**Step 5: Gruener Lauf**

```bash
pnpm --filter @easytree/api exec vitest run test/costs/plan-cost-facts-factory.test.ts
```

Erwartet: beide Faelle PASS.

**Step 6: Modulgrenzen pruefen**

```bash
pnpm --filter @easytree/api exec vitest run test/costs-module-boundaries.test.ts test/costs-module-boundaries.red-case.test.ts test/architecture.test.ts test/architecture-red-case.test.ts
```

Erwartet: alle PASS. Bei einem roten Lauf zu `costs-cross-module-public-api-only`: der Import in
der neuen Fabrik muss `from "../../planning"` lauten — kein Tiefimport nach
`planning/application/`.

**Step 7: Commit**

```bash
git add apps/api/src/modules/costs/infrastructure/plan-cost-facts.factory.ts \
        apps/api/src/modules/costs/index.ts \
        apps/api/src/app.module.ts \
        apps/api/test/costs/plan-cost-facts-factory.test.ts
git diff --cached --name-only
git commit -m "feat(costs): EYT-109 — aufgeloeste Organisation an die Planungsfakten weiterreichen"
```

---

## Task 5: Integrationsnachweis gegen echtes PostgreSQL

**Files:**
- Modify: `apps/api/test/planning-published-reads.integration.test.ts`

> Diese Suite laeuft bereits als eigener Schritt im Job `db-gates`
> (`.github/workflows/ci.yml`, Zeilen 387-391) inklusive
> `scripts/assert-tenant-report.sh planning-published-reads`. **Kein neuer Pflichtjob.**
> Auf diesem Mac ist der Supabase-Stack nicht startbar; der Lauf findet erst in CI statt. Das ist
> zu benennen, nicht zu kaschieren.

**Step 1: Konstanten und Wochen ergaenzen**

Freie ISO-Wochen (gemessen ueber alle Suiten und `seed.sql`): `W02`–`W09`, `W38`, `W39`, `W42`.
Benutzt werden `2026-W02` (Alpha) und `2026-W03` (Beta).

```ts
/** Multi-Org-Faelle (EYT-109). Eigene Wochen, ausserhalb aller anderen Suiten. */
const W_MO_ALPHA = "2026-W02";
const W_MO_BETA = "2026-W03";

/** Existiert in keiner Umgebung — die „fremde" Organisation aus M5. */
const ORG_UNBEKANNT = "00000000-0000-4000-8000-0000000000c3";

/** Feste Id der geliehenen Zweitmitgliedschaft. Nicht im Seed vergeben. */
const MITGLIEDSCHAFT_ZWEITE = "00000000-0000-4000-8000-0000000e0ab9";
```

`ALLE_WOCHEN` um `W_MO_ALPHA, W_MO_BETA` erweitern.

**Step 2: `repositoryAuf` um die Bindung erweitern**

```ts
function repositoryAuf(
  client: Client,
  subject: string = USER_A,
  organisationId: string | null = null,
): PlanningWindowRepository {
  return new PlanningWindowRepository(runnerAuf(client), subject, organisationId);
}
```

Bestehende Aufrufe bleiben unveraendert — Vorgabewerte.

**Step 3: Die geliehene Zweitmitgliedschaft**

Uebernimmt woertlich das bewaehrte Muster aus `planning-write.integration.test.ts:455-480`,
einschliesslich `catch` statt `finally` (ein `throw` im `finally` verwuerfe den Fehler des Falls,
und `no-unsafe-finally` verbietet ihn) und der Nachkontrolle, die dem `DELETE` nicht glaubt.

```ts
/**
 * Leiht `USER_A` fuer die Dauer EINES Falls eine aktive Mitgliedschaft in
 * Organisation BETA — damit ist das Subjekt echt mehrfach-organisatorisch.
 *
 * Warum geliehen und nicht geseedet: `supabase/seed.sql` kennt bewusst keinen
 * Multi-Org-Benutzer, und eine dauerhafte zweite Mitgliedschaft veraenderte
 * jede andere Mandantensuite im selben Job. Die Zeile lebt deshalb nur so lange
 * wie der Fall, der sie braucht, und ihr Verschwinden wird NACHGESEHEN statt
 * angenommen.
 */
async function mitZweiterMitgliedschaft(fn: () => Promise<void>): Promise<void> {
  await admin.query(
    `insert into public.memberships (id, org_id, user_id, role, active)
     values ($1, $2, $3, 'member', true)`,
    [MITGLIEDSCHAFT_ZWEITE, ORG_BETA, USER_A],
  );

  let fehlerAusFall: [unknown] | null = null;
  try {
    // Die Leihe hat gewirkt — gemessen, nicht angenommen. Ohne diese Kontrolle
    // koennte ein Fall gruen sein, weil das Subjekt gar nicht mehrfach
    // organisiert war.
    const stand = await admin.query<{ role: string; active: boolean }>(
      "select role, active from public.memberships where id = $1",
      [MITGLIEDSCHAFT_ZWEITE],
    );
    expect(stand.rows[0]?.active, "die geliehene Mitgliedschaft ist nicht aktiv").toBe(true);
    await fn();
  } catch (e) {
    fehlerAusFall = [e];
  }

  await admin.query("delete from public.memberships where id = $1", [MITGLIEDSCHAFT_ZWEITE]);
  const rest = await zaehle(admin, "select count(*) as n from public.memberships where id = $1", [
    MITGLIEDSCHAFT_ZWEITE,
  ]);
  if (rest !== 0) {
    throw new Error(
      "[planning-published-reads] die geliehene Mitgliedschaft ist NICHT entfernt worden — " +
        "spaetere Mandantengates wuerden auf einem falschen Zustand messen (EYT-109).",
      fehlerAusFall === null ? undefined : { cause: fehlerAusFall[0] },
    );
  }
  if (fehlerAusFall !== null) throw fehlerAusFall[0];
}
```

**Step 4: Die vier Faelle**

Ans Ende des bestehenden `describe`-Blocks:

```ts
  // -------------------------------------------------------------------------
  // Multi-Org-Gate (EYT-109) — M2 bis M5 gegen echtes RLS
  // -------------------------------------------------------------------------
  dbIt("bindet einen Multi-Org-Kontext deterministisch an die gewaehlte Organisation", async () => {
    const alphaId = await entwurfMit(admin, W_MO_ALPHA, [intervall(W_MO_ALPHA, 0)], ORG_ALPHA);
    await veroeffentliche(admin, alphaId, new Date("2026-01-05T10:00:00.000Z"));
    const betaId = await entwurfMit(admin, W_MO_BETA, [intervall(W_MO_BETA, 0)], ORG_BETA);
    await veroeffentliche(admin, betaId, new Date("2026-01-12T10:00:00.000Z"));

    // Zustand NACH jedem Schritt einzeln — eine Summe ueber beide Wochen saehe
    // gleich aus, egal an welcher Organisation die Versionen haengen.
    expect((await beobachteVersion(admin, alphaId))?.orgId).toBe(ORG_ALPHA);
    expect((await beobachteVersion(admin, alphaId))?.publishedAt).not.toBeNull();
    expect((await beobachteVersion(admin, betaId))?.orgId).toBe(ORG_BETA);
    expect((await beobachteVersion(admin, betaId))?.publishedAt).not.toBeNull();

    const client = await neueVerbindung();

    await mitZweiterMitgliedschaft(async () => {
      const ids = async (org: string | null): Promise<string[]> => {
        const ergebnis = await repositoryAuf(client, USER_A, org).publishedVersions(
          W_MO_ALPHA,
          W_MO_BETA,
        );
        expect(ergebnis.ok, `publishedVersions(${String(org)}) haette antworten muessen`).toBe(true);
        return ergebnis.ok ? ergebnis.versions.map((v) => v.id) : [];
      };

      // M2 — ohne Auswahl bleibt es mehrdeutig. Kein „erste Zeile gewinnt".
      const ohne = await repositoryAuf(client, USER_A, null).publishedVersions(
        W_MO_ALPHA,
        W_MO_BETA,
      );
      expect(ohne.ok).toBe(false);
      if (!ohne.ok) expect(ohne.problem).toBe("AMBIGUOUS_ORGANISATION");

      // M3 — Bindung auf A liefert A und NICHT B.
      const mitA = await ids(ORG_ALPHA);
      expect(mitA).toContain(alphaId);
      expect(mitA).not.toContain(betaId);

      // M4 — Bindung auf B liefert B und NICHT A. Damit ist belegt, dass nicht
      // schlicht die erste sichtbare Organisation genommen wird.
      const mitB = await ids(ORG_BETA);
      expect(mitB).toContain(betaId);
      expect(mitB).not.toContain(alphaId);

      // Und die versionsgenaue Lesung folgt derselben Bindung: die fremde
      // Version ist unter der Gegenbindung nicht erreichbar.
      const querzugriff = await repositoryAuf(client, USER_A, ORG_ALPHA).publishedAssignments(
        betaId,
      );
      expect(querzugriff.ok).toBe(false);
      if (!querzugriff.ok) expect(querzugriff.problem).toBe("PLAN_VERSION_NOT_FOUND");
    });
  });

  dbIt("liefert bei einer nicht sichtbaren Organisation nichts und faellt nicht zurueck", async () => {
    const client = await neueVerbindung();

    await mitZweiterMitgliedschaft(async () => {
      // M5a — eine Organisation, die es nirgends gibt.
      const unbekannt = await repositoryAuf(client, USER_A, ORG_UNBEKANNT).publishedVersions(
        W_MO_ALPHA,
        W_MO_BETA,
      );
      expect(unbekannt.ok).toBe(false);
      if (!unbekannt.ok) expect(unbekannt.problem).toBe("NO_ORGANISATION");
    });

    // M5b — eine Organisation, die es WIRKLICH gibt, in der das Subjekt aber
    // (nach Rueckgabe der Leihe) nicht mehr Mitglied ist. Beide Faelle
    // antworten gleich; die Antwort verraet nicht, welche Id echt ist.
    const fremd = await repositoryAuf(client, USER_A, ORG_BETA).publishedVersions(
      W_MO_ALPHA,
      W_MO_BETA,
    );
    expect(fremd.ok).toBe(false);
    if (!fremd.ok) expect(fremd.problem).toBe("NO_ORGANISATION");

    // Der Kern: kein Rueckfall auf die sichtbare Organisation. Waere einer da,
    // stuende hier `ok: true` mit den Alpha-Versionen.
    const beobachtet = await zaehle(
      admin,
      "select count(*) as n from public.organizations where id = $1",
      [ORG_BETA],
    );
    expect(beobachtet, "ORG_BETA muss wirklich existieren, sonst misst M5b nichts").toBe(1);
  });
```

**Step 5: Lokaler Lauf, soweit moeglich**

```bash
EASYTREE_TENANT_TESTS=local \
  pnpm --filter @easytree/api exec vitest run test/planning-published-reads.integration.test.ts
```

Erwartet auf dieser Maschine: SKIPPED mit `[planning-published-reads.integration] SKIPPED:
EASYTREE_TEST_APP_DB_URL nicht gesetzt.` — **das ist kein Nachweis.** Der Nachweis entsteht in
`db-gates` (Task 9). Ist lokal ein Stack erreichbar, stattdessen:

```bash
EASYTREE_TENANT_TESTS=required \
EASYTREE_TEST_APP_DB_URL=postgresql://easytree_app:<pw>@127.0.0.1:54322/postgres \
  pnpm --filter @easytree/api exec vitest run test/planning-published-reads.integration.test.ts
```

Erwartet: `[planning-published-reads] mode=required executed=… skipped=0`, alle Faelle PASS.

**Step 6: Commit**

```bash
git add apps/api/test/planning-published-reads.integration.test.ts
git diff --cached --name-only
git commit -m "test(planning): EYT-109 — Multi-Org-Bindung gegen echtes RLS belegen"
```

---

## Task 6: Kommentare richtigstellen, die jetzt falsch waeren

Vier Dateikoepfe behaupten Dinge, die dieser Slice aendert. Ein Kommentar, der der Datei
widerspricht, ist eine spaetere Fehlerquelle — er wird als Regel gelesen.

**Files:**
- ~~`apps/api/src/modules/planning/infrastructure/planning-window.repository.ts`~~ — **vorgezogen
  nach D7**: der Kopf behauptete „Kein SQL hier nennt `org_id` in einer WHERE-Klausel", und das
  wurde mit den Nutzdatenbedingungen tragend falsch. Richtiggestellt im selben Commit wie D7, nicht
  hier.
- Modify: `apps/api/src/modules/planning/application/planning-queries.port.ts` (Kopf, Z. 10-12) —
  **nachgetragen aus dem Quality-Review.** „Die Organisation steht in KEINER Signatur" bleibt fuer
  die drei Portmethoden woertlich wahr, liest sich aber neben `PlanningQueriesFactory` in derselben
  Anwendungsschicht wie ein Widerspruch. Ein Satz, der auf die Fabrik zeigt, genuegt.
- Modify: `apps/api/src/modules/costs/application/plan-cost-facts.port.ts` (Kopf, Abschnitt „Was
  hier bewusst NICHT steht")
- Modify: `apps/api/src/modules/costs/infrastructure/planning-facts.adapter.ts` (Kopf, Abschnitt
  „Verdrahtung")
- Modify: `apps/api/src/modules/costs/index.ts` (Kopf, Abschnitt „Stand des Moduls")
- Modify: `apps/api/test/costs/plan-cost-facts-factory.test.ts` — **zwei Befunde aus dem
  Spec-Review**, beide Text, beide klein, aber beide betreffen die Ehrlichkeit einer Zusage:
  1. Der Dateikopf lautet `(EYT-109)` statt `(EYT-109, M6)`. Die Testmatrix M1–M8 in diesem Plan
     verweist namentlich auf diese Datei; ohne das Label ist der Rueckverweis einseitig.
  2. Ein Kommentar sagt, Test und Produktion „rufen damit **nachweislich** dieselbe Funktion".
     Gemessen ist nur **Verhalten** — es gibt kein `expect(...).toBe(...)` auf Identitaet, und ein
     verhaltensgleiches Closure in `AppModule` bliebe gruen. Die Identitaet traegt die statische
     Lesung (`index.ts` re-exportiert dieselbe Bindung aus derselben Datei, `git grep` findet genau
     eine Deklaration), nicht die Zusicherung. Der Kommentar ist auf das Gemessene zurueckzunehmen,
     statt eine kuenstliche Identitaetszusicherung zu erfinden.

**Step 1: `planning-window.repository.ts`, Abschnitt ersetzen**

```
 * ## Organisations-Id: Auswahl, keine Grenze
 *
 * Kein SQL hier filtert eine Mandantengrenze selbst. Die Grenze kommt aus RLS,
 * also aus `app.user_org_ids()` und damit aus dem verifizierten Subjekt, das
 * `PgTenantQueryRunner` transaktionslokal gesetzt hat.
 *
 * Seit EYT-109 kann das Repository zusaetzlich an EINE bereits serverseitig
 * aufgeloeste Organisation gebunden werden (`organisationId` am Konstruktor).
 * Das ist keine zweite Grenze, sondern eine Verengung INNERHALB der ohnehin
 * sichtbaren Menge: eine fremde Id liefert null Zeilen statt fremder Daten,
 * weil RLS die Zeile nie herausgibt. Die Bindung steht am Konstruktor und nicht
 * in einer Portmethode — ein Methodenparameter `orgId` waere die Einladung, ihn
 * aus der URL zu befuellen.
```

**Step 2: `plan-cost-facts.port.ts`, Abschnitt ersetzen**

```
 * ## Was hier bewusst NICHT steht
 *
 * Keine Organisations-Id in einer PORTMETHODE. Sie kommt aus dem gesetzten
 * Datenbankkontext (`app.user_org_ids()` ueber RLS); ein Methodenparameter
 * `orgId` waere die Einladung, ihn aus URL oder Body zu befuellen (REQ-002).
 *
 * Die BINDUNG dagegen steht seit EYT-109 an der Fabrik
 * ({@link PlanCostFactsFactory}) — dort ist sie das Ergebnis von
 * `CostAccessPolicy.authorize`, also serverseitig entschieden, und sie verengt
 * nur, was RLS ohnehin schon sichtbar macht.
```

**Step 3: `planning-facts.adapter.ts`, Abschnitt „Verdrahtung" ersetzen**

```
 * ## Verdrahtung
 *
 * Seit EYT-109 in `AppModule` registriert — aber als FABRIK
 * (`PLAN_COST_FACTS_FACTORY`), nie als Singleton: ein Adapter je Subjekt und
 * Organisation, sonst reichte die Identitaet der ersten Anfrage an alle
 * folgenden weiter. Die eine Baustelle ist `plan-cost-facts.factory.ts`; die
 * Route darauf kommt mit Task 13.
```

**Step 4: `costs/index.ts`, Abschnitt „Stand des Moduls" ersetzen**

```
 * ## Stand des Moduls
 *
 * Es gibt Routen (EYT-106/EYT-108: Mitarbeiterliste, Satzhistorie, neue
 * Satzversion), Autorisierung und Satzpersistenz. Seit EYT-109 ist zusaetzlich
 * die Faktenfabrik verdrahtet; die Snapshot-Route selbst steht noch aus
 * (Task 13), ebenso der XLSX-Adapter (EYT-110).
```

**Step 5: Format und Commit**

```bash
pnpm exec prettier --check apps packages docs
git add apps/api/src/modules/planning/infrastructure/planning-window.repository.ts \
        apps/api/src/modules/costs/application/plan-cost-facts.port.ts \
        apps/api/src/modules/costs/infrastructure/planning-facts.adapter.ts \
        apps/api/src/modules/costs/index.ts
git diff --cached --name-only
git commit -m "docs(costs): EYT-109 — Dateikoepfe an die neue Organisationsbindung angleichen"
```

---

## Task 7: Gegenmutation GM-MO-1 — die Bindung ignorieren

**Erwartung:** M3, M4, M6 und die Integrationsfaelle werden ROT.

**Step 1: Sicherungskopie (kein `git checkout` als Rueckweg)**

`git checkout --` stellt den COMMIT-Stand her, nicht den Arbeitsstand. Alles hier ist committet,
aber die Kopie kostet nichts und hat schon zweimal Arbeit gerettet.

```bash
cp apps/api/src/modules/planning/infrastructure/planning-window.repository.ts /tmp/gm-mo-1.bak
```

**Step 2: Mutation einspielen**

In `organisationOf` den Ternaeroperator durch den ungebundenen Zweig ersetzen:

```ts
    // GM-MO-1: Bindung ignorieren
    const orgs = await tx.query<OrgRow>("select id, time_zone from public.organizations");
```

**Step 3: Beweisen, dass die Mutation WIRKLICH in der Datei steht**

```bash
grep -n "GM-MO-1" apps/api/src/modules/planning/infrastructure/planning-window.repository.ts
grep -c "id::text = \$1" apps/api/src/modules/planning/infrastructure/planning-window.repository.ts
```

Erwartet: eine Trefferzeile fuer `GM-MO-1`, und `0` fuer `id::text = $1`.
Kein Treffer = die Mutation wurde nicht geschrieben; dann NICHT messen.

**Step 4: Kohaerenz pruefen — es muss ein VERHALTENS-, kein Compilerfehler sein**

```bash
pnpm --filter @easytree/api exec tsc --noEmit -p tsconfig.json
```

Erwartet: Exit 0. `organisationId` bleibt ein ungelesenes privates Feld — `noUnusedLocals` ist in
`tsconfig.base.json` nicht gesetzt, das kompiliert. Schlaegt der Typecheck doch fehl, ist die
Mutation inkohaerent und muss umgebaut werden; ein Compilerfehler ist kein Verhaltensnachweis.

**Step 5: Messen**

```bash
pnpm --filter @easytree/api exec vitest run test/planning-organisation-binding.test.ts test/costs/plan-cost-facts-factory.test.ts
```

Erwartet, namentlich zu pruefen:
- `liest mit Bindung auf A ausschliesslich A` → **FAIL** (`AMBIGUOUS_ORGANISATION`)
- `liest mit Bindung auf B ausschliesslich B` → **FAIL**
- `uebergibt die Organisation als Parameter und interpoliert sie nicht` → **FAIL** (`params: []`)
- `liest ohne Bindung unveraendert…` → weiterhin PASS (die ungebundene Semantik ist unberuehrt)

> `plan-cost-facts-factory.test.ts` bleibt hier **gruen**: es misst die Weitergabe AN die
> Planungsfabrik, nicht deren Auswertung. Das ist kein Mangel, sondern die Arbeitsteilung — GM-MO-1
> trifft die Auswertung, und die Integrationsfaelle in `db-gates` treffen beides. Die Erwartung
> „M6 wird rot" aus der Auftragsvorlage ist damit praeziser gefasst: M6 wird von GM-MO-1 **nicht**
> getroffen; getroffen wird sie von der Mutation „zweites Argument in
> `plan-cost-facts.factory.ts` weglassen", die als Zusatzmessung in Step 6 laeuft.

**Step 6: Zusatzmessung fuer M6**

```bash
cp apps/api/src/modules/costs/infrastructure/plan-cost-facts.factory.ts /tmp/gm-mo-1b.bak
```

In der Fabrik das zweite Argument fallen lassen:

```ts
  // GM-MO-1b: Organisation auf dem Weg verlieren
  return (subjectUserId, _organisationId) => new PlanningFactsAdapter(queriesFor(subjectUserId));
```

```bash
grep -n "GM-MO-1b" apps/api/src/modules/costs/infrastructure/plan-cost-facts.factory.ts
pnpm --filter @easytree/api exec tsc --noEmit -p tsconfig.json
pnpm --filter @easytree/api exec vitest run test/costs/plan-cost-facts-factory.test.ts
```

Erwartet: `grep` findet die Zeile, `tsc` Exit 0, **beide Faelle FAIL** (`organisationId` ist
`undefined` statt `ORG_B`).

**Step 7: Beide Mutationen zuruecknehmen und das Zuruecknehmen BELEGEN**

```bash
cp /tmp/gm-mo-1.bak apps/api/src/modules/planning/infrastructure/planning-window.repository.ts
cp /tmp/gm-mo-1b.bak apps/api/src/modules/costs/infrastructure/plan-cost-facts.factory.ts
git diff --stat
git status --porcelain
```

Erwartet: `git diff --stat` gibt **nichts** aus, `git status --porcelain` zeigt keine Aenderung
unter `apps/`. Ein leeres `diff` ist der Beleg — nicht die Behauptung, zurueckgenommen zu haben.

```bash
pnpm --filter @easytree/api exec vitest run test/planning-organisation-binding.test.ts test/costs/plan-cost-facts-factory.test.ts
```

Erwartet: wieder alle PASS.

---

## Task 8: Gegenmutation GM-MO-2 — Rueckfall auf die erste sichtbare Organisation

**Erwartung:** M5 (Unit) und der Integrationsfall „liefert bei einer nicht sichtbaren
Organisation nichts" werden ROT.

**Step 1: Sicherungskopie**

```bash
cp apps/api/src/modules/planning/infrastructure/planning-window.repository.ts /tmp/gm-mo-2.bak
```

**Step 2: Mutation einspielen**

In `organisationOf`, direkt vor `if (orgs.rows.length === 0) return …`:

```ts
    // GM-MO-2: stiller Rueckfall auf die erste sichtbare Organisation
    if (orgs.rows.length === 0 && this.organisationId !== null) {
      const alle = await tx.query<OrgRow>("select id, time_zone from public.organizations");
      const erste = alle.rows[0];
      if (erste !== undefined) return { ok: true, org: erste };
    }
```

**Step 3: Mutation belegen und Kohaerenz pruefen**

```bash
grep -n "GM-MO-2" apps/api/src/modules/planning/infrastructure/planning-window.repository.ts
pnpm --filter @easytree/api exec tsc --noEmit -p tsconfig.json
```

Erwartet: Trefferzeile vorhanden, `tsc` Exit 0.

**Step 4: Messen**

```bash
pnpm --filter @easytree/api exec vitest run test/planning-organisation-binding.test.ts
```

Erwartet, namentlich:
- `liefert bei einer nicht sichtbaren Organisation nichts und faellt auf keine sichtbare zurueck`
  → **FAIL** (`ok: true`, `timeZone: "Europe/Berlin"`)
- `bindet auch publishedVersions und publishedAssignments` → **FAIL**
- `behandelt eine SQL-artige Eingabe als Wert, nicht als Text` → **FAIL**
- M1–M4 → weiterhin PASS

**Step 5: Zuruecknehmen und belegen**

```bash
cp /tmp/gm-mo-2.bak apps/api/src/modules/planning/infrastructure/planning-window.repository.ts
git diff --stat
pnpm --filter @easytree/api exec vitest run test/planning-organisation-binding.test.ts
```

Erwartet: leeres `diff --stat`, alle Faelle PASS.

> Der Integrationsfall zu GM-MO-2 laesst sich auf dieser Maschine nicht messen (kein Stack). Das
> ist im Bericht so zu sagen: die DB-Seite der Gegenmutation ist **nicht ausgefuehrt**, nur die
> Unit-Seite.

---

## Task 8b: Gegenmutation GM-MO-3 — die Nutzdatenverengung entfernen (nachgetragen zu D7)

**Erwartung:** `listet an B gebunden nur veroeffentlichte Versionen aus B` wird ROT.

Entferne `and org_id = $3` aus `publishedVersions`. Beleg, Kohaerenz, Messung, Ruecknahme wie bei
GM-MO-1/2 — mit einer Besonderheit:

```bash
grep -n -F 'org_id = $3' apps/api/src/modules/planning/infrastructure/planning-window.repository.ts
```

**`-F` ist Pflicht.** macOS-`grep` behandelt `$` auch mitten im Muster als Zeilenende-Anker; ein
Muster `org_id = $3` ohne `-F` meldet faelschlich „nicht gefunden" und die Mutation saehe
eingespielt aus, obwohl sie es nicht ist. Gemessen 12.08.2026 an genau dieser Datei.

---

## Task 8c: Gegenmutation GM-MO-4 — die Org-Bedingung an die falsche Parameterstelle haengen

**Erwartung:** `listet an B gebunden nur veroeffentlichte Versionen aus B` wird ROT, und zwar an der
Zusicherung `orgBedingungBindetAn`, **nicht** an der Ergebnisliste.

Aendere in `publishedVersions` `and org_id = $3` zu `and org_id = $1`, ohne die Parameterliste
anzufassen. Die Mutation kompiliert (`$1` existiert) und ist damit kohaerent.

**Warum diese Mutation noetig war (gemessen 12.08.2026):** die Attrappe filtert nach Parameter*wert*
und nicht nach Position. Sie fand `ORG_B` weiterhin in `params[2]` und lieferte unveraendert die
richtige Liste — die Ergebniszusicherung blieb **gruen**. Rot wurde ausschliesslich die neue
Zusicherung:

```
AssertionError: org_id haengt an $1, dort steht aber 2026-W02:
expected '2026-W02' to be '00000000-0000-4000-8000-0000000000b2'
```

Damit ist belegt, dass eine falsche Parameternummer vor dieser Runde in KEINEM Unittest aufgefallen
waere — sie waere erst gegen echtes PostgreSQL im `db-gates`-Lauf sichtbar geworden, und in einem
Teil der Faelle nicht einmal dort als Fehler, sondern als still leeres Ergebnis.

---

## Ruecknahme-Belege richtig eingrenzen

Laeuft eine Gegenmutation **vor** dem Commit der zugehoerigen Arbeit, ist ein global leerer
`git diff --stat` **unerreichbar** — die noch ungestagte Arbeit steht zwangslaeufig darin. Der
Beleg gehoert dann auf die mutierte Datei eingegrenzt:

```bash
git diff --stat -- <pfad/der/mutierten/datei>     # muss leer sein
diff /tmp/<sicherungskopie> <pfad/der/mutierten/datei>   # Exit 0
```

Zweimal in diesem Slice als „Erwartung nicht erfuellbar" gemeldet worden — das ist die richtige
Reaktion, aber die Erwartung gehoert von vornherein richtig gestellt.

---

## Zwei gemessene Vakuitaeten, die dieselbe Runde geschlossen hat

Beide wurden im Quality-Review **ausgefuehrt**, nicht vermutet, und beide liessen die Suite
faelschlich gruen:

- `where id::text = $1` → `where time_zone = $1` in `organisationOf`: **8/8 gruen**. Die Attrappe
  filtert auf `org.id === params[0]`, unabhaengig davon, was das SQL sagt — Spalte und Vergleich
  waren damit unsichtbar. Geschlossen durch `expect(abfrage.sql).toMatch(/where id::text = \$1/)`.
- ` where true` an das ungebundene Statement angehaengt: **8/8 gruen**, weil M1 nur
  `params.length === 0` prueft. Geschlossen durch
  `expect(abfrage.sql).toBe("select id, time_zone from public.organizations")` — D2 nennt diese
  Byte-Identitaet tragend, also gehoert sie zugesichert.

---

## Task 9: Volle Validierung, Commit, Push, CI

**Step 1: Lokale Gates in der Reihenfolge, in der CI sie faehrt**

```bash
pnpm exec prettier --check apps packages docs
pnpm lint
pnpm typecheck
pnpm --filter @easytree/api test
```

Erwartet: alle Exit 0. `pnpm typecheck` ist der Schritt, der Typfehler in Testdateien findet —
`vitest` allein tut das nicht.

**Step 2: Architektur- und Grenztests noch einmal einzeln**

```bash
pnpm --filter @easytree/api exec vitest run test/architecture.test.ts test/architecture-red-case.test.ts test/costs-module-boundaries.test.ts test/costs-module-boundaries.red-case.test.ts test/openapi-route-conformance.test.ts
```

Erwartet: alle PASS. Der Vertrag ist unberuehrt — es kommt keine Route hinzu, also darf
`openapi-drift` nicht anschlagen.

**Step 3: Push**

```bash
git log --oneline origin/feat/eyt-109-daily-plan-cost-snapshot..HEAD
git push origin feat/eyt-109-daily-plan-cost-snapshot
git rev-parse HEAD
```

Den neuen Head-SHA notieren — die CI-Verifikation muss auf genau diesem laufen.

**Step 4: CI abwarten und JEDEN Pflichtjob einzeln lesen**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree <NEUER_HEAD_SHA> 3600
gh run list --commit <NEUER_HEAD_SHA> --json databaseId,name,conclusion
```

Erwartet: elf Jobs, alle `success` — `format`, `lint`, `typecheck`, `unit-tests`, `build-web`,
`web-smoke`, `build-api`, `secret-scan`, `db-gates`, `read-through`, `auth-journey`.

**Step 5: Die DB-Gates NAMENTLICH aus dem Log holen**

Ein gruener Job ist kein ausgefuehrtes Gate. Die Zaehlzeilen lesen:

```bash
gh run view <RUN_ID> --log --job <DB_GATES_JOB_ID> | grep -E "^\[(planning-published-reads|cost-snapshot|tenant-isolation|tenant-pooling|planning-invariants)\]"
```

Erwartet, woertlich:
- `[planning-published-reads] mode=required executed=… skipped=0` — mit `executed` um **zwei
  hoeher** als auf `61fb4b8` (dort waren es die bestehenden Faelle; jetzt kommen die beiden
  Multi-Org-Faelle hinzu). Die alte Zahl vorher aus Lauf `31549941322` ablesen und beide notieren.
- `[cost-snapshot] … skipped=0` unveraendert.

Weicht `executed` nicht um genau zwei ab, sind die neuen Faelle nicht gelaufen — **das ist ein
Blocker, kein Rundungsfehler.**

**Wichtig, gemessen 12.08.2026:** diese Zahl ist eine **Lesekontrolle, kein Maschinengate**.
`scripts/assert-tenant-report.sh` prueft ausschliesslich `executed >= 1`, `skipped == 0` und
`passed == executed` — den Absolutwert nie. Wuerde einer der neuen Faelle spaeter geloescht oder
auf `it.skip` gesetzt, bliebe das Gate mit `executed=8` gruen. Der Vergleich gegen die 7 aus Lauf
`31549941322` muss deshalb von Hand im Log erfolgen und im Bericht als solcher benannt werden.

Dazu ein zweiter, **vorbestehender** Befund am selben Schritt: er faehrt `vitest … | tee` **ohne**
`set -o pipefail` (die fuenf Vorkommen in `ci.yml` liegen bei Z. 141/172/416/587/620, der Schritt
dazwischen). Ein roter Vitest-Lauf macht den Schritt allein also **nicht** rot — tragend ist einzig
`assert-tenant-report.sh` ueber `passed == executed`. Das ist keine Luecke dieses Slice und wird
hier nicht repariert, gehoert aber in die Befundliste.

---

## Task 10: PR-Body aktualisieren (bleibt Draft)

**Step 1: Aktuellen Body lesen, nicht ueberschreiben**

```bash
gh pr view 69 --json body --jq .body > /tmp/pr69-body.md
```

**Step 2: Nur faktische Aenderungen einarbeiten**

- Task 11 / EYT-138 = implemented, CI-verifiziert
- Head und Run-Id auf den neuen Stand
- `RATE_FANOUT_NOT_POINT_IN_TIME` als geschlossen markieren
- D-11-1 dokumentieren: `created_at` wird von PostgreSQL gestempelt
- Multi-Org-Gate **nur** als geschlossen markieren, wenn Task 9 Step 5 die erwarteten Zaehlzeilen
  gezeigt hat

**Step 3: Verfassen, ZURUECKLESEN, dann senden**

Externe Mutationen sind sichtbar und versioniert; ein Entwurfsfragment bleibt dort stehen.

```bash
# Datei bearbeiten, dann:
cat /tmp/pr69-body.md          # zurueckgelesen, bevor es rausgeht
gh pr edit 69 --body-file /tmp/pr69-body.md
gh pr view 69 --json isDraft,body --jq '{isDraft: .isDraft}'
```

Erwartet: `isDraft: true`. **Kein `gh pr ready`. Kein Merge. Keine Jira-Transition.**

---

## Testmatrix M1–M8

| Fall | Test | Datei | Vorher | Nachher |
| --- | --- | --- | --- | --- |
| M1 | `liest ohne Bindung unveraendert, wenn genau eine Organisation sichtbar ist` | `planning-organisation-binding.test.ts` | existiert nicht | PASS, `params: []` |
| M2 | `bleibt ohne Bindung bei zwei Mitgliedschaften mehrdeutig` (+ Integrationsfall) | dto. / `planning-published-reads.integration.test.ts` | Verhalten vorhanden, unbelegt | `AMBIGUOUS_ORGANISATION` |
| M3 | `liest mit Bindung auf A ausschliesslich A` (+ Integration) | dto. | nicht konstruierbar | nur Alpha-Daten |
| M4 | `liest mit Bindung auf B ausschliesslich B` (+ Integration) | dto. | nicht konstruierbar | nur Beta-Daten |
| M5 | `liefert bei einer nicht sichtbaren Organisation nichts…` (+ Integration M5a/M5b) | dto. | nicht konstruierbar | `NO_ORGANISATION`, kein Rueckfall |
| M6 | `reicht Subjekt UND Organisation an die Planungsfabrik weiter` + `wird von AppModule aus derselben Funktion gebaut` | `costs/plan-cost-facts-factory.test.ts` | keine Fabrik, keine Verdrahtung | Organisation kommt an |
| M7 | `uebergibt die Organisation als Parameter…` + `behandelt eine SQL-artige Eingabe als Wert…` | `planning-organisation-binding.test.ts` | kein Parameter | `params: [id]`, Id nicht im SQL-Text |
| M8 | bestehende Suiten unveraendert | `planning-window.http`, `planning-gateway-parity`, `planning-access`, `planning-conflict`, `planning-invariants.integration`, `tenant-isolation.integration`, `architecture*`, `costs-module-boundaries*` | PASS | PASS, gleiche Zahl |

---

## Stop-Bedingungen waehrend der Umsetzung

Sofort abbrechen und `BLOCKED` melden, wenn:

1. der PR-Head bei Task 0 nicht `61fb4b8…` ist und der Drift nicht sicher rekonstruierbar ist;
2. sich zeigt, dass `CostAccessPolicy.organisationId` doch nicht eindeutig serverseitig aufgeloest
   ist (waere ein Widerspruch zu `cost-access.policy.ts:88-97` — dann zuerst belegen);
3. eine Migration noetig scheint. Nach jetzigem Stand ist keine noetig: die Loesung liest nur die
   bestehende Tabelle `public.organizations` unter bestehender RLS. Erscheint dennoch eine
   erforderlich, **zuerst begruenden, nicht schreiben**;
4. ein bestehender Einzel-Organisations-Pfad nur ueber einen Breaking Change erhalten bliebe (die
   Optionalitaet des zweiten Fabrikarguments soll genau das verhindern — schlaegt sie fehl, ist
   der Entwurf falsch);
5. nach drei verschiedenen Reparaturhypothesen derselbe Root Cause offen bleibt.

## Bewusst ausserhalb dieses Slice

- Task 13: Snapshot-Route (`POST /kosten/snapshots`, `GET /kosten/snapshots/:id`) und ihr
  Controller. Dieser Plan legt die Fabrik bereit, ruft sie aber aus keiner Route.
- Ein eigener Fehlercode fuer „gebundene Organisation nicht sichtbar" (D4).
- Ein Organisationswechsler in der Oberflaeche (EYT-14).
- `planningWindow` ueber HTTP mit Organisationsbindung zu versorgen — der Planungscontroller
  bleibt einstellig und damit unveraendert.
- EYT-110 / XLSX, Sprint 6, EYT-119 ff.
