# Runbook — Staging-Deploy, Testdaten, Diagnose und Rollback (EYT-142, EYT-126)

> **Vorbedingung, die heute NICHT erfüllt ist.** Dieses Runbook beschreibt einen Weg, der derzeit
> **nicht begangen werden darf**. Solange `BLOCKER_ENVIRONMENT_SEPARATION` gilt, ist jeder Schritt
> unterhalb von §1 gesperrt — auch ein Healthcheck, auch „nur einmal zum Schauen".
> Siehe [`docs/plans/2026-08-20-sprint-6-staging-blocker.md`](../plans/2026-08-20-sprint-6-staging-blocker.md).

> **Zielplattform geändert am 21.08.2026.** Kanonisch ist seither Confluence
> **„EasyTree – Deployment-Entscheidung 21.08.2026: VPS + Coolify + Docker"** (Seite 30998530):
> primär eigener VPS mit Coolify und Docker/OCI, sekundär Railway, **Cloudflare Workers ist kein
> Zielruntime mehr**. Die Cloudflare-Artefakte im Repository bleiben vorerst stehen und werden
> erst nach belegter Container-Parität entfernt (EYT-149) — sie sind historische
> Implementierungsevidenz, kein Deploymentweg.

Das Runbook entsteht **vor** dem ersten Deploy mit Absicht: es macht die Owner-Entscheidung
billiger, weil danach nichts mehr erfunden werden muss. Alles hier Beschriebene ist aus
Artefakten abgeleitet, die im Repository stehen. Was **nicht** gemessen ist, ist als solches
markiert — dieses Dokument behauptet keinen Vollzug.

---

## 1. Das Gate, das zuerst fallen muss

Ein Deploy ist erst zulässig, wenn **alle drei** Bedingungen erfüllt sind:

1. **Die Pflicht-CI ist am exakten Head grün**, einschließlich des Container-Smokes aus §6.
2. **Eine eindeutig als NON-PRODUCTION identifizierte EasyTree-Datengrenze existiert und ist
   nachgewiesen.** **Heute nicht erfüllt.** Prüfbar mit genau einer Frage:

   ```
   Ist der project_ref des Ziels von inypnrvpawvhgiyagxbd verschieden?
   ```

   Nein → abbrechen. Die Messung ist eine Control-Plane-Beobachtung (`list_branches` bzw.
   `list_projects`), **nicht** eine Abfrage aus der Anwendung und nicht über `easytree_app`.

   Nachgemessen am 21.08.2026: `list_projects` zeigt genau ein Projekt („Bazodiac",
   `ykoijifgweoapitabgxx`) und **kein** EasyTree-Projekt; `list_branches` auf
   `inypnrvpawvhgiyagxbd` zeigt genau eine Branch `main` mit
   `project_ref == parent_project_ref == inypnrvpawvhgiyagxbd`. Die einzige Branch **ist** die
   Produktion. Die Bedingung gilt unverändert.

   **Und der kostenlose Weg dorthin ist versperrt.** Ein Versuch, ein zweites Projekt
   `easytree-staging` anzulegen (`get_cost` → 0 $/Monat), wurde mit einem **Quota**-Fehler
   abgelehnt: die Free-Projekt-Quota zählt **pro Nutzer** über alle Organisationen hinweg, in
   denen er Owner oder Admin ist, und `DYAI2025` hat sie mit zwei aktiven Free-Projekten
   ausgeschöpft — eines davon ist die Produktion, das zweite ist über diesen Zugang nicht
   sichtbar. Ein pausiertes Projekt zählt laut Supabase-Doku **nicht** mit; das Pausieren oder
   Löschen von „Bazodiac" hilft deshalb nicht. Die nicht-destruktiven Auswege stehen im
   Blockerbericht, Nachtrag 2.

3. **Owner-Freigabe für den Deploy liegt vor.** Ohne (2) gegenstandslos.

**Fail-closed:** Wer (2) nicht positiv belegen kann, hat sie nicht. „Vermutlich Staging" ist kein
Nachweis; die Konsequenz eines Irrtums ist ein Schreibzugriff auf die Produktionsdatenbank.

---

## 2. Was deployt wird

Zwei OCI-Images aus **derselben** geprüften Codebasis, beide mit im Repository liegender
Buildbeschreibung:

| Workload       | Dockerfile            | Startbefehl               | Port | Veröffentlicht |
| -------------- | --------------------- | ------------------------- | ---- | -------------- |
| `easytree-api` | `apps/api/Dockerfile` | `node dist/main.js`       | 3001 | **nein**       |
| `easytree-web` | `apps/web/Dockerfile` | `node apps/web/server.js` | 3000 | ja             |

