# Runbook — Staging-Deploy, Testdaten, Diagnose und Rollback (EYT-142)

> **Vorbedingung, die heute NICHT erfüllt ist.** Dieses Runbook beschreibt einen Weg, der derzeit
> **nicht begangen werden darf**. Solange `BLOCKER_ENVIRONMENT_SEPARATION` gilt, ist jeder Schritt
> unterhalb von §1 gesperrt — auch ein Healthcheck, auch „nur einmal zum Schauen".
> Siehe [`docs/plans/2026-08-20-sprint-6-staging-blocker.md`](../plans/2026-08-20-sprint-6-staging-blocker.md).

Das Runbook entsteht **vor** dem ersten Deploy mit Absicht: es macht die Owner-Entscheidung
billiger, weil danach nichts mehr erfunden werden muss. Alles hier Beschriebene ist aus
Artefakten abgeleitet, die im Repository stehen und in Phase A gemessen wurden. Was **nicht**
gemessen ist, ist als solches markiert — dieses Dokument behauptet keinen Vollzug.

---

## 1. Das Gate, das zuerst fallen muss

Ein Deploy ist erst zulässig, wenn **alle drei** Bedingungen des Gate A→B erfüllt sind:

1. **A1–A9 grün.** Erfüllt mit PR #80 auf `master`.
2. **Eine eindeutig als NON-PRODUCTION identifizierte EasyTree-Datengrenze existiert und ist
   nachgewiesen.** **Heute nicht erfüllt.** Prüfbar mit genau einer Frage:

   ```
   Ist der project_ref des Ziels von inypnrvpawvhgiyagxbd verschieden?
   ```

   Nein → abbrechen. Die Messung ist eine Control-Plane-Beobachtung (`list_branches` bzw.
   `list_projects`), **nicht** eine Abfrage aus der Anwendung und nicht über `easytree_app`.

3. **Owner-Freigabe für Phase B liegt vor.** Ohne (2) gegenstandslos.

**Fail-closed:** Wer (2) nicht positiv belegen kann, hat sie nicht. „Vermutlich Staging" ist kein
Nachweis; die Konsequenz eines Irrtums ist ein Schreibzugriff auf die Produktionsdatenbank.

---

## 2. Was deployt wird

Zwei Worker aus **derselben** geprüften Codebasis, beide mit im Repository liegender Konfiguration:

| Worker         | Config                    | Entry                  | Build                                    |
| -------------- | ------------------------- | ---------------------- | ---------------------------------------- |
| `easytree-api` | `apps/api/wrangler.jsonc` | `cloudflare/entry.mjs` | `pnpm --filter @easytree/api... build`   |
| `easytree-web` | `apps/web/wrangler.jsonc` | `.open-next/worker.js` | OpenNext, Assets aus `.open-next/assets` |

`compatibility_date` ist auf beiden `2025-09-01`; die API braucht zusätzlich
`enable_nodejs_http_server_modules`. Beides ist bewusst gesetzt und **nicht** beliebig
herunterzudrehen — die Nest-Naht hängt daran (A2/A3).

**Railway bleibt kompatibel.** Nichts an diesem Weg entfernt oder bricht den bestehenden
Railway-Pfad; die API startet weiterhin über `dist/main.js`. Reisst ein Cloudflare-Gate, wird
Railway neu bewertet — es werden **keine** Schutzmechanismen gelockert, um Cloudflare zu erzwingen.

---

## 3. Secrets und Konfiguration

Der kanonische Variablensatz ist **sieben** Einträge (`packages/config/src/schema.ts`,
`ENV_VAR_META`). Die Trennung ist nicht kosmetisch:

**Nicht geheim — stehen in `wrangler.jsonc` unter `vars`:**
`NODE_ENV`, `API_PORT`, `LOG_LEVEL`

**Geheim — werden als Worker-Secret gesetzt, NIE in eine Datei im Repository:**
`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_SSL_ROOT_CERT`

`DATABASE_SSL_ROOT_CERT` ist in `production` **Pflicht**, nicht optional. In `.env.example` steht
es deshalb auskommentiert — ein Platzhalterwert dort wäre schlimmer als keiner, weil er
funktionierend aussähe.

Drei Regeln, die aus gemessenen Fehlern stammen und nicht verhandelbar sind:

- **Keine SSL-Parameter in `DATABASE_URL`.** Die Verbindung wird ausschliesslich in
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

