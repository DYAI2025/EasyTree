# Runbook — Staging-Deploy, Testdaten, Diagnose und Rollback (EYT-142, EYT-126)

> **Vorbedingung seit dem 24.08.2026 erfüllt.** `BLOCKER_ENVIRONMENT_SEPARATION` ist durch die
> owner-freigegebene, VPS-lokale Datengrenze aufgelöst (§1, Nachtrag) — für ein **cloudseitiges**
> Staging gilt die Sperre unverändert fort
> ([`docs/plans/2026-08-20-sprint-6-staging-blocker.md`](../plans/2026-08-20-sprint-6-staging-blocker.md)).
> Wer gegen ein anderes Ziel als den VPS-Stack deployt, prüft §1 zuerst — auch „nur einmal zum
> Schauen".

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
   nachgewiesen.** **Erfüllt seit dem 24.08.2026** durch die owner-freigegebene **VPS-lokale**
   Datengrenze (Nachtrag unten); **für ein cloudseitiges Staging-Ziel weiterhin NICHT
   erfüllt.** Für ein Cloud-Ziel prüfbar mit genau einer Frage:

   ```
   Ist der project_ref des Ziels von inypnrvpawvhgiyagxbd verschieden?
   ```

   Nein → abbrechen. Die Messung ist eine Control-Plane-Beobachtung (`list_branches` bzw.
   `list_projects`), **nicht** eine Abfrage aus der Anwendung und nicht über `easytree_app`.

   Nachgemessen am 21.08.2026: `list_projects` zeigt genau ein Projekt („Bazodiac",
   `ykoijifgweoapitabgxx`) und **kein** EasyTree-Projekt; `list_branches` auf
   `inypnrvpawvhgiyagxbd` zeigt genau eine Branch `main` mit
   `project_ref == parent_project_ref == inypnrvpawvhgiyagxbd`. Die einzige Branch **ist** die
   Produktion. Für ein **Cloud**-Ziel gilt diese Messung unverändert; die heute erfüllte Grenze
   ist die VPS-lokale aus dem Nachtrag unten.

   **Nachtrag 24./25.08.2026 — die Bedingung ist auf anderem Weg erfüllt.** Auf Owner-Auftrag
   vom 24.08.2026 ist die Datengrenze ein **VPS-lokaler Supabase-CLI-Stack** auf
   srv1308064.hstgr.cloud: er hat keinen Cloud-`project_ref`, die Gate-Frage ist trivial
   erfüllt, Produktionsdaten sind unberührt. Ein zweites Supabase-**Cloud**-Projekt existiert
   weiterhin nicht (Free-Quota-Lage unverändert); für ein cloudseitiges Staging gilt dieser
   Abschnitt fort.

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

### Staging braucht HTTPS — gemessen, nicht vermutet (25.08.2026)

Über plain HTTP scheitert **jeder** Schreibvorgang im Browser still: die
Idempotenzschlüssel-Erzeugung benutzt `crypto.randomUUID()`, und das existiert nur in einem
Secure Context (HTTPS oder localhost). Symptom: Formular gefüllt, Klick ohne Wirkung, kein
Request im Netzwerkprotokoll, `pageerror: crypto.randomUUID is not a function`. Lesen und Login
funktionieren — genau deshalb fällt es erst beim ersten Schreibversuch auf. Konsequenz: eine
Staging-Oberfläche wird ausschließlich über HTTPS abgenommen.

### Die achte Größe: `EASYTREE_API_PROXY_TARGET` ist LAUFZEIT, nicht Bauzeit

`EASYTREE_API_PROXY_TARGET` ist keine Anwendungsvariable — sie steht bewusst nicht in
`ENV_VAR_META` — sondern die Naht zwischen Web und API. **Sie wird beim START des
Web-Containers gesetzt und bei jeder Anfrage neu gelesen.**