Der Hintergrundprozess (Outbox) benutzt **dasselbe API-Image** und überschreibt nur das Kommando
mit `node dist/worker.js`; er öffnet keinen Port. Zwei Images für einen Modulgraphen wären zwei
Stellen, die auseinanderlaufen können.

`docker-compose.yml` im Wurzelverzeichnis beschreibt die Topologie: nur `web` veröffentlicht einen
Port, `api` hängt am internen Netz und ist unter dem Dienstnamen `api` erreichbar. Der Browser
sieht deshalb genau eine Origin und niemals eine interne Adresse.

**Build ist reproduzierbar oder er ist keiner.** Beide Dockerfiles installieren mit
`pnpm install --frozen-lockfile` gegen das eingecheckte `pnpm-lock.yaml` und aktivieren pnpm über
`corepack` aus dem `packageManager`-Feld (`pnpm@10.28.0`). Weicht der Lockfile-Stand ab, bricht
der Build ab, statt aufzulösen.

**Railway bleibt kompatibel.** Dieselben Dockerfiles, dieselben Startbefehle, dieselben
Variablen. Nichts an diesem Weg führt providergebundene Domain- oder Businesslogik ein — Coolify
ist Orchestrator, nicht Teil der Facharchitektur.

---

## 3. Secrets und Konfiguration

Der kanonische Variablensatz ist **sieben** Einträge (`packages/config/src/schema.ts`,
`ENV_VAR_META`). Die Trennung ist nicht kosmetisch:

**Nicht geheim — dürfen in der Compose-/Coolify-Konfiguration stehen:**
`NODE_ENV`, `API_PORT`, `LOG_LEVEL`

**Geheim — werden ausschließlich als Plattform-Secret gesetzt, NIE in eine Datei im Repository
und NIE in ein Image:**
`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_SSL_ROOT_CERT`

`DATABASE_SSL_ROOT_CERT` ist in `production` **Pflicht**, nicht optional. In `.env.example` steht
es deshalb auskommentiert — ein Platzhalterwert dort wäre schlimmer als keiner, weil er
funktionierend aussähe. Der Container-Smoke belegt das negativ: mit `NODE_ENV=production` und
ohne Wurzelzertifikat **verweigert der API-Container den Start und nennt die Variable**.

### Die achte Größe: `EASYTREE_API_PROXY_TARGET` ist BAUZEIT, nicht Laufzeit

`EASYTREE_API_PROXY_TARGET` ist keine Anwendungsvariable — sie steht bewusst nicht in
`ENV_VAR_META` — sondern die Naht zwischen Web und API. **Sie wird beim Bauen des Web-Images
festgeschrieben.**

Das ist gemessen, nicht vermutet (21.08.2026, Next 16.2.11): ein Web-Build mit
`http://buildtime-marker.invalid:9999`, gestartet mit
`EASYTREE_API_PROXY_TARGET=http://127.0.0.1:3999`, antwortete auf `/health` mit HTTP 500 und
protokollierte `Failed to proxy http://buildtime-marker.invalid:9999/health … ENOTFOUND`. `next
start` liest die Weiterleitungen aus dem gebauten `.next/routes-manifest.json` und **nicht**
erneut aus der Umgebung.

Drei Konsequenzen, die vor dem ersten Deploy bekannt sein müssen:

- Das Web-**Image** ist an sein Ziel gebunden, nicht an einen Anbieter. Für Coolify und für
  Railway wird dieselbe Datei mit demselben Startpfad gebaut — nur das Argument unterscheidet
  sich (`--build-arg EASYTREE_API_PROXY_TARGET=…`). „Ein Image für beide Plattformen
  gleichzeitig" wäre eine Behauptung, die die Messung nicht deckt.
- Ein vergessenes Build-Argument **fällt den Build**: `next build` setzt `NODE_ENV=production`,
  und `normalizeProxyTarget` wirft dort ohne expliziten Wert. Kein stilles Zurückfallen auf
  localhost.
- Der Browser sieht die Adresse trotzdem nie. Sie ist ausdrücklich kein `NEXT_PUBLIC_*`; die
  Weiterleitung passiert serverseitig im Web-Container. Der Container-Smoke prüft das ausgeliefert
  HTML dagegen.

Drei Regeln zur Datenbankverbindung, die aus gemessenen Fehlern stammen und nicht verhandelbar
sind:

