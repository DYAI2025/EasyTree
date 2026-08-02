# EYT-133 — Härtung des Secret-Wächters nach dem Merge von PR #42

**Datum:** 02.08.2026
**Branch:** `fix/eyt-133-secret-guard-hardening`
**Basis:** `origin/master` = `36384d009373e6eb383a4158b0ad6784825ea477`

Ein Post-Merge-Review hat zwei Lücken bestätigt, die vor dem Merge von PR #42
gemeldet, aber nicht geschlossen wurden. Beide sind auf dem gemessenen
`master`-Stand reproduziert worden, bevor eine Zeile geändert wurde.

Dieses Dokument hält fest, was gemessen wurde — nicht, was beabsichtigt war.

---

## F1 — Der globale Dummy-Rückfall

### Ursache

`ERLAUBTE_DUMMY_WERTE` war eine **globale** Liste. `istErlaubterDummy(wert)`
fragte nur, ob der Wert _irgendwo_ als Platzhalter durchgeht — nie, ob er zu
**dieser** Variablen passt. Ein Geheimnisname mit dem Wert eines
`NODE_ENV`-Presets war damit grün, ebenso ein Passwortname mit einer
Portnummer.

Der Wächter prüfte also die Wertform gegen einen Vorrat harmloser Werte, nicht
gegen die Absicht der Variablen. Genau diese Entkopplung war die Lücke.

### Endgültiges Modell

`ERLAUBTE_KONKRETWERTE` bindet jede zugelassene Wertform an ein
**Variablenmuster**:

