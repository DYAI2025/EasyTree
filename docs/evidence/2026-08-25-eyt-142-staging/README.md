# Staging-Abnahme EYT-142 — reale Admin-Kernreise auf VPS/Coolify (25.08.2026)

Evidenzpaket nach Runbook [`docs/runbooks/staging-deploy.md`](../../runbooks/staging-deploy.md) §8.
Jeder Screenshot in diesem Verzeichnis stammt aus dem unten benannten Playwright-Lauf gegen das
reale Staging; `ids.json` hält die maßgeblichen Server-IDs desselben Laufs.

## §8 (1) — Commit und CI

- **Head:** `164f1a1d4830da58b355925f9e21adb609930168` (= `origin/master`, 25.08.2026)
- **Push-CI:** Run `32741481644`, elf Pflichtjobs, `conclusion=success`, exakt an diesem Head
  (per `gh run view --json headSha,conclusion` read-back-verifiziert).
- **release-images:** Run `32741481579`, `conclusion=success`, exakt an diesem Head.

## §8 (2) — Image-Digests und OCI-Revision (das Rollbackziel)

| Workload | Image (per Digest gezogen, nicht per Tag)                                                               | OCI-Revision (gemessen per `docker inspect`) |
| -------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| api      | `ghcr.io/dyai2025/easytree-api@sha256:dc83793b5ebd379feda94a9a02bf875fa4d45a0b7e4a4c9c15f8004dd196acc9` | `164f1a1d…30168`, User `node`                |
| worker   | dasselbe API-Image, Kommando `node dist/worker.js`                                                      | `164f1a1d…30168`, User `node`                |
| web      | `ghcr.io/dyai2025/easytree-web@sha256:d54ef9bb4b78e1a126b520b3f98a5c30e9cf408b1c4250744d73d98f84350c53` | `164f1a1d…30168`, User `node`                |

Deploy-Weg: **Coolify 4.3.10** (Projekt `easytree`, Umgebung `staging`, Service
`easytree-staging`, uuid `1uqqoqo7iyjpldsefll3c4sk`), Compose zieht per Digest —
`/opt/easytree-staging/coolify-compose.yml` auf dem VPS. Secrets (`DATABASE_URL` als
`easytree_app`, `SUPABASE_ANON_KEY`) liegen ausschließlich als Coolify-Service-Envs.

## §8 (3) — Migrationsstand

`supabase_migrations.schema_migrations` count = **18** vor und nach dem Deploy
= `ls -1 supabase/migrations/*.sql | wc -l` am Head. Kein Migrationsdelta zwischen `3b4bbdb`
(Vorgänger) und `164f1a1` (leerer `git diff` auf `supabase/migrations/`).

## §8 (4) — Datengrenze