- **Keine SSL-Parameter in `DATABASE_URL`.** Die Verbindung wird ausschließlich in
  `apps/api/src/platform/database/pg-connection.ts` gebaut; die Factory entfernt die **gesamte**
  Query aus der URL. Grund: `pg` merged den geparsten Connection-String **über** das explizite
  `ssl`-Objekt, womit `?ssl=no-verify` jede Denyliste schlägt. Statische Wächter in
  `apps/api/test/pg-connection.test.ts` gehen rot, wenn jemand daran vorbei baut.
- **Kein `rejectUnauthorized=false`, kein No-Verify, keine privilegierte Rolle, kein BYPASSRLS.**
- **`DATABASE_URL` verbindet als `easytree_app`**, nicht als `postgres`. Das EYT-45-Startgate
  weigert sich zu booten, wenn die Rolle nicht als RLS-gebunden nachweisbar ist — fail-closed und
  gewollt. Gegenprobe: `bash scripts/smoke-api-role-gate.sh`.

---

## 4. Reihenfolge des Deploys

Migrationen zuerst, Anwendung danach. **Weder Coolify noch Railway sind eine zweite
Migration-Authority** — Eigentümerin des Schemapfads bleibt die Supabase-GitHub-Integration.
Zwei Wächter erzwingen das, beide in `apps/api/test/deploy-authority.test.ts`: der erste liest die
`wrangler.jsonc`, der zweite die beiden `Dockerfile` und `docker-compose.yml`. Ruft dort ein
Build- oder Startbefehl ein Schemawerkzeug auf, gehen sie rot.

1. **Schema.** Migrationen aus `supabase/migrations/` auf das Staging-Ziel anwenden — in
   Dateireihenfolge, vollständig, fail-closed. Kein Dashboard, kein Studio, keine Handänderung.
2. **Verifikation vor der Anwendung.** Anzahl angewandter Migrationen gegen
   `ls -1 supabase/migrations/*.sql | wc -l` prüfen. Abweichung → abbrechen.
3. **Images bauen** — an den exakten Commit gebunden:

   ```bash
   SHA="$(git rev-parse HEAD)"
   docker build -f apps/api/Dockerfile --build-arg "GIT_SHA=${SHA}" -t "easytree-api:${SHA}" .
   docker build -f apps/web/Dockerfile --build-arg "GIT_SHA=${SHA}" \
     --build-arg "EASYTREE_API_PROXY_TARGET=http://api:3001" -t "easytree-web:${SHA}" .
   ```

   Beide Images tragen den Commit danach als OCI-Label
   `org.opencontainers.image.revision`. Das ist das Rollbackziel aus §7 und der Beleg aus §8.

4. **Secrets setzen** (§3), danach die Workloads starten.
5. **Smokes fahren** (§6), **bevor** irgendjemand die Oberfläche öffnet.

---

## 5. Testdaten

`supabase/seed.sql` ist **synthetische Entwicklungsdatenlage mit festen UUIDs** und ausdrücklich
für Nicht-Produktion gedacht. Auf Staging ist sie zulässig; sie war und bleibt auf Produktion
nicht angewandt.

Für einen bedienbaren Mandanten samt Anmeldung existiert
`scripts/ops/bootstrap-demo-tenant.mjs`. **Nicht gemessen:** dieses Skript ist bislang nicht
gegen eine echte Staging-Grenze gelaufen — es ist als Werkzeug vorhanden, sein Vollzug ist keine
belegte Tatsache.

Niemals: Produktionsdaten kopieren, echte Personendaten einspielen, echte Stundensätze verwenden.

---

## 6. Diagnose — was zuerst gefragt wird

Reihenfolge ist nicht beliebig; sie geht vom Billigsten zum Teuersten.

| Symptom                         | Erste Frage                                           | Werkzeug                                                                    |
| ------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Container startet nicht         | Fehlt ein Secret?                                     | Containerlogs; `ConfigValidationError` **nennt die Variable, nie den Wert** |
| `/ready` = 503                  | Ist die DB erreichbar?                                | `GET /ready` liefert den Indikator, der unten ist                           |
| Boot bricht mit Rollenfehler ab | Verbindet `DATABASE_URL` als `easytree_app`?          | EYT-45-Startgate; das ist korrektes Verhalten, kein Defekt                  |
| `self-signed certificate`       | Ist `DATABASE_SSL_ROOT_CERT` gesetzt und vollständig? | §3; **nicht** mit No-Verify „lösen"                                         |
| Leere Woche statt Fehler        | Antwortet die API oder der Proxy?                     | `EASYTREE_API_PROXY_TARGET` — Bauzeitwert des Web-Images, §3                |
| Web erreicht die API nicht      | Liegen beide Workloads im selben internen Netz?       | Dienstname muss aus dem Web-Container auflösbar sein                        |
| Publish schlägt fehl            | Läuft die Verbindung über den Transaction-Pooler?     | Erwartet: der Laufzeitkanal-Riegel greift — siehe unten                     |

