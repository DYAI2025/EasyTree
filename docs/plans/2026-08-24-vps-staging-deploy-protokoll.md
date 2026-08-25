# Deploy-Protokoll — VPS-Staging srv1308064.hstgr.cloud (24.08.2026)

Nach Runbook [`docs/runbooks/staging-deploy.md`](../runbooks/staging-deploy.md) §8. Erster
tatsächlich ausgeführter Deploy; das Runbook war bis heute „noch nie ausgeführt".

## §1-Gate — Belege

1. **CI grün am exakten Head:** Run `32542186429`, Head `3b4bbdb5ee88260000be404c86c9dac40e92b591`
   (= deployter Stand), alle **elf** Jobs `success` (format, lint, typecheck, unit-tests,
   build-web, web-smoke, build-api, secret-scan, db-gates, read-through, auth-journey).
2. **Nicht-Produktions-Datengrenze:** VPS-lokaler Supabase-CLI-Stack (v2.115.0) auf
   srv1308064.hstgr.cloud. Kein Supabase-Cloud-Projekt beteiligt; die Gate-Frage „ist der
   project_ref des Ziels von `inypnrvpawvhgiyagxbd` verschieden?" ist trivial erfüllt — das Ziel
   hat **keinen** Cloud-project_ref. Produktionsdaten wurden zu keinem Zeitpunkt berührt.