Das ist gemessen, nicht vermutet (22.08.2026, Next 16.2.11, EYT-126): der Same-Origin-Proxy
liegt in Route Handlern (`apps/web/app/api/[[...pfad]]`, `app/health`, `app/ready`), nicht mehr
in `next.config.ts`-`rewrites()`. Der Container-Smoke baut **ein** Web-Image, hält seinen Digest
fest und startet **denselben Digest** zweimal gegen verschiedene APIs:

```
ziel=http://easytree-stub-a:3001 -> {"stub":"easytree-stub-a","pfad":"/health"}
ziel=http://easytree-stub-b:3001 -> {"stub":"easytree-stub-b","pfad":"/health"}
vorher=sha256:191a1af9…  nachher=sha256:191a1af9…
```

**Eine frühere Fassung dieses Abschnitts sagte das Gegenteil, und sie war für ihren Stand
korrekt:** ein Web-Build mit `http://buildtime-marker.invalid:9999`, mit einem anderen Wert
gestartet, antwortete auf `/health` mit HTTP 500 und `… ENOTFOUND`. Das galt dem
`rewrites()`-Weg, den es nicht mehr gibt.

Drei Konsequenzen, die vor dem ersten Deploy bekannt sein müssen:

- Das Web-**Image** ist weder an ein Ziel noch an einen Anbieter gebunden. Für Coolify und für
  Railway wird dieselbe Datei mit demselben Startpfad gebaut, und es gibt **kein**
  `--build-arg`, das sich unterscheiden könnte. Der Wert gehört in die Laufzeitumgebung des
  Web-Dienstes.
- Eine vergessene Laufzeitvariable **fällt den Serverstart**: `apps/web/instrumentation.ts`
  prüft sie einmal beim Hochfahren, und danach beantwortet Next **jede** Route mit 500 — auch
  `/` und `/anmelden`. Kein stilles Zurückfallen auf localhost. Ehrliche Grenze: der Prozess
  bleibt am Leben und hält den Port, der Compose-Healthcheck auf `/` schlägt fehl und der
  Container gilt als `unhealthy`. **Sag nicht, der Container starte nicht.**
- Der Browser sieht die Adresse nie. Sie ist ausdrücklich kein `NEXT_PUBLIC_*`; die
  Weiterleitung passiert serverseitig im Web-Container. Der Container-Smoke prüft das
  ausgelieferte HTML, **jeden referenzierten Client-Chunk**, die Antwortköpfe und den
  `location`-Kopf dagegen — eine absolute Weiterleitung der API auf sich selbst wird in einen
  relativen Pfad übersetzt (Pfad und Query bleiben erhalten), ein externes Weiterleitungsziel
  bleibt unangetastet. **Jeder übrige Antwortkopf, dessen Wert die interne Adresse nennt, fällt
  ersatzlos weg** — `X-Upstream-Url`, `Link: <…>; rel="self"`, `Content-Location`, ein
  `Set-Cookie` mit interner `Domain`. Nicht umgeschrieben, sondern weggelassen: ein Kopf ohne
  festgelegte Bedeutung trägt keine Struktur, aus der sich eine Übersetzung ableiten ließe.
  Fremde Adressen bleiben stehen, und mehrere `Set-Cookie` bleiben mehrere. **Getroffen wird
  die Adresse, nicht das Wort:** Kopfnamen werden nicht geprüft, URLs im Wert über ihre Origin
  verglichen, `host:port` nur an einer Zeichengrenze und nur bei ausgewiesenem Port, der nackte
  Hostname nur als ganzer Wert. Sonst verschluckte der Riegel bei der Topologie
  `http://api:3001` jedes `X-Api-Version`, jede Doku-URL auf `api.example.org` und jedes Cookie
  `api_session`. Der Smoke belegt **beide** Richtungen mit einem Stub, der sowohl den leckenden
  als auch die harmlosen Köpfe nachweislich sendet — sonst wäre weder die Abwesenheit der einen
  noch die Anwesenheit der anderen ein Nachweis.

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
   docker build -f apps/web/Dockerfile --build-arg "GIT_SHA=${SHA}" -t "easytree-web:${SHA}" .
   ```

   `GIT_SHA` hat in **beiden** Dockerfiles keinen Vorgabewert mehr und wird geprüft: ohne
   `--build-arg` bricht der Bau mit `GIT_SHA fehlt. Baue mit --build-arg GIT_SHA=$(git rev-parse
HEAD).` ab (gemessen 22.08.2026 für beide Images). Ein Image mit `revision=unknown` ist über
   diesen Pfad nicht mehr erzeugbar.

   Das Proxyziel wird hier **nicht** übergeben — es ist Laufzeitkonfiguration und steht beim
   Start:

   ```bash
   docker run -d --name web -e EASYTREE_API_PROXY_TARGET=http://api:3001 "easytree-web:${SHA}"
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

