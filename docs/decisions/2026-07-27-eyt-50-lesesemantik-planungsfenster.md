# EYT-50 — Lesesemantik des Planungsfensters

**Datum:** 2026-07-27
**Vorgang:** EYT-50, Read-Through-Slice
**Status:** entschieden, vor der Implementierung

Diese Notiz beantwortet die vier Fragen, die vor `GET /api/v1/planung/fenster`
geklärt sein müssen. Sie steht hier und nicht im SQL, weil Lesesemantik, die
„nebenbei" in einer Query entsteht, später niemand mehr nachvollziehen kann.

## 1. Wie wird `weekKey` in die Auswahl übersetzt?

**Strukturell über `plan_versions.week_key`. Es wird in SQL kein Wochenbereich
berechnet.**

Das ist keine Bequemlichkeit, sondern die einzige Möglichkeit, die keine neue
Fehlerquelle aufmacht. Der Alternativweg wäre, aus `2026-W32` einen
UTC-Zeitbereich zu bilden und `assignments.starts_at_utc` dagegen zu filtern.
Dafür bräuchte es die Umrechnung *lokale Mitternacht → UTC* — und die gibt es
im Repository aus zwei Gründen nicht:

- `packages/domain/src/planning-week.ts` kennt ausschließlich die Richtung
  **Instant → Woche** (`localBusinessDate`, `isoWeekOfLocalDate`,
  `planningWeekOf`). Eine Umkehrfunktion existiert nicht.
- `apps/api/test/no-local-time-construction.test.ts` (EYT-61 AK6a) verbietet in
  Produktionscode genau diese Richtung. Dort wohnt die Sommerzeitlücke: für
  „29.03.2026 00:00 Europe/Berlin" gibt es einen Instant, für „02:30" keinen.

Eine Wochenberechnung in SQL wäre zusätzlich ein **zweiter Ableitungspfad**
neben `packages/domain` — genau die Konstellation, die als `FIND-003` schon
einmal falsche Kapazitätswerte erzeugt hat.

### Was diese Wahl kostet, offen benannt

`0007_planning.sql` verknüpft `week_key` mit **keiner** Prüfung gegen
`starts_at_utc`. Eine Zuweisung kann heute in der Planversion einer fremden
Woche hängen (dokumentiert in `apps/api/test/planning-invariants.integration.test.ts`).
Das Fenster zeigt dann eine Zuweisung, deren Beginn nach Domainregel in eine
andere Woche fällt.

Diese Lücke wird hier **nicht** geschlossen — sie gehört zu dem Vorgang, der
den Schreibpfad baut, und ein Constraint darüber ist eine Schemaänderung, keine
Lesefrage.

## 2. Entwürfe, veröffentlichte Zuweisungen, oder beides?

`PlanningWindowSchema` hat **ein** `assignments`-Feld und **ein**
`publishedVersionId`. Beides gleichzeitig lässt sich darin nicht darstellen,
also ist die Frage zu entscheiden und nicht zu umgehen.

**Das Fenster zeigt den bearbeitbaren Stand:**

- existiert ein Entwurf für `(org, weekKey)` — `published_at is null` —, zeigt
  das Fenster dessen Zuweisungen;
- sonst die Zuweisungen der zuletzt veröffentlichten Version;
- sonst nichts.

Begründung: das Fenster ist die Sicht der planenden Person auf ihre Arbeit.
Zeigte es Veröffentlichtes, während ein Entwurf existiert, sähe sie einen
Stand, den sie nicht bearbeiten kann. `0007` sichert über
`plan_versions_one_draft_per_week`, dass es höchstens **einen** Entwurf gibt —
„der Entwurf" ist damit bestimmbar.

## 3. Welche Planversion bestimmt `publishedVersionId`?

**Die zuletzt veröffentlichte Version derselben Woche, nach `published_at`;
`null`, wenn keine existiert.**

Wichtig: `plan_versions_one_draft_per_week` ist ein *partieller* Index und
begrenzt nur Entwürfe. Mehrere veröffentlichte Versionen derselben Woche sind
erlaubt und entstehen im Normalbetrieb — `supabase/tests/0006` fährt genau das.
„Die veröffentlichte Version" gibt es also nicht; es gibt die neueste.

`publishedVersionId` meldet unabhängig davon, was unter Punkt 2 in
`assignments` steht. Ein Fenster kann einen Entwurf zeigen **und** eine
veröffentlichte Version melden — das ist der Normalfall beim Umplanen.

## 4. Was liefert eine leere Woche?

**HTTP 200 mit `assignments: []` und `publishedVersionId: null`.**

Kein 404. Eine Woche ohne Plan ist eine gültige, leere Woche; 404 hieße „diese
Woche gibt es nicht", und das ist falsch. Der Client soll einen leeren
Wochenplan anzeigen, keinen Fehler.

## 5. Woher kommt die Organisation — und was bei mehreren?

**Ausschließlich aus dem verifizierten Subjekt über den Datenbankkontext.**
Keine Organisations-Id aus URL, Query oder Body; `PlanningWindowQuerySchema`
führt bewusst nur `weekKey`.

RLS filtert über `app.user_org_ids()`. Für `organizations.time_zone` muss aber
**eine** Organisation feststehen. Drei Fälle:

| aktive Mitgliedschaften | Verhalten |
| --- | --- |
| genau eine | normal |
| keine | 403 — angemeldet, aber ohne Organisation |
| mehrere | **stabiler Fehler, keine stille Auswahl** |

Der dritte Fall ist der wichtige. Eine Organisation zu „nehmen", weil sie die
erste in der Liste ist, wäre eine erfundene Mandantenentscheidung — und sie
fiele niemandem auf, weil das Ergebnis plausibel aussieht. EYT-50 AK1 verlangt
ohnehin *genau eine* Testorganisation. Die Auswahl unter mehreren ist eine
Produktfrage (Organisationswechsler in der UI) und gehört zu EYT-14.

## 6. Zeitzone

Aus `organizations.time_zone` (Migration `0004`), gelesen unter RLS. Sie geht
als `PlanningWindow.timeZone` mit, damit die UI die Wochengrenze nicht selbst
rät — der Grund, aus dem das Feld im Vertrag steht.

Bis hierher liest **kein** TypeScript diese Spalte; `EUROPE_BERLIN` in
`packages/domain` ist als Pilotzone markiert und kommt nur in Tests vor. Dieser
Slice ist die erste Stelle, an der die konfigurierte Zone tatsächlich wirkt.
