# EYT-113 Inkrement 2 — Selected-Organisation Server Boundary + costs.read Load Gate

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **NICHT COMMITTEN.** MODE `INTERNAL_PLAN_ALLOWED`: dieses Dokument ist ein internes
> Arbeitsartefakt und darf nie Teil eines Commits werden (kein `git add docs/plans/…`;
> nur benannte Pfade stagen). Jira, Confluence und der Auftrag bleiben übergeordnet.
>
> **REVISION 2 (29.08.2026).** Revision 1 endete mit
> `BLOCKED_SCOPE — selected organisation is not server-verifiable at route-render time`
> (alte D2). **Die PO-Entscheidung liegt jetzt vor** und entspricht Option A:
> Kostenberechtigung bleibt organisationsbezogen; die Abschwächung
> „`costs.read` in irgendeiner Organisation" ist VERBOTEN; die ausgewählte
> Organisations-Id ist ausschließlich ein **Selector**, nie Autorisierungsquelle;
> der Server prüft sie gegen die real verifizierte Session und deren
> organisationsbezogene Permissions; unbekannte Organisation, Organisation nicht
> in der Session, fehlendes `costs.read`, unbekannte Session ⇒ **fail closed**.
> Dieser Plan ist die ausführbare Fassung dieser Entscheidung.

**Goal:** Ein serverseitiges, an der **ausgewählten** Organisation verifiziertes
`costs.read`-Lade-Gate für `/kosten` und `/kosten/stundensaetze`: ohne verifiziertes
Recht der ausgewählten Organisation werden weder Kosten-Navigation noch
Kosten-Client-Komponenten noch Kostenwerte ausgeliefert; die API-Autorisierung
bleibt unverändert bindend.

**Architecture:** Die bestehende Client-Organisationsauswahl wird über ein kleines,
nicht-geheimes Selector-Cookie (`eyt_org`) beim Server-Render sichtbar. Ein pures
Gate (`kostenFreigabe`) verifiziert den Selector gegen die per
`leseServerSitzung` real geprüfte Session (Helper zieht von `lib/feld/` nach
`lib/` um) und entscheidet fail-closed in fünf Zuständen; beide Kosten-Pages bauen
Kosten-JSX **nur im gewährten Zweig**. Keine neue Backend-Wahrheit, keine
Migration, keine neuen API-Endpunkte.

**Tech Stack:** Next 16.2.11 App Router (RSC, `headers()`/`cookies()`), React 19,
Zod-Contracts, Vitest (jsdom + SWC), Playwright (auth-journey mit echter API +
GoTrue + Supabase; shell-smoke ohne API), pgTAP-freie Fixture-SQL via
`psqlMitMarker`.

---

## Verifizierte Ausgangslage (Messstand 29.08.2026, gegen `origin/master = 028ccfb39f54db52d74b15b88434357371d39265`)

Alle Codezitate aus `git show 'origin/master:…'` — der lokale Checkout steht auf
`feat/eyt-126-container-staging` und hat die Werkbank-Route-Group noch nicht.

1. **Pages:** `apps/web/app/(werkbank)/kosten/page.tsx` (async, liest nur
   `searchParams["snapshot"]`, rendert `KostenZugang` mit `KostenAnsicht` +
   Stundensatz-Card als children) und `…/kosten/stundensaetze/page.tsx` (sync,
   `KostenZugang` + `RateManagement`). Kein weiterer Importeur der
   Kosten-Client-Komponenten außer diesen zwei Pages (`kosten-uebergang.tsx` ist
   nur ein Link).
2. **`KostenZugang`** (`apps/web/components/kosten-zugang.tsx`) ist `"use client"`,
   entscheidet per `useSession()`; Zustände: `kosten-laedt`, Fehler-`ErrorState`,
   `kosten-unauthenticated`, „Organisation wählen"-Banner (bei `organisation === null`),
   `kosten-forbidden` (mit Org-Namen), sonst children. Bekanntes RSC-Verhalten
   (Projektgedächtnis: Flight trägt Client-Props/-Referenzen auch ungerendert):
   die Client-Referenzen stehen sehr wahrscheinlich schon im HTML/Flight des
   nicht Berechtigten — **T2 misst das, behauptet es nicht.**
3. **Serverseitige Sitzung existiert:** `apps/web/lib/feld/sitzung-server.ts` —
   `leseServerSitzung(cookieHeader)` fragt `GET /auth/session` gegen
   `aktuellesProxyziel()` (einzige erlaubte Ziellese-Stelle, EYT-126), drei
   Zustände fail-closed (`angemeldet` mit striktem `SessionDto` / `abgemeldet`
   nur bei 401 / sonst `unbekannt`). Genau drei Importeure:
   `app/feld/layout.tsx`, `app/(werkbank)/page.tsx`, `test/sitzung-server.test.ts`.
4. **SessionDto** (`packages/contracts/src/auth/schemas.ts`): `strictObject` mit
   `userId` + `organisations[]` (je `id`, `name`, `role`, serverseitig aufgelöste
   `permissions`). **Die gewählte Organisation ist beim Server-Render heute nicht
   lesbar** (erschöpfend gemessen, Revision 1 Fakt 4): Auswahl lebt allein in
   `session-provider.tsx` (`useState`, Mehr-Org ⇒ keine stille Auswahl; genau
   eine Org ⇒ implizit) + `app/providers.tsx` (`useRef` → Costs-Gateway-Header
   `X-EasyTree-Organization-Id`, der nur auswählt, nie autorisiert —
   `cost-access.policy.ts`: bei genau einer Mitgliedschaft löst die API die Org
   auch OHNE Header auf). Cookies heute: nur `eyt_access`/`eyt_refresh`
   (HttpOnly, Strict).
5. **Feld-Gate-Muster:** `app/feld/layout.tsx` — `headers()` →
   `leseServerSitzung` → `abgemeldet` ⇒ `redirect("/anmelden")`, `unbekannt` ⇒
   `ErrorState` `feld-sitzung-unbekannt`, sonst Shell.