Migrationen zuerst, Anwendung danach. **Der Cloudflare-Deploy ist niemals eine zweite
Migration-Authority** — Eigentümerin des Schemapfads bleibt die Supabase-GitHub-Integration.
Ein Wächter erzwingt das: `apps/api/test/deploy-authority.test.ts` geht rot, sobald ein
`build.command` in einer `wrangler.jsonc` ein Schemawerkzeug aufruft.

1. **Schema.** Migrationen aus `supabase/migrations/` auf das Staging-Ziel anwenden — in
   Dateireihenfolge, vollständig, fail-closed. Kein Dashboard, kein Studio, keine Handänderung.
2. **Verifikation vor der Anwendung.** Anzahl angewandter Migrationen gegen
   `ls -1 supabase/migrations/*.sql | wc -l` prüfen. Abweichung → abbrechen.
3. **Secrets setzen** (§3), danach `wrangler deploy` je Worker.
4. **Smokes fahren** (§6), **bevor** irgendjemand die Oberfläche öffnet.

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

| Symptom                         | Erste Frage                                           | Werkzeug                                                                  |
| ------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| Worker startet nicht            | Fehlt ein Secret?                                     | Worker-Logs; `ConfigValidationError` **nennt die Variable, nie den Wert** |
| `/ready` = 503                  | Ist die DB erreichbar?                                | `GET /ready` liefert den Indikator, der unten ist                         |
| Boot bricht mit Rollenfehler ab | Verbindet `DATABASE_URL` als `easytree_app`?          | EYT-45-Startgate; das ist korrektes Verhalten, kein Defekt                |
| `self-signed certificate`       | Ist `DATABASE_SSL_ROOT_CERT` gesetzt und vollständig? | §3; **nicht** mit No-Verify „lösen"                                       |
| Leere Woche statt Fehler        | Antwortet die API oder der Proxy?                     | `EASYTREE_API_PROXY_TARGET` des Web-Workers                               |
| Publish schlägt fehl            | Läuft die Verbindung über den Transaction-Pooler?     | Erwartet: der Laufzeitkanal-Riegel greift — siehe unten                   |

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
bash scripts/smoke-worker.sh                      # Worker oeffnet KEINEN Port, faehrt saM sauber herunter
bash scripts/smoke-api-role-gate.sh               # API startet NICHT, wenn die Rolle nicht RLS-gebunden ist
```

Ein fehlgeschlagener Pflicht-Smoke **verhindert die Abnahme**. Er wird nicht wiederholt, bis er
grün ist — er wird verstanden.

---

## 7. Rollback

### 7.1 Anwendung

Cloudflare hält frühere Worker-Versionen vor; ein Rollback ist die Rückkehr zur zuletzt grünen
Version, **nicht** ein Rebuild aus einem älteren Commit. Voraussetzung ist, dass die
Vorgängerversion bekannt ist — deshalb §8: jeder Deploy wird mit Commit-SHA und Versions-ID
notiert, sonst gibt es kein Ziel zum Zurückkehren.

Fällt Cloudflare als Plattform aus, ist **Railway der dokumentierte Fallback**: die API läuft dort
unverändert über `dist/main.js`. Das ist der Grund, warum die Railway-Kompatibilität in diesem
Sprint ausdrücklich nicht angetastet wurde.

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
2. **Worker-Versions-IDs** beider Worker — das Rollbackziel.
3. **Migrationsstand** des Ziels (Anzahl und letzte Version) **vor** und **nach** dem Deploy.
4. **`project_ref` des Ziels**, ausgeschrieben — der Beleg, dass §1 (2) eingehalten wurde.
5. **Smoke-Ergebnisse** aus §6.

---

## 9. Stand dieses Dokuments

Geschrieben am 20.08.2026 gegen `master` `b2d8dbf`. Abgeleitet aus: den beiden `wrangler.jsonc`,
`packages/config/src/schema.ts`, `pg-connection.ts`, den Smoke-Skripten, dem EYT-142-Plan und den
Phase-A-Messungen aus PR #80.

**Noch nie ausgeführt.** Kein Abschnitt unterhalb von §1 ist gegen eine reale Staging-Grenze
gelaufen, weil es keine gibt. Beim ersten echten Deploy gehört dieses Runbook gegen die
Wirklichkeit geprüft und dort korrigiert, wo es sich irrt — und die Korrekturen gehören hierher
zurück, nicht in eine Chatnachricht.
