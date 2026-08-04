# EYT-107 — Gegenmutationen

Stand: 03.08.2026 · Basis `d9b9607` · Branch `feat/eyt-107-publish-core`

Eine Gegenmutation zählt erst, wenn sie **eingespielt, gemessen und
zurückgenommen** wurde. Eine benannte, aber nie gefahrene Mutation ist eine
Behauptung — genau der Fehler, den `planning-write.integration.test.ts` im Kopf
vorführt: es nennt vier Gegenmutationen und führt keine aus.

Dieses Protokoll trennt deshalb hart zwischen **ausgeführt** und **auf dieser
Maschine nicht ausführbar**.

---

## A — Ausgeführt und gemessen (lokal, ohne Datenbank)

| #      | Mutation                                                         | Erwartung                                  | Gemessenes Ergebnis                                                                                                                                          |
| ------ | ---------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GM-5   | `zuweisungenAusserhalbDerWoche` liefert fest `[]`                | Wochenzuordnung fällt                      | **rot**, 3 Fälle: „meldet eine Zuweisung, die in einer anderen Woche liegt", „meldet jede abweichende Zuweisung", „rechnet in der Zone der Organisation"     |
| GM-8   | `MembershipPlanningAccessPolicy` winkt jedes Recht durch         | Rechteprüfung fällt                        | **rot**, 5 Fälle über zwei Dateien: `planning-access.test.ts` (3) und `planning-publish.http.test.ts` (2, darunter „lehnt ohne planning.publish mit 403 ab") |
| GM-10  | UI setzt den Zustand vor dem `await` auf „veröffentlicht"        | optimistische Scheinveröffentlichung fällt | **rot** — siehe Befund unten                                                                                                                                 |
| GM-TYP | `ALREADY_PUBLISHED` bekommt denselben `type` wie `STALE_VERSION` | Ununterscheidbarkeit fällt                 | **rot**, 2 Fälle: „vergibt jeden Code genau einmal", „vergibt vier VERSCHIEDENE types"                                                                       |

| GM-RSC | Kindfunktion über die Server/Client-Grenze zurückbauen (`page.tsx` gibt `PlanungZugang` wieder eine Render-Prop) | Routen-Rendernachweis fällt | **rot**, „Planung rendert serverseitig ohne Abbruch": erwartet `< 400`, erhalten `500` |

Nach jeder Rücknahme wurde grün gegengeprüft (34/34, 6/6, 17/17, 39/39, 12/12).
Rückgenommen wurde über **Sicherungskopien**, nicht über `git checkout --`:
das stellt den Commit-Stand her und hat in diesem Projekt schon zweimal Arbeit
vernichtet.

### GM-RSC — zweimal gemessen, weil die erste Messung log

Die Mutation blieb zunächst **grün**. Grund: `playwright.config.ts` startet
`next start`, also einen **vorgebauten** Server — der Mutant war gar nicht
kompiliert. Erst nach `pnpm --filter @easytree/web... build` wurde der Fall rot.

Das ist eine Falle für jede künftige Gegenmutation an `apps/web`: **ohne
Neubau misst man den alten Stand.** Ein „bleibt grün" aus einem nicht neu
gebauten Lauf ist kein Befund, sondern ein Messfehler.

Nebenbei korrigiert: der Kommentar im Test behauptete, der RSC-Grenzfehler
komme als 200 mit Fehlertext an. Gemessen ist es ein **500**. Die
Rumpfprüfung bleibt trotzdem stehen — sie deckt die andere Fehlerklasse ab.

### GM-10 — der Befund, der einen Test verbessert hat

Die Mutation feuerte, aber **am falschen Ort**. Rot wurde „sperrt die Aktion
während des Absendens"; der eigentlich zuständige Fall — „behauptet keinen
Erfolg, wenn der Server nicht erreichbar ist" — blieb **grün**.

Grund: der Test prüfte nur den ENDzustand. Nach der fehlgeschlagenen Antwort
überschreibt `setAblauf({kind:"abgelehnt"})` die optimistische Anzeige, bevor
`waitFor` sie sehen kann. Ein **kurzzeitig** falsches „Veröffentlicht" ist aber
genau der Fehler, um den es geht — die Planerin sieht es.

Der Test prüft seither den Zwischenzustand: solange die Antwort aussteht, darf
weder `planung-publish-erfolg` existieren noch die Standmarke „Veröffentlicht"
sagen. Mit dieser Assertion feuert GM-10 an der richtigen Stelle.

**Das ist der Ertrag des Ausführens.** Eine gedachte Gegenmutation hätte
„GM-10 macht den Scheinveröffentlichungs-Test rot" behauptet, und das wäre
falsch gewesen.

---

## B — Auf dieser Maschine NICHT ausführbar

Docker läuft hier nicht (`docker info` schlägt fehl), es gibt also keinen
lokalen Supabase-Stack. Migration 0015, die pgTAP-Suite 0011 und der gesamte
Integrationsnachweis laufen erstmals in `db-gates`. Die folgenden Mutationen
sind **spezifiziert und im Testkopf benannt, aber noch nicht gefahren**:

| #    | Mutation                                         | Erwarteter Effekt                           | Status       |
| ---- | ------------------------------------------------ | ------------------------------------------- | ------------ |
| GM-1 | `for update` beim Laden der Woche entfernen      | „zwei parallele Veröffentlichungen" rot     | offen bis CI |
| GM-2 | Vergleich mit `expectedVersionId` überspringen   | „veralteter Stand" rot                      | offen bis CI |
| GM-3 | Already-Published-Prüfung entfernen              | siehe Redundanzhinweis                      | offen bis CI |
| GM-4 | Replay-Zweig entfernen                           | „Wiederholung" rot; Audit/Outbox auf 2      | offen bis CI |
| GM-6 | Audit **oder** Outbox aus der Transaktion ziehen | „erzwungener Fehler hinterlässt nichts" rot | offen bis CI |
| GM-7 | Konfliktprüfung entfernen                        | **erwartet teils grün**, siehe unten        | offen bis CI |
| GM-9 | Sync-Trigger deaktivieren                        | „Trigger stempelt jede Zuweisung" rot       | offen bis CI |

Das ist eine Evidenzgrenze, kein erledigter Punkt. Wer den PR abnimmt, sollte
sie kennen: **für den Datenbankteil liegt bis zum ersten grünen `db-gates`-Lauf
nur Ausführungsevidenz der Testdatei vor, keine Mutationsevidenz.**

---

## C — Ehrlich bewertete Redundanz

Zwei der geplanten Mutationen werden die Wirkung **nicht** umkehren, und das
ist kein Mangel, sondern Tiefenverteidigung. Sie hier zu verschweigen wäre die
eigentliche Unehrlichkeit.

**GM-7 — Konfliktprüfung entfernen.**
`assignments_no_published_overlap` (Migration 0010) lehnt einen überlappenden
Entwurf weiterhin ab, sobald der Sync-Trigger die Zuweisungen stempelt. Der
falsche Zustand entsteht also auch ohne die Anwendungsprüfung nicht. Rot wird
der Test nur über den ERWARTETEN FEHLERTYP: statt einer benannten
Konfliktliste (`BLOCKING_CONFLICT` mit `EMPLOYEE_INTERVAL_OVERLAP`) käme ein
nacktes `23P01` an.

Der Wert der Anwendungsprüfung ist damit präzise benennbar: sie erzeugt die
**itemisierte Ablehnung**, nicht die Garantie. Die Garantie kommt von
PostgreSQL. „Konflikt" allein ist für eine Planerin nicht handhabbar.

**GM-3 — Already-Published-Prüfung entfernen.**
`app.reject_published_row_change()` verbietet jede weitere Änderung einer
veröffentlichten Zeile, und das `update` trägt zusätzlich
`and published_at is null`. Eine zweite Veröffentlichung entsteht also nicht.
Rot wird der Test darüber, dass statt des Fachcodes `already-published` ein
`23514` beziehungsweise ein Serverfehler ankäme.

---

## D — Was durch keine Gegenmutation abgesichert ist

**GM-5 ist der einzige Schutz seiner Art.** Für die Wochenzuordnung gibt es
kein Netz in der Datenbank: `plan_versions.week_key` ist mit keinem Zeitstempel
verknüpft (offene Lücke aus EYT-49, erneut gemessen auf `d9b9607`). Fällt die
Anwendungsprüfung, wird eine Woche mit fachlich fremden Zeiten verbindlich —
und EYT-109 rechnete Kosten darauf. Warum die Datenbankhälfte hier bewusst
nicht entsteht, steht in `docs/runbooks/planning-publish.md` §2.

**Nicht durch Mutation abgesichert ist außerdem der `@UseFilters`-Reihenfolge-
Fall.** Nest wertet die Filterliste rückwärts aus; steht der catch-all
`PlanningProblemFilter` hinten, verschluckt er `IdentityRejectedError` und aus
401 wird 500. Das wurde beim Bauen **gemessen** (die beiden Fälle
„antwortet ohne verifiziertes Subjekt mit 401" und „fragt ohne Subjekt gar
nicht erst ab" in `planning-window.http.test.ts` schlugen fehl) und ist im
Controller kommentiert. Diese beiden Fälle sind die Regressionssicherung.