6. **Journey-Infrastruktur** (`apps/web/e2e/auth-journey/`, CI-Job `auth-journey`,
   echte `dist/main.js` + GoTrue + Supabase, `mode: "serial"`, eigene Ports
   3100/3101, `EASYTREE_API_PROXY_TARGET` in `webServer.env`): Schritt 9g2 beweist
   den **Client**-Forbidden (`kosten-forbidden`) für einen geliehenen `member`
   (`eyt136-member-an.sql`/`-aus.sql` via `psqlMitMarker` aus `global-setup`);
   der Test „EYT-113: ein member erreicht die Feld-Shell…" (Z. 3251) beweist
   Cross-Shell. Hauptreise Schritt 5 asserted für Benutzer A **genau eine**
   Organisation — läuft VOR unserem neuen Test (seriell), bleibt daher gültig,
   solange die Zweitorg-Leihgabe eng an/aus bleibt. Artefakt-Upload:
   `apps/web/test-results/auth-journey/` (ci.yml Z. 788-790).
7. **shell-smoke** (`apps/web/e2e/shell-smoke.spec.ts`, Job `web-smoke`, KEINE
   API): Session-unknown-Muster existiert bereits für `/feld` (Z. 512:
   `feld-sitzung-unbekannt` sichtbar, `role="alert"`). `/kosten` wird dort heute
   auf 2xx + Fehlermuster-Freiheit + Banner geprüft (Z. 373-400), plus axe und
   Token-Auslieferung — Flächenwechsel auf die Unknown-Fläche bricht davon
   nichts Erwartbares, wird aber in T8 nachgemessen.
8. **Architektur-Wächter:** `apps/api/test/architecture/rules.ts` (u. a.
   `feld-shell-boundary`; `apps/web/lib/` ist erlaubtes Feld-Importziel — der
   Helper-Move bricht keine Grenze), `scan.ts`, Rot-Beweise in
   `architecture-red-case.test.ts` gegen synthetischen Baum in `os.tmpdir()`.
9. **Unit-Muster:** `planung-page.test.tsx` (Page-Test mit `vi.mock` auf
   `next/navigation` via `helpers/navigation-attrappe`, Provider-Wrapping),
   `sitzung-server.test.ts` (Helper-Matrix), `helpers/werkbank.tsx`.
10. **gbrain** (Pflichtabfrage 29.08. erneut gelaufen): kein EasyTree-Kontext —
    Jira + Confluence + Repo sind die Quellen.
11. Sprint-7-Rule `.claude/rules/sprint-7-ui-ux-acceptance.md` bindend: reale
    Journeys, Negativ-Reise, Gegenbeweis-Pflicht, kein Baseline-Selbst-Update,
    Endstatus-Deckel `READY_FOR_REVIEW — EYT-113 INCREMENT 2`.

### Bekannte Lücken (werden gemessen, nicht angenommen)

- **L-A:** Exaktes Chunk-/Flight-Verhalten von Next 16.2.11 für statisch
  importierte, aber nicht gerenderte Client-Komponenten ist ungemessen. T2 misst
  vorher, T7 nachher; D4 hat die Entscheidungsgabel.
- **L-B:** Ob `/kosten/stundensaetze` heute statisch vorgerendert wird. Ein Gate
  mit `headers()`/`cookies()` macht die Route dynamisch — Build bleibt OHNE
  Proxyziel grün (dynamische APIs verhindern das Prerender; genau deshalb müssen
  beide Pages sie aufrufen, BEVOR irgendetwas anderes passiert). Build-Route-Tabelle
  vorher/nachher festhalten.
- **L-C:** Die sechs historischen `scan.ts`-Lücken sind nicht inventarisiert.
  T10 prüft nur, ob die EINE neue Regel dadurch still grün bleiben kann —
  wenn ja: STOP mit Evidenz, keine Scanner-Generalreparatur.

---

## Entscheidungen D1–D6

- **D1 — Gate pro Page, nicht im Layout.** Layout und Page rendern parallel; nur
  ein Gate in beiden Pages garantiert, dass im Verweigerungsfall kein
  Kosten-JSX entsteht, und läuft bei jeder Segment-Anforderung (auch
  Client-Navigation). Beide Pages rufen denselben Helper.
- **D2 (RESOLVED) — Selector-Cookie `eyt_org`.** Kleinster kompatibler
  Request-Selector, keine neue Backend-Wahrheit:
  - **Name/Attribute:** `eyt_org=<uuid>; path=/; SameSite=Lax` — bewusst NICHT
    HttpOnly (der Client schreibt es), ohne `Secure` (lokal http; Inhalt ist
    eine nicht-geheime Auswahl), ohne `Max-Age` (Session-Cookie). Kein Token,
    kein Geheimnis: der Server behandelt den Wert ausschließlich als Selector.
  - **Schreiben:** genau EINE Stelle — die Kompositionswurzel `app/providers.tsx`
    im bestehenden `onOrganisationChange`-Seam. Wert geändert ⇒ Cookie schreiben
    + `router.refresh()` (Server-Flächen folgen der Auswahl); `null` ⇒ Cookie
    löschen. Unverändert ⇒ nichts (kein Refresh-Loop, kein Extra-RSC-Lauf).
  - **Lesen (Server):** Pages lesen `cookies().get("eyt_org")` und geben den
    Wert an das pure Gate. Verifikation: Id muss in
    `session.organisations` der real geprüften Session stehen; sonst zählt sie
    als **keine Auswahl** (fail closed). Ein fremdes/ungültiges Cookie fällt
    damit wirkungslos — und heilt sich selbst: sobald die Client-Session lädt
    und eine Organisation eindeutig ist, überschreibt der Seam das Cookie und
    refresht.
  - **Lesen (Client, Restore):** `providers.tsx` liest das Cookie einmal und
    reicht es als `initialeOrganisationId` an den `SessionProvider`; validiert
    wird dort wie bisher über `orgs.find(…)` — eine nicht enthaltene Id ergibt
    `organisation = null`. Damit sind Server-Gate und Client-Anzeige nach
    Reload kohärent. **Semantik-Änderung, dokumentiert:** die Auswahl überlebt
    jetzt einen Reload (bisher: Reset); Mehr-Tab: Cookie ist tab-übergreifend,
    Client-State je Tab bis zur nächsten Auswahl/Reload.
  - Der `SessionProvider` meldet `onOrganisationChange` nur noch in den
    Zuständen `angemeldet`/`abgemeldet` — sonst löschte der transiente
    `laedt`/`fehler`-Nullwert bei jedem Seitenaufbau das Cookie.
  - **Nie:** Any-Org-Prüfung; Cookie als Autorisierungsquelle; Änderung an
    `X-EasyTree-Organization-Id` oder der API-Policy.