| Variable       | zugelassene Werte                                            |
| -------------- | ------------------------------------------------------------ |
| `NODE_ENV`     | `development` \| `test` \| `production`                      |
| `LOG_LEVEL`    | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` |
| `API_PORT`     | Portnummer 1..65535                                          |
| `SUPABASE_URL` | lokale Adresse ohne Zugangsdaten                             |

Die Entscheidungsreihenfolge in `pruefeEnvTemplate` ist bewusst so und nicht
anders:

1. Wertform-Prüfungen,
2. **geheime Namen — ausschließlich leer oder Platzhalterform, dann `return`**,
3. `DATABASE_URL` als Sonderfall (lokal, nur leeres oder erkanntes
   Platzhalterpasswort),
4. alle übrigen Namen brauchen eine namensgebundene Freigabe.

Schritt 2 steht **vor** Schritt 4, damit kein späterer Eintrag einen geheimen
Namen nachträglich freistellen kann.

### Rote Fälle vor dem Fix

Alle sechs waren auf `master` grün und sind jetzt rot:

```
SUPABASE_SECRET_KEY=production
SUPABASE_SERVICE_KEY=http://localhost:54321
POSTGRES_PASSWORD=3001
SUPABASE_ANON_KEY=info
SUPABASE_PUBLISHABLE_API_KEY=test
DATABASEPASSWORD=development
```

Positive Fälle bleiben grün, einschließlich der aktuellen `.env.example`.

---

## F2 — Die dateiweite Ausnahme

### Ursache

`ERLAUBTE_DATEIEN` war eine Menge von **Dateipfaden**. Stand eine Datei darin,
war sie vor **allen** privilegierten Familien freigestellt — auch vor denen,
die mit dem Grund der Ausnahme nichts zu tun hatten.

Gemessen auf `36384d0`: `.github/workflows/ci.yml` ist wegen eines lokalen
Wegwerf-Passworts ausgenommen. Ein **Service-Schlüssel** in derselben Datei
ergab **0 Findings**.

### Endgültiges Modell

Jede privilegierte Familie trägt eine stabile, typisierte ID
(`PRIVILEGIERTE_FAMILIEN_IDS`, elf Stück). Jede Ausnahme in
`PRIVILEGIERTE_ORTE` nennt genau drei Dinge: den exakten Dateipfad, die
erlaubten Familien-IDs und eine belastbare Begründung.

| Datei                                           | erlaubte Familien                            |
| ----------------------------------------------- | -------------------------------------------- |
| `supabase/tests/0002_rls_isolation.sql`         | `service-role-name`, `postgres-service-role` |
| `supabase/config.toml`                          | `secret-key-name`                            |
| `scripts/read-through-harness.sh`               | `database-password-name`                     |
| `.github/workflows/ci.yml`                      | `database-password-name`                     |
| `apps/api/test/auth/token-verifier.test.ts`     | `service-role-name`, `postgres-service-role` |
| `apps/api/test/secret-surface.red-case.test.ts` | 7 Familien (Verstoßfixturen)                 |
| `apps/api/test/env-template.test.ts`            | 5 Familien (Verstoßfixturen)                 |

Keine dieser Ausnahmen stellt einen Service-Key, Secret-Key, JWT, `sb_secret`-
Wert oder Admin-API-Zugriff frei, wo er nicht zum Zweck der Datei gehört.

### Lebendprüfung je Paar

Die frühere Prüfung war dateiweit und heuristisch: sie bestätigte, dass eine
Datei _irgendeinen_ verbotenen Namen enthält. Sie hätte die CI-Datei bestätigt
und dabei stillschweigend mitgetragen, dass diese zusätzlich für Service-Keys
freigestellt ist — also genau F2 gedeckt.

Jetzt wird **je Paar (Datei, Familie)** genau dieses eine Paar aus der Liste
entfernt und gemessen, ob der Wächter daraufhin genau diese Familie in genau
dieser Datei meldet. 19 Paare, 19 einzeln belegte Prüfungen.

Dafür waren zwei kleine Erweiterungen nötig:

- ein Befund trägt seine `familie` (über den Meldungstext wäre die Familie
  nicht unterscheidbar),
- `evaluateSecretRules` nimmt die Ausnahmeliste optional entgegen (`orte`),
  damit die Prüfung eine Variante auswerten kann, ohne die echte Liste zu
  verändern.

---

## Drei Befunde, die dabei auffielen

### 1. `entferneKommentare` kennt keine Regex-Literale

Ein Regex wie `/^["']|["']$/g` enthält Anführungszeichen. Der Stripper zählt
sie als Stringgrenzen und bleibt ab dort in einem Schein-Stringzustand:
**alle folgenden Kommentare werden nicht mehr entfernt.**

Die Richtung ist entscheidend und wurde geprüft: unentfernter Text erzeugt
**zusätzliche** Befunde, nie fehlende. Der Wächter versagt also laut, nicht
offen — kein Sicherheitsloch, aber ein Fehlalarm gegen die eigene Datei, der
Druck erzeugt, die Regel abzuschwächen.

Behandelt: Ursache im Quelltext dokumentiert, der auslösende Bezeichner im
betroffenen Kommentar entschärft. **Keine** Ausnahme für die Datei eingetragen
— das hätte den Fehlalarm versteckt statt erklärt.

### 2. Die alte Lebendprüfung maß das Falsche

Siehe oben. Ersetzt.

### 3. Die roten F2-Fälle waren per Konstruktion rot

`befunde()` im roten Fall sammelte `apps`, `packages` und `supabase` ein —
**nicht** `.github` und `scripts`. Die Fälle 2, 3, 3b und 4 schrieben ihre
Fixtur nach `.github/workflows/ci.yml` und wurden von der Auswertung nie
gelesen.

Sie waren damit rot, weil ihre Fixtur außerhalb des gemessenen Baums lag —
nicht, weil die Lücke offen war. Nach dem Fix wären sie **nicht** grün
geworden und hätten nichts bewiesen. Der Sammler ist erweitert.

Dies ist derselbe Fehlertyp wie die Markerzeile in EYT-134: eine Prüfung, die
in einem Strom sucht, in dem ihr Gegenstand nie landet.

---

## Gegenmutationen

Ausgeführt, das rote Ergebnis gemessen, die Mutation zurückgenommen — in
dieser Reihenfolge:

| Mutation                                                                           | Ergebnis             |
| ---------------------------------------------------------------------------------- | -------------------- |
| F1: globaler Rückfall wieder eingesetzt (`{ variable: /.*/, pruefe: () => true }`) | **6 von 36 rot**     |
| F2: `.github/workflows/ci.yml` auf alle elf Familien freigestellt                  | **15 von 109 rot**   |
| beide zurückgenommen                                                               | **135 von 135 grün** |

Zusätzlich hält **Fall 9** die F2-Gegenmutation dauerhaft in der Suite: unter
einer dateiweiten Ausnahme melden die drei Verstoßfixturen `0` Befunde, unter
dem Familienmodell `> 0`. Eine Gegenmutation, die man zurücknimmt, läuft nie
wieder — diese läuft bei jedem CI-Lauf mit.

---

## Zweite Reviewrunde — zwei fail-open Fälle in `pruefeEnvTemplate`

Ein unabhängiges Review auf Head `5f67e9b` hat zwei weitere Umgehungen derselben Regel
gefunden. Beide wurden im Quelltext belegt, bevor eine Zeile geändert wurde.

### Finding A — ein Konkretwert ohne Freigabe fiel durch

`env-template-rules.ts:282` prüfte den Wert nur, **wenn** der Variablenname bereits eine
Freigabe hatte:

```ts
const freigabe = ERLAUBTE_KONKRETWERTE.find((e) => e.variable.test(variable));
if (freigabe !== undefined && !freigabe.pruefe(wert)) { melde(...); }
// freigabe === undefined  ->  still akzeptiert
```

Geprüft wurde also gerade nicht der Fall, um den es geht: der **unbekannte** Name.
`PRIVATE_KEY=konkreter-wert`, `AWS_ACCESS_KEY_ID=…`, `FOO=bar` — alle grün.

Jetzt ist die fehlende Freigabe selbst der Befund. Der Vertrag lautet: jeder nichtleere
Wert ist entweder ein erlaubter Platzhalter oder ein für **genau diesen** Namen
freigegebener Konkretwert. `DATABASE_URL` bleibt der separat geprüfte Sonderfall.

### Finding B — die Assignment-Grammatik war zu eng

`env-template-rules.ts:220` erkannte ausschließlich `UPPERCASE=wert`:

```ts
const treffer = /^\s*#?\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(zeile);
if (treffer === null) return; // wortlos verschwunden
```

`supabase_secret_key=…` und `export SUPABASE_SECRET_KEY=…` wurden damit **spurlos**
übersprungen — kein Befund, keine Meldung.

Jetzt: optionales `#`, optionales `export`, Bezeichner permissiv geparst, danach
Schreibweise geprüft (nichtkanonisch = Befund). Eine nicht kommentierte Zeile, die weder
Leerzeile noch gültiges Assignment ist, erzeugt einen Parsing-Befund statt zu verschwinden.

**Die Verankerung am Zeilenanfang ist keine Stilfrage.** `.env.example` Z. 18 trägt
`user=postgres` mitten in einem psql-Aufruf innerhalb eines Kommentars. Eine Grammatik, die
den Namen irgendwo in der Zeile sucht, meldet dort sofort einen Fehlalarm. Genau diese Zeile
steht als Gegenprobe in der Suite.

### Zwei Zusicherungen, die erst die Gegenmutation erzwungen hat

Zwei rote Fälle sahen vollständig aus und unterschieden nichts — gefunden, weil die
Gegenmutation ausgeführt und nicht nur benannt wurde:

1. **`supabase_secret_key` beweist die Schreibweisenregel nicht.** Den fängt schon die Regel
   für geheime Namen. Die Gegenmutation „Kanonik entfernen" blieb **grün**. Erst
   `node_env=development` und `Api_Port=3001`, mit Zusicherung auf die _Begründung_
   „nicht kanonisch", machen sie rot.
2. **Die `export`-Fälle bewiesen `export` nicht.** Fällt die Erkennung weg, landen sie im
   Parsing-Befund, und `length > 0` bleibt grün — die Gegenmutation erzeugte nur **einen**
   roten Test. Erst die Zusicherung auf die inhaltliche Begründung („geheimer
   Variablenname" bzw. „keine variablenspezifische Freigabe") macht drei rot.

### Gegenmutationen der zweiten Runde

| Mutation                                                 | Ergebnis           |
| -------------------------------------------------------- | ------------------ |
| unbekannte Variablen wieder still akzeptieren            | **6 von 64 rot**   |
| `export`-Erkennung gebrochen (Gruppenanzahl unverändert) | **3 von 64 rot**   |
| Kanonik-Prüfung deaktiviert                              | **2 von 64 rot**   |
| alle zurückgenommen                                      | **64 von 64 grün** |

### Die Regex-Blindheit ist erneut aufgetreten — als Fehlalarm

Beim Einbau meldete der Secret-Surface-Wächter **einen** Befund gegen
`env-template-rules.ts` selbst: ein neuer Kommentar hinter dem Regex-Literal `/^["']|["']$/g`
wurde nicht entfernt und enthielt einen ausgeschriebenen Geheimnisnamen. Das ist der zweite
gemessene Beleg für dieselbe Eigenschaft — und für ihre Richtung: **ein zusätzlicher Befund,
kein fehlender.** Behandelt wie beim ersten Mal, durch Umformulieren des Kommentars; **keine**
Ausnahme, **keine** Reparatur des Strippers. Eine Zusicherung in der Suite hält fest, dass ein
Verstoß auch dann gemeldet wird, wenn ein Regex-Literal davor steht.

---

## Verbleibende Restrisiken

1. **`entferneKommentare` bleibt regex-blind.** Der nächste Regex mit einem
   Anführungszeichen erzeugt wieder Fehlalarme in allen folgenden Zeilen
   derselben Datei. Ein regex-bewusster Stripper wäre ein eigener Schnitt und
   gehört nicht in einen Hotfix. Die Richtung ist fail-loud, deshalb tragbar.

2. **Die Familienliste ist eine Aufzählung, keine Ableitung.** Ein künftiger
   Anmeldeweg mit einem neuen Namensschema wird von keiner der elf Familien
   erfasst, bis jemand ihn einträgt. Das gilt für jeden Namenswächter.

3. **Der Wächter prüft versionierte Dateien.** Lokale, ignorierte
   Environment-Dateien liest er bewusst nicht — dafür ist `secret-scan` mit
   gitleaks zuständig, und dessen gemessene Abdeckung ist lückenhaft
   (`sb_secret_`, `sb_publishable_`, Klartextpasswörter und
   Verbindungszeichenketten mit Passwort werden nicht erkannt).

4. **Die Assignment-Grammatik deckt die Form von `.env.example` ab, nicht jede denkbare
   Shell-Syntax.** Mehrzeilige Werte, `set -a`-Blöcke oder Heredocs kommen in einer
   `.env`-Vorlage nicht vor und werden nicht modelliert. Eine nicht kommentierte Zeile, die
   nicht passt, erzeugt einen Parsing-Befund statt still zu verschwinden — das ist die
   Absicherung gegen diese Grenze, keine Behauptung von Vollständigkeit.

5. **Modul-Tabellenbesitz bleibt Dokumentation.** Unverändert durch diesen
   Hotfix, hier nur erwähnt, damit die Liste vollständig ist.
