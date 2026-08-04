# EYT-107 F1–F5 — Gegenmutationen zur INSERT-Grenze

Stand: 04.08.2026 · Branch `fix/eyt-107-f1-insert-boundary` · PR #54

Dritter Teil des Protokolls. Vorgänger:
[Command-Pfad](2026-08-03-eyt-107-gegenmutationen.md) und
[Kanal- und Spaltengrenze](2026-08-04-eyt-107-p1-gegenmutationen.md).

Diese Runde gehört zu den fünf Befunden des **Selbstreviews der P1-Korrektur**.
Die Korrektur hat `UPDATE` abgedichtet und `INSERT` nicht angesehen.

---

## 0. Der Befund ist reproduziert, nicht nur gelesen

Commit `8731a93` enthielt ausschließlich die Nachweise, nicht die Migration.
Lauf [`30873548526`](https://github.com/DYAI2025/EasyTree/actions/runs/30873548526).

`auth-journey` fuhr denselben echten Angriffskanal wie beim P1 — GoTrue-Token,
echte PostgREST-Instanz — nur mit `POST` statt `PATCH`. Der Angriff **gelang**:

```
Error: PostgREST hat eine bereits veroeffentlichte Planversion angelegt
Expected length: 0
Received length: 1
```

Im selben Lauf `db-gates`: pgTAP 0011 Tests 20, 22, 23 und 30 rot, pgTAP 0006
Test 16 rot. **Fünf erwartete Rote, keine unerwarteten.**

---

## 1. Ausgeführte Gegenmutationen

Wegwerf-Branch mit Wegwerf-PR #55 (geschlossen, Branch gelöscht).

| Nr.          | Mutation                                                      | Lauf                                                                         | Gemessen                                                                                                                                                   |
| ------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GM-F1a       | Insert-Spalten-Grant zurücknehmen (`grant insert on table …`) | [30874279915](https://github.com/DYAI2025/EasyTree/actions/runs/30874279915) | **db-gates rot**, pgTAP 0011 Test 20 („authenticated darf plan_versions.published_at NICHT beim Anlegen mitgeben"). **`auth-journey` grün** — siehe unten. |
| GM-F1a + F1b | zusätzlich `published_at is null` aus der Insert-Policy       | [30874546740](https://github.com/DYAI2025/EasyTree/actions/runs/30874546740) | **Beide rot.** `auth-journey`: „PostgREST hat eine bereits veroeffentlichte Planversion angelegt", Received length 1.                                      |
| GM-F2        | `auth.uid() is null or` aus der Triggerfunktion entfernen     | [30874828037](https://github.com/DYAI2025/EasyTree/actions/runs/30874828037) | **db-gates rot**, pgTAP 0011 Test 30 („threw 23514 / caught: no exception").                                                                               |
| GM-F3        | `delete`-Grant zurückgeben                                    | derselbe Lauf                                                                | **db-gates rot**, pgTAP 0011 Test 23 und pgTAP 0006 Test 16 („threw 42501 / caught: 23514 … kann nicht geloescht werden").                                 |

GM-F2 und GM-F3 liefen gebündelt, weil beide Nachweise in **derselben**
pgTAP-Stufe liegen — pgTAP führt alle Tests einer Datei aus, es gibt keinen
Abbruch dazwischen. Genau die Bedingung, an der das Bündeln beim vorigen Mal
scheiterte.

---

## 2. Was GM-F1a gezeigt hat — spiegelbildlich zum P1

Bei der Kanalgrenze in 0015 war die `with check`-Kopie der eigenständige
Riegel und `using` der zuerst greifende. **Beim INSERT ist es umgekehrt:**

| Konfiguration        | Angriff über PostgREST | Was entscheidet        |
| -------------------- | ---------------------- | ---------------------- |
| nur Spalten-Grant    | abgewiesen             | Spaltenrecht (`42501`) |
| nur Policy           | abgewiesen             | RLS (`42501`)          |
| beide (Auslieferung) | abgewiesen             | Spaltenrecht zuerst    |
| keine von beiden     | **gelingt**            | —                      |

Dass GM-F1a den Verhaltenstest (`insert … published_at` → `42501`) **nicht**
rot macht, ist kein Mangel des Tests, sondern eine Eigenschaft von PostgreSQL:
eine RLS-Verletzung beim INSERT trägt denselben SQLSTATE `42501` wie ein
fehlendes Spaltenrecht. Zwei verschiedene Riegel, eine Fehlernummer.

**Genau deshalb steht die Katalogaussage daneben.** `has_column_privilege(…)`
unterscheidet, was der SQLSTATE nicht unterscheidet — und sie ist die einzige
Zeile, die GM-F1a fallen sieht. Ein Verhaltenstest allein hätte hier eine
Verschlechterung nicht bemerkt.

---

## 3. Was diese Runde nicht deckt

- **`assignments` bleibt unverändert** (NG-1): `insert`, `update` und `delete`
  prüfen dort weiterhin nur die Organisation, kein fachliches Recht. Derselbe
  Folgebefund wie in der P1-Runde, weiterhin ausdrücklich nicht mitrepariert —
  er betrifft Entwurfsdaten, nicht die Veröffentlichung.
- **`service_role` und `postgres`** tragen `BYPASSRLS`. Unverändert.
- **F4 und F5** sind Dokumentation und CI-Hygiene; sie haben keine
  Gegenmutation und werden auch nicht als Nachweis gezählt. Ihre Prüfung ist
  ein `grep`, kein Test.