### 5.1 Demo-Mandant

Für einen bedienbaren Mandanten samt Anmeldung existiert
`scripts/ops/bootstrap-demo-tenant.mjs` — **seit dem 26.08.2026 eingecheckt**; die erste
Ausführung am 24.08.2026 gegen die echte Staging-Grenze (Bootstrap plus `--verify` grün und
idempotent, Protokoll vom 24.08., §Demo-Mandant) lief noch mit einer lokalen, nicht
eingecheckten Fassung. Die eingecheckte Fassung rekonstruiert genau dieses Verhalten und
ergänzt zweierlei: die Satzzählung ist auf den Demo-Mandanten eingegrenzt, und ein
Produktionsziel (Produktions-`project_ref` oder Supabase-Cloud-Host) wird **fail-closed
verweigert**. Aufruf: `DATABASE_URL=… node scripts/ops/bootstrap-demo-tenant.mjs
--user-id <uuid> [--verify]` — keine Secrets im Repository, die Verbindung kommt
ausschließlich aus der Umgebung.

### 5.2 Journey-Fixture der Staging-Kernreise (EYT-142)

Die Testdaten der Kernreise (Org `E2E Reiseorganisation` `…e201`, Mitarbeiter
`E2E-Mitarbeiter Reise` `…e211` **mit** Satz und `E2E-Mitarbeiter Ohne Satz` `…e212` **ohne**
jede Satzversion, Baustelle `…e241`) sind **kanonische Repository-Wahrheit**:
`apps/web/e2e/auth-journey/fixtures.sql`. Ein frischer Staging-Aufbau erzeugt und verifiziert
sie so:

1. Beide Reisenden über den öffentlichen GoTrue-Signup anlegen (Anon-Key, kein
   Service-Role-Schlüssel) — genau wie `apps/web/e2e/auth-journey/global-setup.ts`.
2. Die Fixture mit den von GoTrue vergebenen UUIDs einspielen:

   ```bash
   psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 \
     -v benutzer_a=<uuid-a> -v benutzer_b=<uuid-b> \
     -f apps/web/e2e/auth-journey/fixtures.sql
   ```

3. Die Markerzeile lesen — sie **ist** der Verify, nicht der Exit-Code:
   `[auth-journey-fixture] … mitarbeiter=2 satz=1 satz_ohne=0 …`. `satz_ohne=0` ist die
   definierende Eigenschaft der Satz-fehlt-Negativreise; jede Abweichung bricht das Skript
   mit `E2E-Fixture unvollstaendig` ab.

Das Skript ist idempotent (`on conflict do nothing` bzw. für `…e212` `do update`): ein
zweiter Lauf erzeugt nichts Doppeltes, und auf einem Stack mit Altbestand konvergiert er
Anzeigename und Aktiv-Status von `…e212` auf den kanonischen Stand. Die Staging-Harness
benutzt den kanonischen Namen als **Vorgabewert** (`EYT_SATZ_FEHLT_MITARBEITER` ist seit dem
26.08.2026 optional und nur noch die bewusste Übersteuerung für abweichenden Altbestand) und
misst vor jedem Publish per Pre-flight über die echte API, dass der Mitarbeiter existiert,
aktiv ist und **exakt null** Satzversionen hat — fehlt die Fixture oder hat sie einen Satz
erworben, bricht die Reise ab, **bevor** eine frische Woche veröffentlicht und damit
verbraucht ist.