Ziel ist der **VPS-lokale Supabase-CLI-Stack** auf srv1308064.hstgr.cloud. Er hat **keinen
Cloud-`project_ref`**; die Gate-Frage „ist der project_ref des Ziels von `inypnrvpawvhgiyagxbd`
verschieden?" ist damit trivial erfüllt. Kein Supabase-Cloud-Projekt beteiligt, Produktionsdaten
zu keinem Zeitpunkt berührt. Owner-Freigabe für diese Grenze: Auftrag vom 24.08.2026 („bitte über
den VPS deployen und hosten"), dokumentiert im Deploy-Protokoll vom 24.08.

## §8 (5) — Smokes am Kandidaten

- `/health` = 200; `/ready` = 200 mit `config: ready` **und** `database: ready` (API verbindet als
  `easytree_app` durch das EYT-45-Startgate) — durch den Proxy (`127.0.0.1:3009`) und von außen.
- Leck-Check über die HTTPS-Origin: **0** leckende Antwortköpfe, **0** interne Adressen im HTML.
- Container-Logs (api, web, je 300 Zeilen nach der Journey): **0** Treffer für
  `password|service_role|eyJ|sb_secret`.
- Der Pflicht-Container-Smoke `[container-smoke] mode=required … skipped=0` lief in CI-Run
  `32741481644` (Job `db-gates`) an genau diesem Head.

## HTTPS — Voraussetzung, die die Journey erst erzwang

Staging-URL der Abnahme: **`https://srv1308064.hstgr.cloud`** (Host-nginx terminiert TLS mit dem
vorhandenen Let's-Encrypt-Zertifikat und proxyt `location /` auf `127.0.0.1:3009`; die
gbrain-Pfade `/mcp`, `/atlas/` usw. desselben vhosts bleiben unberührt — Longest-Prefix-Match).

**Gemessener Grund:** über plain HTTP scheiterte jeder Schreibvorgang im Browser mit
`crypto.randomUUID is not a function` — die Idempotenzschlüssel-Erzeugung verlangt einen Secure
Context. Das ist gewolltes Plattformverhalten, kein Defekt; die Konsequenz „Staging braucht TLS"
gehört zur Betriebswahrheit dieses Increments.

## Die Kernreise — Playwright gegen das reale Staging, 14/14 grün

Lauf: 25.08.2026, `apps/web/e2e-staging/journey.spec.ts` (im Evidenzcommit enthalten),
`14 passed (22.1s)`, Basis-URL `https://srv1308064.hstgr.cloud`. Die Schreibreise fährt
**2026-W37** (veröffentlichte Wochen sind per DB-Trigger unlöschbar — jede Wiederholung braucht
eine frische Woche; `EYT_JOURNEY_WOCHE`/`EYT_JOURNEY_DATUM` parametrisieren das).

| #   | Station                                                                                 | Beleg                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Anmelden (reale GoTrue-Session)                                                         | `01-angemeldet-1440.png`; userId `4a4fc059-…b2b880` aus der Serverantwort                                                                                                                                                     |
| 2   | `/planung` ohne `weekKey` zeigt aktuelle ISO-Woche 2026-W35                             | `02-…-1440/1920.png`; URL nachweislich ohne Parameter                                                                                                                                                                         |
| 3   | Wochennavigation vor/zurück/heute (W34 → W36 → W35)                                     | `03a/03b/03c-…png`                                                                                                                                                                                                            |
| 4   | Einsatz über das Formular, autorisierter Domain-Command                                 | POST 201; Assignment `8b85fa26-f488-47a4-b7e7-d69b6ba05c2a`; `04-…png`                                                                                                                                                        |
| 5   | Reload = Serverstand (Assignment-Id in der `fenster`-Antwort)                           | `05-…png`                                                                                                                                                                                                                     |
| 6   | Publish über den realen Command; nach Reload `data-stand="veroeffentlicht"`, Knopf fort | Planversion **`42e052be-f842-4d54-9ca0-f14479629150`**; `07-…png`                                                                                                                                                             |
| 7   | `/kosten`: Snapshot aus der veröffentlichten Version                                    | POST 201; Snapshot **`8e05f8c3-4f7a-4a43-a466-4bf65388c9b1`**, `totalMinorUnits=17000` (nachgerechnet: 4 h × 4250), 1 Position, Anzeige `170,00`; EYT-141-Reihenfolge (Zahlen vor Herkunft) im realen DOM gemessen; `08-…png` |
| 8   | Zweiter Browserkontext (eigene Cookies, zweiter Login)                                  | dieselbe Planversion-ID und Snapshot-ID; `09-…png`                                                                                                                                                                            |

**SQL-Gegenprobe in PostgreSQL** (das, was der Browser nicht beweisen kann):
Planversion `42e052be…` = `2026-W37`, `veroeffentlicht=t`; Snapshot `8e05f8c3…` →
`total_minor_units=17000`, `rule_version=personnel-plan-cost-v1`, Positionen = 1.

### Negativreisen (fail-closed, serverseitig belegt)

- **Ohne Mitgliedschaft** (userId `b57c9e17-…`): `/planung` → `planung-org-erforderlich`,
  `/kosten` stoppt im Organisationszustand vor jedem Datenabruf; **direkter** Snapshot-Abruf mit
  gefälschtem `X-EasyTree-Organization-Id` → **403**, keine Betragsdaten. `10-…png`
- **member ohne `costs.read`** (userId `a253e0f9-…`): `/planung` → `planung-forbidden`, kein
  Kostenübergang, `/kosten` → `kosten-forbidden`; direkter Snapshot-Abruf → **403**. `11-…png`
- **Satz fehlt** (W38, Mitarbeiter ohne Satzversion): Publish gelingt, Snapshot-Erzeugung wird mit
  **409 `urn:easytree:costs:rate-not-found`** abgelehnt — „Es wurde kein Snapshot gespeichert" —,
  die Fläche zeigt den Fehlerzustand, **nirgends `0,00`**; SQL bestätigt 0 Snapshots für W38.
  `12-…png`
- **Satz mehrdeutig:** auf Schemaebene unmöglich — der Einspielversuch zweier überlappender
  Satzversionen scheitert am Exclusion-Constraint `employee_rate_versions_no_overlap`
  (`conflicting key value violates exclusion constraint`, gemessen 25.08.2026 auf dem
  Staging-Stack). Mehrdeutigkeit ist damit fail-closed by construction; der UI-Zustand „Satz
  mehrdeutig" bleibt Defense-in-Depth und ist in CI (Komponententests) abgedeckt.

### Barrierefreiheit auf Staging

axe (`wcag2a` + `wcag2aa`) bei **1440 px, 1920 px und 720 px (= 1440 bei 200-%-Zoom)** auf
`/planung` (Entwurfszustand) und `/kosten` (mit gespeichertem Snapshot): **0 Violations**, plus
Reflow-Prüfung (kein horizontaler Überlauf). Tastatur: Formularfelder und der Publish-Knopf sind
per Tab erreichbar; `06-fokus-publish-1440.png` zeigt den sichtbaren Fokusring auf der tragenden
Aktion.

## Rollback — ausgeführt, nicht beschrieben (25.08.2026)

- `09:03:06Z` Kandidat via Coolify gestoppt, Vorgängerstand gestartet (Container
  `easytree-{api,worker,web}`, alle drei OCI-Revision
  `3b4bbdb5ee88260000be404c86c9dac40e92b591`).
- `09:03:38Z` Vorgänger verifiziert: `/ready` 200 (`config` + `database`), HTTPS 200.
- `09:04:20Z` Kandidat via Coolify wiederhergestellt: alle drei Container OCI-Revision
  `164f1a1d…30168`, `/ready` 200, HTTPS 200.

Schema: forward-only, kein destruktiver Rollback — zwischen beiden Ständen gibt es ohnehin kein
Migrationsdelta. Der Vorgängerstand stammt aus dem Deploy vom 24.08. (VPS-lokal gebaute Images);
Coolifys eigenes „vorherige Bereitstellung reaktivieren" war dafür nicht benutzbar, weil der
Vorgänger nicht über Coolify deployt worden war — der geübte Weg (Coolify-Stop → `docker start`
des Vorgängers → Coolify-Start) ist als solcher dokumentiert.

## Bewusste Abweichungen (unverändert aus dem Protokoll vom 24.08., plus zwei neue)

1. `NODE_ENV=development` für API/Worker (lokaler Stack spricht kein TLS; production-Preset
   erzwänge `DATABASE_SSL_ROOT_CERT`). Das production-Config-Profil misst weiterhin der
   Container-Smoke in CI, negativ.
2. API/Worker im **Host-Netz** (`SUPABASE_URL=http://127.0.0.1:54321`, GoTrue-Issuer-Fix vom
   25.08.), Web im Supabase-Bridge-Netz, Proxyziel `http://10.0.2.1:3101` als **Laufzeitvariable**.
3. **Neu:** TLS-Terminierung durch den Host-nginx (siehe oben) — nicht durch Coolify.
4. **Neu:** Die Journey-Testdaten (Org `E2E Reiseorganisation`, feste `…e2xx`-UUIDs) bleiben auf
   Staging stehen: veröffentlichte Planversionen und Snapshots sind per DB-Trigger
   (`app.reject_published_row_change`) unveränderlich — ein rückstandsfreier Teardown ist für
   veröffentlichte Stände konstruktiv unmöglich. Synthetische Daten, keine Personendaten.

## Evidenzstufe

Alles oben ist **ausgeführte Messung gegen das reale Staging** (Playwright-Lauf, curl, SQL,
docker inspect), gebunden an Head `164f1a1` und die beiden Digests; CI-Aussagen sind an die
genannten Runs gebunden. Kein Wert in diesem Dokument ist aus einem Plan übernommen.
