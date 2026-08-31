# EYT-147 Slice 1 — Dispositionswerkbank: Evidenzpaket

> **Stand:** 31.08.2026, Europe/Berlin
> **Basis:** `origin/master` = `f8e96e4ceb4f00ae5f5ac777c6eb47aa8f766d6f` (Merge PR #100)
> **Branch:** `feat/eyt-147-dispositionswerkbank-slice-1`
> **Evidenzstufe dieses Pakets:** lokale Läufe auf dem Entwicklungsrechner (colima).
> Der ausgeführte CI-Lauf am PR-Head ist die höhere Stufe und wird im PR nachgetragen.

## Was der Slice liefert

`Planung öffnen → aktuelle Woche sofort verstehen → Einsatz räumlich in der Woche sehen →
Einsatz über den Inspector anlegen → bestätigten Serverzustand sehen → Entwurf eindeutig
erkennen → veröffentlichen → veröffentlichten Zustand erkennen → Reload zeigt denselben
serverseitigen Zustand.`

`Edit` existiert im Serververtrag nicht und wurde **nicht erfunden** — siehe
[`ui-parity-matrix.md`](ui-parity-matrix.md) (CAPABILITY_GAP).

## Lokale Läufe (Befehle und gemessene Ergebnisse)

| Gate                                         | Befehl                                                                                                                                         | Ergebnis                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Format                                       | `git ls-files -z \| xargs -0 pnpm exec prettier --ignore-unknown --check`                                                                      | exit 0                                                                        |
| Lint + Typen                                 | `pnpm exec turbo run lint typecheck --force`                                                                                                   | `16 successful, 16 total`, `Cached: 0`                                        |
| Unit-Tests                                   | `EASYTREE_TEST_DB_URL=<unerreichbar> … pnpm exec turbo run test --force --env-mode=loose`                                                      | `10 successful, 10 total`, `Cached: 0` — Web: 40 Dateien / 474 Tests          |
| Build                                        | `env -u EASYTREE_API_PROXY_TARGET pnpm exec turbo run build --force`                                                                           | `6 successful`, `Cached: 0`                                                   |
| web-smoke (Playwright)                       | `EASYTREE_API_PROXY_TARGET=http://127.0.0.1:3001 pnpm exec playwright test`                                                                    | **29 passed** (shell-smoke 25 + planungswerkbank 4)                           |
| read-through (lokal emuliert)                | Phasen aus `scripts/read-through-harness.sh`; Abweichung: `supabase start -x studio -x vector -x logflare` (vector startet unter colima nicht) | Phase 13: **7 passed** · Schreibpfad: **6 passed** · Nachweis 7: **1 passed** |
| auth-journey (lokal, echte GoTrue-Identität) | `pnpm exec playwright test -c e2e/auth-journey/config.ts` nach `supabase db reset`                                                             | **5 passed**, Teardown `restzeilen=0`                                         |

Anmerkung Unit-Gate: auf diesem Rechner lauscht der colima-Portforward auf 54322 mit
einem fremden Datenbestand; die Integrationssuiten liefen deshalb mit ausdrücklich
unerreichbarer `EASYTREE_TEST_DB_URL` im dokumentierten `mode=local`-Skip (CI-Parität:
der Pflichtjob `unit-tests` hat ebenfalls keine erreichbare DB; `db-gates` fährt die
Suiten `mode=required` gegen den echten Stack).

## Gegenmutationen (ausgeführt, gemessen, zurückgenommen)

| #   | Mutation                                                                                                    | Erwartet rot                                                                                             | Gemessen              |
| --- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | `lib/wochenraster.ts`: Tageszuordnung über das UTC-Datum (`startUtc.slice(0,10)`) statt `localBusinessDate` | „ordnet einen Einsatz dem Kalendertag seines Beginns in der Organisationszone zu"                        | 1 failed / 12 passed  |
| 2   | `lib/wochenraster.ts`: `ausserhalb`-Zweig zu `continue` (Einsatz verschluckt)                               | „verschluckt keinen Einsatz ausserhalb der Woche"                                                        | 1 failed / 12 passed  |
| 3   | `lib/wochenraster.ts`: Tagessortierung nur über die Id                                                      | „sortiert einen Tag nach Beginn — gegen die Id-Reihenfolge"                                              | 1 failed / 12 passed  |
| 4   | `planning-window-view.tsx`: Inspector `useState(true)` (anfangs offen)                                      | „ist anfangs geschlossen …"                                                                              | 4 failed / 6 passed   |
| 5   | `planning-window-view.tsx`: Ausloeser unbedingt als `PrimaryAction`                                         | CTA-Exklusivität in `dispositionswerkbank.test.tsx` UND `planungs-werkbank.test.tsx` („GENAU EIN … CTA") | 2 failed (je Datei 1) |

Jede Mutation wurde per Sicherungskopie eingespielt und byte-identisch zurückgenommen
(`diff` leer; die Dateien waren zum Zeitpunkt der Mutationen uncommittet, ein
`git diff`-Beleg existiert deshalb nicht — Sicherungskopie-Verfahren nach
Projektgedächtnis `git-checkout-reverts-to-commit-not-worktree`).

## Browser-Evidenz (aus der real ausgeführten auth-journey, lokaler Lauf)

Alle PNGs stammen aus `apps/web/test-results/auth-journey/` des grünen Laufs — keine
Mockups, keine statischen Designbilder.

| Datei                                             | Zeigt                                                                                                                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `11-werkbank-planung-1440.png` / `…-1920.png`     | Dispositionswerkbank bei 1440/1920: Toolbar, Wochenachse Mo–So, Einsatzkarte am Montag, Entwurfszustand, genau ein primärer CTA                                                              |
| `04-planung-entwurf.png`                          | Entwurfszustand (Badge + Text + gestrichelte Karten)                                                                                                                                         |
| `12-werkbank-inspector-1440.png`                  | Erstellungs-Inspector offen, Fokus im ersten Formularfeld, versionslose Woche ehrlich als „Keine Version"                                                                                    |
| `13-werkbank-einsatz-serverbestaetigt.png`        | Serverbestätigte Karte am Dienstag 18.08. nach realem `POST /planung/einsaetze` (201), Formular geleert, Erfolgsmeldung                                                                      |
| `05-planung-veroeffentlicht.png`                  | Serverantwort der Veröffentlichung (Banner mit Versions-Id); der Kopf zeigt noch den Moment VOR dem Read-through — die Reload-Zusicherung direkt danach misst `data-stand="veroeffentlicht"` |
| `06-planung-zweiter-kontext.png`                  | Zweiter Browserkontext, dieselbe veröffentlichte Versions-Id                                                                                                                                 |
| `04-feld-shell-320.png` / `05-feld-shell-375.png` | Feld-Shell-Grenze unverändert                                                                                                                                                                |

Barrierefreiheit im Lauf: axe (wcag2a/2aa/21a/21aa/best-practice) bei 1440×900,
1920×1080 und 720×450 (200-%-Äquivalent) = 0 Verstöße; sichtbarer Fokus je tabbarem
Element bei 1440 und 1920; genau eine `main`-Landmark; ≤ 1 primärer CTA; horizontaler
Überlauf ≤ 1 px. Der automatisierte 720-px-Reflow ist NICHT identisch mit echtem
Browserzoom; der menschliche 200-%-Check bleibt Reviewpunkt des PO.

## Serverwahrheit im Lauf

- UI-Create (neu, Schritt 9c1b): `POST /api/v1/planung/einsaetze` → 201, Karte erst nach
  Read-through, Reload zeigt dieselbe Server-Id, Woche W34 wird `entwurf`.
- Publish (Schritt 9d): veröffentlichte Versions-Id == vorher angezeigte Entwurfs-Id
  (`…e251`), Reload → `data-stand="veroeffentlicht"`, Publish-Knopf weg, zweiter
  Browserkontext mit frischem Login sieht dieselbe Id, API-Wiederholung → 409
  `already-published`.
- Negativ: B ohne Mitgliedschaft → `planung-org-erforderlich` + Publish-POST 403;
  member ohne `planning.read` → `planung-forbidden` + `GET /planung/fenster` 403;
  ohne `costs.read` keine Kosten-Chunks; PostgREST-Angriffe unverändert abgeriegelt.