Niemals: Produktionsdaten kopieren, echte Personendaten einspielen, echte Stundensätze verwenden.

---

## 6. Diagnose — was zuerst gefragt wird

Reihenfolge ist nicht beliebig; sie geht vom Billigsten zum Teuersten.

| Symptom                         | Erste Frage                                           | Werkzeug                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Container startet nicht         | Fehlt ein Secret?                                     | Containerlogs; `ConfigValidationError` **nennt die Variable, nie den Wert**                                                                |
| `/ready` = 503                  | Ist die DB erreichbar?                                | `GET /ready` liefert den Indikator, der unten ist                                                                                          |
| Boot bricht mit Rollenfehler ab | Verbindet `DATABASE_URL` als `easytree_app`?          | EYT-45-Startgate; das ist korrektes Verhalten, kein Defekt                                                                                 |
| `self-signed certificate`       | Ist `DATABASE_SSL_ROOT_CERT` gesetzt und vollständig? | §3; **nicht** mit No-Verify „lösen"                                                                                                        |
| Leere Woche statt Fehler        | Antwortet die API oder der Proxy?                     | `EASYTREE_API_PROXY_TARGET` — Laufzeitvariable des Web-Dienstes, §3. Fehlt sie, antwortet auch `/` mit 500 — dann ist es keine leere Woche |
| Web erreicht die API nicht      | Liegen beide Workloads im selben internen Netz?       | Dienstname muss aus dem Web-Container auflösbar sein                                                                                       |
| Publish schlägt fehl            | Läuft die Verbindung über den Transaction-Pooler?     | Erwartet: der Laufzeitkanal-Riegel greift — siehe unten                                                                                    |

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
(§8) gibt es kein Ziel zum Zurückkehren. **Ausgeführt am 25.08.2026** (Evidenz:
`docs/evidence/2026-08-25-eyt-142-staging/README.md`): Kandidat `164f1a1` via Coolify gestoppt,
Vorgänger `3b4bbdb` gestartet und über OCI-Revision plus `/ready`=200 verifiziert (32 s), danach
der Kandidat wiederhergestellt und erneut verifiziert (42 s). Einschränkung, ehrlich benannt:
der Vorgänger stammte aus einem Nicht-Coolify-Deploy, geübt ist deshalb der Weg „Coolify-Stop →
`docker start` des Vorgängers → Coolify-Start" — Coolifys eigene Redeploy-Historie greift erst,
sobald auch der Vorgänger über Coolify deployt wurde.

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

**Gemessen am 24./25.08.2026:** die Staging-Datengrenze ist per `supabase db reset` vollständig
aus Migrationen + Seed reproduzierbar (18/18 Migrationen, ausgeführt 24.08.), und der
App-Rollback samt Wiederherstellung ist ausgeführt (§7.1). Eine zusätzliche Grenze bleibt
bestehen: **veröffentlichte** Planversionen, Zuweisungen und Snapshots sind per DB-Trigger
(`app.reject_published_row_change`) unveränderlich — auch für Superuser. Ein selektiver
Teardown veröffentlichter Stände ist konstruktiv unmöglich; wer eine Woche „zurücksetzen"
will, braucht eine neue Woche oder den vollen Reset.

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

**Ausgeführt am 25.08.2026, mit zwei Abweichungen von der Beschreibung unten:** angelegt wurde
ein Coolify-**Service** (Projekt `easytree`, Umgebung `staging`) aus einer eigenen Compose-Datei
(`/opt/easytree-staging/coolify-compose.yml`), die die **GHCR-Digests zieht statt zu bauen** —
Coolify baut auf diesem Server nichts (2,6 GB freier RAM, siehe Restarbeit-Plan Phase 2). Und die
Topologie folgt dem GoTrue-Issuer-Fix vom 25.08. (API/Worker im Host-Netz), nicht der
Bridge-Topologie der `docker-compose.yml`. Registry-Zugangsdaten waren nicht nötig: die
GHCR-Pakete sind anonym ziehbar. Der Rest dieses Abschnitts beschreibt weiter den Weg für ein
Ziel mit production-Profil.