- **D3 — Session-Helper wird geteilt, nicht dupliziert.**
  `apps/web/lib/feld/sitzung-server.ts` → `apps/web/lib/sitzung-server.ts`.
  Reiner Move; einzige inhaltliche Änderung ist die interne Importzeile
  `"../proxy-durchreichen"` → `"./proxy-durchreichen"`. Genau drei Importeure
  ziehen nach (Fakt 3). `git diff --find-renames` muss exakt diese eine Zeile
  zeigen; jede weitere Änderung ist ein Befund. Neue Logik kommt in **eigene
  Dateien**, nie in die bewegte.
- **D4 — Ladegrenze: kleinste nachweislich funktionierende Variante, per Messung.**
  Stufe 1: Kosten-JSX entsteht nur im gewährten Zweig (statische Imports bleiben,
  wenn T7 beweist, dass weder Flight-Referenzen noch Chunk-Requests im
  Verweigerungsfall entstehen). Stufe 2 (nur falls T7 Stufe 1 widerlegt): die
  Kosten-Client-Komponenten hinter eine dynamische Importgrenze im gewährten
  Zweig ziehen (`await import("…/kosten-ansicht")` etc. im Server-Component-Body),
  erneut messen. Scheitert auch Stufe 2 ⇒ STOP (Auftrags-Stop-Condition).
- **D5 — Verweigerungsflächen serverseitig, Testids wiederverwendet.** Ein
  gemeinsames Server-Component `components/kosten-grenze.tsx` rendert
  `verboten` (`kosten-forbidden`, mit Org-Namen), `abgemeldet`
  (`kosten-unauthenticated`, Link `/anmelden`), `keine-auswahl`
  (`kosten-org-auswahl`, Hinweis auf die Kopfleisten-Auswahl), `unbekannt`
  (`kosten-sitzung-unbekannt`, analog `feld-sitzung-unbekannt`). Kein Redirect
  für Abgemeldete (kanonische Kosten-Semantik bleibt Banner, kein neuer Fluss).
  `KostenZugang` bleibt im gewährten Zweig unverändert bestehen
  (Defense-in-depth + Client-Zustände laedt/fehler nach Client-Navigation).
  Vor jeder Testid-Bewegung repo-weit greppen (E2E bricht sonst still).
- **D6 — Chunk-Messmethode.** Marker müssen je Client-Datei **ein-Datei-eindeutig**
  sein (per `git grep -c` belegen): Kandidaten `eyt-kosten-ansicht`
  (kosten-ansicht.tsx) und je ein nur in `kosten-zugang.tsx` bzw.
  `rate-management.tsx` vorkommender String — **nicht** `eyt-rate-management`
  (steht auch in `globals.css`) und **nicht** `kosten-forbidden` als
  HTML-Inhalts-Assertion (steht nach D5 auch im Server-Markup; als
  Chunk-BODY-Marker bleibt es tauglich, Servercode landet nie im Client-Chunk —
  sauberer ist ein Marker, der NUR in der Client-Datei existiert). Methode:
  nach dem Build `apps/web/.next/static/chunks/**/*.js` nach den Markern
  greppen ⇒ konkrete Chunk-Dateinamen; im Test dann (a) kein Request auf diese
  Dateinamen, (b) `page.content()` referenziert keinen dieser Dateinamen,
  (c) keine Kostenwerte/€-Beträge/Mitarbeiternamen in HTML oder Netzwerk.
  Positivkontrolle: Markermenge nicht leer UND die gewährte Reise lädt die
  Chunks — sonst liefe der Wächter still leer.

## Verhaltensmatrix (REQ-IDs dieses Slices)

| REQ | Server-Zustand | `/kosten` und `/kosten/stundensaetze` |
| --- | --- | --- |
| REQ-L1 | angemeldet, genau eine Org, ohne `costs.read` | `kosten-forbidden` serverseitig; keine Kosten-Client-Referenzen/-Chunks/-Werte |
| REQ-L1b | angemeldet, mehrere Orgs, Selector = Org **ohne** Recht (andere Org MIT Recht existiert) | wie REQ-L1 — die andere Org überschreibt nichts (PO-Entscheidung) |
| REQ-L1c | angemeldet, mehrere Orgs, Selector fehlt/ungültig/fremd | `kosten-org-auswahl` (fail closed), keine Kostenreferenzen |
| REQ-L2 | abgemeldet | `kosten-unauthenticated` mit Link `/anmelden` (kein Redirect) |
| REQ-L3 | unbekannt (API down/Antwort unlesbar/Ziel fehlt) | `kosten-sitzung-unbekannt`; ausdrücklich NICHT die Abgemeldet-Fläche; keine Kosten-UI |
| REQ-L4 | angemeldet, Selector = Org **mit** Recht (oder genau eine Org mit Recht) | unverändert produktiv: `KostenZugang` + Inhalt, Snapshot-/Stundensatzreise, `?snapshot=`-Validierung |
| REQ-L5 | jeder Zustand | direkter API-Zugriff bleibt 403/400 ohne Recht (bestehende Policy, Regressionsnachweis) |
| REQ-L6 | Teilbaum | beide Routen tragen dasselbe Gate; kein Unterpfad umgeht es (Direct-URL geprüft) |

---

## Aufgabenliste

### T1 — Startzustand herstellen und STOP-Checks

**Step 1:** `git fetch origin && git rev-parse origin/master` — MUSS
`028ccfb39f54db52d74b15b88434357371d39265` sein, sonst STOP → melden, Plan neu
gegen den echten Stand ableiten.

**Step 2:** Eigenen Worktree anlegen (Turbo-Cache-Falle: Replays über Worktrees
zählen nicht als Lauf; jede Evidenzzahl braucht `--force` + `Cached: 0 cached`):
```bash
git worktree add ../EasyTree-eyt113 -b feat/eyt-113-selected-org-cost-boundary origin/master
cd ../EasyTree-eyt113 && pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # frischer Worktree hat keine Browser
```