3. **Owner-Freigabe:** Auftrag des Owners vom 24.08.2026 („bitte über den VPS deployen und
   hosten"), nachdem Railway als Host ausgeschlossen wurde.

## Deployter Stand

- **Commit-SHA:** `3b4bbdb5ee88260000be404c86c9dac40e92b591`
  (Branch `feat/eyt-126-container-staging`, 14 vor `origin/master`, 0 dahinter)
- **Transportweg:** git bundle (kein Credential auf dem VPS nötig), Klon `/opt/easytree-staging`,
  `git rev-parse HEAD` auf dem VPS verifiziert identisch.
- **Image-Tags:** `easytree-api:<sha>`, `easytree-web:<sha>`, gebaut AUF dem VPS (x86_64 —
  Mac-arm64-Builds liefen dort nicht) mit `--build-arg GIT_SHA=<sha>`.
- **OCI-Revision:** beide Images tragen `org.opencontainers.image.revision =
3b4bbdb5ee88260000be404c86c9dac40e92b591` (per `docker inspect` verifiziert).

## Datengrenze / Migrationen

- Stack: `supabase start -x studio,imgproxy,inbucket,realtime,storage-api,edge-runtime,logflare,vector,supavisor`
- `supabase db reset`: **18 von 18** Migrationen angewandt
  (`supabase_migrations.schema_migrations` count = 18 = `ls supabase/migrations/*.sql | wc -l`),
  `seed.sql` (synthetische Daten, feste UUIDs) eingespielt — auf Staging zulässig.
- `easytree_app`-Passwort per `alter role` gesetzt (Zufallswert,
  `/opt/easytree-staging/.staging-app-pw`, chmod 600 — nicht im Repo, nicht im Image).

## Abweichungen vom Runbook (bewusst, dokumentiert)

1. **`NODE_ENV=development` statt `production` für die API.** Der lokale Supabase-Postgres
   spricht kein TLS; das production-Preset erfordert `DATABASE_SSL_ROOT_CERT` zwingend und
   `pg-connection.ts` erzwingt damit `rejectUnauthorized: true` — gegen einen TLS-losen Server
   scheitert jede Verbindung. Kein No-Verify, kein Schema-Umbau: das development-Preset nimmt
   explizite Werte an und lässt das Zertifikat optional. Folge: Staging misst NICHT das
   production-Config-Profil (das misst weiter der Container-Smoke in CI, negativ).
2. **`docker run` statt `docker-compose.yml`.** Die Compose-Datei erzwingt
   `DATABASE_SSL_ROOT_CERT` mit `:?` unabhängig vom NODE_ENV — für diese Topologie (1) nicht
   erfüllbar. Topologie-Invarianten von Hand eingehalten: nur `web` veröffentlicht einen Port,
   API/Worker nur im internen Netz, kein Schemawerkzeug in Build/Start.
3. **Coolify (läuft auf dem VPS) wurde für diesen ersten Deploy nicht benutzt** — direkter
   Docker-Weg, weniger bewegliche Teile. Onboarding in Coolify ist Folgearbeit.

## Netz / Sicherheit

- Supabase-CLI bindet ALLE Dienste auf 0.0.0.0 (Hinweis der CLI selbst). Gegenmaßnahme:
  `iptables -I DOCKER-USER -i eth0 -p tcp -m conntrack --ctorigdstport 54320:54329 -j DROP`
  (+ identisch ip6tables). **`--ctorigdstport`, nicht `--dport`:** die DNAT in PREROUTING
  schreibt den Zielport vor dem FORWARD-Filter um — eine `--dport`-Regel griff nachweislich
  nicht (Ports blieben von außen offen), die conntrack-Regel schließt sie (von extern
  nachgemessen: 54321/54322/54324 zu). Zusätzlich ufw-Regel `54320:54329/tcp DENY` (Position 1)
  für den docker-proxy-/INPUT-Pfad.
- Persistenz: systemd-Oneshot `easytree-staging-firewall.service` (enabled, active) setzt die
  DOCKER-USER-Regel idempotent nach jedem Docker-Start; ufw-Regel ist ohnehin persistent.
  Alle Container (Stack + App) laufen mit `restart: unless-stopped`.
- Öffentlich erreichbar ist ausschließlich `web` auf Port **3009**.

## Nachtrag 25.08.2026 — Topologie geändert wegen GoTrue-Issuer

Der erste Login schlug mit 401 fehl, obwohl GoTrue direkt 200 lieferte: der lokale Stack setzt
`GOTRUE_JWT_ISSUER=http://127.0.0.1:54321/auth/v1` fest (nicht per config.toml überschreibbar),
die API verifizierte gegen `SUPABASE_URL/auth/v1` = interner Kong-Name → Issuer-Mismatch, jeder
Token „ungültig". Fix: **API und Worker laufen jetzt im Host-Netz** mit `API_PORT=3101` und
`SUPABASE_URL=http://127.0.0.1:54321` — damit ist die verifizierte Issuer-URL identisch mit der,
unter der die API GoTrue erreicht. Web bleibt im Bridge-Netz und proxyt auf `http://10.0.2.1:3101`
(Gateway-IP des Supabase-Netzes; `host.docker.internal` zeigte auf die falsche Adresse).
Dafür nötig: `ufw allow from 10.0.2.0/24 to any port 3101 proto tcp` — ufw default-deny blockte
Bridge→Host. Von außen nachgemessen: 3101 **zu**, 3009 weiter offen. App-Login danach 200
(userId + Organisationen + Permissions). Die Tabelle unten beschreibt den Stand VOR dem Nachtrag,
soweit sie Netz/Ports nennt.

## Laufzeitkonfiguration

- API (`easytree-api`): NODE_ENV=development, API_PORT=3001, LOG_LEVEL=info,
  DATABASE_URL → `supabase_db_easytree:5432` als `easytree_app`,
  SUPABASE_URL → `http://supabase_kong_easytree:8000`, SUPABASE_ANON_KEY = Publishable-Key des
  lokalen Stacks. Kein veröffentlichter Port.
- Worker (`easytree-worker`): **dasselbe Image**, Kommando `node dist/worker.js`, kein Port.
- Web (`easytree-web`): `EASYTREE_API_PROXY_TARGET=http://easytree-api:3001` als
  **Laufzeitvariable** (EYT-126), PORT=3000, HOSTNAME=0.0.0.0, veröffentlicht `3009:3000`.
- Netz: alle drei Container im Netz `supabase_network_easytree` (Namensauflösung der
  Dienstnamen).

## Smokes / Ergebnisse (alle ausgeführt 24.08.2026)

- Docker-Healthchecks: `easytree-api` **healthy**, `easytree-web` **healthy**, Worker läuft
  (kein Port — gewollt).
- Durch den Proxy (Host, `127.0.0.1:3009`): `/` → 200, `/health` → 200 `{"status":"ok"}`,
  `/ready` → 200 mit `config: ready` **und** `database: ready` — d. h. die API verbindet
  tatsächlich als `easytree_app` durch das EYT-45-Startgate.
- Leck-Check: Antwortköpfe von `/health` und ausgeliefertes HTML von `/` enthalten **0** Treffer
  für die interne Adresse `easytree-api`.
- Von außen (Mac): `http://srv1308064.hstgr.cloud:3009/` → 200, `/ready` → 200; Browser-Test:
  Startseite zeigt **„✓ API erreichbar"**, `/anmelden` rendert.
- Supabase-Ports von außen nachgemessen **zu** (54321/54322/54324), Port 54323 als
  Negativ-Kontrolle ebenfalls zu (kein Listener).

## Demo-Mandant (Runbook §5 — erste echte Ausführung des Bootstrap-Skripts)

`scripts/ops/bootstrap-demo-tenant.mjs` lief erstmals gegen eine echte Staging-Grenze:
Auth-Identität `demo-owner@easytree-staging.example` via GoTrue-Admin-API
(`auth_user_id c9034e91-6fb9-4813-9922-4ebc0a9e06e1`), danach Bootstrap + `--verify` grün und
idempotent (org „EasyTree Demo", Rolle owner, 1 Mitarbeiter, 0 Stundensatzversionen —
Stundensätze entstehen laut PO-Vorgabe nur über die UI). Passwort liegt ausschließlich in
`/opt/easytree-staging/.demo-owner-pw` (chmod 600).

## Rollback

Rollbackziel = Image-Tag `easytree-api:3b4bbdb…` / `easytree-web:3b4bbdb…` (OCI-Label
`org.opencontainers.image.revision`). Schema: append-only, kein destruktiver Rollback;
Staging-Datengrenze ist per `supabase db reset` vollständig reproduzierbar — Restore-Evidenz im
Sinne von §7.2 ist damit hier trivial (Reset = Wiederherstellung aus Migrationen + Seed).

## Nachtrag 25.08.2026 — Coolify-Deploy der GHCR-Digests, Kernreise, Rollback-Übung

Dieser docker-run-Stand ist seit dem 25.08.2026 der **Vorgänger**: der Head
`164f1a1d4830da58b355925f9e21adb609930168` läuft seither als Coolify-Service
(`easytree`/`staging`, Service `easytree-staging`) aus den exakten GHCR-Digests, die reale
Kernreise wurde mit 14/14 Playwright-Fällen über `https://srv1308064.hstgr.cloud` abgenommen,
und der Rollback auf diesen Stand samt Wiederherstellung des Kandidaten ist ausgeführt.
Vollständige Evidenz inklusive aller IDs, Digests, Screenshots und der bewussten Abweichungen:
[`docs/evidence/2026-08-25-eyt-142-staging/README.md`](../evidence/2026-08-25-eyt-142-staging/README.md).

Zwei Betriebsbefunde desselben Tages, die hierher gehören: (1) am Vormittag war der VPS durch
fremde Last (hermes-agent-`du`-Scans, gestaute Coolify-Scheduler-Prozesse) bei Load ~240
handlungsunfähig; die easytree-API crash-loopte dabei **korrekt fail-closed** am
EYT-45-Rollengate (`Die Datenbankrolle konnte nicht geprueft werden: timeout expired`) und
erholte sich nach der Lastbereinigung ohne Eingriff. (2) Schreibvorgänge im Browser brauchen
einen Secure Context — Staging wird seither über HTTPS (Host-nginx, Let's-Encrypt-Zertifikat
`srv1308064.hstgr.cloud`, `location /` → `127.0.0.1:3009`) bedient; Runbook §3 trägt die
Messung.