- **Ressourcentyp:** „Docker Compose" mit dieser Repository-Quelle und `docker-compose.yml` aus
  dem Wurzelverzeichnis. Coolify baut damit beide Images selbst aus dem gepinnten Lockfile.
- **Branch/Commit:** ausdrücklich der geprüfte Head, nicht „latest". Coolify zeigt den
  deployten Commit an; er muss mit §8 (1) übereinstimmen.
- **Laufzeitvariable:** `EASYTREE_API_PROXY_TARGET` auf den internen Dienstnamen der API
  (`http://api:3001` in der Compose-Topologie). Kein öffentlicher Name, kein `https` nach außen.
  Ausdrücklich als **Environment-Variable des Web-Dienstes**, nicht als Build-Argument: das
  Image ist seit EYT-126 zielneutral, und ein Build-Argument würde es wieder binden.
- **Build-Argument:** ausschließlich `GIT_SHA` (der geprüfte Head). `docker-compose.yml`
  erzwingt es mit `${GIT_SHA:?…}` — ohne den Wert scheitert schon `docker compose config`.
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
dasselbe Variablenset, derselbe Health-/Readiness-Vertrag. Seit EYT-126 unterscheidet sich nicht
einmal mehr das Web-Image: der Wert von `EASYTREE_API_PROXY_TARGET` ist eine Laufzeitvariable des
Dienstes (§3), also **dasselbe Image für Coolify und Railway** — belegt über denselben
Image-Digest gegen zwei Ziele im Container-Smoke.

**Nicht gemessen:** ein Railway-Deploy aus diesen Dockerfiles ist nicht ausgeführt worden. Belegt
ist die Kompatibilität auf der Ebene „reproduzierbarer Container- und Startpfad", nicht auf der
Ebene „läuft dort".

---

## 11. Stand dieses Dokuments

Überarbeitet am 22.08.2026 (EYT-126) auf das Laufzeit-Proxyziel, ausgehend von der Fassung vom
21.08.2026 auf den Containerpfad (Confluence 30998530). Abgeleitet aus: den beiden Dockerfiles,
`docker-compose.yml`, `scripts/smoke-container.sh`, `packages/config/src/schema.ts`,
`pg-connection.ts`, den bestehenden Smoke-Skripten und dem lokal ausgeführten Container-Smoke
(`[container-smoke] mode=local executed=27 passed=27 skipped=0`, 22.08.2026), der ein Image
gegen zwei Ziele, das Nicht-Lecken der internen Adresse in gewöhnlichen Antwortköpfen, das
unveränderte Durchreichen harmloser Köpfe mit demselben Wort und beide Fail-closed-Fälle
belegt.

**Ausgeführt am 24.08.2026 (Erstdeploy, `3b4bbdb`, docker-run-Weg) und am 25.08.2026
(Coolify-Deploy der GHCR-Digests von `164f1a1`, reale Kernreise 14/14, Rollback-Übung).**
Protokolle: `docs/plans/2026-08-24-vps-staging-deploy-protokoll.md` und
`docs/evidence/2026-08-25-eyt-142-staging/README.md`. Drei Korrekturen aus der Wirklichkeit
stehen jetzt hier: die VPS-lokale Datengrenze in §1, die HTTPS-Pflicht in §3, der ausgeführte
Rollback in §7. **Weiterhin nicht gemessen:** ein Railway-Deploy (§10) und Coolifys eigene
Redeploy-Historie als Rollbackweg (§7.1, Einschränkung).

**Korrigiert am 26.08.2026:** §1 (2) trug noch die Bewertung „Heute nicht erfüllt" aus dem
Stand vor dem 24.08., während der Nachtrag im selben Abschnitt die erfüllte VPS-lokale Grenze
beschrieb — zwei sich widersprechende Gegenwartsaussagen in einem Abschnitt. Jetzt steht dort
eine: VPS-lokal erfüllt, cloudseitig weiterhin offen (Quota-Lage unverändert, Blockerbericht
Nachtrag 2). Die historischen Messungen vom 21.08. bleiben als solche stehen.