**Step 3:** Frisch messen, nicht annehmen: Jira EYT-113 (Status „In Arbeit"),
`gh pr list --repo DYAI2025/EasyTree --state open` (ein konkurrierender
EYT-113-PR ⇒ STOP), WIP per JQL
`project = EYT AND sprint = 579 AND statusCategory = "In Progress"` im
**issues**-Modus (nie `count`) — Ergebnismenge muss exakt {EYT-113} sein.
`.claude/rules/sprint-7-ui-ux-acceptance.md` lesen.

**Step 4:** Evidenzblock START STATE notieren: Basis-SHA, Branch, Jira-Status,
PR-Zahl, JQL-Ergebnis.

### T2 — Reproduktion messen (L-A; RED-Beweis Teil 1)

**Step 1:** `env -u EASYTREE_API_PROXY_TARGET pnpm build` (exit 0,
`Cached: 0 cached`). Build-Route-Tabelle (`○`/`ƒ` je Route) für `/kosten` und
`/kosten/stundensaetze` festhalten (L-B, vorher).

**Step 2:** Marker-Eindeutigkeit belegen und Chunk-Menge bestimmen:
```bash
git grep -c 'eyt-kosten-ansicht' origin/master -- apps/web        # erwartet: genau die Quelldatei(en) kennen
grep -rl 'eyt-kosten-ansicht' apps/web/.next/static/chunks --include='*.js'
# analog für die in D6 gewählten Marker von kosten-zugang.tsx und rate-management.tsx
```
Ergebnis: Liste `Marker → Chunk-Datei(en)`; notieren, ob ein Marker-Chunk auch
Nicht-Kosten-Code trägt (Bündelungsrisiko ⇒ D4-Stufe 2 wahrscheinlicher).

**Step 3:** Realen Stack starten (lokal: `colima start`,
`pnpm exec supabase start -x vector -x logflare`, psql aus
`/opt/homebrew/opt/postgresql@17/bin`; Env-Ableitung wie ci.yml Job
`auth-journey` / `e2e/auth-journey/config.ts`). Für den geliehenen member ohne
`costs.read` `/kosten` und `/kosten/stundensaetze` direkt anfordern und
festhalten: (a) welche Kosten-Chunks der Browser lädt, (b) welche
Chunk-/Modulreferenzen im HTML/Flight stehen, (c) ob Beträge auftauchen
(erwartet: nein — Daten kommen erst per API, die 403 sagt; die LADEGRENZE ist
das Delta). Zeigt die Messung wider Erwarten „nichts referenziert" ⇒
Auftragsprämisse melden (STOP-Prüfung), nicht stillschweigend weiterbauen.

**Step 4:** REPRODUCTION-Abschnitt der Evidenz schreiben (Ist-Werte, Methode).

### T3 — Helper-Move (D3, reiner Refactor, grün)

**Step 1:** `git mv apps/web/lib/feld/sitzung-server.ts apps/web/lib/sitzung-server.ts`;
in der bewegten Datei genau eine Zeile ändern:
`import { aktuellesProxyziel } from "./proxy-durchreichen";`

**Step 2:** Drei Importeure nachziehen (`app/feld/layout.tsx`,
`app/(werkbank)/page.tsx`, `test/sitzung-server.test.ts`):
`"../../lib/feld/sitzung-server"` → `"../../lib/sitzung-server"` bzw.
`"../lib/feld/sitzung-server"` → `"../lib/sitzung-server"`.

**Step 3:** Verifizieren:
```bash
git grep -n 'lib/feld/sitzung-server' -- apps/web   # MUSS leer sein (Ausgabe zeigen)
git diff --cached --find-renames -- apps/web/lib/sitzung-server.ts  # exakt 1 geänderte Zeile
pnpm --filter @easytree/web exec vitest run test/sitzung-server.test.ts  # Dateizahl ≥ 1 lesen
```

**Step 4:** Commit:
```bash
git add apps/web/lib/sitzung-server.ts apps/web/app/feld/layout.tsx 'apps/web/app/(werkbank)/page.tsx' apps/web/test/sitzung-server.test.ts
git diff --cached --name-only   # exakt diese 4 Pfade (einer davon als Rename)
git commit -m "refactor(web): EYT-113 Sitzungs-Helper aus der Feld-Ecke in lib/ heben"
```

### T4 — Selector-Cookie-Helper (TDD)

**Files:** Create `apps/web/lib/organisations-auswahl-cookie.ts`,
Test `apps/web/test/organisations-auswahl-cookie.test.ts`.

**Step 1 — roter Test:** Matrix für `liesOrgAuswahl` (kein Cookie ⇒ null; Cookie
zwischen anderen ⇒ Wert; leerer Wert ⇒ null; URL-encodete Werte) und für
`schreibeOrgAuswahl` (setzt `eyt_org=<id>; path=/; SameSite=Lax`; `null` löscht
per `Max-Age=0`; jsdom `document.cookie` beobachten). Lauf: rot (Modul fehlt).

**Step 2 — Implementierung:**
```ts
/**
 * Selector-Cookie der Organisationsauswahl (EYT-113 Inkrement 2).
 *
 * Der Wert ist eine AUSWAHL, kein Geheimnis und keine Autorisierung: der
 * Server prueft ihn ausschliesslich gegen die real verifizierte Session
 * (lib/kosten-freigabe.ts) — eine fremde Id faellt dort wirkungslos.
 */
export const ORG_AUSWAHL_COOKIE = "eyt_org";

export function liesOrgAuswahl(cookieHeader: string | null): string | null {
  if (cookieHeader === null || cookieHeader === "") return null;
  for (const teil of cookieHeader.split(";")) {
    const gleich = teil.indexOf("=");
    if (gleich === -1) continue;
    if (teil.slice(0, gleich).trim() !== ORG_AUSWAHL_COOKIE) continue;
    const wert = teil.slice(gleich + 1).trim();
    return wert === "" ? null : decodeURIComponent(wert);
  }
  return null;
}

export function liesOrgAuswahlAusDokument(): string | null {
  if (typeof document === "undefined") return null;
  return liesOrgAuswahl(document.cookie);
}

export function schreibeOrgAuswahl(id: string | null): void {
  if (typeof document === "undefined") return;
  document.cookie =
    id === null
      ? `${ORG_AUSWAHL_COOKIE}=; path=/; SameSite=Lax; Max-Age=0`
      : `${ORG_AUSWAHL_COOKIE}=${encodeURIComponent(id)}; path=/; SameSite=Lax`;
}
```

**Step 3:** Lauf grün (`vitest run test/organisations-auswahl-cookie.test.ts`,
Dateizahl lesen). Commit:
`feat(web): EYT-113 Selector-Cookie der Organisationsauswahl`.

### T5 — Pures Gate `kostenFreigabe` (TDD)

**Files:** Create `apps/web/lib/kosten-freigabe.ts`,
Test `apps/web/test/kosten-freigabe.test.ts`.

**Step 1 — roter Test:** vollständige Matrix (PO-Entscheidung wörtlich
abgebildet): unbekannt→unbekannt; abgemeldet→abgemeldet; eine Org mit Recht,
Selector null→gewährt; eine Org ohne Recht→verboten; mehrere Orgs, Selector
null→keine-auswahl; Selector = Org mit Recht→gewährt; Selector = Org ohne Recht
(andere MIT Recht!)→**verboten, nie gewährt**; Selector fremd/ungültig (auch
bei genau einer Org mit Recht!)→keine-auswahl; leerer String→wie null.
Lauf: rot.

**Step 2 — Implementierung:**
```ts
import type { SessionOrganisation } from "@easytree/contracts";

import type { ServerSitzung } from "./sitzung-server";

/**
 * Serverseitige Kosten-Ladegrenze (EYT-113 Inkrement 2, PO-Entscheidung
 * 29.08.2026): massgeblich ist das verifizierte `costs.read` der AUSGEWAEHLTEN
 * Organisation. Die Selector-Id waehlt nur aus — verifiziert wird sie gegen
 * die real geprueften Mitgliedschaften der Session. Eine Any-Org-Pruefung
 * ist ausdruecklich verboten: Recht in Organisation A gewaehrt nichts,
 * solange Organisation B ausgewaehlt ist.
 *
 * Fail-closed: unbekannte Session, fremde/ungueltige Selector-Id, fehlende
 * Auswahl bei mehreren Organisationen und fehlendes Recht laden nichts.
 */
export type KostenFreigabe =
  | { art: "gewaehrt"; organisation: SessionOrganisation }
  | { art: "verboten"; organisation: SessionOrganisation }
  | { art: "keine-auswahl" }
  | { art: "abgemeldet" }
  | { art: "unbekannt" };

export function kostenFreigabe(
  sitzung: ServerSitzung,
  orgSelektor: string | null,
): KostenFreigabe {
  if (sitzung.zustand === "unbekannt") return { art: "unbekannt" };
  if (sitzung.zustand === "abgemeldet") return { art: "abgemeldet" };

  const orgs = sitzung.session.organisations;
  let organisation: SessionOrganisation | null = null;
  if (orgSelektor !== null && orgSelektor !== "") {
    // Eine Id, die NICHT in der Session steht, faellt ersatzlos — kein
    // Rueckfall auf die einzige Organisation, sonst wuerde ein fremder
    // Selector still uminterpretiert statt abgelehnt.
    organisation = orgs.find((org) => org.id === orgSelektor) ?? null;
  } else if (orgs.length === 1) {
    organisation = orgs[0] ?? null;
  }

  if (organisation === null) return { art: "keine-auswahl" };
  return organisation.permissions.includes("costs.read")
    ? { art: "gewaehrt", organisation }
    : { art: "verboten", organisation };
}
```
Dazu in derselben Datei der dünne Server-Einstieg (wird von beiden Pages
gerufen; `next/headers` bewusst hier, damit die Pages nur EINE Funktion rufen
und die Architekturregel in T10 einen eindeutigen Import prüft):
```ts
import { cookies, headers } from "next/headers";

import { ORG_AUSWAHL_COOKIE } from "./organisations-auswahl-cookie";
import { leseServerSitzung } from "./sitzung-server";

export async function leseKostenFreigabe(): Promise<KostenFreigabe> {
  const kopfzeilen = await headers();
  const keks = await cookies();
  const sitzung = await leseServerSitzung(kopfzeilen.get("cookie"));
  return kostenFreigabe(sitzung, keks.get(ORG_AUSWAHL_COOKIE)?.value ?? null);
}
```

**Step 3:** Lauf grün (Dateizahl lesen). Commit:
`feat(web): EYT-113 kostenFreigabe — Selector verifiziert, fail closed`.

### T6 — Roter Page-/Journey-Beweis, dann Server-Gate in beiden Pages

**Files:** Create `apps/web/test/kosten-page-gate.test.tsx`,
`apps/web/components/kosten-grenze.tsx`; Modify
`apps/web/app/(werkbank)/kosten/page.tsx`,
`…/kosten/stundensaetze/page.tsx`, `apps/web/lib/session-provider.tsx`,
`apps/web/app/providers.tsx`; Create Test
`apps/web/test/session-provider-auswahl.test.tsx`.

**Step 1 — roter Unit-Test (`kosten-page-gate.test.tsx`):** `vi.mock` auf
`../lib/kosten-freigabe` (nur `leseKostenFreigabe` stubben) und auf
`next/navigation` (Muster `planung-page.test.tsx`); je Route und Zustand
`render(await KostenPage({ searchParams: Promise.resolve({}) }))` bzw.
`render(await StundensaetzePage())`; Zusicherungen:
- `unbekannt` ⇒ `kosten-sitzung-unbekannt` sichtbar, `kosten-unauthenticated`
  abwesend (zwei getrennte Zusicherungen — `unbekannt` ≠ `abgemeldet`);
- `abgemeldet` ⇒ `kosten-unauthenticated` + Link `/anmelden`;
- `keine-auswahl` ⇒ `kosten-org-auswahl`;
- `verboten` ⇒ `kosten-forbidden` mit Org-Namen;
- in ALLEN Verweigerungsfällen: kein `eyt-kosten-ansicht`-, kein
  RateManagement-, kein `kosten-laedt`-Testid im Baum;
- `gewaehrt` ⇒ Kosteninhalt vorhanden (mit Provider-Wrapping aus
  `helpers/werkbank.tsx`; für `/kosten` gültige leere `searchParams`, sonst
  fehlte das Testid aus dem falschen Grund — Parameterfehler-Fläche).
Lauf ausführen, **Rot beobachten und protokollieren** (Ist-Werte).

**Step 2 — roter Journey-Beweis:** 9g2 in
`apps/web/e2e/auth-journey/journey.pwtest.ts` um die Ladegrenzen-Zusicherungen
erweitern (Chunk-Requests aus der D6-Markermenge = 0; `page.content()` ohne
diese Chunk-Dateinamen; keine €-Beträge/`MITARBEITER_NAME`; bestehende
API-403-Zusicherungen bleiben) + Positivkontrolle im Admin-Teil (Markermenge
nicht leer, Chunks WERDEN geladen) + Screenshots:
```ts
await seite.screenshot({ path: test.info().outputPath("eyt113-kosten-forbidden.png"), fullPage: true });
// Admin-Teil: eyt113-kosten-positiv.png
```
Lauf lokal ausführen (Stack aus T2), **Rot protokollieren** — laut T2-Messung
erwartbar an den Chunk-Zusicherungen. Commit der roten Tests:
`test(web): EYT-113 rote Lade­grenzen-Beweise vor der Implementierung`.

**Step 3 — `components/kosten-grenze.tsx`** (Server-Component, KEIN
`"use client"`, importiert nur `@easytree/ui` + `next/link` + den
Freigabe-Typ):
```tsx
import Link from "next/link";

import { ErrorState, StateBanner } from "@easytree/ui";

import type { KostenFreigabe } from "../lib/kosten-freigabe";

/** Serverseitige Verweigerungsflaechen der Kosten-Ladegrenze (EYT-113 I2). */
export function KostenGrenze({
  freigabe,
}: {
  freigabe: Exclude<KostenFreigabe, { art: "gewaehrt" }>;
}) {
  switch (freigabe.art) {
    case "unbekannt":
      return (
        <ErrorState
          data-testid="kosten-sitzung-unbekannt"
          title="Anmeldung nicht prüfbar"
          description="Die Anmeldung konnte serverseitig nicht geprüft werden. Bitte versuche es später erneut."
        />
      );
    case "abgemeldet":
      return (
        <StateBanner tone="info" title="Nicht angemeldet" data-testid="kosten-unauthenticated">
          Für den Kostenbereich ist eine Anmeldung erforderlich.{" "}
          <Link href="/anmelden">Zur Anmeldung</Link>
        </StateBanner>
      );
    case "keine-auswahl":
      return (
        <StateBanner tone="info" title="Organisation wählen" data-testid="kosten-org-auswahl">
          Du gehörst mehreren Organisationen an. Bitte wähle oben in der Kopfleiste eine aus —
          ohne Auswahl lädt easyTree keine Kostendaten.
        </StateBanner>
      );
    case "verboten":
      return (
        <ErrorState
          data-testid="kosten-forbidden"
          title="Kein Zugriff auf Kosten"
          description={`Deine Rolle in „${freigabe.organisation.name}" hat das Recht costs.read nicht. Wirtschaftsdaten erscheinen nur mit gesondertem Recht.`}
        />
      );
  }
}
```
(Vorher prüfen: `ErrorState` ohne `onRetry` nutzbar; `data-testid`-Durchreichung
beider UI-Komponenten — sonst Wrapper-`div`.)

**Step 4 — Pages:** in `kosten/page.tsx` als ERSTES
`const freigabe = await leseKostenFreigabe();`, dann `searchParams`; das
bisherige `KostenZugang`-JSX wandert unverändert in den gewährten Zweig:
```tsx
{freigabe.art !== "gewaehrt" ? (
  <KostenGrenze freigabe={freigabe} />
) : (
  <KostenZugang>…bestehende children unverändert…</KostenZugang>
)}
```
`stundensaetze/page.tsx` wird `async` und erhält denselben Zweig um
`<KostenZugang><RateManagement /></KostenZugang>`. `PageHeader`/`section`
bleiben außerhalb (Routenidentität, keine Kostendaten). Statische Imports
bleiben zunächst (D4 Stufe 1) — T7 misst.

**Step 5 — Client-Seam:** `session-provider.tsx`: Prop
`initialeOrganisationId?: string | null` als `useState`-Startwert für
`gewaehlteOrgId`; Effekt-Guard:
```ts
useEffect(() => {
  if (sitzung.zustand === "laedt" || sitzung.zustand === "fehler") return;
  onOrganisationChange?.(organisation?.id ?? null);
}, [sitzung.zustand, organisation, onOrganisationChange]);
```
`providers.tsx`: `useRouter()`; im `setOrganisation`-Callback zusätzlich:
```ts
if (liesOrgAuswahlAusDokument() !== id) {
  schreibeOrgAuswahl(id);
  router.refresh();
}
```
und `initialeOrganisationId={liesOrgAuswahlAusDokument()}` an den
`SessionProvider` (einmalig via `useState`-Initializer in `Providers`, damit
der Wert über Re-Render stabil ist).

**Step 6 — `session-provider-auswahl.test.tsx`** (Stub-AuthGateway wie in
`planung-page.test.tsx`): (a) während `laedt` wird `onOrganisationChange` NICHT
gerufen; (b) nach Session-Antwort mit einer Org: genau ein Aufruf mit deren Id;
(c) `initialeOrganisationId` einer fremden Id ⇒ Aufruf mit `null` (Mehr-Org)
— die Validierung über `orgs.find` greift; (d) nach `abmelden` Aufruf mit
`null`. Rot → grün im selben Task-Schritt.

**Step 7:** Läufe:
```bash
pnpm --filter @easytree/web exec vitest run test/kosten-freigabe.test.ts test/kosten-page-gate.test.tsx test/session-provider-auswahl.test.tsx test/organisations-auswahl-cookie.test.ts
# Dateizahl = 4 lesen (vitest-Pfadfilter ist Substring — Zahl, nie Exit-Code)
pnpm --filter @easytree/web test   # ganze Paket-Suite, KEIN zweiter vitest parallel
```

**Step 8:** Commit (nur benannte Pfade):
`feat(web): EYT-113 serverseitige costs.read-Ladegrenze an der ausgewaehlten Organisation`.

### T7 — Load-/Bundle-Beweis nach Fix (D4-Messung; L-A/L-B schließen)

**Step 1:** `env -u EASYTREE_API_PROXY_TARGET pnpm build` (exit 0 — beweist
zugleich: kein Build braucht das Proxyziel trotz `headers()`/`cookies()`).
Route-Tabelle nachher festhalten (L-B: `stundensaetze` jetzt `ƒ` dynamic —
bewusst, im PR benennen). Chunk-Menge aus D6 neu ableiten (Hashes ändern sich).

**Step 2:** Journey lokal: die T6-Schritt-2-Zusicherungen müssen jetzt GRÜN
sein. Sind sie es NICHT (Flight/Chunks referenzieren trotz Gate — L-A
widerlegt Stufe 1): **D4 Stufe 2** — statische Kosten-Client-Imports beider
Pages in den gewährten Zweig ziehen:
```tsx
const [{ KostenZugang }, { KostenAnsicht }] = await Promise.all([
  import("../../../components/kosten-zugang"),
  import("../../../components/kosten-ansicht"),
]);
```
(analog `RateManagement`), neu bauen, neu messen. Scheitert auch das ⇒ STOP
mit Messprotokoll.

**Step 3:** Evidenz getrennt nach drei Aussagen: (1) Module existieren im
Artefakt (Chunk-Dateien benennen), (2) autorisierte Reise lädt sie
(Request-Log + Screenshot positiv), (3) nicht autorisierte Reise
liefert/referenziert sie nicht (Request-Log + HTML-Grep + Screenshot
forbidden). Öffentlich abrufbare Chunk-URLs sind KEINE Security Boundary und
werden nicht als Geheimnis geführt — massgeblich ist (3).

### T8 — Mehr-Org-Journey + Session-unknown (REQ-L1b/L1c/L3/L6)

**Files:** Create `apps/web/e2e/auth-journey/eyt113-zweitorg-an.sql`,
`…/eyt113-zweitorg-aus.sql`; Modify `journey.pwtest.ts`,
`apps/web/e2e/shell-smoke.spec.ts`.

**Step 1 — Fixture-Paar** (Muster `eyt136-member-an.sql`: `ON_ERROR_STOP`,
Prämissenwächter VOR der Mutation, Markerzeile, eigene Nachbedingungs-
Transaktion). `-an.sql`: wirft, wenn Benutzer A nicht GENAU eine aktive
Mitgliedschaft hat oder `role_permissions` `('member','costs.read')` enthält;
legt Organisation `00000000-0000-4000-8000-00000000e213`
(`EYT-113 Zweitorganisation`) und Mitgliedschaft
`00000000-0000-4000-8000-0000e213a001` (A als `member`, active) an; Marker
`[eyt113-zweitorg-an]`. `-aus.sql`: löscht Mitgliedschaft + Organisation,
wirft bei Restbeständen; Marker `[eyt113-zweitorg-aus]`. Keine Plandaten —
keine Verbrauchswochen.

**Step 2 — neuer Journey-Test** (nach dem bestehenden EYT-113-Feld-Test, Datei
bleibt seriell; `psqlMitMarker` + `catch`-Muster wie 9g2 für garantierte
Rückgabe):
`test("EYT-113 I2: die Kosten-Ladegrenze folgt der ausgewaehlten Organisation", …)`
- an.sql einspielen; frischer Context; Login als A;
- Kopfleiste zeigt jetzt die Org-Auswahl (zwei Orgs); **Zweitorg wählen**;
- `/kosten`: `kosten-forbidden` sichtbar, Chunk-/Inhalts-Zusicherungen aus D6
  (REQ-L1b — Reiseorg hat `costs.read`, überschreibt aber nichts);
- Direct-URL `page.goto("/kosten/stundensaetze")`: dieselben Zusicherungen
  (REQ-L6);
- API-Negativ: `GET /api/v1/kosten/mitarbeiter` mit Header
  `X-EasyTree-Organization-Id: <zweitorg>` ⇒ 403 (REQ-L5);
- **Reiseorg wählen** ⇒ `/kosten`: Inhalt sichtbar, Kosten-Chunks geladen
  (REQ-L4 Mehr-Org positiv; `router.refresh()`-Weg real belegt);
- Reload derselben Seite: Auswahl überlebt (Cookie-Restore), Inhalt bleibt;
- aus.sql; Nachweis der Rückgabe (A wieder genau eine Mitgliedschaft).

**Step 3 — shell-smoke:** neben dem `/feld`-Muster (Z. 512):
`test("EYT-113 I2: /kosten ohne API zeigt die ehrliche Fehlerflaeche", …)` —
`kosten-sitzung-unbekannt` sichtbar, `kosten-unauthenticated` UND
`kosten-laedt` abwesend (REQ-L3: unbekannt ≠ abgemeldet, und die Client-Fläche
lädt gar nicht erst), keine Requests auf Kosten-Chunks. Bestehende
`/kosten`-Smokes (2xx/axe/Tokens) laufen und werden gelesen — die Fläche
wechselt von Client-Fehler auf Server-Unknown.

**Step 4:** Läufe lokal: Journey-Testzahl + Schrittliste lesen (nie nur Exit-
Code); Screenshots als Artefakte unter `test-results/auth-journey/` bestätigen.

**Step 5:** Commit:
`test(web): EYT-113 Mehr-Org-Ladegrenze und Session-unknown real bewiesen`.

### T9 — Gegenmutationen (ausgeführt, nicht ausgedacht; kohärent)

Je Zusicherung eine Mutation: einspielen → rot messen → zurücknehmen →
Rücknahme mit **eingegrenztem** `git diff` auf die mutierte Datei belegen.
Mindestens:
1. **Gate-Bypass (der Auftrags-COUNTEREXAMPLE):** in `stundensaetze/page.tsx`
   den Freigabe-Aufruf entfernen / `freigabe.art` hart auf `"gewaehrt"` setzen
   ⇒ T8-Direct-URL-Zusicherung UND T10-Architekturregel rot.
2. In `kostenFreigabe` die Fremde-Id-Zeile auf Any-Org-Fallback ändern
   (`?? orgs[0]`) ⇒ `kosten-freigabe.test.ts` rot (Selector-Manipulation
   wirkungslos-Beweis).
3. `"unbekannt"` im Gate wie `"abgemeldet"` behandeln ⇒ Unbekannt-Tests rot.
4. Effekt-Guard im SessionProvider entfernen ⇒
   `session-provider-auswahl.test.tsx` rot (Cookie-Löschung im `laedt`).
Kohärent mutieren (halbe Mutationen messen nur Selbstverteidigung); bei
uncommitteten Dateien Sicherungskopie statt `git checkout`.

### T10 — Architektur-Gegenprobe (zweite, schnelle Schicht)

**Step 1:** Neue Regel in `apps/api/test/architecture/rules.ts` (Import-Graph
via `scan.ts`, KEIN Byte-/Stringvergleich als einziger Schutz): jede
`page.tsx` unter `apps/web/app/(werkbank)/kosten/` muss
`lib/kosten-freigabe` importieren; Scope-Zusicherung „≥ 2 Dateien gesehen"
macht die Regel nicht-vakuös. Rot-Beweis in
`architecture-red-case.test.ts` (synthetischer Baum in `os.tmpdir()`, nie der
echte).

**Step 2 — L-C-Prüfung:** Kanarienlauf gegen den ECHTEN Baum mit eingespielter
Mutation aus T9(1): die Regel muss den Verstoß sehen. Bleibt sie durch eine
bekannte `scan.ts`-Lücke still grün ⇒ STOP mit Evidenz + kleinster
Entscheidungsvorlage (keine Scanner-Generalreparatur). Danach restaurieren,
grün messen.

**Step 3:** Commit:
`test(api): EYT-113 Architekturregel — Kosten-Pages tragen das Server-Gate`.

### T11 — Regression (Auftragsteil REQUIRED VALIDATION)

```bash
pnpm exec turbo run lint --force        # Cached: 0 cached + Taskzahl zitieren
pnpm exec turbo run typecheck --force
pnpm exec turbo run test --force
env -u EASYTREE_API_PROXY_TARGET pnpm build
git ls-files -z | xargs -0 pnpm exec prettier --ignore-unknown --check
```
Playwright: `shell-smoke` (Laufzeit-Proxyziel setzen!), volle auth-journey
lokal (Kostenreise 1–12, 9g2, Feld-Reise, neuer Mehr-Org-Test) — Datei-/
Testzahl lesen. Feld unverändert: Feld-Tests grün + T3-Rename-Diff = genau
eine Importzeile. `apps/web/test/a11y.test.tsx` prüfen (rendert Komponenten,
nicht die Page — erwartbar unberührt; lesen, nicht raten).
Deliverables-Grep: `git diff origin/master... | grep -inE 'offen|TODO|TOOL_GAP|FIXME'`
— ein Treffer ist ein Blocker.

### T12 — Git/PR/CI/Jira + Abschluss

**Step 1:** Vor dem Push: `git rev-parse origin/master` erneut (verschoben ⇒
STOP, Rebase-Entscheidung melden — Ruleset verlangt up-to-date Branch);
`gh pr list --state open` erneut (Auftragsprämissen veralten vor der
Ausführung).

**Step 2:** Push; **genau ein** PR gegen `master`:
`feat(web): EYT-113 costs.read-Ladegrenze an der ausgewaehlten Organisation`.
PR-Body nach Auftragsgliederung EVIDENCE TO RETURN (Base SHA, Branch, exakte
Dateien, roter-Test-Protokolle, Implementierungsentscheidung D2, Org-/
Permission-Matrix, Load-/RSC-/Chunk-Evidenz, Gegenmutationen rot→restore→grün
mit eingegrenzten Diffs, Playwright-Ergebnis, Screenshot-Artefaktpfade,
Commit-SHAs); compose → re-read → send.

**Step 3:** CI: `~/.claude/scripts/gh-ci-wait DYAI2025/EasyTree <head-sha>`;
Endstand direkt per `gh run view` gegenprüfen (Exit-0-kann-Timeout,
Exit-1-kann-Cancelled). Alle **elf** Required Checks auf exakt dem PR-Head
zitieren; db-gates-Gate-ZEILEN lesen (`mode=required … skipped=0`), nicht den
Haken; auth-journey-Job ist der Identitätsbeweis.

**Step 4:** Jira-Kommentar auf EYT-113 (Status bleibt „In Arbeit", kein
Done-Claim): Inkrement-Evidenz, PR-Link; compose → gerendert gegenlesen →
senden; kein Satzzeichen hinter nackten URLs.

**Step 5:** Endmeldung exakt: `READY_FOR_REVIEW — EYT-113 INCREMENT 2`.
Danach **stoppen** — kein Merge, kein Deploy, keine Statusänderung, kein
EYT-80/81/147/148.

---

## STOP-Bedingungen (messbar verankert)

T1 (master-SHA verschoben, konkurrierender PR, WIP ≠ {EYT-113}), T2 (Prämisse
„Grenze fehlt" widerlegt / Messmethode trägt nicht), T7 (D4 Stufe 2 scheitert),
T10 (`scan.ts`-Lücke falsifiziert den Guard), jederzeit (nötig wäre:
DB-Migration, neues Auth-System, großer Routingumbau, neue Backend-Wahrheit —
alles Auftrags-STOPs). In jedem Fall: Evidenz + kleinste nächste Entscheidung
zurückgeben, keine Ersatzarchitektur.

## Risiken und Rollback

- **Chunk-Bündelung:** Kosten-Code in geteiltem Chunk macht die Messung
  mehrdeutig ⇒ D4 Stufe 2 erzeugt trennscharfe Chunks; erneut messen.
- **Route wird dynamisch** (`stundensaetze`): bewusst; Route-Tabelle
  vorher/nachher im PR; Build ohne Proxyziel bleibt grün (T7 Step 1 beweist es).
- **Testid-Umzug Client→Server** (`kosten-forbidden`, `kosten-unauthenticated`):
  vor Änderung repo-weit greppen; 9g2 erweitert seine Zusicherungen, statt
  still grün zu bleiben.
- **Cookie-Semantik:** Auswahl überlebt Reload (neu, dokumentiert); fremdes/
  veraltetes Cookie heilt sich über den Schreib-Seam selbst; `eyt_org` reist im
  Cookie-Header zur API mit und wird dort ignoriert (API liest nur benannte
  Cookies).
- **E2E-Umgebung:** Playwright-Binaries im frischen Worktree, Port-Belegung,
  parallele vitest-Läufe, Turbo-Replays — je eine Zeile Evidenz.
- **Rollback:** reine Web-Schicht, keine Migration, kein Vertrag, keine neuen
  Endpunkte — `git revert` der PR-Commits stellt den Vorzustand vollständig
  her; Feld bleibt durch den D3-Ein-Zeilen-Beweis unberührt.
