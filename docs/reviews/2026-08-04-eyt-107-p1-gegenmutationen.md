# EYT-107 P1 — Gegenmutationen zur Kanal- und Spaltengrenze

Stand: 04.08.2026 · Branch `feat/eyt-107-publish-core` · PR #52

Dieses Protokoll gehört zum P1-Befund der unabhängigen Finalprüfung: _„Direkter
Tabellen-UPDATE umgeht den Publish-Command."_ Es ist die Fortsetzung von
[`2026-08-03-eyt-107-gegenmutationen.md`](2026-08-03-eyt-107-gegenmutationen.md),
das den Command-Pfad selbst behandelt.

**Getrennt gehalten wird, was getrennt ist:** ausgeführte Mutationen mit
gemessenem Ergebnis, nicht ausgeführte mit Grund, und Bedingungen, die
strukturell nicht falsifizierbar sind.

---

## 0. Der Befund ist reproduziert, nicht nur gelesen

Vor der Korrektur: Commit `418619f` enthielt **ausschließlich** die Nachweise,
nicht die Migration. CI-Lauf
[`30862313345`](https://github.com/DYAI2025/EasyTree/actions/runs/30862313345).

`auth-journey` fuhr den echten Angriffskanal — ein per GoTrue angemeldeter
Mensch, sein echtes Bearer-Token, die echte PostgREST-Instanz — und der Angriff
**gelang**:

```
Error: PostgREST hat eine Planversion veroeffentlicht — der Command ist umgehbar
expect(received).toHaveLength(expected)
Expected length: 0
Received length: 1
Received array: [{"created_at": "2026-08-03T23:31:15.278359+00:00",
                  "id":         "00000000-0000-4000-8000-00000000e251",
                  "org_id":     "00000000-0000-4000-8000-00000000e201",
                  "published_at": "2026-08-03T09:00:00+00:00",
                  "published_by": "4049ac70-acc1-4805-8d35-4bc87b363a63",
                  "week_key":   "2026-W32"}]
```

Das ist die Sache selbst: `published_at` gesetzt, `published_by` auf den
Angreifer, über `PATCH /rest/v1/plan_versions` — ohne Wochenzuordnungsprüfung,
ohne benannte Konflikte, ohne Idempotenzdatensatz, ohne Audit, ohne Outbox.

Im selben Lauf `db-gates`:

```
# Failed test 14: "threw 42501"
#       caught: 23514: Veroeffentlichte Zeile in public.plan_versions ist unveraenderlich
        (0006_planning_invariants.sql — die Spaltengrenze fehlte noch)
psql: ERROR:  function app.is_runtime_channel() does not exist
        (0011_planning_publish.sql:160 — Bad plan. You planned 25 tests but ran 7)
```

**Der rote Lauf ist damit belegt und nicht behauptet.** Er war die
Voraussetzung dafür, dass die grünen Läufe darunter etwas bedeuten.

---

## 0b. Der Fix hatte selbst eine Nebenwirkung — gemessen, nicht vermutet

Der erste Korrekturcommit war in zehn von elf Jobs grün. `db-gates` fiel, und
zwar an einer Stelle, die niemand vorhergesehen hatte:

```
# Failed test 18: "Eine veroeffentlichte Planversion nimmt keine weitere Zuweisung auf"
#       caught: no exception
        (0006_planning_invariants.sql, Lauf 30862744360)
```

**PostgreSQL prüft bei einer Sperrklausel zusätzlich die `using`-Klausel der
UPDATE-Policy.** Ein `select ... for share` gilt als Vorbereitung einer
Änderung. `app.reject_assignment_in_published_plan()` aus Migration 0010 liest
die Elternzeile genau so — invoker, mit `for share`, aus gutem Grund. Sobald
`using` den Laufzeitkanal verlangt, findet dieses Select aus jeder anderen
Sitzung nichts mehr, und der Zweig „nicht gefunden heißt fremder Mandant" lässt
die Zuweisung durch.

Das wäre eine **neue** Lücke gewesen, entstanden beim Schließen einer alten:
über die Data-API hätte jedes Mitglied Zuweisungen in eine bereits
veröffentlichte Planversion einfügen können. Die Korrektur macht die Funktion
`security definer` und schreibt die Mandantenbedingung der SELECT-Policy
(`org_id in (select app.user_org_ids())`) ausdrücklich in den Rumpf — dieselbe
Sichtbarkeit, ohne die Nebenwirkung der Sperrklausel.

Bemerkenswert ist nicht der Fehler, sondern wer ihn gefunden hat: ein
bestehender Test aus EYT-49, der nichts mit dieser Änderung zu tun hat. Ohne
ihn wäre die Lücke mit einem grünen Lauf gemergt worden.

---

## 1. Ausgeführte Gegenmutationen

Vier vom Prüfbericht geforderte Mutationen. Jede ist eingespielt, gemessen und
zurückgenommen worden — keine ist nur ausgedacht.

| Nr.      | Mutation                                                                         | Erwartet rot                                                                                            | Gemessen | Lauf    |
| -------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------- | ------- |
| GM-P1    | `app.is_runtime_channel()` aus `using` der Update-Policy entfernen               | pgTAP 0011 „trotz planning.publish bleibt … Entwurf"; `auth-journey` 9c2                                | _s. u._  | _s. u._ |
| GM-P2/P3 | `grant update on plan_versions to authenticated` (volles Tabellen-UPDATE zurück) | pgTAP 0011 `week_key`/`org_id` → 42501; pgTAP 0006 Test 14; Integrationstest „org_id nicht umschreiben" | _s. u._  | _s. u._ |
| GM-P4    | `published_by = auth.uid()` aus `with check` entfernen                           | `planning-publish.integration.test.ts` „fremde Urheberangabe"                                           | _s. u._  | _s. u._ |

**GM-P2 und GM-P3 sind dieselbe Mutation.** Der Prüfbericht nennt sie getrennt
(„vollständiges Tabellen-UPDATE wieder gewähren" und „Spaltenbegrenzung
entfernen"), aber in SQL ist beides ein und dieselbe Anweisung: ein
`grant update on table ... to authenticated` hebt die Spaltenbegrenzung auf, und
es gibt keinen dritten Zustand dazwischen. Sie wird deshalb **einmal**
ausgeführt und einmal gezählt, nicht zweimal abgehakt.

---

## 2. Nicht falsifizierbar — ehrlich als Tiefenverteidigung geführt

Zwei Bedingungen der neuen Policy sind **nicht** durch einen Test widerlegbar,
solange die Policy im Übrigen intakt ist. Sie stehen trotzdem im Code, und
zwar bewusst:

| Bedingung                                      | Warum kein Test sie rot macht                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app.is_runtime_channel()` im **`with check`** | `using` erzwingt sie bereits. Eine Anweisung, die `using` nicht passiert, erreicht `with check` nie — die Klausel ist unerreichbar, solange die andere hält. |
| `app.has_permission(...)` im **`with check`**  | Dasselbe, verstärkt durch die Spaltengrenze: `org_id` ist nicht änderbar, also kann die zweite Auswertung nie ein anderes Ergebnis liefern.                  |

Das ist kein bestandener Nachweis und wird auch nicht als solcher gezählt. Der
Grund, es dennoch hinzuschreiben: `with check` ist der Ort, an dem eine
Bedingung auf dem **neuen** Zeilenzustand steht. Wer die Policy später um einen
`for insert`-Zweig oder eine zweite Update-Policy ergänzt, findet sie dort vor,
statt sie zu vergessen. Der Preis ist eine zusätzliche Funktionsauswertung je
Zeile.

---

## 3. Was der Fix strukturell nicht deckt

Benannt, nicht weggeredet:

- **`service_role` und `postgres` tragen `BYPASSRLS`** (gemessen 04.08.2026 auf
  dem gehosteten Projekt). Sie umgehen jede Policy, auf jeder Tabelle. Die
  Kanalgrenze ändert daran nichts und kann es nicht — RLS gilt für sie nicht.
  Das ist der Grund, warum CLAUDE.md Service-Role-Pfade in der Anwendung
  verbietet, und es ist bestehender Stand, keine Regression dieser Änderung.
- **pgTAP kann `authenticator` nicht simulieren.** `SET SESSION AUTHORIZATION`
  verlangt, dass der ursprüngliche Sitzungsbenutzer Superuser war; `postgres`
  ist das in Supabase nicht (`rolsuper = false`, `rolbypassrls = true`). Der
  pgTAP-Negativfall misst deshalb „eine Sitzung, deren Loginrolle nicht
  `easytree_app` ist" — konkret `postgres`. Die exakte PostgREST-Sitzung misst
  **nur** `auth-journey`, und dort ist sie echt.
- **`assignments` bleibt unverändert.** `assignments_update_in_org` und
  `assignments_insert_in_org` prüfen bis heute **nur** die Organisation, kein
  fachliches Recht: jedes aktive Mitglied kann Zuweisungen einer Entwurfswoche
  über die Data-API direkt ändern. Das ist ein realer Befund derselben Familie,
  aber **nicht** der gemeldete P1 (dort geht es ausschließlich um die
  Veröffentlichung). Er wird hier festgehalten und nicht mitrepariert — eine
  stille Ausweitung des Änderungsumfangs wäre die falsche Antwort auf einen
  eng gefassten Prüfbefund.
- **Ein Wechsel auf den Supavisor-Transaktionspooler bricht das
  Veröffentlichen.** Dort lautet `session_user` `postgres.<pooler-tenant-id>`.
  Es bricht laut: `planning-write.repository.ts` wirft bei null betroffenen
  Zeilen eine benannte Ausnahme. Siehe `docs/runbooks/planning-publish.md`.

---

## 4. Was diese Korrektur an bestehenden Nachweisen geändert hat

Nicht jede Änderung an einer Testdatei ist eine Verbesserung; hier ist, was
womit passiert ist:

| Datei                          | Vorher                                                                | Nachher                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/0011`          | `lives_ok` auf ein direktes `update` — der Bypass als **Positivfall** | dieselbe Anweisung, Erwartung umgedreht: Wirkungslosigkeit. Dazu Spaltengrenze, Zählungen, `app.is_runtime_channel()` |
| `supabase/tests/0006` Test 14  | `set week_key` → `23514` (Trigger)                                    | zwei Aussagen: über `authenticated` → `42501` (Spaltenrecht), über den Eigentümer → `23514` (Trigger)                 |
| `supabase/tests/0006`, `0007`  | veröffentlichen über `authenticated`                                  | über den Eigentümerpfad — sie messen die 0010-Mechanik, nicht den Kanal                                               |
| `planning-publish.integration` | eine Verbindungszeichenkette (`postgres`)                             | zwei: Verwaltung (`postgres`) und Laufzeitkanal (`easytree_app`), plus zwei `with check`-Fälle                        |

Die Umstellung von 0006 und 0007 auf den Eigentümerpfad ist **kein**
Nachweisgewinn, sondern eine Anpassung: ohne sie wären ihre Publish-Anweisungen
wirkungslos geworden und die Folgeaussagen still vakuos. Der Gewinn liegt
allein in 0011, im Integrationstest und in `auth-journey`.