**Der Pooler-Fall ist wichtig und vorhergesagt, nicht überraschend.** Über den Supavisor-
Transaction-Pooler wird `session_user` zu `postgres.<tenant>`, und `app.is_runtime_channel()`
lehnt dann ab: **Veröffentlichen bricht** (Null-Zeilen-Ausnahme in `planning-write.repository.ts`),
**Snapshot-Erzeugen bricht** (typisierter `WRITE_CHANNEL_REJECTED`), **Lesen funktioniert weiter**.
Wer das sieht, hat ein Verbindungsproblem — keinen Fachfehler. Details:
[`docs/runbooks/planning-publish.md`](planning-publish.md).

**Nicht gemessen:** diese Ableitung stammt aus `session_user` plus den Policies; sie ist **nicht**
gegen eine echte Poolerverbindung verifiziert, weil pgTAP als `postgres` läuft.

### Pflicht-Smokes vor jeder Abnahme

```bash
NODE_ENV=test API_PORT=3001 EXPECT_READY=200 DATABASE_URL=… SUPABASE_URL=… \
  SUPABASE_ANON_KEY=… bash scripts/smoke-api.sh   # bootet dist, /health, /ready, SIGTERM
bash scripts/smoke-worker.sh                      # Worker oeffnet KEINEN Port, faehrt sauber herunter
bash scripts/smoke-api-role-gate.sh               # API startet NICHT, wenn die Rolle nicht RLS-gebunden ist

# Container-Smoke (EYT-126): baut beide Images, startet die Topologie und
# prueft Health/Readiness, den internen Weg Web -> API, die Abwesenheit der
# internen Adresse im HTML, geheimnisfreie Protokolle und das Verweigern des
# Starts im Produktionsprofil ohne Wurzelzertifikat.
EASYTREE_CONTAINER_SMOKE=required GIT_SHA="$(git rev-parse HEAD)" \
  EASYTREE_SMOKE_DATABASE_URL=… EASYTREE_SMOKE_SUPABASE_URL=… EASYTREE_SMOKE_ANON_KEY=… \
  bash scripts/smoke-container.sh
```

Der Container-Smoke läuft in CI am Ende von `db-gates` — dort, wo es eine echte PostgreSQL-Instanz
mit der Rolle `easytree_app` gibt. Er meldet eine greppbare Zeile, und **die** ist die Aussage,
nicht der grüne Haken:

```
[container-smoke] mode=required executed=… passed=… skipped=0
```

Ein fehlgeschlagener Pflicht-Smoke **verhindert die Abnahme**. Er wird nicht wiederholt, bis er
grün ist — er wird verstanden.

---

## 7. Rollback

### 7.1 Anwendung

Ein Rollback ist die Rückkehr zum **zuletzt grünen Image**, nicht ein Rebuild aus einem älteren
Commit. Weil beide Images mit dem Commit getaggt und zusätzlich per OCI-Label
`org.opencontainers.image.revision` gekennzeichnet sind, ist das Ziel maschinell benennbar:

```bash
docker inspect easytree-api:<sha> --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

In Coolify heißt der Weg „vorherige Bereitstellung erneut aktivieren"; ohne notierte Commit-SHA
(§8) gibt es kein Ziel zum Zurückkehren. **Nicht gemessen:** dass Coolifys Rollbackfunktion für
diese Anwendung tut, was sie verspricht, ist bislang nicht ausgeführt worden.

Fällt der VPS als Plattform aus, ist **Railway der dokumentierte Fallback**: dieselben Dockerfiles,
dieselben Startbefehle. Das ist der Grund, warum die Railway-Kompatibilität in diesem Sprint
ausdrücklich nicht angetastet wurde.

### 7.2 Schema — die asymmetrische Hälfte

**Das Datenbankschema wird nicht destruktiv zurückgerollt.** Migrationen sind append-only,
sobald sie gemergt sind. Eine fehlgeschlagene _additive_ Migration wird mit einer **neuen
Vorwärts-Migration** repariert, nie durch Editieren oder Löschen der alten.

Daraus folgt die Regel, die man vor dem Deploy kennen muss, nicht danach:

> **Anwendung und Schema rollen nicht gemeinsam zurück.** Ein App-Rollback auf eine Version, die
> eine neuere Spalte noch nicht kennt, ist unkritisch, solange die Migration additiv war — genau
> deshalb sind additive Migrationen die Auflage. Ein Rollback auf eine Version, die eine
> _entfernte_ Struktur braucht, ist **kein Rollback**, sondern ein Ausfall.

**Nicht gemessen:** es existiert bislang **keine** ausgeführte Restore-Evidenz gegen eine
EasyTree-Staging-Grenze. Solange die fehlt, ist „Rollback belegt" eine Beschreibung des Weges,
**keine** Tatsachenbehauptung. Der erste Deploy schuldet diesen Nachweis nach.

---

## 8. Was jeder Deploy protokolliert

Ohne diese fünf Angaben ist ein Rollback nicht ausführbar und eine Abnahme nicht prüfbar:

1. **Commit-SHA** des deployten Standes und der CI-Lauf, der an genau diesem Head grün war.
2. **Image-Tags und OCI-Revision** beider Images — das Rollbackziel.
3. **Migrationsstand** des Ziels (Anzahl und letzte Version) **vor** und **nach** dem Deploy.
4. **`project_ref` des Ziels**, ausgeschrieben — der Beleg, dass §1 (2) eingehalten wurde.
5. **Smoke-Ergebnisse** aus §6, einschließlich der `[container-smoke]`-Zeile.

---

## 9. Coolify auf dem VPS — was konkret angelegt wird

**Nicht gemessen:** kein Schritt dieses Abschnitts ist ausgeführt worden; §1 sperrt ihn.

- **Ressourcentyp:** „Docker Compose" mit dieser Repository-Quelle und `docker-compose.yml` aus
  dem Wurzelverzeichnis. Coolify baut damit beide Images selbst aus dem gepinnten Lockfile.
- **Branch/Commit:** ausdrücklich der geprüfte Head, nicht „latest". Coolify zeigt den
  deployten Commit an; er muss mit §8 (1) übereinstimmen.
- **Build-Argument:** `EASYTREE_API_PROXY_TARGET` auf den internen Dienstnamen der API
  (`http://api:3001` in der Compose-Topologie). Kein öffentlicher Name, kein `https` nach außen.
- **Secrets:** die vier geheimen Variablen aus §3 als Coolify-Secrets, nicht als Build-Argumente
  — ein Build-Argument landet in der Imagehistorie.
- **Öffentliche Domain:** ausschließlich auf `web` (Port 3000). Die API bekommt **keine**
  öffentliche Domain; sie ist nur im internen Netz erreichbar.
- **Healthcheck:** die Compose-Definition prüft `/ready` (API) bzw. `/` (Web) mit `node -e` und
  globalem `fetch` — die Laufzeit-Images enthalten bewusst weder `curl` noch `wget`.

---

## 10. Railway-Kompatibilität

Railway ist über Dashboard-Variablen gegen den generischen Startpfad konfiguriert; es gibt
**keine** Railway-Datei im Repository, und dieser Slice legt auch keine an. Kompatibel bleibt der
Weg, weil die Images nichts Providerspezifisches enthalten: derselbe `node dist/main.js`,
dasselbe Variablenset, derselbe Health-/Readiness-Vertrag. Der einzige Unterschied ist der Wert
von `EASYTREE_API_PROXY_TARGET` beim Bauen des Web-Images (§3).

**Nicht gemessen:** ein Railway-Deploy aus diesen Dockerfiles ist nicht ausgeführt worden. Belegt
ist die Kompatibilität auf der Ebene „reproduzierbarer Container- und Startpfad", nicht auf der
Ebene „läuft dort".

---

## 11. Stand dieses Dokuments

Überarbeitet am 21.08.2026 auf den Containerpfad (Confluence 30998530), ausgehend von der Fassung
vom 20.08.2026 gegen `master` `b2d8dbf`. Abgeleitet aus: den beiden Dockerfiles,
`docker-compose.yml`, `scripts/smoke-container.sh`, `packages/config/src/schema.ts`,
`pg-connection.ts`, den bestehenden Smoke-Skripten und der Messung zum Bauzeitverhalten von
`EASYTREE_API_PROXY_TARGET`.

**Noch nie ausgeführt.** Kein Abschnitt unterhalb von §1 ist gegen eine reale Staging-Grenze
gelaufen, weil es keine gibt. Beim ersten echten Deploy gehört dieses Runbook gegen die
Wirklichkeit geprüft und dort korrigiert, wo es sich irrt — und die Korrekturen gehören hierher
zurück, nicht in eine Chatnachricht.
